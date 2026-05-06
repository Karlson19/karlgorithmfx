'use client';
import { useState } from 'react';

export default function LotSizeResult() {
  const [lotSize, setLotSize] = useState('0.01');
  const [pipMove, setPipMove] = useState('');
  const [entry, setEntry] = useState('');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');

  const pipPL = lotSize && pipMove
    ? (parseFloat(lotSize) * parseFloat(pipMove) * 10).toFixed(2)
    : null;

  const slPips = entry && sl ? Math.abs((parseFloat(entry) - parseFloat(sl)) * 10000).toFixed(1) : null;
  const tpPips = entry && tp ? Math.abs((parseFloat(tp) - parseFloat(entry)) * 10000).toFixed(1) : null;
  const rr = slPips && tpPips ? (parseFloat(tpPips) / parseFloat(slPips)).toFixed(2) : null;
  const breakEven = rr ? (100 / (1 + parseFloat(rr))).toFixed(1) : null;

  return (
    <div className="space-y-4">
      {/* Pip Value Calculator */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-white font-bold mb-4">Pip Value Calculator</h3>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-text-secondary text-xs mb-1 block">Lot Size</label>
            <input
              type="number" step="0.01" value={lotSize}
              onChange={e => setLotSize(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-accent outline-none"
            />
          </div>
          <div>
            <label className="text-text-secondary text-xs mb-1 block">Pip Movement</label>
            <input
              type="number" value={pipMove}
              onChange={e => setPipMove(e.target.value)}
              placeholder="e.g. 20"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-accent outline-none"
            />
          </div>
        </div>
        {pipPL && (
          <div className="flex justify-between bg-background border border-border rounded-lg px-4 py-3">
            <span className="text-text-secondary text-sm">Profit/Loss</span>
            <span className={`font-mono font-bold ${parseFloat(pipPL) >= 0 ? 'text-success' : 'text-danger'}`}>
              {parseFloat(pipPL) >= 0 ? '+$' : '-$'}{Math.abs(parseFloat(pipPL)).toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* R/R Calculator */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-white font-bold mb-4">Risk/Reward Calculator</h3>
        <div className="space-y-3 mb-4">
          <div>
            <label className="text-text-secondary text-xs mb-1 block">Entry Price</label>
            <input
              type="number" step="0.00001" value={entry}
              onChange={e => setEntry(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-accent outline-none"
            />
          </div>
          <div>
            <label className="text-text-secondary text-xs mb-1 block">Stop Loss</label>
            <input
              type="number" step="0.00001" value={sl}
              onChange={e => setSl(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-accent outline-none"
            />
          </div>
          <div>
            <label className="text-text-secondary text-xs mb-1 block">Take Profit</label>
            <input
              type="number" step="0.00001" value={tp}
              onChange={e => setTp(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-white font-mono text-sm focus:border-accent outline-none"
            />
          </div>
        </div>
        {rr && (
          <div className="border border-border rounded-lg divide-y divide-border">
            {[
              { label: 'Risk (pips)', value: slPips },
              { label: 'Reward (pips)', value: tpPips },
              { label: 'Risk/Reward', value: `1:${rr}`, bold: true },
              { label: 'Break-even Win Rate', value: `${breakEven}%` }
            ].map(row => (
              <div key={row.label} className="flex justify-between px-4 py-3">
                <span className="text-text-secondary text-sm">{row.label}</span>
                <span className={`font-mono text-sm ${row.bold ? 'text-accent font-bold' : 'text-white'}`}>{row.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
