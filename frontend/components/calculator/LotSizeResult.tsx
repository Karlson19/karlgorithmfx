'use client';
import { useState } from 'react';
import PairSelector from '@/components/dashboard/PairSelector';
import { getPair, pipValueUsd, pipsBetween, PRIMARY_SYMBOL } from '@/lib/pairs';
import { cn } from '@/lib/utils';

// Two utility calculators in one card:
//   1. Pip Value: lot size + pip movement → USD P&L
//   2. Risk/Reward: entry + SL + TP → pips, R/R, break-even win rate
// Both are pair-aware — the pip math, precision, and labels all respect
// the selected pair (yen, gold, etc.).
export default function LotSizeResult() {
  const [symbol, setSymbol] = useState<string>(PRIMARY_SYMBOL);
  const pair = getPair(symbol);

  // ── Pip P&L ────────────────────────────────────────────────────────────────
  const [lotSize, setLotSize] = useState('0.01');
  const [pipMove, setPipMove] = useState('');
  const ls = parseFloat(lotSize);
  const pm = parseFloat(pipMove);
  const pipPL = (isFinite(ls) && isFinite(pm))
    ? (pm * pipValueUsd(symbol, ls)).toFixed(2)
    : null;

  // ── R/R ────────────────────────────────────────────────────────────────────
  const [entry, setEntry] = useState('');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const entryN = parseFloat(entry);
  const slN    = parseFloat(sl);
  const tpN    = parseFloat(tp);
  const slPips = isFinite(entryN) && isFinite(slN) ? pipsBetween(symbol, entryN, slN).toFixed(1) : null;
  const tpPips = isFinite(entryN) && isFinite(tpN) ? pipsBetween(symbol, entryN, tpN).toFixed(1) : null;
  const rr = slPips && tpPips && parseFloat(slPips) > 0
    ? (parseFloat(tpPips) / parseFloat(slPips)).toFixed(2) : null;
  const breakEven = rr ? (100 / (1 + parseFloat(rr))).toFixed(1) : null;

  const step = pair.pip_size / 10;

  return (
    <div className="space-y-4">
      {/* Pair selector — shared between both panels below */}
      <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
        <p className="text-text-secondary text-sm">Calculations for</p>
        <PairSelector value={symbol} onChange={setSymbol} />
      </div>

      {/* Pip P&L */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-white font-bold mb-1">Pip P&L Calculator</h3>
        <p className="text-text-secondary text-xs mb-4">
          {pair.symbol} · pip value @ 1.0 lot = ${pair.pip_value_per_std_lot_usd}
        </p>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-text-secondary text-xs mb-1 block">Lot Size</label>
            <input
              type="number" step="0.01" value={lotSize}
              onChange={e => setLotSize(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-accent outline-none"
            />
          </div>
          <div>
            <label className="text-text-secondary text-xs mb-1 block">Pip Movement</label>
            <input
              type="number" value={pipMove}
              onChange={e => setPipMove(e.target.value)}
              placeholder="e.g. 20"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-accent outline-none"
            />
          </div>
        </div>
        {pipPL && (
          <div className="flex justify-between bg-background border border-border rounded-lg px-4 py-3">
            <span className="text-text-secondary text-sm">P&L</span>
            <span className={cn('font-mono font-bold',
              parseFloat(pipPL) >= 0 ? 'text-success' : 'text-danger'
            )}>
              {parseFloat(pipPL) >= 0 ? '+$' : '-$'}{Math.abs(parseFloat(pipPL)).toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* R/R */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-white font-bold mb-1">Risk / Reward Calculator</h3>
        <p className="text-text-secondary text-xs mb-4">{pair.symbol} prices, {pair.digits} decimals</p>
        <div className="space-y-3 mb-4">
          {[
            { label: 'Entry Price', value: entry, set: setEntry },
            { label: 'Stop Loss',   value: sl,    set: setSl },
            { label: 'Take Profit', value: tp,    set: setTp },
          ].map(row => (
            <div key={row.label}>
              <label className="text-text-secondary text-xs mb-1 block">{row.label}</label>
              <input
                type="number" step={step} value={row.value}
                onChange={e => row.set(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-accent outline-none"
              />
            </div>
          ))}
        </div>
        {rr && (
          <div className="border border-border rounded-lg divide-y divide-border">
            {[
              { label: 'Risk (pips)', value: slPips },
              { label: 'Reward (pips)', value: tpPips },
              { label: 'Risk/Reward', value: `1:${rr}`, bold: true },
              { label: 'Break-even Win Rate', value: `${breakEven}%` },
            ].map(row => (
              <div key={row.label} className="flex justify-between px-4 py-3">
                <span className="text-text-secondary text-sm">{row.label}</span>
                <span className={cn('font-mono text-sm', row.bold && 'text-accent font-bold')}>{row.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
