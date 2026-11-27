// Comptes communs à toutes les apps, rangés dans le dossier « Commun » du
// coffre, et leur vérification en lecture seule auprès de chaque service.
//
// Chaque vérification renvoie un état typé, que l'interface traduit :
//   ok, incomplet (un champ manque), invalide (format faux), refuse (le service
//   ne reconnaît pas la clé), interdit (clé reconnue mais droits insuffisants),
//   injoignable (réseau, proxy, antivirus…).
// Aucune valeur n'est renvoyée ni journalisée : seulement l'état et quelques
// informations publiques (nom du compte, projet).
import { createPrivateKey, sign } from "node:crypto";

export const DOSSIER_COMMUN = "Commun";
const DELAI = 20_000;

// Champs de chaque connexion. Le libellé et l'aide sont dans l'interface.
export const CONNEXIONS = Object.freeze([
  { id: "github", champs: [{ nom: "GITHUB_TOKEN", type: "secret" }] },
  {
    id: "cloudflare",
    champs: [
      { nom: "CLOUDFLARE_API_TOKEN", type: "secret" },
      { nom: "CLOUDFLARE_ACCOUNT_ID", type: "texte" },
    ],
  },
  {
    id: "apple",
    champs: [
      // Dans l'ordre du guide : Issuer ID, Key ID, fichier .p8, Team ID.
      { nom: "ASC_ISSUER_ID", type: "texte" },
      { nom: "ASC_KEY_ID", type: "texte" },
      { nom: "ASC_KEY_P8", type: "fichier" },
      { nom: "APPLE_TEAM_ID", type: "texte" },
    ],
  },
  { id: "firebase", champs: [{ nom: "FIREBASE_SERVICE_ACCOUNT", type: "fichier" }] },
  { id: "tmdb", champs: [{ nom: "TMDB_API_KEY", type: "secret" }] },
]);

export const connexion = (id) => CONNEXIONS.find((item) => item.id === id) ?? null;

const FORMATS = {
  CLOUDFLARE_ACCOUNT_ID: /^[0-9a-f]{32}$/,
  ASC_KEY_ID: /^[A-Z0-9]{10}$/,
  ASC_ISSUER_ID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  APPLE_TEAM_ID: /^[A-Z0-9]{10}$/,
  // Clé d'API TMDB v3 (32 caractères hexadécimaux) ou jeton d'accès v4 (un JWT).
  TMDB_API_KEY: /^(?:[0-9a-fA-F]{32}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/,
};

// Vérifie le format d'un champ texte avant de l'enregistrer.
export function formatValide(nom, valeur) {
  const format = FORMATS[nom];
  return format ? format.test(valeur) : valeur.trim() !== "" && !/[\r\n]/.test(valeur);
}

const base64url = (valeur) => Buffer.from(valeur).toString("base64url");

// JWT signé en ES256 (Apple) ou RS256 (Google) : les deux hachent en SHA-256.
function jwt(entete, contenu, cle) {
  const signe = `${base64url(JSON.stringify(entete))}.${base64url(JSON.stringify(contenu))}`;
  const options = entete.alg === "ES256" ? { key: cle, dsaEncoding: "ieee-p1363" } : cle;
  const signature = sign("sha256", Buffer.from(signe), options);
  return `${signe}.${signature.toString("base64url")}`;
}

async function appeler(fetchFn, url, options = {}) {
  const reponse = await fetchFn(url, { redirect: "manual", signal: AbortSignal.timeout(DELAI), ...options });
  const corps = await reponse.json().catch(() => null);
  return { statut: reponse.status, ok: reponse.ok, corps };
}

function selonStatut(statut) {
  if (statut === 401) return { etat: "refuse" };
  if (statut === 403) return { etat: "interdit" };
  return { etat: "injoignable" };
}

async function verifierGithub({ GITHUB_TOKEN }, fetchFn) {
  const reponse = await appeler(fetchFn, "https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "hey-kit",
    },
  });
  if (reponse.ok && typeof reponse.corps?.login === "string") return { etat: "ok", compte: reponse.corps.login };
  return selonStatut(reponse.statut);
}

