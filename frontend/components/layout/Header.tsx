'use client';
import { Menu, TrendingUp, TrendingDown, Wifi, WifiOff } from 'lucide-react';
import { usePrice } from '@/hooks/usePrice';
import { cn, formatPrice } from '@/lib/utils';
import { getWebSocketClient } from '@/lib/websocket';
import { useEffect, useState } from 'react';

interface HeaderProps {
  onMenuClick: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { price, flash } = usePrice();
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

      {/* Live Price Ticker */}
      <div className="flex items-center gap-4 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-text-secondary text-xs font-mono">EUR/USD</span>
          <span className={cn(
            'font-mono text-lg font-bold transition-colors duration-300',
            flash === 'up' ? 'text-success' : flash === 'down' ? 'text-danger' : 'text-white'
          )}>
            {price ? formatPrice(price.price) : '—.—————'}
          </span>
          {price && (
            <span className={cn('flex items-center gap-0.5 text-xs font-mono', isUp ? 'text-success' : 'text-danger')}>
              {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {isUp ? '+' : ''}{price.change_percent?.toFixed(2)}%
            </span>
          )}
        </div>

        {price && (
          <div className="hidden sm:flex items-center gap-4 text-xs text-text-secondary font-mono">
            <span>Bid: <span className="text-white">{formatPrice(price.bid)}</span></span>
            <span>Ask: <span className="text-white">{formatPrice(price.ask)}</span></span>
            <span>Spread: <span className="text-white">{price.spread?.toFixed(1)}</span></span>
          </div>
        )}
      </div>

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
