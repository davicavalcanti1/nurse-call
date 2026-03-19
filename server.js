const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Estado dos alertas em memória
const alertas = {};

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

// ─── Rota para página individual de cada sala ─────────────────────────────────
app.get('/sala/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sala.html'));
});

// ─── API para os interruptores WiFi ───────────────────────────────────────────

// Acionar chamado: POST /api/alert  body: { "room": "quarto-01" }
app.post('/api/alert', (req, res) => {
  const { room } = req.body;
  if (!room) return res.status(400).json({ error: 'room é obrigatório' });

  alertas[room] = {
    room,
    hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };

  broadcast({ type: 'alerta', room, ativo: true, hora: alertas[room].hora });
  console.log(`[ALERTA] ${room} — ${alertas[room].hora}`);
  res.json({ ok: true });
});

// Cancelar chamado: POST /api/clear  body: { "room": "quarto-01" }
app.post('/api/clear', (req, res) => {
  const { room } = req.body;
  delete alertas[room];
  broadcast({ type: 'alerta', room, ativo: false });
  console.log(`[CLEAR] ${room}`);
  res.json({ ok: true });
});

// Status geral: GET /api/status
app.get('/api/status', (req, res) => res.json(alertas));

// ─── WebSocket ────────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'init', alertas }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.type === 'atender') {
        delete alertas[msg.room];
        // Avisa a tela de enfermagem para apagar o alerta
        broadcast({ type: 'alerta', room: msg.room, ativo: false });
        // Avisa a página da sala que o enfermeiro está a caminho
        broadcast({ type: 'atendido', room: msg.room });
        console.log(`[ATENDIDO] ${msg.room}`);
      }
    } catch (_) {}
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Nurse Call rodando em http://localhost:${PORT}`));
