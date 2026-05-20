'use client';
import { useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import AuthGuard from './AuthGuard';
import TradeAlertsPanel from './TradeAlertsPanel';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <AuthGuard>
      <div className="min-h-screen bg-background flex">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="flex-1 flex flex-col min-w-0 lg:ml-0">
          <Header onMenuClick={() => setSidebarOpen(true)} />
          <main className="flex-1 p-4 md:p-6 overflow-auto">
            {children}
          </main>
        </div>
        {/* Floating trade-alerts panel — appears on every authenticated page.
            Stays out of the way until the user has open trades that need
            attention; then it surfaces with severity-appropriate prominence. */}
        <TradeAlertsPanel />
      </div>
    </AuthGuard>
  );
}
