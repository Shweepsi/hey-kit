// « Mes apps » : ce que chaque app attend sur GitHub (secrets et variables de
// la CI) et sur son Worker Cloudflare, d'où vient chaque valeur, et l'envoi.
//
// Règles :
// - on n'envoie que ce qui manque, sauf demande explicite de remplacement ;
// - une valeur « conservée » (clé de signature, clé de chiffrement…) n'est
//   jamais remplacée une fois en place : la changer casserait l'existant ;
// - toute valeur générée est rangée dans le coffre avant d'être envoyée ;
// - les secrets GitHub partent par `gh` (chiffrement exigé par GitHub), avec le
//   jeton du coffre ; le reste passe par les API REST de GitHub et Cloudflare.
// Aucune valeur n'est renvoyée à l'interface, sauf celles marquées `afficher`.
import { createPrivateKey, randomBytes, randomInt } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ErreurCoffre } from "./coffre.mjs";
import { DOSSIER_COMMUN } from "./connexions.mjs";

const DELAI = 20_000;
const GITHUB = "https://api.github.com";
const CLOUDFLARE = "https://api.cloudflare.com/client/v4";
const ALPHABET_CODE = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export const FORMATS = {
  "client-google": /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/,
  "id-cle-apple": /^[A-Z0-9]{10}$/,
  "jeton-github-fin": /^github_pat_[A-Za-z0-9_]+$/,
  "e-mail": /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,24}$/i,
};

