#!/usr/bin/env node
// hey-kit : ouvre la page de configuration de tes apps dans le navigateur.
//
//   node kit.mjs                    ouvre le navigateur
//   node kit.mjs --sans-navigateur  affiche seulement le lien
//
// Le coffre est rangé dans Documents\hey-kit (ou dans HEY_KIT_DIR si défini).
// Tout reste sur ce PC : le serveur n'écoute que sur 127.0.0.1.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { Coffre } from "./src/coffre.mjs";
import { creerServeur } from "./src/serveur.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(ICI, "package.json"), "utf8")).version;
const WINDOWS = process.platform === "win32";

const args = process.argv.slice(2);
const inconnus = args.filter((arg) => arg !== "--sans-navigateur");
if (inconnus.length > 0) {
  process.stderr.write("Usage : node kit.mjs [--sans-navigateur]\n");
  process.exit(2);
}

// Windows cherche d'abord un exécutable dans le dossier courant (souvent
// Téléchargements) : on l'interdit et on lance tout depuis un dossier système.
if (WINDOWS) process.env.NoDefaultCurrentDirectoryInExePath = "1";
const DOSSIER_SUR = WINDOWS ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32") : os.homedir();

// Un antivirus qui inspecte HTTPS installe son certificat dans le magasin de
// Windows, que Node ignore par défaut.
if (WINDOWS && typeof tls.setDefaultCACertificates === "function" && typeof tls.getCACertificates === "function") {
  try {
    tls.setDefaultCACertificates([...tls.getCACertificates("default"), ...tls.getCACertificates("system")]);
  } catch {
    // on garde le magasin de certificats de Node
  }
}

const dossier = process.env.HEY_KIT_DIR ? path.resolve(process.env.HEY_KIT_DIR) : path.join(os.homedir(), "Documents", "hey-kit");
fs.mkdirSync(dossier, { recursive: true });

const jeton = randomBytes(32).toString("base64url");
const coffre = new Coffre(path.join(dossier, "coffre.hey-kit"));
const serveur = creerServeur({ coffre, jeton, dossierPublic: path.join(ICI, "public"), version: VERSION });

function ouvrirNavigateur(url) {
  const [commande, arguments_] = WINDOWS
    ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  try {
    const enfant = spawn(commande, arguments_, { cwd: DOSSIER_SUR, stdio: "ignore", detached: true });
    enfant.on("error", () => {});
    enfant.unref();
  } catch {
    // le lien reste affiché dans la console
  }
}

serveur.listen(0, "127.0.0.1", () => {
  const { port } = serveur.address();
  const lien = `http://127.0.0.1:${port}/ouvrir?t=${jeton}`;
  process.stdout.write(`\nhey-kit ${VERSION}\n`);
  process.stdout.write(`Coffre : ${coffre.fichier}\n\n`);
  process.stdout.write(`Page du kit (garde ce lien pour toi) :\n  ${lien}\n\n`);
  process.stdout.write("Ferme cette fenêtre ou fais Ctrl+C pour arrêter le kit et verrouiller le coffre.\n");
  if (!args.includes("--sans-navigateur")) ouvrirNavigateur(lien);
});

function arreter() {
  coffre.verrouiller();
  serveur.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", arreter);
process.on("SIGTERM", arreter);
