'use client';
import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { usePrice } from '@/hooks/usePrice';
import { cn, formatPrice, formatPercent } from '@/lib/utils';

export default function PriceDisplay() {
  const { price, loading, error, flash, refetch } = usePrice();
  const [secondsAgo, setSecondsAgo] = useState(0);

  // Tick every second to show how old the price is
  useEffect(() => {
    if (!price?.timestamp) return;
    const update = () => {
      setSecondsAgo(Math.floor((Date.now() - new Date(price.timestamp).getTime()) / 1000));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [price?.timestamp]);

  const isStale = secondsAgo > 130; // older than 2min10s = something's wrong
  const ageLabel = secondsAgo < 60
    ? `${secondsAgo}s ago`
    : `${Math.floor(secondsAgo / 60)}m ${secondsAgo % 60}s ago`;

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 animate-pulse">
        <div className="h-10 bg-border rounded w-48 mb-3" />
        <div className="h-4 bg-border rounded w-32" />
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-start justify-between mb-1">
        <span className="text-text-secondary text-sm font-medium">EUR/USD</span>
        <button onClick={refetch} title="Force refresh" className="text-text-secondary hover:text-white transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error ? (
        <div className="text-danger text-sm">{error} — <button onClick={refetch} className="underline">retry</button></div>
      ) : (
        <>
          <div className={cn(
            'font-mono text-5xl font-bold transition-colors duration-300 mb-2',
            flash === 'up' ? 'text-success' : flash === 'down' ? 'text-danger' : 'text-white'
          )}>
            {formatPrice(price?.price)}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <span className={cn(
              'flex items-center gap-1 text-base font-mono font-semibold',
              (price?.change ?? 0) >= 0 ? 'text-success' : 'text-danger'
            )}>
              {(price?.change ?? 0) >= 0
                ? <TrendingUp className="w-4 h-4" />
                : <TrendingDown className="w-4 h-4" />
              }
              {(price?.change ?? 0) >= 0 ? '+' : ''}{price?.change?.toFixed(5)} ({formatPercent(price?.change_percent ?? 0)})
            </span>
          </div>

          <div className="flex items-center gap-4 mt-4 text-sm font-mono text-text-secondary flex-wrap">
            {/* Bid/ask/spread aren't available on the free Twelve Data tier.
                We show "n/a" rather than a fabricated value so SL/TP logic
                that consumes this UI never sees a fake spread. */}
            <div>Bid <span className="text-white">{price?.bid != null ? formatPrice(price.bid) : 'n/a'}</span></div>
            <div>Ask <span className="text-white">{price?.ask != null ? formatPrice(price.ask) : 'n/a'}</span></div>
            <div>Spread <span className="text-white">{price?.spread_pips != null ? price.spread_pips.toFixed(1) : 'n/a'}</span></div>
            <div>H <span className="text-success">{formatPrice(price?.high)}</span></div>
            <div>L <span className="text-danger">{formatPrice(price?.low)}</span></div>
          </div>

          {/* Freshness indicator */}
          <div className={cn(
            'flex items-center gap-2 mt-3 text-xs',
            isStale ? 'text-danger' : 'text-text-secondary'
          )}>
            <span className={cn('w-1.5 h-1.5 rounded-full', isStale ? 'bg-danger animate-pulse' : 'bg-success')} />
            {isStale
              ? `Price may be stale — updated ${ageLabel}`
              : `Updated ${ageLabel} · refreshes every 2 min`
            }
            {price?.source === 'alpha_vantage' && (
              <span className="ml-1 text-yellow-500">(backup source)</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