// Sources : commun (dossier Commun du coffre), saisie (dossier de l'app),
// genere (créé par le kit), keystore (clé Android créée ou reprise), fixe,
// url-worker (adresse workers.dev du Worker).
const HEYWATCHLIST = {
  id: "heywatchlist",
  nom: "HeyWatchlist",
  dossier: "HeyWatchlist",
  depot: "Shweepsi/hey-torrent-native",
  worker: "heywatchlist-api",
  bundle: "io.github.shweepsi.heywatchlist",
  aliasAndroid: "heywatchlist",
  // Plantages : export BigQuery de Crashlytics du projet Firebase. Les tables
  // portent le nom du paquet, points changés en « _ » (app publique et admin).
  crashlytics: { projet: "heywatchlist-60448", tables: "io_github_shweepsi_heywatchlist" },
  // Sauvegarde laissée sur le PC par les anciens scripts PowerShell.
  ancien: {
    dossier: "HeyWatchlist-secrets",
    fichierCles: "mots-de-passe.txt",
    cles: ["ANDROID_KEYSTORE_PASSWORD", "MATCH_PASSWORD", "CREDENTIALS_KEY", "BOOTSTRAP_CODE"],
    keystore: "heywatchlist-release.jks",
  },
  elements: [
    // CI : déploiement du Worker
    { nom: "CLOUDFLARE_API_TOKEN", vers: ["secret"], source: { type: "commun" } },
    { nom: "CLOUDFLARE_ACCOUNT_ID", vers: ["variable"], source: { type: "commun" } },
    { nom: "HEYWATCHLIST_API_URL", vers: ["variable"], source: { type: "url-worker" } },
    // CI : TestFlight
    { nom: "ASC_KEY_ID", vers: ["secret"], source: { type: "commun" } },
    { nom: "ASC_ISSUER_ID", vers: ["secret"], source: { type: "commun" } },
    { nom: "ASC_KEY_P8", vers: ["secret"], source: { type: "commun", texte: true } },
    { nom: "APPLE_TEAM_ID", vers: ["variable", "worker"], source: { type: "commun" } },
    { nom: "MATCH_GIT_URL", vers: ["variable"], source: { type: "fixe", valeur: "https://github.com/Shweepsi/heywatchlist-certificates.git" } },
    { nom: "MATCH_GIT_TOKEN", vers: ["secret"], source: { type: "saisie", format: "jeton-github-fin" } },
    { nom: "MATCH_PASSWORD", vers: ["secret"], source: { type: "genere", genre: "phrase", conserver: true } },
    // CI : APK signés
    { nom: "ANDROID_KEYSTORE_BASE64", vers: ["secret"], source: { type: "keystore", cle: "ANDROID_KEYSTORE" } },
    { nom: "ANDROID_KEYSTORE_PASSWORD", vers: ["secret"], source: { type: "keystore", cle: "ANDROID_KEYSTORE_PASSWORD" } },
    { nom: "ANDROID_KEY_ALIAS", vers: ["secret"], source: { type: "fixe", valeur: "heywatchlist" } },
    { nom: "ANDROID_KEY_PASSWORD", vers: ["secret"], source: { type: "keystore", cle: "ANDROID_KEYSTORE_PASSWORD" } },
    { nom: "GOOGLE_SERVICES_JSON", vers: ["secret"], source: { type: "saisie", fichier: "google-services" } },
    // CI : envoi de l'AAB public sur le test fermé Google Play
    { nom: "PLAY_SERVICE_ACCOUNT_JSON", vers: ["secret"], source: { type: "saisie", fichier: "compte-service" } },
    // CI : APK admin privé par Firebase App Distribution (le dépôt est public).
    // Les testeurs sont un secret : leur e-mail ne doit pas finir dans un journal public.
    { nom: "FIREBASE_DISTRIBUTION_KEY", vers: ["secret"], source: { type: "saisie", fichier: "compte-service" } },
    { nom: "FIREBASE_TESTERS", vers: ["secret"], source: { type: "saisie", format: "e-mail" } },
    // Worker
    { nom: "SESSION_SIGNING_KEY", vers: ["worker"], source: { type: "genere", genre: "cle32" } },
    { nom: "CREDENTIALS_KEY", vers: ["worker"], source: { type: "genere", genre: "cle32", conserver: true } },
    { nom: "BOOTSTRAP_CODE", vers: ["worker"], source: { type: "genere", genre: "code-admin" }, afficher: true },
    { nom: "TMDB_API_KEY", vers: ["worker"], source: { type: "commun" } },
    { nom: "FCM_SERVICE_ACCOUNT", vers: ["worker"], source: { type: "commun", nom: "FIREBASE_SERVICE_ACCOUNT", texte: true } },
    { nom: "GOOGLE_WEB_CLIENT_ID", vers: ["worker"], source: { type: "saisie", format: "client-google" } },
    { nom: "GOOGLE_IOS_CLIENT_ID", vers: ["worker"], source: { type: "saisie", format: "client-google" } },
    { nom: "APPLE_SIGNIN_KEY_ID", vers: ["worker"], source: { type: "saisie", format: "id-cle-apple" } },
    { nom: "APPLE_SIGNIN_PRIVATE_KEY", vers: ["worker"], source: { type: "saisie", fichier: "p8", cleId: "APPLE_SIGNIN_KEY_ID" } },
    { nom: "APNS_KEY_ID", vers: ["worker"], source: { type: "saisie", format: "id-cle-apple" } },
    { nom: "APNS_PRIVATE_KEY", vers: ["worker"], source: { type: "saisie", fichier: "p8", cleId: "APNS_KEY_ID" } },
    // Contact affiché par la politique de confidentialité du Worker.
    { nom: "PRIVACY_CONTACT", vers: ["worker"], source: { type: "saisie", format: "e-mail" } },
  ],
};

export const APPS = Object.freeze([HEYWATCHLIST]);
export const app = (id) => APPS.find((item) => item.id === id) ?? null;

function exigerApp(id) {
  const definition = app(id);
  if (!definition) throw new ErreurCoffre("requete-invalide");
  return definition;
}

function exigerElement(definition, nom) {
  const element = definition.elements.find((item) => item.nom === nom);
  if (!element) throw new ErreurCoffre("requete-invalide");
  return element;
}

const decoder = (base64) => Buffer.from(base64, "base64").toString("utf8");

// --- Appels réseau -------------------------------------------------------------

async function appeler(fetchFn, url, options = {}) {
  try {
    const reponse = await fetchFn(url, { redirect: "manual", signal: AbortSignal.timeout(DELAI), ...options });
    const corps = await reponse.json().catch(() => null);
    return { statut: reponse.status, ok: reponse.ok, corps };
  } catch {
    return { statut: 0, ok: false, corps: null };
  }
}

function probleme(statut) {
  if (statut === 401) return "refuse";
  if (statut === 403) return "interdit";
  if (statut === 404) return "introuvable";
  return "injoignable";
}

