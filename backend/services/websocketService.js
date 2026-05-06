const WebSocket = require('ws');
const { getSessionInfo } = require('../utils/marketSession');

let wss = null;

function init(server) {
  wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');

    // Send session info on connect
    const sessionInfo = getSessionInfo();
    ws.send(JSON.stringify({ type: 'SESSION_UPDATE', data: sessionInfo }));

    ws.on('error', (err) => console.error('WS error:', err.message));
    ws.on('close', () => console.log('WebSocket client disconnected'));
    ws.on('message', (msg) => {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'PING') ws.send(JSON.stringify({ type: 'PONG' }));
      } catch {}
    });
  });

  // Broadcast session info every minute
  setInterval(() => {
    const sessionInfo = getSessionInfo();
    broadcast({ type: 'SESSION_UPDATE', data: sessionInfo });
  }, 60000);

  console.log('WebSocket server initialized');
}

function broadcast(data) {
  if (!wss) return;
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function getClientCount() {
  if (!wss) return 0;
  return wss.clients.size;
}

module.exports = { init, broadcast, getClientCount };
