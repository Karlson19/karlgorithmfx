'use client';
import { Menu, TrendingUp, TrendingDown, Wifi, WifiOff } from 'lucide-react';
import { usePrice } from '@/hooks/usePrice';
import { useUserPrefs } from '@/hooks/useUserPrefs';
import { cn } from '@/lib/utils';
import { formatPairPrice, getPair } from '@/lib/pairs';
import { getWebSocketClient } from '@/lib/websocket';
import { useEffect, useState } from 'react';
import SystemStatus from './SystemStatus';

interface HeaderProps {
  onMenuClick: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const [prefs] = useUserPrefs();
  // Ticker shows the user's default pair. They can still switch pairs on
  // each page via the page-level PairSelector — Header is just the global
  // glance value.
  const { price, flash } = usePrice(prefs.default_symbol);
  const pair = getPair(prefs.default_symbol);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    const ws = getWebSocketClient();
    const check = () => setWsConnected(ws.isConnected);
    const interval = setInterval(check, 2000);
    check();
    return () => clearInterval(interval);
  }, []);

  const isUp = price && price.change >= 0;

  return (
    <header className="h-14 bg-card border-b border-border flex items-center px-4 gap-4 sticky top-0 z-20">
      <button
        onClick={onMenuClick}
        className="lg:hidden text-text-secondary hover:text-white p-1"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Live Price Ticker — shows the user's default pair (Settings → Default Pair) */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-text-secondary text-xs font-mono whitespace-nowrap">{pair.display_name}</span>
          <span className={cn(
            'font-mono text-base sm:text-lg font-bold transition-colors duration-300 whitespace-nowrap',
            flash === 'up' ? 'text-success' : flash === 'down' ? 'text-danger' : 'text-white'
          )}>
            {price ? formatPairPrice(prefs.default_symbol, price.price) : '—.—'}
          </span>
          {price && (
            <span className={cn('flex items-center gap-0.5 text-xs font-mono whitespace-nowrap', isUp ? 'text-success' : 'text-danger')}>
              {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {isUp ? '+' : ''}{price.change_percent?.toFixed(2)}%
            </span>
          )}
        </div>

        {/* Bid/ask hidden on mobile + only shown if a real broker feed exposed them */}
        {price && price.bid != null && price.ask != null && (
          <div className="hidden lg:flex items-center gap-4 text-xs text-text-secondary font-mono">
            <span>Bid: <span className="text-white">{formatPairPrice(prefs.default_symbol, price.bid)}</span></span>
            <span>Ask: <span className="text-white">{formatPairPrice(prefs.default_symbol, price.ask)}</span></span>
            <span>Spread: <span className="text-white">{price.spread_pips?.toFixed(1) ?? '—'}</span></span>
          </div>
        )}
      </div>

      {/* System status — green/yellow/red dot, click for details */}
      <SystemStatus />

      {/* WS indicator */}
      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
        {wsConnected ? (
          <><Wifi className="w-3.5 h-3.5 text-success" /><span className="hidden sm:inline text-success">Live</span></>
        ) : (
          <><WifiOff className="w-3.5 h-3.5 text-danger" /><span className="hidden sm:inline text-danger">Offline</span></>
        )}
      </div>
    </header>
  );
}
