const clock = require('./clock');
const { aggregate, closedBuckets, H1 } = require('./data');

// ─── Replay harness ──────────────────────────────────────────────────────────
// Runs the REAL signal engine (indicators, strategies, vote, levels) on past
// candles. install() swaps out only what talks to the outside world:
//
//   database          -> fails closed (any access throws and is counted)
//   saveSignal        -> does nothing (the backtest never writes signals)
//   price data        -> served from the history, ONLY candles that had closed
//   news              -> none (no historical news; see report footer)
//   calibration       -> uncalibrated (so history cannot grade itself)
//   cache             -> off (every step recomputes)
//   Date              -> virtual clock at the close of the candle under test
//
// Call install() BEFORE anything requires signalService.

function stubModule(relPath, exports) {
  const resolved = require.resolve(relPath, { paths: [__dirname] });
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

function install() {
  clock.install();
  const state = { sym: null, h1: [], h4: [], d1: [], i: 0, dbCalls: 0 };

  stubModule('../db/supabase', {
    from() { state.dbCalls += 1; throw new Error('Database access is disabled during backtests'); },
  });
  stubModule('../services/signalHistoryService', { saveSignal: async () => null });

  const priceService = require('../services/priceService');
  const newsService = require('../services/newsService');
  const calibration = require('../services/calibrationService');
  const cache = require('../utils/cache');

  const nowSec = () => state.h1[state.i].time + H1; // the moment candle i closed

  priceService.fetchHistoricalData = async (interval, outputsize) => {
    if (interval === '1h') return state.h1.slice(Math.max(0, state.i + 1 - outputsize), state.i + 1);
    if (interval === '4h') return closedBuckets(state.h4, 4 * H1, nowSec(), outputsize);
    if (interval === '1day') return closedBuckets(state.d1, 24 * H1, nowSec(), outputsize);
    return []; // 15min and anything else: not available from H1 history
  };
  priceService.secondsUntilCandleClose = () => 300;
  newsService.fetchNews = async () => [];
  calibration.lookup = async () => ({ calibrated: false, sample_size: 0 });
  cache.get = () => null;
  cache.set = () => {};

  const { generateSignal } = require('../services/signalService');

  return {
    state,
    generateSignal,
    load(sym, h1) {
      state.sym = sym; state.h1 = h1; state.i = 0;
      state.h4 = aggregate(h1, 4 * H1);
      state.d1 = aggregate(h1, 24 * H1);
    },
    // Move the world to the moment candle i closed.
    at(i) {
      state.i = i;
      clock.setNow((nowSec() + 5) * 1000);
    },
    dbCalls: () => state.dbCalls,
    uninstall: clock.uninstall,
  };
}

module.exports = { install };
