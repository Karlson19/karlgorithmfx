const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const pushService = require('../services/pushService');

async function getUser(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error) return null;
  return user;
}

// GET /api/push/vapid-public-key → the public key the browser needs to
// subscribe. Safe to expose.
router.get('/vapid-public-key', (req, res) => {
  const key = pushService.getPublicKey();
  if (!key) return res.status(503).json({ error: 'Push not configured on server' });
  res.json({ publicKey: key });
});

// POST /api/push/subscribe → store the browser's push subscription.
router.post('/subscribe', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const { subscription } = req.body;
    await pushService.saveSubscription(user.id, subscription);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/push/unsubscribe → remove a subscription by endpoint.
router.post('/unsubscribe', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const { endpoint } = req.body;
    await pushService.removeSubscription(endpoint);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/push/test → send a test push to the caller (verifies the whole
// chain end-to-end from the device).
router.post('/test', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const result = await pushService.sendToUser(user.id, {
      title: 'KarlFX push is working ✅',
      body: 'You will be alerted here when an open trade needs attention.',
      severity: 'info',
      url: '/monitor',
      tag: 'karlfx-test',
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
