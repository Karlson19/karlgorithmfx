'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { TradeAlert, TradeAlertSeverity } from '@/types';
import { useTradeAlerts, requestNotificationPermission } from '@/hooks/useTradeAlerts';
import { subscribeToPush } from '@/lib/push';
import { cn } from '@/lib/utils';
import { formatPairPrice, getPair } from '@/lib/pairs';
import {
  AlertOctagon, AlertTriangle, Info, X, ChevronUp, ChevronDown, BellRing, BellOff,
  TrendingDown, Target, Zap, Newspaper, Hourglass, Trophy,
} from 'lucide-react';

// ─── TradeAlertsPanel ────────────────────────────────────────────────────────
// Floating panel anchored bottom-right (mobile: bottom-full). Shows real-time
// risk alerts for the user's open trades. The panel auto-expands when a new
// CRITICAL alert fires, otherwise stays compact with a badge showing the
// alert count.
//
// This is the difference between "the algo gave me an entry and abandoned
// me" and "the system is watching with me." Lives in DashboardLayout so it
// appears on every authenticated page — including Settings and Calculator,
// because risk doesn't sleep when you're tweaking other settings.

const ALERT_ICON: Record<string, typeof Info> = {
  PROFIT_GIVEBACK:    TrendingDown,
  MOVE_TO_BREAKEVEN:  Target,
  TP1_HIT:            Trophy,
  DANGEROUS_SESSION:  Hourglass,
  VOLATILITY_SPIKE:   Zap,
  HIGH_NEWS_INCOMING: Newspaper,
  STOP_TOO_FAR:       AlertTriangle,
};

const SEVERITY_STYLES: Record<TradeAlertSeverity, { bg: string; text: string; border: string; Icon: typeof Info }> = {
  critical: { bg: 'bg-danger/10',      text: 'text-danger',      border: 'border-danger/40',      Icon: AlertOctagon },
  warning:  { bg: 'bg-yellow-400/10',  text: 'text-yellow-400',  border: 'border-yellow-400/40',  Icon: AlertTriangle },
  info:     { bg: 'bg-accent/10',      text: 'text-accent',      border: 'border-accent/30',      Icon: Info },
};

function AlertCard({ alert, onDismiss }: { alert: TradeAlert; onDismiss: (id: string) => void }) {
  const sev = SEVERITY_STYLES[alert.severity];
  const TypeIcon = ALERT_ICON[alert.type] || sev.Icon;
  const pair = getPair(alert.symbol);

  return (
    <div className={cn(
      'border rounded-lg p-3 space-y-1.5',
      sev.bg, sev.border,
      alert.severity === 'critical' && 'ring-2 ring-danger/30 animate-pulse-slow',
    )}>
      <div className="flex items-start gap-2">
        <TypeIcon className={cn('w-4 h-4 flex-shrink-0 mt-0.5', sev.text)} />
        <div className="flex-1 min-w-0">
          <p className={cn('text-xs font-bold', sev.text)}>{alert.title}</p>
          <p className="text-text-secondary text-xs mt-0.5 leading-relaxed">{alert.message}</p>
        </div>
        <button
          onClick={() => onDismiss(alert.id)}
          className="text-text-secondary hover:text-white p-0.5 flex-shrink-0"
          title="Dismiss (reappears if condition persists)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* P&L context */}
      {(alert.current_pnl != null || alert.peak_pnl != null) && (
        <div className="flex items-center gap-3 text-xs font-mono pl-6">
          {alert.current_pnl != null && (
            <span className={alert.current_pnl >= 0 ? 'text-success' : 'text-danger'}>
              now: {alert.current_pnl >= 0 ? '+' : ''}${alert.current_pnl.toFixed(2)}
            </span>
          )}
          {alert.peak_pnl != null && (
            <span className="text-text-secondary">peak: ${alert.peak_pnl.toFixed(2)}</span>
          )}
        </div>
      )}

      {/* Suggested action button */}
      {alert.suggested_sl != null && (
        <div className="flex items-center justify-between pl-6 gap-2">
          <span className="text-xs text-text-secondary">
            Suggest SL → <span className="font-mono text-white">{formatPairPrice(alert.symbol, alert.suggested_sl)}</span>
          </span>
          <Link
            href="/journal"
            className={cn('text-xs px-2 py-1 rounded border font-semibold transition-colors',
              sev.border, sev.text, 'hover:bg-white/5'
            )}
          >
            Open trade →
          </Link>
        </div>
      )}

      <p className="text-text-secondary/70 text-[10px] font-mono pl-6">
        {pair.display_name} · {alert.type.replace(/_/g, ' ').toLowerCase()}
      </p>
    </div>
  );
}

