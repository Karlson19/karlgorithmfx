'use client';
import { Trade } from '@/types';
import { cn, formatCurrency } from '@/lib/utils';
import { formatPairPrice, getPair } from '@/lib/pairs';
import { format } from 'date-fns';
import { Edit, Trash2, X, Sparkles, AlertOctagon, AlertTriangle } from 'lucide-react';
import { useState, useMemo } from 'react';
import api from '@/lib/api';
import { useTradeAlerts } from '@/hooks/useTradeAlerts';

interface TradeTableProps {
  trades: Trade[];
  onRefresh: () => void;
  onEdit: (trade: Trade) => void;
}

export default function TradeTable({ trades, onRefresh, onEdit }: TradeTableProps) {
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closePrice, setClosePrice] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  // Pull live trade alerts so we can flag rows with active risk warnings.
  // The hook handles polling — we just consume the current alert list.
  const { alerts } = useTradeAlerts();
  const alertsByTrade = useMemo(() => {
    const map: Record<string, { critical: number; warning: number; info: number }> = {};
    for (const a of alerts) {
      if (!map[a.trade_id]) map[a.trade_id] = { critical: 0, warning: 0, info: 0 };
      map[a.trade_id][a.severity] += 1;
    }
    return map;
  }, [alerts]);

  function TradeAlertBadge({ tradeId }: { tradeId: string }) {
    const counts = alertsByTrade[tradeId];
    if (!counts) return null;
    if (counts.critical > 0) {
      return (
        <span title={`${counts.critical} critical alert${counts.critical !== 1 ? 's' : ''}`}
              className="inline-flex items-center gap-0.5 text-danger animate-pulse">
          <AlertOctagon className="w-3.5 h-3.5" />
        </span>
      );
    }
    if (counts.warning > 0) {
      return (
        <span title={`${counts.warning} warning${counts.warning !== 1 ? 's' : ''}`} className="inline-flex items-center text-yellow-400">
          <AlertTriangle className="w-3.5 h-3.5" />
        </span>
      );
    }
    if (counts.info > 0) {
      return (
        <span title={`${counts.info} info`} className="inline-flex items-center text-accent">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
        </span>
      );
    }
    return null;
  }

  async function handleClose(id: string) {
    if (!closePrice) return;
    try {
      await api.updateTrade(id, { status: 'closed', close_price: parseFloat(closePrice) });
      setClosingId(null);
      setClosePrice('');
      onRefresh();
    } catch {}
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this trade?')) return;
    setDeleting(id);
    try {
      await api.deleteTrade(id);
      onRefresh();
    } catch {} finally {
      setDeleting(null);
    }
  }

  if (trades.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 text-center">
        <p className="text-text-secondary">No trades yet. Log your first trade to get started!</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* ── Mobile card view (< md) ─────────────────────────────────────────── */}
      <div className="md:hidden divide-y divide-border">
        {trades.map(trade => {
          const sym = trade.pair;
          const pair = getPair(sym);
          return (
            <div key={trade.id} className="p-4">
              <div className="flex items-center justify-between mb-2 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <TradeAlertBadge tradeId={trade.id} />
                  <span className="text-white font-mono text-sm font-semibold">{pair.display_name}</span>
                  {trade.signal_id && <Sparkles className="w-3 h-3 text-accent flex-shrink-0" />}
                  <span className={cn('px-2 py-0.5 rounded text-xs font-bold border flex-shrink-0',
                    trade.direction === 'BUY'
                      ? 'text-success bg-success/10 border-success/30'
                      : 'text-danger bg-danger/10 border-danger/30'
                  )}>{trade.direction}</span>
                </div>
                <span className="text-text-secondary text-xs whitespace-nowrap">
                  {format(new Date(trade.opened_at), 'MMM d, HH:mm')}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs mb-2">
                <div>
                  <span className="text-text-secondary">Lots </span>
                  <span className="text-white font-mono">{trade.lot_size}</span>
                </div>
                <div className="text-right">
                  <span className="text-text-secondary">Entry </span>
                  <span className="text-white font-mono">{formatPairPrice(sym, trade.entry_price)}</span>
                </div>
                <div>
                  <span className="text-text-secondary">SL </span>
                  <span className="text-danger font-mono">{trade.stop_loss != null ? formatPairPrice(sym, trade.stop_loss) : '—'}</span>
                </div>
                <div className="text-right">
                  <span className="text-text-secondary">TP </span>
                  <span className="text-success font-mono">{trade.take_profit != null ? formatPairPrice(sym, trade.take_profit) : '—'}</span>
                </div>
                {trade.status === 'closed' && (
                  <>
                    <div>
                      <span className="text-text-secondary">Close </span>
                      <span className="text-white font-mono">{trade.close_price != null ? formatPairPrice(sym, trade.close_price) : '—'}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-text-secondary">P&L </span>
                      <span className={cn('font-mono font-bold',
                        trade.profit_loss != null && trade.profit_loss >= 0 ? 'text-success' : 'text-danger'
                      )}>
                        {trade.profit_loss != null ? formatCurrency(trade.profit_loss) : '—'}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs min-w-0">
                  <span className={cn('px-2 py-0.5 rounded text-xs font-medium border flex-shrink-0',
                    trade.status === 'open'
                      ? 'text-accent border-accent/30 bg-accent/10'
                      : 'text-text-secondary border-border'
                  )}>{trade.status}</span>
                  {trade.strategy && <span className="text-text-secondary truncate">{trade.strategy}</span>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {trade.status === 'open' && (
                    closingId === trade.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number" step={pair.pip_size / 10}
                          placeholder="Close"
                          value={closePrice}
                          onChange={e => setClosePrice(e.target.value)}
                          className="w-20 bg-background border border-border rounded px-1.5 py-0.5 text-white font-mono text-xs focus:border-accent outline-none"
                        />
                        <button onClick={() => handleClose(trade.id)} className="text-success text-xs font-bold px-1">OK</button>
                        <button onClick={() => setClosingId(null)} className="text-text-secondary"><X className="w-3 h-3" /></button>
                      </div>
                    ) : (
                      <button onClick={() => setClosingId(trade.id)} className="text-xs text-accent">Close</button>
                    )
                  )}
                  <button onClick={() => onEdit(trade)} className="text-text-secondary"><Edit className="w-4 h-4" /></button>
                  <button onClick={() => handleDelete(trade.id)} disabled={deleting === trade.id} className="text-text-secondary hover:text-danger">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Desktop table (≥ md) ─────────────────────────────────────────────── */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {['Date', 'Pair', 'Dir', 'Lots', 'Entry', 'SL/TP', 'Close', 'P&L', 'Strategy', 'Status', ''].map(h => (
                <th key={h} className="text-left text-text-secondary text-xs font-medium px-4 py-3 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.map(trade => {
              const sym = trade.pair;
              const pair = getPair(sym);
              return (
              <tr key={trade.id} className="border-b border-border hover:bg-white/2 transition-colors">
                <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                  {format(new Date(trade.opened_at), 'MMM d, HH:mm')}
                </td>
                <td className="px-4 py-3 font-mono text-white text-xs whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <TradeAlertBadge tradeId={trade.id} />
                    <span>{pair.display_name}</span>
                    {trade.signal_id && (
                      <span title="Logged from a live signal" className="inline-flex">
                        <Sparkles className="w-3 h-3 text-accent" />
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={cn('px-2 py-0.5 rounded text-xs font-bold border',
                    trade.direction === 'BUY'
                      ? 'text-success bg-success/10 border-success/30'
                      : 'text-danger bg-danger/10 border-danger/30'
                  )}>
                    {trade.direction}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-white">{trade.lot_size}</td>
                <td className="px-4 py-3 font-mono text-white">{formatPairPrice(sym, trade.entry_price)}</td>
                <td className="px-4 py-3 font-mono text-xs">
                  <span className="text-danger">{trade.stop_loss != null ? formatPairPrice(sym, trade.stop_loss) : '—'}</span>
                  <span className="text-text-secondary mx-1">/</span>
                  <span className="text-success">{trade.take_profit != null ? formatPairPrice(sym, trade.take_profit) : '—'}</span>
                </td>
                <td className="px-4 py-3 font-mono text-white">{trade.close_price != null ? formatPairPrice(sym, trade.close_price) : '—'}</td>
                <td className="px-4 py-3 font-mono font-bold">
                  {trade.profit_loss != null ? (
                    <span className={trade.profit_loss >= 0 ? 'text-success' : 'text-danger'}>
                      {formatCurrency(trade.profit_loss)}
                    </span>
                  ) : '—'}
                </td>
                <td className="px-4 py-3 text-text-secondary text-xs">{trade.strategy || '—'}</td>
                <td className="px-4 py-3">
                  <span className={cn('px-2 py-0.5 rounded text-xs font-medium border',
                    trade.status === 'open'
                      ? 'text-accent border-accent/30 bg-accent/10'
                      : 'text-text-secondary border-border'
                  )}>
                    {trade.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {trade.status === 'open' && (
                      closingId === trade.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number" step="0.00001"
                            placeholder="Close price"
                            value={closePrice}
                            onChange={e => setClosePrice(e.target.value)}
                            className="w-28 bg-background border border-border rounded px-2 py-1 text-white font-mono text-xs focus:border-accent outline-none"
                          />
                          <button onClick={() => handleClose(trade.id)} className="text-success hover:text-success/80 text-xs font-bold">OK</button>
                          <button onClick={() => setClosingId(null)} className="text-text-secondary hover:text-white"><X className="w-3 h-3" /></button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setClosingId(trade.id)}
                          className="text-xs text-accent hover:underline whitespace-nowrap"
                        >
                          Close
                        </button>
                      )
                    )}
                    <button onClick={() => onEdit(trade)} className="text-text-secondary hover:text-white">
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(trade.id)}
                      disabled={deleting === trade.id}
                      className="text-text-secondary hover:text-danger"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
