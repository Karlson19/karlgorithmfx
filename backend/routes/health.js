const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const quota = require('../utils/quotaTracker');
const calibration = require('../services/calibrationService');
const { listEnabledSymbols } = require('../config/pairs');

// ─── /api/health ─────────────────────────────────────────────────────────────
// Comprehensive system health snapshot. Consumed by:
//   - Frontend SystemStatus badge (polls every 30s)
//   - Manual debugging when something feels wrong
//
// Returns:
//   - status: ok | degraded | critical
//   - providers: per-provider quota usage + status
//   - signals: per-pair last-signal age (how stale is each pair?)
//   - calibration: sample counts per pair (how much real data do we have?)
//   - cache: simple "we have data" sanity check
//
// Status logic:
//   - critical:  any provider exhausted, OR a signal is older than 2 hours
//                on an H1 timeframe (something is broken)
//   - degraded:  any provider in hard_throttle, OR signal older than 1h
//   - ok:        everything healthy

router.get('/', async (req, res) => {
  try {
    const now = Date.now();
    const symbols = listEnabledSymbols();

    // Per-provider quota
    const providers = quota.getAllUsage();

    // Per-pair signal freshness
    const signals = symbols.map(sym => {
      const sig = cache.get(`current_signal_${sym}`);
      if (!sig) {
        return { symbol: sym, status: 'never_generated', age_minutes: null };
      }
      const ageMin = Math.round((now - new Date(sig.timestamp).getTime()) / 60000);
      const status = ageMin > 120 ? 'stale'
                   : ageMin > 90  ? 'aging'
                   : 'fresh';
      return {
        symbol: sym,
        status,
        age_minutes: ageMin,
        direction: sig.direction,
        confidence: sig.confidence,
      };
    });

    // Calibration samples per pair
    let calibrationTable = null;
    try {
      calibrationTable = await calibration.getFullTable();
    } catch {}
    const calibrationSamples = {};
    for (const sym of symbols) {
      const bands = (calibrationTable && calibrationTable[sym]) || {};
      let total = 0;
      for (const b of Object.values(bands)) total += b.total || 0;
      calibrationSamples[sym] = total;
    }

    // Overall status calculation
    const anyExhausted   = providers.some(p => p.status === 'exhausted');
    const anyHardThrottle = providers.some(p => p.status === 'hard_throttle');
    const anyStale = signals.some(s => s.status === 'stale');
    const anyAging = signals.some(s => s.status === 'aging');

    let status = 'ok';
    let reasons = [];
    if (anyExhausted) { status = 'critical'; reasons.push('A provider has exhausted today\'s quota'); }
    if (anyStale)     { status = 'critical'; reasons.push('A signal is more than 2h old — generation is broken'); }
    if (status === 'ok' && (anyHardThrottle || anyAging)) {
      status = 'degraded';
      if (anyHardThrottle) reasons.push('A provider is near its daily quota');
      if (anyAging)        reasons.push('A signal is aging (>90 min)');
    }

    res.json({
      status,
      reasons,
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.round(process.uptime()),
      providers,
      signals,
      calibration_samples: calibrationSamples,
      pairs_enabled: symbols,
    });
  } catch (err) {
    res.status(500).json({
      status: 'critical',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

module.exports = router;
