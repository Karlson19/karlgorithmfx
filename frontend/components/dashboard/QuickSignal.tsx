'use client';
import Link from 'next/link';
import { Signal } from '@/types';
import { cn, formatPrice, getSignalBg } from '@/lib/utils';
import { ArrowRight, TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function QuickSignal({ signal, loading }: { signal?: Signal | null; loading?: boolean }) {
  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 animate-pulse">
        <div className="h-8 bg-border rounded w-24 mb-4" />
        <div className="space-y-2">
          <div className="h-3 bg-border rounded" />
          <div className="h-3 bg-border rounded w-3/4" />
        </div>
      </div>
    );
  }

  if (!signal) return null;

  const isNeutral = signal.direction === 'NEUTRAL';
  const isBuy = signal.direction === 'BUY';

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-medium">Signal</h3>
        <span className={cn('flex items-center gap-1.5 px-4 py-1.5 rounded-lg border font-bold text-lg', getSignalBg(signal.direction))}>
          {isBuy ? <TrendingUp className="w-5 h-5" /> : isNeutral ? <Minus className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
          {signal.direction}
        </span>
      </div>

      {!isNeutral && (
        <div className="grid grid-cols-2 gap-3 mb-4 text-sm font-mono">
          <div>
            <span className="text-text-secondary text-xs">Entry</span>
            <p className="text-white font-semibold">{formatPrice(signal.entry)}</p>
          </div>
          <div>
            <span className="text-text-secondary text-xs">Stop Loss</span>
            <p className="text-danger font-semibold">{formatPrice(signal.stop_loss)}</p>
          </div>
          <div>
            <span className="text-text-secondary text-xs">TP1</span>
            <p className="text-success font-semibold">{formatPrice(signal.take_profit_1)}</p>
          </div>
          <div>
            <span className="text-text-secondary text-xs">TP2</span>
            <p className="text-success font-semibold">{formatPrice(signal.take_profit_2)}</p>
          </div>
        </div>
      )}

      {/* Confidence bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-text-secondary">Confidence</span>
          <span className={cn('font-semibold font-mono',
            signal.confidence >= 80 ? 'text-success' :
            signal.confidence >= 70 ? 'text-accent' :
            signal.confidence >= 60 ? 'text-yellow-400' : 'text-text-secondary'
          )}>{signal.confidence}%</span>
        </div>
        <div className="h-2 bg-border rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all',
              signal.confidence >= 80 ? 'bg-success' :
              signal.confidence >= 70 ? 'bg-accent' :
              signal.confidence >= 60 ? 'bg-yellow-400' : 'bg-zinc-600'
            )}
            style={{ width: `${signal.confidence}%` }}
          />
        </div>
      </div>

      <p className="text-text-secondary text-xs mb-1 truncate">{signal.strategy}</p>
      {signal.risk_reward && (
        <p className="text-text-secondary text-xs mb-4">R/R: <span className="text-white">{signal.risk_reward}</span></p>
      )}

      <Link
        href="/signals"
        className="flex items-center gap-2 text-accent text-sm font-medium hover:underline"
      >
        View Full Analysis <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}
