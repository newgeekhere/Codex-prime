# Codex Prime

Site statique de présentation et catalogue d’outils. La page d’accueil reste dans `index.html`; le catalogue, ses filtres et les actions par outil sont dans `outils.html`.

## Structure

```text
Codex-prime/
├── README.md
├── index.html
├── outils.html
└── worker/
    ├── index.js
    ├── wrangler.jsonc
    ├── package.json
    ├── package-lock.json
    └── test/
```

## Publication du site

Le site peut être publié par GitHub Pages depuis la racine. L’URL attendue est `https://newgeekhere.github.io/Codex-prime/`. `index.html` est la page d’accueil et contient le lien vers le catalogue.

## Worker et stockage

Le Worker expose l’API de lecture des fiches et commentaires et les routes d’écriture. Le bucket R2 configuré dans `worker/wrangler.jsonc` est `formation-s4-donnees-mon-groupe`. L’initialisation des fiches est idempotente : elle ne remplace pas les fiches déjà présentes.

Les écritures restent refusées tant que Cloudflare Access n’est pas configuré. Avant d’autoriser les modifications :

1. Créer une application Cloudflare Access pour le Worker et définir une politique qui autorise uniquement les personnes attendues.
2. Récupérer le domaine Access et l’Audience (AUD) de cette application.
3. Renseigner `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` et `ACCESS_ALLOWED_EMAILS` dans les variables du Worker via le tableau de bord ou des secrets/variables Wrangler. Ne pas mettre de jetons ni de mots de passe dans les fichiers du dépôt.
4. Vérifier que `ALLOWED_ORIGIN` correspond exactement à l’origine de la page publiée.
5. Vérifier la liaison R2 `DATA` et le nom du bucket dans `wrangler.jsonc`.
6. Déployer le Worker explicitement depuis `worker/` avec Wrangler, après revue de la configuration. Cette étape est manuelle et n’est pas exécutée par le workflow CI.

Sans ces réglages, l’API de lecture peut répondre, mais les écritures sont désactivées. CORS ou Turnstile seuls ne constituent pas une autorisation.

## Vérifications locales

Prérequis : Node.js 22 ou plus récent.

```sh
cd worker
npm ci
npm run check
```

Le workflow `.github/workflows/worker-check.yml` exécute les vérifications à chaque pull request et sur les branches `main` et `feature/**` lorsque des fichiers Worker ou le catalogue changent. Les tests couvrent le verrou d’accès par défaut et l’inventaire des cartes/actions. Les tests du Worker n’effectuent aucune requête vers Cloudflare.
