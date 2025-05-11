require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const admin = require('firebase-admin');
const app = express();

// Initialize Stripe with secret key
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is missing');
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Initialize Firebase
const serviceAccount = require('./firebaseServiceAccount.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173'
}));
app.use(express.json());

// Health check
app.get('/ping', (req, res) => res.send('pong'));

// Create Checkout Session
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { email, tier, uid } = req.body;
    
    // Validate input
    if (!email || !tier || !uid) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get price ID
    const priceId = process.env[`STRIPE_PRICE_ID_${tier.toUpperCase()}`];
    if (!priceId) {
      return res.status(400).json({ error: 'Invalid tier' });
    }

    // Create session
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
    console.error('Stripe error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Webhook handler
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const { uid, tier } = event.data.object.metadata;
      if (uid && tier) {
        await db.collection('users').doc(uid).update({ tier });
        console.log(`Updated ${uid} to ${tier} tier`);
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Firestore error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});