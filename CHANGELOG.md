# Journal des versions

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
