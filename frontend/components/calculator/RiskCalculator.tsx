'use client';
import { useState } from 'react';
import { Calculator } from 'lucide-react';

interface CalcResult {
  lotSize: number;
  positionValue: number;
  moneyAtRisk: number;
  pipValue: number;
}

export default function RiskCalculator() {
  const [balance, setBalance] = useState('10000');
  const [riskPct, setRiskPct] = useState(1);
  const [slPips, setSlPips] = useState('30');
  const [result, setResult] = useState<CalcResult | null>(null);

  function calculate() {
    const bal = parseFloat(balance);
    const sl = parseFloat(slPips);
    if (!bal || !sl) return;

    const riskAmount = bal * (riskPct / 100);
    // For EUR/USD standard lot: 1 pip = $10
    const pipValue = 10; // per standard lot
    const lotSize = parseFloat((riskAmount / (sl * pipValue)).toFixed(2));
    const positionValue = lotSize * 100000 * 1.08; // approx
    const moneyAtRisk = sl * lotSize * pipValue;

    setResult({ lotSize, positionValue, moneyAtRisk, pipValue: lotSize * pipValue });
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-center gap-2 mb-5">
        <Calculator className="w-5 h-5 text-accent" />
        <h3 className="text-white font-bold">Lot Size Calculator</h3>
      </div>

      <div className="space-y-4 mb-5">
        <div>
          <label className="text-text-secondary text-xs mb-1 block">Account Balance (USD)</label>
          <input
            type="number" value={balance} onChange={e => setBalance(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-white font-mono focus:border-accent outline-none"
          />
        </div>

        <div>
          <div className="flex justify-between text-xs mb-1">
            <label className="text-text-secondary">Risk Percentage</label>
            <span className="text-accent font-semibold">{riskPct}%</span>
          </div>
          <input
            type="range" min="0.5" max="5" step="0.5" value={riskPct}
            onChange={e => setRiskPct(parseFloat(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-xs text-text-secondary mt-1">
            <span>0.5%</span><span>5%</span>
          </div>
        </div>

        <div>
          <label className="text-text-secondary text-xs mb-1 block">Stop Loss (pips)</label>
          <input
            type="number" value={slPips} onChange={e => setSlPips(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-white font-mono focus:border-accent outline-none"
          />
        </div>

        <div className="text-text-secondary text-xs">
          Pair: EUR/USD (fixed) · Account: USD
        </div>
      </div>

      <button
        onClick={calculate}
        className="w-full bg-accent text-black font-bold py-3 rounded-lg hover:bg-accent/90 transition-colors mb-5"
      >
        CALCULATE
      </button>

      {result && (
        <div className="border border-border rounded-lg divide-y divide-border">
          {[
            { label: 'Recommended Lot Size', value: result.lotSize.toFixed(2), highlight: true },
            { label: 'Position Value', value: `$${result.positionValue.toFixed(0)}` },
            { label: 'Money at Risk', value: `$${result.moneyAtRisk.toFixed(2)}` },
            { label: 'Pip Value (per pip)', value: `$${result.pipValue.toFixed(2)}` }
          ].map(row => (
            <div key={row.label} className="flex justify-between px-4 py-3">
              <span className="text-text-secondary text-sm">{row.label}</span>
              <span className={row.highlight ? 'text-accent font-bold font-mono text-lg' : 'text-white font-mono text-sm'}>{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
