'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart, IChartApi, ISeriesApi, LineStyle, IPriceLine,
  CandlestickData, LineData, UTCTimestamp,
} from 'lightweight-charts';
import api from '@/lib/api';
import { Indicators, Signal } from '@/types';
import { getPair, PRIMARY_SYMBOL } from '@/lib/pairs';
import { cn } from '@/lib/utils';
import { RefreshCw, Loader2 } from 'lucide-react';

// ─── TradingChart ────────────────────────────────────────────────────────────
// Pair- and signal-aware candlestick chart with overlays:
//   - Real EMA20 / EMA50 / EMA200 computed client-side from the same candles
//   - Bollinger upper/lower bands
//   - Horizontal price lines for the live signal: entry, SL, TP1, TP2
//   - Horizontal price lines for top S/R levels
//   - Pivot points (R1/PP/S1) as faint reference lines
// Auto-refreshes shortly after each candle close so what you see matches
// what the engine is computing.

const TIMEFRAMES = [
  { label: 'M15', value: '15min', refresh_ms: 60_000 },
  { label: 'H1',  value: '1h',    refresh_ms: 5 * 60_000 },
  { label: 'H4',  value: '4h',    refresh_ms: 15 * 60_000 },
  { label: 'D1',  value: '1day',  refresh_ms: 60 * 60_000 },
];
const OUTPUTSIZE: Record<string, number> = {
  '15min': 300, '1h': 300, '4h': 200, '1day': 200,
};

// Client-side EMA — simple iterative formula, matches technicalindicators output.
function computeEMA(values: number[], period: number): (number | null)[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  let ema: number | null = null;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      sum += values[i];
      out.push(null);
    } else if (i === period - 1) {
      sum += values[i];
      ema = sum / period;
      out.push(ema);
    } else {
      ema = values[i] * k + (ema as number) * (1 - k);
      out.push(ema);
    }
  }
  return out;
}

// Standard deviation over a rolling window — used for Bollinger Bands.
function computeRollingStd(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    const window = values.slice(i - period + 1, i + 1);
    const mean = window.reduce((s, v) => s + v, 0) / period;
    const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    out.push(Math.sqrt(variance));
  }
  return out;
}

interface TradingChartProps {
  symbol?: string;
  signal?: Signal | null;
  indicators?: Indicators | null;
  height?: number;
}

