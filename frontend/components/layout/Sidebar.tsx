'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Target, BookOpen, Calculator, Newspaper, Settings, LogOut, TrendingUp, X, Activity } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTradeAlerts } from '@/hooks/useTradeAlerts';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/signals', label: 'Signals', icon: Target },
  { href: '/monitor', label: 'Monitor', icon: Activity },
  { href: '/journal', label: 'Journal', icon: BookOpen },
  { href: '/calculator', label: 'Calculator', icon: Calculator },
  { href: '/news', label: 'News', icon: Newspaper },
];

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { signOut } = useAuth();
  // Surface a live alert count on the Monitor nav item so the user knows
  // when an open trade needs attention without opening the page.
  const { alerts } = useTradeAlerts();
  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const alertCount = alerts.length;

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={onClose} />
      )}

      {/* Sidebar */}
      <aside className={cn(
        'fixed top-0 left-0 h-full w-64 bg-card border-r border-border z-40 flex flex-col',
        'transition-transform duration-200',
        'lg:translate-x-0 lg:static lg:z-auto',
        open ? 'translate-x-0' : '-translate-x-full'
      )}>
        {/* Logo */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-accent" />
            <span className="font-bold text-white text-lg tracking-tight">KarlFX</span>
          </div>
          <button onClick={onClose} className="lg:hidden text-text-secondary hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                pathname === href
                  ? 'bg-accent/10 text-accent border border-accent/20'
                  : 'text-text-secondary hover:text-white hover:bg-white/5'
              )}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              <span className="flex-1">{label}</span>
              {/* Live alert badge on the Monitor item */}
              {href === '/monitor' && alertCount > 0 && (
                <span className={cn(
                  'text-xs font-bold px-1.5 py-0.5 rounded-full min-w-5 text-center',
                  criticalCount > 0 ? 'bg-danger text-white' : 'bg-yellow-400 text-black'
                )}>
                  {alertCount}
                </span>
              )}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-border space-y-1">
          <Link
            href="/settings"
            onClick={onClose}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
              pathname === '/settings'
                ? 'bg-accent/10 text-accent'
                : 'text-text-secondary hover:text-white hover:bg-white/5'
            )}
          >
            <Settings className="w-5 h-5" />
            Settings
          </Link>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-text-secondary hover:text-danger hover:bg-danger/5 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Logout
          </button>
        </div>
      </aside>
    </>
  );
}
