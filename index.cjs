const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const Stripe = require('stripe');
const admin = require('firebase-admin');
const fs = require('fs');

// Load .env variables
dotenv.config();

// Init Express + Stripe
const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ✅ Firebase Admin Setup
const serviceAccount = require('./firebaseServiceAccount.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ✅ Middleware for Stripe webhook (must come BEFORE express.json)
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = JSON.parse(req.body.toString());

    console.log('📩 Webhook event received:', event.type);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = session.customer_email || session.metadata?.email;
      const tier = session.metadata?.tier || 'pro';

      console.log(`✅ Payment complete → ${email} upgraded to ${tier}`);
      await updateUserTier(email, tier);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('❌ Failed to parse webhook:', err.message);
    res.status(400).send('Invalid webhook body');
  }
});

// ✅ Normal middleware AFTER webhook
app.use(cors());
app.use(express.json());

// ✅ Test route
app.get('/ping', (req, res) => {
  res.send('pong');
});

// ✅ Create Checkout Session
app.post('/create-checkout-session', async (req, res) => {
  const { email, tier, uid } = req.body;

  const priceId = {
    basic: process.env.STRIPE_PRICE_ID_BASIC,
    pro: process.env.STRIPE_PRICE_ID_PRO,
    elite: process.env.STRIPE_PRICE_ID_ELITE
  }[tier];

  if (!priceId) return res.status(400).send('Invalid tier.');

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: email,
    success_url: `${process.env.APP_BASE_URL}/dashboard`,
    cancel_url: `${process.env.APP_BASE_URL}/dashboard`,
    metadata: { email, tier, uid }
  });

  res.send({ url: session.url });
});

// ✅ Update user tier in Firestore
async function updateUserTier(email, tier) {
  try {
    const snapshot = await db.collection('users').where('email', '==', email).get();
    if (snapshot.empty) {
      console.log('⚠️ No Firestore user found for:', email);
      return;
    }

    snapshot.forEach(async (docRef) => {
      await docRef.ref.update({ tier });
      console.log(`🔁 Firestore updated: ${email} → ${tier}`);
    });
  } catch (err) {
    console.error('🔥 Failed to update Firestore:', err.message);
  }
}

// Start server
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
