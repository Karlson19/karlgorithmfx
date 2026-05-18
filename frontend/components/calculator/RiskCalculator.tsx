'use client';
import { useState, useEffect, useMemo } from 'react';
import { Calculator, AlertTriangle } from 'lucide-react';
import PairSelector from '@/components/dashboard/PairSelector';
import { Signal } from '@/types';
import {
  getPair, recommendedLotSize, pipValueUsd, PRIMARY_SYMBOL, pipsBetween,
} from '@/lib/pairs';
import { cn } from '@/lib/utils';

interface RiskCalculatorProps {
  // When provided, calculator pre-fills from this signal and shows the
  // "Take this trade" call-to-action linking to the journal.
  signal?: Signal | null;
  onTakeTrade?: (computed: { lotSize: number; symbol: string }) => void;
}

// ─── Position sizer ──────────────────────────────────────────────────────────
// Inputs: account balance, % to risk, SL distance in pips, pair.
// Output: recommended lot size, USD at risk, pip value, position notional,
//         and an honest warning when the suggested size is impractically tiny
//         or hits the safety cap (something upstream is off).
export default function RiskCalculator({ signal, onTakeTrade }: RiskCalculatorProps) {
  const [symbol, setSymbol] = useState<string>(signal?.symbol || PRIMARY_SYMBOL);
  const [balance, setBalance] = useState('10000');
  const [riskPct, setRiskPct] = useState(1);
  const [slPips, setSlPips] = useState('30');

  // Prefill SL pips + symbol when a signal is provided
  useEffect(() => {
    if (!signal) return;
    if (signal.symbol) setSymbol(signal.symbol);
    if (signal.entry != null && signal.stop_loss != null) {
      const pips = pipsBetween(signal.symbol, signal.entry, signal.stop_loss);
      if (pips > 0) setSlPips(pips.toFixed(1));
    }
  }, [signal]);

  const pair = getPair(symbol);

  const result = useMemo(() => {
    const bal = parseFloat(balance);
    const sl  = parseFloat(slPips);
    if (!bal || !sl || sl <= 0) return null;
    const lotSize = recommendedLotSize(symbol, bal, riskPct, sl);
    if (lotSize === null) return null;
    const moneyAtRisk = sl * pair.pip_value_per_std_lot_usd * lotSize;
    const positionNotional = lotSize * pair.contract_size;
    const pipVal = pipValueUsd(symbol, lotSize);
    return { lotSize, moneyAtRisk, positionNotional, pipVal };
  }, [balance, riskPct, slPips, symbol, pair]);

  // Sanity warnings
  const warnings: string[] = [];
  if (result) {
    if (result.lotSize < 0.01) warnings.push('Suggested lot is below most brokers’ minimum (0.01). Consider widening SL or risking more.');
    if (result.lotSize >= 100) warnings.push('Suggested lot hit the 100-lot safety cap — input probably wrong.');
    if (riskPct > 2) warnings.push('Risking more than 2% per trade compounds drawdowns fast.');
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <Calculator className="w-5 h-5 text-accent" />
          <h3 className="text-white font-bold">Position Size Calculator</h3>
        </div>
        <PairSelector value={symbol} onChange={setSymbol} />
      </div>

      {signal && signal.direction !== 'NEUTRAL' && (
        <div className="mb-4 px-3 py-2 bg-accent/10 border border-accent/30 rounded-lg text-xs">
          <span className="text-accent font-semibold">Prefilled from live signal:</span>
          <span className="text-text-secondary ml-1">
            {signal.direction} {signal.display_name || signal.symbol} @ {signal.entry}
          </span>
        </div>
      )}

      <div className="space-y-4 mb-5">
        <div>
          <label className="text-text-secondary text-xs mb-1 block">Account Balance (USD)</label>
          <input
            type="number" value={balance} onChange={e => setBalance(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-white font-mono focus:border-accent outline-none"
          />
        </div>

        <div>
          <div className="flex justify-between text-xs mb-1">
            <label className="text-text-secondary">Risk Per Trade</label>
            <span className={cn('font-semibold',
              riskPct <= 1 ? 'text-success' : riskPct <= 2 ? 'text-accent' : 'text-yellow-400'
            )}>{riskPct}%</span>
          </div>
          <input
            type="range" min="0.25" max="5" step="0.25" value={riskPct}
            onChange={e => setRiskPct(parseFloat(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-xs text-text-secondary mt-1">
            <span>0.25%</span><span>2% (recommended)</span><span>5%</span>
          </div>
        </div>

        <div>
          <label className="text-text-secondary text-xs mb-1 block">
            Stop Loss Distance (pips){' '}
            <span className="text-text-secondary/70 font-mono">[{pair.symbol} pip = {pair.pip_size}]</span>
          </label>
          <input
            type="number" value={slPips} onChange={e => setSlPips(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-white font-mono focus:border-accent outline-none"
          />
        </div>
      </div>

      {result && (
        <>
          <div className="border border-border rounded-lg divide-y divide-border mb-4">
            {[
              { label: 'Recommended Lot Size', value: result.lotSize.toFixed(2), highlight: true },
              { label: 'Money at Risk', value: `$${result.moneyAtRisk.toFixed(2)}` },
              { label: 'Pip Value (this size)', value: `$${result.pipVal.toFixed(2)} / pip` },
              { label: pair.symbol === 'XAU/USD' ? 'Position (oz)' : 'Position Notional',
                value: pair.symbol === 'XAU/USD'
                  ? `${result.positionNotional.toFixed(1)} oz`
                  : `${(result.positionNotional).toLocaleString()} units` },
            ].map(row => (
              <div key={row.label} className="flex justify-between px-4 py-3">
                <span className="text-text-secondary text-sm">{row.label}</span>
                <span className={row.highlight ? 'text-accent font-bold font-mono text-lg' : 'text-white font-mono text-sm'}>{row.value}</span>
              </div>
            ))}
          </div>

          {warnings.length > 0 && (
            <div className="mb-4 px-3 py-2 bg-yellow-400/10 border border-yellow-400/30 rounded-lg flex items-start gap-2 text-xs">
              <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="text-text-secondary space-y-0.5">
                {warnings.map((w, i) => <p key={i}>{w}</p>)}
              </div>
            </div>
          )}

          {onTakeTrade && signal && signal.direction !== 'NEUTRAL' && (
            <button
              onClick={() => onTakeTrade({ lotSize: result.lotSize, symbol })}
              className="w-full bg-success text-black font-bold py-3 rounded-lg hover:bg-success/90 transition-colors"
            >
              Log this trade ({result.lotSize.toFixed(2)} lots)
            </button>
          )}
        </>
      )}

      {pair.symbol === 'USD/JPY' && (
        <p className="text-text-secondary text-xs mt-4">
          Pip value for USD/JPY is an estimate at JPY ≈ 150. Actual value at trade time = 1000 / current price.
        </p>
      )}
    </div>
  );
}
