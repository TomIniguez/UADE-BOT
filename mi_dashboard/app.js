// ---------------------------------------------------------------------------
// TP05 — Dashboard de telemetría del robot
// Funciona igual contra el simulador y contra el robot real: sólo cambia la IP.
// ---------------------------------------------------------------------------

const MAX_POINTS = 150; // ~15s de historial a 10 Hz

const el = (id) => document.getElementById(id);

const hostInput = el('hostInput');
const portInput = el('portInput');
const connectBtn = el('connectBtn');
const disconnectBtn = el('disconnectBtn');
const statusPill = el('statusPill');
const statusText = el('statusText');
const errorBanner = el('errorBanner');
const robotSubtitle = el('robotSubtitle');

const motorChecklist = el('motorChecklist');
const selectAllBtn = el('selectAllBtn');
const selectNoneBtn = el('selectNoneBtn');

const torqueThresholdInput = el('torqueThreshold');
const torqueThresholdVal = el('torqueThresholdVal');

let ws = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let initialized = false;
let motorsMeta = []; // [{id, nombre}]
let selectedMotorIds = new Set();
let torqueThreshold = parseFloat(torqueThresholdInput.value);

// Historial para gráficos en vivo
const history = {
  t: [],
  anglesById: new Map(), // id -> [valores]
  roll: [],
  pitch: [],
  yaw: [],
};

// Contador simple de mensajes/seg
let msgCounter = 0;
setInterval(() => {
  el('kpiRate').textContent = msgCounter + '/s';
  msgCounter = 0;
}, 1000);

// Recordar la última dirección usada
try {
  const saved = JSON.parse(localStorage.getItem('tp05_conn') || 'null');
  if (saved) {
    hostInput.value = saved.host ?? hostInput.value;
    portInput.value = saved.port ?? portInput.value;
  }
} catch (_) { /* no pasa nada si falla */ }

// ---------------------------------------------------------------------------
// Paleta para asignar un color estable a cada motor
// ---------------------------------------------------------------------------
const PALETTE = [
  '#52e3c2', '#f2a23c', '#ef4b4b', '#8b7cf7', '#4ade80',
  '#38bdf8', '#f472b6', '#facc15', '#fb923c', '#a3e635',
  '#60a5fa', '#e879f9',
];
function colorForMotor(id) {
  return PALETTE[id % PALETTE.length];
}

// ---------------------------------------------------------------------------
// Gráfico de ángulos (Chart.js)
// ---------------------------------------------------------------------------
const anglesChart = new Chart(el('anglesChart').getContext('2d'), {
  type: 'line',
  data: { labels: [], datasets: [] },
  options: baseLineOptions('°'),
});

const imuChart = new Chart(el('imuChart').getContext('2d'), {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      lineDataset('roll', '#52e3c2'),
      lineDataset('pitch', '#f2a23c'),
      lineDataset('yaw', '#8b7cf7'),
    ],
  },
  options: baseLineOptions('°'),
});

function lineDataset(label, color) {
  return {
    label,
    data: [],
    borderColor: color,
    backgroundColor: color,
    borderWidth: 1.5,
    pointRadius: 0,
    tension: 0.25,
  };
}

function baseLineOptions(unit) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'nearest', intersect: false },
    scales: {
      x: { ticks: { color: '#7c8b9a', maxTicksLimit: 8 }, grid: { color: '#1e2832' } },
      y: {
        ticks: { color: '#7c8b9a', callback: (v) => v + unit },
        grid: { color: '#1e2832' },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: { mode: 'nearest', intersect: false },
    },
  };
}

// ---------------------------------------------------------------------------
// Inicialización dependiente del primer mensaje (modelo, motores, patas...)
// ---------------------------------------------------------------------------
function initFromFirstMessage(data) {
  motorsMeta = data.motores.map((m) => ({ id: m.id, nombre: m.nombre }));

  el('kpiModelo').textContent = (data.modelo || '—').toUpperCase();
  el('kpiMotores').textContent = motorsMeta.length;
  robotSubtitle.textContent = `${(data.modelo || '').toUpperCase()} · ${motorsMeta.length} motores`;

  buildMotorChecklist();

  // Selección por defecto: algunas articulaciones representativas
  const defaults = motorsMeta.filter((m) =>
    /knee|hip_pitch|hip_yaw|elbow|foot/i.test(m.nombre)
  ).slice(0, 6);
  (defaults.length ? defaults : motorsMeta.slice(0, 4)).forEach((m) =>
    selectedMotorIds.add(m.id)
  );
  rebuildAnglesDatasets();
  refreshChecklistUI();

  // Panel de patas: sólo si el robot reporta 'fuerzas'
  const hasFeet = data.fuerzas && Object.keys(data.fuerzas).length > 0;
  el('feetPanel').classList.toggle('hidden', !hasFeet);
  if (hasFeet) buildFeetDiagram(data.fuerzas);

  // Tabla de motores: filas fijas, se actualizan in-place después
  buildMotorTable();

  initialized = true;
}

