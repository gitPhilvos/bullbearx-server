const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const Stripe = require('stripe')
const admin = require('firebase-admin')
const fs = require('fs')

dotenv.config()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const app = express()

// ✅ First: set up raw body only for /webhook
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature']
  let event

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('❌ Webhook error:', err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  console.log('📩 Incoming webhook received:', event.type)

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const customerEmail = session.customer_email
    const tier = session.metadata.tier

    console.log(`✅ Stripe payment complete → ${customerEmail} upgraded to ${tier}`)
    updateUserTier(customerEmail, tier)
  }

  res.status(200).json({ received: true })
})

// ✅ Then use these for normal routes
app.use(cors())
app.use(express.json())

// ✅ Firebase Admin setup
const serviceAccount = JSON.parse(fs.readFileSync('./firebaseServiceAccount.json', 'utf-8'))
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})
const db = admin.firestore()

// ✅ Create Checkout Session
app.post('/create-checkout-session', async (req, res) => {
  const { email, tier } = req.body

  const priceId = {
    basic: process.env.STRIPE_PRICE_ID_BASIC,
    pro: process.env.STRIPE_PRICE_ID_PRO,
    elite: process.env.STRIPE_PRICE_ID_ELITE,
  }[tier]

  if (!priceId) return res.status(400).send('Invalid tier.')

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: email,
    success_url: `${process.env.APP_BASE_URL}/dashboard`,
    cancel_url: `${process.env.APP_BASE_URL}/dashboard`,
    metadata: { email, tier },
  })

  res.send({ url: session.url })
})

// ✅ Helper to update Firestore tier
async function updateUserTier(email, tier) {
  try {
    const snapshot = await db.collection('users').where('email', '==', email).get()
    if (snapshot.empty) {
      console.log('⚠️ No user found with email:', email)
      return
    }

    snapshot.forEach(async (docRef) => {
      await docRef.ref.update({ tier })
      console.log(`🔁 Firestore updated: ${email} → ${tier}`)
    })
  } catch (err) {
    console.error('🔥 Firestore update failed:', err)
  }
}

// ✅ Start server
app.listen(4242, () => {
  console.log('✅ Stripe server running on http://localhost:4242')
})
