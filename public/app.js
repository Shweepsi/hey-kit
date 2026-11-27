// Interface du kit : affiche et envoie, toute la logique est côté serveur local.
// Aucune valeur secrète n'est relue depuis le serveur : les champs secrets
// restent vides et un champ vide garde la valeur enregistrée.

const $ = (selecteur) => document.querySelector(selecteur);

const ERREURS = {
  "mot-de-passe": "Mot de passe incorrect.",
  "mot-de-passe-court": "Le mot de passe doit faire au moins 12 caractères.",
  "existe-deja": "Un coffre existe déjà à cet endroit.",
  absent: "Aucun coffre trouvé.",
  illisible: "Le fichier du coffre est abîmé ou n'est pas un coffre hey-kit. Essaie la copie .bak à côté.",
  verrouille: "Le coffre s'est verrouillé : ouvre-le à nouveau.",
  "dossier-invalide": "Nom de dossier invalide : lettres, chiffres, espaces, « . », « _ » ou « - ».",
  "nom-invalide": "Nom de clé invalide : majuscules, chiffres et « _ », en commençant par une lettre.",
  "valeur-invalide": "Valeur vide ou fichier illisible.",
  ecriture: "Impossible d'écrire le fichier du coffre (disque plein, droits, antivirus ?).",
  "trop-gros": "Fichier trop gros (2 Mo au plus).",
  session: "Session expirée : relance le kit et ouvre le nouveau lien.",
  reseau: "Le kit ne répond plus : la fenêtre où il tourne a peut-être été fermée.",
};
const erreurTexte = (code) => ERREURS[code] ?? "Erreur inattendue.";

