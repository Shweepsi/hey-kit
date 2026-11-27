// Coffre chiffré : un seul fichier sur le PC, qui garde toutes les clés des apps.
//
// Format : un JSON lisible dont seul le champ `donnees` est secret.
// - clé de chiffrement dérivée du mot de passe maître par scrypt (sel aléatoire) ;
// - contenu chiffré en AES-256-GCM, nouvel IV à chaque enregistrement ;
// - l'en-tête (format, version, réglages scrypt, sel) est authentifié avec le
//   contenu : le modifier rend le coffre illisible au lieu de l'affaiblir.
// La clé dérivée reste en mémoire tant que le coffre est ouvert, jamais le mot
// de passe. Aucune valeur n'est journalisée.
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from "node:crypto";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

const FORMAT = "hey-kit-coffre";
const VERSION = 1;
// Environ 0,3 s et 128 Mo sur un PC récent : assez lent pour décourager les
// essais en série, assez rapide pour ne pas gêner à l'ouverture.
export const KDF_PAR_DEFAUT = Object.freeze({ N: 2 ** 17, r: 8, p: 1 });
export const LONGUEUR_MIN_MOT_DE_PASSE = 12;
const DOSSIER = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;
const NOM = /^[A-Z][A-Z0-9_]{0,63}$/;
const TYPES = new Set(["texte", "fichier"]);

// Erreur typée : `code` est traduit par l'interface, jamais affiché tel quel.
export class ErreurCoffre extends Error {
  constructor(code) {
    super(code);
    this.name = "ErreurCoffre";
    this.code = code;
  }
}

const memoire = (kdf) => 128 * kdf.N * kdf.r * 2;

function entete(kdf, sel) {
  return Buffer.from(JSON.stringify([FORMAT, VERSION, kdf.N, kdf.r, kdf.p, sel.toString("base64")]));
}

async function deriver(motDePasse, sel, kdf) {
  return scrypt(motDePasse.normalize("NFC"), sel, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: memoire(kdf) });
}

function valider(dossier, nom) {
  if (typeof dossier !== "string" || !DOSSIER.test(dossier)) throw new ErreurCoffre("dossier-invalide");
  if (nom !== undefined && (typeof nom !== "string" || !NOM.test(nom))) throw new ErreurCoffre("nom-invalide");
}

export class Coffre {
  #fichier;
  #kdfNeuf;
  #cle = null;
  #sel = null;
  #kdf = null;
  #donnees = null;
  // Les écritures passent l'une après l'autre : deux clics rapides ne se
  // marchent pas dessus.
  #file = Promise.resolve();

  constructor(fichier, { kdf = KDF_PAR_DEFAUT } = {}) {
    this.#fichier = fichier;
    this.#kdfNeuf = { ...kdf };
  }

  get fichier() {
    return this.#fichier;
  }

  get ouvert() {
    return this.#donnees !== null;
  }

