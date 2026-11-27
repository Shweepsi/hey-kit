// Compilation : WSL, Ubuntu et GitHub simulés, aucun programme lancé.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { Coffre } from "../src/coffre.mjs";
import { DISTRIBUTION, creerCompilations } from "../src/compilation.mjs";

const KEYSTORE = Buffer.from("faux keystore de test, assez long").toString("base64");
const MOT_DE_PASSE = "phrase-du-keystore-de-test";
const SERVICES = Buffer.from('{"project_info":{}}').toString("base64");

let coffre;
let dossierKit;
let lances;
let executes;

beforeEach(async () => {
  dossierKit = await fs.mkdtemp(path.join(os.tmpdir(), "hey-kit-compilation-"));
  coffre = new Coffre(path.join(dossierKit, "coffre.hey-kit"), { kdf: { N: 2 ** 10, r: 8, p: 1 } });
  await coffre.creer("mot de passe de test assez long");
  lances = [];
  executes = [];
});

const ranger = async ({ services = true } = {}) => {
  await coffre.ecrire("HeyWatchlist", "ANDROID_KEYSTORE", { type: "fichier", valeur: KEYSTORE });
  await coffre.ecrire("HeyWatchlist", "ANDROID_KEYSTORE_PASSWORD", { type: "texte", valeur: MOT_DE_PASSE });
  await coffre.ecrire("Commun", "GITHUB_TOKEN", { type: "texte", valeur: "github_pat_test" });
  if (services) await coffre.ecrire("HeyWatchlist", "GOOGLE_SERVICES_JSON", { type: "fichier", valeur: SERVICES });
};

// `liste` : sorties successives de `wsl --list --quiet` (UTF-16 comme wsl.exe).
function outils({ liste = [[DISTRIBUTION]], lignes = [], code = 0, installation = 0 } = {}) {
  const listes = [...liste];
  return {
    executer: async (commande, args) => {
      executes.push({ commande, args });
      if (args[0] === "--list") {
        const noms = listes.length > 1 ? listes.shift() : listes[0];
        if (noms === null) return { code: 1, sortie: "", erreur: "" };
        return { code: 0, sortie: Buffer.from(`${noms.join("\r\n")}\r\n`, "utf16le").toString("utf8"), erreur: "" };
      }
      return { code: 0, sortie: "", erreur: "" };
    },
    lancer: (commande, args, options) => {
      lances.push({ commande, args, options });
      const installer = args[0] === "--install";
      if (!installer) for (const ligne of lignes) options.surLigne(ligne);
      return { fin: Promise.resolve(installer ? installation : code), arreter: () => {} };
    },
  };
}

const fetchFn = async (url) => {
  assert.equal(url, "https://api.github.com/repos/Shweepsi/hey-torrent-native/actions/variables/HEYWATCHLIST_API_URL");
  return new Response(JSON.stringify({ name: "HEYWATCHLIST_API_URL", value: "https://api.example.workers.dev" }), { status: 200 });
};

