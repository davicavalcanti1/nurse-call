const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const alertas  = {};  // { "quarto-01": { room, hora, tipo, paciente } }
const pacientes = {}; // { "quarto-01": "Ana" }
const logs = [];      // eventos em ordem decrescente
let logId = 0;

// ── Helpers ──────────────────────────────────────────────────────────────────

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

const LABELS = {
  chamada:     'Chamou Enfermagem',
  atendimento: 'Solicitou Atendimento',
  apoio:       'Solicitou Apoio',
  atendido:    'Enfermeiro a Caminho',
};

function registrarLog(room, tipo) {
  const ts      = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const paciente = pacientes[room] || '';
  const evento   = LABELS[tipo] || tipo;
  const entry    = { id: ++logId, ts, room, paciente, evento, tipo };
  logs.unshift(entry);
  if (logs.length > 300) logs.pop();
  broadcast({ type: 'log', entry });
  return entry;
}

// ── Rotas estáticas ───────────────────────────────────────────────────────────
app.get('/sala/:id', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'sala.html')));

// ── API ───────────────────────────────────────────────────────────────────────

// POST /api/alert  { room, tipo: "chamada"|"atendimento"|"apoio" }
app.post('/api/alert', (req, res) => {
  const { room, tipo = 'chamada' } = req.body;
  if (!room) return res.status(400).json({ error: 'room obrigatório' });

  const hora     = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const paciente = pacientes[room] || '';

  alertas[room] = { room, hora, tipo, paciente };
  broadcast({ type: 'alerta', room, ativo: true, hora, tipo, paciente });
  registrarLog(room, tipo);

  console.log(`[${tipo.toUpperCase()}] ${room} ${paciente ? `(${paciente})` : ''} — ${hora}`);
  res.json({ ok: true });
});

// POST /api/clear  { room }
app.post('/api/clear', (req, res) => {
  const { room } = req.body;
  delete alertas[room];
  broadcast({ type: 'alerta', room, ativo: false });
  res.json({ ok: true });
});

// GET /api/status
app.get('/api/status', (req, res) => res.json(alertas));

// POST /api/paciente  { room, nome }
app.post('/api/paciente', (req, res) => {
  const { room, nome } = req.body;
  if (!room) return res.status(400).json({ error: 'room obrigatório' });
  if (nome && nome.trim()) {
    pacientes[room] = nome.trim();
  } else {
    delete pacientes[room];
  }
  broadcast({ type: 'paciente', room, nome: pacientes[room] || '' });
  res.json({ ok: true });
});

// GET /api/pacientes
app.get('/api/pacientes', (req, res) => res.json(pacientes));

// GET /api/logs
app.get('/api/logs', (req, res) => res.json(logs.slice(0, 100)));

// ── WebSocket ─────────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'init', alertas, pacientes, logs: logs.slice(0, 100) }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'atender') {
        delete alertas[msg.room];
        broadcast({ type: 'alerta',   room: msg.room, ativo: false });
        broadcast({ type: 'atendido', room: msg.room });
        registrarLog(msg.room, 'atendido');
        console.log(`[ATENDIDO] ${msg.room}`);
      }
    } catch (_) {}
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Nurse Call rodando em http://localhost:${PORT}`));