const entetesGithub = (jeton) => ({
  Authorization: `Bearer ${jeton}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "hey-kit",
});

// Noms des secrets et variables (avec leur valeur, publique) du dépôt.
async function lireGithub(definition, jeton, fetchFn) {
  const base = `${GITHUB}/repos/${definition.depot}/actions`;
  const secrets = await appeler(fetchFn, `${base}/secrets?per_page=100`, { headers: entetesGithub(jeton) });
  if (!secrets.ok || !Array.isArray(secrets.corps?.secrets)) return { etat: probleme(secrets.statut) };
  const variables = new Map();
  for (let page = 1; page <= 5; page += 1) {
    const reponse = await appeler(fetchFn, `${base}/variables?per_page=30&page=${page}`, { headers: entetesGithub(jeton) });
    if (!reponse.ok || !Array.isArray(reponse.corps?.variables)) return { etat: probleme(reponse.statut) };
    for (const variable of reponse.corps.variables) {
      if (typeof variable?.name === "string") variables.set(variable.name, String(variable.value ?? ""));
    }
    if (reponse.corps.variables.length < 30) break;
  }
  const noms = new Set(secrets.corps.secrets.map((secret) => secret?.name).filter((nom) => typeof nom === "string"));
  return { etat: "ok", secrets: noms, variables };
}

async function ecrireVariable(definition, jeton, nom, valeur, existe, fetchFn) {
  const base = `${GITHUB}/repos/${definition.depot}/actions/variables`;
  const reponse = existe
    ? await appeler(fetchFn, `${base}/${nom}`, {
        method: "PATCH",
        headers: { ...entetesGithub(jeton), "Content-Type": "application/json" },
        body: JSON.stringify({ name: nom, value: valeur }),
      })
    : await appeler(fetchFn, base, {
        method: "POST",
        headers: { ...entetesGithub(jeton), "Content-Type": "application/json" },
        body: JSON.stringify({ name: nom, value: valeur }),
      });
  return reponse.ok ? "ok" : probleme(reponse.statut);
}

async function ecrireSecretGithub(definition, jeton, nom, valeur, outils) {
  const gh = await outils.gh();
  if (!gh) return "gh-absent";
  const resultat = await outils.executer(gh, ["secret", "set", nom, "--repo", definition.depot], {
    entree: valeur,
    env: { GH_TOKEN: jeton, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" },
  });
  if (resultat.code === 0) return "ok";
  // On ne garde de la réponse de gh que le type d'échec, jamais le texte.
  if (/HTTP 401|Bad credentials/i.test(resultat.erreur)) return "refuse";
  if (/HTTP 403/i.test(resultat.erreur)) return "interdit";
  if (/HTTP 404/i.test(resultat.erreur)) return "introuvable";
  return "echec";
}

const entetesCloudflare = (jeton) => ({ Authorization: `Bearer ${jeton}` });

async function lireWorker(definition, { jeton, compte }, fetchFn) {
  const base = `${CLOUDFLARE}/accounts/${compte}/workers`;
  const secrets = await appeler(fetchFn, `${base}/scripts/${definition.worker}/secrets`, { headers: entetesCloudflare(jeton) });
  if (!secrets.ok || !Array.isArray(secrets.corps?.result)) return { etat: probleme(secrets.statut) };
  const sousDomaine = await appeler(fetchFn, `${base}/subdomain`, { headers: entetesCloudflare(jeton) });
  const nom = sousDomaine.corps?.result?.subdomain;
  return {
    etat: "ok",
    secrets: new Set(secrets.corps.result.map((secret) => secret?.name).filter((n) => typeof n === "string")),
    url: typeof nom === "string" && /^[a-z0-9-]+$/.test(nom) ? `https://${definition.worker}.${nom}.workers.dev` : null,
  };
}

async function ecrireSecretWorker(definition, { jeton, compte }, nom, valeur, fetchFn) {
  const reponse = await appeler(fetchFn, `${CLOUDFLARE}/accounts/${compte}/workers/scripts/${definition.worker}/secrets`, {
    method: "PUT",
    headers: { ...entetesCloudflare(jeton), "Content-Type": "application/json" },
    body: JSON.stringify({ name: nom, text: valeur, type: "secret_text" }),
  });
  return reponse.ok && reponse.corps?.success !== false ? "ok" : probleme(reponse.statut);
}

