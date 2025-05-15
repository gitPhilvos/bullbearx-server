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

// Routes
const optionDataRoutes = require('./routes/optionData');
app.use('/api', optionDataRoutes);

// Stripe Webhook - Must use raw body parser first
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    console.log('🔔 Webhook received! Type:', event.type);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      console.log('💰 Payment received!');
      console.log('Session metadata:', session.metadata);
      console.log('Customer email:', session.customer_email);

      const uid = session.metadata?.uid || session.metadata?.firebase_uid;
      const tier = session.metadata?.tier;
      const customer_email = session.customer_email;

      if (!uid || !tier) {
        console.error('❌ Missing UID or tier in metadata');
        return res.status(200).json({ received: true }); // Still return 200 to prevent retries
      }

      try {
        const userRef = db.collection('users').doc(uid);
        console.log(`🔄 Updating Firestore for user ${uid}`);

        await userRef.set({
          email: customer_email,
          tier: tier,
          stripeCustomerId: session.customer,
          subscriptionStatus: 'active',
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log(`✅ Successfully updated user ${uid} to ${tier} tier`);
      } catch (firebaseError) {
        console.error('🔥 Firestore error:', firebaseError);
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('❌ Webhook processing failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json());

// Health check
app.get('/ping', (req, res) => res.send('pong 🏓'));

// Create Checkout Session
app.post('/create-checkout-session', async (req, res) => {
  const { email, tier, uid } = req.body;

  console.log('🎯 Creating checkout session for:', { email, tier, uid });

  if (!email || !tier || !uid) {
    console.error('❌ Missing required fields');
    return res.status(400).json({ error: 'Missing email, tier, or uid' });
  }

  const priceId = process.env[`STRIPE_PRICE_ID_${tier.toUpperCase()}`];
  if (!priceId) {
    console.error('❌ Invalid tier:', tier);
    return res.status(400).json({ error: `Invalid tier: ${tier}` });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      success_url: `${process.env.FRONTEND_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/upgrade?canceled=true`,
      metadata: { 
        uid: uid,
        firebase_uid: uid, // Duplicate for redundancy
        tier: tier
      },
    });

    console.log('🔗 Checkout session created:', session.id);
    res.json({ sessionId: session.id });
  } catch (err) {
    console.error('💥 Stripe session creation failed:', err.message);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Verify subscription status
app.get('/verify-subscription/:session_id', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.session_id);
    console.log('🔍 Verifying subscription:', session.id);
    res.json({ 
      status: session.payment_status, 
      tier: session.metadata?.tier 
    });
  } catch (err) {
    console.error('❌ Verification failed:', err.message);
    res.status(500).json({ error: 'Failed to verify subscription' });
  }
});

// Start server
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log(`💰 Stripe Mode: ${process.env.STRIPE_SECRET_KEY.includes('test') ? 'TEST' : 'LIVE'}`);
});