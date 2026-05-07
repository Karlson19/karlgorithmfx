'use client';
import { Indicators } from '@/types';
import { cn, getSignalBg, formatPrice } from '@/lib/utils';
import { CheckCircle, XCircle, Clock, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface IndicatorPanelProps {
  indicators: Indicators;
}

// Format helpers that don't blow up on null. Indicators can now report
// `available: false` (insufficient data, library error) — we display "—"
// instead of crashing on .toFixed of null.
const fix = (v: number | null | undefined, d = 2) =>
  v == null || !isFinite(v) ? '—' : v.toFixed(d);

function Row({
  label, value, signal, desc, unavailable,
}: {
  label: string;
  value: string;
  signal: string;
  desc?: string;
  unavailable?: boolean;
}) {
  return (
    <div className={cn('flex items-center justify-between py-2.5 border-b border-border last:border-0', unavailable && 'opacity-50')}>
      <div>
        <p className="text-white text-sm font-medium">{label}</p>
        {desc && <p className="text-text-secondary text-xs mt-0.5">{desc}</p>}
      </div>
      <div className="flex items-center gap-3 ml-4">
        <span className="text-white font-mono text-sm whitespace-nowrap">{value}</span>
        <span className={cn('text-xs px-2 py-0.5 rounded border font-semibold w-16 text-center flex-shrink-0', getSignalBg(unavailable ? 'NEUTRAL' : signal))}>
          {unavailable ? 'N/A' : signal}
        </span>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-text-secondary text-xs font-semibold uppercase tracking-widest mt-5 mb-1 first:mt-0">{children}</p>;
}

export default function IndicatorPanel({ indicators: ind }: IndicatorPanelProps) {
  return (
    <div className="space-y-4">

      {/* ── Multi-Timeframe Analysis ── */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-white font-bold mb-4">Multi-Timeframe Analysis</h3>
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { tf: 'H4', bias: ind.mtf.h4_bias, desc: 'Trend direction' },
            { tf: 'H1', bias: ind.mtf.h1_bias, desc: 'Signal timeframe' },
            { tf: 'M15', bias: ind.mtf.m15_bias, desc: 'Entry timing' }
          ].map(({ tf, bias, desc }) => (
            <div key={tf} className={cn(
              'rounded-xl border p-4 text-center',
              bias === 'BUY'  ? 'bg-success/10 border-success/30' :
              bias === 'SELL' ? 'bg-danger/10 border-danger/30' :
              'bg-border/30 border-border'
            )}>
              <p className="text-text-secondary text-xs mb-1">{tf}</p>
              <div className={cn('flex items-center justify-center gap-1 font-bold text-lg',
                bias === 'BUY' ? 'text-success' : bias === 'SELL' ? 'text-danger' : 'text-text-secondary'
              )}>
                {bias === 'BUY' ? <TrendingUp className="w-5 h-5" /> :
                 bias === 'SELL' ? <TrendingDown className="w-5 h-5" /> :
                 <Minus className="w-5 h-5" />}
                {bias}
              </div>
              <p className="text-text-secondary text-xs mt-1">{desc}</p>
            </div>
          ))}
        </div>
        <div className={cn(
          'flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm',
          ind.mtf.aligned
            ? 'bg-success/10 border-success/30 text-success'
            : 'bg-border/30 border-border text-text-secondary'
        )}>
          {ind.mtf.aligned
            ? <CheckCircle className="w-4 h-4 flex-shrink-0" />
            : <XCircle className="w-4 h-4 flex-shrink-0" />}
          {ind.mtf.description}
        </div>
      </div>

      {/* ── Candlestick Patterns ── */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-white font-bold mb-4">Candlestick Patterns</h3>
        {ind.candlePatterns.bullish.length === 0 && ind.candlePatterns.bearish.length === 0 && !ind.candlePatterns.doji ? (
          <p className="text-text-secondary text-sm">No significant patterns detected on the last candle.</p>
        ) : (
          <div className="space-y-3">
            {ind.candlePatterns.bullish.length > 0 && (
              <div>
                <p className="text-success text-xs font-semibold mb-1.5">BULLISH PATTERNS</p>
                <div className="flex flex-wrap gap-2">
                  {ind.candlePatterns.bullish.map(p => (
                    <span key={p} className="px-2.5 py-1 bg-success/10 border border-success/30 text-success text-xs rounded-full">{p}</span>
                  ))}
                </div>
              </div>
            )}
            {ind.candlePatterns.bearish.length > 0 && (
              <div>
                <p className="text-danger text-xs font-semibold mb-1.5">BEARISH PATTERNS</p>
                <div className="flex flex-wrap gap-2">
                  {ind.candlePatterns.bearish.map(p => (
                    <span key={p} className="px-2.5 py-1 bg-danger/10 border border-danger/30 text-danger text-xs rounded-full">{p}</span>
                  ))}
                </div>
              </div>
            )}
            {ind.candlePatterns.doji && (
              <span className="px-2.5 py-1 bg-yellow-400/10 border border-yellow-400/30 text-yellow-400 text-xs rounded-full inline-block">Doji — Indecision</span>
            )}
          </div>
        )}
      </div>

      {/* ── Technical Indicators ── */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-white font-bold mb-2">Technical Indicators</h3>

        <SectionTitle>Momentum</SectionTitle>
        <Row
          label="RSI (14)"
          value={fix(ind.rsi.value, 2)}
          signal={ind.rsi.signal}
          desc={ind.rsi.description}
          unavailable={!ind.rsi.available}
        />
        <Row
          label="Williams %R (14)"
          value={fix(ind.williamsR.value, 2)}
          signal={ind.williamsR.signal}
          desc={ind.williamsR.description}
          unavailable={!ind.williamsR.available}
        />
        <Row
          label="CCI (20)"
          value={fix(ind.cci.value, 2)}
          signal={ind.cci.signal}
          desc={ind.cci.description}
          unavailable={!ind.cci.available}
        />
        <Row
          label="Stochastic K/D"
          value={`${fix(ind.stochastic.k, 1)} / ${fix(ind.stochastic.d, 1)}`}
          signal={ind.stochastic.signal}
          unavailable={!ind.stochastic.available}
        />

        <SectionTitle>Trend</SectionTitle>
        <Row
          label="MACD (12,26,9)"
          value={fix(ind.macd.value, 6)}
          signal={ind.macd.signal}
          desc={`Histogram: ${fix(ind.macd.histogram, 6)}`}
          unavailable={!ind.macd.available}
        />
        <Row
          label="EMA 20"
          value={formatPrice(ind.ema20.value)}
          signal={ind.ema20.signal}
          unavailable={!ind.ema20.available}
        />
        <Row
          label="EMA 50"
          value={formatPrice(ind.ema50.value)}
          signal={ind.ema50.signal}
          unavailable={!ind.ema50.available}
        />
        <Row
          label="EMA 200"
          value={formatPrice(ind.ema200.value)}
          signal={ind.ema200.signal}
          unavailable={!ind.ema200.available}
        />
        <Row
          label="ADX (14)"
          value={fix(ind.adx.value, 2)}
          signal={ind.adx.trending ? 'BUY' : 'NEUTRAL'}
          desc={ind.adx.trending ? `Trending${ind.adx.strong ? ' — Strong' : ''}` : 'No strong trend'}
          unavailable={!ind.adx.available}
        />

        <SectionTitle>Ichimoku Cloud</SectionTitle>
        <Row
          label="Signal"
          value={ind.ichimoku.cloud_position}
          signal={ind.ichimoku.signal}
          desc={ind.ichimoku.description}
          unavailable={!ind.ichimoku.available}
        />
        <Row
          label="Tenkan / Kijun"
          value={`${formatPrice(ind.ichimoku.tenkan)} / ${formatPrice(ind.ichimoku.kijun)}`}
          signal={
            ind.ichimoku.available && ind.ichimoku.tenkan != null && ind.ichimoku.kijun != null
              ? (ind.ichimoku.tenkan > ind.ichimoku.kijun ? 'BUY' : 'SELL')
              : 'NEUTRAL'
          }
          unavailable={!ind.ichimoku.available}
        />
        <Row
          label="Span A / B"
          value={`${formatPrice(ind.ichimoku.span_a)} / ${formatPrice(ind.ichimoku.span_b)}`}
          signal={
            ind.ichimoku.available && ind.ichimoku.span_a != null && ind.ichimoku.span_b != null
              ? (ind.ichimoku.span_a > ind.ichimoku.span_b ? 'BUY' : 'SELL')
              : 'NEUTRAL'
          }
          unavailable={!ind.ichimoku.available}
        />

        <SectionTitle>Volatility</SectionTitle>
        <Row
          label="Bollinger Bands"
          value={formatPrice(ind.bollinger.middle)}
          signal={ind.bollinger.signal}
          desc={
            ind.bollinger.available && ind.bollinger.lower != null && ind.bollinger.upper != null && ind.bollinger.width != null
              ? `${formatPrice(ind.bollinger.lower)} — ${formatPrice(ind.bollinger.upper)} · Width: ${(ind.bollinger.width * 10000).toFixed(1)} pips`
              : 'No data'
          }
          unavailable={!ind.bollinger.available}
        />
        <Row
          label="ATR (14)"
          value={
            ind.atr.available && ind.atr.value != null && ind.atr.pips != null
              ? `${formatPrice(ind.atr.value)} (${ind.atr.pips} pips)`
              : '—'
          }
          signal="NEUTRAL"
          desc="Used for stop loss sizing"
          unavailable={!ind.atr.available}
        />
      </div>

      {/* ── Pivot Points ── */}
      {ind.pivot_points && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="text-white font-bold mb-4">Daily Pivot Points</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'R3', value: ind.pivot_points.r3, color: 'text-danger' },
              { label: 'R2', value: ind.pivot_points.r2, color: 'text-danger' },
              { label: 'R1', value: ind.pivot_points.r1, color: 'text-danger' },
              { label: 'PP', value: ind.pivot_points.pp, color: 'text-accent', bold: true },
              { label: 'S1', value: ind.pivot_points.s1, color: 'text-success' },
              { label: 'S2', value: ind.pivot_points.s2, color: 'text-success' },
              { label: 'S3', value: ind.pivot_points.s3, color: 'text-success' },
            ].map(({ label, value, color, bold }) => (
              <div key={label} className="bg-background border border-border rounded-lg p-3 text-center">
                <p className={cn('text-xs font-semibold mb-1', color)}>{label}</p>
                <p className={cn('font-mono text-sm', color, bold && 'font-bold text-base')}>{formatPrice(value)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Fibonacci & S/R ── */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-white font-bold mb-4">Fibonacci & Key Levels</h3>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-success text-xs font-semibold mb-2">SUPPORT</p>
            {ind.support_resistance.support.length > 0
              ? ind.support_resistance.support.map((s, i) => (
                  <p key={i} className="text-white font-mono text-sm py-0.5">{formatPrice(s)}</p>
                ))
              : <p className="text-text-secondary text-sm">—</p>
            }
          </div>
          <div>
            <p className="text-danger text-xs font-semibold mb-2">RESISTANCE</p>
            {ind.support_resistance.resistance.length > 0
              ? ind.support_resistance.resistance.map((r, i) => (
                  <p key={i} className="text-white font-mono text-sm py-0.5">{formatPrice(r)}</p>
                ))
              : <p className="text-text-secondary text-sm">—</p>
            }
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 sm:grid-cols-6 gap-2">
          {Object.entries(ind.fibonacci.levels).map(([level, price]) => (
            <div key={level} className="bg-background border border-border rounded p-2 text-center">
              <p className="text-text-secondary text-xs">{level}%</p>
              <p className="text-white font-mono text-xs">{formatPrice(price)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Agreeing Indicators ── */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-text-secondary" />
          <span className="text-text-secondary text-xs font-semibold uppercase tracking-widest">Signal last updated</span>
          <span className="text-text-secondary text-xs ml-auto">{new Date(ind.timestamp).toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  );
}
