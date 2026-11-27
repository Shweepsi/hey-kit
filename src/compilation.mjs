// Compilation des apps Android sur ce PC, dans Ubuntu 24.04 (WSL) : le même
// système que le runner de la CI GitHub, donc les mêmes scripts du dépôt, sans
// les adapter à Windows.
//
// Le kit installe Ubuntu au premier besoin (`wsl --install`), puis lance
// scripts/android-wsl.sh en root dans Ubuntu. Les secrets de signature partent
// du coffre vers ce script par l'environnement (WSLENV), jamais sur une ligne
// de commande ni dans un fichier de Windows ; ils sont masqués dans le journal.
// Les APK arrivent dans Documents\hey-kit\apk\<app>\<version>.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app as trouverApp } from "./apps.mjs";
import { ErreurCoffre } from "./coffre.mjs";
import { DOSSIER_COMMUN } from "./connexions.mjs";
import { EXPLORATEUR, WSL } from "./outils.mjs";

export const DISTRIBUTION = "Ubuntu-24.04";
export const ETAPES = Object.freeze(["ubuntu", "paquets", "sdk", "rust", "depot", "compilation", "copie"]);
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "android-wsl.sh");
const LIGNES_MAX = 400;
const DELAI = 20_000;

// Noms des distributions installées ; null si WSL n'est pas utilisable.
async function distributions(outils) {
  const resultat = await outils.executer(WSL, ["--list", "--quiet"]);
  if (resultat.code !== 0) return null;
  return resultat.sortie
    .replaceAll("\0", "")
    .split(/\r?\n/)
    .map((ligne) => ligne.trim())
    .filter(Boolean);
}

// Adresse de l'API : la variable GitHub que lit la CI. Null si illisible.
async function variableGithub(coffre, depot, nom, fetchFn) {
  const jeton = coffre.lire(DOSSIER_COMMUN, "GITHUB_TOKEN")?.valeur;
  if (!jeton) return null;
  try {
    const reponse = await fetchFn(`https://api.github.com/repos/${depot}/actions/variables/${nom}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(DELAI),
      headers: {
        Authorization: `Bearer ${jeton}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "hey-kit",
      },
    });
    const corps = await reponse.json().catch(() => null);
    return reponse.ok && typeof corps?.value === "string" ? corps.value : null;
  } catch {
    return null;
  }
}

