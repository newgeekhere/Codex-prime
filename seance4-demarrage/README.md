# Séance 4 · Exemple R2 prêt à configurer

> Cet ancien kit montre une collecte générique titre/information/commentaire.
> Il ne fournit pas l’édition de tous les champs des outils ni leurs commentaires associés.
> Pour l’exercice actuel, suivre la fiche atelier-formulaire-r2.html et adapter le projet d’école
> avec l’assistant ; ne pas déployer ce kit tel quel comme solution complète.

Ce kit contient un formulaire accessible, un Worker d’écriture R2 et huit tests automatisés.
Il a été vérifié avec des services simulés ; aucun déploiement réel ni compte cloud n’a été testé.
Les tests ne prouvent pas la configuration de votre compte : l’écriture distante reste à vérifier.

## Le chemin court, dans le navigateur

1. Téléchargez et décompressez le kit. Créez un dépôt GitHub dédié à l’exercice.
2. Avec **Add file → Upload files**, ajoutez les dossiers `public/` et `worker/` à la racine.
   Avec **Add file → Create new file**, créez `.github/workflows/deploy-worker.yml` et copiez
   le fichier du kit dans cet emplacement exact. Aucun terminal local n’est nécessaire.
   Vérifiez aussi la présence de `.gitignore` (les fichiers commençant par un point peuvent être masqués).
3. Dans Cloudflare Pages, connectez ce dépôt GitHub : framework **None**, pas de commande
   de construction, dossier de sortie **public**, branche de production **main**.
   Relevez l’origine exacte `https://VOTRE-SITE.pages.dev`, sans chemin ni barre finale.
4. Dans R2, créez un bucket **Standard privé** pour les commentaires. Si vous ne pouvez pas
   activer R2, utilisez la simulation de secours ; ne prétendez pas avoir écrit dans le cloud.
5. Dans **Workers & Pages**, créez un Worker de démonstration `formation-s4-formulaire`.
   Dans `worker/wrangler.jsonc`, adaptez son `name`, le `bucket_name`, `ALLOWED_ORIGIN` et
   `TURNSTILE_HOSTNAME` (nom d’hôte sans `https://`). Gardez l’action `soumission`.
   Pour un bucket R2 sous juridiction UE, ajoutez `"jurisdiction": "eu"` à sa liaison.
6. Dans Cloudflare Turnstile, créez un widget pour le nom d’hôte de votre site Pages.
   Copiez **la clé de site publique** dans `public/index.html`. Dans les secrets du Worker,
   ajoutez **TURNSTILE_SECRET_KEY** avec la clé secrète du widget. Ne mettez jamais cette
   dernière dans GitHub ni dans une conversation.
7. Dans les réglages GitHub, ajoutez le secret `CLOUDFLARE_API_TOKEN` et la variable
   `CLOUDFLARE_ACCOUNT_ID` (voir diapo 18). Créez l’environnement GitHub `formation`.
   Le jeton doit permettre la mise à jour du Worker et les opérations de configuration
   nécessaires à sa liaison au bucket ; vérifiez précisément les erreurs de permission.
8. Faites relire et fusionnez les adaptations sur `main`. Dans **Actions**, lancez
   **Tester puis déployer le Worker → Run workflow**. Les tests s’exécutent avant le déploiement.
9. Relevez l’URL du Worker dans Cloudflare. Dans `public/index.html`, remplacez `API_URL` en
   conservant `/api/soumissions`. Faites relire et fusionnez, puis attendez le déploiement Pages.
10. Depuis le site : envoyez une fiche fictive. Attendu : **201 + identifiant**, puis un objet
    `soumissions/date/identifiant.json` visible dans la console R2 privée.
11. Relevez les objets présents. Cliquez sur **Tester un refus serveur** : attendu **400**, et
    aucun nouvel objet après actualisation du bucket. Ce test atteint le serveur ; il ne se
    limite pas à la validation HTML du navigateur.

Pour adapter un projet existant, reprendre seulement le formulaire et le Worker, sans remplacer
les fichiers de déploiement du projet. Les images restent un exercice séparé (diapo 19).
L’exemple fonctionne sans S3 externe. Le parcours OVH reste une extension : remplacer uniquement
l’écriture `env.DATA.put` par l’écriture S3 signée décrite au cours, puis refaire la recette.

## Ce qui reste privé

Le formulaire ne lit et ne liste aucun commentaire. Seuls les champs métier, l’identifiant et
la date sont conservés ; le jeton Turnstile n’est pas stocké. CORS limite l’accès du navigateur,
mais n’est pas une authentification. Turnstile limite les robots, sans prouver l’identité d’un auteur.
Pour une ouverture au-delà de l’atelier, compléter la limitation de débit, la supervision et les règles
propres au projet. Ne pas utiliser de données personnelles réelles pour cette démonstration.

## Secours après cinq minutes de blocage

- Compte ou activation bloqués : suivre la démonstration du formateur, sans partager ses clés.
- Pas de service distant : ouvrir `secours.html`, disponible à côté de cette fiche ou dans le cours.
  Il fonctionne hors connexion, sans compte, sans requête réseau et sans enregistrement.
- Pas d’Internet : enregistrer cette page de secours avant le cours. Étudier les trois réponses fournies :
  succès 201, refus 400, indisponibilité 502. Ce sont des exemples simulés.
- Revenir à la version fonctionnelle du dépôt avant de reprendre une modification.

## Test et nettoyage

GitHub Actions exécute les tests du Worker. En local, option facultative : `cd worker`, `npm ci`, `npm test`.
Après l’atelier, supprimer les soumissions fictives et les ressources inutiles, vérifier l’usage R2,
et révoquer le jeton de déploiement temporaire chez Cloudflare avant de retirer sa copie de GitHub.
Le secret Turnstile du Worker reste nécessaire si vous gardez la collecte active.

Références :
- https://developers.cloudflare.com/r2/api/workers/workers-api-usage/
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
