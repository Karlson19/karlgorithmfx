'use client';
import { useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import ErrorBoundary from '@/components/layout/ErrorBoundary';
import SignalCard from '@/components/signals/SignalCard';
import AIAnalysis from '@/components/signals/AIAnalysis';
import IndicatorPanel from '@/components/signals/IndicatorPanel';
import ConfidenceBar from '@/components/signals/ConfidenceBar';
import SignalPerformance from '@/components/signals/SignalPerformance';
import StrategyPerformance from '@/components/signals/StrategyPerformance';
import PairSelector from '@/components/dashboard/PairSelector';
import MultiPairOverview from '@/components/dashboard/MultiPairOverview';
import MarketFocus from '@/components/dashboard/MarketFocus';
import CurrencyStrength from '@/components/dashboard/CurrencyStrength';
import TradingChart from '@/components/dashboard/TradingChart';
import CollapsibleSection from '@/components/layout/CollapsibleSection';
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
        {/* Market focus — what's alive RIGHT NOW. Tops the page so the
            trader always sees session + news context first. */}
        <ErrorBoundary>
          <MarketFocus />
        </ErrorBoundary>

        {/* Currency strength — directional bias across all currencies */}
        <ErrorBoundary>
          <CurrencyStrength />
        </ErrorBoundary>

        {/* Multi-pair scoreboard — click a row to drill in */}
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
            {/* Chart with live signal levels overlaid */}
            <ErrorBoundary>
              <TradingChart symbol={selectedPair} signal={signal} indicators={indicators} />
            </ErrorBoundary>

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

            {/* Heavier panels — collapsible so the page doesn't become a wall.
                User's open/closed state persists per panel via localStorage. */}
            <CollapsibleSection
              title="AI Analysis"
              subtitle="LLM-generated read of the current setup"
              storageKey="signals-ai"
              defaultOpen={true}
            >
              <div className="p-5">
                <ErrorBoundary>
                  <AIAnalysis
                    analysis={analysis}
                    loading={analysisLoading}
                    onRefresh={refreshAnalysis}
                  />
                </ErrorBoundary>
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Strategy Performance"
              subtitle="Per-strategy win rates from your actual signal history"
              storageKey="signals-strategy-perf"
              defaultOpen={false}
            >
              <div className="p-5">
                <ErrorBoundary>
                  <StrategyPerformance />
                </ErrorBoundary>
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Signal Performance"
              subtitle="Calibration data — historical win rates by pair and confidence band"
              storageKey="signals-performance"
              defaultOpen={false}
            >
              <div className="p-5">
                <ErrorBoundary>
                  <SignalPerformance />
                </ErrorBoundary>
              </div>
            </CollapsibleSection>

            {indicators && (
              <CollapsibleSection
                title="Indicator Detail"
                subtitle="Every indicator, every value, every signal"
                storageKey="signals-indicators"
                defaultOpen={false}
              >
                <div className="p-5">
                  <ErrorBoundary>
                    <IndicatorPanel indicators={indicators} />
                  </ErrorBoundary>
                </div>
              </CollapsibleSection>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
