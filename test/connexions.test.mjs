// Vérifications des connexions avec des réponses simulées : aucun vrai service
// n'est appelé.
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Coffre } from "../src/coffre.mjs";
import { formatValide, verifier } from "../src/connexions.mjs";

const KDF = { N: 2 ** 10, r: 8, p: 1 };

async function coffreAvec(valeurs) {
  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), "hey-kit-"));
  const coffre = new Coffre(path.join(dossier, "coffre.hey-kit"), { kdf: KDF });
  await coffre.creer("mot de passe de test");
  for (const [nom, valeur] of Object.entries(valeurs)) {
    const fichier = typeof valeur === "object";
    await coffre.ecrire("Commun", nom, fichier ? { type: "fichier", valeur: valeur.base64 } : { valeur });
  }
  return coffre;
}

const fichier = (texte) => ({ base64: Buffer.from(texte).toString("base64") });

// Faux fetch : enregistre les appels et répond selon `repondre(url, options)`.
function fauxFetch(repondre) {
  const appels = [];
  const fn = async (url, options = {}) => {
    appels.push({ url: String(url), options });
    const [statut, corps] = repondre(String(url), options);
    if (statut === "reseau") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(corps ?? {}), { status: statut, headers: { "Content-Type": "application/json" } });
  };
  fn.appels = appels;
  return fn;
}

const decoder = (jwt) => jwt.split(".").slice(0, 2).map((partie) => JSON.parse(Buffer.from(partie, "base64url").toString()));

test("GitHub : ok avec le nom du compte, refus sur 401, injoignable sur erreur réseau", async () => {
  const coffre = await coffreAvec({ GITHUB_TOKEN: "jeton-github" });
  const ok = fauxFetch(() => [200, { login: "exemple" }]);
  assert.deepEqual(await verifier(coffre, "github", { fetchFn: ok }), { etat: "ok", compte: "exemple" });
  assert.equal(ok.appels[0].url, "https://api.github.com/user");
  assert.equal(ok.appels[0].options.headers.Authorization, "Bearer jeton-github");
  assert.deepEqual(await verifier(coffre, "github", { fetchFn: fauxFetch(() => [401]) }), { etat: "refuse" });
  assert.deepEqual(await verifier(coffre, "github", { fetchFn: fauxFetch(() => ["reseau"]) }), { etat: "injoignable" });
  assert.deepEqual(await verifier(coffre, "github", { fetchFn: fauxFetch(() => [500]) }), { etat: "injoignable" });
});

test("connexion incomplète : aucun appel réseau", async () => {
  const coffre = await coffreAvec({});
  const fetchFn = fauxFetch(() => [200, {}]);
  assert.deepEqual(await verifier(coffre, "github", { fetchFn }), { etat: "incomplet", champ: "GITHUB_TOKEN" });
  assert.equal(fetchFn.appels.length, 0);
});

test("Cloudflare : jeton de compte puis jeton d'utilisateur", async () => {
  const compte = "0123456789abcdef0123456789abcdef";
  const coffre = await coffreAvec({ CLOUDFLARE_API_TOKEN: "jeton-cf", CLOUDFLARE_ACCOUNT_ID: compte });
  const utilisateur = fauxFetch((url) =>
    url.includes("/user/") ? [200, { success: true, result: { status: "active" } }] : [404, { success: false }],
  );
  assert.deepEqual(await verifier(coffre, "cloudflare", { fetchFn: utilisateur }), { etat: "ok" });
  assert.equal(utilisateur.appels[0].url, `https://api.cloudflare.com/client/v4/accounts/${compte}/tokens/verify`);
  assert.deepEqual(
    await verifier(coffre, "cloudflare", { fetchFn: fauxFetch(() => [200, { success: true, result: { status: "disabled" } }]) }),
    { etat: "refuse" },
  );
  assert.deepEqual(await verifier(coffre, "cloudflare", { fetchFn: fauxFetch(() => [401, { success: false }]) }), { etat: "refuse" });
});

test("Cloudflare : identifiant de compte mal formé refusé avant tout appel", async () => {
  const coffre = await coffreAvec({ CLOUDFLARE_API_TOKEN: "jeton-cf", CLOUDFLARE_ACCOUNT_ID: "pas-un-id" });
  const fetchFn = fauxFetch(() => [200, {}]);
  assert.deepEqual(await verifier(coffre, "cloudflare", { fetchFn }), { etat: "invalide", champ: "CLOUDFLARE_ACCOUNT_ID" });
  assert.equal(fetchFn.appels.length, 0);
});

