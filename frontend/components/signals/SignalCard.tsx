'use client';
import { useState } from 'react';
import { Signal } from '@/types';
import { cn, getSignalBg } from '@/lib/utils';
import { formatPairPrice } from '@/lib/pairs';
import { TrendingUp, TrendingDown, Minus, Clock, ShieldAlert, Target, Check, X, Eye, BookOpen } from 'lucide-react';
import { format } from 'date-fns';
import TradeForm from '@/components/journal/TradeForm';

export default function SignalCard({ signal }: { signal: Signal }) {
  const [showForm, setShowForm] = useState(false);
  const isNeutral = signal.direction === 'NEUTRAL';
  const isBuy = signal.direction === 'BUY';
  const sym = signal.symbol;
  const cal = signal.calibration;

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-white text-lg font-bold mb-1">
            Current Signal{signal.display_name ? ` · ${signal.display_name}` : ''}
          </h2>
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

      {/* News blackout banner — overrides everything else */}
      {signal.news_blackout && (
        <div className="mb-4 px-3 py-2.5 bg-yellow-400/10 border border-yellow-400/30 rounded-lg flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="text-yellow-400 font-semibold">News blackout active</p>
            <p className="text-text-secondary mt-0.5">
              {signal.news_blackout.title} ({signal.news_blackout.currency}) in {signal.news_blackout.minutes} min — signals suppressed during the window.
            </p>
          </div>
        </div>
      )}

      {/* "Log this trade" CTA — opens the trade form pre-filled from this
          signal (pair, direction, entry, SL, TP, strategy name, signal_id link). */}
      {!isNeutral && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full mb-5 flex items-center justify-center gap-2 px-4 py-2.5 bg-success/10 border border-success/30 text-success hover:bg-success/20 rounded-lg font-bold text-sm transition-colors"
        >
          <BookOpen className="w-4 h-4" />
          Log this trade in journal
        </button>
      )}

      {showForm && (
        <TradeForm
          fromSignal={signal}
          onClose={() => setShowForm(false)}
          onSave={() => setShowForm(false)}
        />
      )}

      {!isNeutral && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Entry Price', value: formatPairPrice(sym, signal.entry), color: 'text-white' },
            { label: 'Stop Loss', value: formatPairPrice(sym, signal.stop_loss), color: 'text-danger' },
            { label: 'Take Profit 1', value: formatPairPrice(sym, signal.take_profit_1), color: 'text-success' },
            { label: 'Take Profit 2', value: formatPairPrice(sym, signal.take_profit_2), color: 'text-success' }
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
        {signal.session && (
          <div>
            <p className="text-text-secondary text-xs mb-1">Session</p>
            <p className="text-white text-sm font-mono">{signal.session.replace(/_/g, ' ')}</p>
          </div>
        )}
      </div>

      {/* Calibration callout — shows how trustworthy this confidence number is
          based on our own historical win rate at this band for this pair. */}
      {cal && (
        <div className={cn(
          'mb-4 px-3 py-2 rounded-lg border flex items-start gap-2 text-xs',
          cal.calibrated
            ? 'bg-accent/5 border-accent/20 text-text-secondary'
            : 'bg-border/30 border-border text-text-secondary'
        )}>
          <Target className={cn('w-4 h-4 flex-shrink-0 mt-0.5', cal.calibrated ? 'text-accent' : 'text-text-secondary')} />
          <div>
            {cal.calibrated ? (
              <>
                <span className="text-white font-semibold">{cal.win_rate}% historical win rate</span>
                {cal.avg_r != null && <> · <span className="text-white font-semibold">{cal.avg_r > 0 ? '+' : ''}{cal.avg_r}R avg after spread</span></>}
                {' '}in this confidence band on this pair ({cal.sample_size} closed signals)
              </>
            ) : (
              <>
                Confidence band not yet calibrated ({cal.sample_size} closed signals so far). Need ≥30 for a trustable rate.
              </>
            )}
          </div>
        </div>
      )}

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

      {/* ── Fired strategy detail (the named setup that produced this signal) */}
      {signal.fired_strategy && (
        <div className="mt-5 pt-5 border-t border-border">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-text-secondary text-xs uppercase tracking-wider">Fired Strategy</p>
              <p className="text-white font-bold text-base mt-0.5">{signal.fired_strategy.name}</p>
              <p className="text-text-secondary text-xs mt-0.5">{signal.fired_strategy.description}</p>
            </div>
            <div className="text-right">
              <p className="text-text-secondary text-xs">Strategy conf.</p>
              <p className="text-accent font-mono font-bold">{signal.fired_strategy.confidence}%</p>
            </div>
          </div>
          {/* Conditions checklist */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 mt-3">
            {signal.fired_strategy.conditions.map((c, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs">
                {c.met
                  ? <Check className="w-3.5 h-3.5 text-success flex-shrink-0 mt-0.5" />
                  : <X className="w-3.5 h-3.5 text-text-secondary flex-shrink-0 mt-0.5" />}
                <span className={cn(c.met ? 'text-white' : 'text-text-secondary line-through')}>
                  {c.name}
                  {c.required && !c.met && <span className="text-danger ml-1">(required)</span>}
                </span>
              </div>
            ))}
          </div>

          {/* Confluence — other strategies also fired */}
          {signal.additional_strategies && signal.additional_strategies.length > 0 && (
            <div className="mt-4">
              <p className="text-text-secondary text-xs uppercase tracking-wider mb-1.5">Additional confluence</p>
              <div className="flex flex-wrap gap-1.5">
                {signal.additional_strategies.map(s => (
                  <span key={s.name} className="text-xs px-2 py-0.5 bg-success/10 border border-success/20 text-success rounded">
                    {s.name} ({s.confidence}%)
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Watchlist — partial setups (50%+ ready but not fired) */}
      {signal.watchlist && signal.watchlist.length > 0 && (
        <div className="mt-5 pt-5 border-t border-border">
          <div className="flex items-center gap-1.5 mb-2">
            <Eye className="w-4 h-4 text-text-secondary" />
            <p className="text-text-secondary text-xs uppercase tracking-wider">Watchlist — setups forming</p>
          </div>
          <div className="space-y-2">
            {signal.watchlist.map((w, i) => {
              const pct = Math.round(w.completion_pct * 100);
              return (
                <div key={i} className="bg-background border border-border rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-white text-xs font-semibold">
                      {w.name}
                      {w.direction && <span className={cn('ml-2 font-mono', w.direction === 'BUY' ? 'text-success' : 'text-danger')}>· {w.direction}</span>}
                    </p>
                    <span className="text-text-secondary text-xs font-mono">{pct}% ready</span>
                  </div>
                  <div className="h-1 bg-border rounded-full overflow-hidden">
                    <div className="h-full bg-accent/60" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-text-secondary text-xs mt-1.5">
                    Missing: {w.conditions.filter(c => !c.met).slice(0, 2).map(c => c.name).join(' · ') || 'almost there'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