// Libellés et guides de chaque connexion. Chaque étape a été relue dans la
// documentation officielle citée en source, à la date de VERIFIE_LE.
const VERIFIE_LE = "27 novembre 2026";
const CONNEXIONS = {
  github: {
    titre: "GitHub",
    lien: "https://github.com/settings/personal-access-tokens/new",
    champs: { GITHUB_TOKEN: "Jeton d'accès" },
    etapes: [
      "Clique sur « Ouvrir la page » : c'est Settings, Developer settings, Personal access tokens, Fine-grained tokens, Generate new token.",
      "Token name : « hey-kit ». Expiration : un an (tu le remplaceras ici à l'échéance).",
      "Resource owner : ton compte. Repository access : tes dépôts d'apps.",
      "Permissions, Repository permissions : Secrets et Variables en « Read and write ». Metadata en lecture est ajouté d'office.",
      "Generate token, copie le jeton et colle-le ci-dessous.",
    ],
    attention: ["Le jeton est lié à ton compte : s'il fuit, supprime-le sur la même page et crées-en un autre."],
    sources: [
      ["Gérer les jetons d'accès", "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens"],
    ],
  },
  cloudflare: {
    titre: "Cloudflare",
    lien: "https://dash.cloudflare.com/profile/api-tokens",
    champs: { CLOUDFLARE_API_TOKEN: "Jeton d'API", CLOUDFLARE_ACCOUNT_ID: "Identifiant du compte (32 caractères)" },
    etapes: [
      "Clique sur « Ouvrir la page » (My Profile, API Tokens), puis Create Token.",
      "Choisis le modèle « Edit Cloudflare Workers ».",
      "Ajoute une permission de compte pour D1 au niveau modification (« D1 », « Edit ») : le modèle ne la contient pas.",
      "Continue to summary, puis Create Token. Copie le jeton : il n'est affiché qu'une fois.",
      "Identifiant du compte : dans le tableau de bord, Workers & Pages, Account Details, Account ID (ou la recherche « Copy account ID »).",
    ],
    attention: ["Si le jeton n'apparaît plus, il faut en recréer un : Cloudflare ne le remontre jamais."],
    sources: [
      ["Créer un jeton", "https://developers.cloudflare.com/fundamentals/api/get-started/create-token/"],
      ["Modèles de jetons", "https://developers.cloudflare.com/fundamentals/api/reference/template/"],
      ["Trouver l'identifiant du compte", "https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/"],
    ],
  },
  apple: {
    titre: "Apple (App Store Connect)",
    lien: "https://appstoreconnect.apple.com/access/integrations/api",
    champs: { ASC_KEY_ID: "Key ID", ASC_ISSUER_ID: "Issuer ID", APPLE_TEAM_ID: "Team ID", ASC_KEY_P8: "Fichier .p8" },
    etapes: [
      "Clique sur « Ouvrir la page » : App Store Connect, Users and Access, onglet Integrations, App Store Connect API, onglet Team Keys. Il faut être Admin du compte.",
      "Issuer ID : affiché en haut de cette page, bouton Copy à côté. Colle-le ci-dessous.",
      "Generate API Key (ou +). Nom : « hey-kit ». Access : Admin. Generate.",
      "Key ID : dans la liste des clés actives, survole l'identifiant et clique sur Copy Key ID.",
      "Download API Key : le fichier AuthKey_….p8 arrive dans Téléchargements. Glisse-le dans le champ ci-dessous.",
      "Team ID : sur developer.apple.com/account, section « Membership details » (10 caractères).",
    ],
    attention: [
      "Le fichier .p8 ne se télécharge qu'une seule fois et Apple n'en garde pas de copie : enregistre-le ici tout de suite.",
      "Une fois enregistré, supprime-le de Téléchargements et vide la corbeille. Ne l'envoie jamais par message.",
    ],
    sources: [
      ["Créer une clé d'API", "https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api"],
      ["Issuer ID et Key ID", "https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests"],
      ["Team ID", "https://developer.apple.com/help/glossary/team-id"],
    ],
  },
  firebase: {
    titre: "Google (Firebase)",
    lien: "https://console.firebase.google.com/project/_/settings/serviceaccounts/adminsdk",
    champs: { FIREBASE_SERVICE_ACCOUNT: "Compte de service (fichier JSON)" },
    etapes: [
      "Clique sur « Ouvrir la page » et choisis ton projet : Paramètres (roue dentée), onglet Comptes de service (Service accounts).",
      "Generate New Private Key, puis Generate Key : un fichier JSON arrive dans Téléchargements.",
      "Glisse ce fichier dans le champ ci-dessous.",
    ],
    attention: [
      "Ce fichier donne un accès administrateur au projet. Google demande de ne pas le laisser dans Téléchargements : supprime-le et vide la corbeille dès qu'il est enregistré ici.",
      "En cas de fuite, supprime la clé tout de suite dans Google Cloud, IAM, Comptes de service, puis crées-en une autre ici.",
    ],
    sources: [
      ["Ajouter le SDK Admin (clé privée)", "https://firebase.google.com/docs/admin/setup"],
      ["Bonnes pratiques Google pour ces clés", "https://cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys"],
    ],
  },
  tmdb: {
    titre: "TMDB",
    lien: "https://www.themoviedb.org/settings/api",
    champs: { TMDB_API_KEY: "Clé ou jeton" },
    etapes: [
      "Connecte-toi à TMDB (plus simple sur ordinateur), puis clique sur « Ouvrir la page » (Paramètres, API).",
      "Demande une clé et accepte les conditions d'utilisation.",
      "Copie la clé d'API (v3) ou le jeton « API Read Access Token » : les deux marchent.",
    ],
    attention: [],
    sources: [["Premiers pas avec l'API", "https://developer.themoviedb.org/docs/getting-started"]],
  },
};

const ETATS = {
  ok: ["ok", "Connecté"],
  incomplet: ["attente", "Incomplet"],
  invalide: ["erreur", "Format invalide"],
  refuse: ["erreur", "Refusé par le service"],
  interdit: ["erreur", "Droits insuffisants"],
  injoignable: ["attente", "Service injoignable"],
};

function detailEtat(id, verification) {
  const champ = verification.champ ? CONNEXIONS[id]?.champs[verification.champ] ?? verification.champ : null;
  switch (verification.etat) {
    case "ok":
      return verification.compte ? `Compte : ${verification.compte}` : "La clé fonctionne.";
    case "incomplet":
      return `À remplir : ${champ}.`;
    case "invalide":
      return `Vérifie : ${champ}.`;
    case "refuse":
      return "Clé inconnue, expirée ou révoquée : recrée-la.";
    case "interdit":
      return "Clé reconnue, mais il lui manque des droits.";
    default:
      return "Réseau, proxy ou antivirus : réessaie plus tard.";
  }
}

