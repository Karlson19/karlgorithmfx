'use client';
import { useEffect, useState, useCallback } from 'react';
import { MarketFocus } from '@/types';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { Clock, Activity, AlertCircle, Lightbulb, MoonStar, Zap } from 'lucide-react';

// Real-time "what's alive right now" widget.
// Shows the current session, time until the next one, which pairs are LIVE,
// which strategies typically fit this session, and any upcoming HIGH-impact
// news that's about to disrupt things.
//
// Polls every 60s — sessions change on the hour, news countdowns tick down,
// recommendations stay fresh without burning CPU.

const PHASE_META: Record<string, { icon: typeof Activity; color: string; bg: string; label: string }> = {
  PEAK_LIQUIDITY:    { icon: Zap,       color: 'text-success',  bg: 'bg-success/10 border-success/30',     label: 'Peak Liquidity' },
  TREND_FORMATION:   { icon: Activity,  color: 'text-accent',   bg: 'bg-accent/10 border-accent/30',       label: 'Trend Formation' },
  AFTERNOON_DRIFT:   { icon: Activity,  color: 'text-accent',   bg: 'bg-accent/10 border-accent/30',       label: 'Afternoon Drift' },
  RANGE_BUILD:       { icon: MoonStar,  color: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-400/30', label: 'Range Building' },
  AVOID:             { icon: AlertCircle, color: 'text-danger', bg: 'bg-danger/10 border-danger/30',       label: 'Avoid' },
};

const TIER_META: Record<string, { color: string; bg: string; label: string }> = {
  live:      { color: 'text-success',     bg: 'bg-success/10 border-success/30',     label: 'LIVE' },
  active:    { color: 'text-accent',      bg: 'bg-accent/10 border-accent/30',       label: 'ACTIVE' },
  quiet:     { color: 'text-yellow-400',  bg: 'bg-yellow-400/10 border-yellow-400/30', label: 'QUIET' },
  sidelined: { color: 'text-text-secondary', bg: 'bg-border/30 border-border',       label: 'SIDELINED' },
  neutral:   { color: 'text-text-secondary', bg: 'bg-border/30 border-border',       label: 'NEUTRAL' },
};

function fmtCountdown(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

export default function MarketFocusWidget() {
  const [focus, setFocus] = useState<MarketFocus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getMarketFocus();
      setFocus(data);
      setError(null);
    } catch {
      setError('Failed to fetch market focus');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  if (loading && !focus) {
    return <div className="bg-card border border-border rounded-xl p-5 animate-pulse h-32" />;
  }
  if (error || !focus) {
    return (
      <div className="bg-card border border-danger/30 rounded-xl p-5 text-danger text-sm">
        {error || 'No focus data'}
      </div>
    );
  }

  const phase = PHASE_META[focus.market_phase] || PHASE_META.RANGE_BUILD;
  const PhaseIcon = phase.icon;
  const allPairs = Object.keys(focus.pair_relevance);

  return (
    <div className={cn('rounded-xl border p-5', phase.bg)}>
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <PhaseIcon className={cn('w-6 h-6', phase.color)} />
          <div>
            <p className={cn('text-xs font-semibold uppercase tracking-widest', phase.color)}>
              Right Now · {phase.label}
            </p>
            <p className="text-white font-bold text-lg">
              {focus.current_session.label.replace(/_/g, ' ')}
              <span className="text-text-secondary text-sm font-normal ml-2">
                · {focus.utc_time} UTC
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <Clock className="w-3.5 h-3.5" />
          {fmtCountdown(focus.current_session.minutes_remaining)} until {focus.next_session.label.replace(/_/g, ' ')}
        </div>
      </div>

      {/* Pair relevance heatmap */}
      <div className="mb-4">
        <p className="text-text-secondary text-xs uppercase tracking-wider mb-2">Pair focus</p>
        <div className="flex flex-wrap gap-1.5">
          {allPairs.map(sym => {
            const rel = focus.pair_relevance[sym];
            const meta = TIER_META[rel.tier] || TIER_META.neutral;
            return (
              <span key={sym} className={cn('text-xs px-2.5 py-1 rounded border font-mono font-semibold', meta.bg, meta.color)}>
                {sym} · {meta.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* Suggested strategies for this phase */}
      {focus.suggested_strategies.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Lightbulb className="w-3.5 h-3.5 text-accent" />
            <p className="text-text-secondary text-xs uppercase tracking-wider">Strategies that fit this session</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {focus.suggested_strategies.map(s => (
              <span key={s} className="text-xs px-2.5 py-1 bg-background border border-border text-white rounded">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming news warnings */}
      {focus.upcoming_news.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <AlertCircle className="w-3.5 h-3.5 text-yellow-400" />
            <p className="text-text-secondary text-xs uppercase tracking-wider">Upcoming HIGH-impact news</p>
          </div>
          <div className="space-y-1.5">
            {focus.upcoming_news.slice(0, 3).map((n, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-yellow-400 font-mono font-semibold w-16">{fmtCountdown(n.minutes_away)}</span>
                <span className="text-text-secondary font-mono">[{n.currency}]</span>
                <span className="text-white truncate">{n.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
