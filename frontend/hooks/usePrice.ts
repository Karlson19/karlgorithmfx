'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { PriceData } from '@/types';
import api from '@/lib/api';
import { getWebSocketClient } from '@/lib/websocket';

export function usePrice() {
  const [price, setPrice] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prevPrice = useRef<number | null>(null);

  const fetchPrice = useCallback(async () => {
    try {
      const data = await api.getPrice();
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
  }, []);

  useEffect(() => {
    fetchPrice();

    const ws = getWebSocketClient();
    ws.connect();

    const unsub = ws.onMessage((msg) => {
      if (msg.type === 'PRICE_UPDATE') {
        const data = msg.data as PriceData;
        if (prevPrice.current !== null) {
          setFlash(data.price > prevPrice.current ? 'up' : 'down');
          setTimeout(() => setFlash(null), 600);
        }
        prevPrice.current = data.price;
        setPrice(data);
        setLoading(false);
        setError(null);
      }
    });

    // Fallback polling every 30s if WS not connected
    const interval = setInterval(() => {
      if (!ws.isConnected) fetchPrice();
    }, 30000);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, [fetchPrice]);

  return { price, loading, error, flash, refetch: fetchPrice };
}
