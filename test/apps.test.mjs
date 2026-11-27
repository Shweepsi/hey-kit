// « Mes apps » : GitHub et Cloudflare simulés, gh et keytool simulés.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { afficher, empreinteAndroid, envoyerApp, etatApp, importerAncien, saisir } from "../src/apps.mjs";
import { Coffre } from "../src/coffre.mjs";
import { creerOutils } from "../src/outils.mjs";

const DEPOT = "https://api.github.com/repos/Shweepsi/hey-torrent-native/actions";
const CF = "https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/workers";
const b64 = (texte) => Buffer.from(texte).toString("base64");
const p8 = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" });

let coffre;
let distant;
let appels;
let lancements;

// Faux GitHub et Cloudflare, avec l'état `distant`.
async function fetchFn(url, options = {}) {
  const methode = options.method ?? "GET";
  appels.push(`${methode} ${url}`);
  const json = (corps, status = 200) => new Response(JSON.stringify(corps), { status });
  if (url.startsWith(`${DEPOT}/secrets`)) return json({ secrets: [...distant.secrets].map((name) => ({ name })) });
  if (url.startsWith(`${DEPOT}/variables`) && methode === "GET") {
    return json({ variables: [...distant.variables].map(([name, value]) => ({ name, value })) });
  }
  if (url.startsWith(`${DEPOT}/variables`)) {
    const { name, value } = JSON.parse(options.body);
    distant.variables.set(name, value);
    return new Response(null, { status: methode === "POST" ? 201 : 204 });
  }
  if (url === `${CF}/scripts/heywatchlist-api/secrets` && methode === "GET") {
    if (distant.workerAbsent) return json({ success: false }, 404);
    return json({ success: true, result: [...distant.worker].map((name) => ({ name, type: "secret_text" })) });
  }
  if (url === `${CF}/scripts/heywatchlist-api/secrets` && methode === "PUT") {
    const { name, text } = JSON.parse(options.body);
    distant.worker.add(name);
    distant.valeursWorker.set(name, text);
    return json({ success: true, result: { name } });
  }
  if (url === `${CF}/subdomain`) return json({ success: true, result: { subdomain: "exemple" } });
  return json({}, 500);
}

// Faux gh et keytool : gh enregistre le secret, keytool écrit un faux keystore.
const outils = () =>
  creerOutils(async (commande, args, { entree, env, cwd } = {}) => {
    lancements.push({ commande, args, env });
    if (args[0] === "--version" || args[0] === "-help") return { code: commande.includes("absent") ? 1 : 0, sortie: "", erreur: "" };
    if (commande === "gh") {
      distant.secrets.add(args[2]);
      distant.valeursGithub.set(args[2], entree);
      return { code: 0, sortie: "", erreur: "" };
    }
    if (args.includes("-genkeypair")) {
      await fs.writeFile(path.join(cwd, "cle.jks"), "faux keystore");
      return { code: 0, sortie: "", erreur: "" };
    }
    if (args.includes("-list")) {
      const sha1 = Array.from({ length: 20 }, () => "AB").join(":");
      return { code: 0, sortie: `Certificate fingerprints:\n\t SHA1: ${sha1}\n`, erreur: "" };
    }
    return { code: 1, sortie: "", erreur: "" };
  });

async function remplirCommun() {
  await coffre.ecrire("Commun", "GITHUB_TOKEN", { valeur: "github_pat_test" });
  await coffre.ecrire("Commun", "CLOUDFLARE_API_TOKEN", { valeur: "jeton-cf" });
  await coffre.ecrire("Commun", "CLOUDFLARE_ACCOUNT_ID", { valeur: "0123456789abcdef0123456789abcdef" });
  await coffre.ecrire("Commun", "ASC_KEY_ID", { valeur: "ABCDE12345" });
  await coffre.ecrire("Commun", "ASC_ISSUER_ID", { valeur: "00000000-0000-0000-0000-000000000000" });
  await coffre.ecrire("Commun", "ASC_KEY_P8", { type: "fichier", valeur: b64("-----BEGIN PRIVATE KEY-----\nx\n"), nomFichier: "AuthKey_ABCDE12345.p8" });
  await coffre.ecrire("Commun", "APPLE_TEAM_ID", { valeur: "TEAM123456" });
  await coffre.ecrire("Commun", "TMDB_API_KEY", { valeur: "0123456789abcdef0123456789abcdef" });
  await coffre.ecrire("Commun", "FIREBASE_SERVICE_ACCOUNT", { type: "fichier", valeur: b64('{"type":"service_account"}') });
}

