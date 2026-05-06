'use client';
import { Indicators } from '@/types';
import { cn, getSignalBg } from '@/lib/utils';

interface IndicatorRowProps {
  indicators?: Indicators | null;
  loading?: boolean;
}

function IndicatorCell({ label, value, signal }: { label: string; value: string; signal: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-text-secondary text-xs">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-white font-mono text-sm">{value}</span>
        <span className={cn('text-xs px-1.5 py-0.5 rounded border font-semibold', getSignalBg(signal))}>
          {signal}
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
        <IndicatorCell label="RSI (14)" value={indicators.rsi.value.toFixed(1)} signal={indicators.rsi.signal} />
        <IndicatorCell label="MACD" value={indicators.macd.value.toFixed(5)} signal={indicators.macd.signal} />
        <IndicatorCell label="EMA 20/50" value={`${indicators.ema20.value.toFixed(4)}`} signal={indicators.ema20.signal} />
        <IndicatorCell label="ADX" value={indicators.adx.value.toFixed(1)} signal={indicators.adx.trending ? 'BUY' : 'NEUTRAL'} />
        <IndicatorCell label="Bollinger" value={indicators.bollinger.middle.toFixed(4)} signal={indicators.bollinger.signal} />
      </div>
    </div>
  );
}
