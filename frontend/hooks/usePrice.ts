'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { PriceData } from '@/types';
import api from '@/lib/api';
import { getWebSocketClient } from '@/lib/websocket';

// usePrice(symbol?) — single-pair live price.
// Pass a symbol to track a non-primary pair (gold, yen, etc.). The websocket
// stream is shared across the app but only broadcasts the primary pair's
// updates; for non-primary symbols we fall back to polling every 2 minutes.
export function usePrice(symbol?: string) {
  const [price, setPrice] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prevPrice = useRef<number | null>(null);

  const fetchPrice = useCallback(async () => {
    try {
      const data = await api.getPrice(symbol);
      if (prevPrice.current !== null) {
        setFlash(data.price > prevPrice.current ? 'up' : 'down');
        setTimeout(() => setFlash(null), 600);
      }
      prevPrice.current = data.price;
      setPrice(data);
      setError(null);
    } catch {
      setError('Failed to fetch price');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    // Re-fetch immediately on symbol switch.
    setLoading(true);
    prevPrice.current = null;
    fetchPrice();

    const ws = getWebSocketClient();
    ws.connect();

    // WS only broadcasts the backend's PRIMARY pair. For non-primary pairs
    // we skip the WS handler and rely on the poll interval.
    const unsub = ws.onMessage((msg) => {
      if (msg.type !== 'PRICE_UPDATE') return;
      const data = msg.data as PriceData;
      // If we're tracking a specific symbol, ignore broadcasts for others.
      if (symbol && data.symbol && data.symbol !== symbol) return;
      if (prevPrice.current !== null) {
        setFlash(data.price > prevPrice.current ? 'up' : 'down');
        setTimeout(() => setFlash(null), 600);
      }
      prevPrice.current = data.price;
      setPrice(data);
      setLoading(false);
      setError(null);
    });

    // Poll every 2 minutes (matches backend cron rate).
    const interval = setInterval(() => fetchPrice(), 120000);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, [fetchPrice, symbol]);

  return { price, loading, error, flash, refetch: fetchPrice };
}
