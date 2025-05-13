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
  let event;
  try {
    event = JSON.parse(req.body.toString());
    console.log('📩 Webhook event:', event.type);

    if (event.type === 'checkout.session.completed') {
      const { metadata, customer_email } = event.data.object;

      if (metadata?.uid && metadata?.tier) {
        await db.collection('users').doc(metadata.uid).update({ tier: metadata.tier });
        console.log(`✅ Updated ${customer_email} to ${metadata.tier}`);
      } else {
        console.log('⚠️ Missing UID or tier in metadata');
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('❌ Webhook error:', err.message);
    res.status(400).send('Webhook error');
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
      success_url: `${process.env.FRONTEND_URL}/dashboard?success=true`,
      cancel_url: `${process.env.FRONTEND_URL}/dashboard?canceled=true`,
      metadata: { uid, tier },
    });

    res.json({ sessionId: session.id });
  } catch (err) {
    console.error('❌ Stripe session error:', err.message);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// ✅ Start Server
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
