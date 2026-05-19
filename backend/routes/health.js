const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const quota = require('../utils/quotaTracker');
const tdKeys = require('../utils/twelveDataKeys');
const calibration = require('../services/calibrationService');
const { listEnabledSymbols } = require('../config/pairs');

// ─── /api/health ─────────────────────────────────────────────────────────────
// Comprehensive system health snapshot. Consumed by:
//   - Frontend SystemStatus badge (polls every 30s)
//   - Manual debugging when something feels wrong
//
// Returns:
//   - status: ok | degraded | critical
//   - providers: per-provider quota usage (with per-key breakdown for
//                Twelve Data when multiple keys are configured)
//   - signals: per-pair last-signal age (how stale is each pair?)
//   - calibration: sample counts per pair (how much real data do we have?)

router.get('/', async (req, res) => {
  try {
    const now = Date.now();
    const symbols = listEnabledSymbols();

    // ── Providers ───────────────────────────────────────────────────────────
    const tdKeyIds = tdKeys.listKeyIds();
    const twelveData = tdKeyIds.length > 0
      ? quota.getProviderUsage('twelve_data', tdKeyIds)
      : {
          provider: 'twelve_data', name: 'Twelve Data',
          total_used: 0, total_limit: 0, total_ratio: 0,
          keys: [], healthy_keys: 0, total_keys: 0,
        };
    const alphaVantage = quota.getProviderUsage('alpha_vantage', ['default']);
    const openrouter  = quota.getProviderUsage('openrouter',    ['default']);

    // Map a provider object to a single status label.
    function providerStatus(p) {
      if (p.total_keys === 0) return 'missing_key';
      if (p.healthy_keys === 0) return 'exhausted';
      if (p.total_ratio >= 0.95) return 'hard_throttle';
      if (p.total_ratio >= 0.85) return 'soft_throttle';
      return 'ok';
    }

    const providers = [
      { ...twelveData,   status: providerStatus(twelveData) },
      { ...alphaVantage, status: providerStatus(alphaVantage) },
      { ...openrouter,   status: openrouter.total_keys === 0 ? 'missing_key' : 'unlimited' },
    ];

    // ── Per-pair signal freshness ───────────────────────────────────────────
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
        symbol: sym, status, age_minutes: ageMin,
        direction: sig.direction, confidence: sig.confidence,
      };
    });

    // ── Calibration samples per pair ────────────────────────────────────────
    let calibrationTable = null;
    try { calibrationTable = await calibration.getFullTable(); } catch {}
    const calibrationSamples = {};
    for (const sym of symbols) {
      const bands = (calibrationTable && calibrationTable[sym]) || {};
      let total = 0;
      for (const b of Object.values(bands)) total += b.total || 0;
      calibrationSamples[sym] = total;
    }

    // ── Overall status (worst component wins) ───────────────────────────────
    const reasons = [];
    let status = 'ok';
    if (providerStatus(twelveData) === 'exhausted') {
      status = 'critical';
      reasons.push('Twelve Data has exhausted today\'s quota across all keys');
    } else if (providerStatus(twelveData) === 'missing_key') {
      status = 'critical';
      reasons.push('No Twelve Data API key configured');
    }
    if (signals.some(s => s.status === 'stale')) {
      status = 'critical';
      reasons.push('A signal is more than 2h old — generation is broken');
    }
    if (status === 'ok') {
      const provHard = providers.some(p => p.status === 'hard_throttle');
      const provSoft = providers.some(p => p.status === 'soft_throttle');
      const aging    = signals.some(s => s.status === 'aging');
      if (provHard) { status = 'degraded'; reasons.push('A provider is near its daily quota'); }
      else if (provSoft) { status = 'degraded'; reasons.push('A provider is past 85% of daily quota'); }
      if (aging)    { status = 'degraded'; reasons.push('A signal is aging (>90 min)'); }
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
