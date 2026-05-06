const state = {
  contexts: [],
  selectedContext: null,
  graph: { nodes: [], links: [] },
  locale: "en-US",
  i18n: {},
};

const SUPPORTED_LOCALES = ["pt-BR", "en-US", "es-ES"];
const DEFAULT_LOCALE = "en-US";

const ui = {
  contextList: document.getElementById("contextList"),
  contextEditor: document.getElementById("contextEditor"),
  currentContext: document.getElementById("currentContext"),
  memoryViewer: document.getElementById("memoryViewer"),
  canvas: document.getElementById("voidCanvas"),
  nodeTooltip: document.getElementById("nodeTooltip"),
  ollamaBadge: document.getElementById("ollamaBadge"),
  ollamaText: document.getElementById("ollamaText"),
  ollamaModel: document.getElementById("ollamaModel"),
  daemonBadge: document.getElementById("daemonBadge"),
  lastAction: document.getElementById("lastAction"),
};

const controls = {
  startDaemon: document.getElementById("startDaemon"),
  stopDaemon: document.getElementById("stopDaemon"),
  restartDaemon: document.getElementById("restartDaemon"),
  syncNow: document.getElementById("syncNow"),
  forceMemory: document.getElementById("forceMemory"),
  newContext: document.getElementById("newContext"),
  refreshContexts: document.getElementById("refreshContexts"),
  saveContext: document.getElementById("saveContext"),
  refreshMemoryView: document.getElementById("refreshMemoryView"),
};

const ctx = ui.canvas.getContext("2d");
const sim = { nodes: [], links: [], animationId: null };
const world = { width: 1600, height: 1000, padding: 80 };
const camera = {
  x: 0,
  y: 0,
  zoom: 1,
  minZoom: 0.45,
  maxZoom: 2.2,
  dragging: false,
  lastX: 0,
  lastY: 0,
  userInteracted: false,
};

let liveRefreshTimer = null;
let ollamaStatusTimer = null;
let daemonStatusTimer = null;
let dpr = window.devicePixelRatio || 1;
let hoveredNodeId = null;
let flowTick = 0;

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function t(key, vars = {}) {
  const table = state.i18n || {};
  const raw = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
  return String(raw).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
}

async function fetchLocaleTable(locale) {
  const res = await fetch(`/languages/${locale}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Locale ${locale} not found`);
  return res.json();
}

function detectPreferredLocale() {
  const candidates = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language || DEFAULT_LOCALE];
  for (const lang of candidates) {
    if (!lang) continue;
    const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === lang.toLowerCase());
    if (exact) return exact;
    const base = String(lang).split("-")[0].toLowerCase();
    const byBase = SUPPORTED_LOCALES.find((l) => l.toLowerCase().startsWith(`${base}-`));
    if (byBase) return byBase;
  }
  return DEFAULT_LOCALE;
}

async function loadI18n() {
  const preferred = detectPreferredLocale();
  let table;
  let locale = preferred;
  try {
    table = await fetchLocaleTable(preferred);
  } catch {
    locale = DEFAULT_LOCALE;
    table = await fetchLocaleTable(DEFAULT_LOCALE);
  }
  state.locale = locale;
  state.i18n = table;
  document.documentElement.lang = locale;
}

function applyStaticI18n() {
  document.title = "CodexMemory";
  const map = [
    ["appTitle", "app.title"],
    ["appMode", "app.modeLive"],
    ["startDaemon", "button.start"],
    ["stopDaemon", "button.stop"],
    ["restartDaemon", "button.restart"],
    ["syncNow", "button.syncNow"],
    ["forceMemory", "button.forceMemory"],
    ["daemonBadge", "status.daemonStopped"],
    ["lastAction", "status.ready"],
    ["contextsTitle", "title.contexts"],
    ["newContext", "button.newContext"],
    ["refreshContexts", "button.refreshList"],
    ["contextEditorTitle", "title.contextEditor"],
    ["currentContext", "label.noneSelected"],
    ["saveContext", "button.save"],
    ["agentMemoryTitle", "title.agentMemory"],
    ["refreshMemoryView", "button.refresh"],
    ["neuralTitle", "title.neural"],
    ["ollamaText", "status.ollamaChecking"],
    ["ollamaModel", "label.modelUnknown"],
  ];
  for (const [id, key] of map) {
    const el = document.getElementById(id);
    if (el) el.textContent = t(key);
  }
  if (ui.contextEditor) ui.contextEditor.placeholder = t("placeholder.contextEditor");
  if (ui.memoryViewer) ui.memoryViewer.placeholder = t("placeholder.memoryViewer");
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

function renderContexts() {
  ui.contextList.innerHTML = "";
  for (const item of state.contexts) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.textContent = `${item.name} (${item.size}b)`;
    btn.title = item.preview;
    btn.addEventListener("click", () => selectContext(item.name));
    li.appendChild(btn);
    ui.contextList.appendChild(li);
  }
}