async function api(chemin, corps) {
  let reponse;
  try {
    reponse = await fetch(chemin, {
      method: corps === undefined ? "GET" : "POST",
      headers: { "X-Hey-Kit": "1", ...(corps === undefined ? {} : { "Content-Type": "application/json" }) },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
  } catch {
    throw new Error("reseau");
  }
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    if (donnees.erreur === "verrouille") setTimeout(demarrer, 0);
    throw new Error(donnees.erreur ?? "interne");
  }
  return donnees;
}

function annoncer(texte, genre = "info") {
  const zone = $("#message");
  zone.textContent = texte;
  zone.dataset.genre = genre;
  zone.hidden = !texte;
}

function element(nom, attributs = {}, ...enfants) {
  const noeud = document.createElement(nom);
  for (const [cle, valeur] of Object.entries(attributs)) {
    if (cle === "classe") noeud.className = valeur;
    else if (cle === "texte") noeud.textContent = valeur;
    else if (valeur !== false && valeur !== undefined) noeud.setAttribute(cle, valeur === true ? "" : valeur);
  }
  noeud.append(...enfants.filter(Boolean));
  return noeud;
}

// Lit un fichier en base64, sans passer par une URL de données.
async function lireFichier(fichier) {
  if (fichier.size > 1.5 * 1024 * 1024) throw new Error("trop-gros");
  const octets = new Uint8Array(await fichier.arrayBuffer());
  let binaire = "";
  for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(binaire);
}

let etat = null;
let onglet = "connexions";

function montrer(vue) {
  for (const id of ["creer", "ouvrir", "connexions", "coffre", "reglages"]) $(`#vue-${id}`).hidden = id !== vue;
  const ouvert = ["connexions", "coffre", "reglages"].includes(vue);
  $("#onglets").hidden = !ouvert;
  $("#verrouiller").hidden = !ouvert;
  for (const bouton of document.querySelectorAll("[data-onglet]")) {
    bouton.setAttribute("aria-pressed", String(bouton.dataset.onglet === vue));
  }
}

async function demarrer() {
  try {
    etat = await api("/api/etat");
  } catch (probleme) {
    annoncer(erreurTexte(probleme.message), "erreur");
    return;
  }
  $("#version").textContent = `v${etat.version}`;
  for (const id of ["#chemin-creer", "#chemin-ouvrir", "#chemin-reglages"]) $(id).textContent = etat.fichier;
  if (etat.coffre === "absent") return montrer("creer");
  if (etat.coffre === "verrouille") {
    montrer("ouvrir");
    return $("#form-ouvrir input").focus();
  }
  return afficherOnglet(onglet);
}

async function afficherOnglet(nom) {
  onglet = nom;
  montrer(nom);
  if (nom === "connexions") await afficherConnexions();
  if (nom === "coffre") await afficherCoffre();
}

// --- Connexions ---------------------------------------------------------------

function badge(id, verification) {
  if (!verification) return element("span", { classe: "badge attente", texte: "Pas encore vérifié" });
  const [genre, texte] = ETATS[verification.etat] ?? ["attente", "Inconnu"];
  return element("span", { classe: `badge ${genre}`, texte, title: detailEtat(id, verification) });
}

const lienExterne = (texte, href) => element("a", { href, target: "_blank", rel: "noopener noreferrer", texte });

// Guide pas à pas, ouvert tant que la connexion n'est pas remplie.
function guide(libelles, ouvert) {
  return element(
    "details",
    { classe: "guide", open: ouvert },
    element("summary", { texte: "Guide pas à pas" }),
    element("ol", {}, ...libelles.etapes.map((etape) => element("li", { texte: etape }))),
    ...libelles.attention.map((texte) => element("p", { classe: "avertissement", texte })),
    element(
      "p",
      { classe: "discret" },
      "Sources officielles : ",
      ...libelles.sources.flatMap(([texte, href], i) => [i > 0 ? " · " : "", lienExterne(texte, href)]),
      `. Vérifié le ${VERIFIE_LE}.`,
    ),
  );
}

function carteConnexion(connexion) {
  const libelles = CONNEXIONS[connexion.id];
  const formulaire = element("form", { classe: "carte formulaire connexion" });
  const etatZone = element("div", { classe: "etat" });
  const majEtat = (verification) => {
    etatZone.replaceChildren(badge(connexion.id, verification));
    if (verification) etatZone.append(element("span", { classe: "discret", texte: detailEtat(connexion.id, verification) }));
  };
  majEtat(connexion.verification);

  formulaire.append(
    element("div", { classe: "entete" }, element("h2", { texte: libelles.titre }), etatZone),
    element("a", { classe: "bouton secondaire", href: libelles.lien, target: "_blank", rel: "noopener noreferrer", texte: "Ouvrir la page" }),
    guide(libelles, !connexion.champs.every((champ) => champ.present)),
  );

  for (const champ of connexion.champs) {
    const libelle = libelles.champs[champ.nom] ?? champ.nom;
    let saisie;
    if (champ.type === "fichier") {
      saisie = element("input", { type: "file", name: champ.nom });
    } else if (champ.type === "secret") {
      saisie = element("input", {
        type: "password",
        name: champ.nom,
        autocomplete: "off",
        placeholder: champ.present ? "Enregistré (laisser vide pour garder)" : "",
      });
    } else {
      saisie = element("input", { type: "text", name: champ.nom, autocomplete: "off", spellcheck: "false" });
      saisie.value = champ.valeur ?? "";
    }
    const presence =
      champ.type === "fichier" && champ.present ? element("span", { classe: "discret", texte: " (enregistré)" }) : null;
    formulaire.append(element("label", {}, libelle, presence, saisie));
  }

  const bouton = element("button", { type: "submit", classe: "bouton", texte: "Enregistrer et vérifier" });
  formulaire.append(bouton);

  formulaire.addEventListener("submit", async (evenement) => {
    evenement.preventDefault();
    bouton.disabled = true;
    bouton.textContent = "Vérification…";
    try {
      const champs = {};
      for (const champ of connexion.champs) {
        const saisie = formulaire.elements[champ.nom];
        if (champ.type === "fichier") {
          const fichier = saisie.files[0];
          if (fichier) champs[champ.nom] = { valeur: await lireFichier(fichier), nomFichier: fichier.name };
        } else if (saisie.value.trim() !== "") {
          champs[champ.nom] = { valeur: saisie.value };
        }
      }
      const { verification } = await api("/api/connexions/enregistrer", { id: connexion.id, champs });
      majEtat(verification);
      for (const champ of connexion.champs) {
        const saisie = formulaire.elements[champ.nom];
        if (champ.type !== "texte") saisie.value = "";
        if (champ.type === "secret" && champs[champ.nom]) saisie.placeholder = "Enregistré (laisser vide pour garder)";
      }
      annoncer("");
    } catch (probleme) {
      annoncer(erreurTexte(probleme.message), "erreur");
    } finally {
      bouton.disabled = false;
      bouton.textContent = "Enregistrer et vérifier";
    }
  });
  return formulaire;
}

async function afficherConnexions() {
  const { connexions } = await api("/api/connexions");
  $("#liste-connexions").replaceChildren(...connexions.map(carteConnexion));
}

// --- Coffre ---------------------------------------------------------------------

function ligneEntree(dossier, entree) {
  const supprimer = element("button", { type: "button", classe: "bouton lien", texte: "Supprimer" });
  let confirme = false;
  supprimer.addEventListener("click", async () => {
    if (!confirme) {
      confirme = true;
      supprimer.textContent = "Confirmer la suppression";
      supprimer.classList.add("danger");
      return;
    }
    try {
      await api("/api/coffre/supprimer", { dossier, nom: entree.nom });
      await afficherCoffre();
    } catch (probleme) {
      annoncer(erreurTexte(probleme.message), "erreur");
    }
  });
  const date = entree.modifie ? new Date(entree.modifie).toLocaleDateString("fr-FR", { dateStyle: "medium" }) : "";
  return element(
    "tr",
    {},
    element("td", {}, element("code", { texte: entree.nom })),
    element("td", { texte: entree.type === "fichier" ? `Fichier ${entree.nomFichier ?? ""}`.trim() : "Texte" }),
    element("td", { texte: date }),
    element("td", {}, supprimer),
  );
}

async function afficherCoffre() {
  const { dossiers } = await api("/api/coffre");
  const blocs = Object.entries(dossiers).map(([dossier, entrees]) =>
    element(
      "div",
      { classe: "carte" },
      element("h2", { texte: dossier }),
      entrees.length === 0
        ? element("p", { classe: "discret", texte: "Vide pour l'instant." })
        : element(
            "table",
            {},
            element(
              "thead",
              {},
              element("tr", {}, ...["Nom", "Type", "Modifié", ""].map((titre) => element("th", { texte: titre }))),
            ),
            element("tbody", {}, ...entrees.map((entree) => ligneEntree(dossier, entree))),
          ),
    ),
  );
  $("#liste-coffre").replaceChildren(...blocs);
  $("#dossiers").replaceChildren(...Object.keys(dossiers).map((dossier) => element("option", { value: dossier })));
}

function brancherAjout() {
  const formulaire = $("#form-ajouter");
  const basculer = () => {
    const type = formulaire.elements.type.value;
    for (const zone of formulaire.querySelectorAll("[data-pour]")) zone.hidden = zone.dataset.pour !== type;
  };
  for (const radio of formulaire.elements.type) radio.addEventListener("change", basculer);
  formulaire.addEventListener("submit", async (evenement) => {
    evenement.preventDefault();
    const type = formulaire.elements.type.value;
    try {
      const corps = { dossier: formulaire.elements.dossier.value.trim(), nom: formulaire.elements.nom.value.trim(), type };
      if (type === "fichier") {
        const fichier = formulaire.elements.fichier.files[0];
        if (!fichier) throw new Error("valeur-invalide");
        corps.valeur = await lireFichier(fichier);
        corps.nomFichier = fichier.name;
      } else {
        corps.valeur = formulaire.elements.valeur.value;
      }
      await api("/api/coffre/ecrire", corps);
      formulaire.elements.nom.value = "";
      formulaire.elements.valeur.value = "";
      formulaire.elements.fichier.value = "";
      annoncer("Clé enregistrée.", "ok");
      await afficherCoffre();
    } catch (probleme) {
      annoncer(erreurTexte(probleme.message), "erreur");
    }
  });
}

// --- Démarrage ----------------------------------------------------------------

function brancher() {
  $("#form-creer").addEventListener("submit", async (evenement) => {
    evenement.preventDefault();
    const { motDePasse, confirmation } = evenement.target.elements;
    if (motDePasse.value !== confirmation.value) return annoncer("Les deux mots de passe sont différents.", "erreur");
    try {
      await api("/api/coffre/creer", { motDePasse: motDePasse.value });
      evenement.target.reset();
      annoncer("Coffre créé. Commence par tes connexions.", "ok");
      await demarrer();
    } catch (probleme) {
      annoncer(erreurTexte(probleme.message), "erreur");
    }
  });

  $("#form-ouvrir").addEventListener("submit", async (evenement) => {
    evenement.preventDefault();
    const champ = evenement.target.elements.motDePasse;
    try {
      await api("/api/coffre/ouvrir", { motDePasse: champ.value });
      evenement.target.reset();
      annoncer("");
      await demarrer();
    } catch (probleme) {
      champ.select();
      annoncer(erreurTexte(probleme.message), "erreur");
    }
  });

  $("#form-mot-de-passe").addEventListener("submit", async (evenement) => {
    evenement.preventDefault();
    const { ancien, nouveau, confirmation } = evenement.target.elements;
    if (nouveau.value !== confirmation.value) return annoncer("Les deux nouveaux mots de passe sont différents.", "erreur");
    try {
      await api("/api/coffre/mot-de-passe", { ancien: ancien.value, nouveau: nouveau.value });
      evenement.target.reset();
      annoncer("Mot de passe maître changé. Mets-le à jour dans ton gestionnaire de mots de passe.", "ok");
    } catch (probleme) {
      annoncer(erreurTexte(probleme.message), "erreur");
    }
  });

  $("#verrouiller").addEventListener("click", async () => {
    await api("/api/coffre/verrouiller", {}).catch(() => {});
    annoncer("");
    await demarrer();
  });

  for (const bouton of document.querySelectorAll("[data-onglet]")) {
    bouton.addEventListener("click", () => {
      annoncer("");
      afficherOnglet(bouton.dataset.onglet).catch((probleme) => annoncer(erreurTexte(probleme.message), "erreur"));
    });
  }
  brancherAjout();
}

brancher();
demarrer();
