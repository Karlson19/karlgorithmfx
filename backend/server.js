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
const marketRoutes = require('./routes/market');
const healthRoutes = require('./routes/health');

const priceService = require('./services/priceService');
const signalsOrchestrator = require('./services/signalsOrchestrator');
const signalHistoryService = require('./services/signalHistoryService');
const calibration = require('./services/calibrationService');
const websocketService = require('./services/websocketService');
const { listEnabledSymbols, PRIMARY_SYMBOL } = require('./config/pairs');

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
app.use('/api/market', marketRoutes);
app.use('/api/health', healthRoutes);

// Legacy short health check — kept for any external pingers expecting it.
app.get('/health', (req, res) => res.json({ status: 'ok', pairs: listEnabledSymbols() }));

websocketService.init(server);

// ── Cron schedule (API-budget aware) ──────────────────────────────────────────
// Twelve Data free tier: 800 req/day, 8 req/min.
// Budget per H1 cycle for 5 pairs (EUR/USD, GBP/USD, USD/JPY, AUD/USD, XAU/USD):
//   H1 candles + H4 + M15 + 1day per pair = 4 calls × 5 pairs = 20 calls
//   × 24 H1 cycles/day = 480/day
//   + live price (1 pair every 5 min) = 288/day
//   = ~768/day — fits within 800 with ~30 call headroom.

// Price ticker: only for PRIMARY_SYMBOL every 5 min. Reduced from 2 min
// when we added the 5th pair (AUD/USD) so we stay under the daily cap.
// Multi-pair live prices are fetched on-demand from the frontend when the
// user opens the overview.
cron.schedule('*/5 * * * *', async () => {
  try {
    const price = await priceService.fetchLivePrice(PRIMARY_SYMBOL);
    if (price) websocketService.broadcast({ type: 'PRICE_UPDATE', data: price });
  } catch (err) {
    console.error('Cron price fetch error:', err.message);
  }
});

// Signal generation: every 15 min, all enabled pairs in parallel.
// The signal cache key is per-pair and aligned to candle close, so most of
// these runs will be cache hits within the same H1; the cron just ensures
// freshness shortly after each H1 boundary.
cron.schedule('*/15 * * * *', async () => {
  try {
    const out = await signalsOrchestrator.generateAllSignals();
    websocketService.broadcast({ type: 'SIGNALS_ALL_UPDATE', data: out });
    if (out.signals[PRIMARY_SYMBOL]) {
      websocketService.broadcast({ type: 'SIGNAL_UPDATE', data: out.signals[PRIMARY_SYMBOL] });
    }
  } catch (err) {
    console.error('Cron signal error:', err.message);
  }
});

// Evaluate open signals every 30 min, then refresh calibration so the next
// emission uses the latest win-rate data.
cron.schedule('*/30 * * * *', async () => {
  try {
    await signalHistoryService.evaluateOpenSignals();
    await calibration.refreshCalibration();
  } catch (err) {
    console.error('Cron evaluate/calibrate error:', err.message);
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`KarlgorithmFX backend running on port ${PORT}`);
  console.log(`Enabled pairs: ${listEnabledSymbols().join(', ')}`);
  // Warm caches on boot
  priceService.fetchLivePrice(PRIMARY_SYMBOL)
    .catch(err => console.error('Initial price fetch failed:', err.message));
  calibration.refreshCalibration()
    .catch(err => console.error('Initial calibration load failed:', err.message));
});
