'use client';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import NewsCard from '@/components/news/NewsCard';
import { NewsItem } from '@/types';
import api from '@/lib/api';
import { AlertTriangle, RefreshCw } from 'lucide-react';

type FilterCurrency = 'ALL' | 'EUR' | 'USD';
type FilterImpact = 'ALL' | 'HIGH';

export default function NewsPage() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [highImpactNear, setHighImpactNear] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currencyFilter, setCurrencyFilter] = useState<FilterCurrency>('ALL');
  const [impactFilter, setImpactFilter] = useState<FilterImpact>('ALL');

  const fetchNews = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getNews();
      setNews(data.news || []);
      setHighImpactNear(data.has_high_impact_nearby || false);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchNews(); }, [fetchNews]);

  const filtered = news
    .filter(n => currencyFilter === 'ALL' || n.currency === currencyFilter)
    .filter(n => impactFilter === 'ALL' || n.impact === impactFilter);

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-white text-2xl font-bold">Economic Calendar</h1>
          <p className="text-text-secondary text-sm">EUR/USD news events and releases</p>
        </div>
        <button
          onClick={fetchNews}
          className="flex items-center gap-2 px-3 py-2 bg-card border border-border text-text-secondary hover:text-white rounded-lg text-sm"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {highImpactNear && (
        <div className="mb-4 flex items-center gap-3 bg-danger/10 border border-danger/30 text-danger rounded-xl px-4 py-3 text-sm">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span>⚠️ High impact news within 1 hour — Consider reducing lot size or waiting</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap mb-5">
        {(['ALL', 'EUR', 'USD'] as FilterCurrency[]).map(c => (
          <button
            key={c}
            onClick={() => setCurrencyFilter(c)}
            className={`px-4 py-1.5 rounded-full text-sm border transition-colors ${
              currencyFilter === c
                ? 'bg-accent/10 border-accent text-accent font-medium'
                : 'border-border text-text-secondary hover:text-white hover:border-zinc-600'
            }`}
          >
            {c === 'ALL' ? 'All Currencies' : c === 'EUR' ? '🇪🇺 EUR' : '🇺🇸 USD'}
          </button>
        ))}
        <button
          onClick={() => setImpactFilter(impactFilter === 'HIGH' ? 'ALL' : 'HIGH')}
          className={`px-4 py-1.5 rounded-full text-sm border transition-colors ${
            impactFilter === 'HIGH'
              ? 'bg-danger/10 border-danger text-danger font-medium'
              : 'border-border text-text-secondary hover:text-white hover:border-zinc-600'
          }`}
        >
          🔴 High Impact Only
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse h-24" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <p className="text-text-secondary">No news events match your filter.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(item => <NewsCard key={item.id} item={item} />)}
        </div>
      )}
    </DashboardLayout>
  );
}
