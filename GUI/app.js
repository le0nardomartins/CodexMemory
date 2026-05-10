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
  toggleAreaLabelsText: document.getElementById("toggleAreaLabelsText"),
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
  centerFoundationBtn: document.getElementById("centerFoundationBtn"),
  toggleAreaLabels: document.getElementById("toggleAreaLabels"),
};

const ctx = ui.canvas.getContext("2d");
const sim = { nodes: [], links: [], areaZones: [], animationId: null };
const world = { width: 1880, height: 1180, padding: 92 };
const FOUNDATION_CONTEXT_FILE = "context_1.md";
const AREA_PALETTES = {
  REQUIREMENT_UNDERSTANDING: [204, 220],
  PROJECT_MEMORY: [258, 276],
  ARCHITECTURE_AND_DESIGN: [34, 48],
  CODE_REASONING: [330, 346],
  QUALITY_AND_SECURITY: [146, 164],
  EXECUTION_AND_TOOLING: [14, 28],
  INCREMENTAL_LEARNING: [286, 300],
  UNASSIGNED: [210, 226],
};
const DEFAULT_AREA_CODE = "INCREMENTAL_LEARNING";
const FOUNDATION_VISUAL_SCALE = 5;
const NEURON_VISUAL_SCALE = 2.82;
const AREA_LABEL_VISIBILITY_KEY = "codexmemory.show_area_labels";
const KNOWN_AREA_CODES = new Set([
  "REQUIREMENT_UNDERSTANDING",
  "PROJECT_MEMORY",
  "ARCHITECTURE_AND_DESIGN",
  "CODE_REASONING",
  "QUALITY_AND_SECURITY",
  "EXECUTION_AND_TOOLING",
  "INCREMENTAL_LEARNING",
]);
const camera = {
  x: 0,
  y: 0,
  zoom: 1,
  minZoom: 0.000001,
  maxZoom: 12,
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
let graphRequestInFlight = false;
let statusRequestInFlight = false;
let memoryRequestInFlight = false;
let daemonStatusInitialized = false;
let lastDaemonRunAtSeen = "";
const GRAPH_CACHE_KEY = "codexmemory.neuron_graph.v1";
let showAreaLabels = true;

try {
  const savedVisibility = localStorage.getItem(AREA_LABEL_VISIBILITY_KEY);
  if (savedVisibility === "0") showAreaLabels = false;
} catch {
  // noop
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function isFoundationNode(node) {
  if (!node) return false;
  const id = String(node.id || "").toLowerCase();
  const label = String(node.label || "").toLowerCase();
  return id === FOUNDATION_CONTEXT_FILE || label === FOUNDATION_CONTEXT_FILE;
}

function normalizeAreaForGraph(areaCode) {
  const normalized = String(areaCode || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (KNOWN_AREA_CODES.has(normalized)) return normalized;
  return DEFAULT_AREA_CODE;
}

function areaLabel(areaCode) {
  const normalized = normalizeAreaForGraph(areaCode);
  const translated = t(`area.${normalized}`);
  if (translated && translated !== `area.${normalized}`) return translated;
  return normalized.replace(/_/g, " ");
}

function hashString(str) {
  let h = 2166136261;
  const s = String(str || "");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function createSeededRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1000000) / 1000000;
  };
}

function areaHue(area, seed = 0) {
  const key = normalizeAreaForGraph(area);
  const palette = AREA_PALETTES[key] || AREA_PALETTES.UNASSIGNED;
  const base = palette[0];
  const alt = palette[1];
  const mix = ((seed % 997) / 996) * 0.6 + 0.2;
  return base + (alt - base) * mix;
}

function buildRadialSpawnSlots(count, centerX, centerY, worldW, worldH, padding) {
  if (count <= 0) return [];
  const slots = [];
  const minWorld = Math.min(worldW, worldH);
  const firstRingRadius = clamp(minWorld * 0.2, 120, 240);
  const ringGap = clamp(minWorld * 0.11, 82, 150);
  const minChord = clamp(minWorld * 0.095, 86, 130);
  const maxR = Math.max(1, minWorld * 0.5 - padding - 10);
  let ring = 0;

  while (slots.length < count) {
    const radius = Math.min(firstRingRadius + ring * ringGap, maxR);
    const circumference = Math.max(1, 2 * Math.PI * radius);
    const capacity = Math.max(6, Math.floor(circumference / minChord));
    const angleOffset = ((ring * 0.61803398875) % 1) * Math.PI * 2;
    for (let i = 0; i < capacity && slots.length < count; i += 1) {
      const angle = angleOffset + (i / capacity) * Math.PI * 2;
      let x = centerX + Math.cos(angle) * radius;
      let y = centerY + Math.sin(angle) * radius;
      x = clamp(x, padding, worldW - padding);
      y = clamp(y, padding, worldH - padding);
      slots.push({ x, y, radius, ring });
    }
    ring += 1;
    if (radius >= maxR) break;
  }
  return slots;
}

function buildZoneSlots(count, centerX, centerY, radius, seed = 1) {
  if (count <= 0) return [];
  const slots = [];
  const rnd = createSeededRandom(seed);
  const densityFactor = clamp(Math.sqrt(count) / 5.5, 0.72, 1.42);
  const inner = radius * (0.03 + rnd() * 0.1);
  const outer = radius * (0.98 + rnd() * 0.14);
  const minDistBase = clamp(radius * (0.3 + densityFactor * 0.16), 74, 190);

  let tries = 0;
  while (slots.length < count && tries < count * 560) {
    tries += 1;
    const angle = rnd() * Math.PI * 2 + Math.sin((tries + seed) * 0.17) * 0.18;
    const r = inner + (outer - inner) * Math.pow(rnd(), 0.74);
    const x = centerX + Math.cos(angle) * r;
    const y = centerY + Math.sin(angle) * r;
    const relaxation = tries > count * 420
      ? 0.78
      : tries > count * 280
        ? 0.88
        : 1;
    const minDist = minDistBase * relaxation;
    let ok = true;
    for (const s of slots) {
      if (Math.hypot(x - s.x, y - s.y) < minDist) {
        ok = false;
        break;
      }
    }
    if (ok) slots.push({ x, y });
  }

  while (slots.length < count) {
    const angle = rnd() * Math.PI * 2;
    const r = inner + (outer - inner) * Math.pow(rnd(), 0.74);
    slots.push({
      x: centerX + Math.cos(angle) * r,
      y: centerY + Math.sin(angle) * r,
    });
  }
  return slots;
}

function buildAreaZones(nodes, centerX, centerY, worldW, worldH, padding) {
  const grouped = new Map();
  for (const node of nodes) {
    const area = normalizeAreaForGraph(node.area);
    if (!grouped.has(area)) grouped.set(area, []);
    grouped.get(area).push(node);
  }
  const areas = [...grouped.keys()].sort((a, b) => a.localeCompare(b, "en"));
  if (!areas.length) return [];

  const minWorld = Math.min(worldW, worldH);
  const zoneRadiusBase = clamp(minWorld * 0.128, 138, 292);
  const orbitBase = clamp(minWorld * 0.47, 520, 1680);
  const centralExclusion = clamp(minWorld * 0.24, 300, 740);
  const pairGap = clamp(minWorld * 0.045, 120, 260);
  const ringSeed = hashString(areas.join("|"));
  const phaseOffset = ((ringSeed % 997) / 996) * Math.PI * 2;
  const zones = [];

  for (let i = 0; i < areas.length; i += 1) {
    const area = areas[i];
    const areaNodes = grouped.get(area) || [];
    const seed = hashString(`${area}:${i}`);
    const rnd = createSeededRandom(seed);
    const nodeScale = clamp(0.9 + Math.log2(Math.max(2, areaNodes.length + 1)) * 0.18, 0.88, 1.3);
    const zoneRadius = clamp(zoneRadiusBase * nodeScale * (0.9 + rnd() * 0.18), 128, 330);
    const angleBase = phaseOffset + (i / areas.length) * Math.PI * 2;
    const angle = angleBase + (rnd() - 0.5) * 0.42;
    const orbit = orbitBase * (0.93 + (rnd() - 0.5) * 0.2);
    let x = centerX + Math.cos(angle) * orbit;
    let y = centerY + Math.sin(angle) * orbit;
    x = clamp(x, padding + zoneRadius, worldW - padding - zoneRadius);
    y = clamp(y, padding + zoneRadius, worldH - padding - zoneRadius);

    const dx = x - centerX;
    const dy = y - centerY;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < centralExclusion + zoneRadius) {
      const k = (centralExclusion + zoneRadius) / dist;
      x = centerX + dx * k;
      y = centerY + dy * k;
      x = clamp(x, padding + zoneRadius, worldW - padding - zoneRadius);
      y = clamp(y, padding + zoneRadius, worldH - padding - zoneRadius);
    }

    zones.push({
      area,
      centerX: x,
      centerY: y,
      radius: zoneRadius,
      nodes: areaNodes,
      seed,
    });
  }

  for (let step = 0; step < 46; step += 1) {
    for (let i = 0; i < zones.length; i += 1) {
      const a = zones[i];
      for (let j = i + 1; j < zones.length; j += 1) {
        const b = zones[j];
        const dx = b.centerX - a.centerX;
        const dy = b.centerY - a.centerY;
        const dist = Math.hypot(dx, dy) || 1;
        const minDist = a.radius + b.radius + pairGap;
        if (dist >= minDist) continue;
        const push = (minDist - dist) * 0.11;
        const ux = dx / dist;
        const uy = dy / dist;
        a.centerX -= ux * push;
        a.centerY -= uy * push;
        b.centerX += ux * push;
        b.centerY += uy * push;
      }
      const toCx = a.centerX - centerX;
      const toCy = a.centerY - centerY;
      const d = Math.hypot(toCx, toCy) || 1;
      const minOrbit = centralExclusion + a.radius * 0.68;
      const maxOrbit = orbitBase * 1.18 + a.radius * 0.52;
      if (d < minOrbit) {
        const k = minOrbit / d;
        a.centerX = centerX + toCx * k;
        a.centerY = centerY + toCy * k;
      } else if (d > maxOrbit) {
        const pull = (d - maxOrbit) * 0.085;
        a.centerX -= (toCx / d) * pull;
        a.centerY -= (toCy / d) * pull;
      }
      a.centerX = clamp(a.centerX, padding + a.radius, worldW - padding - a.radius);
      a.centerY = clamp(a.centerY, padding + a.radius, worldH - padding - a.radius);
    }
  }

  return zones;
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
    ["centerFoundationBtn", "button.centerFoundation"],
    ["neuralTitle", "title.neural"],
    ["toggleAreaLabelsText", "toggle.areaLabels"],
    ["ollamaText", "status.ollamaChecking"],
    ["ollamaModel", "label.modelUnknown"],
  ];
  for (const [id, key] of map) {
    const el = document.getElementById(id);
    if (el) el.textContent = t(key);
  }
  if (controls.centerFoundationBtn) {
    const translated = t("button.centerFoundation");
    const label = translated === "button.centerFoundation" ? "Recentralizar" : translated;
    controls.centerFoundationBtn.textContent = label;
    controls.centerFoundationBtn.setAttribute("title", label);
    controls.centerFoundationBtn.setAttribute("aria-label", label);
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
  if (memoryRequestInFlight) return;
  memoryRequestInFlight = true;
  try {
    const data = await api("/api/memory");
    ui.memoryViewer.value = data.text || "";
  } catch {
    ui.memoryViewer.value = "";
  } finally {
    memoryRequestInFlight = false;
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
  if (statusRequestInFlight) return;
  statusRequestInFlight = true;
  try {
    const status = await api("/api/status");
    renderDaemonStatus(status.daemon || null);
    renderOllamaStatus(status.ollama || null);
    const currentRunAt = String((status.daemon && status.daemon.lastRunAt) || "");
    if (!daemonStatusInitialized) {
      daemonStatusInitialized = true;
      lastDaemonRunAtSeen = currentRunAt;
    } else if (currentRunAt && currentRunAt !== lastDaemonRunAtSeen) {
      lastDaemonRunAtSeen = currentRunAt;
      void loadGraph();
    }
  } catch {
    renderDaemonStatus(null);
    renderOllamaStatus(null);
  } finally {
    statusRequestInFlight = false;
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

  if (String(status.engine || "").toLowerCase() === "algorithm") {
    badge.classList.add("ok");
    ui.ollamaText.textContent = t("status.algorithmMode");
    return;
  }

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
  await loadDaemonStatus();
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
  camera.zoom = clamp(Math.min(zx, zy) * 0.84, camera.minZoom, 1.05);
  camera.x = (viewW - world.width * camera.zoom) / 2;
  camera.y = (viewH - world.height * camera.zoom) / 2;
  clampCamera();
}

function centerCameraOnFoundation(zoomOutFactor = 0.82) {
  const viewW = ui.canvas.clientWidth || 1;
  const viewH = ui.canvas.clientHeight || 1;
  const foundationNode = sim.nodes.find((n) => isFoundationNode(n));
  const fx = foundationNode ? foundationNode.x : world.width * 0.5;
  const fy = foundationNode ? foundationNode.y : world.height * 0.5;
  const fitZoom = Math.min(viewW / world.width, viewH / world.height);
  camera.zoom = clamp(fitZoom * zoomOutFactor, camera.minZoom, 1.05);
  camera.x = viewW * 0.5 - fx * camera.zoom;
  camera.y = viewH * 0.5 - fy * camera.zoom;
  camera.userInteracted = true;
  clampCamera();
}

function clampCamera() {
  // Canvas infinito: sem limites de pan no mundo.
  // Mantemos a funcao para preservar os call sites.
}

function screenToWorld(screenX, screenY) {
  return {
    x: (screenX - camera.x) / camera.zoom,
    y: (screenY - camera.y) / camera.zoom,
  };
}

function initSimulation(graph) {
  const nodeCount = Math.max(1, (graph.nodes || []).length);
  const targetWorldW = clamp(Math.ceil(Math.sqrt(nodeCount) * 900), 1400, 12000);
  const targetWorldH = clamp(Math.ceil(Math.sqrt(nodeCount) * 720), 980, 9400);
  world.width = targetWorldW;
  world.height = targetWorldH;

  const byId = new Map(sim.nodes.map((n) => [n.id, n]));
  const centerX = world.width * 0.5;
  const centerY = world.height * 0.5;
  const spawnMinX = world.padding;
  const spawnMaxX = world.width - world.padding;
  const spawnMinY = world.padding;
  const spawnMaxY = world.height - world.padding;
  const graphNodes = (graph.nodes || []).map((n) => ({
    ...n,
    area: normalizeAreaForGraph(n.area),
  }));
  const nonFoundationNodes = graphNodes.filter((n) => !isFoundationNode(n));
  const areaZones = buildAreaZones(nonFoundationNodes, centerX, centerY, world.width, world.height, world.padding);
  sim.areaZones = areaZones;
  const slotById = new Map();
  for (const zone of areaZones) {
    const slots = buildZoneSlots(
      zone.nodes.length,
      zone.centerX,
      zone.centerY,
      zone.radius,
      hashString(`${zone.area}:${zone.nodes.length}`),
    );
    for (let i = 0; i < zone.nodes.length; i += 1) {
      const node = zone.nodes[i];
      const slot = slots[i] || { x: zone.centerX, y: zone.centerY };
      slotById.set(node.id, {
        x: clamp(slot.x, spawnMinX, spawnMaxX),
        y: clamp(slot.y, spawnMinY, spawnMaxY),
      });
    }
  }

  sim.nodes = graphNodes.map((n) => {
    const foundation = isFoundationNode(n);
    const slot = slotById.get(n.id);
    const existing = byId.get(n.id);
    if (existing) {
      const targetX = slot ? slot.x : clamp(existing.x, spawnMinX, spawnMaxX);
      const targetY = slot ? slot.y : clamp(existing.y, spawnMinY, spawnMaxY);
      const x = foundation ? centerX : targetX;
      const y = foundation ? centerY : targetY;
      return {
        ...existing,
        ...n,
        x,
        y,
        vx: foundation ? 0 : existing.vx,
        vy: foundation ? 0 : existing.vy,
        phase: existing.phase,
        driftSeed: existing.driftSeed,
        driftSpeed: foundation ? 0 : clamp(existing.driftSpeed || 0.0052, 0.0018, 0.0055),
        colorHue: foundation ? 200 : existing.colorHue,
        glowBias: foundation ? 1.4 : existing.glowBias,
        wobbleA: existing.wobbleA,
        wobbleB: existing.wobbleB,
        homeX: foundation ? centerX : targetX,
        homeY: foundation ? centerY : targetY,
        orbitX: foundation ? 0 : clamp(existing.orbitX || 11.5, 6, 16),
        orbitY: foundation ? 0 : clamp(existing.orbitY || 10, 5, 14),
        orbitPhaseX: existing.orbitPhaseX,
        orbitPhaseY: existing.orbitPhaseY,
        maxOrbitRadius: foundation ? 1 : clamp(existing.maxOrbitRadius || 27, 18, 35),
      };
    }

    let x = spawnMinX + Math.random() * Math.max(1, spawnMaxX - spawnMinX);
    let y = spawnMinY + Math.random() * Math.max(1, spawnMaxY - spawnMinY);
    if (!foundation) {
      if (slot) {
        x = slot.x;
        y = slot.y;
      } else {
        const fallbackSlots = buildRadialSpawnSlots(1, centerX, centerY, world.width, world.height, world.padding);
        x = clamp(fallbackSlots[0].x, spawnMinX, spawnMaxX);
        y = clamp(fallbackSlots[0].y, spawnMinY, spawnMaxY);
      }
    } else {
      x = centerX;
      y = centerY;
    }
    return {
      ...n,
      x,
      y,
      vx: foundation ? 0 : (Math.random() - 0.5) * 0.08,
      vy: foundation ? 0 : (Math.random() - 0.5) * 0.08,
      phase: Math.random() * Math.PI * 2,
      driftSeed: Math.random() * Math.PI * 2,
      driftSpeed: foundation ? 0 : 0.0018 + Math.random() * 0.0037,
      colorHue: foundation ? 200 : 175 + Math.random() * 70,
      glowBias: foundation ? 1.4 : 0.75 + Math.random() * 0.5,
      wobbleA: 0.6 + Math.random() * 1.5,
      wobbleB: 0.6 + Math.random() * 1.5,
      homeX: x,
      homeY: y,
      orbitX: foundation ? 0 : 6 + Math.random() * 10,
      orbitY: foundation ? 0 : 5 + Math.random() * 9,
      orbitPhaseX: Math.random() * Math.PI * 2,
      orbitPhaseY: Math.random() * Math.PI * 2,
      maxOrbitRadius: foundation ? 1 : 18 + Math.random() * 17,
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
  const nodeById = new Map(sim.nodes.map((n) => [n.id, n]));
  const crossById = new Map();
  const boundaryAreaById = new Map();
  for (const link of sim.links) {
    const a = nodeById.get(link.source);
    const b = nodeById.get(link.target);
    if (!a || !b) continue;
    if (String(a.area || "") === String(b.area || "")) continue;
    crossById.set(a.id, (crossById.get(a.id) || 0) + 1);
    crossById.set(b.id, (crossById.get(b.id) || 0) + 1);
    if (!boundaryAreaById.has(a.id)) boundaryAreaById.set(a.id, normalizeAreaForGraph(b.area));
    if (!boundaryAreaById.has(b.id)) boundaryAreaById.set(b.id, normalizeAreaForGraph(a.area));
  }
  for (const node of sim.nodes) {
    node.crossAreaLinks = crossById.get(node.id) || 0;
    node.boundaryArea = boundaryAreaById.get(node.id) || null;
    node.vx = 0;
    node.vy = 0;
  }
}

function findHoveredNode(screenX, screenY) {
  const worldPt = screenToWorld(screenX, screenY);
  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const node of sim.nodes) {
    const dist = Math.hypot(worldPt.x - node.x, worldPt.y - node.y);
    const hoverRadius = isFoundationNode(node)
      ? node.radius * 3.2 * FOUNDATION_VISUAL_SCALE
      : node.radius * Math.max(1.8, NEURON_VISUAL_SCALE * 1.04);
    if (dist <= hoverRadius && dist < bestDist) {
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
  const area = areaLabel(node.area);
  ui.nodeTooltip.textContent = `${t("tooltip.references", { name: node.label, count: node.refCount || 0 })} | ${area}`;
  ui.nodeTooltip.style.left = `${clientX + 14}px`;
  ui.nodeTooltip.style.top = `${clientY + 14}px`;
  ui.nodeTooltip.classList.add("visible");
  ui.nodeTooltip.setAttribute("aria-hidden", "false");
}

function tickSimulation() {
  if (!sim.nodes.length) return;
  flowTick += 0.018;
  const foundationNode = sim.nodes.find((n) => isFoundationNode(n)) || null;
  if (foundationNode) {
    foundationNode.homeX = world.width * 0.5;
    foundationNode.homeY = world.height * 0.5;
    foundationNode.x = foundationNode.homeX;
    foundationNode.y = foundationNode.homeY;
    foundationNode.vx = 0;
    foundationNode.vy = 0;
  }
}

function drawRoundedRectPath(x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width * 0.5, height * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function buildAreaLabelLayouts(zones, centerX, centerY, fontPx, padX, padY) {
  const layouts = [];
  const safeZones = Array.isArray(zones) ? zones : [];
  for (let i = 0; i < safeZones.length; i += 1) {
    const zone = safeZones[i];
    const label = areaLabel(zone.area);
    const dx = zone.centerX - centerX;
    const dy = zone.centerY - centerY;
    const dist = Math.hypot(dx, dy);
    const angle = dist > 0.001
      ? Math.atan2(dy, dx)
      : ((i / Math.max(1, safeZones.length)) * Math.PI * 2) - Math.PI * 0.5;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const radialOffset = zone.radius + 28 / camera.zoom;
    let x = zone.centerX + ux * radialOffset;
    let y = zone.centerY + uy * radialOffset;
    const width = Math.max(70 / camera.zoom, ctx.measureText(label).width + padX * 2);
    const height = fontPx + padY * 2;
    x = clamp(x, world.padding + width * 0.5, world.width - world.padding - width * 0.5);
    y = clamp(y, world.padding + height * 0.5, world.height - world.padding - height * 0.5);
    layouts.push({
      text: label,
      x,
      y,
      width,
      height,
    });
  }

  for (let pass = 0; pass < 14; pass += 1) {
    for (let i = 0; i < layouts.length; i += 1) {
      const a = layouts[i];
      for (let j = i + 1; j < layouts.length; j += 1) {
        const b = layouts[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const overlapX = (a.width + b.width) * 0.5 - Math.abs(dx);
        const overlapY = (a.height + b.height) * 0.5 - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        const pushY = (overlapY + 2 / camera.zoom) * 0.5;
        const dir = dy >= 0 ? 1 : -1;
        a.y -= dir * pushY;
        b.y += dir * pushY;
      }
    }
    for (const item of layouts) {
      item.x = clamp(
        item.x,
        world.padding + item.width * 0.5,
        world.width - world.padding - item.width * 0.5,
      );
      item.y = clamp(
        item.y,
        world.padding + item.height * 0.5,
        world.height - world.padding - item.height * 0.5,
      );
    }
  }

  return layouts;
}

function drawSimulation() {
  const w = ui.canvas.clientWidth;
  const h = ui.canvas.clientHeight;
  if (!w || !h) return;
  const viewLeft = (-camera.x) / camera.zoom;
  const viewTop = (-camera.y) / camera.zoom;
  const viewRight = viewLeft + w / camera.zoom;
  const viewBottom = viewTop + h / camera.zoom;
  const viewMargin = 140 / camera.zoom;

  const isCircleVisible = (x, y, r) => (
    x + r >= viewLeft - viewMargin
    && x - r <= viewRight + viewMargin
    && y + r >= viewTop - viewMargin
    && y - r <= viewBottom + viewMargin
  );
  const isSegmentVisible = (x1, y1, x2, y2) => {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    return !(
      maxX < viewLeft - viewMargin
      || minX > viewRight + viewMargin
      || maxY < viewTop - viewMargin
      || minY > viewBottom + viewMargin
    );
  };

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
    if (!isSegmentVisible(a.x, a.y, b.x, b.y)) continue;
    const isFoundationAnchor = Array.isArray(link.shared) && link.shared.includes("foundation-anchor");
    const weight = clamp(Number(link.weight) || 0, 0, 1.4);
    const alpha = isFoundationAnchor ? 0.42 : 0.58;
    const lineWidthPx = isFoundationAnchor ? 0.88 : 1.16;
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    // Mantem espessura minima visivel e maxima controlada na tela.
    ctx.lineWidth = lineWidthPx / camera.zoom;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    // Fluxo linear de "informacao" percorrendo a sinapse
    const beads = isFoundationAnchor ? 1 : 2;
    for (let i = 0; i < beads; i += 1) {
      const t = (flowTick * (0.42 + (link.weight || 0) * 0.33) + i * 0.48) % 1;
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      const radius = ((isFoundationAnchor ? 1.3 : 1.8) + (link.weight || 0) * 1.1) / camera.zoom;
      const beadAlpha = 0.38 + (1 - Math.abs(0.5 - t) * 1.6) * 0.34;
      ctx.fillStyle = `rgba(157,247,229,${Math.max(0.2, beadAlpha)})`;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const drawOrder = sim.nodes.filter((n) => !isFoundationNode(n));
  const foundationNode = sim.nodes.find((n) => isFoundationNode(n));
  if (foundationNode) drawOrder.push(foundationNode);

  for (const node of drawOrder) {
    const foundation = isFoundationNode(node);
    const baseHue = areaHue(node.area, hashString(node.id || node.label || ""));
    let finalHue = foundation ? 196 : baseHue;
    const cross = Number(node.crossAreaLinks || 0);
    if (!foundation && cross > 0) {
      const mixHue = areaHue(normalizeAreaForGraph(node.boundaryArea || node.area), hashString(`${node.id}:mix`));
      const blend = clamp(0.12 + cross * 0.05, 0.12, 0.34);
      const delta = ((((mixHue - finalHue) % 360) + 540) % 360) - 180;
      finalHue = (finalHue + delta * blend + 360) % 360;
    }
    const coreBase = foundation
      ? node.radius * 3.35 * FOUNDATION_VISUAL_SCALE
      : node.radius * NEURON_VISUAL_SCALE;
    const coreRadius = Math.max(8, coreBase);

    const glowRadius = coreRadius * (foundation ? 2.95 : 1.7 + node.glowBias * 0.5);
    if (!isCircleVisible(node.x, node.y, glowRadius)) continue;
    const hue = Math.round(finalHue);
    const sat = foundation ? 82 : 78;
    const lightCore = foundation
      ? Math.max(66, Math.min(86, 74 + node.glowBias * 5))
      : Math.max(52, Math.min(74, 58 + node.glowBias * 7));
    const lightGlow = foundation
      ? Math.max(56, Math.min(80, lightCore - 4))
      : Math.max(42, Math.min(68, lightCore - 7));
    const grd = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowRadius);
    grd.addColorStop(0, `hsla(${hue}, ${sat}%, ${lightGlow}%, ${foundation ? 0.96 : 0.9})`);
    grd.addColorStop(0.6, `hsla(${hue}, ${sat}%, ${Math.max(36, lightGlow - 8)}%, ${foundation ? 0.28 : 0.18})`);
    grd.addColorStop(0.86, `hsla(${hue}, ${sat}%, ${Math.max(30, lightGlow - 14)}%, ${foundation ? 0.08 : 0.04})`);
    grd.addColorStop(1, `hsla(${hue}, ${sat}%, ${Math.max(26, lightGlow - 18)}%, 0)`);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `hsla(${hue}, ${sat}%, ${lightCore}%, 0.98)`;
    ctx.beginPath();
    ctx.arc(node.x, node.y, coreRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw labels last so they are never hidden behind neurons or links.
  if (showAreaLabels) {
    const labelFontPx = Math.max(10, Math.round(12 / camera.zoom));
    const labelPadX = 9 / camera.zoom;
    const labelPadY = 5 / camera.zoom;
    ctx.font = `600 ${labelFontPx}px Segoe UI`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const labelLayouts = buildAreaLabelLayouts(
      sim.areaZones,
      world.width * 0.5,
      world.height * 0.5,
      labelFontPx,
      labelPadX,
      labelPadY,
    );
    for (const item of labelLayouts) {
      if (!isCircleVisible(item.x, item.y, Math.max(item.width, item.height))) continue;
      const x = item.x - item.width * 0.5;
      const y = item.y - item.height * 0.5;
      drawRoundedRectPath(x, y, item.width, item.height, 8 / camera.zoom);
      ctx.fillStyle = "rgba(8, 20, 48, 0.72)";
      ctx.fill();
      ctx.strokeStyle = "rgba(124, 186, 238, 0.62)";
      ctx.lineWidth = 0.9 / camera.zoom;
      ctx.stroke();
      ctx.fillStyle = "rgba(207, 232, 255, 0.96)";
      ctx.fillText(item.text, item.x, item.y + 0.2 / camera.zoom);
    }
  }

  ctx.restore();
}

function animate() {
  tickSimulation();
  drawSimulation();
  sim.animationId = requestAnimationFrame(animate);
}

function normalizeGraphPayload(graph) {
  const safe = graph && typeof graph === "object" ? graph : {};
  return {
    nodes: Array.isArray(safe.nodes) ? safe.nodes : [],
    links: Array.isArray(safe.links) ? safe.links : [],
  };
}

function saveGraphCache(graph) {
  try {
    const payload = {
      updatedAt: new Date().toISOString(),
      graph: normalizeGraphPayload(graph),
    };
    localStorage.setItem(GRAPH_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // noop
  }
}

function restoreGraphCache() {
  try {
    const raw = localStorage.getItem(GRAPH_CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const graph = normalizeGraphPayload(parsed && parsed.graph);
    if (!graph.nodes.length && !graph.links.length) return false;
    state.graph = graph;
    initSimulation(graph);
    if (!camera.userInteracted) {
      fitCameraToWorld();
    } else {
      clampCamera();
    }
    return true;
  } catch {
    return false;
  }
}

async function loadGraph(options = {}) {
  if (graphRequestInFlight) return;
  graphRequestInFlight = true;
  try {
    const snapshotOnly = Boolean(options.snapshotOnly);
    const endpoint = snapshotOnly ? "/api/graph/snapshot" : "/api/graph";
    const graph = normalizeGraphPayload(await api(endpoint));
    if (snapshotOnly && !graph.nodes.length && !graph.links.length) {
      return;
    }
    state.graph = graph;
    initSimulation(graph);
    if (!camera.userInteracted) {
      fitCameraToWorld();
    } else {
      clampCamera();
    }
    saveGraphCache(graph);
  } finally {
    graphRequestInFlight = false;
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
  controls.centerFoundationBtn.addEventListener("click", () => centerCameraOnFoundation(0.8));
  if (controls.toggleAreaLabels) {
    controls.toggleAreaLabels.checked = showAreaLabels;
    controls.toggleAreaLabels.addEventListener("change", () => {
      showAreaLabels = Boolean(controls.toggleAreaLabels.checked);
      try {
        localStorage.setItem(AREA_LABEL_VISIBILITY_KEY, showAreaLabels ? "1" : "0");
      } catch {
        // noop
      }
    });
  }

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
  const restoredFromCache = restoreGraphCache();
  if (!restoredFromCache) {
    // Fast startup: render neurons only from persisted snapshot, without scanning contexts.
    void loadGraph({ snapshotOnly: true });
  }
  await loadOllamaStatus();
  await loadDaemonStatus();
  await loadMemory();
  setActionMessage(t("status.ready"));

  if (liveRefreshTimer) clearInterval(liveRefreshTimer);
  liveRefreshTimer = setInterval(() => {
    void loadDaemonStatus();
  }, 6500);

  if (ollamaStatusTimer) clearInterval(ollamaStatusTimer);
  ollamaStatusTimer = setInterval(() => {
    void loadDaemonStatus();
  }, 7000);

  if (daemonStatusTimer) clearInterval(daemonStatusTimer);
  daemonStatusTimer = setInterval(() => {
    void loadDaemonStatus();
    void loadMemory();
  }, 9000);

  animate();
}

boot().catch(alertError);