// --- Valeurs locales -------------------------------------------------------------

function valeurCommune(coffre, nom) {
  return coffre.lire(DOSSIER_COMMUN, nom)?.valeur ?? null;
}

// Valeur à envoyer pour un élément, ou null si le coffre ne l'a pas.
function valeurLocale(coffre, definition, element, distant) {
  const source = element.source;
  switch (source.type) {
    case "commun": {
      const valeur = valeurCommune(coffre, source.nom ?? element.nom);
      return valeur === null ? null : source.texte ? decoder(valeur) : valeur;
    }
    case "fixe":
      return source.valeur;
    case "url-worker":
      return distant.worker?.url ?? null;
    case "keystore":
      return coffre.lire(definition.dossier, source.cle)?.valeur ?? null;
    default: {
      const entree = coffre.lire(definition.dossier, element.nom);
      if (!entree) return null;
      return source.fichier === "p8" ? decoder(entree.valeur) : entree.valeur;
    }
  }
}

// Présence de l'élément à une destination : true, false, ou null (inconnu).
function presentA(destination, element, distant, valeur) {
  if (destination === "worker") return distant.worker?.etat === "ok" ? distant.worker.secrets.has(element.nom) : null;
  if (distant.github?.etat !== "ok") return null;
  if (destination === "secret") return distant.github.secrets.has(element.nom);
  // Variable : publique, on compare aussi la valeur.
  if (!distant.github.variables.has(element.nom)) return false;
  return valeur === null || distant.github.variables.get(element.nom) === valeur;
}

async function lireDistant(coffre, definition, fetchFn) {
  const distant = {};
  const jetonGithub = valeurCommune(coffre, "GITHUB_TOKEN");
  distant.github = jetonGithub ? await lireGithub(definition, jetonGithub, fetchFn) : { etat: "incomplet" };
  const cloudflare = { jeton: valeurCommune(coffre, "CLOUDFLARE_API_TOKEN"), compte: valeurCommune(coffre, "CLOUDFLARE_ACCOUNT_ID") };
  distant.worker = cloudflare.jeton && cloudflare.compte ? await lireWorker(definition, cloudflare, fetchFn) : { etat: "incomplet" };
  return { distant, jetonGithub, cloudflare };
}

function etatElements(coffre, definition, distant) {
  return definition.elements.map((element) => {
    const valeur = valeurLocale(coffre, definition, element, distant);
    const destinations = element.vers.map((type) => ({ type, present: presentA(type, element, distant, valeur) }));
    let etat;
    if (destinations.some((d) => d.present === null)) etat = "inconnu";
    else if (destinations.every((d) => d.present)) etat = "en-place";
    else if (valeur !== null || element.source.type === "genere") etat = "a-envoyer";
    else etat = "a-fournir";
    return {
      nom: element.nom,
      source: element.source.type,
      ...(element.source.nom ? { depuis: element.source.nom } : {}),
      ...(element.source.fichier ? { fichier: element.source.fichier } : {}),
      ...(element.source.format ? { format: element.source.format } : {}),
      conserver: Boolean(element.source.conserver || element.source.type === "keystore"),
      afficher: Boolean(element.afficher),
      local: valeur !== null,
      destinations,
      etat,
    };
  });
}

const resumeDistant = (distant) => ({
  github: distant.github.etat,
  worker: distant.worker.etat,
  url: distant.worker.url ?? null,
});

// État d'une app : chaque élément, et l'accès à GitHub et au Worker.
export async function etatApp(coffre, id, { fetchFn = fetch } = {}) {
  const definition = exigerApp(id);
  if (!coffre.ouvert) throw new ErreurCoffre("verrouille");
  const { distant } = await lireDistant(coffre, definition, fetchFn);
  return {
    id: definition.id,
    nom: definition.nom,
    depot: definition.depot,
    worker: definition.worker,
    bundle: definition.bundle,
    acces: resumeDistant(distant),
    elements: etatElements(coffre, definition, distant),
    keystore: coffre.present(definition.dossier, "ANDROID_KEYSTORE"),
  };
}

// --- Saisie ----------------------------------------------------------------------

function verifierP8(base64) {
  try {
    return createPrivateKey(decoder(base64)).asymmetricKeyType === "ec";
  } catch {
    return false;
  }
}