function buildMotorChecklist() {
  motorChecklist.innerHTML = '';
  motorsMeta.forEach((m) => {
    const chip = document.createElement('div');
    chip.className = 'motor-chip';
    chip.style.setProperty('--chip-color', colorForMotor(m.id));
    chip.dataset.id = m.id;
    chip.innerHTML = `<span class="swatch"></span>${m.nombre}`;
    chip.addEventListener('click', () => {
      if (selectedMotorIds.has(m.id)) selectedMotorIds.delete(m.id);
      else selectedMotorIds.add(m.id);
      rebuildAnglesDatasets();
      refreshChecklistUI();
    });
    motorChecklist.appendChild(chip);
  });
}

function refreshChecklistUI() {
  [...motorChecklist.children].forEach((chip) => {
    const id = Number(chip.dataset.id);
    chip.classList.toggle('active', selectedMotorIds.has(id));
  });
}

function rebuildAnglesDatasets() {
  anglesChart.data.datasets = motorsMeta
    .filter((m) => selectedMotorIds.has(m.id))
    .map((m) => {
      const buf = history.anglesById.get(m.id) || [];
      return {
        label: m.nombre,
        data: [...buf],
        borderColor: colorForMotor(m.id),
        backgroundColor: colorForMotor(m.id),
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.25,
      };
    });
  anglesChart.update('none');
}

selectAllBtn.addEventListener('click', () => {
  motorsMeta.forEach((m) => selectedMotorIds.add(m.id));
  rebuildAnglesDatasets();
  refreshChecklistUI();
});
selectNoneBtn.addEventListener('click', () => {
  selectedMotorIds.clear();
  rebuildAnglesDatasets();
  refreshChecklistUI();
});