test("Apple : jeton ES256 signé avec la clé .p8", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const coffre = await coffreAvec({
    ASC_KEY_ID: "ABCDE12345",
    ASC_ISSUER_ID: "12345678-1234-1234-1234-123456789abc",
    APPLE_TEAM_ID: "TEAM123456",
    ASC_KEY_P8: fichier(pem),
  });
  const fetchFn = fauxFetch(() => [200, { data: [] }]);
  assert.deepEqual(await verifier(coffre, "apple", { fetchFn }), { etat: "ok" });
  const jeton = fetchFn.appels[0].options.headers.Authorization.replace("Bearer ", "");
  const [entete, contenu] = decoder(jeton);
  assert.deepEqual(entete, { alg: "ES256", kid: "ABCDE12345", typ: "JWT" });
  assert.equal(contenu.iss, "12345678-1234-1234-1234-123456789abc");
  assert.equal(contenu.aud, "appstoreconnect-v1");
  assert.ok(contenu.exp - contenu.iat <= 20 * 60);
  const [h, c, s] = jeton.split(".");
  assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));
  assert.deepEqual(await verifier(coffre, "apple", { fetchFn: fauxFetch(() => [403]) }), { etat: "interdit" });
});

test("Apple : fichier .p8 illisible", async () => {
  const coffre = await coffreAvec({
    ASC_KEY_ID: "ABCDE12345",
    ASC_ISSUER_ID: "12345678-1234-1234-1234-123456789abc",
    APPLE_TEAM_ID: "TEAM123456",
    ASC_KEY_P8: fichier("pas une clé"),
  });
  assert.deepEqual(await verifier(coffre, "apple", { fetchFn: fauxFetch(() => [200]) }), { etat: "invalide", champ: "ASC_KEY_P8" });
});

test("Firebase : assertion RS256 envoyée uniquement à Google", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const compte = {
    type: "service_account",
    project_id: "projet-test",
    client_email: "admin@projet-test.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    token_uri: "https://oauth2.googleapis.com/token",
  };
  const coffre = await coffreAvec({ FIREBASE_SERVICE_ACCOUNT: fichier(JSON.stringify(compte)) });
  const fetchFn = fauxFetch(() => [200, { access_token: "x" }]);
  assert.deepEqual(await verifier(coffre, "firebase", { fetchFn }), { etat: "ok", compte: "projet-test" });
  assert.equal(fetchFn.appels[0].url, "https://oauth2.googleapis.com/token");
  const assertion = new URLSearchParams(fetchFn.appels[0].options.body).get("assertion");
  assert.equal(decoder(assertion)[0].alg, "RS256");
  assert.deepEqual(await verifier(coffre, "firebase", { fetchFn: fauxFetch(() => [400, { error: "invalid_grant" }]) }), {
    etat: "refuse",
  });

  const detourne = await coffreAvec({ FIREBASE_SERVICE_ACCOUNT: fichier(JSON.stringify({ ...compte, token_uri: "https://ailleurs.example/token" })) });
  const rien = fauxFetch(() => [200, {}]);
  assert.deepEqual(await verifier(detourne, "firebase", { fetchFn: rien }), { etat: "invalide", champ: "FIREBASE_SERVICE_ACCOUNT" });
  assert.equal(rien.appels.length, 0);
});

test("TMDB : clé v3 en paramètre, jeton v4 en en-tête", async () => {
  const v3 = await coffreAvec({ TMDB_API_KEY: "0123456789abcdef0123456789abcdef" });
  const fetchV3 = fauxFetch(() => [200, {}]);
  assert.deepEqual(await verifier(v3, "tmdb", { fetchFn: fetchV3 }), { etat: "ok" });
  assert.ok(fetchV3.appels[0].url.includes("api_key=0123456789abcdef0123456789abcdef"));

  const v4 = await coffreAvec({ TMDB_API_KEY: "eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.c2lnbmF0dXJl" });
  const fetchV4 = fauxFetch(() => [401, {}]);
  assert.deepEqual(await verifier(v4, "tmdb", { fetchFn: fetchV4 }), { etat: "refuse" });
  assert.equal(fetchV4.appels[0].options.headers.Authorization, "Bearer eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.c2lnbmF0dXJl");
});

test("formats", () => {
  assert.equal(formatValide("ASC_KEY_ID", "ABCDE12345"), true);
  assert.equal(formatValide("ASC_KEY_ID", "abc"), false);
  assert.equal(formatValide("GITHUB_TOKEN", "x\ny"), false);
  assert.equal(formatValide("GITHUB_TOKEN", "   "), false);
});

test("connexion inconnue", async () => {
  const coffre = await coffreAvec({});
  assert.deepEqual(await verifier(coffre, "autre"), { etat: "inconnue" });
});