const attendre = async (compilations) => {
  for (let i = 0; i < 50 && compilations.etat("heywatchlist").etat === "en-cours"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return compilations.etat("heywatchlist");
};

test("compilation : script dans Ubuntu en root, secrets par WSLENV, masqués dans le journal", async () => {
  await ranger();
  const compilations = creerCompilations({
    coffre,
    dossierKit,
    fetchFn,
    windows: true,
    outils: outils({
      lignes: ["::etape paquets", "::etape sdk", "::etape compilation", "::version 0.6.0", `fuite ${MOT_DE_PASSE} ici`, "https://serveur.example/x?cle=abc", "::etape copie", "APK : app-admin-release.apk", "::etape fini"],
    }),
  });
  const debut = await compilations.lancer("heywatchlist");
  assert.equal(debut.etat, "en-cours");
  assert.ok(!("secrets" in debut));
  const fin = await attendre(compilations);
  assert.equal(fin.etat, "ok");
  assert.equal(fin.version, "0.6.0");
  assert.deepEqual(fin.etapes.map((e) => e.nom), ["ubuntu", "paquets", "sdk", "compilation", "copie"]);
  assert.ok(fin.etapes.every((e) => e.fin !== null));
  assert.deepEqual(fin.avertissements, []);
  assert.equal(fin.sortie, path.join(dossierKit, "apk", "HeyWatchlist"));

  const journal = fin.journal.join("\n");
  assert.ok(!journal.includes(MOT_DE_PASSE));
  assert.ok(!journal.includes("cle=abc"));
  assert.match(journal, /APK : app-admin-release\.apk/);

  assert.equal(lances.length, 1, "Ubuntu déjà là : pas d'installation");
  const [{ args, options }] = lances;
  assert.deepEqual(args, ["--distribution", DISTRIBUTION, "--user", "root", "--exec", "bash", "-s"]);
  assert.match(options.entree, /^#!\/usr\/bin\/env bash\n/);
  assert.ok(!options.entree.includes("\r"));
  // Aucun secret sur la ligne de commande.
  assert.ok(!args.join(" ").includes(MOT_DE_PASSE));
  const { env } = options;
  assert.equal(env.ANDROID_KEYSTORE_BASE64, KEYSTORE);
  assert.equal(env.ANDROID_KEYSTORE_PASSWORD, MOT_DE_PASSE);
  assert.equal(env.ANDROID_KEY_PASSWORD, MOT_DE_PASSE);
  assert.equal(env.ANDROID_KEY_ALIAS, "heywatchlist");
  assert.equal(env.HEYWATCHLIST_API_URL, "https://api.example.workers.dev");
  assert.equal(env.GOOGLE_SERVICES_JSON, SERVICES);
  assert.equal(env.HK_TACHES, "assembleAdminRelease assemblePublicRelease");
  assert.equal(env.HK_NDK, "27.3.13750724");
  assert.equal(env.HK_DEPOT, "https://github.com/Shweepsi/hey-torrent-native.git");
  const wslenv = env.WSLENV.split(":");
  for (const nom of ["ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "HEYWATCHLIST_API_URL", "GOOGLE_SERVICES_JSON", "HK_TACHES"]) {
    assert.ok(wslenv.includes(nom), nom);
  }
  assert.ok(wslenv.includes("HK_SORTIE/p"));
});

test("Ubuntu absent : installé une fois ; encore absent après installation : redémarrer", async () => {
  await ranger({ services: false });
  const sansReseau = async () => new Response("{}", { status: 404 });
  const compilations = creerCompilations({
    coffre,
    dossierKit,
    fetchFn: sansReseau,
    windows: true,
    outils: outils({ liste: [["docker-desktop"], ["docker-desktop"]] }),
  });
  const debut = await compilations.lancer("heywatchlist");
  assert.deepEqual(debut.avertissements, ["sans-api", "sans-notifications"]);
  const fin = await attendre(compilations);
  assert.equal(fin.etat, "echec");
  assert.equal(fin.echec, "redemarrer");
  assert.deepEqual(lances[0].args, ["--install", "--distribution", DISTRIBUTION, "--no-launch"]);
  assert.equal(lances.length, 1);
});

test("Ubuntu installé puis script en échec : code rendu par le script", async () => {
  await ranger();
  const compilations = creerCompilations({
    coffre,
    dossierKit,
    fetchFn,
    windows: true,
    outils: outils({ liste: [null, [DISTRIBUTION]], lignes: ["::etape compilation", "FAILURE: Build failed", "::echec gradle"], code: 1 }),
  });
  await compilations.lancer("heywatchlist");
  const fin = await attendre(compilations);
  assert.equal(fin.etat, "echec");
  assert.equal(fin.echec, "gradle");
  assert.equal(lances.length, 2);
  assert.match(fin.journal.join("\n"), /FAILURE/);
});

test("refus : sans clé Android, hors Windows, app inconnue, deux à la fois", async () => {
  const compilations = creerCompilations({ coffre, dossierKit, fetchFn, windows: true, outils: outils() });
  await assert.rejects(compilations.lancer("heywatchlist"), { code: "keystore-absent" });
  assert.equal(lances.length, 0);
  await assert.rejects(compilations.lancer("inconnue"), { code: "requete-invalide" });
  const linux = creerCompilations({ coffre, dossierKit, fetchFn, windows: false, outils: outils() });
  await assert.rejects(linux.lancer("heywatchlist"), { code: "windows-seulement" });

  await ranger();
  let finir;
  const lent = {
    ...outils(),
    lancer: (commande, args, options) => {
      lances.push({ commande, args, options });
      return { fin: new Promise((resolve) => (finir = resolve)), arreter: () => finir(1) };
    },
  };
  const unique = creerCompilations({ coffre, dossierKit, fetchFn, windows: true, outils: lent });
  await unique.lancer("heywatchlist");
  while (lances.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(unique.lancer("heywatchlist"), { code: "compilation-en-cours" });
  const arrete = await unique.arreter("heywatchlist");
  assert.equal(arrete.etat, "arrete");
  assert.ok(executes.some((e) => e.args[0] === "--terminate"));
});

test("ouvrir : dossier des APK dans l'Explorateur, refus s'il n'existe pas", async () => {
  const compilations = creerCompilations({ coffre, dossierKit, fetchFn, windows: true, outils: outils() });
  await assert.rejects(compilations.ouvrir("heywatchlist"), { code: "apk-absent" });
  await fs.mkdir(path.join(dossierKit, "apk", "HeyWatchlist"), { recursive: true });
  await compilations.ouvrir("heywatchlist");
  assert.deepEqual(executes.at(-1).args, [path.join(dossierKit, "apk", "HeyWatchlist")]);
});

test("lancer : sortie découpée en lignes (\\n, \\r\\n, \\r), octets nuls retirés, code rendu", async () => {
  const { lancer } = await import("../src/outils.mjs");
  const lignes = [];
  const { fin } = lancer(process.execPath, ["-e", "process.stdout.write('a\\r\\nb\\rc\\n\\0d\\0\\n'); process.stderr.write('e\\n'); process.exit(3)"], {
    surLigne: (ligne) => lignes.push(ligne),
  });
  assert.equal(await fin, 3);
  assert.deepEqual(lignes.sort(), ["a", "b", "c", "d", "e"]);
  assert.equal(await lancer("programme-introuvable-hey-kit", []).fin, -1);
});
