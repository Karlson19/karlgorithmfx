'use client';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import ErrorBoundary from '@/components/layout/ErrorBoundary';
import { MonitorSnapshot, MonitorTrade } from '@/types';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatPairPrice, getPair } from '@/lib/pairs';
import { format } from 'date-fns';
import {
  Activity, TrendingUp, TrendingDown, ShieldCheck, RefreshCw, Loader2,
  AlertOctagon, AlertTriangle, Info, Target, Clock,
} from 'lucide-react';

// Poll the live monitor snapshot every 20s. This page is where the user
// goes to SEE that their open trades are being watched — including when
// everything is fine (the floating alert panel only shows when something
// is wrong).
function useMonitor() {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getTradeMonitor();
      setSnapshot(data);
      setError(null);
    } catch {
      setError('Failed to load monitor');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  return { snapshot, loading, error, refresh };
}

const SEV = {
  critical: { Icon: AlertOctagon, color: 'text-danger',     bg: 'bg-danger/10 border-danger/40' },
  warning:  { Icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-400/30' },
  info:     { Icon: Info,          color: 'text-accent',     bg: 'bg-accent/10 border-accent/30' },
} as const;

function TradeMonitorCard({ trade }: { trade: MonitorTrade }) {
  const pair = getPair(trade.symbol);
  const pnl = trade.unrealized_pnl;
  const pnlColor = pnl == null ? 'text-text-secondary' : pnl >= 0 ? 'text-success' : 'text-danger';
  const isBuy = trade.direction === 'BUY';

  // Border colour reflects worst alert severity (or healthy green tint)
  const borderClass =
    trade.worst_severity === 'critical' ? 'border-danger/50'
    : trade.worst_severity === 'warning' ? 'border-yellow-400/40'
    : 'border-border';

  return (
    <div className={cn('bg-card border rounded-xl p-5 space-y-4', borderClass)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-bold',
            isBuy ? 'bg-success/10 border-success/30 text-success' : 'bg-danger/10 border-danger/30 text-danger'
          )}>
            {isBuy ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            {trade.direction}
          </div>
          <div>
            <p className="text-white font-bold">{trade.display_name}</p>
            <p className="text-text-secondary text-xs flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {format(new Date(trade.opened_at), 'MMM d, HH:mm')} · {trade.lot_size} lots
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-text-secondary text-xs">Unrealized P&L</p>
          <p className={cn('font-mono font-bold text-2xl', pnlColor)}>
            {pnl == null ? '—' : `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`}
          </p>
          {trade.peak_pnl > 0 && (
            <p className="text-text-secondary text-xs">peak ${trade.peak_pnl.toFixed(2)}</p>
          )}
        </div>
      </div>

      {/* Levels */}
      <div className="grid grid-cols-4 gap-2 text-xs">
        <div className="bg-background border border-border rounded-lg p-2">
          <p className="text-text-secondary">Entry</p>
          <p className="text-white font-mono">{formatPairPrice(trade.symbol, trade.entry_price)}</p>
        </div>
        <div className="bg-background border border-border rounded-lg p-2">
          <p className="text-text-secondary">Now</p>
          <p className="text-white font-mono">{formatPairPrice(trade.symbol, trade.current_price)}</p>
        </div>
        <div className="bg-background border border-border rounded-lg p-2">
          <p className="text-text-secondary">SL {trade.sl_at_breakeven && <span className="text-success">✓BE</span>}</p>
          <p className="text-danger font-mono">{trade.stop_loss != null ? formatPairPrice(trade.symbol, trade.stop_loss) : '—'}</p>
        </div>
        <div className="bg-background border border-border rounded-lg p-2">
          <p className="text-text-secondary">TP1</p>
          <p className="text-success font-mono">{trade.take_profit_1 != null ? formatPairPrice(trade.symbol, trade.take_profit_1) : '—'}</p>
        </div>
      </div>

      {/* Progress to TP1 */}
      {trade.progress_to_tp1 != null && (
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-text-secondary">Progress to TP1</span>
            <span className={cn('font-mono',
              trade.progress_to_tp1 >= 60 ? 'text-success' : 'text-text-secondary'
            )}>{trade.progress_to_tp1}%</span>
          </div>
          <div className="h-2 bg-border rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full',
              trade.progress_to_tp1 < 0 ? 'bg-danger'
              : trade.progress_to_tp1 >= 60 ? 'bg-success'
              : 'bg-accent'
            )} style={{ width: `${Math.max(0, Math.min(100, trade.progress_to_tp1))}%` }} />
          </div>
        </div>
      )}

      {/* Alerts for this trade — or a healthy badge */}
      {trade.alerts.length > 0 ? (
        <div className="space-y-2">
          {trade.alerts.map(a => {
            const sev = SEV[a.severity];
            return (
              <div key={a.id} className={cn('border rounded-lg p-3 flex items-start gap-2', sev.bg)}>
                <sev.Icon className={cn('w-4 h-4 flex-shrink-0 mt-0.5', sev.color)} />
                <div className="min-w-0">
                  <p className={cn('text-xs font-bold', sev.color)}>{a.title}</p>
                  <p className="text-text-secondary text-xs mt-0.5">{a.message}</p>
                  {a.suggested_sl != null && (
                    <p className="text-xs mt-1">
                      <span className="text-text-secondary">Suggested SL → </span>
                      <span className="text-white font-mono font-semibold">{formatPairPrice(a.symbol, a.suggested_sl)}</span>
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 bg-success/5 border border-success/20 rounded-lg">
          <ShieldCheck className="w-4 h-4 text-success" />
          <p className="text-success text-xs font-medium">Healthy — no action needed. Watching for reversals, sessions &amp; news.</p>
        </div>
      )}
    </div>
  );
}

export default function MonitorPage() {
  const { snapshot, loading, error, refresh } = useMonitor();
  const trades = snapshot?.trades || [];

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-white text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-accent" />
            Trade Monitor
          </h1>
          <p className="text-text-secondary text-sm">
            Live watch on your open trades · {snapshot?.session?.replace(/_/g, ' ') || '—'} session
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-2 px-4 py-2 bg-card border border-border text-text-secondary hover:text-white hover:border-zinc-600 rounded-lg text-sm transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {loading && !snapshot ? (
        <div className="flex items-center justify-center py-20 text-text-secondary gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading monitor…
        </div>
      ) : error ? (
        <div className="bg-card border border-danger/30 rounded-xl p-6 text-danger text-sm">
          {error} — <button onClick={refresh} className="underline">retry</button>
        </div>
      ) : trades.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Target className="w-12 h-12 text-text-secondary mx-auto mb-4" />
          <p className="text-white font-bold text-lg">No open trades to monitor</p>
          <p className="text-text-secondary text-sm mt-2 max-w-md mx-auto">
            When you take a signal and log it as an open trade, it appears here with live P&amp;L and real-time risk alerts —
            so a winning gold trade never silently reverses on you again.
          </p>
          <a href="/signals" className="inline-block mt-4 px-4 py-2 bg-accent text-black font-bold rounded-lg text-sm hover:bg-accent/90 transition-colors">
            Go to Signals
          </a>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-text-secondary text-xs">
            {trades.length} open trade{trades.length !== 1 ? 's' : ''} · auto-refreshes every 20s · alerts also pop up on every page
          </p>
          {trades.map(t => (
            <ErrorBoundary key={t.id}>
              <TradeMonitorCard trade={t} />
            </ErrorBoundary>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
