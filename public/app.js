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
  "keytool-absent": "Java (keytool) introuvable : installe Android Studio, ou un JDK 17 (winget install --id EclipseAdoptium.Temurin.17.JDK -e), puis réessaie.",
  "keytool-echec": "Java n'a pas pu lire ou créer la clé Android.",
  "keystore-mot-de-passe": "Le mot de passe de la clé Android rangé dans le coffre ne correspond pas au fichier de la clé. Rien n'a été modifié : vérifie ANDROID_KEYSTORE_PASSWORD dans l'onglet Coffre.",
  "keystore-alias": "Le fichier de la clé Android ne contient pas la clé « heywatchlist ». Rien n'a été modifié.",
  "keystore-absent": "La clé Android n'est pas dans le coffre : reprends l'ancienne sauvegarde ou lance un envoi.",
  "requete-invalide": "Requête refusée par le kit.",
  session: "Session expirée : relance le kit et ouvre le nouveau lien.",
  reseau: "Le kit ne répond plus : la fenêtre où il tourne a peut-être été fermée.",
};
// `detail` : message technique (en anglais) d'un outil comme Java, sans secret.
const erreurTexte = (code, detail) => `${ERREURS[code] ?? "Erreur inattendue."}${detail ? ` Détail : ${detail}` : ""}`;

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
    const probleme = new Error(donnees.erreur ?? "interne");
    if (typeof donnees.detail === "string") probleme.detail = donnees.detail;
    throw probleme;
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
  for (const id of ["creer", "ouvrir", "connexions", "apps", "coffre", "reglages"]) $(`#vue-${id}`).hidden = id !== vue;
  const ouvert = ["connexions", "apps", "coffre", "reglages"].includes(vue);
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
  if (nom === "apps") await afficherApps();
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

// « aujourd'hui à 15:02 » ou « le 27 nov. 2026 à 15:02 ».
function dateVerification(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const heure = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const jour = date.toDateString() === new Date().toDateString() ? "aujourd'hui" : `le ${date.toLocaleDateString("fr-FR", { dateStyle: "medium" })}`;
  return `${jour} à ${heure}`;
}

