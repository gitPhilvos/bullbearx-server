// ✅ index.cjs (Backend)
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const Stripe = require('stripe');
const admin = require('firebase-admin');
const fs = require('fs');

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ✅ Firebase Admin Setup
const serviceAccount = require('./firebaseServiceAccount.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ✅ Stripe Webhook Middleware FIRST
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = JSON.parse(req.body.toString());
    console.log('📩 Webhook event received:', event.type);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const uid = session.metadata?.uid;
      const tier = session.metadata?.tier || 'pro';

      if (uid) {
        console.log(`✅ Payment complete → UID: ${uid} upgraded to ${tier}`);
        await updateUserTier(uid, tier);
      } else {
        console.warn('⚠️ Missing UID in metadata.');
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('❌ Webhook parsing failed:', err.message);
    res.status(400).send('Invalid webhook');
  }
});

// ✅ Normal middleware AFTER webhook
app.use(cors());
app.use(express.json());

app.get('/ping', (req, res) => {
  res.send('pong');
});

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

async function updateUserTier(uid, tier) {
  try {
    const docRef = db.collection('users').doc(uid);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      console.log('⚠️ No user found with UID:', uid);
      return;
    }

    await docRef.update({ tier });
    console.log(`🔁 Firestore updated: ${uid} → ${tier}`);
  } catch (err) {
    console.error('🔥 Failed to update Firestore:', err.message);
  }
}

app.listen(4242, () => {
  console.log('✅ Stripe server running on http://localhost:4242');
});
