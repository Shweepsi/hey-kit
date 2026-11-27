import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Coffre, ErreurCoffre } from "../src/coffre.mjs";

// scrypt allégé : les tests restent rapides, le format est le même.
const KDF = { N: 2 ** 10, r: 8, p: 1 };
const MOT = "correct cheval pile agrafe";

async function dossierTemporaire() {
  return fs.mkdtemp(path.join(os.tmpdir(), "hey-kit-"));
}

async function nouveauCoffre() {
  const fichier = path.join(await dossierTemporaire(), "coffre.hey-kit");
  return { fichier, coffre: new Coffre(fichier, { kdf: KDF }) };
}

const code = (attendu) => (erreur) => erreur instanceof ErreurCoffre && erreur.code === attendu;

test("création, écriture, relecture après réouverture", async () => {
  const { fichier, coffre } = await nouveauCoffre();
  assert.equal(await coffre.existe(), false);
  await coffre.creer(MOT);
  await coffre.ecrire("Commun", "GITHUB_TOKEN", { valeur: "ghp_exemple" });
  await coffre.ecrire("HeyWatchlist", "ASC_KEY_P8", { type: "fichier", valeur: Buffer.from("cle").toString("base64"), nomFichier: "AuthKey.p8" });
  coffre.verrouiller();
  assert.equal(coffre.ouvert, false);

  const autre = new Coffre(fichier);
  await autre.ouvrir(MOT);
  assert.deepEqual(autre.lire("Commun", "GITHUB_TOKEN"), { type: "texte", valeur: "ghp_exemple", nomFichier: null });
  assert.equal(autre.lire("HeyWatchlist", "ASC_KEY_P8").nomFichier, "AuthKey.p8");
  assert.deepEqual(Object.keys(autre.lister()), ["Commun", "HeyWatchlist"]);
});

test("le fichier ne contient aucune valeur en clair", async () => {
  const { fichier, coffre } = await nouveauCoffre();
  await coffre.creer(MOT);
  await coffre.ecrire("Commun", "SECRET_TEST", { valeur: "valeur-tres-reconnaissable" });
  const brut = await fs.readFile(fichier, "utf8");
  assert.ok(!brut.includes("valeur-tres-reconnaissable"));
  assert.ok(!brut.includes("SECRET_TEST"));
  assert.ok(!brut.includes(MOT));
});

test("la liste n'expose jamais les valeurs", async () => {
  const { coffre } = await nouveauCoffre();
  await coffre.creer(MOT);
  await coffre.ecrire("Commun", "TMDB_API_KEY", { valeur: "abc" });
  assert.ok(!JSON.stringify(coffre.lister()).includes("abc"));
});

test("mauvais mot de passe", async () => {
  const { fichier, coffre } = await nouveauCoffre();
  await coffre.creer(MOT);
  const autre = new Coffre(fichier);
  await assert.rejects(autre.ouvrir("pas le bon mot de passe"), code("mot-de-passe"));
  assert.equal(autre.ouvert, false);
});

test("un en-tête modifié rend le coffre illisible", async () => {
  const { fichier, coffre } = await nouveauCoffre();
  await coffre.creer(MOT);
  const contenu = JSON.parse(await fs.readFile(fichier, "utf8"));
  contenu.kdf.N = 2 ** 11;
  await fs.writeFile(fichier, JSON.stringify(contenu));
  await assert.rejects(new Coffre(fichier).ouvrir(MOT), code("mot-de-passe"));
});

test("fichier qui n'est pas un coffre", async () => {
  const { fichier } = await nouveauCoffre();
  await fs.writeFile(fichier, "pas du json");
  await assert.rejects(new Coffre(fichier).ouvrir(MOT), code("illisible"));
  await fs.writeFile(fichier, JSON.stringify({ format: "autre" }));
  await assert.rejects(new Coffre(fichier).ouvrir(MOT), code("illisible"));
});

test("coffre absent", async () => {
  const { coffre } = await nouveauCoffre();
  await assert.rejects(coffre.ouvrir(MOT), code("absent"));
});

test("mot de passe trop court et création en double refusés", async () => {
  const { fichier, coffre } = await nouveauCoffre();
  await assert.rejects(coffre.creer("court"), code("mot-de-passe-court"));
  await coffre.creer(MOT);
  await assert.rejects(new Coffre(fichier, { kdf: KDF }).creer(MOT), code("existe-deja"));
});

