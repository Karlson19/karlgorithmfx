'use client';
import { useState, useEffect } from 'react';
import { TradeDirection } from '@/types';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

const STRATEGIES = [
  'Fibonacci Retracement', 'EMA Cross', 'RSI', 'Bollinger Bands',
  'Support/Resistance', 'Price Action', 'MACD', 'Other'
];

interface TradeFormProps {
  onClose: () => void;
  onSave: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trade?: any | null;
}

export default function TradeForm({ onClose, onSave, trade }: TradeFormProps) {
  const [direction, setDirection] = useState<TradeDirection>('BUY');
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [lotSize, setLotSize] = useState('0.01');
  const [entryPrice, setEntryPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [closePrice, setClosePrice] = useState('');
  const [strategy, setStrategy] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Pre-fill entry with live price
    api.getPrice().then(p => {
      if (!trade) setEntryPrice(p.price.toFixed(5));
    }).catch(() => {});

    if (trade) {
      setDirection((trade.direction as TradeDirection) || 'BUY');
      setStatus((trade.status as 'open' | 'closed') || 'open');
      setLotSize(String(trade.lot_size || '0.01'));
      setEntryPrice(String(trade.entry_price || ''));
      setStopLoss(String(trade.stop_loss || ''));
      setTakeProfit(String(trade.take_profit || ''));
      setClosePrice(String(trade.close_price || ''));
      setStrategy(String(trade.strategy || ''));
      setNotes(String(trade.notes || ''));
    }
  }, [trade]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = {
        direction,
        lot_size: parseFloat(lotSize),
        entry_price: parseFloat(entryPrice),
        stop_loss: stopLoss ? parseFloat(stopLoss) : null,
        take_profit: takeProfit ? parseFloat(takeProfit) : null,
        close_price: closePrice ? parseFloat(closePrice) : null,
        strategy: strategy || null,
        notes: notes || null,
        status
      };

      if (trade?.id) {
        await api.updateTrade(trade.id as string, payload);
      } else {
        await api.createTrade(payload);
      }
      onSave();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save trade');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-white font-bold text-lg">{trade ? 'Edit Trade' : 'Log New Trade'}</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Direction */}
          <div>
            <label className="text-text-secondary text-sm mb-2 block">Direction</label>
            <div className="flex gap-2">
              {(['BUY', 'SELL'] as TradeDirection[]).map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(d)}
                  className={cn('flex-1 py-2.5 rounded-lg font-bold text-sm border transition-colors',
                    direction === d
                      ? d === 'BUY'
                        ? 'bg-success/20 border-success text-success'
                        : 'bg-danger/20 border-danger text-danger'
                      : 'border-border text-text-secondary hover:border-zinc-600'
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-text-secondary text-xs mb-1 block">Lot Size</label>
              <input
                type="number" step="0.01" value={lotSize}
                onChange={e => setLotSize(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-accent outline-none"
                required
              />
            </div>
            <div>
              <label className="text-text-secondary text-xs mb-1 block">Entry Price</label>
              <input
                type="number" step="0.00001" value={entryPrice}
                onChange={e => setEntryPrice(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-accent outline-none"
                required
              />
            </div>
            <div>
              <label className="text-text-secondary text-xs mb-1 block">Stop Loss</label>
              <input
                type="number" step="0.00001" value={stopLoss}
                onChange={e => setStopLoss(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-accent outline-none"
              />
            </div>
            <div>
              <label className="text-text-secondary text-xs mb-1 block">Take Profit</label>
              <input
                type="number" step="0.00001" value={takeProfit}
                onChange={e => setTakeProfit(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-accent outline-none"
              />
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="text-text-secondary text-sm mb-2 block">Status</label>
            <div className="flex gap-2">
              {(['open', 'closed'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={cn('flex-1 py-2 rounded-lg text-sm border transition-colors capitalize',
                    status === s
                      ? 'bg-accent/10 border-accent text-accent'
                      : 'border-border text-text-secondary hover:border-zinc-600'
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {status === 'closed' && (
            <div>
              <label className="text-text-secondary text-xs mb-1 block">Close Price</label>
              <input
                type="number" step="0.00001" value={closePrice}
                onChange={e => setClosePrice(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-accent outline-none"
              />
            </div>
          )}

          <div>
            <label className="text-text-secondary text-xs mb-1 block">Strategy</label>
            <select
              value={strategy}
              onChange={e => setStrategy(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white text-sm focus:border-accent outline-none"
            >
              <option value="">Select strategy...</option>
              {STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label className="text-text-secondary text-xs mb-1 block">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white text-sm focus:border-accent outline-none resize-none"
              placeholder="Add trade notes..."
            />
          </div>

          {error && <p className="text-danger text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-border text-text-secondary rounded-lg hover:text-white hover:border-zinc-600 text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-accent text-black font-bold rounded-lg hover:bg-accent/90 text-sm transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Trade'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
