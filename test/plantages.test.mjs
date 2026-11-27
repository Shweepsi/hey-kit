// Plantages : Google et BigQuery simulés.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { Coffre } from "../src/coffre.mjs";
import { convertir, lirePlantages, nettoyer, rapport } from "../src/plantages.mjs";

const cle = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
const compte = {
  type: "service_account",
  project_id: "heywatchlist-60448",
  client_email: "firebase-adminsdk-test@heywatchlist-60448.iam.gserviceaccount.com",
  private_key: cle,
  token_uri: "https://oauth2.googleapis.com/token",
};

let coffre;
let appels;

// Réponse BigQuery au format f/v, avec des enregistrements imbriqués.
const SCHEMA = {
  fields: [
    { name: "issue_id", type: "STRING" },
    { name: "evenements", type: "INTEGER" },
    { name: "appareils", type: "INTEGER" },
    { name: "premier", type: "TIMESTAMP" },
    { name: "dernier", type: "TIMESTAMP" },
    {
      name: "recent",
      type: "RECORD",
      fields: [
        { name: "table_app", type: "STRING" },
        { name: "error_type", type: "STRING" },
        { name: "version", type: "STRING" },
        { name: "build", type: "STRING" },
        { name: "fabricant", type: "STRING" },
        { name: "modele", type: "STRING" },
        {
          name: "blame_frame",
          type: "RECORD",
          fields: [
            { name: "symbol", type: "STRING" },
            { name: "file", type: "STRING" },
            { name: "line", type: "INTEGER" },
          ],
        },
        {
          name: "exceptions",
          type: "RECORD",
          mode: "REPEATED",
          fields: [
            { name: "type", type: "STRING" },
            { name: "exception_message", type: "STRING" },
          ],
        },
      ],
    },
  ],
};
const LIGNE = {
  f: [
    { v: "abc123" },
    { v: "4" },
    { v: "2" },
    { v: "1.7646E9" },
    { v: "1.7647E9" },
    {
      v: {
        f: [
          { v: "_admin_ANDROID" },
          { v: "FATAL" },
          { v: "0.5.0" },
          { v: "5" },
          { v: "Xiaomi" },
          { v: "Redmi Note 12" },
          { v: { f: [{ v: "app.heywatchlist.ui.Liste.afficher" }, { v: "Liste.kt" }, { v: "42" }] } },
          {
            v: [
              {
                v: {
                  f: [
                    { v: "java.lang.IllegalStateException" },
                    { v: "échec pour https://serveur.example/v1?token=abcdef et moi@example.com" },
                  ],
                },
              },
            ],
          },
        ],
      },
    },
  ],
};

const TABLES = [200, { tables: [{ tableReference: { tableId: "io_github_shweepsi_heywatchlist_ANDROID" } }] }];

function fetchFn(reponseBigQuery, reponseTables = TABLES) {
  return async (url, options = {}) => {
    appels.push({ url: String(url), options });
    if (url === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({ access_token: "jeton-google" }), { status: 200 });
    }
    if (String(url).includes("/datasets/firebase_crashlytics/tables")) {
      const [statut, corps] = reponseTables;
      return new Response(JSON.stringify(corps), { status: statut });
    }
    const [statut, corps] = reponseBigQuery;
    return new Response(JSON.stringify(corps), { status: statut });
  };
}

beforeEach(async () => {
  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), "hey-kit-plantages-"));
  coffre = new Coffre(path.join(dossier, "coffre.hey-kit"), { kdf: { N: 2 ** 10, r: 8, p: 1 } });
  await coffre.creer("mot de passe de test assez long");
  appels = [];
});

const enregistrerCompte = () =>
  coffre.ecrire("Commun", "FIREBASE_SERVICE_ACCOUNT", { type: "fichier", valeur: Buffer.from(JSON.stringify(compte)).toString("base64") });

test("sans compte de service : incomplet, aucun appel", async () => {
  const resultat = await lirePlantages(coffre, "heywatchlist", { fetchFn: fetchFn([200, {}]) });
  assert.equal(resultat.etat, "incomplet");
  assert.equal(appels.length, 0);
});

