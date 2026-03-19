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

// ─── QR Code: disparo automático ao abrir a URL ───────────────────────────────
// GET /qr/:room/:tipo  → registra alerta e retorna página de confirmação
app.get('/qr/:room/:tipo', (req, res) => {
  const { room, tipo } = req.params;
  // GET /qr/:room/clear → cancela o chamado via GET simples
  if (tipo === 'clear') {
    delete alertas[room];
    broadcast({ type: 'alerta', room, ativo: false });
    console.log(`[QR/CLEAR] ${room}`);
    const nomeQ = room.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    return res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Chamado Cancelado</title>
      <style>*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0d1117;font-family:'Segoe UI',sans-serif;color:#e6edf3;text-align:center;padding:24px}.box{display:flex;flex-direction:column;align-items:center;gap:16px}.i{font-size:5rem}.t{font-size:1.5rem;font-weight:800;color:#22c55e;letter-spacing:2px;text-transform:uppercase}.s{font-size:.85rem;color:#8b949e}</style>
      </head><body><div class="box"><div class="i">✅</div>
      <div class="t">Chamado Cancelado</div>
      <div class="s">${nomeQ}</div></div></body></html>`);
  }

  const tiposValidos = ['chamada', 'atendimento', 'apoio'];

  if (!tiposValidos.includes(tipo)) {
    return res.status(400).send('Tipo de chamado inválido.');
  }

  const jaAtivo = !!alertas[room];

  if (!jaAtivo) {
    const hora     = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const paciente = pacientes[room] || '';
    alertas[room]  = { room, hora, tipo, paciente };
    broadcast({ type: 'alerta', room, ativo: true, hora, tipo, paciente });
    registrarLog(room, tipo);
    console.log(`[QR/${tipo.toUpperCase()}] ${room} — ${hora}`);
  }

  const nomeQuarto = room.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const paciente   = pacientes[room] || '';

  const LABEL = { chamada: 'Chamou Enfermagem', atendimento: 'Solicitou Atendimento', apoio: 'Solicitou Apoio' };
  const COR   = { chamada: '#ef4444', atendimento: '#f59e0b', apoio: '#3b82f6' };
  const ICONE = { chamada: '🔴', atendimento: '🟠', apoio: '🔵' };

  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${nomeQuarto} — Chamado</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:${jaAtivo ? '#0d1117' : 'color-mix(in srgb,'+COR[tipo]+' 10%,#0d1117)'};
    font-family:'Segoe UI',system-ui,sans-serif;color:#e6edf3;text-align:center;padding:24px}
  .box{display:flex;flex-direction:column;align-items:center;gap:20px}
  .icone{font-size:5rem}
  .titulo{font-size:1.6rem;font-weight:800;letter-spacing:2px;text-transform:uppercase;
    color:${jaAtivo ? '#8b949e' : COR[tipo]}}
  .quarto{font-size:1.1rem;font-weight:600;letter-spacing:1px}
  .paciente{font-size:.9rem;color:#8b949e}
  .msg{font-size:.8rem;color:#8b949e;letter-spacing:1px;margin-top:8px}
  .badge{padding:6px 18px;border-radius:20px;font-size:.75rem;font-weight:700;
    letter-spacing:1px;text-transform:uppercase;
    background:${jaAtivo ? '#1e293b' : 'color-mix(in srgb,'+COR[tipo]+' 20%,#000)'};
    color:${jaAtivo ? '#8b949e' : COR[tipo]};
    border:1px solid ${jaAtivo ? '#30363d' : COR[tipo]}}
</style>
</head>
<body>
<div class="box">
  <div class="icone">${jaAtivo ? '⚠️' : ICONE[tipo]}</div>
  <div class="titulo">${jaAtivo ? 'Chamado já ativo' : 'Chamado Registrado!'}</div>
  <div class="quarto">${nomeQuarto}</div>
  ${paciente ? `<div class="paciente">${paciente}</div>` : ''}
  <div class="badge">${ICONE[tipo]} ${LABEL[tipo]}</div>
  <div class="msg">${jaAtivo ? 'Um chamado já está em andamento para este quarto.' : 'A equipe de enfermagem foi notificada.'}</div>
</div>
</body>
</html>`);
});

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