function verifierGoogleServices(base64, bundle) {
  try {
    const contenu = JSON.parse(decoder(base64));
    const paquets = (contenu?.client ?? []).map((client) => client?.client_info?.android_client_info?.package_name);
    return typeof contenu?.project_info?.project_id === "string" && paquets.includes(bundle);
  } catch {
    return false;
  }
}

// Clé JSON d'un compte de service Google : la clé privée doit être lisible.
function verifierCompteService(base64) {
  try {
    const contenu = JSON.parse(decoder(base64));
    return (
      contenu?.type === "service_account" &&
      typeof contenu.client_email === "string" &&
      createPrivateKey(String(contenu.private_key)).asymmetricKeyType === "rsa"
    );
  } catch {
    return false;
  }
}

const VERIFIER_FICHIER = {
  p8: (valeur) => verifierP8(valeur),
  "google-services": (valeur, definition) => verifierGoogleServices(valeur, definition.bundle),
  "compte-service": (valeur) => verifierCompteService(valeur),
};

// Enregistre une valeur saisie dans le dossier de l'app. Pour une clé Apple,
// l'identifiant est lu dans le nom du fichier AuthKey_XXXXXXXXXX.p8.
export async function saisir(coffre, id, nom, { valeur, nomFichier }) {
  const definition = exigerApp(id);
  const element = exigerElement(definition, nom);
  const source = element.source;
  if (source.type !== "saisie" || typeof valeur !== "string" || valeur === "") throw new ErreurCoffre("requete-invalide");
  if (source.fichier) {
    const valide = VERIFIER_FICHIER[source.fichier](valeur, definition);
    if (!valide) return { etat: "invalide" };
    await coffre.ecrire(definition.dossier, nom, { type: "fichier", valeur, nomFichier: nomFichier ?? null });
    const idCle = /^AuthKey_([A-Z0-9]{10})\.p8$/.exec(String(nomFichier ?? ""))?.[1];
    if (source.cleId && idCle) await coffre.ecrire(definition.dossier, source.cleId, { type: "texte", valeur: idCle });
    return { etat: "ok", ...(source.cleId && idCle ? { aussi: source.cleId } : {}) };
  }
  const texte = valeur.trim();
  if (!FORMATS[source.format].test(texte)) return { etat: "invalide" };
  await coffre.ecrire(definition.dossier, nom, { type: "texte", valeur: texte });
  return { etat: "ok" };
}

// --- Génération ------------------------------------------------------------------

function nouvelleValeur(genre) {
  if (genre === "cle32") return randomBytes(32).toString("base64");
  if (genre === "phrase") return randomBytes(24).toString("base64url");
  const groupe = () => Array.from({ length: 4 }, () => ALPHABET_CODE[randomInt(ALPHABET_CODE.length)]).join("");
  return `${groupe()}-${groupe()}-${groupe()}`;
}

// keytool traduit ses messages selon la langue de Windows (« SHA1 : » en
// français) : on le fait parler anglais pour lire sa réponse.
const KEYTOOL_ANGLAIS = ["-J-Duser.language=en", "-J-Duser.country=US"];

// Échec de keytool : cause reconnue, sinon sa première ligne d'erreur (jamais
// de secret : keytool ne répète ni le mot de passe ni la clé).
function echecKeytool(resultat) {
  const texte = `${resultat.erreur}\n${resultat.sortie}`;
  if (/password was incorrect|Keystore was tampered/i.test(texte)) return new ErreurCoffre("keystore-mot-de-passe");
  if (/Alias <[^>]*> does not exist/i.test(texte)) return new ErreurCoffre("keystore-alias");
  const erreur = new ErreurCoffre("keytool-echec");
  const ligne = texte
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /error|exception/i.test(l));
  if (ligne) erreur.detail = ligne.replace(/[^\x20-\x7E]/g, "").slice(0, 200);
  return erreur;
}