async function loadContexts() {
  const data = await api("/api/contexts");
  state.contexts = data.contexts || [];
  renderContexts();
}

async function selectContext(name) {
  const data = await api(`/api/contexts/${encodeURIComponent(name)}`);
  state.selectedContext = name;
  ui.currentContext.textContent = name;
  ui.contextEditor.value = data.text || "";
}

async function saveSelectedContext() {
  if (!state.selectedContext) return;
  await api(`/api/contexts/${encodeURIComponent(state.selectedContext)}`, {
    method: "PUT",
    body: JSON.stringify({ text: ui.contextEditor.value }),
  });
  await loadContexts();
  await loadGraph();
}

async function createNewContext() {
  const payload = { text: "# Novo Contexto\n\nDescreva aqui." };
  const data = await api("/api/contexts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  await loadContexts();
  if (data.created) {
    await selectContext(data.created);
  }
  await loadGraph();
}

async function syncNow() {
  const result = await api("/api/sync", { method: "POST" });
  await loadGraph();
  await loadOllamaStatus();
  await loadDaemonStatus();
  await loadMemory();
  return result;
}

async function forceMemoryNow() {
  const result = await api("/api/memory/force", { method: "POST" });
  await loadGraph();
  await loadOllamaStatus();
  await loadDaemonStatus();
  await loadMemory();
  return result;
}

async function daemonStart() {
  const result = await api("/api/daemon/start", { method: "POST" });
  await loadOllamaStatus();
  await loadDaemonStatus();
  await loadMemory();
  return result;
}

async function daemonStop() {
  const result = await api("/api/daemon/stop", { method: "POST" });
  await loadOllamaStatus();
  await loadDaemonStatus();
  await loadMemory();
  return result;
}

async function daemonRestart() {
  const result = await api("/api/daemon/restart", { method: "POST" });
  await loadOllamaStatus();
  await loadDaemonStatus();
  await loadMemory();
  return result;
}

async function loadMemory() {
  if (!ui.memoryViewer) return;
  try {
    const data = await api("/api/memory");
    ui.memoryViewer.value = data.text || "";
  } catch {
    ui.memoryViewer.value = "";
  }
}

function setActionMessage(message, tone = "") {
  if (!ui.lastAction) return;
  ui.lastAction.textContent = message;
  ui.lastAction.classList.remove("success", "error", "working");
  if (tone) ui.lastAction.classList.add(tone);
}

function withButtonBusy(button, busyText) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  return () => {
    button.disabled = false;
    button.textContent = originalText;
  };
}

function renderDaemonStatus(status) {
  if (!ui.daemonBadge) return;
  const running = Boolean(status && status.running);
  ui.daemonBadge.classList.toggle("running", running);
  ui.daemonBadge.classList.toggle("down", !running);
  const lastRun = status && status.lastRunAt
    ? new Date(status.lastRunAt).toLocaleTimeString()
    : t("status.never");
  ui.daemonBadge.textContent = running
    ? t("status.daemonRunning", { time: lastRun })
    : t("status.daemonStopped");
}

async function loadDaemonStatus() {
  try {
    const status = await api("/api/status");
    renderDaemonStatus(status.daemon || null);
  } catch {
    renderDaemonStatus(null);
  }
}

function renderOllamaStatus(status) {
  const badge = ui.ollamaBadge;
  badge.classList.remove("ok", "warn", "down", "loading");

  if (!status) {
    badge.classList.add("down");
    ui.ollamaText.textContent = t("status.ollamaNoResponse");
    ui.ollamaModel.textContent = t("label.modelUnknown");
    return;
  }

  const modelText = status.modelConfigured
    ? t("label.model", { model: status.modelConfigured })
    : t("label.modelUnknown");
  ui.ollamaModel.textContent = modelText;

  if (status.reachable && status.modelInstalled) {
    badge.classList.add("ok");
    ui.ollamaText.textContent = t("status.ollamaReady");
    return;
  }

  if (status.reachable && !status.modelInstalled) {
    badge.classList.add("warn");
    ui.ollamaText.textContent = t("status.ollamaOnlineMissingModel");
    return;
  }

  badge.classList.add("down");
  ui.ollamaText.textContent = t("status.ollamaOffline");
}

