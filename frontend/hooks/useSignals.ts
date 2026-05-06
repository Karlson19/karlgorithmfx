'use client';
import { useEffect, useState, useCallback } from 'react';
import { Signal, Indicators, AIAnalysis } from '@/types';
import api from '@/lib/api';
import { getWebSocketClient } from '@/lib/websocket';

export function useSignals() {
  const [signal, setSignal] = useState<Signal | null>(null);
  const [indicators, setIndicators] = useState<Indicators | null>(null);
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const [sig, ind] = await Promise.all([api.getSignal(), api.getIndicators()]);
      setSignal(sig);
      setIndicators(ind);
      setError(null);
    } catch {
      setError('Failed to fetch signals');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      // POST /refresh clears the cache and forces a full recalculation
      const [sig, ind] = await Promise.all([api.refreshSignal(), api.getIndicators()]);
      setSignal(sig);
      setIndicators(ind);
      setError(null);
    } catch {
      setError('Failed to refresh signals');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAnalysis = useCallback(async () => {
    try {
      setAnalysisLoading(true);
      const data = await api.getAnalysis();
      setAnalysis(data);
    } catch {
      console.error('Analysis fetch failed');
    } finally {
      setAnalysisLoading(false);
    }
  }, []);

  const refreshAnalysis = useCallback(async () => {
    try {
      setAnalysisLoading(true);
      const data = await api.refreshAnalysis();
      setAnalysis(data);
    } catch {
      console.error('Analysis refresh failed');
    } finally {
      setAnalysisLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    fetchAnalysis();

    const ws = getWebSocketClient();
    const unsub = ws.onMessage((msg) => {
      if (msg.type === 'SIGNAL_UPDATE') {
        setSignal(msg.data as Signal);
      }
    });

    return () => unsub();
  }, [fetchAll, fetchAnalysis]);

  return {
    signal, indicators, analysis,
    loading, analysisLoading, error,
    refresh, refreshAnalysis
  };
}