// Crée la clé de signature Android avec keytool, dans un dossier temporaire
// effacé ensuite, et la range dans le coffre avec sa phrase secrète.
async function creerKeystore(coffre, definition, outils) {
  const keytool = await outils.keytool();
  if (!keytool) throw new ErreurCoffre("keytool-absent");
  const motDePasse = randomBytes(24).toString("base64url");
  const temporaire = await fs.mkdtemp(path.join(os.tmpdir(), "hey-kit-"));
  try {
    // Nom relatif en ASCII : Java lit sa ligne de commande dans la page de code de Windows.
    const resultat = await outils.executer(
      keytool,
      [
        ...KEYTOOL_ANGLAIS,
        "-genkeypair",
        "-keystore",
        "cle.jks",
        "-storetype",
        "PKCS12",
        "-alias",
        definition.aliasAndroid,
        "-keyalg",
        "RSA",
        "-keysize",
        "2048",
        "-validity",
        "10000",
        "-dname",
        `CN=${definition.nom}, O=${definition.nom}, C=FR`,
        "-storepass:env",
        "HEY_KIT_MDP",
        "-keypass:env",
        "HEY_KIT_MDP",
      ],
      { cwd: temporaire, env: { HEY_KIT_MDP: motDePasse } },
    );
    const contenu = resultat.code === 0 ? await fs.readFile(path.join(temporaire, "cle.jks")).catch(() => null) : null;
    if (!contenu || contenu.length === 0) throw echecKeytool(resultat);
    await coffre.ecrire(definition.dossier, "ANDROID_KEYSTORE_PASSWORD", { type: "texte", valeur: motDePasse });
    await coffre.ecrire(definition.dossier, "ANDROID_KEYSTORE", {
      type: "fichier",
      valeur: contenu.toString("base64"),
      nomFichier: `${definition.id}-release.jks`,
    });
  } finally {
    await fs.rm(temporaire, { recursive: true, force: true });
  }
}

const elementsKeystore = (definition) => definition.elements.filter((e) => e.source.type === "keystore");

// --- Envoi -----------------------------------------------------------------------

// Envoie ce qui manque. `remplacer` liste les éléments à renvoyer même s'ils
// sont en place (ignoré pour les valeurs conservées). Génère au passage les
// valeurs à créer, et la clé Android si elle n'existe nulle part.
export async function envoyerApp(coffre, id, { fetchFn = fetch, outils, remplacer = [] } = {}) {
  const definition = exigerApp(id);
  if (!coffre.ouvert) throw new ErreurCoffre("verrouille");
  const { distant, jetonGithub, cloudflare } = await lireDistant(coffre, definition, fetchFn);
  const aRemplacer = new Set(Array.isArray(remplacer) ? remplacer : []);
  const resultats = [];

  // Clé Android : créée seulement si aucun de ses éléments n'est déjà sur GitHub.
  const keystore = elementsKeystore(definition);
  if (
    distant.github.etat === "ok" &&
    !coffre.present(definition.dossier, "ANDROID_KEYSTORE") &&
    keystore.every((element) => !distant.github.secrets.has(element.nom))
  ) {
    try {
      await creerKeystore(coffre, definition, outils);
      resultats.push({ nom: "ANDROID_KEYSTORE", destination: "coffre", resultat: "genere" });
    } catch (erreur) {
      resultats.push({
        nom: "ANDROID_KEYSTORE",
        destination: "coffre",
        resultat: erreur.code ?? "echec",
        ...(erreur.detail ? { detail: erreur.detail } : {}),
      });
    }
  }

  for (const element of definition.elements) {
    const conserver = element.source.conserver || element.source.type === "keystore";
    let valeur = valeurLocale(coffre, definition, element, distant);
    for (const destination of element.vers) {
      const present = presentA(destination, element, distant, valeur);
      if (present === null) continue;
      if (present && (conserver || !aRemplacer.has(element.nom))) continue;
      if (valeur === null && element.source.type === "genere") {
        valeur = nouvelleValeur(element.source.genre);
        // Rangée avant l'envoi : une coupure entre les deux ne la perd pas.
        await coffre.ecrire(definition.dossier, element.nom, { type: "texte", valeur });
        resultats.push({ nom: element.nom, destination: "coffre", resultat: "genere" });
      }
      if (valeur === null) continue;
      let resultat;
      if (destination === "worker") resultat = await ecrireSecretWorker(definition, cloudflare, element.nom, valeur, fetchFn);
      else if (destination === "secret") resultat = await ecrireSecretGithub(definition, jetonGithub, element.nom, valeur, outils);
      else resultat = await ecrireVariable(definition, jetonGithub, element.nom, valeur, distant.github.variables.has(element.nom), fetchFn);
      resultats.push({ nom: element.nom, destination, resultat });
    }
  }
  return { acces: resumeDistant(distant), resultats };
}