test("opérations refusées coffre verrouillé", async () => {
  const { coffre } = await nouveauCoffre();
  assert.throws(() => coffre.lister(), code("verrouille"));
  await assert.rejects(coffre.ecrire("Commun", "NOM", { valeur: "x" }), code("verrouille"));
});

test("noms et valeurs validés", async () => {
  const { coffre } = await nouveauCoffre();
  await coffre.creer(MOT);
  await assert.rejects(coffre.ecrire("__proto__", "NOM", { valeur: "x" }), code("dossier-invalide"));
  await assert.rejects(coffre.ecrire("Commun", "minuscule", { valeur: "x" }), code("nom-invalide"));
  await assert.rejects(coffre.ecrire("Commun", "NOM", { valeur: "" }), code("valeur-invalide"));
  await assert.rejects(coffre.ecrire("Commun", "NOM", { type: "fichier", valeur: "pas base64 !" }), code("valeur-invalide"));
  await assert.rejects(coffre.ecrire("Commun", "NOM", { type: "autre", valeur: "x" }), code("valeur-invalide"));
});

test("un dossier « constructor » ne casse rien", async () => {
  const { coffre } = await nouveauCoffre();
  await coffre.creer(MOT);
  assert.equal(coffre.present("constructor", "NOM"), false);
  await coffre.ecrire("constructor", "NOM", { valeur: "x" });
  assert.equal(coffre.lire("constructor", "NOM").valeur, "x");
});

test("suppression, et dossier vide retiré sauf Commun", async () => {
  const { coffre } = await nouveauCoffre();
  await coffre.creer(MOT);
  await coffre.ecrire("App", "CLE", { valeur: "x" });
  await coffre.supprimer("App", "CLE");
  assert.deepEqual(Object.keys(coffre.lister()), ["Commun"]);
  await coffre.supprimer("Commun", "ABSENTE");
});

test("chaque enregistrement garde la version précédente en .bak", async () => {
  const { fichier, coffre } = await nouveauCoffre();
  await coffre.creer(MOT);
  await coffre.ecrire("Commun", "A", { valeur: "1" });
  await coffre.ecrire("Commun", "B", { valeur: "2" });
  const sauvegarde = new Coffre(`${fichier}.bak`);
  await sauvegarde.ouvrir(MOT);
  assert.equal(sauvegarde.present("Commun", "A"), true);
  assert.equal(sauvegarde.present("Commun", "B"), false);
});

test("écritures simultanées toutes conservées", async () => {
  const { fichier, coffre } = await nouveauCoffre();
  await coffre.creer(MOT);
  await Promise.all(["A", "B", "C", "D"].map((nom) => coffre.ecrire("Commun", nom, { valeur: nom })));
  const autre = new Coffre(fichier);
  await autre.ouvrir(MOT);
  assert.deepEqual(autre.lister().Commun.map((entree) => entree.nom), ["A", "B", "C", "D"]);
});

test("changement de mot de passe maître", async () => {
  const { fichier, coffre } = await nouveauCoffre();
  await coffre.creer(MOT);
  await coffre.ecrire("Commun", "A", { valeur: "1" });
  await assert.rejects(coffre.changerMotDePasse("faux mot de passe", "nouveau mot de passe long"), code("mot-de-passe"));
  await coffre.changerMotDePasse(MOT, "nouveau mot de passe long");
  await assert.rejects(new Coffre(fichier).ouvrir(MOT), code("mot-de-passe"));
  const autre = new Coffre(fichier);
  await autre.ouvrir("nouveau mot de passe long");
  assert.equal(autre.lire("Commun", "A").valeur, "1");
});

test("les notes survivent à la fermeture et restent chiffrées", async () => {
  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), "hey-kit-notes-"));
  const fichier = path.join(dossier, "coffre.hey-kit");
  const coffre = new Coffre(fichier, { kdf: { N: 2 ** 10, r: 8, p: 1 } });
  await coffre.creer("mot de passe des notes");
  assert.equal(coffre.lireNote("verification:github"), null);
  await coffre.ecrireNote("verification:github", { etat: "ok", compte: "exemple-de-compte" });
  coffre.verrouiller();
  assert.ok(!(await fs.readFile(fichier, "utf8")).includes("exemple-de-compte"));
  await coffre.ouvrir("mot de passe des notes");
  assert.deepEqual(coffre.lireNote("verification:github"), { etat: "ok", compte: "exemple-de-compte" });
  await coffre.ecrireNote("verification:github", null);
  assert.equal(coffre.lireNote("verification:github"), null);
  assert.ok(coffre.lister().Commun);
});
