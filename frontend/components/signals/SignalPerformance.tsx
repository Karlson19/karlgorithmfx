'use client';
import { useEffect, useMemo, useState } from 'react';
import { StoredSignal, SignalStats, SignalOutcome } from '@/types';
import { cn } from '@/lib/utils';
import { formatPairPrice, getPair, PAIRS, ENABLED_SYMBOLS } from '@/lib/pairs';
import api from '@/lib/api';
import { format, formatDistanceStrict } from 'date-fns';
import { TrendingUp, TrendingDown, Trophy, XCircle, Clock, BarChart2, ChevronDown, Hourglass } from 'lucide-react';

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
      <Trophy className="w-3 h-3" /> TP1
    </span>
  );
  if (outcome === 'WIN_TP2') return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border bg-success/10 border-success/30 text-success font-semibold">
      <Trophy className="w-3 h-3" /> TP2
    </span>
  );
  if (outcome === 'LOSS') return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border bg-danger/10 border-danger/30 text-danger font-semibold">
      <XCircle className="w-3 h-3" /> SL
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border bg-border/30 border-border text-text-secondary">
      <Hourglass className="w-3 h-3" /> EXPIRED
    </span>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-background border border-border rounded-lg p-4">
      <p className="text-text-secondary text-xs mb-1">{label}</p>
      <p className={cn('text-2xl font-bold font-mono', color || 'text-white')}>{value}</p>
      {sub && <p className="text-text-secondary text-xs mt-1">{sub}</p>}
    </div>
  );
}

