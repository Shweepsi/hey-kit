// Serveur local : protections d'accès et parcours complet, sans vrai service.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Coffre } from "../src/coffre.mjs";
import { creerServeur } from "../src/serveur.mjs";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const JETON = "jeton-de-test";
const MOT = "mot de passe maître de test";

let serveur;
let port;
let coffre;
let cookie;
let horloge = 0;
const appelsReseau = [];

// Requête brute : permet de fixer l'en-tête Host comme le ferait un autre site.
function requete({ methode = "GET", chemin, entetes = {}, corps }) {
  return new Promise((resolve, reject) => {
    const donnees = corps === undefined ? undefined : JSON.stringify(corps);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: methode,
        path: chemin,
        headers: {
          Host: `127.0.0.1:${port}`,
          ...(donnees ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(donnees) } : {}),
          ...entetes,
        },
      },
      (res) => {
        const morceaux = [];
        res.on("data", (m) => morceaux.push(m));
        res.on("end", () => {
          const texte = Buffer.concat(morceaux).toString();
          let json = null;
          try {
            json = JSON.parse(texte);
          } catch {
            // page HTML ou texte
          }
          resolve({ statut: res.statusCode, entetes: res.headers, texte, json });
        });
      },
    );
    req.on("error", reject);
    if (donnees) req.write(donnees);
    req.end();
  });
}

const api = (methode, chemin, corps) =>
  requete({ methode, chemin, corps, entetes: { Cookie: cookie, "X-Hey-Kit": "1" } });

before(async () => {
  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), "hey-kit-"));
  coffre = new Coffre(path.join(dossier, "coffre.hey-kit"), { kdf: { N: 2 ** 10, r: 8, p: 1 } });
  const fetchFn = async (url) => {
    appelsReseau.push(String(url));
    return new Response(JSON.stringify({ login: "exemple" }), { status: 200 });
  };
  serveur = creerServeur({
    coffre,
    jeton: JETON,
    dossierPublic: PUBLIC,
    version: "0.0.0",
    fetchFn,
    delaiVerrouillage: 1000,
    maintenant: () => horloge,
  });
  await new Promise((resolve) => serveur.listen(0, "127.0.0.1", resolve));
  port = serveur.address().port;
});

after(() => serveur.close());

test("sans le jeton : pas de session", async () => {
  assert.equal((await requete({ chemin: "/ouvrir?t=mauvais" })).statut, 403);
  assert.equal((await requete({ chemin: "/" })).statut, 403);
  assert.equal((await requete({ chemin: "/api/etat", entetes: { "X-Hey-Kit": "1" } })).statut, 403);
});

test("le lien d'ouverture donne un cookie de session strict", async () => {
  const reponse = await requete({ chemin: `/ouvrir?t=${JETON}` });
  assert.equal(reponse.statut, 303);
  assert.equal(reponse.entetes.location, "/");
  const brut = reponse.entetes["set-cookie"][0];
  assert.match(brut, /HttpOnly/);
  assert.match(brut, /SameSite=Strict/);
  cookie = brut.split(";")[0];
  const page = await requete({ chemin: "/", entetes: { Cookie: cookie } });
  assert.equal(page.statut, 200);
  assert.match(page.entetes["content-security-policy"], /default-src 'none'/);
  assert.match(page.texte, /hey-kit/);
});

test("un autre nom d'hôte est refusé (DNS rebinding)", async () => {
  const reponse = await requete({ chemin: "/api/etat", entetes: { Host: "attaquant.example", Cookie: cookie, "X-Hey-Kit": "1" } });
  assert.equal(reponse.statut, 421);
});

test("l'API exige l'en-tête X-Hey-Kit et du JSON", async () => {
  assert.equal((await requete({ chemin: "/api/etat", entetes: { Cookie: cookie } })).statut, 403);
  const formulaire = await requete({
    methode: "POST",
    chemin: "/api/coffre/creer",
    entetes: { Cookie: cookie, "X-Hey-Kit": "1", "Content-Type": "application/x-www-form-urlencoded" },
  });
  assert.equal(formulaire.statut, 400);
  assert.equal(await coffre.existe(), false);
});

test("parcours : créer, enregistrer une connexion, vérifier, verrouiller", async () => {
  assert.equal((await api("GET", "/api/etat")).json.coffre, "absent");
  assert.equal((await api("POST", "/api/coffre/creer", { motDePasse: "court" })).json.erreur, "mot-de-passe-court");
  assert.equal((await api("POST", "/api/coffre/creer", { motDePasse: MOT })).statut, 200);
  assert.equal((await api("GET", "/api/etat")).json.coffre, "ouvert");

  const enregistre = await api("POST", "/api/connexions/enregistrer", {
    id: "github",
    champs: { GITHUB_TOKEN: { valeur: "ghp_valeur_secrete" } },
  });
  assert.deepEqual(enregistre.json.verification.etat, "ok");
  assert.equal(appelsReseau.at(-1), "https://api.github.com/user");

  const connexions = await api("GET", "/api/connexions");
  assert.ok(!connexions.texte.includes("ghp_valeur_secrete"));
  const github = connexions.json.connexions.find((c) => c.id === "github");
  assert.equal(github.champs[0].present, true);
  assert.equal(github.verification.etat, "ok");

  const liste = await api("GET", "/api/coffre");
  assert.ok(!liste.texte.includes("ghp_valeur_secrete"));
  assert.equal(liste.json.dossiers.Commun[0].nom, "GITHUB_TOKEN");

  const invalide = await api("POST", "/api/connexions/enregistrer", {
    id: "cloudflare",
    champs: { CLOUDFLARE_ACCOUNT_ID: { valeur: "pas-un-id" } },
  });
  assert.deepEqual(invalide.json.verification, { etat: "invalide", champ: "CLOUDFLARE_ACCOUNT_ID" });

  assert.equal((await api("POST", "/api/coffre/verrouiller", {})).statut, 200);
  assert.equal((await api("GET", "/api/connexions")).statut, 423);
  assert.equal((await api("POST", "/api/coffre/ouvrir", { motDePasse: "faux" })).statut, 401);
  assert.equal((await api("POST", "/api/coffre/ouvrir", { motDePasse: MOT })).statut, 200);
});

test("route inconnue et corps trop gros", async () => {
  assert.equal((await api("GET", "/api/rien")).statut, 404);
  const gros = await api("POST", "/api/coffre/ecrire", { dossier: "Commun", nom: "GROS", valeur: "x".repeat(3 * 1024 * 1024) });
  assert.equal(gros.json.erreur, "trop-gros");
});
