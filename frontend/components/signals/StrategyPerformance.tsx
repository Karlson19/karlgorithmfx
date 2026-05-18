'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { Trophy, TrendingDown, BarChart3, Info } from 'lucide-react';

interface StratRow {
  name: string;
  total: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_confidence?: number;
}

interface StrategyStatsResponse {
  strategies: StratRow[];
  by_pair: Record<string, StratRow[]>;
  min_samples: number;
}

// ─── StrategyPerformance ─────────────────────────────────────────────────────
// Surfaces "which named strategies actually win, on which pairs."
// Reads from /api/signals/strategy-stats which aggregates signals.outcome
// grouped by fired_strategy_name.
//
// Until enough closed signals accumulate (≥8 per strategy), we show the
// raw counts with a "needs more samples" note. With ≥8, we color the win
// rate by tier (green ≥60%, yellow 50-59%, red <50%) so a glance tells you
// what's working and what isn't.
export default function StrategyPerformance() {
  const [data, setData] = useState<StrategyStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overall' | string>('overall');

  useEffect(() => {
    api.getStrategyStats().then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="bg-card border border-border rounded-xl p-6 animate-pulse h-32" />;
  }

  if (!data || data.strategies.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="w-5 h-5 text-accent" />
          <h3 className="text-white font-bold">Strategy Performance</h3>
        </div>
        <p className="text-text-secondary text-sm">
          No closed-outcome signals yet. As signals fire and get evaluated, this
          panel fills in with real per-strategy win rates.
        </p>
      </div>
    );
  }

  const minSamples = data.min_samples;
  const pairs = Object.keys(data.by_pair);
  const activeRows = tab === 'overall' ? data.strategies : (data.by_pair[tab] || []);

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-accent" />
          <h3 className="text-white font-bold">Strategy Performance</h3>
        </div>
        <div className="flex gap-1 flex-wrap">
          <TabBtn label="Overall" active={tab === 'overall'} onClick={() => setTab('overall')} />
          {pairs.map(p => (
            <TabBtn key={p} label={p} active={tab === p} onClick={() => setTab(p)} />
          ))}
        </div>
      </div>

      {activeRows.length === 0 ? (
        <p className="text-text-secondary text-sm">No data for this pair yet.</p>
      ) : (
        <div className="space-y-2">
          {activeRows.map(row => <StrategyRow key={row.name} row={row} minSamples={minSamples} />)}
        </div>
      )}

      <p className="text-text-secondary text-xs mt-4 flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        Win rates are only calibrated once a strategy has ≥{minSamples} closed signals on that pair.
        Until then, treat the number as an early signal not a verdict.
      </p>
    </div>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 rounded text-xs font-mono transition-colors',
        active
          ? 'bg-accent text-black font-bold'
          : 'text-text-secondary hover:text-white hover:bg-white/5'
      )}
    >
      {label}
    </button>
  );
}

function StrategyRow({ row, minSamples }: { row: StratRow; minSamples: number }) {
  const calibrated = row.total >= minSamples;
  const wr = row.win_rate;
  const wrColor =
    !calibrated ? 'text-text-secondary'
    : wr >= 60 ? 'text-success'
    : wr >= 50 ? 'text-yellow-400'
    : 'text-danger';
  const Icon = wr >= 60 ? Trophy : wr >= 50 ? BarChart3 : TrendingDown;

  return (
    <div className="bg-background border border-border rounded-lg p-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={cn('w-4 h-4 flex-shrink-0', wrColor)} />
          <span className="text-white text-sm font-semibold truncate">{row.name}</span>
        </div>
        <div className="flex items-center gap-3 text-xs flex-shrink-0">
          <span className="text-text-secondary">
            <span className="text-success font-mono">{row.wins}W</span>
            <span className="mx-1">/</span>
            <span className="text-danger font-mono">{row.losses}L</span>
          </span>
          <span className={cn('font-mono font-bold text-base w-12 text-right', wrColor)}>{wr}%</span>
        </div>
      </div>
      <div className="h-1.5 bg-border rounded-full overflow-hidden">
        <div className={cn('h-full',
          !calibrated ? 'bg-text-secondary/50'
          : wr >= 60 ? 'bg-success'
          : wr >= 50 ? 'bg-yellow-400'
          : 'bg-danger'
        )} style={{ width: `${wr}%` }} />
      </div>
      {!calibrated && (
        <p className="text-text-secondary text-xs mt-1.5">
          {row.total} signal{row.total !== 1 ? 's' : ''} — need {minSamples - row.total} more to calibrate
        </p>
      )}
    </div>
  );
}
