'use client';
import { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import PerformanceStats from '@/components/journal/PerformanceStats';
import TradeTable from '@/components/journal/TradeTable';
import TradeForm from '@/components/journal/TradeForm';
import { Trade, TradeStats } from '@/types';
import api from '@/lib/api';
import { Plus } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';

export default function JournalPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any

  const fetchData = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([api.getTrades(), api.getTradeStats()]);
      setTrades(t);
      setStats(s);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Build cumulative P&L chart data
  const chartData = trades
    .filter(t => t.status === 'closed' && t.closed_at)
    .sort((a, b) => new Date(a.closed_at!).getTime() - new Date(b.closed_at!).getTime())
    .reduce<{ date: string; pnl: number }[]>((acc, t) => {
      const prev = acc.length > 0 ? acc[acc.length - 1].pnl : 0;
      acc.push({
        date: format(new Date(t.closed_at!), 'MMM d'),
        pnl: parseFloat((prev + (t.profit_loss || 0)).toFixed(2))
      });
      return acc;
    }, []);

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold">Trade Journal</h1>
          <p className="text-text-secondary text-sm">Track and analyse trades across all pairs · Signal-linked trades marked with ✨</p>
        </div>
        <button
          onClick={() => { setEditingTrade(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent text-black font-bold rounded-lg hover:bg-accent/90 text-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          Log Trade
        </button>
      </div>

      <div className="space-y-4">
        <PerformanceStats stats={stats} loading={loading} />

        {/* Cumulative P&L Chart */}
        {chartData.length > 1 && (
          <div className="bg-card border border-border rounded-xl p-6">
            <h3 className="text-white font-medium mb-4">Cumulative P&L</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <XAxis dataKey="date" tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: '#111111', border: '1px solid #1f1f1f', borderRadius: 8 }}
                  labelStyle={{ color: '#a1a1aa' }}
                  itemStyle={{ color: '#00d4aa' }}
                  formatter={(v: number) => [`$${v}`, 'P&L']}
                />
                <Line
                  type="monotone"
                  dataKey="pnl"
                  stroke="#00d4aa"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#00d4aa' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <TradeTable
          trades={trades}
          onRefresh={fetchData}
          onEdit={(t) => { setEditingTrade(t); setShowForm(true); }}
        />
      </div>

      {showForm && (
        <TradeForm
          trade={editingTrade}
          onClose={() => { setShowForm(false); setEditingTrade(null); }}
          onSave={() => { setShowForm(false); setEditingTrade(null); fetchData(); }}
        />
      )}
    </DashboardLayout>
  );
}
