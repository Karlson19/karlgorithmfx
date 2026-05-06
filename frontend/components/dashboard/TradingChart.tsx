'use client';
import { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, LineStyle } from 'lightweight-charts';
import api from '@/lib/api';
import { Indicators } from '@/types';

const TIMEFRAMES = [
  { label: 'M15', value: '15min' },
  { label: 'H1', value: '1h' },
  { label: 'H4', value: '4h' },
  { label: 'D1', value: '1day' },
];

const OUTPUTSIZE: Record<string, number> = {
  '15min': 200, '1h': 200, '4h': 100, '1day': 365
};

export default function TradingChart({ indicators }: { indicators?: Indicators | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [timeframe, setTimeframe] = useState('1h');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#111111' } as never,
        textColor: '#a1a1aa'
      },
      grid: {
        vertLines: { color: '#1f1f1f' },
        horzLines: { color: '#1f1f1f' }
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#1f1f1f' },
      timeScale: { borderColor: '#1f1f1f', timeVisible: true, secondsVisible: false },
      width: containerRef.current.clientWidth,
      height: 400
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444'
    });

    chartRef.current = chart;
    candleRef.current = candleSeries;

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!candleRef.current || !chartRef.current) return;
    setLoading(true);

    api.getHistory(timeframe, OUTPUTSIZE[timeframe]).then((candles: { time: number; open: number; high: number; low: number; close: number }[]) => {
      if (!candleRef.current || !chartRef.current) return;
      candleRef.current.setData(candles as never);

      if (indicators) {
        const prices = candles.map(c => ({ time: c.time, value: c.close }));
        chartRef.current.addLineSeries({
          color: '#00d4aa',
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          title: 'EMA20',
          lastValueVisible: false,
          priceLineVisible: false
        }).setData(prices as never);

        chartRef.current.addLineSeries({
          color: '#f59e0b',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          title: 'EMA50',
          lastValueVisible: false,
          priceLineVisible: false
        }).setData(prices as never);
      }

      chartRef.current.timeScale().fitContent();
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [timeframe, indicators]);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h3 className="text-white font-medium">EUR/USD Chart</h3>
        <div className="flex gap-1">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.value}
              onClick={() => setTimeframe(tf.value)}
              className={`px-3 py-1 text-xs font-mono rounded transition-colors ${
                timeframe === tf.value
                  ? 'bg-accent text-black font-bold'
                  : 'text-text-secondary hover:text-white hover:bg-white/5'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-10">
            <div className="text-text-secondary text-sm">Loading chart...</div>
          </div>
        )}
        <div ref={containerRef} />
      </div>
    </div>
  );
}
