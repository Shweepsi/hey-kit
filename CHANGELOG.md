# Journal des versions

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