// --- Reprise de l'ancienne sauvegarde -----------------------------------------------

// Reprend dans le coffre ce que les anciens scripts ont laissé dans
// ~/<dossier>/ : phrases secrètes et keystore. Ne remplace rien.
export async function importerAncien(coffre, id, { accueil = os.homedir() } = {}) {
  const definition = exigerApp(id);
  if (!coffre.ouvert) throw new ErreurCoffre("verrouille");
  const ancien = definition.ancien;
  if (!ancien) throw new ErreurCoffre("requete-invalide");
  const dossier = path.join(accueil, ancien.dossier);
  const repris = [];
  const texte = await fs.readFile(path.join(dossier, ancien.fichierCles), "utf8").catch(() => null);
  const keystore = await fs.readFile(path.join(dossier, ancien.keystore)).catch(() => null);
  if (texte === null && keystore === null) return { trouve: false, repris };
  const valeurs = {};
  for (const ligne of (texte ?? "").split(/\r?\n/)) {
    const morceaux = /^([A-Z_]+)=(.+)$/.exec(ligne.trim());
    if (morceaux) valeurs[morceaux[1]] = morceaux[2];
  }
  for (const nom of ancien.cles) {
    if (!valeurs[nom] || coffre.present(definition.dossier, nom)) continue;
    await coffre.ecrire(definition.dossier, nom, { type: "texte", valeur: valeurs[nom] });
    repris.push(nom);
  }
  if (keystore && keystore.length > 0 && !coffre.present(definition.dossier, "ANDROID_KEYSTORE")) {
    await coffre.ecrire(definition.dossier, "ANDROID_KEYSTORE", {
      type: "fichier",
      valeur: keystore.toString("base64"),
      nomFichier: ancien.keystore,
    });
    repris.push("ANDROID_KEYSTORE");
  }
  return { trouve: true, dossier, repris };
}

// --- Lecture pour la personne -------------------------------------------------------

// Seules les valeurs marquées `afficher` (code administrateur) sont lisibles.
export function afficher(coffre, id, nom) {
  const definition = exigerApp(id);
  const element = exigerElement(definition, nom);
  if (!element.afficher) throw new ErreurCoffre("requete-invalide");
  if (!coffre.ouvert) throw new ErreurCoffre("verrouille");
  return { valeur: coffre.lire(definition.dossier, nom)?.valeur ?? null };
}

// Empreinte SHA-1 du certificat Android (publique), à donner à Google.
export async function empreinteAndroid(coffre, id, { outils }) {
  const definition = exigerApp(id);
  if (!coffre.ouvert) throw new ErreurCoffre("verrouille");
  const keystore = coffre.lire(definition.dossier, "ANDROID_KEYSTORE");
  const motDePasse = coffre.lire(definition.dossier, "ANDROID_KEYSTORE_PASSWORD");
  if (!keystore || !motDePasse) throw new ErreurCoffre("keystore-absent");
  const keytool = await outils.keytool();
  if (!keytool) throw new ErreurCoffre("keytool-absent");
  const temporaire = await fs.mkdtemp(path.join(os.tmpdir(), "hey-kit-"));
  try {
    await fs.writeFile(path.join(temporaire, "cle.jks"), Buffer.from(keystore.valeur, "base64"), { mode: 0o600 });
    const resultat = await outils.executer(
      keytool,
      [...KEYTOOL_ANGLAIS, "-list", "-v", "-keystore", "cle.jks", "-alias", definition.aliasAndroid, "-storepass:env", "HEY_KIT_MDP"],
      { cwd: temporaire, env: { HEY_KIT_MDP: motDePasse.valeur } },
    );
    const sha1 = /SHA-?\s?1\s*:\s*([0-9A-F]{2}(?::[0-9A-F]{2}){19})/i.exec(resultat.sortie)?.[1];
    if (resultat.code !== 0 || !sha1) throw echecKeytool(resultat);
    return { sha1 };
  } finally {
    await fs.rm(temporaire, { recursive: true, force: true });
  }
}
