const express = require('express');
const axios = require('axios');
const router = express.Router();

const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
let optionCache = { data: null, timestamp: 0 };
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

router.get('/snapshot-options', async (req, res) => {
  const now = Date.now();

  if (optionCache.data && now - optionCache.timestamp < CACHE_TTL) {
    return res.json(optionCache.data);
  }

  try {
    const { data } = await axios.get(
      `https://api.polygon.io/v3/snapshot/options/SPY`,
      { params: { apiKey: POLYGON_API_KEY } }
    );

    optionCache = { data, timestamp: now };
    res.json(data);
  } catch (err) {
    console.error('Polygon fetch failed:', err.message);
    res.status(500).json({ error: 'Polygon snapshot failed' });
  }
});

module.exports = router;
