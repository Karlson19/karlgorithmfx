'use client';
import { useAllSignals } from '@/hooks/useSignals';
import { Signal } from '@/types';
import { cn, getSignalBg } from '@/lib/utils';
import { formatPairPrice, getPair } from '@/lib/pairs';
import { TrendingUp, TrendingDown, Minus, RefreshCw, Trophy, AlertTriangle } from 'lucide-react';

interface MultiPairOverviewProps {
  onSelectPair?: (symbol: string) => void;
}

// Multi-pair scoreboard. Shows every enabled pair side-by-side, ranked by
// the orchestrator's opportunity score so the best setup is always on top.
// Click a row to drill into the pair (sets the selected pair upstream).
export default function MultiPairOverview({ onSelectPair }: MultiPairOverviewProps) {
  const { data, loading, error, refresh } = useAllSignals();

  if (loading && !data) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 animate-pulse">
        <div className="h-6 bg-border rounded w-48 mb-4" />
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-16 bg-border rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-card border border-danger/30 rounded-xl p-6">
        <p className="text-danger text-sm">{error || 'No data'}</p>
        <button onClick={refresh} className="text-accent text-sm mt-2 underline">retry</button>
      </div>
    );
  }

  const ranked = data.ranked || [];
  const best = data.best_opportunity;

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-white font-bold">Multi-Pair Opportunities</h3>
          <p className="text-text-secondary text-xs">Ranked by composite score (confidence × calibrated win-rate × MTF alignment)</p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-background border border-border text-text-secondary hover:text-white hover:border-zinc-600 rounded-lg text-xs transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {best && (
        <div className="mb-4 px-4 py-3 bg-accent/10 border border-accent/30 rounded-lg flex items-center gap-3">
          <Trophy className="w-5 h-5 text-accent flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-accent text-xs font-semibold uppercase tracking-wide">Best opportunity right now</p>
            <p className="text-white text-sm font-mono">
              {best.display_name || best.symbol} · {best.direction} @ {best.confidence}% · score {best.opportunity_score?.toFixed(1)}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {ranked.map(sig => <PairRow key={sig.symbol} signal={sig} onClick={onSelectPair} />)}
      </div>

      {Object.keys(data.errors || {}).length > 0 && (
        <div className="mt-4 px-3 py-2 bg-danger/5 border border-danger/20 rounded-lg flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
          <div className="text-xs text-text-secondary">
            <span className="text-danger font-semibold">Errors:</span>{' '}
            {Object.entries(data.errors).map(([sym, msg]) => `${sym}: ${msg}`).join(' · ')}
          </div>
        </div>
      )}
    </div>
  );
}

function PairRow({ signal, onClick }: { signal: Signal; onClick?: (s: string) => void }) {
  const sym = signal.symbol || '';
  const pair = getPair(sym);
  const isNeutral = signal.direction === 'NEUTRAL';
  const cal = signal.calibration;

  return (
    <button
      type="button"
      onClick={() => onClick && sym && onClick(sym)}
      className={cn(
        'w-full flex items-center gap-2 sm:gap-4 px-3 sm:px-4 py-3 rounded-lg border transition-colors text-left',
        'bg-background border-border hover:border-zinc-600',
        !isNeutral && 'cursor-pointer'
      )}
    >
      {/* Symbol */}
      <div className="w-20 sm:w-32 flex-shrink-0 min-w-0">
        <p className="text-white font-mono text-xs sm:text-sm font-semibold truncate">{pair.display_name}</p>
        <p className="text-text-secondary text-xs truncate hidden sm:block">{signal.session?.replace(/_/g, ' ').toLowerCase() || '—'}</p>
      </div>

      {/* Direction badge */}
      <div className={cn('flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded border font-semibold text-xs w-16 sm:w-20 justify-center flex-shrink-0', getSignalBg(signal.direction))}>
        {signal.direction === 'BUY' ? <TrendingUp className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
          : signal.direction === 'SELL' ? <TrendingDown className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
          : <Minus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
        {signal.direction}
      </div>

      {/* Entry */}
      <div className="w-24 hidden md:block flex-shrink-0">
        <p className="text-text-secondary text-xs">Entry</p>
        <p className="text-white font-mono text-sm">{formatPairPrice(sym, signal.entry)}</p>
      </div>

      {/* Confidence */}
      <div className="flex-1 min-w-0">
        <p className="text-text-secondary text-xs">Confidence</p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cn('font-mono text-sm font-semibold',
            signal.confidence >= 80 ? 'text-success' :
            signal.confidence >= 70 ? 'text-accent' :
            signal.confidence >= 60 ? 'text-yellow-400' : 'text-text-secondary'
          )}>{signal.confidence}%</span>
          {cal && cal.calibrated && (
            <span className="text-text-secondary text-xs" title={`Historical win rate at this band (n=${cal.sample_size})`}>
              · {cal.win_rate}% hist
            </span>
          )}
        </div>
      </div>

      {/* Score */}
      <div className="w-20 hidden lg:block">
        <p className="text-text-secondary text-xs">Score</p>
        <p className="text-white font-mono text-sm">{signal.opportunity_score?.toFixed(1) ?? '—'}</p>
      </div>

      {/* Strategy */}
      <div className="flex-1 min-w-0 hidden xl:block">
        <p className="text-text-secondary text-xs">Strategy</p>
        <p className="text-white text-xs truncate">{signal.strategy}</p>
      </div>
    </button>
  );
}
