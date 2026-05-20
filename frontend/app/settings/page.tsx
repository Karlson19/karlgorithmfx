'use client';
import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { useUserPrefs } from '@/hooks/useUserPrefs';
import { ENABLED_SYMBOLS, PAIRS } from '@/lib/pairs';
import { requestNotificationPermission } from '@/hooks/useTradeAlerts';
import { subscribeToPush, pushSupported, isStandalone, isIOS } from '@/lib/push';
import api from '@/lib/api';
import { Settings, LogOut, Check, Bell, BellRing, Share, PlusSquare } from 'lucide-react';

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const [prefs, setPrefs] = useUserPrefs();
  const [balance, setBalance]   = useState(String(prefs.account_balance));
  const [riskPct, setRiskPct]   = useState(String(prefs.default_risk_pct));
  const [defaultSym, setDefaultSym] = useState(prefs.default_symbol);
  const [maxDailyLoss, setMaxDailyLoss] = useState(String(prefs.max_daily_loss_usd));
  const [maxOpenPositions, setMaxOpenPositions] = useState(String(prefs.max_concurrent_positions));
  const [saved, setSaved] = useState(false);

  // ── Notification / push state ──────────────────────────────────────────────
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>('default');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState('');
  const [standalone, setStandalone] = useState(false);
  const [supported, setSupported] = useState(true);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) setNotifPerm(Notification.permission);
    setStandalone(isStandalone());
    setSupported(pushSupported());
    setIos(isIOS());
  }, []);

  async function enablePush() {
    setPushBusy(true);
    setPushMsg('');
    try {
      const perm = await requestNotificationPermission();
      setNotifPerm(perm);
      if (perm !== 'granted') { setPushMsg('Permission was not granted.'); return; }
      const res = await subscribeToPush();
      if (res.ok) setPushMsg('Push enabled on this device ✓');
      else if (res.reason === 'no-vapid-key') setPushMsg('Server push keys not configured yet.');
      else setPushMsg('Could not enable push: ' + (res.reason || 'unknown'));
    } finally {
      setPushBusy(false);
    }
  }

  async function testPush() {
    setPushBusy(true);
    setPushMsg('');
    try {
      const res = await api.sendTestPush();
      setPushMsg(res?.sent > 0 ? 'Test sent — check your notifications.' : 'No subscription found on the server. Tap Enable first.');
    } catch {
      setPushMsg('Test failed.');
    } finally {
      setPushBusy(false);
    }
  }

  function handleSave() {
    const bal = parseFloat(balance);
    const risk = parseFloat(riskPct);
    if (!isFinite(bal) || bal <= 0) return;
    if (!isFinite(risk) || risk <= 0 || risk > 10) return;
    const mdl = parseFloat(maxDailyLoss);
    const mop = parseInt(maxOpenPositions);
    setPrefs({
      account_balance: bal,
      default_risk_pct: risk,
      default_symbol: defaultSym,
      max_daily_loss_usd: isFinite(mdl) && mdl >= 0 ? mdl : 0,
      max_concurrent_positions: isFinite(mop) && mop >= 0 ? mop : 0,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-white text-2xl font-bold">Settings</h1>
        <p className="text-text-secondary text-sm">
          Stored locally on this device — Risk Calculator and Trade Form pre-fill from these
        </p>
      </div>

      <div className="max-w-lg space-y-4">
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Settings className="w-5 h-5 text-accent" />
            <h2 className="text-white font-bold">Trading Preferences</h2>
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
              <p className="text-text-secondary text-xs mt-1">Used by Risk Calculator + Trade Form lot suggester.</p>
            </div>
            <div>
              <label className="text-text-secondary text-sm mb-1 block">Default Risk Per Trade (%)</label>
              <input
                type="number" step="0.25" min="0.25" max="5"
                value={riskPct}
                onChange={e => setRiskPct(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-white font-mono focus:border-accent outline-none"
              />
              <p className="text-text-secondary text-xs mt-1">Most disciplined traders stay under 2%.</p>
            </div>
            <div>
              <label className="text-text-secondary text-sm mb-1 block">Default Pair</label>
              <select
                value={defaultSym}
                onChange={e => setDefaultSym(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-white text-sm focus:border-accent outline-none"
              >
                {ENABLED_SYMBOLS.map(s => <option key={s} value={s}>{PAIRS[s].display_name}</option>)}
              </select>
              <p className="text-text-secondary text-xs mt-1">Which pair loads first on the dashboard / signals pages.</p>
            </div>
            {/* ── Risk circuit-breakers ── */}
            <div className="pt-3 border-t border-border space-y-4">
              <div>
                <p className="text-white font-semibold text-sm">Risk Protection</p>
                <p className="text-text-secondary text-xs mt-0.5">
                  Hard limits enforced by the backend before logging a new trade. Set to 0 to disable.
                </p>
              </div>
              <div>
                <label className="text-text-secondary text-sm mb-1 block">Max Daily Loss (USD)</label>
                <input
                  type="number" min="0" step="10"
                  value={maxDailyLoss}
                  onChange={e => setMaxDailyLoss(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-white font-mono focus:border-accent outline-none"
                />
                <p className="text-text-secondary text-xs mt-1">
                  When today&apos;s closed-trade P&amp;L hits -$X, new trades are blocked until UTC midnight. Typical: 2-3% of balance.
                </p>
              </div>
              <div>
                <label className="text-text-secondary text-sm mb-1 block">Max Concurrent Positions</label>
                <input
                  type="number" min="0" step="1"
                  value={maxOpenPositions}
                  onChange={e => setMaxOpenPositions(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-white font-mono focus:border-accent outline-none"
                />
                <p className="text-text-secondary text-xs mt-1">
                  Refuses to log a new trade if you already have N open. Typical: 2-3 to avoid overexposure.
                </p>
              </div>
            </div>

            <div>
              <label className="text-text-secondary text-sm mb-1 block">Logged In As</label>
              <p className="text-white">{user?.email || 'Not signed in'}</p>
            </div>
            <button
              onClick={handleSave}
              className="w-full bg-accent text-black font-bold py-2.5 rounded-lg hover:bg-accent/90 transition-colors flex items-center justify-center gap-2"
            >
              {saved ? <><Check className="w-4 h-4" /> Saved</> : 'Save Settings'}
            </button>
          </div>
        </div>

        {/* ── Notifications / Push ── */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Bell className="w-5 h-5 text-accent" />
            <h2 className="text-white font-bold">Push Notifications</h2>
          </div>

          {!supported ? (
            <p className="text-text-secondary text-sm">
              This browser doesn&apos;t support push notifications.
            </p>
          ) : (
            <div className="space-y-4">
              <p className="text-text-secondary text-sm">
                Get alerted on this device when an open trade reverses from profit, enters a dangerous
                session (e.g. Gold in Asian hours), nears your TP, or has news incoming — even when the
                app is closed.
              </p>

              {/* iOS install requirement */}
              {ios && !standalone && (
                <div className="px-3 py-3 bg-yellow-400/10 border border-yellow-400/30 rounded-lg text-xs space-y-1.5">
                  <p className="text-yellow-400 font-semibold flex items-center gap-1.5">
                    <PlusSquare className="w-4 h-4" /> Install to Home Screen first
                  </p>
                  <p className="text-text-secondary">
                    On iPhone, push only works after you add KarlFX to your home screen:
                  </p>
                  <p className="text-text-secondary flex items-center gap-1">
                    Tap <Share className="w-3.5 h-3.5 inline" /> Share → <span className="text-white">Add to Home Screen</span> → open KarlFX from the new icon → come back here and tap Enable.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={enablePush}
                  disabled={pushBusy || (ios && !standalone)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-accent text-black font-bold rounded-lg hover:bg-accent/90 transition-colors text-sm disabled:opacity-50"
                >
                  <BellRing className="w-4 h-4" />
                  {notifPerm === 'granted' ? 'Re-enable on this device' : 'Enable Notifications'}
                </button>
                {notifPerm === 'granted' && (
                  <button
                    onClick={testPush}
                    disabled={pushBusy}
                    className="flex items-center gap-2 px-4 py-2.5 border border-border text-text-secondary rounded-lg hover:text-white hover:border-zinc-600 transition-colors text-sm disabled:opacity-50"
                  >
                    Send test
                  </button>
                )}
              </div>

              <div className="text-xs space-y-1">
                <p className="text-text-secondary">
                  Status: <span className={notifPerm === 'granted' ? 'text-success' : notifPerm === 'denied' ? 'text-danger' : 'text-yellow-400'}>
                    {notifPerm === 'granted' ? 'enabled' : notifPerm === 'denied' ? 'blocked (enable in browser site settings)' : 'not enabled'}
                  </span>
                  {standalone && <span className="text-success ml-2">· installed ✓</span>}
                </p>
                {pushMsg && <p className="text-accent">{pushMsg}</p>}
              </div>
            </div>
          )}
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
