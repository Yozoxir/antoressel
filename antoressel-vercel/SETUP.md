# Setup Vercel + Stripe Webhook — AntoRessel

## 1. Structure des fichiers

Mets ces fichiers dans ton repo GitHub :
```
ton-projet/
├── api/
│   └── stripe-webhook.js   ← le webhook
├── antoressel-hero.html    ← ton site
├── package.json
└── vercel.json
```

## 2. Variables d'environnement Vercel

Va sur vercel.com → ton projet → Settings → Environment Variables

Ajoute ces 3 variables (JAMAIS dans le code) :

| Nom | Valeur |
|-----|--------|
| `STRIPE_SECRET_KEY` | Ta clé sk_live_... (la NOUVELLE après révocation) |
| `STRIPE_WEBHOOK_SECRET` | whsec_... (depuis Stripe Dashboard → Webhooks) |
| `SUPABASE_SERVICE_KEY` | Ta clé service_role Supabase (pas l'anon key) |

### Où trouver la Supabase Service Key :
→ supabase.com/dashboard/project/pdhuqbibvnflcwoeuiln/settings/api
→ Section "Project API keys" → "service_role" (clé longue)

## 3. Créer le Webhook Stripe

1. dashboard.stripe.com → Développeurs → Webhooks
2. "Ajouter un endpoint"
3. URL : `https://TON-PROJET.vercel.app/api/stripe-webhook`
4. Events : cocher `checkout.session.completed`
5. Créer → copier le "Signing secret" (whsec_...)
6. Coller dans Vercel comme `STRIPE_WEBHOOK_SECRET`

## 4. Configurer tes liens Stripe

Dans tes Payment Links Stripe, ajoute des métadonnées :
- `product_name` → "Formation AntoRessel"
- `product_type` → "formation" OU "accompagnement"

Stripe Dashboard → Payment Links → ton lien → Métadonnées

## 5. Tester

Stripe Dashboard → Webhooks → ton endpoint → "Envoyer un test d'événement"
Sélectionne `checkout.session.completed`

Vérifie dans Supabase → Table Editor → orders → une ligne doit apparaître.

## Ce que ça fait automatiquement

Quand un membre paie :
1. Stripe envoie l'event à Vercel
2. Vercel trouve son profil Supabase par email
3. Insère la commande dans `orders`
4. Si c'est "accompagnement" → met à jour son plan automatiquement
5. Le membre voit son achat dans son dashboard immédiatement
