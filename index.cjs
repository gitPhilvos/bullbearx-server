require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const admin = require('firebase-admin');

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Initialize Firebase
const serviceAccount = require('./firebaseServiceAccount.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// Middleware - Webhook needs raw body first
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') {
    next(); // Don't parse body for webhook
  } else {
    express.json()(req, res, next);
  }
});

// Routes
const optionDataRoutes = require('./routes/optionData');
app.use('/api', optionDataRoutes);

// Stripe Webhook
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const payload = req.body.toString();
  
  console.log('ℹ️ Webhook received | Raw payload length:', payload.length);
  console.log('ℹ️ Stripe-Signature header:', sig);
  console.log('ℹ️ Webhook secret:', process.env.STRIPE_WEBHOOK_SECRET ? 'exists' : 'MISSING');

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      payload,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log('✅ Webhook verified:', event.type);
  } catch (err) {
    console.error('❌ Webhook verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Process the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('💰 Payment received! Session ID:', session.id);
    console.log('📦 Metadata:', session.metadata);

    const uid = session.metadata?.uid;
    const tier = session.metadata?.tier;
    const email = session.customer_email;

    if (!uid || !tier) {
      console.error('❌ Missing UID or tier in metadata');
      return res.status(400).json({error: 'Missing UID or tier in metadata'});
    }

    try {
      await db.collection('users').doc(uid).set({
        email: email,
        tier: tier,
        stripeCustomerId: session.customer,
        subscriptionStatus: 'active',
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      }, {merge: true});
      
      console.log(`✅ Updated user ${uid} to ${tier} tier`);
    } catch (firebaseError) {
      console.error('🔥 Firestore error:', firebaseError);
    }
  }

  res.status(200).json({received: true});
});

// Regular middleware for other routes
app.use(cors({
  origin: process.env.FRONTEND_URL
}));

// Health check
app.get('/ping', (req, res) => res.send('pong 🏓'));

// Create Checkout Session
app.post('/create-checkout-session', async (req, res) => {
  const {email, tier, uid} = req.body;

  if (!email || !tier || !uid) {
    return res.status(400).json({error: 'Missing email, tier, or uid'});
  }

  const priceId = process.env[`STRIPE_PRICE_ID_${tier.toUpperCase()}`];
  if (!priceId) {
    return res.status(400).json({error: `Invalid tier: ${tier}`});
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{price: priceId, quantity: 1}],
      customer_email: email,
      success_url: `${process.env.FRONTEND_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/upgrade?canceled=true`,
      metadata: {
        uid: uid,
        tier: tier
      },
    });

    res.json({sessionId: session.id});
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({error: 'Failed to create session'});
  }
});

// Start server
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Webhook URL: ${process.env.FRONTEND_URL}/webhook`);
  console.log(`💰 Stripe Mode: ${process.env.STRIPE_SECRET_KEY.includes('test') ? 'TEST' : 'LIVE'}`);
});