async function loadOllamaStatus() {
  try {
    const status = await api("/api/ollama-status");
    renderOllamaStatus(status);
  } catch {
    renderOllamaStatus(null);
  }
}

function resizeCanvas() {
  const rect = ui.canvas.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  ui.canvas.width = Math.floor(rect.width * dpr);
  ui.canvas.height = Math.floor(rect.height * dpr);
  if (!camera.userInteracted) {
    fitCameraToWorld();
  } else {
    clampCamera();
  }
}

function fitCameraToWorld() {
  const viewW = ui.canvas.clientWidth || 1;
  const viewH = ui.canvas.clientHeight || 1;
  const zx = viewW / world.width;
  const zy = viewH / world.height;
  camera.zoom = clamp(Math.min(zx, zy), camera.minZoom, 1.1);
  camera.x = (viewW - world.width * camera.zoom) / 2;
  camera.y = (viewH - world.height * camera.zoom) / 2;
  clampCamera();
}

function clampCamera() {
  const viewW = ui.canvas.clientWidth || 1;
  const viewH = ui.canvas.clientHeight || 1;
  const contentW = world.width * camera.zoom;
  const contentH = world.height * camera.zoom;

  if (contentW <= viewW) {
    camera.x = (viewW - contentW) / 2;
  } else {
    const minX = viewW - contentW;
    camera.x = clamp(camera.x, minX, 0);
  }

  if (contentH <= viewH) {
    camera.y = (viewH - contentH) / 2;
  } else {
    const minY = viewH - contentH;
    camera.y = clamp(camera.y, minY, 0);
  }
}

function screenToWorld(screenX, screenY) {
  return {
    x: (screenX - camera.x) / camera.zoom,
    y: (screenY - camera.y) / camera.zoom,
  };
}

function initSimulation(graph) {
  const nodeCount = Math.max(1, (graph.nodes || []).length);
  const targetWorldW = clamp(Math.ceil(Math.sqrt(nodeCount) * 980), 1200, 12000);
  const targetWorldH = clamp(Math.ceil(Math.sqrt(nodeCount) * 760), 720, 9000);
  world.width = targetWorldW;
  world.height = targetWorldH;

  const byId = new Map(sim.nodes.map((n) => [n.id, n]));
  const spawnMinX = world.padding;
  const spawnMaxX = world.width - world.padding;
  const spawnMinY = world.padding;
  const spawnMaxY = world.height - world.padding;

  sim.nodes = (graph.nodes || []).map((n) => {
    const existing = byId.get(n.id);
    if (existing) {
      return {
        ...existing,
        ...n,
        x: existing.x,
        y: existing.y,
        vx: existing.vx,
        vy: existing.vy,
        phase: existing.phase,
        driftSeed: existing.driftSeed,
        driftSpeed: existing.driftSpeed,
        colorHue: existing.colorHue,
        glowBias: existing.glowBias,
        wobbleA: existing.wobbleA,
        wobbleB: existing.wobbleB,
        homeX: existing.homeX,
        homeY: existing.homeY,
        orbitX: existing.orbitX,
        orbitY: existing.orbitY,
        orbitPhaseX: existing.orbitPhaseX,
        orbitPhaseY: existing.orbitPhaseY,
        maxOrbitRadius: existing.maxOrbitRadius,
      };
    }

    const x = spawnMinX + Math.random() * Math.max(1, spawnMaxX - spawnMinX);
    const y = spawnMinY + Math.random() * Math.max(1, spawnMaxY - spawnMinY);
    return {
      ...n,
      x,
      y,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      phase: Math.random() * Math.PI * 2,
      driftSeed: Math.random() * Math.PI * 2,
      driftSpeed: 0.01 + Math.random() * 0.02,
      colorHue: 175 + Math.random() * 70,
      glowBias: 0.75 + Math.random() * 0.5,
      wobbleA: 0.6 + Math.random() * 1.5,
      wobbleB: 0.6 + Math.random() * 1.5,
      homeX: x,
      homeY: y,
      orbitX: 22 + Math.random() * 48,
      orbitY: 18 + Math.random() * 42,
      orbitPhaseX: Math.random() * Math.PI * 2,
      orbitPhaseY: Math.random() * Math.PI * 2,
      maxOrbitRadius: 95 + Math.random() * 35,
    };
  });

  sim.links = (graph.links || []).map((l) => ({ ...l }));
  const refCountById = new Map();
  for (const link of sim.links) {
    refCountById.set(link.source, (refCountById.get(link.source) || 0) + 1);
    refCountById.set(link.target, (refCountById.get(link.target) || 0) + 1);
  }
  for (const node of sim.nodes) {
    node.refCount = refCountById.get(node.id) || 0;
  }
}

