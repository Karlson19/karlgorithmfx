'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { TradeAlert, TradeAlertsResponse } from '@/types';
import api from '@/lib/api';
import { useAuth } from './useAuth';

// ─── useTradeAlerts ──────────────────────────────────────────────────────────
// Polls /api/journal/alerts every 30s for the signed-in user.
// Auto-pauses when the tab is hidden (no point hammering the backend if the
// user isn't looking — alerts will refresh the moment the tab comes back).
// Fires native browser notifications for CRITICAL alerts when permission
// is granted, even when the tab is in the background.

const POLL_INTERVAL_MS = 30_000;

export function useTradeAlerts() {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<TradeAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const seenAlertIds = useRef<Set<string>>(new Set());
  const dismissedIds = useRef<Set<string>>(new Set());

  const fetchAlerts = useCallback(async () => {
    if (!user) {
      setAlerts([]);
      return;
    }
    setLoading(true);
    try {
      const data: TradeAlertsResponse = await api.getTradeAlerts();
      const incoming = data.alerts || [];

      // Fire browser notifications for any NEW critical alerts
      if (typeof window !== 'undefined' && 'Notification' in window
          && Notification.permission === 'granted') {
        for (const a of incoming) {
          if (a.severity !== 'critical') continue;
          if (seenAlertIds.current.has(a.id)) continue;
          try {
            new Notification(a.title, {
              body: a.message,
              tag: a.id, // dedupe
              icon: '/favicon.ico',
              requireInteraction: true,
            });
          } catch { /* permission revoked mid-session, ignore */ }
        }
      }

      // Track which alerts we've seen so we only fire each notification once
      for (const a of incoming) seenAlertIds.current.add(a.id);
      // Filter out user-dismissed alerts (in-session — they re-appear after
      // the page reload because the underlying condition is still true)
      const visible = incoming.filter(a => !dismissedIds.current.has(a.id));
      setAlerts(visible);
    } catch {
      // Stay quiet — backend down shouldn't spam the UI with errors
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Polling — paused while tab hidden
  useEffect(() => {
    if (!user) return;
    fetchAlerts();
    let id: ReturnType<typeof setInterval> | null = null;

    function start() {
      if (id != null) return;
      id = setInterval(fetchAlerts, POLL_INTERVAL_MS);
    }
    function stop() {
      if (id != null) clearInterval(id);
      id = null;
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') {
        fetchAlerts();
        start();
      } else stop();
    }

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, fetchAlerts]);

  // Dismiss an alert in-session. It comes back on the next poll IF the
  // underlying condition is still true (which is the point — you can't
  // permanently silence a real risk).
  const dismiss = useCallback((alertId: string) => {
    dismissedIds.current.add(alertId);
    setAlerts(prev => prev.filter(a => a.id !== alertId));
  }, []);

  return { alerts, loading, refetch: fetchAlerts, dismiss };
}

// Request browser notification permission. Should be called from a user
// gesture (button click) to comply with browser autoplay/permission rules.
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return await Notification.requestPermission();
}
