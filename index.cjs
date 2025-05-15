require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const admin = require('firebase-admin');

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ✅ Firebase
const serviceAccount = require('./firebaseServiceAccount.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

const optionDataRoutes = require('./routes/optionData');
app.use('/api', optionDataRoutes);

// ✅ Stripe Webhook must use raw parser FIRST
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log('📩 Webhook verified:', event.type);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { metadata, customer_email } = session;

      if (metadata?.uid && metadata?.tier) {
        try {
          const userRef = db.collection('users').doc(metadata.uid);
          const doc = await userRef.get();
          
          if (!doc.exists) {
            // Create the user document if it doesn't exist
            await userRef.set({
              email: customer_email,
              tier: metadata.tier,
              stripeCustomerId: session.customer,
              subscriptionStatus: 'active',
              createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`✅ Created new user ${metadata.uid} with ${metadata.tier} tier`);
          } else {
            // Update existing user document
            await userRef.update({
              tier: metadata.tier,
              stripeCustomerId: session.customer,
              subscriptionStatus: 'active',
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`✅ Updated ${customer_email} to ${metadata.tier}`);
          }
        } catch (firebaseError) {
          console.error('❌ Firebase operation error:', firebaseError.message);
        }
      } else {
        console.log('⚠️ Missing UID or tier in metadata');
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('❌ Webhook error:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// ✅ JSON middleware AFTER webhook
app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json());

// ✅ Ping
app.get('/ping', (req, res) => res.send('pong'));

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
      success_url: `${process.env.FRONTEND_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/upgrade?canceled=true`,
      metadata: { uid, tier },
    });

    res.json({ sessionId: session.id });
  } catch (err) {
    console.error('❌ Stripe session error:', err.message);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// ✅ Verify subscription status
app.get('/verify-subscription/:session_id', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.session_id);
    res.json({ status: session.payment_status, tier: session.metadata.tier });
  } catch (err) {
    console.error('❌ Subscription verification error:', err.message);
    res.status(500).json({ error: 'Failed to verify subscription' });
  }
});

// ✅ Start Server
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});