// ---------------------------------------------------------------------------
// Tabla de motores
// ---------------------------------------------------------------------------
function buildMotorTable() {
  const tbody = el('motorTableBody');
  tbody.innerHTML = '';
  motorsMeta.forEach((m) => {
    const tr = document.createElement('tr');
    tr.id = `row-${m.id}`;
    tr.innerHTML = `
      <td>${m.id}</td>
      <td>${m.nombre}</td>
      <td data-f="angulo">—</td>
      <td data-f="velocidad">—</td>
      <td data-f="torque">—</td>
      <td data-f="temperatura"><span class="temp-chip">—</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function updateMotorTable(motores) {
  let maxTemp = -Infinity;
  let maxTorque = 0;
  motores.forEach((m) => {
    const tr = el(`row-${m.id}`);
    if (!tr) return;
    tr.querySelector('[data-f="angulo"]').textContent = m.angulo.toFixed(1) + '°';
    tr.querySelector('[data-f="velocidad"]').textContent = m.velocidad.toFixed(2);
    tr.querySelector('[data-f="torque"]').textContent = m.torque.toFixed(2);

    const chip = tr.querySelector('.temp-chip');
    chip.textContent = m.temperatura.toFixed(1) + '°C';
    chip.style.background = tempColor(m.temperatura, 0.25);
    chip.style.color = tempColor(m.temperatura, 1);

    const isAlarm = Math.abs(m.torque) > torqueThreshold;
    tr.classList.toggle('alarm', isAlarm);

    if (m.temperatura > maxTemp) maxTemp = m.temperatura;
    if (Math.abs(m.torque) > Math.abs(maxTorque)) maxTorque = m.torque;
  });
  el('kpiTempMax').textContent = maxTemp.toFixed(1) + '°C';
  el('kpiTorqueMax').textContent = maxTorque.toFixed(2) + ' Nm';
}

// Azul/verde cuando está frío, rojo cuando está caliente (20°C–60°C)
function tempColor(temp, alpha) {
  const t = Math.max(0, Math.min(1, (temp - 20) / 40));
  const hue = 190 - t * 190; // 190 (celeste) -> 0 (rojo)
  return `hsla(${hue}, 85%, 55%, ${alpha})`;
}

torqueThresholdInput.addEventListener('input', () => {
  torqueThreshold = parseFloat(torqueThresholdInput.value);
  torqueThresholdVal.textContent = torqueThreshold.toFixed(1);
});

// ---------------------------------------------------------------------------
// Horizonte artificial (roll / pitch) y compás de yaw — canvas a mano
// ---------------------------------------------------------------------------
const horizonCtx = el('horizonCanvas').getContext('2d');
const compassCtx = el('compassCanvas').getContext('2d');

function drawHorizon(roll, pitch) {
  const ctx = horizonCtx;
  const W = 190, H = 190, cx = W / 2, cy = H / 2, R = 85;
  ctx.clearRect(0, 0, W, H);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();

  ctx.translate(cx, cy);
  ctx.rotate((-roll * Math.PI) / 180);
  const pitchOffset = Math.max(-R, Math.min(R, pitch * 2.2));

  // cielo
  ctx.fillStyle = '#1b3a52';
  ctx.fillRect(-200, -200 + pitchOffset, 400, 200);
  // suelo
  ctx.fillStyle = '#3a2c1b';
  ctx.fillRect(-200, pitchOffset, 400, 200);
  // línea de horizonte
  ctx.strokeStyle = '#e7edf3';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-200, pitchOffset);
  ctx.lineTo(200, pitchOffset);
  ctx.stroke();

  ctx.restore();

  // marco
  ctx.strokeStyle = '#1e2832';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();

  // referencia del robot (fija, al centro)
  ctx.strokeStyle = '#f2a23c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 28, cy);
  ctx.lineTo(cx - 8, cy);
  ctx.moveTo(cx + 8, cy);
  ctx.lineTo(cx + 28, cy);
  ctx.stroke();
  ctx.fillStyle = '#f2a23c';
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawCompass(yaw) {
  const ctx = compassCtx;
  const W = 190, H = 190, cx = W / 2, cy = H / 2, R = 85;
  ctx.clearRect(0, 0, W, H);

  ctx.strokeStyle = '#1e2832';
  ctx.fillStyle = '#10151c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // marcas cada 45°, etiquetas de grados (no es brújula magnética: es yaw del robot)
  ctx.fillStyle = '#7c8b9a';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  for (let deg = 0; deg < 360; deg += 45) {
    const rad = (deg * Math.PI) / 180;
    const x1 = cx + Math.sin(rad) * (R - 10);
    const y1 = cy - Math.cos(rad) * (R - 10);
    const x2 = cx + Math.sin(rad) * (R - 2);
    const y2 = cy - Math.cos(rad) * (R - 2);
    ctx.strokeStyle = '#334150';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // aguja según yaw
  const rad = (yaw * Math.PI) / 180;
  ctx.strokeStyle = '#52e3c2';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.sin(rad) * (R - 20), cy - Math.cos(rad) * (R - 20));
  ctx.stroke();
  ctx.fillStyle = '#52e3c2';
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Batería
// ---------------------------------------------------------------------------
function updateBattery(bms) {
  const pct = bms.soc;
  el('batteryPct').textContent = pct + '%';
  const fill = el('batteryFill');
  fill.style.width = pct + '%';
  fill.style.background = pct > 50 ? '#4ade80' : pct > 20 ? '#f2a23c' : '#ef4b4b';

  el('bmsCorriente').textContent = bms.corriente + ' mA';
  el('bmsTemp').textContent = bms.temperatura.toFixed(1) + '°C';

  const cellsWrap = el('cellsWrap');
  if (bms.celdas && bms.celdas.length > 0) {
    cellsWrap.classList.remove('hidden');
    const min = Math.min(...bms.celdas);
    const max = Math.max(...bms.celdas);
    const range = Math.max(0.01, max - min);
    el('cellsBars').innerHTML = bms.celdas
      .map((v) => {
        const h = 10 + ((v - min) / range) * 30;
        return `<div class="cell-bar" style="height:${h}px" title="${v.toFixed(2)} V"></div>`;
      })
      .join('');
  } else {
    cellsWrap.classList.add('hidden');
  }
}

// ---------------------------------------------------------------------------
// Patas apoyadas — diagrama visto desde arriba, genérico para 2 o 4 patas
// ---------------------------------------------------------------------------
function footPosition(key) {
  const k = key.toUpperCase();
  if (k.startsWith('FR')) return { left: '75%', top: '22%' };
  if (k.startsWith('FL')) return { left: '25%', top: '22%' };
  if (k.startsWith('RR')) return { left: '75%', top: '78%' };
  if (k.startsWith('RL')) return { left: '25%', top: '78%' };
  if (k.startsWith('R_') || k.includes('R_FOOT')) return { left: '75%', top: '50%' };
  if (k.startsWith('L_') || k.includes('L_FOOT')) return { left: '25%', top: '50%' };
  return { left: '50%', top: '50%' };
}

function buildFeetDiagram(fuerzas) {
  const container = el('feetDiagram');
  container.innerHTML = '';
  Object.keys(fuerzas).forEach((key) => {
    const pos = footPosition(key);
    const dot = document.createElement('div');
    dot.className = 'foot-dot';
    dot.id = `foot-${key}`;
    dot.style.left = pos.left;
    dot.style.top = pos.top;
    dot.textContent = key.replace('_foot', '').replace('_', '');
    container.appendChild(dot);
  });
}

function updateFeet(fuerzas) {
  Object.entries(fuerzas).forEach(([key, val]) => {
    const dot = el(`foot-${key}`);
    if (dot) dot.classList.toggle('down', val === 1);
  });
}

// ---------------------------------------------------------------------------
// Buffers de historial (ring buffer simple por "push + shift")
// ---------------------------------------------------------------------------
function pushPoint(arr, value) {
  arr.push(value);
  if (arr.length > MAX_POINTS) arr.shift();
}

function updateHistoryAndCharts(data) {
  const label = data.ts.toFixed(1);
  pushPoint(history.t, label);

  data.motores.forEach((m) => {
    if (!history.anglesById.has(m.id)) history.anglesById.set(m.id, []);
    pushPoint(history.anglesById.get(m.id), m.angulo);
  });

  pushPoint(history.roll, data.imu.roll);
  pushPoint(history.pitch, data.imu.pitch);
  pushPoint(history.yaw, data.imu.yaw);

  anglesChart.data.labels = history.t;
  anglesChart.data.datasets.forEach((ds) => {
    const meta = motorsMeta.find((m) => m.nombre === ds.label);
    if (meta) ds.data = history.anglesById.get(meta.id) || [];
  });
  anglesChart.update('none');

  imuChart.data.labels = history.t;
  imuChart.data.datasets[0].data = history.roll;
  imuChart.data.datasets[1].data = history.pitch;
  imuChart.data.datasets[2].data = history.yaw;
  imuChart.update('none');
}

// ---------------------------------------------------------------------------
// Procesar un mensaje de telemetría completo
// ---------------------------------------------------------------------------
function handleTelemetry(data) {
  msgCounter++;
  if (!initialized) initFromFirstMessage(data);

  el('kpiTs').textContent = data.ts.toFixed(1) + 's';

  updateMotorTable(data.motores);
  updateHistoryAndCharts(data);

  el('rollVal').textContent = data.imu.roll.toFixed(1);
  el('pitchVal').textContent = data.imu.pitch.toFixed(1);
  el('yawVal').textContent = data.imu.yaw.toFixed(1);
  drawHorizon(data.imu.roll, data.imu.pitch);
  drawCompass(data.imu.yaw);

  updateBattery(data.bms);

  if (data.fuerzas && Object.keys(data.fuerzas).length > 0) {
    updateFeet(data.fuerzas);
  }
}

// ---------------------------------------------------------------------------
// Conexión: primero valida con fetch, después abre el WebSocket
// ---------------------------------------------------------------------------
function setStatus(mode, text) {
  statusPill.className = `status-pill status-${mode}`;
  statusText.textContent = text;
}

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.remove('hidden');
}
function hideError() {
  errorBanner.classList.add('hidden');
}

async function connect() {
  const host = hostInput.value.trim();
  const port = portInput.value.trim();
  if (!host || !port) return;

  localStorage.setItem('tp05_conn', JSON.stringify({ host, port }));
  hideError();
  setStatus('connecting', 'Probando conexión…');
  connectBtn.disabled = true;

  const base = `http://${host}:${port}`;
  const wsUrl = `ws://${host}:${port}/ws`;

  try {
    const res = await fetch(`${base}/telemetria`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await res.json();
  } catch (err) {
    setStatus('error', 'No responde');
    connectBtn.disabled = false;
    showError(
      `No se pudo leer ${base}/telemetria (${err.message}). ` +
      `Fijate que la ventana del simulador/backend siga abierta, que la IP y el puerto sean los correctos, ` +
      `y que no haya otra app usando ese puerto. Si abrís esa URL en el navegador y no ves JSON, el problema está del lado del backend.`
    );
    return;
  }

  openSocket(wsUrl);
}

function openSocket(wsUrl) {
  reconnectDelay = 1000;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    setStatus('connected', 'Conectado');
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
  };

  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      handleTelemetry(data);
    } catch (err) {
      console.error('Mensaje inválido del WebSocket', err);
    }
  };

  ws.onerror = () => {
    setStatus('error', 'Error de conexión');
  };

  ws.onclose = () => {
    disconnectBtn.disabled = true;
    if (manualDisconnect) {
      setStatus('idle', 'Sin conectar');
      connectBtn.disabled = false;
      return;
    }
    setStatus('error', `Reconectando en ${Math.round(reconnectDelay / 1000)}s…`);
    reconnectTimer = setTimeout(() => {
      openSocket(wsUrl);
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.6, 10000);
  };
}

let manualDisconnect = false;

connectBtn.addEventListener('click', () => {
  manualDisconnect = false;
  connect();
});

disconnectBtn.addEventListener('click', () => {
  manualDisconnect = true;
  clearTimeout(reconnectTimer);
  if (ws) ws.close();
  connectBtn.disabled = false;
  disconnectBtn.disabled = true;
  setStatus('idle', 'Sin conectar');
});
