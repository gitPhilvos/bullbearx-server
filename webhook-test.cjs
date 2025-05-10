const express = require('express')
const app = express()

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  console.log('✅ Webhook received!')
  res.sendStatus(200)
})

app.listen(4242, () => {
  console.log('🔁 Test webhook server running on http://localhost:4242')
})
