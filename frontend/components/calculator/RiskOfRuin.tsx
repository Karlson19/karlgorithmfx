'use client';
import { useState, useMemo } from 'react';
import { ShieldAlert, TrendingDown } from 'lucide-react';
import { riskOfRuin } from '@/lib/pairs';
import { cn } from '@/lib/utils';

// ─── Risk of Ruin ────────────────────────────────────────────────────────────
// Given your edge (win rate, payout ratio) and your risk per trade, what's
// the probability of a 50% drawdown? This is the number that should keep
// you up at night — most blown accounts had a "60% win rate strategy" that
// was actually 48% with a few losing streaks built in.
//
// We display:
//   - The probability as a bar (with color tiers)
//   - The Kelly Criterion suggested risk (optimal compounding)
//   - A scenario table showing how risk of ruin scales with risk per trade
//
// Honest: the math assumes a stationary edge. In reality your edge changes
// with market regime, you take consecutive trades, etc. This is a lower
// bound — the real risk is higher than what's shown.

function kellyFraction(winRate: number, payoutRatio: number): number {
  const p = winRate / 100;
  const q = 1 - p;
  if (payoutRatio <= 0) return 0;
  // Kelly = p - q/payout
  const f = p - q / payoutRatio;
  return Math.max(0, f);
}

export default function RiskOfRuin() {
  const [winRate, setWinRate] = useState(55);
  const [rr, setRr] = useState(1.5);
  const [riskPct, setRiskPct] = useState(1);

  const ruin = useMemo(() => riskOfRuin(winRate, rr, riskPct), [winRate, rr, riskPct]);
  const kelly = useMemo(() => kellyFraction(winRate, rr) * 100, [winRate, rr]);

  // Scenarios — same edge, different risk %.
  const scenarios = useMemo(() => {
    return [0.5, 1, 2, 3, 5].map(r => ({ risk: r, ruin: riskOfRuin(winRate, rr, r) }));
  }, [winRate, rr]);

  const ruinPct = (ruin * 100).toFixed(1);
  const ruinColor =
    ruin > 0.5 ? 'text-danger'
    : ruin > 0.2 ? 'text-yellow-400'
    : ruin > 0.05 ? 'text-accent'
    : 'text-success';

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <ShieldAlert className="w-5 h-5 text-danger" />
        <h3 className="text-white font-bold">Risk of Ruin</h3>
      </div>
      <p className="text-text-secondary text-xs mb-5">
        Probability your account hits a 50% drawdown given the edge below.
        Assumes a stationary edge — reality is usually worse.
      </p>

      <div className="space-y-4 mb-5">
        <div>
          <div className="flex justify-between text-xs mb-1">
            <label className="text-text-secondary">Win Rate</label>
            <span className="text-white font-mono">{winRate}%</span>
          </div>
          <input type="range" min="30" max="80" step="1" value={winRate}
            onChange={e => setWinRate(parseInt(e.target.value))}
            className="w-full accent-accent" />
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1">
            <label className="text-text-secondary">Risk/Reward Ratio</label>
            <span className="text-white font-mono">1 : {rr.toFixed(1)}</span>
          </div>
          <input type="range" min="0.5" max="5" step="0.1" value={rr}
            onChange={e => setRr(parseFloat(e.target.value))}
            className="w-full accent-accent" />
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1">
            <label className="text-text-secondary">Risk per Trade</label>
            <span className="text-white font-mono">{riskPct.toFixed(2)}%</span>
          </div>
          <input type="range" min="0.25" max="5" step="0.25" value={riskPct}
            onChange={e => setRiskPct(parseFloat(e.target.value))}
            className="w-full accent-accent" />
        </div>
      </div>

      {/* Headline */}
      <div className="bg-background border border-border rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-text-secondary text-sm">Probability of 50% drawdown</span>
          <span className={cn('font-mono font-bold text-2xl', ruinColor)}>{ruinPct}%</span>
        </div>
        <div className="h-2 bg-border rounded-full overflow-hidden">
          <div className={cn('h-full transition-all',
            ruin > 0.5 ? 'bg-danger'
            : ruin > 0.2 ? 'bg-yellow-400'
            : ruin > 0.05 ? 'bg-accent'
            : 'bg-success'
          )} style={{ width: `${ruin * 100}%` }} />
        </div>
        <p className="text-text-secondary text-xs mt-2">
          Kelly-optimal risk for this edge: <span className="text-white font-mono">{kelly.toFixed(2)}%</span>
          {kelly > 0
            ? <span className="ml-2">· Practical traders use ¼–½ Kelly to survive variance.</span>
            : <span className="text-danger ml-2">· This edge is NEGATIVE. Don't trade it.</span>}
        </p>
      </div>

      {/* Scenario table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-background border-b border-border flex items-center gap-2">
          <TrendingDown className="w-3.5 h-3.5 text-text-secondary" />
          <span className="text-text-secondary text-xs uppercase tracking-wider font-semibold">
            How risk scales — same edge, different position sizes
          </span>
        </div>
        <div className="divide-y divide-border">
          {scenarios.map(s => (
            <div key={s.risk} className={cn(
              'flex items-center justify-between px-4 py-2 text-sm',
              Math.abs(s.risk - riskPct) < 0.01 && 'bg-accent/5'
            )}>
              <span className="text-text-secondary font-mono">{s.risk.toFixed(2)}% per trade</span>
              <div className="flex items-center gap-2 flex-1 max-w-xs ml-4">
                <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                  <div className={cn('h-full',
                    s.ruin > 0.5 ? 'bg-danger'
                    : s.ruin > 0.2 ? 'bg-yellow-400'
                    : s.ruin > 0.05 ? 'bg-accent'
                    : 'bg-success'
                  )} style={{ width: `${s.ruin * 100}%` }} />
                </div>
                <span className={cn('font-mono text-xs w-12 text-right',
                  s.ruin > 0.5 ? 'text-danger'
                  : s.ruin > 0.2 ? 'text-yellow-400'
                  : s.ruin > 0.05 ? 'text-accent'
                  : 'text-success'
                )}>
                  {(s.ruin * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
