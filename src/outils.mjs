// Programmes du PC dont le kit a besoin : GitHub CLI (`gh`), pour chiffrer et
// envoyer les secrets GitHub, `keytool` (Java), pour la clé de signature
// Android, et `wsl.exe`, pour compiler les apps dans Ubuntu. Seul Ubuntu (WSL)
// est installé par le kit, à la demande (onglet Compiler).
//
// Les valeurs secrètes passent par l'entrée standard ou par une variable
// d'environnement du programme lancé, jamais sur la ligne de commande (qu'un
// autre programme du PC peut lire).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WINDOWS = process.platform === "win32";
const DOSSIER_SUR = WINDOWS ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32") : os.homedir();
const DELAI = 60_000;

// Lance un programme sans shell. Rend { code, sortie, erreur } ; code -1 si le
// programme est introuvable ou dépasse le délai.
export function executer(commande, args, { entree, env = {}, cwd = DOSSIER_SUR } = {}) {
  return new Promise((resolve) => {
    let enfant;
    try {
      enfant = spawn(commande, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, shell: false });
    } catch {
      return resolve({ code: -1, sortie: "", erreur: "" });
    }
    const sortie = [];
    const erreur = [];
    const minuterie = setTimeout(() => enfant.kill(), DELAI);
    enfant.stdout.on("data", (morceau) => sortie.push(morceau));
    enfant.stderr.on("data", (morceau) => erreur.push(morceau));
    enfant.on("error", () => {
      clearTimeout(minuterie);
      resolve({ code: -1, sortie: "", erreur: "" });
    });
    enfant.on("close", (code) => {
      clearTimeout(minuterie);
      resolve({ code: code ?? -1, sortie: Buffer.concat(sortie).toString("utf8"), erreur: Buffer.concat(erreur).toString("utf8") });
    });
    enfant.stdin.on("error", () => {});
    enfant.stdin.end(entree ?? "");
  });
}

// Lance un programme long sans délai, en passant sa sortie ligne par ligne à
// `surLigne`. Rend { fin: Promise<code>, arreter() } ; code -1 si introuvable.
export function lancer(commande, args, { entree, env = {}, surLigne = () => {} } = {}) {
  let enfant;
  try {
    enfant = spawn(commande, args, { cwd: DOSSIER_SUR, env: { ...process.env, ...env }, windowsHide: true, shell: false });
  } catch {
    return { fin: Promise.resolve(-1), arreter: () => {} };
  }
  const decouper = () => {
    let reste = "";
    return (morceau) => {
      // wsl.exe écrit ses propres messages en UTF-16 : on retire les octets nuls.
      const lignes = (reste + morceau.toString("utf8").replaceAll("\0", "")).split(/\r?\n|\r/);
      reste = lignes.pop() ?? "";
      for (const ligne of lignes) if (ligne.trim() !== "") surLigne(ligne);
    };
  };
  enfant.stdout.on("data", decouper());
  enfant.stderr.on("data", decouper());
  const fin = new Promise((resolve) => {
    enfant.on("error", () => resolve(-1));
    enfant.on("close", (code) => resolve(code ?? -1));
  });
  enfant.stdin.on("error", () => {});
  enfant.stdin.end(entree ?? "");
  return { fin, arreter: () => enfant.kill() };
}

const sousDossiers = (dossier) => {
  try {
    return fs
      .readdirSync(dossier, { withFileTypes: true })
      .filter((entree) => entree.isDirectory())
      .map((entree) => path.join(dossier, entree.name));
  } catch {
    return [];
  }
};

export const WSL = WINDOWS ? path.join(DOSSIER_SUR, "wsl.exe") : "wsl.exe";
export const EXPLORATEUR = WINDOWS ? path.join(process.env.SystemRoot ?? "C:\\Windows", "explorer.exe") : "explorer.exe";

const racinesProgrammes = () => [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);

function candidatsGh() {
  const liste = ["gh"];
  if (WINDOWS) {
    const racines = racinesProgrammes();
    if (process.env.LOCALAPPDATA) racines.push(path.join(process.env.LOCALAPPDATA, "Programs"));
    for (const racine of racines) liste.push(path.join(racine, "GitHub CLI", "gh.exe"));
  }
  return liste;
}

// Java installé avec Android Studio ou un JDK courant.
function candidatsKeytool() {
  const exe = WINDOWS ? "keytool.exe" : "keytool";
  const liste = ["keytool"];
  if (process.env.JAVA_HOME) liste.push(path.join(process.env.JAVA_HOME, "bin", exe));
  if (WINDOWS) {
    for (const racine of racinesProgrammes()) {
      liste.push(path.join(racine, "Android", "Android Studio", "jbr", "bin", exe));
      for (const editeur of ["Eclipse Adoptium", "Microsoft", "Java", "Zulu", "BellSoft"]) {
        for (const jdk of sousDossiers(path.join(racine, editeur))) liste.push(path.join(jdk, "bin", exe));
      }
    }
  }
  return liste;
}

// Trouve les programmes une fois, au premier besoin. `executerFn` est
// remplaçable dans les tests.
export function creerOutils(executerFn = executer, lancerFn = lancer) {
  const trouves = new Map();
  const trouver = async (nom, candidats, args) => {
    if (trouves.has(nom)) return trouves.get(nom);
    for (const candidat of candidats) {
      if ((await executerFn(candidat, args)).code === 0) {
        trouves.set(nom, candidat);
        return candidat;
      }
    }
    return null;
  };
  return {
    executer: executerFn,
    lancer: lancerFn,
    gh: () => trouver("gh", candidatsGh(), ["--version"]),
    keytool: () => trouver("keytool", candidatsKeytool(), ["-help"]),
    oublier: () => trouves.clear(),
  };
}