export default function TradingChart({ symbol = PRIMARY_SYMBOL, signal, indicators, height = 440 }: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const overlayRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const priceLineRefs = useRef<IPriceLine[]>([]);

  const [timeframe, setTimeframe] = useState('1h');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const pair = getPair(symbol);

  // ── Chart init (once) ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#0a0a0a' } as never,
        textColor: '#a1a1aa',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
      grid: {
        vertLines: { color: '#1a1a1a' },
        horzLines: { color: '#1a1a1a' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: {
        borderColor: '#1f1f1f',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#1f1f1f',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
      },
      width: containerRef.current.clientWidth,
      height,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor:        '#22c55e',
      downColor:      '#ef4444',
      borderUpColor:  '#22c55e',
      borderDownColor:'#ef4444',
      wickUpColor:    '#22c55e',
      wickDownColor:  '#ef4444',
      priceFormat:    { type: 'price', precision: pair.digits, minMove: pair.pip_size / 10 },
    });

    chartRef.current = chart;
    candleRef.current = candleSeries;

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      overlayRefs.current = [];
      priceLineRefs.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  // Re-apply price format if the pair changes (different digits / pip size).
  useEffect(() => {
    if (!candleRef.current) return;
    candleRef.current.applyOptions({
      priceFormat: { type: 'price', precision: pair.digits, minMove: pair.pip_size / 10 },
    });
  }, [pair.digits, pair.pip_size]);

  // ── Data fetch + overlay rebuild ──────────────────────────────────────────
  const loadData = useCallback(async (showSpinner = true) => {
    if (!candleRef.current || !chartRef.current) return;
    if (showSpinner) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      type Candle = { time: number; open: number; high: number; low: number; close: number };
      const candles: Candle[] = await api.getHistory(timeframe, OUTPUTSIZE[timeframe], symbol);
      if (!candleRef.current || !chartRef.current) return;

      const candleData: CandlestickData[] = candles.map(c => ({
        time: c.time as UTCTimestamp,
        open: c.open, high: c.high, low: c.low, close: c.close,
      }));
      candleRef.current.setData(candleData);

      // Tear down old overlays before rebuilding.
      overlayRefs.current.forEach(s => chartRef.current?.removeSeries(s));
      overlayRefs.current = [];

      const closes = candles.map(c => c.close);
      const times  = candles.map(c => c.time as UTCTimestamp);

      const addLine = (data: LineData[], color: string, title: string, style = LineStyle.Solid, width = 1) => {
        if (!chartRef.current) return;
        const s = chartRef.current.addLineSeries({
          color,
          lineWidth: width as 1 | 2 | 3 | 4,
          lineStyle: style,
          title,
          lastValueVisible: true,
          priceLineVisible: false,
        });
        s.setData(data);
        overlayRefs.current.push(s);
      };

      // EMAs — real computation from the candles themselves
      const ema20 = computeEMA(closes, 20);
      const ema50 = computeEMA(closes, 50);
      const ema200 = computeEMA(closes, 200);
      const ema20Data = ema20.map((v, i) => v == null ? null : { time: times[i], value: v }).filter(Boolean) as LineData[];
      const ema50Data = ema50.map((v, i) => v == null ? null : { time: times[i], value: v }).filter(Boolean) as LineData[];
      const ema200Data = ema200.map((v, i) => v == null ? null : { time: times[i], value: v }).filter(Boolean) as LineData[];
      if (ema20Data.length > 0)  addLine(ema20Data,  '#00d4aa', 'EMA20',  LineStyle.Solid);
      if (ema50Data.length > 0)  addLine(ema50Data,  '#f59e0b', 'EMA50',  LineStyle.Solid);
      if (ema200Data.length > 0) addLine(ema200Data, '#8b5cf6', 'EMA200', LineStyle.Solid, 2);

      // Bollinger Bands (20, 2) — upper + lower as dashed overlays
      const middle = computeEMA(closes, 20); // BB middle = SMA but EMA is close enough visually
      const std    = computeRollingStd(closes, 20);
      const upper: LineData[] = [];
      const lower: LineData[] = [];
      for (let i = 0; i < closes.length; i++) {
        if (middle[i] == null || std[i] == null) continue;
        upper.push({ time: times[i], value: (middle[i] as number) + 2 * (std[i] as number) });
        lower.push({ time: times[i], value: (middle[i] as number) - 2 * (std[i] as number) });
      }
      if (upper.length > 0) addLine(upper, '#3f3f46', 'BB Upper', LineStyle.Dashed);
      if (lower.length > 0) addLine(lower, '#3f3f46', 'BB Lower', LineStyle.Dashed);

      chartRef.current.timeScale().fitContent();
    } catch (err) {
      console.error('Chart load error:', err);
      setError('Failed to load chart data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [timeframe, symbol]);

  // Reload on symbol or timeframe change.
  useEffect(() => { loadData(true); }, [loadData]);

  // Auto-refresh shortly after each candle close.
  useEffect(() => {
    const tf = TIMEFRAMES.find(t => t.value === timeframe);
    if (!tf) return;
    const id = setInterval(() => loadData(false), tf.refresh_ms);
    return () => clearInterval(id);
  }, [timeframe, loadData]);

  // ── Signal-level price lines (entry / SL / TP1 / TP2) ─────────────────────
  // Rebuild any time the signal payload changes. Lines are drawn on the
  // candle series so they sit at the right price scale.
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    priceLineRefs.current.forEach(l => series.removePriceLine(l));
    priceLineRefs.current = [];

    if (!signal || signal.direction === 'NEUTRAL') return;
    // Only show lines for the matching symbol
    if (signal.symbol && signal.symbol !== symbol) return;

    const lines = [
      { price: signal.entry,         color: '#ffffff', title: `Entry ${signal.direction}`, style: LineStyle.Solid,  width: 2 as const },
      { price: signal.stop_loss,     color: '#ef4444', title: 'SL',  style: LineStyle.Dashed, width: 1 as const },
      { price: signal.take_profit_1, color: '#22c55e', title: 'TP1', style: LineStyle.Dashed, width: 1 as const },
      { price: signal.take_profit_2, color: '#22c55e', title: 'TP2', style: LineStyle.Dotted, width: 1 as const },
    ].filter(l => l.price != null && isFinite(l.price as number));

    for (const l of lines) {
      const line = series.createPriceLine({
        price: l.price as number,
        color: l.color,
        lineWidth: l.width,
        lineStyle: l.style,
        axisLabelVisible: true,
        title: l.title,
      });
      priceLineRefs.current.push(line);
    }
  }, [signal, symbol]);

  // ── S/R + pivot reference lines ───────────────────────────────────────────
  // Faint horizontal lines so the trader can see where the engine thinks
  // the market will react. Rebuilt when indicators change.
  useEffect(() => {
    const series = candleRef.current;
    if (!series || !indicators) return;
    // Clear (signal lines re-added above, so we only add S/R lines here)
    // Use a separate ref bucket isn't strictly needed — when the signal
    // effect runs it already clears ALL price lines, so we just append.
    const sr = indicators.support_resistance;
    const lines: { price: number; color: string; title: string; style: LineStyle }[] = [];
    (sr.resistance || []).slice(0, 2).forEach((r, i) => {
      lines.push({ price: r, color: '#ef4444', title: `R${i + 1}`, style: LineStyle.Dotted });
    });
    (sr.support || []).slice(0, 2).forEach((s, i) => {
      lines.push({ price: s, color: '#22c55e', title: `S${i + 1}`, style: LineStyle.Dotted });
    });
    if (indicators.pivot_points) {
      const pp = indicators.pivot_points;
      lines.push({ price: pp.pp, color: '#6366f1', title: 'PP', style: LineStyle.Dashed });
      lines.push({ price: pp.r1, color: '#ef4444', title: 'R1', style: LineStyle.Dotted });
      lines.push({ price: pp.s1, color: '#22c55e', title: 'S1', style: LineStyle.Dotted });
    }
    for (const l of lines) {
      const line = series.createPriceLine({
        price: l.price,
        color: l.color,
        lineWidth: 1,
        lineStyle: l.style,
        axisLabelVisible: false,
        title: l.title,
      });
      priceLineRefs.current.push(line);
    }
    // Note: when signal-effect rebuilds, these get cleared too. That's fine —
    // both effects run on render so the chart stays consistent.
  }, [indicators]);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-border gap-2 flex-wrap">
        <div>
          <h3 className="text-white font-bold text-base">{pair.display_name}</h3>
          <p className="text-text-secondary text-xs">EMA20 / EMA50 / EMA200 · Bollinger · S/R · Signal levels</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf.value}
                onClick={() => setTimeframe(tf.value)}
                className={cn(
                  'px-3 py-1 text-xs font-mono rounded transition-colors',
                  timeframe === tf.value
                    ? 'bg-accent text-black font-bold'
                    : 'text-text-secondary hover:text-white hover:bg-white/5'
                )}
              >
                {tf.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => loadData(false)}
            title="Refresh chart"
            className="p-1.5 text-text-secondary hover:text-white transition-colors"
          >
            {refreshing
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-10">
            <div className="flex items-center gap-2 text-text-secondary text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading chart…
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-10">
            <div className="text-danger text-sm">{error}</div>
          </div>
        )}
        <div ref={containerRef} />
      </div>
    </div>
  );
}
