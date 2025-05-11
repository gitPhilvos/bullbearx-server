require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

// ======================
// 1. SERVICE ACCOUNT LOADER
// ======================
const serviceAccountDir = __dirname;
const possibleFileNames = [
  'service-account.json',        // Default name
  'firebaseServiceAccount.json', // Your current file
  'firebase-adminsdk.json',      // Common alternative
  'firebase-credentials.json'    // Another common name
];

let serviceAccount = null;
let usedFileName = '';

// Try all possible filenames
for (const fileName of possibleFileNames) {
  const fullPath = path.join(serviceAccountDir, fileName);
  if (fs.existsSync(fullPath)) {
    try {
      serviceAccount = require(fullPath);
      usedFileName = fileName;
      console.log(`✓ Loaded Firebase service account from: ${fileName}`);
      break;
    } catch (e) {
      console.warn(`⚠️ Found but couldn't load ${fileName}:`, e.message);
    }
  }
}

// Fallback to environment variables if no file found
if (!serviceAccount && process.env.FIREBASE_PRIVATE_KEY) {
  console.log('ℹ️ Using Firebase config from environment variables');
  serviceAccount = {
    type: 'service_account',
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
  };
}

// Final verification
if (!serviceAccount) {
  console.error('❌ No valid Firebase service account found. Tried:');
  console.log(possibleFileNames.map(n => `- ${n}`).join('\n'));
  console.log('Current directory files:', fs.readdirSync(serviceAccountDir));
  process.exit(1);
}

// ======================
// 2. FIREBASE INITIALIZATION
// ======================
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});
console.log('✓ Firebase initialized successfully');

// ======================
// 3. EXPRESS SERVER SETUP 
// (Include all the Stripe webhook handlers from previous examples)
// ======================
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ... [Include all your Stripe endpoints and webhook handlers here] ...

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));