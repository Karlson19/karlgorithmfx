'use client';
import { Indicators } from '@/types';
import { cn, getSignalBg } from '@/lib/utils';

interface IndicatorRowProps {
  indicators?: Indicators | null;
  loading?: boolean;
}

// Null-safe formatter — indicator values can be null when `available: false`.
const fix = (v: number | null | undefined, d: number) =>
  v == null || !isFinite(v) ? '—' : v.toFixed(d);

function IndicatorCell({ label, value, signal, unavailable }: { label: string; value: string; signal: string; unavailable?: boolean }) {
  return (
    <div className={cn('flex flex-col gap-1', unavailable && 'opacity-50')}>
      <span className="text-text-secondary text-xs">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-white font-mono text-sm">{value}</span>
        <span className={cn('text-xs px-1.5 py-0.5 rounded border font-semibold', getSignalBg(unavailable ? 'NEUTRAL' : signal))}>
          {unavailable ? 'N/A' : signal}
        </span>
      </div>
    </div>
  );
}

export default function IndicatorRow({ indicators, loading }: IndicatorRowProps) {
  if (loading || !indicators) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 animate-pulse">
        <div className="flex gap-4">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-10 bg-border rounded flex-1" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="text-text-secondary text-sm mb-3">Indicators</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
        <IndicatorCell label="RSI (14)"   value={fix(indicators.rsi.value, 1)}        signal={indicators.rsi.signal}   unavailable={!indicators.rsi.available} />
        <IndicatorCell label="MACD"       value={fix(indicators.macd.value, 5)}       signal={indicators.macd.signal}  unavailable={!indicators.macd.available} />
        <IndicatorCell label="EMA 20/50"  value={fix(indicators.ema20.value, 4)}      signal={indicators.ema20.signal} unavailable={!indicators.ema20.available} />
        <IndicatorCell label="ADX"        value={fix(indicators.adx.value, 1)}        signal={indicators.adx.trending ? 'BUY' : 'NEUTRAL'} unavailable={!indicators.adx.available} />
        <IndicatorCell label="Bollinger"  value={fix(indicators.bollinger.middle, 4)} signal={indicators.bollinger.signal} unavailable={!indicators.bollinger.available} />
      </div>
    </div>
  );
}
