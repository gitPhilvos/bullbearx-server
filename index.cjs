const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const Stripe = require('stripe');
const admin = require('firebase-admin');
const fs = require('fs');

dotenv.config();

// Initialize Stripe and Express
const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Firebase Admin Setup
const serviceAccount = require('./firebaseServiceAccount.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// Middleware to parse the raw body for Stripe Webhook
app.use(cors());
app.use(express.json());

// ✅ Webhook to receive Stripe events
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log('📩 Webhook received:', event.type);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_email || session.metadata?.email;
    const tier = session.metadata?.tier || 'pro';

    console.log(`✅ Payment complete → ${customerEmail} upgraded to ${tier}`);
    await updateUserTier(customerEmail, tier); // Update Firestore with new tier
  }

  res.status(200).json({ received: true });
});

// ✅ Create Checkout Session (Stripe)
app.post('/create-checkout-session', async (req, res) => {
  const { email, tier } = req.body;

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
    metadata: { email, tier }
  });

  res.send({ url: session.url });
});

// ✅ Firestore updater function to update the user's tier
async function updateUserTier(email, tier) {
  try {
    const snapshot = await db.collection('users').where('email', '==', email).get();

    if (snapshot.empty) {
      console.log('⚠️ No user found with email:', email);
      return;
    }

    snapshot.forEach(async (docRef) => {
      await docRef.ref.update({ tier });
      console.log(`🔁 Firestore updated: ${email} → ${tier}`);
    });
  } catch (err) {
    console.error('🔥 Firestore update failed:', err.message);
  }
}

// Start the server on port 4242
app.listen(4242, () => {
  console.log('✅ Stripe server running on http://localhost:4242');
});
