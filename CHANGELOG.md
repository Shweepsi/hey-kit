# Journal des versions

## 0.3.0 — 2026-11-27

- Page Plantages : les plantages Crashlytics de HeyWatchlist (app publique et
  admin), lus dans l'export BigQuery avec le compte de service Google du
  coffre, regroupés par problème, sur 24 heures, 7 ou 30 jours. Requête en
  lecture seule, plafonnée à 1 Go lu.
- Bouton « Copier le rapport pour Claude » : un rapport Markdown sans secret
  ni donnée personnelle (e-mails, paramètres d'URL et longues clés masqués).
- Guide pour activer l'export BigQuery et donner les deux rôles de lecture au
  compte de service.

## 0.2.3 — 2026-11-27

- Clé Android : keytool est lancé en anglais. Sur un Windows en français, il
  écrivait « SHA1 : » et le kit ne trouvait pas l'empreinte.
- Échec de Java : message précis (mot de passe de la clé qui ne correspond
  pas, clé absente du fichier), sinon la ligne d'erreur de keytool.
- Lanceur : vérifie aussi Java (facultatif, seulement pour la clé Android).

## 0.2.2 — 2026-11-27

- Mes apps : un badge global « En place » ou « À faire » par carte, et l'état
  à côté de chaque champ. Une valeur déjà en place sur le serveur l'indique
  dans son champ, et les champs passent sous « Remplacer une valeur ».
- Connexion avec Google : rappelle ce que le kit ne peut pas vérifier
  (clients Android, publication de l'app).

## 0.2.1 — 2026-11-27

- Connexions : la dernière vérification de chaque connexion (état, date et
  nom du compte, jamais la clé) est gardée dans le coffre et réaffichée au
  lancement suivant. Elle est effacée si la clé change depuis l'onglet Coffre.

## 0.2.0 — 2026-11-27

- Page Mes apps, pour HeyWatchlist : état de chaque secret et variable GitHub
  et de chaque secret du Worker, envoi de ce qui manque depuis le coffre
  (secrets GitHub par GitHub CLI, le reste par les API GitHub et Cloudflare),
  correction des variables à la mauvaise valeur.
- Création des clés internes (sessions, réglages admin, phrase des
  certificats, code administrateur) et de la clé de signature Android (Java),
  rangées dans le coffre avant l'envoi ; jamais de remplacement d'une valeur
  dont dépend l'existant.
- Guides pas à pas tirés des documentations officielles : connexion avec
  Google (Branding, Audience, clients Web, iOS et Android avec l'empreinte
  SHA-1), google-services.json, clés Sign in with Apple et APNs, jeton du
  dépôt des certificats iOS.
- Reprise de l'ancienne sauvegarde des scripts PowerShell.
- Lanceur : un dossier du kit copié sans Git se relie à GitHub sur place
  (bouton « Relier à GitHub et mettre à jour »), sans rien supprimer.

## 0.1.0 — 2026-11-27

- Serveur local sur `127.0.0.1` : jeton d'ouverture, cookie de session strict,
  contrôle de l'hôte, CSP stricte.
- Coffre chiffré (scrypt + AES-256-GCM), un fichier, sauvegarde `.bak`,
  verrouillage après 15 minutes sans activité, changement du mot de passe
  maître.
- Page Connexions : GitHub, Cloudflare, Apple, Google (Firebase), TMDB, avec
  guides pas à pas tirés des documentations officielles et vérification en
  lecture seule.
- Page Coffre : liste sans valeurs, ajout, remplacement, suppression.
- App de lancement Windows (artefact Claude installable, `lanceur/`) :
  vérifie Node et Git, télécharge, démarre et arrête le kit.
