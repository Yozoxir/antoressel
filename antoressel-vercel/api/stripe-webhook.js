// api/stripe-webhook.js — Vercel Serverless Function
// Stripe → Supabase : enregistre les achats après paiement

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SUPA_URL = 'https://pdhuqbibvnflcwoeuiln.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // clé service role (pas anon)

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function supaInsert(table, data) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPA_SERVICE_KEY,
      'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(data)
  });
  return res;
}

async function getProfileByEmail(email) {
  const res = await fetch(`${SUPA_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id,plan`, {
    headers: {
      'apikey': SUPA_SERVICE_KEY,
      'Authorization': `Bearer ${SUPA_SERVICE_KEY}`
    }
  });
  const data = await res.json();
  return data[0] || null;
}

async function updateProfilePlan(userId, plan) {
  await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPA_SERVICE_KEY,
      'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ plan })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // ── Paiement réussi ──
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email   = session.customer_details?.email || session.customer_email;
    const amount  = session.amount_total; // en centimes
    const product = session.metadata?.product_name || 'Achat AntoRessel';
    const type    = session.metadata?.product_type || 'formation'; // 'formation' ou 'accompagnement'

    if (!email) {
      return res.status(400).json({ error: 'No email in session' });
    }

    // Trouver le profil Supabase
    const profile = await getProfileByEmail(email);

    if (profile) {
      // Enregistrer la commande
      await supaInsert('orders', {
        user_id:           profile.id,
        stripe_session_id: session.id,
        product_name:      product,
        product_type:      type,
        amount:            amount,
        status:            'paid'
      });

      // Mettre à jour le plan si accompagnement
      if (type === 'accompagnement') {
        await updateProfilePlan(profile.id, 'accompagnement');
      } else if (type === 'formation' && profile.plan !== 'accompagnement') {
        await updateProfilePlan(profile.id, 'formation');
      }

      console.log(`✅ Order saved for ${email} — ${product} — ${amount/100}€`);
    } else {
      console.warn(`⚠️ No profile found for ${email}`);
      // Save anyway without user_id for manual reconciliation
      await supaInsert('orders', {
        stripe_session_id: session.id,
        product_name:      product,
        product_type:      type,
        amount:            amount,
        status:            'paid_no_user'
      });
    }
  }

  return res.status(200).json({ received: true });
}
