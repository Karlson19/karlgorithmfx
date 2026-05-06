import { WSMessage } from '@/types';

type MessageHandler = (msg: WSMessage) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 3000;
  private maxReconnectDelay = 30000;
  private url: string;
  private shouldConnect = false;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    this.shouldConnect = true;
    this.createConnection();
  }

  private createConnection() {
    if (!this.shouldConnect) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectDelay = 3000;
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WSMessage;
          this.handlers.forEach(h => h(msg));
        } catch {}
      };

      this.ws.onclose = () => {
        if (this.shouldConnect) {
          console.log(`WebSocket closed, reconnecting in ${this.reconnectDelay}ms`);
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch (err) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
      this.createConnection();
    }, this.reconnectDelay);
  }

  disconnect() {
    this.shouldConnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  send(data: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  onMessage(handler: MessageHandler) {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter(h => h !== handler);
    };
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