function carteConnexion(connexion) {
  const libelles = CONNEXIONS[connexion.id];
  const formulaire = element("form", { classe: "carte formulaire connexion" });
  const etatZone = element("div", { classe: "etat" });
  const majEtat = (verification) => {
    etatZone.replaceChildren(badge(connexion.id, verification));
    if (!verification) return;
    etatZone.append(element("span", { classe: "discret", texte: detailEtat(connexion.id, verification) }));
    if (verification.le) etatZone.append(element("span", { classe: "discret", texte: `Vérifié ${dateVerification(verification.le)}` }));
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

// --- Mes apps ------------------------------------------------------------------

const ELEMENTS = {
  CLOUDFLARE_API_TOKEN: "Jeton Cloudflare (déploiement du serveur)",
  CLOUDFLARE_ACCOUNT_ID: "Compte Cloudflare",
  HEYWATCHLIST_API_URL: "Adresse du serveur, inscrite dans les apps",
  ASC_KEY_ID: "Clé App Store Connect : Key ID",
  ASC_ISSUER_ID: "Clé App Store Connect : Issuer ID",
  ASC_KEY_P8: "Clé App Store Connect : fichier .p8",
  APPLE_TEAM_ID: "Team ID Apple",
  MATCH_GIT_URL: "Dépôt des certificats iOS",
  MATCH_GIT_TOKEN: "Jeton du dépôt des certificats iOS",
  MATCH_PASSWORD: "Phrase qui chiffre les certificats iOS",
  ANDROID_KEYSTORE_BASE64: "Clé de signature Android",
  ANDROID_KEYSTORE_PASSWORD: "Clé Android : mot de passe",
  ANDROID_KEY_ALIAS: "Clé Android : alias",
  ANDROID_KEY_PASSWORD: "Clé Android : mot de passe de la clé",
  GOOGLE_SERVICES_JSON: "Réglages Firebase (google-services.json)",
  SESSION_SIGNING_KEY: "Clé des sessions",
  CREDENTIALS_KEY: "Clé des réglages admin",
  BOOTSTRAP_CODE: "Code administrateur (première connexion)",
  TMDB_API_KEY: "Clé TMDB",
  FCM_SERVICE_ACCOUNT: "Compte de service Firebase (notifications Android)",
  GOOGLE_WEB_CLIENT_ID: "Client Google « Web application »",
  GOOGLE_IOS_CLIENT_ID: "Client Google « iOS »",
  APPLE_SIGNIN_KEY_ID: "Clé Sign in with Apple : Key ID",
  APPLE_SIGNIN_PRIVATE_KEY: "Clé Sign in with Apple : fichier .p8",
  APNS_KEY_ID: "Clé APNs : Key ID",
  APNS_PRIVATE_KEY: "Clé APNs : fichier .p8",
};

const SOURCES = {
  commun: "Depuis Connexions",
  fixe: "Valeur fixe",
  "url-worker": "Lue chez Cloudflare",
  genere: "Créée par le kit",
  keystore: "Créée par le kit (Java) ou reprise",
  saisie: "À fournir ci-dessous",
};
const DESTINATIONS = { secret: "secret GitHub", variable: "variable GitHub", worker: "serveur" };

const ETATS_ELEMENT = {
  "en-place": ["ok", "En place"],
  "a-envoyer": ["attente", "À envoyer"],
  "a-fournir": ["attente", "À fournir"],
  inconnu: ["attente", "Inconnu"],
};

const ACCES = {
  ok: ["ok", "Accessible"],
  incomplet: ["attente", "Connexion à remplir"],
  refuse: ["erreur", "Jeton refusé"],
  interdit: ["erreur", "Droits insuffisants"],
  introuvable: ["erreur", "Introuvable"],
  injoignable: ["attente", "Injoignable"],
};

function detailAcces(service, etatAcces) {
  const github = service === "github";
  switch (etatAcces) {
    case "incomplet":
      return github ? "Remplis GitHub dans Connexions." : "Remplis Cloudflare dans Connexions.";
    case "refuse":
      return "Le jeton est expiré ou révoqué : remplace-le dans Connexions.";
    case "interdit":
      return github
        ? "Le jeton GitHub doit avoir Secrets et Variables en « Read and write » sur ce dépôt."
        : "Le jeton Cloudflare doit pouvoir modifier les Workers (modèle « Edit Cloudflare Workers »).";
    case "introuvable":
      return github
        ? "Dépôt invisible pour ce jeton : ajoute-le dans « Repository access » du jeton."
        : "Le Worker n'existe pas encore : il est créé au premier déploiement par GitHub.";
    case "injoignable":
      return "Réseau, proxy ou antivirus : réessaie plus tard.";
    default:
      return "";
  }
}

const RESULTATS = {
  "gh-absent": "GitHub CLI introuvable : installe-le (winget install --id GitHub.cli -e), puis relance l'envoi.",
  "keytool-absent": ERREURS["keytool-absent"],
  "keytool-echec": ERREURS["keytool-echec"],
  refuse: "jeton refusé",
  interdit: "droits insuffisants",
  introuvable: "dépôt ou Worker introuvable",
  injoignable: "service injoignable",
  echec: "échec de l'envoi",
};

// Guides des valeurs à fournir. Chaque étape vient de la page officielle citée.
const PROJET_GOOGLE = "heywatchlist-60448";
const pageGoogle = (page) => `https://console.developers.google.com/auth/${page}?project=${PROJET_GOOGLE}`;
const SAISIES = [
  {
    titre: "Connexion avec Google",
    elements: ["GOOGLE_WEB_CLIENT_ID", "GOOGLE_IOS_CLIENT_ID"],
    empreinte: true,
    resteAVerifier:
      "Les deux clients que le serveur utilise sont en place. Le kit ne peut pas voir le reste de la console Google : vérifie sur la page Clients que les deux clients Android existent (paquets io.github.shweepsi.heywatchlist et .admin, avec l'empreinte SHA-1 ci-dessous), et sur la page Audience que l'état est « In production ».",
    liens: [
      ["Branding", pageGoogle("branding")],
      ["Audience", pageGoogle("audience")],
      ["Clients", pageGoogle("clients")],
    ],
    etapes: [
      `Vérifie en haut de chaque page que le projet choisi est ${PROJET_GOOGLE}.`,
      "Branding : remplis « App Information » (nom HeyWatchlist, ton e-mail d'assistance) et « Developer contact information », puis Save.",
      "Audience : type d'utilisateur « External » (tout compte Google). Pour ouvrir l'app à tous, bouton « Publish app » : l'état passe de « Testing » à « In production ».",
      "Clients : CREATE CLIENT, type « Web application », nom « HeyWatchlist serveur ». Les origines et les adresses de redirection ne servent qu'aux sites web : laisse-les vides. CREATE, puis copie le Client ID dans le premier champ ci-dessous.",
      "CREATE CLIENT, type « iOS », Bundle ID io.github.shweepsi.heywatchlist (App Store ID et Team ID sont facultatifs). CREATE, puis copie le Client ID dans le second champ.",
      "CREATE CLIENT, type « Android », deux fois : Package name io.github.shweepsi.heywatchlist, puis io.github.shweepsi.heywatchlist.admin. Pour les deux, la même empreinte « SHA1 fingerprint » (bouton plus bas). Rien à recopier ensuite : il suffit que ces clients existent.",
    ],
    attention: [
      "Tant que l'app est en « Testing », Google la limite à 100 comptes de test. Comme HeyWatchlist ne demande que le nom et l'adresse e-mail, ces comptes n'ont pas à être listés.",
      "Google affiche aussi un « client secret » : les apps n'en ont pas besoin, ne le copie nulle part.",
    ],
    sources: [
      ["Branding", "https://support.google.com/cloud/answer/15549049"],
      ["Audience", "https://support.google.com/cloud/answer/15549945"],
      ["Clients OAuth", "https://support.google.com/cloud/answer/15549257"],
      ["Empreinte Android", "https://developers.google.com/android/guides/client-auth"],
      ["Client iOS", "https://developers.google.com/identity/sign-in/ios/start-integrating"],
    ],
  },
  {
    titre: "Notifications Android (google-services.json)",
    elements: ["GOOGLE_SERVICES_JSON"],
    liens: [["Console Firebase", `https://console.firebase.google.com/project/${PROJET_GOOGLE}/settings/general`]],
    etapes: [
      `Ouvre la console Firebase, projet ${PROJET_GOOGLE}.`,
      "Si l'app Android n'y est pas encore : ajoute une app Android, « Android package name » io.github.shweepsi.heywatchlist, puis Register app. Fais de même pour io.github.shweepsi.heywatchlist.admin.",
      "Clique sur « Download google-services.json » et glisse le fichier ci-dessous. Le kit vérifie qu'il contient bien l'app HeyWatchlist.",
    ],
    attention: [
      "Ce fichier n'est pas secret au sens strict, mais le kit le range quand même dans le coffre. Il se retélécharge à tout moment depuis la console.",
    ],
    sources: [["Ajouter Firebase à une app Android", "https://firebase.google.com/docs/android/setup"]],
  },
  {
    titre: "Clé Sign in with Apple",
    elements: ["APPLE_SIGNIN_PRIVATE_KEY", "APPLE_SIGNIN_KEY_ID"],
    liens: [["Créer une clé", "https://developer.apple.com/account/resources/authkeys/add"]],
    etapes: [
      "Sur developer.apple.com, Certificates, Identifiers & Profiles : Keys dans la barre de gauche, puis le bouton (+). Il faut être Account Holder ou Admin.",
      "Key Name : « HeyWatchlist Sign in ». Coche « Sign in with Apple », clique sur Configure à côté et choisis l'App ID principal io.github.shweepsi.heywatchlist. Puis Continue et Register.",
      "Clique sur Download : un fichier AuthKey_XXXXXXXXXX.p8 arrive dans Téléchargements. Glisse-le ci-dessous : le Key ID est lu dans son nom.",
    ],
    attention: [
      "Apple ne garde pas ce fichier et ne le laisse télécharger qu'une fois : enregistre-le ici tout de suite, puis supprime-le de Téléchargements.",
      "Apple accepte deux clés au plus par App ID principal.",
      "L'App ID n'apparaît pas encore ? La CI iOS l'active au prochain envoi TestFlight : reviens ensuite.",
    ],
    sources: [
      ["Créer une clé", "https://developer.apple.com/help/account/keys/create-a-private-key/"],
      ["Clé Sign in with Apple", "https://developer.apple.com/help/account/capabilities/create-a-sign-in-with-apple-private-key"],
      ["Trouver le Key ID", "https://developer.apple.com/help/account/keys/get-a-key-identifier"],
    ],
  },
  {
    titre: "Notifications iPhone (clé APNs)",
    elements: ["APNS_PRIVATE_KEY", "APNS_KEY_ID"],
    liens: [["Créer une clé", "https://developer.apple.com/account/resources/authkeys/add"]],
    etapes: [
      "Même page : Keys, bouton (+). Key Name : « HeyWatchlist Push ».",
      "Coche « Apple Push Notifications service (APNs) » et clique sur Configure à côté. Type de clé : « Team Scoped ». Choisis l'environnement Sandbox et Production si la page le propose. Puis Continue et Register.",
      "Download, puis glisse le fichier .p8 ci-dessous.",
    ],
    attention: [
      "Une clé distincte de celle de Sign in with Apple : Apple limite chaque type de clé, mieux vaut ne pas les mélanger.",
      "Téléchargeable une seule fois, comme toutes les clés Apple.",
    ],
    sources: [
      ["Créer une clé", "https://developer.apple.com/help/account/keys/create-a-private-key/"],
      ["Connexion à APNs par jeton", "https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns"],
    ],
  },
  {
    titre: "Jeton du dépôt des certificats iOS",
    elements: ["MATCH_GIT_TOKEN"],
    liens: [
      [
        "Créer le jeton",
        "https://github.com/settings/personal-access-tokens/new?name=HeyWatchlist+certificats&target_name=Shweepsi&expires_in=365&contents=write",
      ],
    ],
    etapes: [
      "Le dépôt privé Shweepsi/heywatchlist-certificates doit exister (les anciens scripts l'ont créé). S'il manque, crée-le vide et privé sur GitHub.",
      "« Créer le jeton » ouvre le formulaire prérempli : Resource owner Shweepsi, expiration un an, Contents en Read and write.",
      "Repository access : « Only select repositories », puis heywatchlist-certificates seulement.",
      "Generate token, copie le jeton (github_pat_…) dans le champ ci-dessous.",
    ],
    attention: ["Note la date d'expiration : à l'échéance, l'envoi TestFlight échoue tant que le jeton n'est pas remplacé ici."],
    sources: [
      ["Jetons fine-grained", "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens"],
    ],
  },
];

function badgeElement(el) {
  const [genre, texte] = ETATS_ELEMENT[el.etat] ?? ["attente", "Inconnu"];
  return element("span", { classe: `badge ${genre}`, texte });
}

function badgeAcces(service, etatAcces) {
  const [genre, texte] = ACCES[etatAcces] ?? ["attente", "Inconnu"];
  return element("span", { classe: `badge ${genre}`, texte, title: detailAcces(service, etatAcces) });
}

async function envoyerApp(id, remplacer = []) {
  annoncer("Envoi en cours…");
  const { acces, resultats } = await api("/api/apps/envoyer", { id, remplacer });
  const echecs = resultats.filter((r) => !["ok", "genere"].includes(r.resultat));
  const envoyes = resultats.filter((r) => r.resultat === "ok").length;
  const generes = resultats.filter((r) => r.resultat === "genere").map((r) => r.nom);
  const morceaux = [`${envoyes} valeur${envoyes > 1 ? "s" : ""} envoyée${envoyes > 1 ? "s" : ""}.`];
  if (generes.includes("BOOTSTRAP_CODE")) morceaux.push("Un code administrateur a été créé : affiche-le dans la liste.");
  const bloquant = (r) => r.resultat === "gh-absent" || /^(keytool|keystore)-/.test(r.resultat);
  const premierBlocage = echecs.find(bloquant);
  if (premierBlocage) {
    morceaux.push(
      RESULTATS[premierBlocage.resultat] ?? erreurTexte(premierBlocage.resultat),
      premierBlocage.detail ? `Détail : ${premierBlocage.detail}` : "",
    );
  }
  const autres = echecs.filter((r) => !bloquant(r));
  if (autres.length > 0) {
    morceaux.push(`Non envoyé : ${autres.map((r) => `${r.nom} (${RESULTATS[r.resultat] ?? "échec"})`).join(", ")}.`);
  }
  if (acces.github !== "ok") morceaux.push(`GitHub : ${detailAcces("github", acces.github)}`);
  if (acces.worker !== "ok") morceaux.push(`Serveur : ${detailAcces("worker", acces.worker)}`);
  await afficherApps();
  annoncer(morceaux.join(" "), echecs.length > 0 || acces.github !== "ok" || acces.worker !== "ok" ? "erreur" : "ok");
}

function boutonAction(texte, action, classe = "bouton secondaire") {
  const bouton = element("button", { type: "button", classe, texte });
  bouton.addEventListener("click", async () => {
    bouton.disabled = true;
    try {
      await action(bouton);
    } catch (probleme) {
      annoncer(erreurTexte(probleme.message, probleme.detail), "erreur");
    } finally {
      bouton.disabled = false;
    }
  });
  return bouton;
}

function ligneElement(app, el) {
  const destinations = el.destinations.map((d) => DESTINATIONS[d.type]).join(" et ");
  let action = null;
  if (el.afficher && el.local) {
    const zone = element("span");
    action = element(
      "span",
      {},
      boutonAction(
        "Afficher",
        async (bouton) => {
          const { valeur } = await api("/api/apps/afficher", { id: app.id, nom: el.nom });
          zone.replaceChildren(element("code", { texte: valeur ?? "" }));
          bouton.hidden = true;
        },
        "bouton lien",
      ),
      zone,
    );
  } else if (el.etat === "en-place" && !el.conserver && el.source !== "fixe" && el.source !== "url-worker") {
    action = boutonAction("Renvoyer", () => envoyerApp(app.id, [el.nom]), "bouton lien");
  }
  const source = el.depuis ? `${SOURCES[el.source]} (${el.depuis})` : SOURCES[el.source];
  return element(
    "tr",
    {},
    element("td", {}, element("div", { texte: ELEMENTS[el.nom] ?? el.nom }), element("code", { classe: "discret", texte: el.nom })),
    element("td", { texte: `${source}, vers ${destinations}${el.conserver ? ". Jamais remplacée" : ""}` }),
    element("td", {}, badgeElement(el)),
    element("td", {}, action),
  );
}

function carteSaisie(app, saisie) {
  const elements = saisie.elements.map((nom) => app.elements.find((el) => el.nom === nom)).filter(Boolean);
  const complet = elements.every((el) => el.etat === "en-place");
  const formulaire = element("form", { classe: "carte formulaire connexion" });
  formulaire.append(
    element(
      "div",
      { classe: "entete" },
      element("h2", { texte: saisie.titre }),
      element(
        "div",
        { classe: "etat" },
        element("span", { classe: `badge ${complet ? "ok" : "attente"}`, texte: complet ? "En place" : "À faire" }),
      ),
    ),
    element(
      "div",
      { classe: "ligne" },
      ...saisie.liens.map(([texte, href]) =>
        element("a", { classe: "bouton secondaire", href, target: "_blank", rel: "noopener noreferrer", texte }),
      ),
    ),
    guide(saisie, !complet),
  );
  if (complet && saisie.resteAVerifier) {
    formulaire.append(element("p", { classe: "discret", texte: saisie.resteAVerifier }));
  }
  if (saisie.empreinte) {
    const zone = element("p", { classe: "discret" });
    formulaire.append(
      boutonAction("Afficher l'empreinte SHA-1", async () => {
        const { sha1 } = await api("/api/apps/empreinte", { id: app.id });
        zone.replaceChildren("SHA1 fingerprint (pas secrète) : ", element("code", { texte: sha1 }));
      }),
      zone,
    );
  }
  // Tout est en place : les champs ne servent plus qu'à remplacer une valeur.
  const champs = complet ? element("details", { classe: "guide" }, element("summary", { texte: "Remplacer une valeur" })) : formulaire;
  if (complet) formulaire.append(champs);
  for (const el of elements) {
    // L'identifiant d'une clé Apple est lu dans le nom du fichier AuthKey_….p8.
    const luDansFichier = /_KEY_ID$/.test(el.nom) && elements.some((autre) => autre.fichier === "p8");
    const libelle = ELEMENTS[el.nom] ?? el.nom;
    const saisieChamp = el.fichier
      ? element("input", { type: "file", name: el.nom, accept: el.fichier === "p8" ? ".p8" : ".json" })
      : element("input", {
          type: el.format === "jeton-github-fin" ? "password" : "text",
          name: el.nom,
          autocomplete: "off",
          spellcheck: "false",
          placeholder: el.local
            ? "Enregistré dans le coffre (laisser vide pour garder)"
            : el.etat === "en-place"
              ? "Déjà en place (laisser vide pour garder)"
              : luDansFichier
                ? "Lu dans le nom du fichier, sinon 10 caractères"
                : "",
        });
    champs.append(
      element("label", {}, element("span", { classe: "libelle-etat" }, libelle, " ", badgeElement(el)), saisieChamp),
    );
  }
  const bouton = element("button", { type: "submit", classe: "bouton", texte: "Enregistrer et envoyer" });
  champs.append(bouton);
  formulaire.addEventListener("submit", async (evenement) => {
    evenement.preventDefault();
    bouton.disabled = true;
    try {
      const remplaces = [];
      for (const el of elements) {
        const champ = formulaire.elements[el.nom];
        if (!champ) continue;
        let corps = null;
        if (el.fichier) {
          const fichier = champ.files[0];
          if (fichier) corps = { valeur: await lireFichier(fichier), nomFichier: fichier.name };
        } else if (champ.value.trim() !== "") {
          corps = { valeur: champ.value };
        }
        if (!corps) continue;
        const { etat, aussi } = await api("/api/apps/saisir", { id: app.id, nom: el.nom, ...corps });
        if (etat !== "ok") {
          annoncer(`${ELEMENTS[el.nom] ?? el.nom} : format inattendu, vérifie la valeur ou le fichier.`, "erreur");
          return;
        }
        remplaces.push(el.nom, ...(aussi ? [aussi] : []));
      }
      if (remplaces.length === 0) return annoncer("Rien de nouveau à enregistrer.");
      await envoyerApp(app.id, remplaces);
    } catch (probleme) {
      annoncer(erreurTexte(probleme.message), "erreur");
    } finally {
      bouton.disabled = false;
    }
  });
  return formulaire;
}

function carteReprise(app) {
  const zone = element("p", { classe: "discret" });
  return element(
    "div",
    { classe: "carte" },
    element("h2", { texte: "Tu as utilisé les anciens scripts PowerShell ?" }),
    element("p", {
      texte:
        "Ils ont gardé la clé Android, les phrases secrètes et le code administrateur dans le dossier HeyWatchlist-secrets de ton dossier personnel. Le kit peut les reprendre dans le coffre : rien n'est remplacé ni effacé.",
    }),
    boutonAction("Reprendre l'ancienne sauvegarde", async () => {
      const { trouve, repris } = await api("/api/apps/importer-ancien", { id: app.id });
      if (!trouve) return zone.replaceChildren("Aucune ancienne sauvegarde trouvée sur ce PC.");
      zone.replaceChildren(
        repris.length === 0
          ? "Le coffre avait déjà tout."
          : `Repris : ${repris.join(", ")}. Garde le dossier tant que tu n'as pas une copie du coffre (onglet Réglages).`,
      );
      await afficherApps();
    }),
    zone,
  );
}

function vueApp(app) {
  const enAttente = app.elements.filter((el) => el.etat === "a-envoyer").length;
  return element(
    "div",
    {},
    element(
      "div",
      { classe: "carte" },
      element(
        "div",
        { classe: "entete" },
        element("h2", { texte: app.nom }),
        element(
          "div",
          { classe: "etat" },
          element("span", { classe: "discret", texte: "GitHub" }),
          badgeAcces("github", app.acces.github),
          element("span", { classe: "discret", texte: "Serveur" }),
          badgeAcces("worker", app.acces.worker),
        ),
      ),
      element(
        "p",
        { classe: "discret" },
        "Dépôt ",
        lienExterne(app.depot, `https://github.com/${app.depot}/settings/secrets/actions`),
        ` · Worker ${app.worker}`,
        app.acces.url ? ` · ${app.acces.url}` : "",
      ),
      element(
        "div",
        { classe: "ligne" },
        boutonAction(
          enAttente > 0 ? `Envoyer ce qui manque (${enAttente})` : "Envoyer ce qui manque",
          () => envoyerApp(app.id),
          "bouton",
        ),
        boutonAction("Actualiser", async () => {
          await afficherApps();
          annoncer("");
        }),
      ),
      element("p", {
        classe: "discret",
        texte:
          "Les secrets GitHub partent par GitHub CLI (gh), avec le jeton de Connexions : rien à taper, rien à connecter. La clé Android est créée avec Java (keytool) si elle n'existe nulle part.",
      }),
    ),
    ...SAISIES.map((saisie) => carteSaisie(app, saisie)),
    app.keystore ? null : carteReprise(app),
    element(
      "details",
      { classe: "carte guide" },
      element("summary", { texte: `Tout ce que l'app attend (${app.elements.length})` }),
      element(
        "div",
        { classe: "defile" },
        element(
          "table",
          {},
          element("thead", {}, element("tr", {}, ...["Valeur", "Origine", "État", ""].map((t) => element("th", { texte: t })))),
          element("tbody", {}, ...app.elements.map((el) => ligneElement(app, el))),
        ),
      ),
    ),
  );
}

async function afficherApps() {
  const { apps } = await api("/api/apps");
  const vues = [];
  for (const { id } of apps) {
    const app = await api("/api/apps/etat", { id });
    vues.push(vueApp(app));
  }
  $("#liste-apps").replaceChildren(...vues);
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
