require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

// ======================
// 1. ENVIRONMENT VALIDATION
// ======================
const requiredEnvVars = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_ID_BASIC',
  'STRIPE_PRICE_ID_PRO',
  'STRIPE_PRICE_ID_ELITE',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'APP_BASE_URL'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// ======================
// 2. FIREBASE INITIALIZATION
// ======================
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  }),
  databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`
});
console.log('✓ Firebase initialized');

// ======================
// 3. EXPRESS SETUP
// ======================
const app = express();
app.use(cors({ origin: process.env.APP_BASE_URL }));
app.use(express.json());

// ======================
// 4. STRIPE ENDPOINTS
// ======================
const TIERS = {
  basic: process.env.STRIPE_PRICE_ID_BASIC,
  pro: process.env.STRIPE_PRICE_ID_PRO,
  elite: process.env.STRIPE_PRICE_ID_ELITE
};

// Create checkout session
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { tier, userId } = req.body;
    
    if (!TIERS[tier]) {
      return res.status(400).json({ error: 'Invalid tier' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: TIERS[tier], quantity: 1 }],
      mode: 'subscription',
      client_reference_id: userId,
      metadata: { tier },
      success_url: `${process.env.APP_BASE_URL}/dashboard?success=true`,
      cancel_url: `${process.env.APP_BASE_URL}/dashboard?canceled=true`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Webhook handler
app.post('/stripe-webhook', 
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('⚠️ Webhook verification failed:', err);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`🔔 Received event: ${event.type}`);

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutComplete(event.data.object);
          break;
        case 'customer.subscription.updated':
          await handleSubscriptionUpdate(event.data.object);
          break;
      }
      res.json({ received: true });
    } catch (err) {
      console.error('Webhook handler error:', err);
      res.status(500).end();
    }
  }
);

// ======================
// 5. HANDLER FUNCTIONS
// ======================
async function handleCheckoutComplete(session) {
  if (!session.subscription) return;

  await admin.firestore().collection('users')
    .doc(session.client_reference_id)
    .update({
      tier: session.metadata.tier,
      stripeSubscriptionId: session.subscription,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

async function handleSubscriptionUpdate(subscription) {
  if (subscription.status !== 'active') return;

  const userId = subscription.metadata.userId;
  if (!userId) return;

  await admin.firestore().collection('users')
    .doc(userId)
    .update({
      subscriptionStatus: 'active',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

// ======================
// 6. SERVER START
// ======================
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 CORS enabled for: ${process.env.APP_BASE_URL}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Server shutting down...');
  process.exit(0);
});