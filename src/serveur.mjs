// Serveur local du kit : sert la page et une petite API JSON, sur 127.0.0.1
// uniquement.
//
// Protections, parce que n'importe quel site ouvert dans le navigateur peut
// essayer d'appeler 127.0.0.1 :
// - jeton aléatoire dans le lien d'ouverture, échangé contre un cookie de
//   session HttpOnly, SameSite=Strict ;
// - en-tête Host exigé égal à 127.0.0.1:<port> (bloque le DNS rebinding) ;
// - en-tête X-Hey-Kit exigé sur l'API (un formulaire d'un autre site ne peut
//   pas l'ajouter), corps en JSON uniquement ;
// - Content-Security-Policy stricte, aucune ressource externe ;
// - coffre reverrouillé après un délai sans activité.
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { ErreurCoffre } from "./coffre.mjs";
import { APPS, afficher, empreinteAndroid, envoyerApp, etatApp, importerAncien, saisir } from "./apps.mjs";
import { CONNEXIONS, DOSSIER_COMMUN, connexion, formatValide, verifier } from "./connexions.mjs";
import { creerCompilations } from "./compilation.mjs";
import { creerOutils } from "./outils.mjs";
import { lirePlantages, rapport } from "./plantages.mjs";

const TAILLE_MAX = 2 * 1024 * 1024;
const COOKIE = "hey_kit";
const FICHIERS = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};
const ENTETES = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function egal(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function lireCookie(req) {
  for (const morceau of (req.headers.cookie ?? "").split(";")) {
    const [cle, ...reste] = morceau.trim().split("=");
    if (cle === COOKIE) return reste.join("=");
  }
  return null;
}

function envoyer(res, statut, corps, entetes = {}) {
  res.writeHead(statut, { ...ENTETES, "Content-Type": "application/json; charset=utf-8", ...entetes });
  res.end(JSON.stringify(corps));
}

const erreur = (res, statut, code) => envoyer(res, statut, { erreur: code });

async function lireCorps(req) {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new ErreurCoffre("requete-invalide");
  const morceaux = [];
  let taille = 0;
  for await (const morceau of req) {
    taille += morceau.length;
    if (taille > TAILLE_MAX) throw new ErreurCoffre("trop-gros");
    morceaux.push(morceau);
  }
  try {
    const corps = JSON.parse(Buffer.concat(morceaux).toString("utf8") || "{}");
    if (typeof corps !== "object" || corps === null || Array.isArray(corps)) throw new Error();
    return corps;
  } catch {
    throw new ErreurCoffre("requete-invalide");
  }
}

// Crée le serveur (sans l'ouvrir). `jeton` est celui du lien d'ouverture.
export function creerServeur({
  coffre,
  jeton,
  dossierPublic,
  version,
  fetchFn = fetch,
  outils = creerOutils(),
  accueil,
  delaiVerrouillage = 15 * 60_000,
  maintenant = Date.now,
  windows = process.platform === "win32",
}) {
  const compilations = creerCompilations({ coffre, outils, dossierKit: path.dirname(coffre.fichier), fetchFn, windows });
  const session = randomBytes(32).toString("base64url");
  let derniereActivite = maintenant();
  let port = null;

  const verrouiller = () => coffre.verrouiller();

  // Dernière vérification de chaque connexion : état et date, gardés dans le
  // coffre d'un lancement à l'autre. Jamais de valeur secrète.
  const NOTE = (id) => `verification:${id}`;
  const verifierEtNoter = async (id) => {
    const resultat = await verifier(coffre, id, { fetchFn });
    const note = { ...resultat, le: new Date(maintenant()).toISOString() };
    await coffre.ecrireNote(NOTE(id), note);
    return note;
  };
  // Une clé d'une connexion changée depuis l'onglet Coffre : l'ancien résultat ne vaut plus.
  const oublierVerification = async (dossier, nom) => {
    if (dossier !== DOSSIER_COMMUN) return;
    for (const definition of CONNEXIONS) {
      if (definition.champs.some((champ) => champ.nom === nom)) await coffre.ecrireNote(NOTE(definition.id), null);
    }
  };

  const minuterie = setInterval(() => {
    if (coffre.ouvert && maintenant() - derniereActivite > delaiVerrouillage) verrouiller();
  }, 30_000);
  minuterie.unref();

  const etatConnexions = () =>
    CONNEXIONS.map((definition) => ({
      id: definition.id,
      champs: definition.champs.map((champ) => ({
        nom: champ.nom,
        type: champ.type,
        present: coffre.present(DOSSIER_COMMUN, champ.nom),
        ...(champ.type === "texte" && coffre.present(DOSSIER_COMMUN, champ.nom)
          ? { valeur: coffre.lire(DOSSIER_COMMUN, champ.nom).valeur }
          : {}),
      })),
      verification: coffre.lireNote(NOTE(definition.id)),
    }));

  const routes = {
    "GET /api/etat": async () => ({
      version,
      coffre: coffre.ouvert ? "ouvert" : (await coffre.existe()) ? "verrouille" : "absent",
      fichier: coffre.fichier,
    }),
    "POST /api/coffre/creer": async ({ motDePasse }) => {
      await coffre.creer(motDePasse);
      return { ok: true };
    },
    "POST /api/coffre/ouvrir": async ({ motDePasse }) => {
      await coffre.ouvrir(motDePasse);
      return { ok: true };
    },
    "POST /api/coffre/verrouiller": async () => {
      verrouiller();
      return { ok: true };
    },
    "POST /api/coffre/mot-de-passe": async ({ ancien, nouveau }) => {
      await coffre.changerMotDePasse(ancien, nouveau);
      return { ok: true };
    },
    "GET /api/coffre": async () => ({ dossiers: coffre.lister() }),
    "POST /api/coffre/ecrire": async ({ dossier, nom, type, valeur, nomFichier }) => {
      await coffre.ecrire(dossier, nom, { type, valeur, nomFichier });
      await oublierVerification(dossier, nom);
      return { ok: true };
    },
    "POST /api/coffre/supprimer": async ({ dossier, nom }) => {
      await coffre.supprimer(dossier, nom);
      await oublierVerification(dossier, nom);
      return { ok: true };
    },
    "GET /api/connexions": async () => {
      if (!coffre.ouvert) throw new ErreurCoffre("verrouille");
      return { connexions: etatConnexions() };
    },
    // Enregistre les champs remplis (les vides gardent l'ancienne valeur), puis vérifie.
    "POST /api/connexions/enregistrer": async ({ id, champs }) => {
      const definition = connexion(id);
      if (!definition || typeof champs !== "object" || champs === null) throw new ErreurCoffre("requete-invalide");
      for (const champ of definition.champs) {
        const saisie = champs[champ.nom];
        if (saisie === undefined || saisie === null || saisie.valeur === "") continue;
        if (champ.type === "fichier") {
          await coffre.ecrire(DOSSIER_COMMUN, champ.nom, { type: "fichier", valeur: saisie.valeur, nomFichier: saisie.nomFichier });
        } else {
          const valeur = typeof saisie.valeur === "string" ? saisie.valeur.trim() : "";
          if (!formatValide(champ.nom, valeur)) return { verification: { etat: "invalide", champ: champ.nom } };
          await coffre.ecrire(DOSSIER_COMMUN, champ.nom, { type: "texte", valeur });
        }
      }
      return { verification: await verifierEtNoter(id) };
    },
    "POST /api/connexions/verifier": async ({ id }) => {
      if (!connexion(id)) throw new ErreurCoffre("requete-invalide");
      if (!coffre.ouvert) throw new ErreurCoffre("verrouille");
      return { verification: await verifierEtNoter(id) };
    },
    "GET /api/apps": async () => ({
      apps: APPS.map(({ id, nom, crashlytics, android }) => ({ id, nom, plantages: Boolean(crashlytics), compilation: Boolean(android) })),
    }),
    "POST /api/compilation/etat": async ({ id }) => compilations.etat(id),
    "POST /api/compilation/lancer": async ({ id }) => compilations.lancer(id),
    "POST /api/compilation/arreter": async ({ id }) => compilations.arreter(id),
    "POST /api/compilation/ouvrir": async ({ id }) => compilations.ouvrir(id),
    "POST /api/apps/etat": async ({ id }) => etatApp(coffre, id, { fetchFn }),
    "POST /api/apps/saisir": async ({ id, nom, valeur, nomFichier }) => saisir(coffre, id, nom, { valeur, nomFichier }),
    "POST /api/apps/envoyer": async ({ id, remplacer }) => {
      outils.oublier();
      return envoyerApp(coffre, id, { fetchFn, outils, remplacer });
    },
    "POST /api/apps/importer-ancien": async ({ id }) => importerAncien(coffre, id, accueil ? { accueil } : {}),
    "POST /api/apps/afficher": async ({ id, nom }) => afficher(coffre, id, nom),
    "POST /api/plantages": async ({ id, jours }) => {
      const resultat = await lirePlantages(coffre, id, { jours, fetchFn });
      if (resultat.etat !== "ok") return resultat;
      return { ...resultat, rapport: rapport(APPS.find((item) => item.id === id).nom, resultat) };
    },
    "POST /api/apps/empreinte": async ({ id }) => {
      outils.oublier();
      return empreinteAndroid(coffre, id, { outils });
    },
  };

  const serveur = http.createServer(async (req, res) => {
    try {
      if (port === null || req.headers.host !== `127.0.0.1:${port}`) return erreur(res, 421, "hote");
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

      // Lien d'ouverture : échange le jeton contre le cookie de session.
      if (req.method === "GET" && url.pathname === "/ouvrir") {
        if (!egal(url.searchParams.get("t") ?? "", jeton)) return erreur(res, 403, "jeton");
        res.writeHead(303, {
          ...ENTETES,
          Location: "/",
          "Set-Cookie": `${COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/`,
        });
        return res.end();
      }

      if (!egal(lireCookie(req) ?? "", session)) {
        if (url.pathname.startsWith("/api/")) return erreur(res, 403, "session");
        res.writeHead(403, { ...ENTETES, "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Ouvrez le kit avec le lien affiché dans la fenêtre où il tourne.\n");
      }

      if (req.method === "GET" && Object.hasOwn(FICHIERS, url.pathname)) {
        const [nom, type] = FICHIERS[url.pathname];
        const contenu = await fs.readFile(path.join(dossierPublic, nom));
        res.writeHead(200, { ...ENTETES, "Content-Type": type });
        return res.end(contenu);
      }

      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) return erreur(res, 404, "introuvable");
      if (req.headers["x-hey-kit"] !== "1") return erreur(res, 403, "entete");
      const corps = req.method === "POST" ? await lireCorps(req) : {};
      derniereActivite = maintenant();
      return envoyer(res, 200, await route(corps));
    } catch (probleme) {
      if (probleme instanceof ErreurCoffre) {
        const statut = probleme.code === "verrouille" ? 423 : probleme.code === "mot-de-passe" ? 401 : 400;
        return envoyer(res, statut, { erreur: probleme.code, ...(probleme.detail ? { detail: probleme.detail } : {}) });
      }
      return erreur(res, 500, "interne");
    }
  });

  serveur.on("listening", () => {
    port = serveur.address().port;
  });
  serveur.on("close", () => {
    clearInterval(minuterie);
    verrouiller();
  });
  return serveur;
}