beforeEach(async () => {
  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), "hey-kit-apps-"));
  coffre = new Coffre(path.join(dossier, "coffre.hey-kit"), { kdf: { N: 2 ** 10, r: 8, p: 1 } });
  await coffre.creer("mot de passe de test assez long");
  distant = { secrets: new Set(), variables: new Map(), worker: new Set(), valeursGithub: new Map(), valeursWorker: new Map() };
  appels = [];
  lancements = [];
});

test("sans connexions : accès incomplet, rien n'est appelé", async () => {
  const etat = await etatApp(coffre, "heywatchlist", { fetchFn });
  assert.deepEqual(etat.acces, { github: "incomplet", worker: "incomplet", url: null });
  assert.equal(appels.length, 0);
  assert.ok(etat.elements.every((element) => element.etat === "inconnu"));
});

test("premier envoi : tout ce qui est disponible part, rien n'est relu", async () => {
  await remplirCommun();
  const avant = await etatApp(coffre, "heywatchlist", { fetchFn });
  assert.equal(avant.acces.url, "https://heywatchlist-api.exemple.workers.dev");
  const etats = Object.fromEntries(avant.elements.map((e) => [e.nom, e.etat]));
  assert.equal(etats.CLOUDFLARE_API_TOKEN, "a-envoyer");
  assert.equal(etats.MATCH_GIT_TOKEN, "a-fournir");
  assert.equal(etats.CREDENTIALS_KEY, "a-envoyer");

  const { resultats } = await envoyerApp(coffre, "heywatchlist", { fetchFn, outils: outils() });
  assert.ok(resultats.every((r) => ["ok", "genere"].includes(r.resultat)), JSON.stringify(resultats));
  // Valeurs envoyées : PEM décodé, JSON décodé, URL calculée, clé Android générée.
  assert.match(distant.valeursGithub.get("ASC_KEY_P8"), /BEGIN PRIVATE KEY/);
  assert.equal(distant.valeursWorker.get("FCM_SERVICE_ACCOUNT"), '{"type":"service_account"}');
  assert.equal(distant.variables.get("HEYWATCHLIST_API_URL"), "https://heywatchlist-api.exemple.workers.dev");
  assert.equal(distant.valeursGithub.get("ANDROID_KEYSTORE_BASE64"), b64("faux keystore"));
  assert.equal(distant.valeursGithub.get("ANDROID_KEY_PASSWORD"), distant.valeursGithub.get("ANDROID_KEYSTORE_PASSWORD"));
  assert.equal(distant.valeursWorker.get("APPLE_TEAM_ID"), "TEAM123456");
  assert.match(distant.valeursWorker.get("BOOTSTRAP_CODE"), /^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  // Valeurs générées rangées dans le coffre avant l'envoi.
  assert.equal(coffre.lire("HeyWatchlist", "CREDENTIALS_KEY").valeur, distant.valeursWorker.get("CREDENTIALS_KEY"));
  assert.equal(coffre.lire("HeyWatchlist", "MATCH_PASSWORD").valeur, distant.valeursGithub.get("MATCH_PASSWORD"));
  // Le jeton passe par l'environnement de gh, jamais par la ligne de commande.
  const envoiGh = lancements.find((l) => l.commande === "gh" && l.args[0] === "secret");
  assert.equal(envoiGh.env.GH_TOKEN, "github_pat_test");
  assert.ok(lancements.every((l) => !l.args.some((a) => /github_pat_test|jeton-cf/.test(a))));

  const apres = await etatApp(coffre, "heywatchlist", { fetchFn });
  const restants = apres.elements.filter((e) => e.etat !== "en-place").map((e) => e.nom);
  assert.deepEqual(restants.sort(), [
    "APNS_KEY_ID",
    "APNS_PRIVATE_KEY",
    "APPLE_SIGNIN_KEY_ID",
    "APPLE_SIGNIN_PRIVATE_KEY",
    "GOOGLE_IOS_CLIENT_ID",
    "GOOGLE_SERVICES_JSON",
    "GOOGLE_WEB_CLIENT_ID",
    "MATCH_GIT_TOKEN",
  ]);
  assert.ok(!JSON.stringify(apres).includes("jeton-cf"));
});

test("ce qui est en place n'est pas renvoyé ; une valeur conservée n'est jamais remplacée", async () => {
  await remplirCommun();
  for (const nom of ["MATCH_PASSWORD", "ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"]) {
    distant.secrets.add(nom);
  }
  distant.worker.add("CREDENTIALS_KEY");
  distant.worker.add("TMDB_API_KEY");
  const { resultats } = await envoyerApp(coffre, "heywatchlist", {
    fetchFn,
    outils: outils(),
    remplacer: ["CREDENTIALS_KEY", "MATCH_PASSWORD", "TMDB_API_KEY"],
  });
  const noms = resultats.map((r) => r.nom);
  assert.ok(!noms.includes("CREDENTIALS_KEY"));
  assert.ok(!noms.includes("MATCH_PASSWORD"));
  assert.ok(!noms.includes("ANDROID_KEYSTORE"), "pas de nouvelle clé Android si GitHub en a une");
  assert.ok(noms.includes("TMDB_API_KEY"), "remplacement demandé et permis");
  assert.ok(!coffre.present("HeyWatchlist", "CREDENTIALS_KEY"));
});

test("une variable à la mauvaise valeur est corrigée", async () => {
  await remplirCommun();
  distant.variables.set("MATCH_GIT_URL", "https://exemple.invalid/ancien.git");
  const etat = await etatApp(coffre, "heywatchlist", { fetchFn });
  assert.equal(etat.elements.find((e) => e.nom === "MATCH_GIT_URL").etat, "a-envoyer");
  await envoyerApp(coffre, "heywatchlist", { fetchFn, outils: outils() });
  assert.equal(distant.variables.get("MATCH_GIT_URL"), "https://github.com/Shweepsi/heywatchlist-certificates.git");
  assert.ok(appels.includes(`PATCH ${DEPOT}/variables/MATCH_GIT_URL`));
});

test("sans gh ni keytool : échec typé, rien de cassé", async () => {
  await remplirCommun();
  const sansOutils = creerOutils(async () => ({ code: -1, sortie: "", erreur: "" }));
  const { resultats } = await envoyerApp(coffre, "heywatchlist", { fetchFn, outils: sansOutils });
  assert.equal(resultats.find((r) => r.nom === "ANDROID_KEYSTORE").resultat, "keytool-absent");
  assert.equal(resultats.find((r) => r.nom === "CLOUDFLARE_API_TOKEN").resultat, "gh-absent");
  assert.equal(resultats.find((r) => r.nom === "TMDB_API_KEY").resultat, "ok");
});

test("Worker introuvable : état typé", async () => {
  await remplirCommun();
  distant.workerAbsent = true;
  const etat = await etatApp(coffre, "heywatchlist", { fetchFn });
  assert.equal(etat.acces.worker, "introuvable");
});

test("saisie : formats vérifiés, identifiant de clé Apple lu dans le nom du fichier", async () => {
  assert.equal((await saisir(coffre, "heywatchlist", "GOOGLE_WEB_CLIENT_ID", { valeur: "pas un client" })).etat, "invalide");
  assert.equal(
    (await saisir(coffre, "heywatchlist", "GOOGLE_WEB_CLIENT_ID", { valeur: " 123-abc.apps.googleusercontent.com " })).etat,
    "ok",
  );
  assert.equal(coffre.lire("HeyWatchlist", "GOOGLE_WEB_CLIENT_ID").valeur, "123-abc.apps.googleusercontent.com");
  assert.equal((await saisir(coffre, "heywatchlist", "MATCH_GIT_TOKEN", { valeur: "ghp_large" })).etat, "invalide");

  assert.equal((await saisir(coffre, "heywatchlist", "APNS_PRIVATE_KEY", { valeur: b64("pas une clé") })).etat, "invalide");
  const ok = await saisir(coffre, "heywatchlist", "APNS_PRIVATE_KEY", { valeur: b64(p8()), nomFichier: "AuthKey_ZXCVB98765.p8" });
  assert.deepEqual(ok, { etat: "ok", aussi: "APNS_KEY_ID" });
  assert.equal(coffre.lire("HeyWatchlist", "APNS_KEY_ID").valeur, "ZXCVB98765");

  const autre = b64(JSON.stringify({ project_info: { project_id: "p" }, client: [{ client_info: { android_client_info: { package_name: "autre.app" } } }] }));
  assert.equal((await saisir(coffre, "heywatchlist", "GOOGLE_SERVICES_JSON", { valeur: autre })).etat, "invalide");
  const bon = b64(
    JSON.stringify({ project_info: { project_id: "p" }, client: [{ client_info: { android_client_info: { package_name: "io.github.shweepsi.heywatchlist" } } }] }),
  );
  assert.equal((await saisir(coffre, "heywatchlist", "GOOGLE_SERVICES_JSON", { valeur: bon })).etat, "ok");

  await assert.rejects(saisir(coffre, "heywatchlist", "CREDENTIALS_KEY", { valeur: "x" }), { code: "requete-invalide" });
});

test("reprise de l'ancienne sauvegarde, sans rien remplacer", async () => {
  const accueil = await fs.mkdtemp(path.join(os.tmpdir(), "hey-kit-accueil-"));
  assert.deepEqual(await importerAncien(coffre, "heywatchlist", { accueil }), { trouve: false, repris: [] });
  const dossier = path.join(accueil, "HeyWatchlist-secrets");
  await fs.mkdir(dossier);
  await fs.writeFile(
    path.join(dossier, "mots-de-passe.txt"),
    "# commentaire\r\nANDROID_KEYSTORE_PASSWORD=ancien\r\nMATCH_PASSWORD=phrase\r\nAUTRE=ignoree\r\n",
  );
  await fs.writeFile(path.join(dossier, "heywatchlist-release.jks"), "keystore");
  await coffre.ecrire("HeyWatchlist", "MATCH_PASSWORD", { valeur: "deja-la" });
  const reprise = await importerAncien(coffre, "heywatchlist", { accueil });
  assert.deepEqual(reprise.repris, ["ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEYSTORE"]);
  assert.equal(coffre.lire("HeyWatchlist", "MATCH_PASSWORD").valeur, "deja-la");
  assert.equal(coffre.lire("HeyWatchlist", "ANDROID_KEYSTORE").valeur, b64("keystore"));
  assert.equal(coffre.present("HeyWatchlist", "AUTRE"), false);
});

test("affichage limité au code administrateur ; empreinte SHA-1", async () => {
  await coffre.ecrire("HeyWatchlist", "BOOTSTRAP_CODE", { valeur: "ABCD-EFGH-JKMN" });
  assert.equal(afficher(coffre, "heywatchlist", "BOOTSTRAP_CODE").valeur, "ABCD-EFGH-JKMN");
  assert.throws(() => afficher(coffre, "heywatchlist", "CREDENTIALS_KEY"), { code: "requete-invalide" });

  await assert.rejects(empreinteAndroid(coffre, "heywatchlist", { outils: outils() }), { code: "keystore-absent" });
  await coffre.ecrire("HeyWatchlist", "ANDROID_KEYSTORE", { type: "fichier", valeur: b64("keystore") });
  await coffre.ecrire("HeyWatchlist", "ANDROID_KEYSTORE_PASSWORD", { valeur: "mdp" });
  const { sha1 } = await empreinteAndroid(coffre, "heywatchlist", { outils: outils() });
  assert.match(sha1, /^AB(:AB){19}$/);
  const liste = lancements.find((l) => l.args.includes("-list"));
  assert.ok(liste.args.includes("-J-Duser.language=en"), "keytool doit répondre en anglais");
  assert.equal(liste.env.HEY_KIT_MDP, "mdp");
  assert.ok(!liste.args.includes("mdp"));
});

test("keytool en échec : cause reconnue, ou sa ligne d'erreur sans secret", async () => {
  await coffre.ecrire("HeyWatchlist", "ANDROID_KEYSTORE", { type: "fichier", valeur: b64("keystore") });
  await coffre.ecrire("HeyWatchlist", "ANDROID_KEYSTORE_PASSWORD", { valeur: "mdp" });
  const keytoolQuiRepond = (code, sortie, erreur = "") =>
    creerOutils(async (_c, args) => (args[0] === "-help" ? { code: 0, sortie: "", erreur: "" } : { code, sortie, erreur }));

  await assert.rejects(
    empreinteAndroid(coffre, "heywatchlist", {
      outils: keytoolQuiRepond(1, "keytool error: java.io.IOException: keystore password was incorrect\n"),
    }),
    { code: "keystore-mot-de-passe" },
  );
  await assert.rejects(
    empreinteAndroid(coffre, "heywatchlist", { outils: keytoolQuiRepond(1, "keytool error: java.lang.Exception: Alias <heywatchlist> does not exist\n") }),
    { code: "keystore-alias" },
  );
  await assert.rejects(
    empreinteAndroid(coffre, "heywatchlist", { outils: keytoolQuiRepond(1, "", "keytool error: java.lang.Exception: autre problème\n") }),
    (erreur) => erreur.code === "keytool-echec" && erreur.detail === "keytool error: java.lang.Exception: autre problme",
  );
  // Sortie à la française (« SHA1 : ») : l'empreinte est quand même lue.
  const sha1 = Array.from({ length: 20 }, () => "0F").join(":");
  const { sha1: lue } = await empreinteAndroid(coffre, "heywatchlist", { outils: keytoolQuiRepond(0, `\t SHA1 : ${sha1}\n`) });
  assert.equal(lue, sha1);
});
