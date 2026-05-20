'use client';
import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Zap } from 'lucide-react';

// ─── Currency Strength Meter ─────────────────────────────────────────────────
// Compact widget that ranks each currency by recent strength across all
// supported pairs. Useful as a directional bias check — if USD is the
// strongest and JPY the weakest, USD/JPY longs are with the flow.
//
// Polls every 5 minutes (matches backend cache).

interface CurrencyScore {
  currency: string;
  raw_pct: number;
  normalized: number; // -100..+100
}

interface StrengthResponse {
  window: string;
  timestamp: string;
  ranked: CurrencyScore[];
  strongest: CurrencyScore | null;
  weakest: CurrencyScore | null;
}

const FLAGS: Record<string, string> = {
  USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', AUD: '🇦🇺', XAU: '🥇',
};

export default function CurrencyStrength() {
  const [data, setData] = useState<StrengthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const d = await api.getCurrencyStrength();
      setData(d);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5 * 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 animate-pulse">
        <div className="h-5 bg-border rounded w-40 mb-3" />
        <div className="space-y-2">
          {[1,2,3,4].map(i => <div key={i} className="h-6 bg-border rounded" />)}
        </div>
      </div>
    );
  }

  if (!data || !data.ranked || data.ranked.length === 0) {
    return null;
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Zap className="w-4 h-4 text-accent" />
        <h3 className="text-white font-bold text-sm">Currency Strength · 24h</h3>
      </div>
      <p className="text-text-secondary text-xs mb-4">
        Bias by relative strength. Longs on the strongest currency vs shorts on the weakest = with the flow.
      </p>

      {data.strongest && data.weakest && data.strongest.currency !== data.weakest.currency && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="flex items-center gap-2 px-3 py-2 bg-success/10 border border-success/30 rounded-lg">
            <TrendingUp className="w-4 h-4 text-success flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-text-secondary text-xs">Strongest</p>
              <p className="text-success font-mono font-bold text-sm">
                {FLAGS[data.strongest.currency] || ''} {data.strongest.currency}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 bg-danger/10 border border-danger/30 rounded-lg">
            <TrendingDown className="w-4 h-4 text-danger flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-text-secondary text-xs">Weakest</p>
              <p className="text-danger font-mono font-bold text-sm">
                {FLAGS[data.weakest.currency] || ''} {data.weakest.currency}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Bar chart per currency — bars extend from a center line to show
          positive/negative strength. */}
      <div className="space-y-1.5">
        {data.ranked.map(c => {
          const isPositive = c.normalized >= 0;
          const width = Math.abs(c.normalized) / 2; // 0-50% of half-width
          return (
            <div key={c.currency} className="flex items-center gap-2 text-xs">
              <span className="w-14 font-mono font-semibold text-white flex-shrink-0">
                {FLAGS[c.currency] || ''} {c.currency}
              </span>
              <div className="flex-1 h-3 bg-border rounded-full relative overflow-hidden">
                {/* Center line */}
                <div className="absolute top-0 bottom-0 left-1/2 w-px bg-text-secondary/30" />
                {/* Strength bar */}
                <div
                  className={cn('absolute top-0 bottom-0',
                    isPositive ? 'bg-success' : 'bg-danger'
                  )}
                  style={{
                    [isPositive ? 'left' : 'right']: '50%',
                    width: `${width}%`,
                  }}
                />
              </div>
              <span className={cn('w-14 text-right font-mono',
                isPositive ? 'text-success' : 'text-danger'
              )}>
                {isPositive ? '+' : ''}{c.raw_pct.toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
