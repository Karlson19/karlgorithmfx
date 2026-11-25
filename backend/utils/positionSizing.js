const { getPair } = require('../config/pairs');

// ─── Small-account position sizing ───────────────────────────────────────────
// Answers "how big can this trade be without risking too much of my balance?"
//
// Exness lot rules used here:
//   Standard account:      minimum lot 0.01 (1,000 units of base currency)
//   Standard Cent account: 0.01 cent lot = 0.0001 standard lot (10 units)
// A stop that risks more than your limit at the MINIMUM lot is "too big":
// the only safe choices are to skip it or use a cent account.
//
// risk in USD = stop distance in pips x pip value per standard lot x lot (in standard lots)

function positionSizing(signal, { balance, riskPct = 2, accountType = 'standard' } = {}) {
  const pair = getPair(signal.symbol);
  if (!pair || !(balance > 0)) return null;
  const stopPips = Math.abs(Number(signal.entry) - Number(signal.stop_loss)) / pair.pip_size;
  if (!(stopPips > 0)) return null;

  const cent = accountType === 'cent';
  const minStd = cent ? 0.0001 : 0.01;       // smallest tradable size, in standard lots
  const riskPerStdLot = stopPips * pair.pip_value_per_std_lot_usd;
  const maxRiskUsd = (balance * riskPct) / 100;
  const minLotRiskUsd = riskPerStdLot * minStd;

  const fitStd = Math.floor(maxRiskUsd / riskPerStdLot / minStd + 1e-9) * minStd;
  const tooBig = fitStd < minStd;
  const shown = (std) => Math.round((cent ? std * 100 : std) * 100) / 100; // cent lots = std x 100

  return {
    stopPips: Math.round(stopPips * 10) / 10,
    maxRiskUsd,
    minLot: shown(minStd),
    minLotRiskUsd,
    minLotRiskPct: (minLotRiskUsd / balance) * 100,
    lots: tooBig ? 0 : shown(fitStd),
    lotsRiskUsd: tooBig ? 0 : fitStd * riskPerStdLot,
    tooBig,
    cent,
  };
}

// One or two lines for the Telegram message, or null when no balance is configured.
function sizingLines(signal, env = process.env) {
  const balance = Number(env.ACCOUNT_BALANCE_USD);
  if (!(balance > 0)) return null;
  const riskPct = Number(env.RISK_PER_TRADE_PCT || 2);
  const accountType = env.ACCOUNT_TYPE === 'cent' ? 'cent' : 'standard';
  const s = positionSizing(signal, { balance, riskPct, accountType });
  if (!s) return null;
  const usd = (x) => `$${x.toFixed(2)}`;
  if (s.tooBig) {
    return `⛔ Too big for your ${usd(balance)}: the smallest lot (${s.minLot}) would risk ${usd(s.minLotRiskUsd)} (${s.minLotRiskPct.toFixed(1)}% of your balance, your limit is ${riskPct}%). ` +
      (s.cent ? 'Skip this one.' : 'Skip it, or use a cent account.');
  }
  return `Size: ${s.lots} ${s.cent ? 'cent ' : ''}lots risks about ${usd(s.lotsRiskUsd)} (${((s.lotsRiskUsd / balance) * 100).toFixed(1)}% of your ${usd(balance)}), stop ${s.stopPips} pips away.`;
}

module.exports = { positionSizing, sizingLines };
