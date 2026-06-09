// api/stripe-webhook.js
// Stripe → Supabase : après paiement, débloque l'accès membre automatiquement

import Stripe from 'stripe';

const stripe          = new Stripe(process.env.STRIPE_SECRET_KEY);
const SUPA_URL        = 'https://pdhuqbibvnflcwoeuiln.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function supaFetch(path, opts = {}) {
  return fetch(`${SUPA_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPA_SERVICE_KEY,
      'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
      ...opts.headers
    }
  });
}

async function getProfileByEmail(email) {
  const res  = await supaFetch(`/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id,name,plan`);
  const data = await res.json();
  return data[0] || null;
}

async function insertOrder(order) {
  await supaFetch('/rest/v1/orders', {
    method: 'POST',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify(order)
  });
}

async function updateProfilePlan(userId, plan) {
  await supaFetch(`/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify({ plan })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = await getRawBody(req);
  const sig     = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session     = event.data.object;
    const email       = session.customer_details?.email || session.customer_email;
    const amount      = session.amount_total;
    const productName = session.metadata?.product_name || 'Achat AntoRessel';
    const productType = session.metadata?.product_type || 'formation';

    if (!email) return res.status(400).json({ error: 'No email in session' });

    // Cherche le compte membre par email
    const profile = await getProfileByEmail(email);

    if (profile) {
      // Enregistre la commande
      await insertOrder({
        user_id:           profile.id,
        stripe_session_id: session.id,
        product_name:      productName,
        product_type:      productType,
        amount,
        status:            'paid'
      });

      // Upgrade le plan automatiquement
      if (productType === 'accompagnement') {
        await updateProfilePlan(profile.id, 'accompagnement');
      } else {
        // Ne downgrade pas si déjà accompagnement
        if (profile.plan !== 'accompagnement') {
          await updateProfilePlan(profile.id, 'formation');
        }
      }

      console.log(`✅ Accès débloqué pour ${email} — ${productName}`);

    } else {
      // Membre pas encore inscrit — on enregistre quand même la commande
      // Quand il créera son compte avec le même email, le plan sera mis à jour
      await insertOrder({
        stripe_session_id: session.id,
        product_name:      productName,
        product_type:      productType,
        amount,
        status:            'paid_no_user'
      });

      console.log(`⚠️ Aucun compte trouvé pour ${email} — commande enregistrée`);
    }
  }

  return res.status(200).json({ received: true });
}
