'use client';
import { TradeStats } from '@/types';
import { cn } from '@/lib/utils';
import { Trophy, TrendingUp, TrendingDown, Target, Flame } from 'lucide-react';

export default function PerformanceStats({ stats, loading }: { stats?: TradeStats | null; loading?: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse">
            <div className="h-3 bg-border rounded w-20 mb-2" />
            <div className="h-7 bg-border rounded w-16" />
          </div>
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const items = [
    {
      label: 'Total Trades',
      value: stats.total_trades,
      icon: Target,
      color: 'text-white'
    },
    {
      label: 'Win Rate',
      value: `${stats.win_rate}%`,
      icon: Trophy,
      color: stats.win_rate > 50 ? 'text-success' : 'text-danger',
      sub: `${stats.winning_trades}W / ${stats.losing_trades}L`
    },
    {
      label: 'Total P&L',
      value: (stats.total_profit >= 0 ? '+$' : '-$') + Math.abs(stats.total_profit).toFixed(2),
      icon: stats.total_profit >= 0 ? TrendingUp : TrendingDown,
      color: stats.total_profit >= 0 ? 'text-success' : 'text-danger'
    },
    {
      label: 'Profit Factor',
      value: stats.profit_factor || 'N/A',
      icon: Trophy,
      color: 'text-accent'
    },
    {
      label: 'Avg Profit',
      value: `+$${stats.average_profit}`,
      icon: TrendingUp,
      color: 'text-success'
    },
    {
      label: 'Avg Loss',
      value: `-$${stats.average_loss}`,
      icon: TrendingDown,
      color: 'text-danger'
    },
    {
      label: 'Best Trade',
      value: `+$${stats.best_trade}`,
      icon: Trophy,
      color: 'text-success'
    },
    {
      label: 'Streak',
      value: stats.current_streak > 0 ? `+${stats.current_streak} 🔥` : `${stats.current_streak}`,
      icon: Flame,
      color: stats.current_streak > 0 ? 'text-orange-400' : 'text-danger'
    }
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {items.map(({ label, value, icon: Icon, color, sub }) => (
        <div key={label} className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Icon className="w-4 h-4 text-text-secondary" />
            <span className="text-text-secondary text-xs">{label}</span>
          </div>
          <p className={cn('font-mono font-bold text-xl', color)}>{value}</p>
          {sub && <p className="text-text-secondary text-xs mt-0.5">{sub}</p>}
        </div>
      ))}
    </div>
  );
}
