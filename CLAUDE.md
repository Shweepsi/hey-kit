# CLAUDE.md — hey-kit

Lire d'abord `README.fr.md`.

## Règles

- Le kit tourne **uniquement sur le PC du propriétaire**. Le serveur n'écoute
  que sur `127.0.0.1` ; garder le jeton d'ouverture, le cookie de session
  strict, le contrôle de l'en-tête Host, l'en-tête `X-Hey-Kit` et la CSP.
- **Aucune valeur secrète** dans les journaux, les réponses de l'API (hors
  identifiants publics déjà affichés), le dépôt, le chat ou un message de
  commit. Aucune vraie clé, URL de serveur ou jeton dans les tests.
- **Ne jamais appeler les vrais services** (GitHub, Cloudflare, Apple, Google,
  TMDB) depuis une session cloud, la CI ou un test : réponses simulées
  (`fetchFn` injecté), y compris les échecs.
- **Aucune dépendance** npm sans accord du propriétaire : Node seul.
- Le serveur renvoie des **codes d'erreur** ; l'interface les traduit. Textes
  de l'interface en **français**.
- Chaque étape d'un guide vient de la **documentation officielle**, citée en
  source, avec la date de vérification (`VERIFIE_LE` dans `public/app.js`).
  Une étape non confirmée n'est pas écrite comme sûre.
- Style visuel : verre dépoli, sans bibliothèque.
- Code et commentaires en français, concis. Pas de code mort.
- **Version** : toute PR qui change le kit monte `version` dans `package.json`
  et ajoute son entrée en tête de `CHANGELOG.md`.
- Commits en Conventional Commits, une branche par sujet, fusion par pull
  request.
- **Honnêteté** : ne jamais dire qu'on a lancé ce qu'on n'a pas lancé. Le kit
  n'est testé sous Windows que par le propriétaire.

## Vérifications avant de livrer

```sh
for f in kit.mjs src/*.mjs public/app.js test/*.mjs; do node --check "$f"; done
npm test
```
