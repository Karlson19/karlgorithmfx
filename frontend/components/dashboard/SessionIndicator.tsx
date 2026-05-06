'use client';
import { useEffect, useState } from 'react';
import { SessionInfo } from '@/types';
import { getWebSocketClient } from '@/lib/websocket';
import { cn } from '@/lib/utils';
import { Clock, Zap } from 'lucide-react';

const SESSION_LABELS: Record<string, string> = {
  SYDNEY: 'SYD', TOKYO: 'TYO', LONDON: 'LON', NEW_YORK: 'NYC'
};

export default function SessionIndicator() {
  const [session, setSession] = useState<SessionInfo | null>(null);

  useEffect(() => {
    const ws = getWebSocketClient();
    const unsub = ws.onMessage((msg) => {
      if (msg.type === 'SESSION_UPDATE') {
        setSession(msg.data as SessionInfo);
      }
    });
    return () => unsub();
  }, []);

  if (!session) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 animate-pulse">
        <div className="h-4 bg-border rounded w-32" />
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-text-secondary" />
          <span className="text-text-secondary text-sm">Market Sessions</span>
        </div>
        {session.is_peak_hours && (
          <div className="flex items-center gap-1 text-xs text-accent bg-accent/10 border border-accent/20 px-2 py-0.5 rounded-full">
            <Zap className="w-3 h-3" />
            Peak Hours
          </div>
        )}
        {session.good_time_to_trade && !session.is_peak_hours && (
          <div className="text-xs text-success bg-success/10 border border-success/20 px-2 py-0.5 rounded-full">
            Good time to trade
          </div>
        )}
      </div>

      <div className="flex gap-2 flex-wrap mb-3">
        {Object.entries(SESSION_LABELS).map(([key, label]) => (
          <div
            key={key}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-mono font-medium border',
              session.sessions[key]
                ? 'bg-success/10 text-success border-success/30'
                : 'bg-border/30 text-text-secondary border-border'
            )}
          >
            <span className={cn('inline-block w-1.5 h-1.5 rounded-full mr-1.5',
              session.sessions[key] ? 'bg-success' : 'bg-zinc-600'
            )} />
            {label}
          </div>
        ))}
      </div>

      <p className="text-text-secondary text-xs">
        Next: <span className="text-white">{session.next_session}</span> in{' '}
        <span className="text-accent">{session.next_session_in}</span>
      </p>
    </div>
  );
}
