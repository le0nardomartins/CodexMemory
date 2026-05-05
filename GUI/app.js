const state = {
  contexts: [],
  selectedContext: null,
  graph: { nodes: [], links: [] },
};

const ui = {
  contextList: document.getElementById("contextList"),
  contextEditor: document.getElementById("contextEditor"),
  currentContext: document.getElementById("currentContext"),
  canvas: document.getElementById("voidCanvas"),
  ollamaBadge: document.getElementById("ollamaBadge"),
  ollamaText: document.getElementById("ollamaText"),
  ollamaModel: document.getElementById("ollamaModel"),
};

const controls = {
  startDaemon: document.getElementById("startDaemon"),
  stopDaemon: document.getElementById("stopDaemon"),
  restartDaemon: document.getElementById("restartDaemon"),
  syncNow: document.getElementById("syncNow"),
  newContext: document.getElementById("newContext"),
  refreshContexts: document.getElementById("refreshContexts"),
  saveContext: document.getElementById("saveContext"),
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
let dpr = window.devicePixelRatio || 1;

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
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
  await api("/api/sync", { method: "POST" });
  await loadGraph();
  await loadOllamaStatus();
}

async function daemonStart() {
  await api("/api/daemon/start", { method: "POST" });
  await loadOllamaStatus();
}

async function daemonStop() {
  await api("/api/daemon/stop", { method: "POST" });
  await loadOllamaStatus();
}

async function daemonRestart() {
  await api("/api/daemon/restart", { method: "POST" });
  await loadOllamaStatus();
}

function renderOllamaStatus(status) {
  const badge = ui.ollamaBadge;
  badge.classList.remove("ok", "warn", "down", "loading");

  if (!status) {
    badge.classList.add("down");
    ui.ollamaText.textContent = "Ollama sem resposta";
    ui.ollamaModel.textContent = "Modelo: -";
    return;
  }

  const modelText = status.modelConfigured ? `Modelo: ${status.modelConfigured}` : "Modelo: -";
  ui.ollamaModel.textContent = modelText;

  if (status.reachable && status.modelInstalled) {
    badge.classList.add("ok");
    ui.ollamaText.textContent = "Ollama pronto";
    return;
  }

  if (status.reachable && !status.modelInstalled) {
    badge.classList.add("warn");
    ui.ollamaText.textContent = "Ollama online (modelo ausente)";
    return;
  }

  badge.classList.add("down");
  ui.ollamaText.textContent = "Ollama offline";
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
      };
    }

    return {
      ...n,
      x: spawnMinX + Math.random() * Math.max(1, spawnMaxX - spawnMinX),
      y: spawnMinY + Math.random() * Math.max(1, spawnMaxY - spawnMinY),
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      phase: Math.random() * Math.PI * 2,
      driftSeed: Math.random() * Math.PI * 2,
      driftSpeed: 0.01 + Math.random() * 0.02,
    };
  });

  sim.links = (graph.links || []).map((l) => ({ ...l }));
}

function tickSimulation() {
  if (!sim.nodes.length) return;

  const centerX = world.width / 2;
  const centerY = world.height / 2;
  const damping = 0.965;
  const nodeById = new Map(sim.nodes.map((n) => [n.id, n]));

  for (let i = 0; i < sim.nodes.length; i += 1) {
    for (let j = i + 1; j < sim.nodes.length; j += 1) {
      const a = sim.nodes[i];
      const b = sim.nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist2 = dx * dx + dy * dy + 0.01;
      const dist = Math.sqrt(dist2);
      dx /= dist;
      dy /= dist;
      const force = 1800 / dist2;
      a.vx -= dx * force;
      a.vy -= dy * force;
      b.vx += dx * force;
      b.vy += dy * force;
    }
  }

  for (const link of sim.links) {
    const a = nodeById.get(link.source);
    const b = nodeById.get(link.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const target = 220 - Math.min(60, (link.weight || 0) * 140);
    const spring = (dist - target) * 0.0032;
    const ux = dx / dist;
    const uy = dy / dist;
    a.vx += ux * spring;
    a.vy += uy * spring;
    b.vx -= ux * spring;
    b.vy -= uy * spring;
  }

  for (const node of sim.nodes) {
    node.phase += node.driftSpeed;
    node.vx += Math.cos(node.phase + node.driftSeed) * 0.018;
    node.vy += Math.sin(node.phase * 0.92 + node.driftSeed) * 0.018;

    node.vx += (centerX - node.x) * 0.00012;
    node.vy += (centerY - node.y) * 0.00012;

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
    const alpha = Math.min(0.8, 0.1 + (link.weight || 0) * 1.3);
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = (1 + (link.weight || 0) * 2.2) / camera.zoom;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  for (const node of sim.nodes) {
    node.phase += 0.03;
    const pulse = Math.sin(node.phase) * 0.8;
    const coreRadius = Math.max(8, node.radius + pulse);

    const glowRadius = coreRadius * 1.7;
    const grd = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowRadius);
    grd.addColorStop(0, "rgba(157,247,229,0.95)");
    grd.addColorStop(1, "rgba(126,200,255,0.08)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(126,200,255,0.95)";
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
}

function bindEvents() {
  controls.startDaemon.addEventListener("click", () => daemonStart().catch(alertError));
  controls.stopDaemon.addEventListener("click", () => daemonStop().catch(alertError));
  controls.restartDaemon.addEventListener("click", () => daemonRestart().catch(alertError));
  controls.syncNow.addEventListener("click", () => syncNow().catch(alertError));
  controls.newContext.addEventListener("click", () => createNewContext().catch(alertError));
  controls.refreshContexts.addEventListener("click", () => loadContexts().catch(alertError));
  controls.saveContext.addEventListener("click", () => saveSelectedContext().catch(alertError));

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
  bindEvents();
  resizeCanvas();
  await loadContexts();
  await loadGraph();
  await loadOllamaStatus();

  if (liveRefreshTimer) clearInterval(liveRefreshTimer);
  liveRefreshTimer = setInterval(() => {
    void loadGraph();
  }, 3000);

  if (ollamaStatusTimer) clearInterval(ollamaStatusTimer);
  ollamaStatusTimer = setInterval(() => {
    void loadOllamaStatus();
  }, 7000);

  animate();
}

boot().catch(alertError);