  async existe() {
    try {
      await fs.access(this.#fichier);
      return true;
    } catch {
      return false;
    }
  }

  async creer(motDePasse) {
    if (typeof motDePasse !== "string" || [...motDePasse].length < LONGUEUR_MIN_MOT_DE_PASSE) {
      throw new ErreurCoffre("mot-de-passe-court");
    }
    if (await this.existe()) throw new ErreurCoffre("existe-deja");
    this.verrouiller();
    const sel = randomBytes(16);
    const kdf = { ...this.#kdfNeuf };
    this.#cle = await deriver(motDePasse, sel, kdf);
    this.#sel = sel;
    this.#kdf = kdf;
    this.#donnees = { dossiers: { Commun: {} } };
    await this.#sauver({ exclusif: true });
  }

  async ouvrir(motDePasse) {
    if (typeof motDePasse !== "string" || motDePasse === "") throw new ErreurCoffre("mot-de-passe");
    let brut;
    try {
      brut = await fs.readFile(this.#fichier, "utf8");
    } catch (erreur) {
      throw new ErreurCoffre(erreur?.code === "ENOENT" ? "absent" : "illisible");
    }
    let contenu;
    try {
      contenu = JSON.parse(brut);
    } catch {
      throw new ErreurCoffre("illisible");
    }
    const kdf = contenu?.kdf;
    const valide =
      contenu?.format === FORMAT &&
      contenu.version === VERSION &&
      Number.isInteger(kdf?.N) &&
      Number.isInteger(kdf?.r) &&
      Number.isInteger(kdf?.p) &&
      kdf.N >= 2 ** 10 &&
      kdf.N <= 2 ** 20 &&
      kdf.r >= 1 &&
      kdf.r <= 32 &&
      kdf.p >= 1 &&
      kdf.p <= 4 &&
      [contenu.sel, contenu.iv, contenu.tag, contenu.donnees].every((champ) => typeof champ === "string");
    if (!valide) throw new ErreurCoffre("illisible");
    const sel = Buffer.from(contenu.sel, "base64");
    const reglages = { N: kdf.N, r: kdf.r, p: kdf.p };
    const cle = await deriver(motDePasse, sel, reglages);
    let donnees;
    try {
      const dechiffreur = createDecipheriv("aes-256-gcm", cle, Buffer.from(contenu.iv, "base64"));
      dechiffreur.setAAD(entete(reglages, sel));
      dechiffreur.setAuthTag(Buffer.from(contenu.tag, "base64"));
      const clair = Buffer.concat([dechiffreur.update(Buffer.from(contenu.donnees, "base64")), dechiffreur.final()]);
      donnees = JSON.parse(clair.toString("utf8"));
      clair.fill(0);
    } catch {
      cle.fill(0);
      // Mauvais mot de passe et fichier modifié donnent la même erreur : GCM ne
      // permet pas de les distinguer, et c'est voulu.
      throw new ErreurCoffre("mot-de-passe");
    }
    if (typeof donnees?.dossiers !== "object" || donnees.dossiers === null) {
      cle.fill(0);
      throw new ErreurCoffre("illisible");
    }
    this.verrouiller();
    this.#cle = cle;
    this.#sel = sel;
    this.#kdf = reglages;
    this.#donnees = donnees;
  }

  verrouiller() {
    this.#cle?.fill(0);
    this.#cle = null;
    this.#sel = null;
    this.#kdf = null;
    this.#donnees = null;
  }

  // Ce que l'interface peut afficher : noms, types et dates, jamais les valeurs.
  lister() {
    const dossiers = this.#exiger().dossiers;
    const liste = {};
    for (const dossier of Object.keys(dossiers).sort((a, b) => a.localeCompare(b, "fr"))) {
      liste[dossier] = Object.entries(dossiers[dossier])
        .map(([nom, entree]) => ({
          nom,
          type: entree.type,
          nomFichier: entree.nomFichier ?? null,
          modifie: entree.modifie ?? null,
        }))
        .sort((a, b) => a.nom.localeCompare(b.nom));
    }
    return liste;
  }

  present(dossier, nom) {
    const dossiers = this.#exiger().dossiers;
    return Object.hasOwn(dossiers, dossier) && Object.hasOwn(dossiers[dossier], nom);
  }

  // Valeur telle qu'enregistrée : texte brut, ou base64 pour un fichier.
  lire(dossier, nom) {
    valider(dossier, nom);
    if (!this.present(dossier, nom)) return null;
    const entree = this.#donnees.dossiers[dossier][nom];
    return { type: entree.type, valeur: entree.valeur, nomFichier: entree.nomFichier ?? null };
  }

  async ecrire(dossier, nom, { type = "texte", valeur, nomFichier = null }) {
    valider(dossier, nom);
    this.#exiger();
    if (!TYPES.has(type) || typeof valeur !== "string" || valeur === "") throw new ErreurCoffre("valeur-invalide");
    if (type === "fichier" && !/^[A-Za-z0-9+/]+={0,2}$/.test(valeur)) throw new ErreurCoffre("valeur-invalide");
    const nomPropre = typeof nomFichier === "string" ? nomFichier.replace(/[^\p{L}\p{N} ._()-]/gu, "").slice(0, 128) : null;
    await this.#modifier((dossiers) => {
      if (!Object.hasOwn(dossiers, dossier)) dossiers[dossier] = {};
      dossiers[dossier][nom] = {
        type,
        valeur,
        ...(type === "fichier" && nomPropre ? { nomFichier: nomPropre } : {}),
        modifie: new Date().toISOString(),
      };
    });
  }

  async supprimer(dossier, nom) {
    valider(dossier, nom);
    this.#exiger();
    await this.#modifier((dossiers) => {
      if (!Object.hasOwn(dossiers, dossier) || !Object.hasOwn(dossiers[dossier], nom)) return;
      delete dossiers[dossier][nom];
      if (Object.keys(dossiers[dossier]).length === 0 && dossier !== "Commun") delete dossiers[dossier];
    });
  }

  async changerMotDePasse(ancien, nouveau) {
    if (typeof nouveau !== "string" || [...nouveau].length < LONGUEUR_MIN_MOT_DE_PASSE) {
      throw new ErreurCoffre("mot-de-passe-court");
    }
    this.#exiger();
    const verification = new Coffre(this.#fichier);
    await verification.ouvrir(ancien);
    verification.verrouiller();
    const sel = randomBytes(16);
    const kdf = { ...this.#kdfNeuf };
    const cle = await deriver(nouveau, sel, kdf);
    await this.#enFile(async () => {
      this.#cle.fill(0);
      this.#cle = cle;
      this.#sel = sel;
      this.#kdf = kdf;
      await this.#sauver();
    });
  }

  #exiger() {
    if (this.#donnees === null) throw new ErreurCoffre("verrouille");
    return this.#donnees;
  }

  #enFile(tache) {
    const suite = this.#file.then(tache, tache);
    this.#file = suite.catch(() => {});
    return suite;
  }

  // Modifie une copie et ne la garde qu'une fois écrite sur le disque : un
  // échec d'écriture ne laisse pas la mémoire et le fichier en désaccord.
  #modifier(changement) {
    return this.#enFile(async () => {
      const avant = this.#exiger();
      const copie = structuredClone(avant);
      changement(copie.dossiers);
      this.#donnees = copie;
      try {
        await this.#sauver();
      } catch (erreur) {
        this.#donnees = avant;
        throw erreur;
      }
    });
  }

  async #sauver({ exclusif = false } = {}) {
    const iv = randomBytes(12);
    const chiffreur = createCipheriv("aes-256-gcm", this.#cle, iv);
    chiffreur.setAAD(entete(this.#kdf, this.#sel));
    const clair = Buffer.from(JSON.stringify(this.#donnees), "utf8");
    const chiffre = Buffer.concat([chiffreur.update(clair), chiffreur.final()]);
    clair.fill(0);
    const contenu = `${JSON.stringify(
      {
        format: FORMAT,
        version: VERSION,
        kdf: this.#kdf,
        sel: this.#sel.toString("base64"),
        iv: iv.toString("base64"),
        tag: chiffreur.getAuthTag().toString("base64"),
        donnees: chiffre.toString("base64"),
      },
      null,
      2,
    )}\n`;
    if (exclusif) {
      try {
        await fs.writeFile(this.#fichier, contenu, { flag: "wx", mode: 0o600 });
      } catch (erreur) {
        throw new ErreurCoffre(erreur?.code === "EEXIST" ? "existe-deja" : "ecriture");
      }
      return;
    }
    // Écriture dans un fichier à côté puis remplacement : une coupure en plein
    // enregistrement laisse l'ancien coffre intact. La version précédente est
    // gardée en `.bak`.
    const temporaire = `${this.#fichier}.tmp`;
    try {
      await fs.writeFile(temporaire, contenu, { mode: 0o600 });
      await fs.copyFile(this.#fichier, `${this.#fichier}.bak`).catch(() => {});
      await fs.rename(temporaire, this.#fichier);
    } catch {
      await fs.rm(temporaire, { force: true }).catch(() => {});
      throw new ErreurCoffre("ecriture");
    }
  }
}