test("lecture : requête en lecture seule, paramétrée, plafonnée, et rapport sans secret", async () => {
  await enregistrerCompte();
  const resultat = await lirePlantages(coffre, "heywatchlist", {
    jours: 7,
    fetchFn: fetchFn([200, { jobComplete: true, schema: SCHEMA, rows: [LIGNE] }]),
  });
  assert.equal(resultat.etat, "ok");
  assert.equal(resultat.compte, compte.client_email);

  const jeton = new URLSearchParams(appels[0].options.body);
  const assertion = JSON.parse(Buffer.from(jeton.get("assertion").split(".")[1], "base64url").toString());
  assert.equal(assertion.scope, "https://www.googleapis.com/auth/cloud-platform.read-only");

  assert.equal(
    appels[1].url,
    "https://bigquery.googleapis.com/bigquery/v2/projects/heywatchlist-60448/datasets/firebase_crashlytics/tables?maxResults=1000",
  );
  const requete = appels[2];
  assert.equal(requete.url, "https://bigquery.googleapis.com/bigquery/v2/projects/heywatchlist-60448/queries");
  assert.equal(requete.options.headers.Authorization, "Bearer jeton-google");
  const corps = JSON.parse(requete.options.body);
  assert.match(corps.query, /heywatchlist-60448\.firebase_crashlytics\.io_github_shweepsi_heywatchlist\*/);
  assert.equal(corps.queryParameters[0].parameterValue.value, "7");
  assert.equal(corps.useLegacySql, false);
  assert.ok(Number(corps.maximumBytesBilled) > 0);

  const [p] = resultat.problemes;
  assert.equal(p.id, "abc123");
  assert.equal(p.evenements, 4);
  assert.equal(p.edition, "admin");
  assert.equal(p.appareil, "Xiaomi Redmi Note 12");
  assert.equal(p.exception, "java.lang.IllegalStateException");
  assert.deepEqual(p.cause, { symbole: "app.heywatchlist.ui.Liste.afficher", fichier: "Liste.kt", ligne: 42, bibliotheque: null });
  assert.ok(!p.message.includes("token=abcdef"));
  assert.ok(!p.message.includes("moi@example.com"));

  const texte = rapport("HeyWatchlist", resultat);
  assert.match(texte, /# Plantages HeyWatchlist \(7 derniers jours/);
  assert.match(texte, /Liste\.kt:42/);
  assert.ok(!texte.includes("jeton-google"));
  assert.ok(!texte.includes(compte.client_email));
});

test("états typés : export absent, droits manquants, plafond, Google qui refuse", async () => {
  await enregistrerCompte();
  const cas = [
    [[404, { error: { errors: [{ reason: "notFound" }], message: "Not found: Dataset" } }], "pas-encore"],
    [[403, { error: { errors: [{ reason: "accessDenied" }], message: "User does not have bigquery.jobs.create permission" } }], "interdit"],
    [[400, { error: { errors: [{ reason: "bytesBilledLimitExceeded" }] } }], "plafond"],
    [[200, { jobComplete: false }], "lent"],
  ];
  for (const [reponse, attendu] of cas) {
    assert.equal((await lirePlantages(coffre, "heywatchlist", { fetchFn: fetchFn(reponse) })).etat, attendu);
  }
  const refuse = await lirePlantages(coffre, "heywatchlist", {
    fetchFn: async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
  });
  assert.equal(refuse.etat, "refuse");
  await assert.rejects(lirePlantages(coffre, "heywatchlist", { jours: 3650, fetchFn: fetchFn([200, {}]) }), { code: "requete-invalide" });
});

test("export : lien absent, tables pas encore écrites, et détail des vraies erreurs", async () => {
  await enregistrerCompte();
  const lire = (reponse, tables) => lirePlantages(coffre, "heywatchlist", { fetchFn: fetchFn(reponse, tables) });

  appels = [];
  assert.equal((await lire([200, {}], [404, { error: { message: "Not found: Dataset heywatchlist-60448:firebase_crashlytics" } }])).etat, "pas-lie");
  assert.equal(appels.length, 2, "aucune requête si le dataset manque");

  appels = [];
  assert.equal((await lire([200, {}], [200, {}])).etat, "pas-encore");
  assert.equal((await lire([200, {}], [200, { tables: [{ tableReference: { tableId: "autre_app_ANDROID" } }] }])).etat, "pas-encore");
  assert.ok(appels.every((a) => !a.url.endsWith("/queries")));

  // Table générique sans correspondance, renvoyée en 400 par BigQuery.
  const generique = await lire([400, { error: { errors: [{ reason: "invalidQuery" }], message: "Wildcard table heywatchlist-60448:firebase_crashlytics.io_github_shweepsi_heywatchlist* does not match any table." } }]);
  assert.equal(generique.etat, "pas-encore");

  const champ = await lire([400, { error: { errors: [{ reason: "invalidQuery" }], message: "Unrecognized name: blame_frame at [9:5] token=abcdefabcdefabcdefabcdefabcdefabcdef" } }]);
  assert.equal(champ.etat, "requete");
  assert.match(champ.detail, /Unrecognized name: blame_frame at \[9:5\]/);
  assert.ok(!champ.detail.includes("abcdefabcdef"));

  const droits = await lire([200, {}], [403, { error: { errors: [{ reason: "accessDenied" }], message: "Permission bigquery.tables.list denied" } }]);
  assert.equal(droits.etat, "interdit");
  assert.match(droits.detail, /bigquery\.tables\.list/);
});

test("conversion f/v et nettoyage", () => {
  assert.deepEqual(convertir({ schema: { fields: [{ name: "n", type: "INTEGER" }] }, rows: [{ f: [{ v: "3" }] }] }), [{ n: 3 }]);
  assert.deepEqual(convertir({}), []);
  assert.equal(nettoyer("clé AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA fin"), "clé <…> fin");
  assert.equal(nettoyer("magnet:?xt=urn:btih:abc"), "magnet:<…>");
  assert.equal(nettoyer(null), null);
});