// Un jeton Cloudflare est soit lié à l'utilisateur, soit au compte : on essaie
// les deux routes de vérification.
async function verifierCloudflare({ CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID }, fetchFn) {
  const entetes = { headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } };
  const routes = [
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/tokens/verify`,
    "https://api.cloudflare.com/client/v4/user/tokens/verify",
  ];
  let dernier = null;
  for (const route of routes) {
    const reponse = await appeler(fetchFn, route, entetes);
    if (reponse.ok && reponse.corps?.success === true) {
      return reponse.corps.result?.status === "active" ? { etat: "ok" } : { etat: "refuse" };
    }
    dernier = reponse;
  }
  if (dernier && [400, 401, 403, 404].includes(dernier.statut)) return { etat: "refuse" };
  return { etat: "injoignable" };
}

async function verifierApple({ ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 }, fetchFn) {
  let cle;
  try {
    cle = createPrivateKey(Buffer.from(ASC_KEY_P8, "base64").toString("utf8"));
  } catch {
    return { etat: "invalide", champ: "ASC_KEY_P8" };
  }
  if (cle.asymmetricKeyType !== "ec") return { etat: "invalide", champ: "ASC_KEY_P8" };
  const maintenant = Math.floor(Date.now() / 1000);
  // iat un peu dans le passé : une horloge en avance ferait refuser une clé valide.
  const jeton = jwt(
    { alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" },
    { iss: ASC_ISSUER_ID, iat: maintenant - 60, exp: maintenant + 600, aud: "appstoreconnect-v1" },
    cle,
  );
  const reponse = await appeler(fetchFn, "https://api.appstoreconnect.apple.com/v1/apps?limit=1", {
    headers: { Authorization: `Bearer ${jeton}` },
  });
  if (reponse.ok) return { etat: "ok" };
  return selonStatut(reponse.statut);
}

const JETON_GOOGLE = "https://oauth2.googleapis.com/token";

// Lit le compte de service Google rangé dans le coffre (base64 du JSON).
// Rend null s'il est illisible ou s'il enverrait la signature ailleurs que chez Google.
export function lireCompteGoogle(base64) {
  try {
    const compte = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
    const cle = createPrivateKey(compte.private_key);
    if (compte?.type !== "service_account" || typeof compte.client_email !== "string" || compte.token_uri !== JETON_GOOGLE) {
      return null;
    }
    return { compte, cle };
  } catch {
    return null;
  }
}

// Échange une assertion signée contre un jeton d'accès Google limité à `scope`.
// Rend { jeton } ou { statut } en cas de refus.
export async function jetonGoogle({ compte, cle }, scope, fetchFn) {
  const maintenant = Math.floor(Date.now() / 1000);
  const assertion = jwt(
    { alg: "RS256", typ: "JWT" },
    { iss: compte.client_email, scope, aud: JETON_GOOGLE, iat: maintenant - 60, exp: maintenant + 600 },
    cle,
  );
  const reponse = await appeler(fetchFn, JETON_GOOGLE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  if (reponse.ok && typeof reponse.corps?.access_token === "string") return { jeton: reponse.corps.access_token };
  return { statut: reponse.statut };
}

async function verifierFirebase({ FIREBASE_SERVICE_ACCOUNT }, fetchFn) {
  const lu = lireCompteGoogle(FIREBASE_SERVICE_ACCOUNT);
  if (!lu) return { etat: "invalide", champ: "FIREBASE_SERVICE_ACCOUNT" };
  const { jeton, statut } = await jetonGoogle(lu, "https://www.googleapis.com/auth/firebase.messaging", fetchFn);
  if (jeton) return { etat: "ok", compte: typeof lu.compte.project_id === "string" ? lu.compte.project_id : null };
  if (statut === 400 || statut === 401) return { etat: "refuse" };
  return selonStatut(statut);
}

async function verifierTmdb({ TMDB_API_KEY }, fetchFn) {
  const v4 = TMDB_API_KEY.startsWith("eyJ");
  const url = v4
    ? "https://api.themoviedb.org/3/configuration"
    : `https://api.themoviedb.org/3/configuration?${new URLSearchParams({ api_key: TMDB_API_KEY })}`;
  const reponse = await appeler(fetchFn, url, v4 ? { headers: { Authorization: `Bearer ${TMDB_API_KEY}` } } : {});
  if (reponse.ok) return { etat: "ok" };
  return selonStatut(reponse.statut);
}

const VERIFICATIONS = {
  github: verifierGithub,
  cloudflare: verifierCloudflare,
  apple: verifierApple,
  firebase: verifierFirebase,
  tmdb: verifierTmdb,
};

// Lit les champs dans le coffre ouvert et vérifie la connexion.
export async function verifier(coffre, id, { fetchFn = fetch } = {}) {
  const definition = connexion(id);
  if (!definition) return { etat: "inconnue" };
  const valeurs = {};
  for (const champ of definition.champs) {
    const entree = coffre.lire(DOSSIER_COMMUN, champ.nom);
    if (!entree) return { etat: "incomplet", champ: champ.nom };
    if (champ.type !== "fichier" && !formatValide(champ.nom, entree.valeur)) return { etat: "invalide", champ: champ.nom };
    valeurs[champ.nom] = entree.valeur;
  }
  try {
    return await VERIFICATIONS[id](valeurs, fetchFn);
  } catch {
    return { etat: "injoignable" };
  }
}
