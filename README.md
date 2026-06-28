# Voix d'Afrique — Déploiement avec backend sécurisé

Ce dossier contient tout ce qu'il faut pour déployer l'application avec un vrai
appel API Claude sécurisé (sans exposer de clé API dans le navigateur).

## Contenu

- `index.html` — l'application (déjà modifiée pour utiliser la fonction sécurisée)
- `netlify/functions/claude-feedback.js` — la fonction serveur qui appelle Claude
- `netlify.toml` — fichier de configuration pour Netlify

## Étapes de déploiement

### 1. Créer une clé API Anthropic

1. Allez sur https://console.anthropic.com
2. Créez un compte (différent de votre compte claude.ai)
3. Ajoutez un moyen de paiement + un peu de crédit (5-10$ suffisent pour commencer)
4. Allez dans **API Keys** → **Create Key**
5. Copiez la clé (commence par `sk-ant-...`) — elle ne s'affiche qu'une seule fois

### 2. Déployer ce dossier sur Netlify

**Important** : cette fois, il faut déposer le DOSSIER COMPLET (pas juste index.html),
car Netlify doit aussi voir le dossier `netlify/functions/`.

Option A — Glisser-déposer :
1. Allez sur https://app.netlify.com
2. Ouvrez votre site existant (famous-snickerdoodle-dbef2c)
3. Allez dans **Deploys**
4. Faites glisser TOUT LE DOSSIER (pas juste le fichier index.html) dans la zone de dépôt

Si Netlify n'accepte que des fichiers individuels par glisser-déposer, utilisez
plutôt un dépôt Git (GitHub) connecté à Netlify — méthode plus fiable pour les
projets avec fonctions. Dites-le-moi et je vous guide pour cette méthode.

### 3. Configurer la clé API en variable d'environnement (ÉTAPE CRITIQUE)

**Ne mettez JAMAIS la clé directement dans le code !** Elle doit être une variable
d'environnement Netlify :

1. Sur votre site Netlify → **Site settings** → **Environment variables**
2. Cliquez **Add a variable**
3. Clé : `ANTHROPIC_API_KEY`
4. Valeur : collez votre clé `sk-ant-...`
5. Sauvegardez
6. Retournez dans **Deploys** → cliquez **Trigger deploy** → **Deploy site**
   (les fonctions ne lisent la variable qu'après un redéploiement)

### 4. Tester

Ouvrez votre URL Netlify sur votre téléphone, faites un exercice. Le feedback
devrait maintenant venir de Claude en temps réel, sans le message "indisponible".

## Vérifier que la fonction fonctionne

Si ça ne marche toujours pas, ouvrez dans un navigateur :
`https://VOTRE-SITE.netlify.app/.netlify/functions/claude-feedback`

- Si vous voyez une erreur 405 "Méthode non autorisée" → la fonction est bien déployée ✅
- Si vous voyez une erreur 404 "Page not found" → la fonction n'a pas été détectée,
  vérifiez que le dossier `netlify/functions/` est bien présent dans le déploiement
