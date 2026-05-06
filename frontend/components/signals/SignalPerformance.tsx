'use client';
import { useEffect, useState } from 'react';
import { StoredSignal, SignalStats, SignalOutcome } from '@/types';
import { cn, formatPrice } from '@/lib/utils';
import api from '@/lib/api';
import { format } from 'date-fns';
import { TrendingUp, TrendingDown, Trophy, XCircle, Clock, BarChart2 } from 'lucide-react';

// ─── Outcome badge ────────────────────────────────────────────────────────────

function OutcomeBadge({ outcome }: { outcome: SignalOutcome | null }) {
  if (!outcome) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border bg-border/30 border-border text-text-secondary">
        <Clock className="w-3 h-3" /> OPEN
      </span>
    );
  }
  if (outcome === 'WIN_TP1') return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border bg-success/10 border-success/30 text-success font-semibold">
      <Trophy className="w-3 h-3" /> TP1 HIT
    </span>
  );
  if (outcome === 'WIN_TP2') return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border bg-success/10 border-success/30 text-success font-semibold">
      <Trophy className="w-3 h-3" /> TP2 HIT
    </span>
  );
  if (outcome === 'LOSS') return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border bg-danger/10 border-danger/30 text-danger font-semibold">
      <XCircle className="w-3 h-3" /> SL HIT
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border bg-border/30 border-border text-text-secondary">
      EXPIRED
    </span>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-background border border-border rounded-lg p-4">
      <p className="text-text-secondary text-xs mb-1">{label}</p>
      <p className={cn('text-2xl font-bold font-mono', color || 'text-white')}>{value}</p>
      {sub && <p className="text-text-secondary text-xs mt-1">{sub}</p>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SignalPerformance() {
  const [stats, setStats]     = useState<SignalStats | null>(null);
  const [history, setHistory] = useState<StoredSignal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [s, h] = await Promise.all([api.getSignalStats(), api.getSignalHistory(30)]);
        setStats(s && typeof s === 'object' ? s : null);
        setHistory(Array.isArray(h) ? h : []);
      } catch (err) {
        console.error('SignalPerformance load error:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 animate-pulse">
        <div className="h-6 bg-border rounded w-48 mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-20 bg-border rounded-lg" />)}
        </div>
      </div>
    );
  }

  const noData = !stats || stats.total === 0;

  const winRateColor = stats && stats.win_rate >= 60
    ? 'text-success'
    : stats && stats.win_rate >= 45
    ? 'text-yellow-400'
    : 'text-danger';

  return (
    <div className="space-y-4">
      {/* Stats overview */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center gap-2 mb-5">
          <BarChart2 className="w-5 h-5 text-accent" />
          <h3 className="text-white font-bold text-lg">Signal Performance</h3>
          {!noData && (
            <span className="ml-auto text-text-secondary text-xs">{stats!.total} evaluated signals</span>
          )}
        </div>

        {noData ? (
          <div className="text-center py-8">
            <Clock className="w-10 h-10 text-text-secondary mx-auto mb-3" />
            <p className="text-white font-medium">No evaluated signals yet</p>
            <p className="text-text-secondary text-sm mt-1">
              Signals are evaluated every 30 minutes. Check back after the first BUY/SELL signal is generated.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <StatCard
                label="Win Rate"
                value={`${stats!.win_rate}%`}
                sub={`${stats!.wins}W / ${stats!.losses}L`}
                color={winRateColor}
              />
              <StatCard
                label="Total Signals"
                value={stats!.total}
                sub="Evaluated"
              />
              <StatCard
                label="BUY Win Rate"
                value={`${stats!.buy_win_rate}%`}
                sub="Long signals"
                color={stats!.buy_win_rate >= 50 ? 'text-success' : 'text-danger'}
              />
              <StatCard
                label="SELL Win Rate"
                value={`${stats!.sell_win_rate}%`}
                sub="Short signals"
                color={stats!.sell_win_rate >= 50 ? 'text-success' : 'text-danger'}
              />
            </div>

            {/* Confidence comparison */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-background border border-border rounded-lg p-3">
                <p className="text-success text-xs font-semibold mb-1">AVG CONFIDENCE — WINS</p>
                <p className="text-white font-mono text-lg font-bold">{stats!.win_confidence}%</p>
                <div className="h-1.5 bg-border rounded-full mt-2">
                  <div className="h-full bg-success rounded-full" style={{ width: `${stats!.win_confidence}%` }} />
                </div>
              </div>
              <div className="bg-background border border-border rounded-lg p-3">
                <p className="text-danger text-xs font-semibold mb-1">AVG CONFIDENCE — LOSSES</p>
                <p className="text-white font-mono text-lg font-bold">{stats!.loss_confidence}%</p>
                <div className="h-1.5 bg-border rounded-full mt-2">
                  <div className="h-full bg-danger rounded-full" style={{ width: `${stats!.loss_confidence}%` }} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Signal history table */}
      {history.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="text-white font-bold mb-4">Signal History</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-text-secondary text-xs font-semibold text-left pb-3 pr-4">Time</th>
                  <th className="text-text-secondary text-xs font-semibold text-left pb-3 pr-4">Direction</th>
                  <th className="text-text-secondary text-xs font-semibold text-left pb-3 pr-4">Entry</th>
                  <th className="text-text-secondary text-xs font-semibold text-left pb-3 pr-4">SL</th>
                  <th className="text-text-secondary text-xs font-semibold text-left pb-3 pr-4">TP1</th>
                  <th className="text-text-secondary text-xs font-semibold text-left pb-3 pr-4">Conf.</th>
                  <th className="text-text-secondary text-xs font-semibold text-left pb-3">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {history.map(sig => (
                  <tr key={sig.id} className="border-b border-border/50 last:border-0 hover:bg-background/50 transition-colors">
                    <td className="py-3 pr-4 text-text-secondary whitespace-nowrap">
                      {format(new Date(sig.created_at), 'MMM d, HH:mm')}
                    </td>
                    <td className="py-3 pr-4">
                      <span className={cn(
                        'inline-flex items-center gap-1 font-bold text-xs',
                        sig.direction === 'BUY' ? 'text-success' : 'text-danger'
                      )}>
                        {sig.direction === 'BUY'
                          ? <TrendingUp className="w-3.5 h-3.5" />
                          : <TrendingDown className="w-3.5 h-3.5" />}
                        {sig.direction}
                      </span>
                    </td>
                    <td className="py-3 pr-4 font-mono text-white">{formatPrice(sig.entry)}</td>
                    <td className="py-3 pr-4 font-mono text-danger">{sig.stop_loss ? formatPrice(sig.stop_loss) : '—'}</td>
                    <td className="py-3 pr-4 font-mono text-success">{sig.take_profit_1 ? formatPrice(sig.take_profit_1) : '—'}</td>
                    <td className="py-3 pr-4">
                      <span className={cn(
                        'font-mono text-xs font-semibold',
                        sig.confidence >= 80 ? 'text-success' :
                        sig.confidence >= 70 ? 'text-accent' : 'text-yellow-400'
                      )}>
                        {sig.confidence}%
                      </span>
                    </td>
                    <td className="py-3">
                      <OutcomeBadge outcome={sig.outcome} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
