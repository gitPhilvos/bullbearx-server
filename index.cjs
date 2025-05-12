require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const admin = require('firebase-admin');

const app = express();

// ✅ Validate Stripe Secret
if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_SECRET_KEY.startsWith('sk_')) {
  throw new Error('❌ STRIPE_SECRET_KEY is missing or invalid');
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ✅ Firebase Setup
const serviceAccount = require('./firebaseServiceAccount.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ✅ Middleware
app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json());

// ✅ Create Checkout Session
app.post('/create-checkout-session', async (req, res) => {
  const { email, tier, uid } = req.body;

  if (!email || !tier || !uid) {
    return res.status(400).json({ error: 'Missing email, tier, or uid' });
  }

  const priceId = process.env[`STRIPE_PRICE_ID_${tier.toUpperCase()}`];
  if (!priceId) {
    return res.status(400).json({ error: `Invalid tier: ${tier}` });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      success_url: `${process.env.FRONTEND_URL}/dashboard?success=true`,
      cancel_url: `${process.env.FRONTEND_URL}/dashboard?canceled=true`,
      metadata: { uid, tier }
    });

    res.json({ sessionId: session.id });
  } catch (err) {
    console.error('❌ Stripe session error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Stripe Webhook (optional — for updating Firestore after successful payment)
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = JSON.parse(req.body.toString());
    if (event.type === 'checkout.session.completed') {
      const { metadata, customer_email } = event.data.object;
      if (metadata?.uid && metadata?.tier) {
        await db.collection('users').doc(metadata.uid).update({ tier: metadata.tier });
        console.log(`✅ Updated ${customer_email} to ${metadata.tier}`);
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('❌ Webhook error:', err.message);
    res.status(400).send('Webhook error');
  }
});

// ✅ Start Server
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
