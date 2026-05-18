'use client';
import { useState, useEffect, useMemo } from 'react';
import { Signal, TradeDirection } from '@/types';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { X, Sparkles } from 'lucide-react';
import {
  getPair, PAIRS, ENABLED_SYMBOLS, PRIMARY_SYMBOL,
  pipsBetween, recommendedLotSize, pnlUsd,
} from '@/lib/pairs';
import { useUserPrefs } from '@/hooks/useUserPrefs';

const STRATEGIES = [
  'EMA Pullback', 'Asian Range Breakout', 'Bollinger Squeeze Breakout',
  'S/R Mean Reversion', 'Liquidity Sweep Reversal', 'MTF Confluence',
  'Pivot Reaction', 'News Fade',
  '— manual —',
  'Fibonacci Retracement', 'EMA Cross', 'RSI', 'Bollinger Bands',
  'Support/Resistance', 'Price Action', 'MACD', 'Other',
];

// Trade payload the backend expects.
interface TradePayload {
  pair: string;
  signal_id: string | null;
  direction: TradeDirection;
  lot_size: number;
  entry_price: number;
  stop_loss: number | null;
  take_profit: number | null;
  close_price: number | null;
  strategy: string | null;
  notes: string | null;
  status: 'open' | 'closed';
}

interface TradeFormProps {
  onClose: () => void;
  onSave: () => void;
  // Existing trade for editing
  trade?: Partial<TradePayload> & { id?: string } | null;
  // When opening from a live signal, pre-fill everything and link signal_id.
  fromSignal?: Signal | null;
  // Optional initial account balance for the lot-size suggestion (defaults
  // to 10000 — we don't know the real balance without auth).
  defaultAccountBalance?: number;
}

