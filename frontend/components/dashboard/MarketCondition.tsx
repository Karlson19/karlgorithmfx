'use client';
import { MarketCondition as MC } from '@/types';
import { TrendingUp, ArrowLeftRight, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

const CONFIG: Record<string, { icon: React.ElementType; label: string; desc: string; color: string }> = {
  TRENDING: {
    icon: TrendingUp,
    label: 'Trending',
    desc: 'Strong directional movement. EMA + MACD strategy active.',
    color: 'text-accent border-accent/30 bg-accent/10'
  },
  RANGING: {
    icon: ArrowLeftRight,
    label: 'Ranging',
    desc: 'Price bouncing between S/R levels. RSI + Bollinger strategy active.',
    color: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10'
  },
  VOLATILE: {
    icon: Zap,
    label: 'Volatile',
    desc: 'High volatility detected. Reduce lot size or wait for calm.',
    color: 'text-danger border-danger/30 bg-danger/10'
  }
};

export default function MarketCondition({ condition }: { condition?: MC }) {
  if (!condition) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 animate-pulse">
        <div className="h-4 bg-border rounded w-24" />
      </div>
    );
  }

  const cfg = CONFIG[condition] || CONFIG.VOLATILE;
  const Icon = cfg.icon;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-text-secondary text-sm mb-2">Market Condition</p>
      <div className={cn('inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-semibold mb-2', cfg.color)}>
        <Icon className="w-4 h-4" />
        {cfg.label}
      </div>
      <p className="text-text-secondary text-xs">{cfg.desc}</p>
    </div>
  );
}
