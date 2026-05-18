'use client';
import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import PriceDisplay from '@/components/dashboard/PriceDisplay';
import TradingChart from '@/components/dashboard/TradingChart';
import SessionIndicator from '@/components/dashboard/SessionIndicator';
import MarketCondition from '@/components/dashboard/MarketCondition';
import QuickSignal from '@/components/dashboard/QuickSignal';
import IndicatorRow from '@/components/dashboard/IndicatorRow';
import MarketFocus from '@/components/dashboard/MarketFocus';
import MultiPairOverview from '@/components/dashboard/MultiPairOverview';
import PairSelector from '@/components/dashboard/PairSelector';
import { useSignals } from '@/hooks/useSignals';
import { PRIMARY_SYMBOL } from '@/lib/pairs';
import { NewsItem } from '@/types';
import api from '@/lib/api';
import { AlertTriangle } from 'lucide-react';

export default function DashboardPage() {
  const [selectedPair, setSelectedPair] = useState<string>(PRIMARY_SYMBOL);
  const { signal, indicators, loading } = useSignals(selectedPair);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [highImpactNear, setHighImpactNear] = useState(false);

  useEffect(() => {
    api.getNews().then(d => {
      setNews(d.news || []);
      setHighImpactNear(d.has_high_impact_nearby || false);
    }).catch(() => {});
  }, []);

  return (
    <DashboardLayout>
      {/* Pair selector — top-right, controls which pair the whole page reflects */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-white text-xl font-bold">Dashboard</h1>
          <p className="text-text-secondary text-xs">Real-time multi-pair overview</p>
        </div>
        <PairSelector value={selectedPair} onChange={setSelectedPair} />
      </div>

      {highImpactNear && (
        <div className="mb-4 flex items-center gap-3 bg-danger/10 border border-danger/30 text-danger rounded-xl px-4 py-3 text-sm">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span>High impact news within 1 hour — Consider reducing lot size or waiting for the release.</span>
        </div>
      )}

      {/* Market focus at the top so the user always sees session + news context */}
      <div className="mb-4">
        <MarketFocus />
      </div>

      {/* Multi-pair scoreboard */}
      <div className="mb-4">
        <MultiPairOverview onSelectPair={setSelectedPair} />
      </div>

      {/* Price + Sessions + Condition */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-1">
          <PriceDisplay symbol={selectedPair} />
        </div>
        <div className="space-y-4">
          <SessionIndicator />
          <MarketCondition condition={indicators?.market_condition} />
        </div>
        <div>
          <QuickSignal signal={signal} loading={loading} />
        </div>
      </div>

      {/* Chart — now bound to the selected pair AND the live signal so
          entry/SL/TP levels render right on the candles. */}
      <div className="mb-4">
        <TradingChart symbol={selectedPair} signal={signal} indicators={indicators} />
      </div>

      {/* Indicators row */}
      <IndicatorRow indicators={indicators} loading={loading} />
    </DashboardLayout>
  );
}
