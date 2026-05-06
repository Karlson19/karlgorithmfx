'use client';
import { Signal } from '@/types';
import { cn, formatPrice, getSignalBg } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus, Clock } from 'lucide-react';
import { format } from 'date-fns';

export default function SignalCard({ signal }: { signal: Signal }) {
  const isNeutral = signal.direction === 'NEUTRAL';
  const isBuy = signal.direction === 'BUY';

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-white text-lg font-bold mb-1">Current Signal</h2>
          <div className="flex items-center gap-2 text-text-secondary text-sm">
            <Clock className="w-4 h-4" />
            {format(new Date(signal.timestamp), 'MMM d, HH:mm')} UTC
          </div>
        </div>
        <div className={cn('flex items-center gap-2 px-5 py-2 rounded-xl border font-bold text-2xl', getSignalBg(signal.direction))}>
          {isBuy ? <TrendingUp className="w-6 h-6" /> : isNeutral ? <Minus className="w-6 h-6" /> : <TrendingDown className="w-6 h-6" />}
          {signal.direction}
        </div>
      </div>

      {!isNeutral && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Entry Price', value: formatPrice(signal.entry), color: 'text-white' },
            { label: 'Stop Loss', value: formatPrice(signal.stop_loss), color: 'text-danger' },
            { label: 'Take Profit 1', value: formatPrice(signal.take_profit_1), color: 'text-success' },
            { label: 'Take Profit 2', value: formatPrice(signal.take_profit_2), color: 'text-success' }
          ].map(item => (
            <div key={item.label} className="bg-background border border-border rounded-lg p-3">
              <p className="text-text-secondary text-xs mb-1">{item.label}</p>
              <p className={cn('font-mono text-base font-bold', item.color)}>{item.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-4 mb-4">
        <div>
          <p className="text-text-secondary text-xs mb-1">Strategy</p>
          <p className="text-white text-sm">{signal.strategy}</p>
        </div>
        <div>
          <p className="text-text-secondary text-xs mb-1">Timeframe</p>
          <p className="text-white text-sm font-mono">{signal.timeframe}</p>
        </div>
        {signal.risk_reward && (
          <div>
            <p className="text-text-secondary text-xs mb-1">Risk/Reward</p>
            <p className="text-white text-sm font-mono">{signal.risk_reward}</p>
          </div>
        )}
      </div>

      {/* Confidence */}
      <div>
        <div className="flex justify-between text-sm mb-2">
          <span className="text-text-secondary">Signal Confidence</span>
          <span className={cn('font-semibold font-mono',
            signal.confidence >= 80 ? 'text-success' :
            signal.confidence >= 70 ? 'text-accent' : 'text-yellow-400'
          )}>
            {signal.confidence}% — {
              signal.confidence >= 80 ? 'STRONG' :
              signal.confidence >= 70 ? 'MODERATE' : 'WEAK'
            }
          </span>
        </div>
        <div className="h-3 bg-border rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full',
              signal.confidence >= 80 ? 'bg-success' :
              signal.confidence >= 70 ? 'bg-accent' : 'bg-yellow-400'
            )}
            style={{ width: `${signal.confidence}%` }}
          />
        </div>
        <p className="text-text-secondary text-xs mt-1">
          {signal.indicators_agreeing} of {signal.total_indicators} indicators agree
          {signal.atr_pips && <span className="ml-2">· ATR: <span className="text-white">{signal.atr_pips} pips</span></span>}
        </p>

      {/* MTF badge */}
      {signal.mtf && (
        <div className={cn('mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-lg border',
          signal.mtf.aligned
            ? 'bg-success/10 border-success/30 text-success'
            : 'bg-border/30 border-border text-text-secondary'
        )}>
          <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', signal.mtf.aligned ? 'bg-success' : 'bg-zinc-600')} />
          {signal.mtf.description}
        </div>
      )}

      {/* Agreeing indicators list */}
      {signal.agreeing_indicators && signal.agreeing_indicators.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {signal.agreeing_indicators.slice(0, 8).map(name => (
            <span key={name} className="text-xs px-2 py-0.5 bg-accent/10 border border-accent/20 text-accent rounded-full">{name}</span>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
