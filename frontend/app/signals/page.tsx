'use client';
import DashboardLayout from '@/components/layout/DashboardLayout';
import ErrorBoundary from '@/components/layout/ErrorBoundary';
import SignalCard from '@/components/signals/SignalCard';
import AIAnalysis from '@/components/signals/AIAnalysis';
import IndicatorPanel from '@/components/signals/IndicatorPanel';
import ConfidenceBar from '@/components/signals/ConfidenceBar';
import SignalPerformance from '@/components/signals/SignalPerformance';
import { useSignals } from '@/hooks/useSignals';
import { RefreshCw } from 'lucide-react';

export default function SignalsPage() {
  const { signal, indicators, analysis, loading, analysisLoading, refresh, refreshAnalysis } = useSignals();

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold">Trading Signals</h1>
          <p className="text-text-secondary text-sm">AI-powered EUR/USD analysis</p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-2 px-4 py-2 bg-card border border-border text-text-secondary hover:text-white hover:border-zinc-600 rounded-lg text-sm transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-card border border-border rounded-xl p-6 animate-pulse h-40" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
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
        </div>
      )}
    </DashboardLayout>
  );
}