// Variables passées au script. `secrets` : valeurs à masquer dans le journal.
async function preparer(coffre, definition, sortie, fetchFn) {
  const { android } = definition;
  const keystore = coffre.lire(definition.dossier, "ANDROID_KEYSTORE")?.valeur;
  const motDePasse = coffre.lire(definition.dossier, "ANDROID_KEYSTORE_PASSWORD")?.valeur;
  if (!keystore || !motDePasse) throw new ErreurCoffre("keystore-absent");
  const avertissements = [];
  const env = {
    HK_DEPOT: `https://github.com/${definition.depot}.git`,
    HK_NOM: definition.depot.split("/")[1],
    HK_SORTIE: sortie,
    HK_TACHES: android.taches.join(" "),
    HK_CIBLES: android.cibles.join(" "),
    HK_NDK: android.ndk,
    HK_CARGO_NDK: android.cargoNdk,
    ANDROID_KEYSTORE_BASE64: keystore,
    ANDROID_KEYSTORE_PASSWORD: motDePasse,
    ANDROID_KEY_ALIAS: definition.aliasAndroid,
    ANDROID_KEY_PASSWORD: motDePasse,
  };
  const url = await variableGithub(coffre, definition.depot, android.variable, fetchFn);
  if (url && /^https:\/\/[^\s?#]+$/.test(url)) env[android.variable] = url;
  else avertissements.push("sans-api");
  const services = coffre.lire(definition.dossier, android.servicesGoogle)?.valeur;
  if (services) env[android.servicesGoogle] = services;
  else avertissements.push("sans-notifications");
  // WSLENV : variables de Windows recopiées dans Ubuntu ; « p » traduit le chemin.
  const noms = Object.keys(env).map((nom) => (nom === "HK_SORTIE" ? `${nom}/p` : nom));
  const existant = process.env.WSLENV ? `${process.env.WSLENV}:` : "";
  return {
    env: { ...env, WSLENV: `${existant}${noms.join(":")}` },
    secrets: [keystore, motDePasse, services].filter((valeur) => typeof valeur === "string" && valeur.length >= 6),
    avertissements,
  };
}

const masquer = (ligne, secrets) => {
  let propre = ligne;
  for (const secret of secrets) propre = propre.split(secret).join("<…>");
  return propre.replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/g, "$1?<…>").slice(0, 500);
};

// Une compilation à la fois, pour tout le kit. `dossierKit` : Documents\hey-kit.
export function creerCompilations({ coffre, outils, dossierKit, fetchFn = fetch, windows = process.platform === "win32" }) {
  let tache = null;
  let enCours = null;

  const vide = (definition) => ({ id: definition.id, etat: "repos", etapes: [], journal: [] });

  const etat = (id) => {
    const definition = trouverApp(id);
    if (!definition?.android) throw new ErreurCoffre("requete-invalide");
    if (!tache || tache.id !== id) return vide(definition);
    const { secrets: _secrets, ...visible } = tache;
    return { ...visible, journal: tache.journal.slice(-LIGNES_MAX) };
  };

  const noter = (ligne) => {
    if (ligne.startsWith("::etape ")) {
      const nom = ligne.slice(8).trim();
      for (const precedente of tache.etapes) if (precedente.fin === null) precedente.fin = Date.now();
      if (nom !== "fini") tache.etapes.push({ nom, debut: Date.now(), fin: null });
      return;
    }
    if (ligne.startsWith("::echec ")) {
      tache.echec = ligne.slice(8).trim().replace(/[^a-z-]/g, "").slice(0, 40) || "inconnu";
      return;
    }
    if (ligne.startsWith("::version ")) {
      tache.version = ligne.slice(10).trim().replace(/[^\w.-]/g, "").slice(0, 40) || null;
      return;
    }
    tache.journal.push(masquer(ligne, tache.secrets));
    if (tache.journal.length > LIGNES_MAX * 2) tache.journal.splice(0, LIGNES_MAX);
  };

  const terminer = (resultat, echec = null) => {
    for (const etape of tache.etapes) if (etape.fin === null) etape.fin = Date.now();
    tache.etat = resultat;
    if (echec && !tache.echec) tache.echec = echec;
    tache.fin = Date.now();
    enCours = null;
  };

  const executerPhase = async (commande, args, options = {}) => {
    const lance = outils.lancer(commande, args, { ...options, surLigne: noter });
    enCours = lance;
    const code = await lance.fin;
    if (tache.etat === "arrete") return null;
    return code;
  };

  async function derouler(definition, preparation) {
    noter("::etape ubuntu");
    let installees = await distributions(outils);
    if (!installees?.includes(DISTRIBUTION)) {
      noter("Installation d'Ubuntu 24.04 dans WSL : Windows peut demander une autorisation.");
      const code = await executerPhase(WSL, ["--install", "--distribution", DISTRIBUTION, "--no-launch"]);
      if (code === null) return;
      installees = await distributions(outils);
      if (!installees?.includes(DISTRIBUTION)) return terminer("echec", code === 0 ? "redemarrer" : "ubuntu");
    }
    const script = fs.readFileSync(SCRIPT, "utf8").replaceAll("\r\n", "\n");
    const code = await executerPhase(WSL, ["--distribution", DISTRIBUTION, "--user", "root", "--exec", "bash", "-s"], {
      entree: script,
      env: preparation.env,
    });
    if (code === null) return;
    if (code !== 0) return terminer("echec", "inconnu");
    terminer("ok");
  }

  return {
    etat,

    async lancer(id) {
      const definition = trouverApp(id);
      if (!definition?.android) throw new ErreurCoffre("requete-invalide");
      if (!windows) throw new ErreurCoffre("windows-seulement");
      if (!coffre.ouvert) throw new ErreurCoffre("verrouille");
      if (tache?.etat === "en-cours") throw new ErreurCoffre("compilation-en-cours");
      const sortie = path.join(dossierKit, "apk", definition.dossier);
      const preparation = await preparer(coffre, definition, sortie, fetchFn);
      tache = {
        id,
        etat: "en-cours",
        debut: Date.now(),
        fin: null,
        etapes: [],
        journal: [],
        echec: null,
        version: null,
        sortie,
        avertissements: preparation.avertissements,
        secrets: preparation.secrets,
      };
      derouler(definition, preparation).catch(() => terminer("echec", "inconnu"));
      return etat(id);
    },

    async arreter(id) {
      if (!tache || tache.id !== id || tache.etat !== "en-cours") return etat(id);
      terminer("arrete");
      enCours?.arreter();
      // Gradle et cargo tournent dans Ubuntu : on arrête toute la distribution.
      await outils.executer(WSL, ["--terminate", DISTRIBUTION]);
      return etat(id);
    },

    // Ouvre le dossier des APK dans l'Explorateur.
    async ouvrir(id) {
      const definition = trouverApp(id);
      if (!definition?.android) throw new ErreurCoffre("requete-invalide");
      if (!windows) throw new ErreurCoffre("windows-seulement");
      const base = path.join(dossierKit, "apk", definition.dossier);
      const dossier = tache?.id === id && tache.version ? path.join(base, tache.version) : base;
      const cible = fs.existsSync(dossier) ? dossier : base;
      if (!fs.existsSync(cible)) throw new ErreurCoffre("apk-absent");
      // L'Explorateur rend souvent 1 même quand il a ouvert la fenêtre.
      await outils.executer(EXPLORATEUR, [cible]);
      return { ok: true };
    },
  };
}
