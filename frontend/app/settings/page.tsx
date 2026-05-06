'use client';
import { useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { Settings, LogOut } from 'lucide-react';

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const [balance, setBalance] = useState('10000');
  const [riskPct, setRiskPct] = useState('1.0');
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-white text-2xl font-bold">Settings</h1>
        <p className="text-text-secondary text-sm">Configure your trading preferences</p>
      </div>

      <div className="max-w-lg space-y-4">
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Settings className="w-5 h-5 text-accent" />
            <h2 className="text-white font-bold">Account Settings</h2>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-text-secondary text-sm mb-1 block">Account Balance (USD)</label>
              <input
                type="number"
                value={balance}
                onChange={e => setBalance(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-white font-mono focus:border-accent outline-none"
              />
            </div>
            <div>
              <label className="text-text-secondary text-sm mb-1 block">Default Risk Percentage</label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="5"
                value={riskPct}
                onChange={e => setRiskPct(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-white font-mono focus:border-accent outline-none"
              />
            </div>
            <div>
              <label className="text-text-secondary text-sm mb-1 block">Logged In As</label>
              <p className="text-white">{user?.email}</p>
            </div>
            <button
              onClick={handleSave}
              className="w-full bg-accent text-black font-bold py-2.5 rounded-lg hover:bg-accent/90 transition-colors"
            >
              {saved ? 'Saved!' : 'Save Settings'}
            </button>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-white font-bold mb-4">Account</h2>
          <button
            onClick={signOut}
            className="flex items-center gap-2 px-4 py-2.5 bg-danger/10 border border-danger/30 text-danger rounded-lg hover:bg-danger/20 transition-colors text-sm font-medium"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}
