'use client';
import { Trade } from '@/types';
import { cn, formatPrice, formatCurrency } from '@/lib/utils';
import { format } from 'date-fns';
import { Edit, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import api from '@/lib/api';

interface TradeTableProps {
  trades: Trade[];
  onRefresh: () => void;
  onEdit: (trade: Trade) => void;
}

export default function TradeTable({ trades, onRefresh, onEdit }: TradeTableProps) {
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closePrice, setClosePrice] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

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
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {['Date', 'Dir', 'Lots', 'Entry', 'SL/TP', 'Close', 'P&L', 'Strategy', 'Status', ''].map(h => (
                <th key={h} className="text-left text-text-secondary text-xs font-medium px-4 py-3 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.map(trade => (
              <tr key={trade.id} className="border-b border-border hover:bg-white/2 transition-colors">
                <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                  {format(new Date(trade.opened_at), 'MMM d, HH:mm')}
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
                <td className="px-4 py-3 font-mono text-white">{formatPrice(trade.entry_price)}</td>
                <td className="px-4 py-3 font-mono text-xs">
                  <span className="text-danger">{formatPrice(trade.stop_loss) || '—'}</span>
                  <span className="text-text-secondary mx-1">/</span>
                  <span className="text-success">{formatPrice(trade.take_profit) || '—'}</span>
                </td>
                <td className="px-4 py-3 font-mono text-white">{formatPrice(trade.close_price) || '—'}</td>
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
