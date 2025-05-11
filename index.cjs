require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const admin = require('firebase-admin');
const app = express();

// Initialize Stripe and Firebase
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const serviceAccount = require('./firebaseServiceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// Health check endpoint
app.get('/ping', (req, res) => res.send('pong'));

// Create Checkout Session
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { email, tier, uid } = req.body;
    
    if (!email || !tier || !uid) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const priceId = getPriceId(tier);
    if (!priceId) {
      return res.status(400).json({ error: 'Invalid tier specified' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      success_url: `${process.env.FRONTEND_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/dashboard?canceled=true`,
      metadata: { uid, tier }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Stripe Webhook Handler
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook verification failed:', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSession(event.data.object);
        break;
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper Functions
function getPriceId(tier) {
  const prices = {
    basic: process.env.STRIPE_PRICE_ID_BASIC,
    pro: process.env.STRIPE_PRICE_ID_PRO,
    elite: process.env.STRIPE_PRICE_ID_ELITE
  };
  return prices[tier.toLowerCase()];
}

async function handleCheckoutSession(session) {
  const { uid, tier } = session.metadata;
  if (!uid || !tier) {
    throw new Error('Missing metadata in checkout session');
  }
  await updateUserTier(uid, tier);
  console.log(`User ${uid} upgraded to ${tier} tier`);
}

async function handlePaymentSucceeded(invoice) {
  // Handle recurring payments if needed
  console.log(`Payment succeeded for subscription ${invoice.subscription}`);
}

async function updateUserTier(uid, tier) {
  try {
    await db.collection('users').doc(uid).update({ tier });
    console.log(`Updated user ${uid} to ${tier} tier`);
  } catch (err) {
    console.error('Firestore update error:', err);
    throw err;
  }
}

// Start Server
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});