function findHoveredNode(screenX, screenY) {
  const worldPt = screenToWorld(screenX, screenY);
  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const node of sim.nodes) {
    const dist = Math.hypot(worldPt.x - node.x, worldPt.y - node.y);
    if (dist <= node.radius * 1.3 && dist < bestDist) {
      best = node;
      bestDist = dist;
    }
  }
  return best;
}

function hideNodeTooltip() {
  hoveredNodeId = null;
  if (!ui.nodeTooltip) return;
  ui.nodeTooltip.classList.remove("visible");
  ui.nodeTooltip.setAttribute("aria-hidden", "true");
}

function showNodeTooltip(node, clientX, clientY) {
  if (!ui.nodeTooltip || !node) return;
  hoveredNodeId = node.id;
  ui.nodeTooltip.textContent = t("tooltip.references", { name: node.label, count: node.refCount || 0 });
  ui.nodeTooltip.style.left = `${clientX + 14}px`;
  ui.nodeTooltip.style.top = `${clientY + 14}px`;
  ui.nodeTooltip.classList.add("visible");
  ui.nodeTooltip.setAttribute("aria-hidden", "false");
}

function tickSimulation() {
  if (!sim.nodes.length) return;
  flowTick += 0.018;

  const damping = 0.965;
  const nodeById = new Map(sim.nodes.map((n) => [n.id, n]));

  for (const link of sim.links) {
    const a = nodeById.get(link.source);
    const b = nodeById.get(link.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const weight = link.weight || 0;
    const baseTarget = 300 - Math.min(55, weight * 95);
    const target = clamp(baseTarget, 220, 360);
    const spring = (dist - target) * 0.0044;
    const ux = dx / dist;
    const uy = dy / dist;
    a.vx += ux * spring;
    a.vy += uy * spring;
    b.vx -= ux * spring;
    b.vy -= uy * spring;
  }

  // Limite minimo entre nos para evitar sobreposicao visual.
  for (let i = 0; i < sim.nodes.length; i += 1) {
    for (let j = i + 1; j < sim.nodes.length; j += 1) {
      const a = sim.nodes[i];
      const b = sim.nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const minDist = 85 + (a.radius + b.radius) * 0.6;
      if (dist >= minDist) continue;
      const push = (minDist - dist) * 0.012;
      const ux = dx / dist;
      const uy = dy / dist;
      a.vx -= ux * push;
      a.vy -= uy * push;
      b.vx += ux * push;
      b.vy += uy * push;
    }
  }

  for (const node of sim.nodes) {
    node.phase += node.driftSpeed;
    const targetX =
      node.homeX
      + Math.cos(node.phase * node.wobbleA + node.orbitPhaseX) * node.orbitX
      + Math.sin(node.phase * 0.67 + node.driftSeed) * (node.orbitX * 0.25);
    const targetY =
      node.homeY
      + Math.sin(node.phase * node.wobbleB + node.orbitPhaseY) * node.orbitY
      + Math.cos(node.phase * 0.73 + node.driftSeed) * (node.orbitY * 0.22);

    // Sempre tende ao alvo orbital, mantendo loop em torno da origem.
    node.vx += (targetX - node.x) * 0.012;
    node.vy += (targetY - node.y) * 0.012;

    node.vx *= damping;
    node.vy *= damping;

    const speed = Math.hypot(node.vx, node.vy);
    if (speed < 0.06) {
      const a = node.phase + node.driftSeed;
      node.vx += Math.cos(a) * 0.08;
      node.vy += Math.sin(a) * 0.08;
    }

    node.x += node.vx;
    node.y += node.vy;

    // Se fugir muito da origem, puxa de volta para evitar afastamento infinito.
    const fromHomeX = node.x - node.homeX;
    const fromHomeY = node.y - node.homeY;
    const homeDist = Math.hypot(fromHomeX, fromHomeY) || 1;
    if (homeDist > node.maxOrbitRadius) {
      const k = node.maxOrbitRadius / homeDist;
      node.x = node.homeX + fromHomeX * k;
      node.y = node.homeY + fromHomeY * k;
      node.vx *= 0.65;
      node.vy *= 0.65;
    }

    const pad = node.radius + world.padding * 0.2;
    if (node.x < pad) {
      node.x = pad;
      node.vx = Math.abs(node.vx) * 0.85;
    } else if (node.x > world.width - pad) {
      node.x = world.width - pad;
      node.vx = -Math.abs(node.vx) * 0.85;
    }

    if (node.y < pad) {
      node.y = pad;
      node.vy = Math.abs(node.vy) * 0.85;
    } else if (node.y > world.height - pad) {
      node.y = world.height - pad;
      node.vy = -Math.abs(node.vy) * 0.85;
    }
  }
}

function drawSimulation() {
  const w = ui.canvas.clientWidth;
  const h = ui.canvas.clientHeight;
  if (!w || !h) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  const nodeById = new Map(sim.nodes.map((n) => [n.id, n]));

  for (const link of sim.links) {
    const a = nodeById.get(link.source);
    const b = nodeById.get(link.target);
    if (!a || !b) continue;
    const alpha = Math.min(0.72, 0.08 + (link.weight || 0) * 0.9);
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = (0.5 + (link.weight || 0) * 1.1) / camera.zoom;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    // Fluxo linear de "informacao" percorrendo a sinapse
    const beads = 2;
    for (let i = 0; i < beads; i += 1) {
      const t = (flowTick * (0.42 + (link.weight || 0) * 0.33) + i * 0.48) % 1;
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      const radius = (1.8 + (link.weight || 0) * 1.1) / camera.zoom;
      const beadAlpha = 0.38 + (1 - Math.abs(0.5 - t) * 1.6) * 0.34;
      ctx.fillStyle = `rgba(157,247,229,${Math.max(0.2, beadAlpha)})`;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const node of sim.nodes) {
    node.phase += 0.03;
    const pulse = Math.sin(node.phase) * 0.8;
    const coreRadius = Math.max(8, node.radius + pulse);

    const glowRadius = coreRadius * (1.45 + node.glowBias * 0.42);
    const hue = Math.round(node.colorHue);
    const sat = 82;
    const lightCore = Math.max(52, Math.min(74, 58 + pulse * 1.8 + node.glowBias * 7));
    const lightGlow = Math.max(42, Math.min(68, lightCore - 7));
    const grd = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowRadius);
    grd.addColorStop(0, `hsla(${hue}, ${sat}%, ${lightGlow}%, 0.92)`);
    grd.addColorStop(1, `hsla(${hue}, ${sat}%, ${Math.max(30, lightGlow - 16)}%, 0.08)`);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `hsla(${hue}, ${sat}%, ${lightCore}%, 0.98)`;
    ctx.beginPath();
    ctx.arc(node.x, node.y, coreRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function animate() {
  tickSimulation();
  drawSimulation();
  sim.animationId = requestAnimationFrame(animate);
}

async function loadGraph() {
  const graph = await api("/api/graph");
  state.graph = graph;
  initSimulation(graph);
  if (!camera.userInteracted) {
    fitCameraToWorld();
  } else {
    clampCamera();
  }
}

function bindCanvasCameraControls() {
  ui.canvas.style.cursor = "grab";

  ui.canvas.addEventListener("mousedown", (ev) => {
    camera.dragging = true;
    camera.userInteracted = true;
    camera.lastX = ev.clientX;
    camera.lastY = ev.clientY;
    ui.canvas.style.cursor = "grabbing";
  });

  window.addEventListener("mousemove", (ev) => {
    if (!camera.dragging) return;
    const dx = ev.clientX - camera.lastX;
    const dy = ev.clientY - camera.lastY;
    camera.lastX = ev.clientX;
    camera.lastY = ev.clientY;
    camera.x += dx;
    camera.y += dy;
    clampCamera();
  });

  window.addEventListener("mouseup", () => {
    if (!camera.dragging) return;
    camera.dragging = false;
    ui.canvas.style.cursor = "grab";
  });

  ui.canvas.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      const rect = ui.canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const before = screenToWorld(sx, sy);

      const zoomFactor = ev.deltaY < 0 ? 1.12 : 0.88;
      const nextZoom = clamp(camera.zoom * zoomFactor, camera.minZoom, camera.maxZoom);
      camera.zoom = nextZoom;
      camera.userInteracted = true;

      camera.x = sx - before.x * camera.zoom;
      camera.y = sy - before.y * camera.zoom;
      clampCamera();
    },
    { passive: false },
  );

  ui.canvas.addEventListener("mousemove", (ev) => {
    if (camera.dragging) {
      hideNodeTooltip();
      return;
    }
    const rect = ui.canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    const node = findHoveredNode(sx, sy);
    if (!node) {
      hideNodeTooltip();
      return;
    }
    if (hoveredNodeId !== node.id) {
      showNodeTooltip(node, ev.clientX, ev.clientY);
      return;
    }
    showNodeTooltip(node, ev.clientX, ev.clientY);
  });

  ui.canvas.addEventListener("mouseleave", () => {
    hideNodeTooltip();
  });
}

function bindEvents() {
  controls.startDaemon.addEventListener("click", async () => {
    const done = withButtonBusy(controls.startDaemon, t("busy.start"));
    setActionMessage(t("status.daemonStarting"), "working");
    try {
      await daemonStart();
      setActionMessage(t("status.daemonStarted"), "success");
    } catch (err) {
      setActionMessage(t("status.daemonStartFail"), "error");
      alertError(err);
    } finally {
      done();
    }
  });

  controls.stopDaemon.addEventListener("click", async () => {
    const done = withButtonBusy(controls.stopDaemon, t("busy.stop"));
    setActionMessage(t("status.daemonStopping"), "working");
    try {
      await daemonStop();
      setActionMessage(t("status.daemonStoppedDone"), "success");
    } catch (err) {
      setActionMessage(t("status.daemonStopFail"), "error");
      alertError(err);
    } finally {
      done();
    }
  });

  controls.restartDaemon.addEventListener("click", async () => {
    const done = withButtonBusy(controls.restartDaemon, t("busy.restart"));
    setActionMessage(t("status.daemonRestarting"), "working");
    try {
      await daemonRestart();
      setActionMessage(t("status.daemonRestarted"), "success");
    } catch (err) {
      setActionMessage(t("status.daemonRestartFail"), "error");
      alertError(err);
    } finally {
      done();
    }
  });

  controls.syncNow.addEventListener("click", async () => {
    const done = withButtonBusy(controls.syncNow, t("busy.sync"));
    setActionMessage(t("status.syncRunning"), "working");
    try {
      const result = await syncNow();
      if (result && result.ok === false) {
        setActionMessage(t("status.syncFail"), "error");
      } else {
        setActionMessage(t("status.syncDone"), "success");
      }
    } catch (err) {
      setActionMessage(t("status.syncManualFail"), "error");
      alertError(err);
    } finally {
      done();
    }
  });

  controls.forceMemory.addEventListener("click", async () => {
    const done = withButtonBusy(controls.forceMemory, t("busy.force"));
    setActionMessage(t("status.forceMemoryRunning"), "working");
    try {
      const result = await forceMemoryNow();
      if (result && result.ok === false) {
        setActionMessage(t("status.forceMemoryFail"), "error");
      } else {
        setActionMessage(t("status.forceMemoryDone"), "success");
      }
    } catch (err) {
      setActionMessage(t("status.forceMemoryFail"), "error");
      alertError(err);
    } finally {
      done();
    }
  });

  controls.newContext.addEventListener("click", () => createNewContext().catch(alertError));
  controls.refreshContexts.addEventListener("click", () => loadContexts().catch(alertError));
  controls.saveContext.addEventListener("click", () => saveSelectedContext().catch(alertError));
  controls.refreshMemoryView.addEventListener("click", () => loadMemory().catch(alertError));

  bindCanvasCameraControls();

  window.addEventListener("resize", () => {
    resizeCanvas();
  });
}

function alertError(err) {
  const message = err instanceof Error ? err.message : String(err);
  alert(`Erro: ${message}`);
}

async function boot() {
  await loadI18n();
  applyStaticI18n();
  bindEvents();
  resizeCanvas();
  await loadContexts();
  await loadGraph();
  await loadOllamaStatus();
  await loadDaemonStatus();
  await loadMemory();
  setActionMessage(t("status.ready"));

  if (liveRefreshTimer) clearInterval(liveRefreshTimer);
  liveRefreshTimer = setInterval(() => {
    void loadGraph();
  }, 3000);

  if (ollamaStatusTimer) clearInterval(ollamaStatusTimer);
  ollamaStatusTimer = setInterval(() => {
    void loadOllamaStatus();
  }, 7000);

  if (daemonStatusTimer) clearInterval(daemonStatusTimer);
  daemonStatusTimer = setInterval(() => {
    void loadDaemonStatus();
    void loadMemory();
  }, 7000);

  animate();
}

boot().catch(alertError);