export default function TradeForm({ onClose, onSave, trade, fromSignal, defaultAccountBalance }: TradeFormProps) {
  const [prefs] = useUserPrefs();
  const [pair, setPair] = useState<string>(prefs.default_symbol || PRIMARY_SYMBOL);
  const [direction, setDirection] = useState<TradeDirection>('BUY');
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [lotSize, setLotSize] = useState('0.01');
  const [entryPrice, setEntryPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [closePrice, setClosePrice] = useState('');
  const [strategy, setStrategy] = useState('');
  const [notes, setNotes] = useState('');
  const [signalId, setSignalId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // For the lot-size suggestion widget — defaults pull from user prefs
  // (Settings page) and the optional defaultAccountBalance prop wins if passed.
  const [accountBal, setAccountBal] = useState(defaultAccountBalance ?? prefs.account_balance);
  const [riskPct, setRiskPct] = useState(prefs.default_risk_pct);

  const pairMeta = getPair(pair);

  // ── Prefill from signal (one-shot) ────────────────────────────────────────
  useEffect(() => {
    if (!fromSignal || fromSignal.direction === 'NEUTRAL') return;
    if (fromSignal.symbol) setPair(fromSignal.symbol);
    if (fromSignal.direction === 'BUY' || fromSignal.direction === 'SELL') setDirection(fromSignal.direction);
    if (fromSignal.entry != null) setEntryPrice(String(fromSignal.entry));
    if (fromSignal.stop_loss != null) setStopLoss(String(fromSignal.stop_loss));
    if (fromSignal.take_profit_1 != null) setTakeProfit(String(fromSignal.take_profit_1));
    if (fromSignal.strategy) setStrategy(fromSignal.fired_strategy?.name || fromSignal.strategy);
    // Mark the link
    // The id field comes from the DB row; for live signals we may not have
    // one — fire-and-forget the link as null in that case.
    const sigAny = fromSignal as unknown as { id?: string };
    if (sigAny.id) setSignalId(sigAny.id);
    if (fromSignal.confidence) {
      setNotes(`Auto-prefilled from signal · confidence ${fromSignal.confidence}% · ${fromSignal.strategy}`);
    }
  }, [fromSignal]);

  // ── Prefill from existing trade (editing) ─────────────────────────────────
  useEffect(() => {
    if (!trade) return;
    if (trade.pair) setPair(trade.pair as string);
    if (trade.direction) setDirection(trade.direction as TradeDirection);
    if (trade.status) setStatus(trade.status as 'open' | 'closed');
    if (trade.lot_size != null) setLotSize(String(trade.lot_size));
    if (trade.entry_price != null) setEntryPrice(String(trade.entry_price));
    if (trade.stop_loss != null) setStopLoss(String(trade.stop_loss));
    if (trade.take_profit != null) setTakeProfit(String(trade.take_profit));
    if (trade.close_price != null) setClosePrice(String(trade.close_price));
    if (trade.strategy) setStrategy(String(trade.strategy));
    if (trade.notes) setNotes(String(trade.notes));
    if (trade.signal_id) setSignalId(String(trade.signal_id));
  }, [trade]);

  // ── Pre-fill entry with live price when none provided ─────────────────────
  useEffect(() => {
    if (!trade && !fromSignal && !entryPrice) {
      api.getPrice(pair).then(p => {
        if (p?.price != null) setEntryPrice(p.price.toFixed(pairMeta.digits));
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair]);

  // ── Live computed previews ────────────────────────────────────────────────
  const entryN = parseFloat(entryPrice);
  const slN    = parseFloat(stopLoss);
  const tpN    = parseFloat(takeProfit);
  const closeN = parseFloat(closePrice);
  const lotN   = parseFloat(lotSize);

  const slPips = isFinite(entryN) && isFinite(slN) ? pipsBetween(pair, entryN, slN) : null;
  const tpPips = isFinite(entryN) && isFinite(tpN) ? pipsBetween(pair, entryN, tpN) : null;
  const previewPL = isFinite(closeN) && isFinite(entryN) && isFinite(lotN)
    ? pnlUsd(pair, direction, entryN, closeN, lotN) : null;

  // Lot-size suggestion based on configured risk %
  const suggestedLot = useMemo(() => {
    if (!slPips) return null;
    return recommendedLotSize(pair, accountBal, riskPct, slPips);
  }, [pair, accountBal, riskPct, slPips]);

  function useSuggestedLot() {
    if (suggestedLot != null) setLotSize(suggestedLot.toFixed(2));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload: TradePayload = {
        pair,
        signal_id: signalId,
        direction,
        lot_size: parseFloat(lotSize),
        entry_price: parseFloat(entryPrice),
        stop_loss: stopLoss ? parseFloat(stopLoss) : null,
        take_profit: takeProfit ? parseFloat(takeProfit) : null,
        close_price: closePrice ? parseFloat(closePrice) : null,
        strategy: strategy || null,
        notes: notes || null,
        status,
      };

      if (trade?.id) {
        await api.updateTrade(trade.id, payload as unknown as Record<string, unknown>);
      } else {
        await api.createTrade(payload as unknown as Record<string, unknown>);
      }
      onSave();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save trade');
    } finally {
      setSaving(false);
    }
  }

  const priceStep = pairMeta.pip_size / 10;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-white font-bold text-lg">
            {trade ? 'Edit Trade' : fromSignal ? `Log trade from ${fromSignal.display_name || fromSignal.symbol} signal` : 'Log New Trade'}
          </h2>
          <button onClick={onClose} className="text-text-secondary hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Pair */}
          <div>
            <label className="text-text-secondary text-xs mb-1 block">Pair</label>
            <select
              value={pair}
              onChange={e => setPair(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white text-sm focus:border-accent outline-none"
              disabled={!!trade?.id} // pair locked once a trade exists
            >
              {ENABLED_SYMBOLS.map(s => <option key={s} value={s}>{PAIRS[s].display_name}</option>)}
            </select>
          </div>

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
                type="number" step={priceStep} value={entryPrice}
                onChange={e => setEntryPrice(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-accent outline-none"
                required
              />
            </div>
            <div>
              <label className="text-text-secondary text-xs mb-1 block">Stop Loss</label>
              <input
                type="number" step={priceStep} value={stopLoss}
                onChange={e => setStopLoss(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-accent outline-none"
              />
              {slPips != null && <p className="text-text-secondary text-xs mt-1">{slPips.toFixed(1)} pips</p>}
            </div>
            <div>
              <label className="text-text-secondary text-xs mb-1 block">Take Profit</label>
              <input
                type="number" step={priceStep} value={takeProfit}
                onChange={e => setTakeProfit(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-accent outline-none"
              />
              {tpPips != null && <p className="text-text-secondary text-xs mt-1">{tpPips.toFixed(1)} pips · R/R 1:{slPips ? (tpPips / slPips).toFixed(1) : '—'}</p>}
            </div>
          </div>

          {/* Lot-size suggestion */}
          {slPips != null && slPips > 0 && (
            <div className="bg-background border border-border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-text-secondary">Position sizer (assumes balance $</span>
                <input
                  type="number" value={accountBal}
                  onChange={e => setAccountBal(parseFloat(e.target.value) || 0)}
                  className="w-24 bg-card border border-border rounded px-2 py-0.5 text-white font-mono text-xs"
                />
                <span className="text-text-secondary">, risk</span>
                <input
                  type="number" step="0.25" min="0.25" max="5" value={riskPct}
                  onChange={e => setRiskPct(parseFloat(e.target.value) || 1)}
                  className="w-16 bg-card border border-border rounded px-2 py-0.5 text-white font-mono text-xs"
                />
                <span className="text-text-secondary">%)</span>
              </div>
              {suggestedLot != null && (
                <button
                  type="button"
                  onClick={useSuggestedLot}
                  className="w-full flex items-center justify-between px-3 py-2 bg-accent/10 border border-accent/30 hover:border-accent rounded text-xs transition-colors"
                >
                  <span className="text-text-secondary">Suggested: <span className="text-accent font-mono font-bold">{suggestedLot.toFixed(2)} lots</span></span>
                  <span className="text-accent">Use →</span>
                </button>
              )}
            </div>
          )}

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
                type="number" step={priceStep} value={closePrice}
                onChange={e => setClosePrice(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-accent outline-none"
              />
              {previewPL != null && (
                <p className={cn('text-xs mt-1 font-mono', previewPL >= 0 ? 'text-success' : 'text-danger')}>
                  Preview P&L: {previewPL >= 0 ? '+$' : '-$'}{Math.abs(previewPL).toFixed(2)}
                </p>
              )}
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
              {STRATEGIES.map(s => <option key={s} value={s} disabled={s.startsWith('—')}>{s}</option>)}
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

          {signalId && (
            <div className="flex items-center gap-2 px-3 py-2 bg-accent/10 border border-accent/30 rounded text-xs">
              <Sparkles className="w-3.5 h-3.5 text-accent" />
              <span className="text-text-secondary">This trade is linked to signal <span className="text-accent font-mono">{signalId.slice(0, 8)}…</span></span>
            </div>
          )}

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
