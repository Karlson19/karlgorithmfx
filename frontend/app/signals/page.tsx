'use client';
import { useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import ErrorBoundary from '@/components/layout/ErrorBoundary';
import SignalCard from '@/components/signals/SignalCard';
import AIAnalysis from '@/components/signals/AIAnalysis';
import IndicatorPanel from '@/components/signals/IndicatorPanel';
import ConfidenceBar from '@/components/signals/ConfidenceBar';
import SignalPerformance from '@/components/signals/SignalPerformance';
import PairSelector from '@/components/dashboard/PairSelector';
import MultiPairOverview from '@/components/dashboard/MultiPairOverview';
import { useSignals } from '@/hooks/useSignals';
import { PRIMARY_SYMBOL } from '@/lib/pairs';
import { RefreshCw } from 'lucide-react';

export default function SignalsPage() {
  // Selected pair persists in component state. Changing it re-fires every
  // pair-scoped hook (useSignals) so the cards/AI/indicators refresh.
  const [selectedPair, setSelectedPair] = useState<string>(PRIMARY_SYMBOL);
  const { signal, indicators, analysis, loading, analysisLoading, refresh, refreshAnalysis } =
    useSignals(selectedPair);

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-white text-2xl font-bold">Trading Signals</h1>
          <p className="text-text-secondary text-sm">AI-powered multi-pair analysis · {signal?.display_name || selectedPair}</p>
        </div>
        <div className="flex items-center gap-2">
          <PairSelector value={selectedPair} onChange={setSelectedPair} />
          <button
            onClick={refresh}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border text-text-secondary hover:text-white hover:border-zinc-600 rounded-lg text-sm transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Multi-pair scoreboard — always at the top, click a row to drill in */}
        <ErrorBoundary>
          <MultiPairOverview onSelectPair={setSelectedPair} />
        </ErrorBoundary>

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-card border border-border rounded-xl p-6 animate-pulse h-40" />
            ))}
          </div>
        ) : (
          <>
            {/* Signal + Confidence */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {signal && (
                <ErrorBoundary>
                  <SignalCard signal={signal} />
                </ErrorBoundary>
              )}
              {signal && (
                <ErrorBoundary>
                  <ConfidenceBar
                    confidence={signal.confidence}
                    agreeing={signal.indicators_agreeing}
                    total={signal.total_indicators}
                  />
                </ErrorBoundary>
              )}
            </div>

            {/* AI Analysis */}
            <ErrorBoundary>
              <AIAnalysis
                analysis={analysis}
                loading={analysisLoading}
                onRefresh={refreshAnalysis}
              />
            </ErrorBoundary>

            {/* Signal Performance */}
            <ErrorBoundary>
              <SignalPerformance />
            </ErrorBoundary>

            {/* Indicators */}
            {indicators && (
              <ErrorBoundary>
                <IndicatorPanel indicators={indicators} />
              </ErrorBoundary>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