// Inline pair selector — same UX as the page-level one but with an extra
// 'All Pairs' option so the user can drill in or back out without losing
// the current panel.
function PerformancePairSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const display = value === 'ALL' ? 'All Pairs' : (PAIRS[value]?.display_name || value);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-background border border-border rounded-lg text-white font-mono text-xs hover:border-zinc-600"
      >
        {display}
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-48 bg-card border border-border rounded-lg shadow-xl z-30 overflow-hidden">
          {['ALL', ...ENABLED_SYMBOLS].map(s => (
            <button
              key={s}
              onClick={() => { onChange(s); setOpen(false); }}
              className={cn('w-full text-left px-3 py-2 text-sm border-b border-border/50 last:border-0 transition-colors font-mono',
                s === value ? 'bg-accent/10 text-accent' : 'text-white hover:bg-background/50'
              )}
            >
              {s === 'ALL' ? 'All Pairs' : (PAIRS[s]?.display_name || s)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Compute "time to hit" — useful for sanity-checking that SL/TP outcomes
// happened on a reasonable timescale.
function timeToHit(sig: StoredSignal): string | null {
  if (!sig.outcome_at) return null;
  try {
    return formatDistanceStrict(new Date(sig.outcome_at), new Date(sig.created_at));
  } catch { return null; }
}

interface SignalStatsWithPerPair extends SignalStats {
  per_pair?: Record<string, SignalStats>;
}

export default function SignalPerformance() {
  const [stats, setStats]     = useState<SignalStatsWithPerPair | null>(null);
  const [history, setHistory] = useState<StoredSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [pair, setPair]       = useState<string>('ALL');

  // Re-fetch when pair selection changes. For 'ALL' we pull everything;
  // for a specific pair we ask the backend to filter.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [s, h] = await Promise.all([
          api.getSignalStats(pair === 'ALL' ? undefined : pair),
          api.getSignalHistory(60, pair === 'ALL' ? undefined : pair),
        ]);
        if (cancelled) return;
        setStats(s && typeof s === 'object' ? s : null);
        setHistory(Array.isArray(h) ? h : []);
      } catch (err) {
        if (!cancelled) console.error('SignalPerformance load error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [pair]);

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
  const winRateColor = stats && stats.win_rate >= 60 ? 'text-success'
    : stats && stats.win_rate >= 45 ? 'text-yellow-400' : 'text-danger';

  // Sort per-pair breakdown by total signals so the most-traded pair comes first.
  const perPairEntries = useMemo(() => {
    if (!stats?.per_pair) return [];
    return Object.entries(stats.per_pair)
      .filter(([, ps]) => ps.total > 0)
      .sort(([, a], [, b]) => b.total - a.total);
  }, [stats]);

  return (
    <div className="space-y-4">
      {/* Stats overview */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <BarChart2 className="w-5 h-5 text-accent" />
          <h3 className="text-white font-bold text-lg">Signal Performance</h3>
          {!noData && (
            <span className="text-text-secondary text-xs">· {stats!.total} closed signals</span>
          )}
          <div className="ml-auto">
            <PerformancePairSelector value={pair} onChange={setPair} />
          </div>
        </div>

        {noData ? (
          <div className="text-center py-8">
            <Clock className="w-10 h-10 text-text-secondary mx-auto mb-3" />
            <p className="text-white font-medium">No closed signals yet{pair !== 'ALL' && ` for ${PAIRS[pair]?.display_name || pair}`}</p>
            <p className="text-text-secondary text-sm mt-1">
              Outcomes are evaluated by walking M15 candles every 30 minutes. A signal must hit its SL or TP (or age out at 24h) before it shows here.
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
                label="Total Closed"
                value={stats!.total}
                sub={pair === 'ALL' ? 'Across all pairs' : (PAIRS[pair]?.display_name || pair)}
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

      {/* Per-pair breakdown when viewing 'ALL' — surfaces that "60% EUR/USD +
          30% gold averaged to 45%" trap that destroys insight. */}
      {pair === 'ALL' && perPairEntries.length > 1 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-white font-bold text-sm mb-4">Per-pair breakdown</h3>
          <div className="space-y-2">
            {perPairEntries.map(([sym, ps]) => {
              const meta = PAIRS[sym] || { display_name: sym };
              const wrColor = ps.win_rate >= 60 ? 'text-success'
                : ps.win_rate >= 45 ? 'text-yellow-400' : 'text-danger';
              return (
                <button
                  key={sym}
                  onClick={() => setPair(sym)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 bg-background border border-border rounded-lg hover:border-zinc-600 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-white font-mono font-semibold text-sm w-28 sm:w-36 truncate">{meta.display_name}</span>
                    <span className="text-text-secondary text-xs hidden sm:inline">{ps.total} closed</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-text-secondary text-xs hidden md:inline">{ps.wins}W / {ps.losses}L</span>
                    <div className="w-16 sm:w-24 h-1.5 bg-border rounded-full overflow-hidden hidden sm:block">
                      <div className={cn('h-full',
                        ps.win_rate >= 60 ? 'bg-success'
                        : ps.win_rate >= 45 ? 'bg-yellow-400' : 'bg-danger'
                      )} style={{ width: `${ps.win_rate}%` }} />
                    </div>
                    <span className={cn('font-mono font-bold text-sm w-12 text-right', wrColor)}>{ps.win_rate}%</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Signal history table — pair column always shown, pair-aware price
          formatting, time-to-hit alongside outcome. */}
      {history.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-5 border-b border-border">
            <h3 className="text-white font-bold">Signal History</h3>
            <p className="text-text-secondary text-xs mt-0.5">
              {pair === 'ALL' ? 'Last 60 closed/open signals across all pairs' : `Last 60 for ${PAIRS[pair]?.display_name || pair}`}
            </p>
          </div>

          {/* ── Mobile cards (< md) ───────────────────────────────────────── */}
          <div className="md:hidden divide-y divide-border">
            {history.map(sig => {
              const sym = sig.symbol;
              const tth = timeToHit(sig);
              return (
                <div key={sig.id} className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-white font-mono text-sm font-semibold">{getPair(sym).display_name}</span>
                      <span className={cn('inline-flex items-center gap-0.5 font-bold text-xs',
                        sig.direction === 'BUY' ? 'text-success' : 'text-danger'
                      )}>
                        {sig.direction === 'BUY' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {sig.direction}
                      </span>
                    </div>
                    <OutcomeBadge outcome={sig.outcome} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-text-secondary">
                    <span>{format(new Date(sig.created_at), 'MMM d, HH:mm')}</span>
                    {tth && <span>{tth} to hit</span>}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-text-secondary">Entry </span>
                      <span className="text-white font-mono">{formatPairPrice(sym, sig.entry)}</span>
                    </div>
                    <div>
                      <span className="text-text-secondary">SL </span>
                      <span className="text-danger font-mono">{sig.stop_loss != null ? formatPairPrice(sym, sig.stop_loss) : '—'}</span>
                    </div>
                    <div>
                      <span className="text-text-secondary">TP1 </span>
                      <span className="text-success font-mono">{sig.take_profit_1 != null ? formatPairPrice(sym, sig.take_profit_1) : '—'}</span>
                    </div>
                  </div>
                  <p className={cn('text-xs font-mono',
                    sig.confidence >= 80 ? 'text-success' : sig.confidence >= 70 ? 'text-accent' : 'text-yellow-400'
                  )}>Confidence {sig.confidence}%</p>
                </div>
              );
            })}
          </div>

          {/* ── Desktop table (md+) ───────────────────────────────────────── */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-text-secondary text-xs font-semibold text-left px-5 py-3 whitespace-nowrap">Time</th>
                  <th className="text-text-secondary text-xs font-semibold text-left py-3 pr-4 whitespace-nowrap">Pair</th>
                  <th className="text-text-secondary text-xs font-semibold text-left py-3 pr-4">Dir</th>
                  <th className="text-text-secondary text-xs font-semibold text-left py-3 pr-4">Entry</th>
                  <th className="text-text-secondary text-xs font-semibold text-left py-3 pr-4">SL</th>
                  <th className="text-text-secondary text-xs font-semibold text-left py-3 pr-4">TP1</th>
                  <th className="text-text-secondary text-xs font-semibold text-left py-3 pr-4">Conf.</th>
                  <th className="text-text-secondary text-xs font-semibold text-left py-3 pr-4">Outcome</th>
                  <th className="text-text-secondary text-xs font-semibold text-left py-3 pr-5">Time to hit</th>
                </tr>
              </thead>
              <tbody>
                {history.map(sig => {
                  const sym = sig.symbol;
                  const tth = timeToHit(sig);
                  return (
                    <tr key={sig.id} className="border-b border-border/50 last:border-0 hover:bg-background/50 transition-colors">
                      <td className="px-5 py-3 text-text-secondary whitespace-nowrap">
                        {format(new Date(sig.created_at), 'MMM d, HH:mm')}
                      </td>
                      <td className="py-3 pr-4 font-mono text-white text-xs whitespace-nowrap">{getPair(sym).display_name}</td>
                      <td className="py-3 pr-4">
                        <span className={cn(
                          'inline-flex items-center gap-1 font-bold text-xs',
                          sig.direction === 'BUY' ? 'text-success' : 'text-danger'
                        )}>
                          {sig.direction === 'BUY' ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                          {sig.direction}
                        </span>
                      </td>
                      <td className="py-3 pr-4 font-mono text-white">{formatPairPrice(sym, sig.entry)}</td>
                      <td className="py-3 pr-4 font-mono text-danger">{sig.stop_loss != null ? formatPairPrice(sym, sig.stop_loss) : '—'}</td>
                      <td className="py-3 pr-4 font-mono text-success">{sig.take_profit_1 != null ? formatPairPrice(sym, sig.take_profit_1) : '—'}</td>
                      <td className="py-3 pr-4">
                        <span className={cn(
                          'font-mono text-xs font-semibold',
                          sig.confidence >= 80 ? 'text-success' :
                          sig.confidence >= 70 ? 'text-accent' : 'text-yellow-400'
                        )}>
                          {sig.confidence}%
                        </span>
                      </td>
                      <td className="py-3 pr-4"><OutcomeBadge outcome={sig.outcome} /></td>
                      <td className="py-3 pr-5 text-text-secondary text-xs whitespace-nowrap">{tth || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
