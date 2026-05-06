require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const cron = require('node-cron');

const priceRoutes = require('./routes/price');
const signalRoutes = require('./routes/signals');
const indicatorRoutes = require('./routes/indicators');
const journalRoutes = require('./routes/journal');
const newsRoutes = require('./routes/news');
const analysisRoutes = require('./routes/analysis');

const priceService = require('./services/priceService');
const signalService = require('./services/signalService');
const websocketService = require('./services/websocketService');

const app = express();
const server = http.createServer(app);

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json());

app.use('/api/price', priceRoutes);
app.use('/api/signals', signalRoutes);
app.use('/api/indicators', indicatorRoutes);
app.use('/api/journal', journalRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/analysis', analysisRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

websocketService.init(server);

// Fetch price every 2 minutes (keeps within Twelve Data free tier: 800 req/day)
cron.schedule('*/2 * * * *', async () => {
  try {
    const price = await priceService.fetchLivePrice();
    if (price) websocketService.broadcast({ type: 'PRICE_UPDATE', data: price });
  } catch (err) {
    console.error('Cron price fetch error:', err.message);
  }
});

// Generate signal every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  try {
    const signal = await signalService.generateSignal();
    if (signal) websocketService.broadcast({ type: 'SIGNAL_UPDATE', data: signal });
  } catch (err) {
    console.error('Cron signal error:', err.message);
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`KarlgorithmFX backend running on port ${PORT}`);
  // Initial price fetch
  priceService.fetchLivePrice().catch(err => console.error('Initial price fetch failed:', err.message));
});
