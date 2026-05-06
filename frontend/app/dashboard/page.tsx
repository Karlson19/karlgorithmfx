'use client';
import DashboardLayout from '@/components/layout/DashboardLayout';
import PriceDisplay from '@/components/dashboard/PriceDisplay';
import TradingChart from '@/components/dashboard/TradingChart';
import SessionIndicator from '@/components/dashboard/SessionIndicator';
import MarketCondition from '@/components/dashboard/MarketCondition';
import QuickSignal from '@/components/dashboard/QuickSignal';
import IndicatorRow from '@/components/dashboard/IndicatorRow';
import { useSignals } from '@/hooks/useSignals';
import { useEffect, useState } from 'react';
import { NewsItem } from '@/types';
import api from '@/lib/api';
import { AlertTriangle } from 'lucide-react';

export default function DashboardPage() {
  const { signal, indicators, loading } = useSignals();
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
      {highImpactNear && (
        <div className="mb-4 flex items-center gap-3 bg-danger/10 border border-danger/30 text-danger rounded-xl px-4 py-3 text-sm">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span>High impact news within 1 hour — Consider reducing lot size or waiting for the release.</span>
        </div>
      )}

      {/* Price + Sessions + Condition */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-1">
          <PriceDisplay />
        </div>
        <div className="space-y-4">
          <SessionIndicator />
          <MarketCondition condition={indicators?.market_condition} />
        </div>
        <div>
          <QuickSignal signal={signal} loading={loading} />
        </div>
      </div>

      {/* Chart */}
      <div className="mb-4">
        <TradingChart indicators={indicators} />
      </div>

      {/* Indicators row */}
      <IndicatorRow indicators={indicators} loading={loading} />
    </DashboardLayout>
  );
}
