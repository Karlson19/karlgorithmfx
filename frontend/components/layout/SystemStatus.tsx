'use client';
import { useEffect, useState, useRef } from 'react';
import { SystemHealth } from '@/types';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { Activity, AlertTriangle, AlertCircle, CheckCircle, X } from 'lucide-react';

// ─── System Status badge ─────────────────────────────────────────────────────
// Lives in the header. Polls /api/health every 30s. One-glance:
//   - green dot: everything healthy
//   - yellow dot: degraded (provider hard-throttled, signal aging)
//   - red dot: critical (provider exhausted, signal stale, system error)
// Click to open a small panel showing the actual numbers.

const POLL_INTERVAL_MS = 30_000;

export default function SystemStatus() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const data = await api.getHealth();
        if (!cancelled) setHealth(data);
      } catch {
        if (!cancelled) {
          // If we can't even reach /api/health, the backend is down.
          setHealth({
            status: 'critical',
            reasons: ['Cannot reach backend'],
            timestamp: new Date().toISOString(),
            uptime_seconds: 0,
            providers: [],
            signals: [],
            calibration_samples: {},
            pairs_enabled: [],
          });
        }
      }
    }
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Click-outside to close
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const status = health?.status || 'ok';
  const dot = status === 'critical' ? 'bg-danger' : status === 'degraded' ? 'bg-yellow-400' : 'bg-success';
  const Icon = status === 'critical' ? AlertTriangle : status === 'degraded' ? AlertCircle : CheckCircle;
  const iconColor = status === 'critical' ? 'text-danger' : status === 'degraded' ? 'text-yellow-400' : 'text-success';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title={`System status: ${status}`}
        className="flex items-center gap-1.5 px-2 py-1 hover:bg-background/50 rounded transition-colors"
      >
        <span className={cn('w-1.5 h-1.5 rounded-full', dot, status !== 'ok' && 'animate-pulse')} />
        <Activity className="w-3.5 h-3.5 text-text-secondary" />
      </button>

      {open && health && (
        <div className="absolute right-0 mt-1 w-80 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Icon className={cn('w-4 h-4', iconColor)} />
              <span className={cn('text-sm font-bold capitalize', iconColor)}>{status}</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-text-secondary hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {health.reasons.length > 0 && (
            <div className="px-4 py-2 border-b border-border space-y-1">
              {health.reasons.map((r, i) => (
                <p key={i} className="text-xs text-text-secondary">• {r}</p>
              ))}
            </div>
          )}

          {/* Providers */}
          <div className="px-4 py-2 border-b border-border">
            <p className="text-text-secondary text-xs uppercase tracking-wider mb-1.5">API Quota</p>
            {health.providers.map(p => (
              <div key={p.provider} className="flex items-center justify-between text-xs py-0.5">
                <span className="text-white">{p.name}</span>
                <div className="flex items-center gap-2">
                  {p.limit ? (
                    <>
                      <div className="w-16 h-1 bg-border rounded-full overflow-hidden">
                        <div className={cn('h-full',
                          p.status === 'exhausted' ? 'bg-danger'
                          : p.status === 'hard_throttle' ? 'bg-danger/70'
                          : p.status === 'soft_throttle' ? 'bg-yellow-400'
                          : 'bg-success'
                        )} style={{ width: `${Math.min(100, p.ratio * 100)}%` }} />
                      </div>
                      <span className="text-text-secondary font-mono w-16 text-right">{p.used} / {p.limit}</span>
                    </>
                  ) : (
                    <span className="text-text-secondary font-mono">{p.used} calls today</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Signals freshness */}
          <div className="px-4 py-2 border-b border-border">
            <p className="text-text-secondary text-xs uppercase tracking-wider mb-1.5">Signal Freshness</p>
            {health.signals.map(s => (
              <div key={s.symbol} className="flex items-center justify-between text-xs py-0.5">
                <span className="text-white font-mono">{s.symbol}</span>
                <div className="flex items-center gap-2">
                  <span className={cn('w-1.5 h-1.5 rounded-full',
                    s.status === 'stale' ? 'bg-danger'
                    : s.status === 'aging' ? 'bg-yellow-400'
                    : s.status === 'fresh' ? 'bg-success'
                    : 'bg-border'
                  )} />
                  <span className="text-text-secondary font-mono">
                    {s.age_minutes != null ? `${s.age_minutes}m ago` : 'never'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Calibration */}
          <div className="px-4 py-2">
            <p className="text-text-secondary text-xs uppercase tracking-wider mb-1.5">Calibration Samples</p>
            {Object.entries(health.calibration_samples).map(([sym, count]) => (
              <div key={sym} className="flex items-center justify-between text-xs py-0.5">
                <span className="text-white font-mono">{sym}</span>
                <span className={cn('font-mono', count >= 8 ? 'text-success' : 'text-text-secondary')}>
                  {count} signal{count !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
            <p className="text-text-secondary text-xs mt-2 leading-relaxed">
              Calibration kicks in at 8 closed signals per band. Below that, the heuristic floor applies.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
