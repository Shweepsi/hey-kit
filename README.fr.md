# hey-kit

Kit local pour configurer les apps (HeyWatchlist, hey-stream, hey-cut…) : un
coffre chiffré pour toutes les clés, et une page web qui guide pas à pas.

Tout tourne sur ton PC. La page n'est servie que sur `127.0.0.1`, le coffre ne
quitte jamais le disque, et aucune valeur n'est affichée ni journalisée.

## Lancer le kit

Il faut Node 22 ou plus récent (Node 24 conseillé), rien d'autre à installer.

```powershell
git clone https://github.com/Shweepsi/hey-kit
cd hey-kit
node kit.mjs
```

Le navigateur s'ouvre sur la page du kit. S'il ne s'ouvre pas, copie le lien
affiché dans la fenêtre. Ferme la fenêtre (ou Ctrl+C) pour arrêter le kit : le
coffre est verrouillé.

## Le coffre

- Un seul fichier : `Documents\hey-kit\coffre.hey-kit` (ou le dossier indiqué
  par la variable `HEY_KIT_DIR`).
- Chiffré en AES-256-GCM avec une clé tirée du mot de passe maître (scrypt).
- Rangé par dossiers : `Commun` pour les comptes partagés, un dossier par app.
- La version précédente est gardée à côté, en `.bak`.
- Pour une sauvegarde, copie le fichier tel quel : il reste chiffré.
- **Mot de passe maître perdu = coffre perdu.** Garde-le dans ton gestionnaire
  de mots de passe.
- Le coffre se verrouille seul après 15 minutes sans activité.

## Pages

| Page | Rôle |
| --- | --- |
| Connexions | GitHub, Cloudflare, Apple, Google (Firebase), TMDB : guide pas à pas, saisie, vérification en lecture seule. |
| Coffre | Liste des clés par dossier (sans les valeurs), ajout, remplacement, suppression. |
| Réglages | Emplacement du coffre, changement du mot de passe maître. |

Les guides citent la documentation officielle de chaque service et la date à
laquelle ils ont été relus.

## Développement

```sh
npm test
```

Aucune dépendance. Les tests utilisent des réponses simulées : ils n'appellent
jamais les vrais services.
