'use client';
import { useEffect, useState, useCallback } from 'react';
import { Signal, Indicators, AIAnalysis, SignalsAllResponse } from '@/types';
import api from '@/lib/api';
import { getWebSocketClient } from '@/lib/websocket';

// useSignals(symbol?) — fetches signal + indicators + AI analysis for one
// pair. Pass the user's selected pair, or undefined for the backend default.
export function useSignals(symbol?: string) {
  const [signal, setSignal] = useState<Signal | null>(null);
  const [indicators, setIndicators] = useState<Indicators | null>(null);
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const [sig, ind] = await Promise.all([api.getSignal(symbol), api.getIndicators('1h', symbol)]);
      setSignal(sig);
      setIndicators(ind);
      setError(null);
    } catch {
      setError('Failed to fetch signals');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const [sig, ind] = await Promise.all([api.refreshSignal(symbol), api.getIndicators('1h', symbol)]);
      setSignal(sig);
      setIndicators(ind);
      setError(null);
    } catch {
      setError('Failed to refresh signals');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  const fetchAnalysis = useCallback(async () => {
    try {
      setAnalysisLoading(true);
      const data = await api.getAnalysis(symbol);
      setAnalysis(data);
    } catch {
      console.error('Analysis fetch failed');
    } finally {
      setAnalysisLoading(false);
    }
  }, [symbol]);

  const refreshAnalysis = useCallback(async () => {
    try {
      setAnalysisLoading(true);
      const data = await api.refreshAnalysis(symbol);
      setAnalysis(data);
    } catch {
      console.error('Analysis refresh failed');
    } finally {
      setAnalysisLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchAll();
    fetchAnalysis();

    const ws = getWebSocketClient();
    const unsub = ws.onMessage((msg) => {
      if (msg.type === 'SIGNAL_UPDATE') {
        const sig = msg.data as Signal;
        // Only adopt the broadcast if it's for the pair this hook is tracking
        // (or if we're tracking the backend default, which broadcasts come for).
        if (!symbol || !sig.symbol || sig.symbol === symbol) {
          setSignal(sig);
        }
      }
    });

    return () => unsub();
  }, [fetchAll, fetchAnalysis, symbol]);

  return {
    signal, indicators, analysis,
    loading, analysisLoading, error,
    refresh, refreshAnalysis,
  };
}

// useAllSignals — every enabled pair, ranked by opportunity score.
export function useAllSignals(intervalMs = 60_000) {
  const [data, setData] = useState<SignalsAllResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const out = await api.getAllSignals();
      setData(out);
      setError(null);
    } catch {
      setError('Failed to fetch multi-pair signals');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const out = await api.refreshAllSignals();
      setData(out);
      setError(null);
    } catch {
      setError('Failed to refresh multi-pair signals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();

    const ws = getWebSocketClient();
    const unsub = ws.onMessage((msg) => {
      if (msg.type === 'SIGNALS_ALL_UPDATE') {
        setData(msg.data as SignalsAllResponse);
      }
    });

    const interval = setInterval(fetchAll, intervalMs);
    return () => {
      unsub();
      clearInterval(interval);
    };
  }, [fetchAll, intervalMs]);

  return { data, loading, error, refresh };
}
