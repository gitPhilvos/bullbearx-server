require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const admin = require('firebase-admin');
const app = express();

// Initialize Stripe
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

// Enhanced CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

// Debug middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Create Checkout Session (Enhanced Error Handling)
app.post('/create-checkout-session', async (req, res) => {
  console.log('Incoming request body:', req.body);
  
  try {
    const { email, tier, uid } = req.body;
    
    // Validation
    if (!email || !tier || !uid) {
      console.error('Missing fields in request');
      return res.status(400).json({ 
        error: 'Missing required fields',
        received: { email: !!email, tier: !!tier, uid: !!uid }
      });
    }

    // Get price ID
    const priceId = process.env[`STRIPE_PRICE_ID_${tier.toUpperCase()}`];
    console.log(`Using price ID for ${tier}:`, priceId);
    
    if (!priceId) {
      console.error('Invalid tier requested:', tier);
      return res.status(400).json({ 
        error: 'Invalid tier',
        validTiers: ['basic', 'pro', 'elite']
      });
    }

    // Create Stripe session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      success_url: `${process.env.FRONTEND_URL}/dashboard?success=true`,
      cancel_url: `${process.env.FRONTEND_URL}/dashboard?canceled=true`,
      metadata: { uid, tier }
    });

    console.log('Created Stripe session:', session.id);
    res.json({ sessionId: session.id });

  } catch (err) {
    console.error('Stripe API error:', err);
    res.status(500).json({ 
      error: err.message,
      type: err.type,
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined
    });
  }
});

// Start server
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Configured Stripe price IDs:', {
    basic: process.env.STRIPE_PRICE_ID_BASIC,
    pro: process.env.STRIPE_PRICE_ID_PRO,
    elite: process.env.STRIPE_PRICE_ID_ELITE
  });
});