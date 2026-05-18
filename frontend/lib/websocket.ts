import { WSMessage } from '@/types';

type MessageHandler = (msg: WSMessage) => void;
type ReconnectHandler = () => void;

// ─── Resilient WebSocket client ──────────────────────────────────────────────
// Built for the realities of free-tier hosts (Render, Vercel-edge):
//   - Idle WS connections get killed silently. We send PING every 25s and
//     auto-reconnect if we don't see a PONG within 10s.
//   - When the user comes back to a backgrounded tab, the WS may have died
//     without firing onclose. We detect this via visibility-change and
//     trigger an immediate health check + reconnect-if-dead.
//   - On reconnect we fire any registered "reconnect handlers" so hooks
//     can re-fetch state they may have missed while disconnected
//     (e.g., a missed PRICE_UPDATE during the gap).
//   - Exponential backoff capped at 30s prevents thundering-herd.

const PING_INTERVAL_MS  = 25_000;
const PONG_TIMEOUT_MS   = 10_000;
const INITIAL_DELAY_MS  = 3_000;
const MAX_DELAY_MS      = 30_000;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private reconnectHandlers: ReconnectHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = INITIAL_DELAY_MS;
  private url: string;
  private shouldConnect = false;
  private hasConnectedOnce = false;
  private visibilityHookAttached = false;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    this.shouldConnect = true;
    this.createConnection();
    this.attachVisibilityHook();
  }

  private attachVisibilityHook() {
    if (this.visibilityHookAttached || typeof document === 'undefined') return;
    this.visibilityHookAttached = true;
    document.addEventListener('visibilitychange', () => {
      // When the tab comes back to foreground, validate the WS is alive.
      // Many providers silently sever idle connections — we won't hear
      // onclose until we try to send.
      if (document.visibilityState === 'visible' && this.shouldConnect) {
        if (!this.isConnected) {
          this.createConnection();
        } else {
          // Force a ping to confirm liveness; if no pong comes back, our
          // pongTimer will trigger a reconnect.
          this.sendPing();
        }
      }
    });
  }

  private createConnection() {
    if (!this.shouldConnect) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[WS] connected');
        this.reconnectDelay = INITIAL_DELAY_MS;
        this.startPingLoop();
        // On reconnect (not first connect), fire backfill handlers so
        // hooks can refetch any state they may have missed.
        if (this.hasConnectedOnce) {
          this.reconnectHandlers.forEach(h => {
            try { h(); } catch (err) { console.error('[WS] reconnect handler error', err); }
          });
        }
        this.hasConnectedOnce = true;
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WSMessage;
          // Treat any message as proof of life — clears pending pong timeout.
          this.clearPongTimer();
          if (msg.type === 'PONG') return;
          this.handlers.forEach(h => {
            try { h(msg); } catch (err) { console.error('[WS] handler error', err); }
          });
        } catch {}
      };

      this.ws.onclose = () => {
        this.stopPingLoop();
        if (this.shouldConnect) {
          console.log(`[WS] closed, reconnecting in ${this.reconnectDelay}ms`);
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        // Trigger the close path which handles reconnect.
        this.ws?.close();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private startPingLoop() {
    this.stopPingLoop();
    this.pingTimer = setInterval(() => this.sendPing(), PING_INTERVAL_MS);
  }

  private stopPingLoop() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    this.clearPongTimer();
  }

  private sendPing() {
    if (!this.isConnected) return;
    try {
      this.ws?.send(JSON.stringify({ type: 'PING' }));
      // If we don't see a pong (or any other message) within PONG_TIMEOUT_MS,
      // assume the socket is silently dead and force a reconnect.
      this.clearPongTimer();
      this.pongTimer = setTimeout(() => {
        console.warn('[WS] pong timeout — forcing reconnect');
        this.ws?.close();
      }, PONG_TIMEOUT_MS);
    } catch {
      // Send threw — connection is broken in a non-obvious way.
      this.ws?.close();
    }
  }

  private clearPongTimer() {
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, MAX_DELAY_MS);
      this.createConnection();
    }, this.reconnectDelay);
  }

  disconnect() {
    this.shouldConnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopPingLoop();
    this.ws?.close();
    this.ws = null;
  }

  send(data: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(data)); } catch {}
    }
  }

  onMessage(handler: MessageHandler) {
    this.handlers.push(handler);
    return () => { this.handlers = this.handlers.filter(h => h !== handler); };
  }

  // Called after a successful reconnect — gives hooks a hook (heh) to
  // refetch any data they may have missed.
  onReconnect(handler: ReconnectHandler) {
    this.reconnectHandlers.push(handler);
    return () => { this.reconnectHandlers = this.reconnectHandlers.filter(h => h !== handler); };
  }

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

let wsClient: WebSocketClient | null = null;

export function getWebSocketClient(): WebSocketClient {
  if (!wsClient) {
    const url = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000';
    wsClient = new WebSocketClient(url);
  }
  return wsClient;
}

export default WebSocketClient;