export default function TradeAlertsPanel() {
  const { alerts, dismiss } = useTradeAlerts();
  const [collapsed, setCollapsed] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>('default');

  // Check current permission on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotifPermission(Notification.permission);
    }
  }, []);

  // Auto-expand when a new critical alert lands
  useEffect(() => {
    if (alerts.some(a => a.severity === 'critical')) setCollapsed(false);
  }, [alerts]);

  async function handleEnableNotifications() {
    const result = await requestNotificationPermission();
    setNotifPermission(result);
    // After permission, register the background push subscription so alerts
    // fire even when the app is closed / phone locked.
    if (result === 'granted') {
      await subscribeToPush();
    }
  }

  if (alerts.length === 0) return null;

  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const warningCount = alerts.filter(a => a.severity === 'warning').length;
  const infoCount = alerts.filter(a => a.severity === 'info').length;

  return (
    <div className={cn(
      'fixed z-40 flex flex-col',
      // Mobile: full-width bottom sheet; sm+: anchored bottom-right card
      'inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[380px] sm:max-w-[calc(100vw-2rem)]',
    )}>
      <div className={cn(
        'bg-card border border-border shadow-2xl',
        'sm:rounded-xl rounded-t-2xl',
        collapsed ? 'overflow-hidden' : 'max-h-[70vh] flex flex-col'
      )}>
        {/* Header */}
        <button
          onClick={() => setCollapsed(v => !v)}
          className={cn('w-full flex items-center gap-2 px-4 py-3 border-b border-border',
            criticalCount > 0 ? 'bg-danger/5' : warningCount > 0 ? 'bg-yellow-400/5' : 'bg-background/30',
          )}
        >
          {criticalCount > 0 ? (
            <AlertOctagon className="w-5 h-5 text-danger animate-pulse" />
          ) : warningCount > 0 ? (
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
          ) : (
            <Info className="w-5 h-5 text-accent" />
          )}
          <div className="flex-1 text-left min-w-0">
            <p className="text-white font-bold text-sm">
              {criticalCount > 0 && <span className="text-danger">{criticalCount} critical</span>}
              {criticalCount > 0 && (warningCount + infoCount) > 0 && <span className="text-text-secondary"> · </span>}
              {warningCount > 0 && <span className="text-yellow-400">{warningCount} warning{warningCount !== 1 && 's'}</span>}
              {warningCount > 0 && infoCount > 0 && <span className="text-text-secondary"> · </span>}
              {infoCount > 0 && <span className="text-accent">{infoCount} info</span>}
            </p>
            <p className="text-text-secondary text-xs">Open trades monitor</p>
          </div>
          {collapsed ? <ChevronUp className="w-4 h-4 text-text-secondary" /> : <ChevronDown className="w-4 h-4 text-text-secondary" />}
        </button>

        {/* Notification permission CTA — shown once if not granted */}
        {!collapsed && notifPermission === 'default' && (
          <div className="px-4 py-2.5 bg-accent/5 border-b border-border flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <BellRing className="w-4 h-4 text-accent flex-shrink-0" />
              <p className="text-xs text-text-secondary">Get notified even when this tab is in the background</p>
            </div>
            <button
              onClick={handleEnableNotifications}
              className="text-xs font-semibold px-2.5 py-1 bg-accent text-black rounded hover:bg-accent/90 flex-shrink-0"
            >
              Enable
            </button>
          </div>
        )}
        {!collapsed && notifPermission === 'denied' && (
          <div className="px-4 py-2 bg-border/30 border-b border-border flex items-center gap-2">
            <BellOff className="w-3.5 h-3.5 text-text-secondary" />
            <p className="text-xs text-text-secondary">Browser notifications blocked. Enable in site settings to get critical alerts in background.</p>
          </div>
        )}

        {/* Alerts list */}
        {!collapsed && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {/* Critical first, then warning, then info */}
            {(['critical', 'warning', 'info'] as TradeAlertSeverity[]).flatMap(sev =>
              alerts.filter(a => a.severity === sev).map(a => (
                <AlertCard key={a.id} alert={a} onDismiss={dismiss} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
