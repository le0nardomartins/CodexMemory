const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const SERVER_NAME = "codex-memory-server";
const SERVER_VERSION = "2.0.0-js";
const DEFAULT_PROMPT_FILENAME = "OLLAMA_PROMPT.md";
const DEFAULT_CODEX_PROMPT_EXAMPLE_FILENAME = "CODEX_PROMPT_EXAMPLE.md";
const DEFAULT_MODEL = "qwen2.5:3b";
const DEFAULT_MEMORY_ENGINE = "ollama";
const DEFAULT_CONTEXT_MAX_CHARS_PER_FILE = 3500;
const DEFAULT_CONTEXT_MAX_TOTAL_CHARS = 22000;
const CONTEXT_COMPRESSION_BATCH_SIZE = 15;
const CONTEXT_COMPRESSION_TRIGGER_COUNT = 20;
const MEMORY_SNAPSHOT_KEEP_COUNT = 10;
const CANONICAL_DECISION_UPDATE_MIN_CONFIDENCE = 0.72;
const AI_PATHS_CONFIG_RELATIVE = path.join("config", "ai_paths.json");
const FOUNDATION_CONTEXT_FILE = "context_1.md";
const BRAIN_AREAS = [
  {
    name: "REQUIREMENT_UNDERSTANDING",
    description: "User intent, acceptance criteria, constraints, and task scope interpretation.",
  },
  {
    name: "PROJECT_MEMORY",
    description: "Persistent project knowledge, conventions, decisions, and repository specific preferences.",
  },
  {
    name: "ARCHITECTURE_AND_DESIGN",
    description: "System structure, module boundaries, interfaces, and design trade-offs.",
  },
  {
    name: "CODE_REASONING",
    description: "Implementation logic, algorithms, data flow, and code-level problem solving.",
  },
  {
    name: "QUALITY_AND_SECURITY",
    description: "Testing, reliability, regression prevention, security hardening, and performance risks.",
  },
  {
    name: "EXECUTION_AND_TOOLING",
    description: "Build, runtime, scripts, automation, CI/CD, terminal workflows, and operational tooling.",
  },
  {
    name: "INCREMENTAL_LEARNING",
    description: "Classification of new contexts, memory evolution, and long-term adaptive refinement.",
  },
];

class TerminalUI {
  constructor() {
    this.line = "-".repeat(78);
  }

  nowStamp() {
    const d = new Date();
    const pad = (v) => String(v).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
      d.getHours(),
    )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  banner() {
    this.stderr(this.line);
    this.stderr(`[${this.nowStamp()}] [BOOT] Inicializando ${SERVER_NAME} (${SERVER_VERSION})`);
    this.stderr(this.line);
  }

  stderr(message) {
    process.stderr.write(`${message}\n`);
  }

  info(stage, message) {
    this.stderr(`[${this.nowStamp()}] [${stage.padEnd(10, " ")}] ${message}`);
  }

  warn(stage, message) {
    this.info(`${stage} WARN`, message);
  }

  error(stage, message) {
    this.info(`${stage} ERROR`, message);
  }
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

function normalizePathForPrompt(p) {
  return path.resolve(String(p || "")).replace(/\\/g, "/");
}

function resolvePathFromRoot(root, rawValue, fallbackRelative) {
  const raw = String(rawValue || "").trim();
  if (!raw) {
    return path.resolve(root, fallbackRelative);
  }
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
}

function normalizeMemoryEngine(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) return DEFAULT_MEMORY_ENGINE;
  if (["algorithm", "algo", "rule", "rules", "deterministic", "semantic"].includes(value)) {
    return "algorithm";
  }
  return "ollama";
}

function renderPromptTokens(text, vars) {
  return String(text || "").replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (full, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : full;
  });
}

function buildPromptPathVars(paths) {
  const baseRoot = paths.baseRootPath || path.dirname(paths.root);
  const projectFolder = path.basename(paths.root);
  return {
    BASE_ROOT_PATH: normalizePathForPrompt(baseRoot),
    PROJECT_FOLDER_NAME: projectFolder,
    PROJECT_ROOT_PATH: normalizePathForPrompt(paths.root),
    OLLAMA_PROMPT_PATH: normalizePathForPrompt(paths.promptFile),
    CODEX_PROMPT_EXAMPLE_PATH: normalizePathForPrompt(paths.codexPromptExampleFile),
    AGENT_MEMORY_PATH: normalizePathForPrompt(paths.memoryFile),
    CONTEXT_DIR_PATH: normalizePathForPrompt(paths.contextDir),
    CONTEXT_GLOB_PATH: normalizePathForPrompt(path.join(paths.contextDir, "context_*.md")),
  };
}

function buildAutoPathsBlock() {
  return [
    "<!-- AUTO_PATHS:START -->",
    "BASE_ROOT_PATH={{BASE_ROOT_PATH}}",
    "PROJECT_FOLDER_NAME={{PROJECT_FOLDER_NAME}}",
    "PROJECT_ROOT_PATH={{PROJECT_ROOT_PATH}}",
    "AGENT_MEMORY_PATH={{AGENT_MEMORY_PATH}}",
    "CONTEXT_DIR_PATH={{CONTEXT_DIR_PATH}}",
    "CONTEXT_GLOB_PATH={{CONTEXT_GLOB_PATH}}",
    "OLLAMA_PROMPT_PATH={{OLLAMA_PROMPT_PATH}}",
    "CODEX_PROMPT_EXAMPLE_PATH={{CODEX_PROMPT_EXAMPLE_PATH}}",
    "<!-- AUTO_PATHS:END -->",
  ].join("\n");
}

function injectAutoPathsBlock(originalText, renderedBlock) {
  const source = String(originalText || "");
  const rx = /<!-- AUTO_PATHS:START -->[\s\S]*?<!-- AUTO_PATHS:END -->/m;
  if (!rx.test(source)) return source;
  return source.replace(rx, renderedBlock);
}

async function syncPromptPathBlocks(paths, ui) {
  const files = [paths.promptFile, paths.codexPromptExampleFile];
  const renderedBlock = buildAutoPathsBlock();

  for (const abs of files) {
    if (!fs.existsSync(abs)) continue;
    const current = await fsp.readFile(abs, "utf8");
    const next = injectAutoPathsBlock(current, renderedBlock);
    if (next !== current) {
      await fsp.writeFile(abs, next, "utf8");
      ui.info("CONFIG", `Bloco AUTO_PATHS atualizado em ${normalizePathForPrompt(abs)}`);
    }
  }
}

async function walkMarkdownFiles(baseDir) {
  const result = [];
  async function walk(currentDir) {
    let entries = [];
    try {
      entries = await fsp.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        result.push(abs);
      }
    }
  }
  await walk(baseDir);
  result.sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));
  return result;
}

class AgentMemoryCoordinator {
  constructor(
    paths,
    ui,
    model,
    ollamaHost,
    timeoutSec,
    contextMaxPerFile,
    contextMaxTotal,
    contextRepo,
    memoryEngine = DEFAULT_MEMORY_ENGINE,
  ) {
    this.paths = paths;
    this.promptVars = buildPromptPathVars(paths);
    this.ui = ui;
    this.model = model;
    this.timeoutSec = timeoutSec;
    this.memoryEngine = normalizeMemoryEngine(memoryEngine);
    this.contextMaxPerFile = contextMaxPerFile;
    this.contextMaxTotal = contextMaxTotal;
    this.ollamaUrl = `${ollamaHost.replace(/\/+$/, "")}/api/generate`;
    this.contextRepo = contextRepo || null;
    this.lastMemoryText = "";
    this.lastRefreshSignature = null;
    this.syncStateLoaded = false;
    this.savedSyncState = null;
    this.syncStateFile = path.join(path.dirname(this.paths.memoryFile), ".sync_state.json");
    this.contextStateFile = path.join(path.dirname(this.paths.memoryFile), ".context_state.json");
    this.compressedStateFile = path.join(
      path.dirname(this.paths.memoryFile),
      ".compressed_context_state.json",
    );
    this.canonicalStateFile = path.join(path.dirname(this.paths.memoryFile), ".canonical_state.json");
    this.snapshotDir = path.join(path.dirname(this.paths.memoryFile), "snapshots");
    this.graphSnapshotFile = path.join(path.dirname(this.paths.memoryFile), ".neuron_graph_snapshot.json");
    this.compressedStateLoaded = false;
    this.compressedState = { archivedNodes: [], batches: [], updatedAt: null };
    this.compressedStateVersion = "none";
    this.graphSnapshotLoaded = false;
    this.graphSnapshot = null;
    this.ollamaStatusCache = { checkedAtMs: 0, payload: null };
    this.uniqueRole =
      "Memory curator for CodexMemory: read all context .md files and consolidate a single operational memory in AGENT_MEMORY.md.";
  }

  isOllamaEnabled() {
    return this.memoryEngine === "ollama";
  }

  async contextPaths() {
    if (this.contextRepo) {
      const docs = await this.contextRepo.getContextDocs();
      return docs.map((d) => d.absolutePath);
    }
    return walkMarkdownFiles(this.paths.contextDir);
  }

  async loadPrompt() {
    const raw = await fsp.readFile(this.paths.promptFile, "utf8");
    const content = renderPromptTokens(raw, this.promptVars).trim();
    if (!content) {
      throw new Error(`${path.basename(this.paths.promptFile)} esta vazio.`);
    }
    return content;
  }

  async loadContextDocs() {
    if (this.contextRepo) {
      return this.contextRepo.getContextDocs();
    }
    const files = await this.contextPaths();
    const docs = await Promise.all(
      files.map(async (abs) => {
        const text = (await fsp.readFile(abs, "utf8")).trim();
        return {
          absolutePath: abs,
          relativePath: path.relative(this.paths.root, abs).replace(/\\/g, "/"),
          name: path.basename(abs),
          text,
        };
      }),
    );
    return docs;
  }

  optimizeDocsForPrompt(docs) {
    let usedTotal = 0;
    return docs.map((doc) => {
      const normalized = String(doc.text || "").replace(/\r\n/g, "\n").trim();
      const remaining = Math.max(0, this.contextMaxTotal - usedTotal);
      const allowed = Math.max(0, Math.min(this.contextMaxPerFile, remaining));
      const truncated = normalized.length > allowed;
      const promptText = allowed > 0 ? normalized.slice(0, allowed) : "";
      usedTotal += promptText.length;
      return {
        absolutePath: doc.absolutePath,
        relativePath: doc.relativePath,
        text: doc.text,
        promptText,
        originalChars: normalized.length,
        promptChars: promptText.length,
        truncated,
      };
    });
  }

  buildSystemPrompt(promptMd) {
    return [
      "# System Prompt Principal",
      promptMd,
      "",
      "# Regra de Execucao",
      "- As instrucoes acima sao obrigatorias e tem prioridade maxima.",
      "- Nao ignore, relaxe ou substitua essas regras.",
      `- Papel fixo adicional: ${this.uniqueRole}`,
      "- Always write the final output in English.",
      "- Never output placeholders like '- ...'.",
      "- Never mention your role, agent identity, system prompt, or implementation details in the final memory.",
      "- Assume Codex will NOT read context files directly; AGENT_MEMORY must contain the key facts Codex needs.",
    ]
      .join("\n")
      .trim();
  }

  buildOllamaInput(docs) {
    const optimizedDocs = this.optimizeDocsForPrompt(docs);
    const parts = [
      "# Role",
      this.uniqueRole,
      "",
      "# Required Task",
      "- Read all context files below.",
      "- Produce a single, deduplicated memory summary for AGENT_MEMORY.md.",
      "- Codex will read AGENT_MEMORY, not the context files. Include the key context facts explicitly.",
      "- Keep only useful, reusable and current information.",
      "- Convert relevant context details into direct, actionable bullets in the target sections.",
      "- Output Markdown only.",
      "",
      "# Context Files",
    ];

    if (optimizedDocs.length === 0) {
      parts.push("[NO CONTEXT FILES]");
    } else {
      for (const doc of optimizedDocs) {
        parts.push(`### ${doc.relativePath} (chars ${doc.promptChars}/${doc.originalChars})`);
        parts.push(doc.promptText || "(empty file)");
        if (doc.truncated) {
          parts.push("... [TRUNCATED FOR PERFORMANCE]");
        }
        parts.push("");
      }
    }
    return parts.join("\n").trim();
  }

  async loadContextState() {
    try {
      if (!fs.existsSync(this.contextStateFile)) return { hashes: {}, metrics: {} };
      const raw = await fsp.readFile(this.contextStateFile, "utf8");
      const parsed = raw.trim() ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== "object") return { hashes: {}, metrics: {} };
      return {
        hashes: parsed.hashes && typeof parsed.hashes === "object" ? parsed.hashes : {},
        metrics: parsed.metrics && typeof parsed.metrics === "object" ? parsed.metrics : {},
      };
    } catch {
      return { hashes: {}, metrics: {} };
    }
  }

  async saveContextState(payloadInput) {
    const safe = payloadInput && typeof payloadInput === "object" ? payloadInput : {};
    const payload = {
      hashes: safe.hashes && typeof safe.hashes === "object" ? safe.hashes : {},
      metrics: safe.metrics && typeof safe.metrics === "object" ? safe.metrics : {},
      updatedAt: new Date().toISOString(),
    };
    await ensureDir(path.dirname(this.contextStateFile));
    await fsp.writeFile(this.contextStateFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  async loadCompressedState() {
    if (this.compressedStateLoaded) return this.compressedState;
    try {
      if (!fs.existsSync(this.compressedStateFile)) {
        this.compressedState = { archivedNodes: [], batches: [], updatedAt: null };
        this.compressedStateVersion = "none";
        this.compressedStateLoaded = true;
        return this.compressedState;
      }
      const [raw, st] = await Promise.all([
        fsp.readFile(this.compressedStateFile, "utf8"),
        fsp.stat(this.compressedStateFile),
      ]);
      const parsed = raw.trim() ? JSON.parse(raw) : {};
      const archivedNodes = Array.isArray(parsed.archivedNodes) ? parsed.archivedNodes : [];
      const batches = Array.isArray(parsed.batches) ? parsed.batches : [];
      this.compressedState = {
        archivedNodes,
        batches,
        updatedAt: parsed.updatedAt || null,
      };
      this.compressedStateVersion = `${Math.floor(st.mtimeMs)}|${st.size}`;
    } catch {
      this.compressedState = { archivedNodes: [], batches: [], updatedAt: null };
      this.compressedStateVersion = "error";
    }
    this.compressedStateLoaded = true;
    return this.compressedState;
  }

  async saveCompressedState(state) {
    const safe = state && typeof state === "object" ? state : {};
    const payload = {
      archivedNodes: Array.isArray(safe.archivedNodes) ? safe.archivedNodes : [],
      batches: Array.isArray(safe.batches) ? safe.batches : [],
      updatedAt: new Date().toISOString(),
    };
    await ensureDir(path.dirname(this.compressedStateFile));
    await fsp.writeFile(this.compressedStateFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    this.compressedState = payload;
    this.compressedStateLoaded = true;
    try {
      const st = await fsp.stat(this.compressedStateFile);
      this.compressedStateVersion = `${Math.floor(st.mtimeMs)}|${st.size}`;
    } catch {
      this.compressedStateVersion = payload.updatedAt || String(Date.now());
    }
  }

  getCompressedStateVersion() {
    return this.compressedStateVersion || "none";
  }

  clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  contextNumberFromName(name) {
    const m = String(name || "").match(/^context_(\d+)\.md$/i);
    if (!m) return Number.NaN;
    return Number(m[1]);
  }

  decisionSignalScore(text) {
    const src = String(text || "").toLowerCase();
    if (!src) return 0;
    const rx = /\b(must|should|required|always|never|do not|don't|nao|n[ãa]o|deve|deveria|obrigat[oó]rio|evitar|security|seguran[çc]a|architecture|arquitetura)\b/gi;
    let hits = 0;
    while (rx.exec(src)) hits += 1;
    return this.clamp01(hits / 8);
  }

  jaccardSimilarityFromSets(setA, setB) {
    if (!setA || !setB || setA.size === 0 || setB.size === 0) return 0;
    let inter = 0;
    const small = setA.size <= setB.size ? setA : setB;
    const large = setA.size <= setB.size ? setB : setA;
    for (const token of small) {
      if (large.has(token)) inter += 1;
    }
    const union = setA.size + setB.size - inter;
    return union <= 0 ? 0 : inter / union;
  }

  buildContextQualityMetrics(candidates, assignments, previousMetrics = {}) {
    const items = Array.isArray(candidates) ? candidates : [];
    const numericIds = items
      .map((item) => this.contextNumberFromName(item && item.name))
      .filter((n) => Number.isFinite(n));
    const minN = numericIds.length ? Math.min(...numericIds) : 0;
    const maxN = numericIds.length ? Math.max(...numericIds) : 0;
    const tokenSets = new Map();

    for (const item of items) {
      const tokens = tokenizeForNLP(String((item && item.text) || ""));
      tokenSets.set(String(item && item.name), new Set(tokens.slice(0, 240)));
    }

    const metrics = {};
    for (const item of items) {
      const name = String(item && item.name);
      const text = String((item && item.text) || "");
      const lines = text
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const structuredCount = lines.filter((line) => /^[-*#]|\d+[.)]\s+/.test(line)).length;
      const structuredScore = this.clamp01(structuredCount / 8);
      const decisionScore = this.decisionSignalScore(text);
      const tokenSet = tokenSets.get(name) || new Set();
      const tokenDiversity = this.clamp01(tokenSet.size / 120);

      let maxSimilarity = 0;
      for (const other of items) {
        if (!other || String(other.name) === name) continue;
        const sim = this.jaccardSimilarityFromSets(tokenSet, tokenSets.get(String(other.name)) || new Set());
        if (sim > maxSimilarity) maxSimilarity = sim;
      }
      const noveltyScore = this.clamp01(1 - maxSimilarity);

      const ctxNumber = this.contextNumberFromName(name);
      const recencyScore = Number.isFinite(ctxNumber) && maxN > minN
        ? this.clamp01((ctxNumber - minN) / (maxN - minN))
        : 0.5;

      const assignment =
        assignments.get(String(item.relativePath || "").toLowerCase())
        || assignments.get(name.toLowerCase())
        || { area: "UNASSIGNED", subarea: "" };
      const area = String(assignment.area || "UNASSIGNED");
      const criticalBoost = /QUALITY_AND_SECURITY|ARCHITECTURE_AND_DESIGN|REQUIREMENT_UNDERSTANDING/i.test(area)
        ? 0.08
        : 0;

      const previous = previousMetrics && typeof previousMetrics === "object"
        ? previousMetrics[String(item.relativePath || "")]
          || previousMetrics[name]
        : null;
      const continuityBoost = previous && Number.isFinite(Number(previous.qualityScore)) ? 0.04 : 0;

      const qualityScore = this.clamp01(
        (structuredScore * 0.14)
        + (decisionScore * 0.28)
        + (tokenDiversity * 0.12)
        + (noveltyScore * 0.25)
        + (recencyScore * 0.17)
        + criticalBoost
        + continuityBoost,
      );
      const removePriority = this.clamp01(
        ((1 - qualityScore) * 0.45)
        + (maxSimilarity * 0.33)
        + ((1 - recencyScore) * 0.22),
      );

      metrics[name] = {
        contextNumber: Number.isFinite(ctxNumber) ? ctxNumber : null,
        area,
        subarea: String(assignment.subarea || ""),
        lineCount: lines.length,
        structuredScore: Number(structuredScore.toFixed(4)),
        decisionScore: Number(decisionScore.toFixed(4)),
        tokenDiversity: Number(tokenDiversity.toFixed(4)),
        noveltyScore: Number(noveltyScore.toFixed(4)),
        redundancyScore: Number(maxSimilarity.toFixed(4)),
        recencyScore: Number(recencyScore.toFixed(4)),
        qualityScore: Number(qualityScore.toFixed(4)),
        removePriority: Number(removePriority.toFixed(4)),
        computedAt: new Date().toISOString(),
      };
    }
    return metrics;
  }

  pickBatchForCompression(candidates, metricsByName) {
    const scored = candidates
      .map((item) => {
        const metric = (metricsByName && metricsByName[String(item.name)]) || {};
        return {
          item,
          metric,
          priority: Number(metric.removePriority) || 0,
          ctxNumber: Number.isFinite(Number(metric.contextNumber))
            ? Number(metric.contextNumber)
            : this.contextNumberFromName(item.name),
        };
      })
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        if (Number.isFinite(a.ctxNumber) && Number.isFinite(b.ctxNumber) && a.ctxNumber !== b.ctxNumber) {
          return a.ctxNumber - b.ctxNumber;
        }
        return String(a.item.name).localeCompare(String(b.item.name), "en", {
          numeric: true,
          sensitivity: "base",
        });
      });
    return scored.slice(0, CONTEXT_COMPRESSION_BATCH_SIZE).map((entry) => entry.item);
  }

  summarizeImportantLines(text, maxLines = 4) {
    const src = String(text || "").replace(/\r\n/g, "\n");
    const lines = src
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return ["(empty context)"];

    const picked = [];
    const used = new Set();
    for (const line of lines) {
      if (picked.length >= maxLines) break;
      if (!/^[-*#]|\d+[.)]\s+/i.test(line)) continue;
      const normalized = line.replace(/^[-*#\s]+/, "").trim();
      if (!normalized || used.has(normalized.toLowerCase())) continue;
      used.add(normalized.toLowerCase());
      picked.push(normalized.slice(0, 260));
    }
    for (const line of lines) {
      if (picked.length >= maxLines) break;
      const normalized = line.replace(/^[-*#\s]+/, "").trim();
      if (!normalized || used.has(normalized.toLowerCase())) continue;
      used.add(normalized.toLowerCase());
      picked.push(normalized.slice(0, 260));
    }
    return picked.length ? picked : ["(no key lines detected)"];
  }

  getNextCompressedContextFileName(existingNames) {
    let maxN = 0;
    for (const rawName of existingNames || []) {
      const name = String(rawName || "");
      const m = name.match(/^compressed_context_(\d+)\.md$/i);
      if (!m) continue;
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > maxN) maxN = n;
    }
    return `compressed_context_${maxN + 1}.md`;
  }

  buildCompressedContextText(batchDocs, compressedFileName, metricsByName = {}) {
    const lines = [
      `# ${compressedFileName}`,
      "",
      `Generated at: ${new Date().toISOString()}`,
      "",
      "## Source contexts",
    ];
    for (const doc of batchDocs) {
      lines.push(`- ${doc.name}`);
    }
    lines.push("");
    lines.push("## Compression Signals");
    for (const doc of batchDocs) {
      const metric = metricsByName[String(doc.name)] || {};
      const quality = Number.isFinite(Number(metric.qualityScore))
        ? Number(metric.qualityScore).toFixed(3)
        : "n/a";
      const redundancy = Number.isFinite(Number(metric.redundancyScore))
        ? Number(metric.redundancyScore).toFixed(3)
        : "n/a";
      const priority = Number.isFinite(Number(metric.removePriority))
        ? Number(metric.removePriority).toFixed(3)
        : "n/a";
      lines.push(`- ${doc.name}: quality=${quality}, redundancy=${redundancy}, removePriority=${priority}`);
    }
    lines.push("");
    lines.push("## Important Information");
    lines.push("");
    for (const doc of batchDocs) {
      lines.push(`### ${doc.name}`);
      const metric = metricsByName[String(doc.name)] || {};
      const bulletCount = Number(metric.qualityScore) >= 0.65 ? 5 : 4;
      const bullets = this.summarizeImportantLines(doc.text, bulletCount);
      for (const bullet of bullets) lines.push(`- ${bullet}`);
      lines.push("");
    }
    return `${lines.join("\n").trim()}\n`;
  }

  async compactContextsIfNeeded() {
    // Compression feature disabled by user request.
    return { compressed: 0, removed: 0 };
  }

  async getArchivedContextDocs() {
    const state = await this.loadCompressedState();
    const archived = Array.isArray(state.archivedNodes) ? state.archivedNodes : [];
    return archived
      .filter((item) => item && item.name)
      .map((item) => ({
        absolutePath: "",
        relativePath: String(item.relativePath || item.name).replace(/\\/g, "/"),
        name: String(item.name),
        text: String(item.text || "").trim(),
        area: String(item.area || "UNASSIGNED"),
        subarea: String(item.subarea || ""),
        qualityMetrics: item.qualityMetrics || null,
        archived: true,
      }));
  }

  hashText(text) {
    return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
  }

  detectChangedContexts(docs, previousHashes) {
    const changedDocs = [];
    const nextHashes = {};
    for (const doc of docs) {
      const key = String(doc.relativePath || "");
      const hash = this.hashText(doc.text || "");
      nextHashes[key] = hash;
      if (previousHashes[key] !== hash) changedDocs.push(doc);
    }
    const removed = Object.keys(previousHashes || {}).filter((k) => !Object.prototype.hasOwnProperty.call(nextHashes, k));
    return { changedDocs, removed, nextHashes };
  }

  buildAreaOllamaInput(changedDocs, previousSummary) {
    const docs = this.optimizeDocsForPrompt(changedDocs);
    const parts = [
      "# TASK",
      "- You are updating only impacted brain areas in AGENT_MEMORY.",
      "- Classify each changed context into one fixed area and optional subarea.",
      "- Use ONLY the fixed brain areas listed below.",
      "- Write all output in English.",
      "",
      "# FIXED BRAIN AREAS",
      ...BRAIN_AREAS.map((area) => `- ${area.name}: ${area.description}`),
      "",
      "# CURRENT BRAIN MEMORY",
      previousSummary || "(empty)",
      "",
      "# CHANGED CONTEXT FILES",
    ];
    if (!docs.length) {
      parts.push("[NO CHANGED CONTEXTS]");
    } else {
      for (const doc of docs) {
        parts.push(`## ${doc.relativePath} (chars ${doc.promptChars}/${doc.originalChars})`);
        parts.push(doc.promptText || "(empty)");
        if (doc.truncated) parts.push("... [TRUNCATED FOR PERFORMANCE]");
        parts.push("");
      }
    }
    parts.push("# OUTPUT FORMAT (STRICT)");
    parts.push("### AREA: <AREA_NAME>");
    parts.push("- bullet");
    parts.push("### CONTEXT ASSIGNMENTS");
    parts.push("- <relative_path> => <AREA_NAME> :: <SUBAREA>");
    parts.push("- <AREA_NAME> must be one of the fixed brain areas above.");
    parts.push("- Return only AREA blocks and CONTEXT ASSIGNMENTS block.");
    return parts.join("\n").trim();
  }

  extractExistingSummary(memoryText) {
    const text = String(memoryText || "").replace(/\r\n/g, "\n");
    const marker = "## Consolidated Summary";
    const processed = "\n## Processed Context Files";
    const start = text.indexOf(marker);
    if (start < 0) return "";
    const from = text.slice(start + marker.length).trimStart();
    const end = from.indexOf(processed.trim());
    return end >= 0 ? from.slice(0, end).trim() : from.trim();
  }

  parseAreaBlocks(summaryText) {
    const lines = String(summaryText || "").replace(/\r\n/g, "\n").split("\n");
    const areas = new Map();
    let currentArea = null;
    let inAssignments = false;
    const assignments = new Map();
    for (const raw of lines) {
      const line = raw.trim();
      if (/^##\s+/.test(line)) {
        const isAssignments = /^##\s*CONTEXT ASSIGNMENTS\s*$/i.test(line);
        inAssignments = isAssignments;
        currentArea = null;
        continue;
      }
      const areaMatch = line.match(/^###\s*AREA:\s*(.+)$/i);
      if (areaMatch) {
        currentArea = this.normalizeAreaName(areaMatch[1]);
        inAssignments = false;
        if (!areas.has(currentArea)) areas.set(currentArea, []);
        continue;
      }
      if (inAssignments) {
        const m = line.match(/^-+\s*(.+?)\s*=>\s*(.+?)(?:\s*::\s*(.+))?$/i);
        if (m) {
          const file = m[1].trim();
          const area = this.normalizeAreaName(m[2]);
          const sub = (m[3] || "").trim();
          assignments.set(file, sub ? `${area} :: ${sub}` : area);
        }
        continue;
      }
      if (currentArea && line) {
        if (line.startsWith("-")) areas.get(currentArea).push(line);
      }
    }
    return { areas, assignments };
  }

  normalizeAreaName(name) {
    const raw = String(name || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[^a-zA-Z0-9 _-]/g, "");
    const normalized = raw.toUpperCase().replace(/[\s-]+/g, "_");
    if (!normalized) return "INCREMENTAL_LEARNING";

    const aliasMap = new Map(
      BRAIN_AREAS.flatMap((area) => {
        const n = area.name;
        return [
          [n, n],
          [n.replace(/_/g, " "), n],
          [n.replace(/_/g, ""), n],
        ];
      }),
    );

    return aliasMap.get(normalized)
      || aliasMap.get(normalized.replace(/_/g, " "))
      || aliasMap.get(normalized.replace(/_/g, ""))
      || "INCREMENTAL_LEARNING";
  }

  mergeAreaSummary(previousMemoryText, ollamaPatchText, changedDocs, removedDocs) {
    const previousSummary = this.extractExistingSummary(previousMemoryText);
    const parsedPrev = this.parseAreaBlocks(previousSummary);
    const parsedPatch = this.parseAreaBlocks(ollamaPatchText);
    const orderedAreas = BRAIN_AREAS.map((area) => area.name);
    const areas = new Map();
    for (const areaName of orderedAreas) {
      areas.set(areaName, []);
    }

    for (const [area, lines] of parsedPrev.areas.entries()) {
      const normalized = this.normalizeAreaName(area);
      if (!areas.has(normalized)) continue;
      areas.set(normalized, lines.map((l) => l.trim()).filter(Boolean));
    }

    for (const [area, lines] of parsedPatch.areas.entries()) {
      const normalized = this.normalizeAreaName(area);
      if (!areas.has(normalized)) continue;
      const clean = lines.map((l) => l.trim()).filter(Boolean);
      if (clean.length) areas.set(normalized, clean);
    }

    const index = new Map(parsedPrev.assignments);
    for (const removed of removedDocs || []) index.delete(removed);
    for (const doc of changedDocs || []) {
      const rel = String(doc.relativePath || "");
      if (parsedPatch.assignments.has(rel)) {
        const rawAssign = parsedPatch.assignments.get(rel);
        const [rawArea, ...rest] = String(rawAssign || "").split("::");
        const area = this.normalizeAreaName(rawArea || "");
        const sub = rest.join("::").trim();
        index.set(rel, sub ? `${area} :: ${sub}` : area);
      } else if (!index.has(rel)) {
        index.set(rel, "INCREMENTAL_LEARNING :: unclassified");
      }
    }

    for (const area of orderedAreas) {
      const block = areas.get(area) || [];
      if (!block.length) {
        const desc = BRAIN_AREAS.find((a) => a.name === area)?.description || area.toLowerCase();
        areas.set(area, [`- No explicit information found for this area.`, `- Scope: ${desc}`]);
      }
    }

    const lines = ["## BRAIN AREAS", ""];
    for (const area of orderedAreas) {
      lines.push(`### AREA: ${area}`);
      lines.push(...(areas.get(area) || [`- No explicit information found for ${area.toLowerCase()}.`]));
      lines.push("");
    }
    lines.push("## CONTEXT ASSIGNMENTS");
    const sorted = [...index.entries()].sort((a, b) => compareContextNames(a[0], b[0]));
    if (!sorted.length) {
      lines.push("- none");
    } else {
      for (const [ctx, area] of sorted) lines.push(`- ${ctx} => ${area}`);
    }
    return lines.join("\n").trim();
  }

  countKeywordHits(text, keywords) {
    const src = String(text || "").toLowerCase();
    let hits = 0;
    for (const keyword of keywords || []) {
      const k = String(keyword || "").trim().toLowerCase();
      if (!k) continue;
      const rx = new RegExp(`\\b${escapeRegex(k)}\\b`, "g");
      let m = null;
      while ((m = rx.exec(src)) !== null) hits += 1;
    }
    return hits;
  }

  classifyContextArea(doc, previousAssignments) {
    const text = String((doc && doc.text) || "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    const relativePath = String((doc && doc.relativePath) || "").replace(/\\/g, "/");
    const name = String((doc && doc.name) || path.basename(relativePath));
    const previous =
      previousAssignments.get(relativePath.toLowerCase())
      || previousAssignments.get(name.toLowerCase())
      || null;

    const profiles = {
      REQUIREMENT_UNDERSTANDING: [
        "user", "ux", "ui", "visual", "interface", "acceptance", "requirement",
        "comportamento", "layout", "tema", "palette", "interpretab", "criterio",
      ],
      PROJECT_MEMORY: [
        "standard", "convention", "repository", "docs", "documentation", "config",
        "encoding", "utf-8", "preferencia", "regra geral", "global",
      ],
      ARCHITECTURE_AND_DESIGN: [
        "architecture", "modular", "module", "boundary", "coupling", "design",
        "scalable", "component", "interface contract", "arquitetura",
      ],
      CODE_REASONING: [
        "algorithm", "logic", "classification", "decision", "flow", "function",
        "reasoning", "predicate", "state machine", "parser",
      ],
      QUALITY_AND_SECURITY: [
        "security", "auth", "authorization", "token", "secret", "validation",
        "regression", "test", "hardening", "sanitize", "safe", "vulnerability",
      ],
      EXECUTION_AND_TOOLING: [
        "runtime", "daemon", "build", "script", "terminal", "ci", "cd",
        "serial", "port", "observability", "logs", "deployment", "electron",
      ],
      INCREMENTAL_LEARNING: [
        "learning", "memory evolution", "reclassify", "feedback", "adaptive",
      ],
    };

    const score = {};
    for (const area of BRAIN_AREAS.map((item) => item.name)) score[area] = 0;
    for (const [area, keywords] of Object.entries(profiles)) {
      const hits = this.countKeywordHits(text, keywords);
      score[area] += hits;
    }
    score.QUALITY_AND_SECURITY += this.decisionSignalScore(text) * 2;
    score.CODE_REASONING += this.countKeywordHits(text, ["if", "else", "when", "because", "therefore"]) * 0.15;
    score.REQUIREMENT_UNDERSTANDING += this.countKeywordHits(text, ["must", "should", "need", "deve", "precisa"]) * 0.2;
    if (previous && previous.area) {
      const prevArea = this.normalizeAreaName(previous.area);
      score[prevArea] = (score[prevArea] || 0) + 0.45;
    }

    let bestArea = "INCREMENTAL_LEARNING";
    let bestValue = Number.NEGATIVE_INFINITY;
    for (const area of Object.keys(score)) {
      if (score[area] > bestValue) {
        bestArea = area;
        bestValue = score[area];
      }
    }
    if (bestValue <= 0.35 && previous && previous.area) {
      bestArea = this.normalizeAreaName(previous.area);
    }
    const subarea = this.inferSubarea(bestArea, text) || "general";
    return { area: bestArea, subarea };
  }

  inferSubarea(area, normalizedText) {
    const text = String(normalizedText || "");
    const map = {
      REQUIREMENT_UNDERSTANDING: [
        ["visual", "visual_direction"],
        ["dashboard", "dashboard_interpretability"],
        ["tx", "tx_rx_signals"],
        ["rx", "tx_rx_signals"],
      ],
      PROJECT_MEMORY: [
        ["encoding", "encoding_integrity"],
        ["utf-8", "encoding_integrity"],
        ["config", "configuration"],
        ["doc", "documentation"],
      ],
      ARCHITECTURE_AND_DESIGN: [
        ["module", "modularity"],
        ["boundary", "boundaries"],
        ["interface", "interfaces"],
        ["scal", "scalability"],
      ],
      CODE_REASONING: [
        ["algorithm", "algorithmic_logic"],
        ["decision", "decision_logic"],
        ["classification", "classification_logic"],
        ["parser", "parsing_logic"],
      ],
      QUALITY_AND_SECURITY: [
        ["auth", "authentication"],
        ["secret", "secret_safety"],
        ["test", "testing"],
        ["regression", "regression_prevention"],
        ["validate", "validation"],
      ],
      EXECUTION_AND_TOOLING: [
        ["serial", "serial_runtime"],
        ["daemon", "daemon_runtime"],
        ["build", "build_process"],
        ["electron", "desktop_runtime"],
        ["log", "observability"],
      ],
      INCREMENTAL_LEARNING: [
        ["reclass", "reclassification"],
        ["memory", "memory_evolution"],
        ["feedback", "feedback_loop"],
      ],
    };
    const options = map[area] || [];
    for (const [needle, subarea] of options) {
      if (text.includes(String(needle))) return subarea;
    }
    return "general";
  }

  splitSemanticUnits(text) {
    const src = String(text || "").replace(/\r\n/g, "\n");
    const units = [];
    const lines = src.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const clean = trimmed.replace(/^[-*#\d.)\s]+/, "").trim();
      if (!clean) continue;
      const parts = clean.split(/(?<=[.!?;:])\s+/g).map((item) => item.trim()).filter(Boolean);
      if (!parts.length) {
        units.push(clean);
      } else {
        units.push(...parts);
      }
    }
    return units;
  }

  scoreSemanticUnit(unit) {
    const text = String(unit || "");
    if (!text) return 0;
    const lenScore = this.clamp01(text.length / 140);
    const decisionScore = this.decisionSignalScore(text);
    const technicalScore = this.clamp01(
      this.countKeywordHits(
        text,
        ["must", "should", "never", "always", "security", "architecture", "runtime", "validation", "token", "auth", "serial", "daemon"],
      ) / 4,
    );
    return this.clamp01((lenScore * 0.22) + (decisionScore * 0.5) + (technicalScore * 0.28));
  }

  extractSemanticFacts(text, maxFacts = 5) {
    const units = this.splitSemanticUnits(text);
    if (!units.length) return [];
    const scored = [];
    const seen = new Set();
    for (const unit of units) {
      const normalized = this.normalizeDecisionLine(unit);
      if (!normalized || normalized.length < 18) continue;
      const key = this.decisionKey(normalized);
      if (seen.has(key)) continue;
      seen.add(key);
      const score = this.scoreSemanticUnit(normalized);
      scored.push({ text: normalized, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const picked = scored
      .filter((item) => item.score >= 0.24)
      .slice(0, Math.max(1, maxFacts))
      .map((item) => item.text);
    if (picked.length) return picked;
    return this.summarizeImportantLines(text, Math.max(1, maxFacts));
  }

  buildAlgorithmSummary(docs, previousMemoryText, contextMetrics = {}) {
    const previousAssignments = parseContextAssignments(previousMemoryText);
    const orderedAreas = BRAIN_AREAS.map((area) => area.name);
    const areaBuckets = new Map(orderedAreas.map((area) => [area, []]));
    const assignmentMap = new Map();
    const contextDocs = (docs || [])
      .filter((doc) => /^context_(\d+)\.md$/i.test(String(doc.name || "")))
      .sort((a, b) => compareContextNames(String(a.name || ""), String(b.name || "")));

    for (const doc of contextDocs) {
      const classification = this.classifyContextArea(doc, previousAssignments);
      const area = this.normalizeAreaName(classification.area);
      const subarea = String(classification.subarea || "general");
      const facts = this.extractSemanticFacts(doc.text, 3);
      const rel = String(doc.relativePath || "").replace(/\\/g, "/");
      const metric = contextMetrics[rel] || contextMetrics[String(doc.name || "")] || {};
      const quality = Number(metric.qualityScore) || 0;
      const docScore = this.clamp01(
        (quality * 0.55)
        + (this.decisionSignalScore(doc.text) * 0.3)
        + (this.clamp01(String(doc.text || "").length / 1600) * 0.15),
      );
      assignmentMap.set(rel, `${area} :: ${subarea}`);
      const bucket = areaBuckets.get(area) || [];
      bucket.push({
        name: String(doc.name || path.basename(rel)),
        relativePath: rel,
        facts,
        score: docScore,
      });
      areaBuckets.set(area, bucket);
    }

    const lines = ["## BRAIN AREAS", ""];
    for (const area of orderedAreas) {
      lines.push(`### AREA: ${area}`);
      const bucket = (areaBuckets.get(area) || []).sort((a, b) => b.score - a.score);
      const bullets = [];
      const seenFacts = new Set();
      for (const item of bucket) {
        for (const fact of item.facts) {
          const key = this.decisionKey(fact);
          if (seenFacts.has(key)) continue;
          seenFacts.add(key);
          bullets.push(`- ${fact}`);
          if (bullets.length >= 8) break;
        }
        if (bullets.length >= 8) break;
      }
      if (!bullets.length) {
        const desc = BRAIN_AREAS.find((node) => node.name === area)?.description || area.toLowerCase();
        lines.push("- No explicit information found for this area.");
        lines.push(`- Scope: ${desc}`);
      } else {
        lines.push(...bullets);
      }
      lines.push("");
    }

    lines.push("## CONTEXT ASSIGNMENTS");
    const sortedAssignments = [...assignmentMap.entries()].sort((a, b) => compareContextNames(a[0], b[0]));
    if (!sortedAssignments.length) {
      lines.push("- none");
    } else {
      for (const [ctx, value] of sortedAssignments) {
        lines.push(`- ${ctx} => ${value}`);
      }
    }
    return lines.join("\n").trim();
  }

  buildRefreshSignature(promptMd, docs) {
    const hash = crypto.createHash("sha256");
    hash.update(String(promptMd || ""), "utf8");
    hash.update("\n--CONTEXTS--\n", "utf8");
    for (const doc of docs) {
      hash.update(String(doc.relativePath || ""), "utf8");
      hash.update("\n", "utf8");
      hash.update(String(doc.text || ""), "utf8");
      hash.update("\n--\n", "utf8");
    }
    return hash.digest("hex");
  }

  async loadSyncState() {
    if (this.syncStateLoaded) return this.savedSyncState;
    this.syncStateLoaded = true;
    if (!fs.existsSync(this.syncStateFile)) {
      this.savedSyncState = null;
      return null;
    }
    try {
      const raw = await fsp.readFile(this.syncStateFile, "utf8");
      const parsed = raw.trim() ? JSON.parse(raw) : null;
      this.savedSyncState = parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      this.savedSyncState = null;
    }
    return this.savedSyncState;
  }

  async saveSyncState(signature, byOllama) {
    const payload = {
      signature: String(signature || ""),
      byOllama: Boolean(byOllama),
      updatedAt: new Date().toISOString(),
    };
    await ensureDir(path.dirname(this.syncStateFile));
    await fsp.writeFile(this.syncStateFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    this.lastRefreshSignature = payload.signature;
    this.savedSyncState = payload;
    this.syncStateLoaded = true;
  }

  async shouldSkipOllama(signature, bypassUnchangedCheck) {
    if (bypassUnchangedCheck) return false;
    if (!fs.existsSync(this.paths.memoryFile)) return false;
    if (this.lastRefreshSignature && this.lastRefreshSignature === signature) return true;

    const saved = await this.loadSyncState();
    if (!saved) return false;
    if (this.isOllamaEnabled() && saved.byOllama !== true) return false;
    return String(saved.signature || "") === String(signature || "");
  }

  normalizeCanonicalState(rawState) {
    const safe = rawState && typeof rawState === "object" ? rawState : {};
    const decisions = Array.isArray(safe.decisions)
      ? safe.decisions
          .filter((item) => item && typeof item === "object")
          .map((item) => ({
            id: String(item.id || ""),
            key: String(item.key || ""),
            text: String(item.text || "").trim(),
            area: String(item.area || "INCREMENTAL_LEARNING"),
            polarity: Number(item.polarity) || 0,
            confidence: this.clamp01(item.confidence),
            sources: Array.isArray(item.sources) ? item.sources.map((s) => String(s)).filter(Boolean).slice(0, 8) : [],
            status: String(item.status || "active") === "superseded" ? "superseded" : "active",
            createdAt: String(item.createdAt || ""),
            updatedAt: String(item.updatedAt || ""),
            lastSeenAt: String(item.lastSeenAt || ""),
            supersededAt: String(item.supersededAt || ""),
            supersededBySource: String(item.supersededBySource || ""),
            supersededByDecisionId: String(item.supersededByDecisionId || ""),
          }))
          .filter((item) => item.id && item.text)
      : [];
    return {
      decisions,
      updatedAt: String(safe.updatedAt || ""),
    };
  }

  async loadCanonicalState() {
    try {
      if (!fs.existsSync(this.canonicalStateFile)) return { decisions: [], updatedAt: "" };
      const raw = await fsp.readFile(this.canonicalStateFile, "utf8");
      const parsed = raw.trim() ? JSON.parse(raw) : {};
      return this.normalizeCanonicalState(parsed);
    } catch {
      return { decisions: [], updatedAt: "" };
    }
  }

  async saveCanonicalState(state) {
    const normalized = this.normalizeCanonicalState(state);
    const payload = {
      decisions: normalized.decisions,
      updatedAt: new Date().toISOString(),
    };
    await ensureDir(path.dirname(this.canonicalStateFile));
    await fsp.writeFile(this.canonicalStateFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  normalizeDecisionLine(line) {
    return String(line || "")
      .replace(/^[-*#\d.)\s]+/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  decisionPolarity(text) {
    const src = String(text || "").toLowerCase();
    if (!src) return 0;
    const negative = /\b(never|must not|should not|do not|don't|nao|n[ãa]o|evitar|avoid|disable|ban|forbid|prohibit)\b/gi;
    const positive = /\b(always|must|required|should|enable|allow|use|keep|deve|obrigat[oó]rio)\b/gi;
    let neg = 0;
    let pos = 0;
    while (negative.exec(src)) neg += 1;
    while (positive.exec(src)) pos += 1;
    if (neg > pos) return -1;
    if (pos > neg) return 1;
    return 0;
  }

  decisionKey(text) {
    const normalized = this.normalizeDecisionLine(text).toLowerCase();
    const tokens = tokenizeForNLP(normalized).slice(0, 14);
    if (!tokens.length) return crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 14);
    return tokens.join("_").slice(0, 120);
  }

  decisionSimilarity(aText, bText) {
    const aSet = new Set(tokenizeForNLP(String(aText || "")).slice(0, 50));
    const bSet = new Set(tokenizeForNLP(String(bText || "")).slice(0, 50));
    return this.jaccardSimilarityFromSets(aSet, bSet);
  }

  extractCanonicalCandidates(docs, assignments) {
    const candidates = [];
    const decisionLike = /\b(must|should|required|always|never|do not|don't|nao|n[ãa]o|deve|obrigat[oó]rio|evitar|avoid|security|seguran[çc]a|architecture|arquitetura)\b/i;
    const items = Array.isArray(docs) ? docs : [];
    for (const doc of items) {
      const relativePath = String(doc.relativePath || "").replace(/\\/g, "/");
      const sourceName = String(doc.name || path.basename(relativePath) || "");
      const sourceLookup = assignments.get(relativePath.toLowerCase())
        || assignments.get(sourceName.toLowerCase())
        || { area: "INCREMENTAL_LEARNING", subarea: "" };
      const area = String(sourceLookup.area || "INCREMENTAL_LEARNING");
      const lines = String(doc.text || "")
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const seenInDoc = new Set();
      for (const line of lines) {
        const normalized = this.normalizeDecisionLine(line);
        if (!normalized || normalized.length < 24 || normalized.length > 260) continue;
        if (!decisionLike.test(normalized)) continue;
        const key = this.decisionKey(normalized);
        if (seenInDoc.has(key)) continue;
        seenInDoc.add(key);
        const decisionScore = this.decisionSignalScore(normalized);
        const bulletBoost = /^[-*#\d.)]/.test(line) ? 0.06 : 0;
        const areaBoost = /QUALITY_AND_SECURITY|ARCHITECTURE_AND_DESIGN|REQUIREMENT_UNDERSTANDING/i.test(area)
          ? 0.07
          : 0;
        const confidence = this.clamp01(0.36 + (decisionScore * 0.52) + bulletBoost + areaBoost);
        candidates.push({
          id: `dec_${crypto.createHash("sha1").update(`${key}|${sourceName}`).digest("hex").slice(0, 12)}`,
          key,
          text: normalized,
          area,
          polarity: this.decisionPolarity(normalized),
          confidence,
          source: sourceName,
          relativePath,
        });
      }
    }
    return candidates.sort((a, b) => b.confidence - a.confidence);
  }

  mergeCanonicalDecisions(previousState, candidates) {
    const nowIso = new Date().toISOString();
    const normalized = this.normalizeCanonicalState(previousState);
    const decisions = normalized.decisions.map((item) => ({ ...item }));
    const contradictions = [];

    for (const candidate of candidates) {
      if (!candidate || candidate.confidence < 0.58) continue;
      const activeIndices = decisions
        .map((item, idx) => ({ item, idx }))
        .filter((entry) => entry.item.status === "active");
      let best = null;
      for (const entry of activeIndices) {
        const score = this.decisionSimilarity(candidate.text, entry.item.text);
        if (!best || score > best.score) best = { ...entry, score };
      }

      if (best && best.score >= 0.45 && candidate.polarity !== 0 && best.item.polarity !== 0 && candidate.polarity !== best.item.polarity && candidate.confidence >= 0.62) {
        const oldDecision = decisions[best.idx];
        oldDecision.status = "superseded";
        oldDecision.updatedAt = nowIso;
        oldDecision.supersededAt = nowIso;
        oldDecision.supersededBySource = candidate.source;
        oldDecision.supersededByDecisionId = candidate.id;

        const nextDecision = {
          id: candidate.id,
          key: candidate.key,
          text: candidate.text,
          area: candidate.area,
          polarity: candidate.polarity,
          confidence: candidate.confidence,
          sources: [candidate.source],
          status: "active",
          createdAt: nowIso,
          updatedAt: nowIso,
          lastSeenAt: nowIso,
          supersededAt: "",
          supersededBySource: "",
          supersededByDecisionId: "",
        };
        decisions.push(nextDecision);
        contradictions.push({
          replacedDecisionId: oldDecision.id,
          replacedText: oldDecision.text,
          replacedByDecisionId: nextDecision.id,
          replacedByText: nextDecision.text,
          source: candidate.source,
          at: nowIso,
        });
        continue;
      }

      if (best && best.score >= 0.55) {
        const current = decisions[best.idx];
        current.lastSeenAt = nowIso;
        current.updatedAt = nowIso;
        current.area = candidate.area || current.area;
        current.confidence = Math.max(current.confidence, candidate.confidence);
        if (candidate.source && !current.sources.includes(candidate.source)) {
          current.sources = [...current.sources, candidate.source].slice(-8);
        }
        if (
          candidate.confidence >= CANONICAL_DECISION_UPDATE_MIN_CONFIDENCE
          && candidate.text.length >= 24
          && candidate.text !== current.text
        ) {
          current.text = candidate.text;
          current.key = candidate.key;
          current.polarity = candidate.polarity;
        }
        continue;
      }

      decisions.push({
        id: candidate.id,
        key: candidate.key,
        text: candidate.text,
        area: candidate.area,
        polarity: candidate.polarity,
        confidence: candidate.confidence,
        sources: candidate.source ? [candidate.source] : [],
        status: "active",
        createdAt: nowIso,
        updatedAt: nowIso,
        lastSeenAt: nowIso,
        supersededAt: "",
        supersededBySource: "",
        supersededByDecisionId: "",
      });
    }

    const dedup = new Map();
    for (const decision of decisions) {
      if (!decision || !decision.id || !decision.text) continue;
      const key = `${decision.status}|${decision.id}`;
      dedup.set(key, decision);
    }
    const compact = [...dedup.values()]
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "active" ? -1 : 1;
        return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
      })
      .slice(0, 160);

    return {
      nextState: {
        decisions: compact,
        updatedAt: nowIso,
      },
      contradictions,
    };
  }

  parseAssignmentValue(value) {
    const raw = String(value || "");
    const [areaRaw, ...rest] = raw.split("::");
    const area = this.normalizeAreaName(areaRaw || "");
    const subarea = rest.join("::").trim();
    return { area, subarea };
  }

  buildAreaSourceMap(assignments, docs, contextMetrics = {}) {
    const docByBase = new Map();
    for (const doc of docs || []) {
      const name = String(doc.name || path.basename(String(doc.relativePath || "")));
      if (name) docByBase.set(name.toLowerCase(), doc);
    }

    const perArea = new Map();
    for (const [ctxPath, rawAssign] of assignments.entries()) {
      const { area } = this.parseAssignmentValue(rawAssign);
      const base = path.basename(String(ctxPath || "")).toLowerCase();
      const doc = docByBase.get(base) || null;
      const sourceName = doc ? String(doc.name || base) : path.basename(String(ctxPath || ""));
      const rel = doc ? String(doc.relativePath || sourceName) : String(ctxPath || sourceName);
      const metric = contextMetrics[rel] || contextMetrics[sourceName] || {};
      const entry = {
        source: sourceName,
        qualityScore: Number(metric.qualityScore) || 0,
        recencyScore: Number(metric.recencyScore) || 0,
      };
      if (!perArea.has(area)) perArea.set(area, []);
      perArea.get(area).push(entry);
    }

    const result = new Map();
    for (const [area, entries] of perArea.entries()) {
      const unique = new Map();
      for (const entry of entries) {
        const key = String(entry.source || "").toLowerCase();
        if (!key) continue;
        const prev = unique.get(key);
        if (!prev || entry.qualityScore > prev.qualityScore) unique.set(key, entry);
      }
      const ranked = [...unique.values()].sort((a, b) => {
        if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
        if (b.recencyScore !== a.recencyScore) return b.recencyScore - a.recencyScore;
        return String(a.source).localeCompare(String(b.source), "en", { numeric: true, sensitivity: "base" });
      });
      result.set(area, ranked.map((item) => item.source));
    }
    return result;
  }

  appendSourceTag(line, sources) {
    const src = Array.isArray(sources) ? sources.filter(Boolean).slice(0, 3) : [];
    if (!src.length) return line;
    if (/\[src:/i.test(String(line))) return String(line);
    return `${String(line).trim()} [src: ${src.join(", ")}]`;
  }

  renderCanonicalDecisionsSection(canonicalState) {
    const active = (canonicalState.decisions || [])
      .filter((item) => item && item.status === "active")
      .sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
      });
    const lines = ["## CANONICAL DECISIONS"];
    const traceEntries = [];
    if (!active.length) {
      lines.push("- none");
      lines.push("");
      return { lines, traceEntries };
    }

    for (const item of active) {
      const conf = Number(item.confidence || 0).toFixed(2);
      const src = Array.isArray(item.sources) && item.sources.length ? item.sources.join(", ") : "unknown";
      const bullet = `- ${item.text} [src: ${src}] (conf: ${conf})`;
      lines.push(bullet);
      traceEntries.push({
        id: `CANON:${item.id}`,
        sources: Array.isArray(item.sources) ? item.sources.slice(0, 5) : [],
      });
    }
    lines.push("");
    return { lines, traceEntries };
  }

  renderContradictionsSection(contradictions) {
    const lines = ["## MEMORY CONTRADICTIONS"];
    const items = Array.isArray(contradictions) ? contradictions : [];
    if (!items.length) {
      lines.push("- none detected in this refresh");
      lines.push("");
      return lines;
    }
    for (const item of items) {
      lines.push(
        `- Superseded by ${item.source}: "${item.replacedText}" -> "${item.replacedByText}"`,
      );
    }
    lines.push("");
    return lines;
  }

  renderTraceabilitySection(traceEntries) {
    const lines = ["## TRACEABILITY INDEX"];
    const entries = Array.isArray(traceEntries) ? traceEntries : [];
    if (!entries.length) {
      lines.push("- none");
      lines.push("");
      return lines;
    }
    for (const entry of entries) {
      const src = (entry.sources || []).filter(Boolean).slice(0, 5);
      lines.push(`- ${entry.id} => ${src.length ? src.join(", ") : "unknown"}`);
    }
    lines.push("");
    return lines;
  }

  buildIntelligentSummary(baseSummary, docs, canonicalState, contradictions, contextMetrics = {}) {
    const parsed = this.parseAreaBlocks(baseSummary);
    const orderedAreas = BRAIN_AREAS.map((area) => area.name);
    const areaSources = this.buildAreaSourceMap(parsed.assignments, docs, contextMetrics);
    const traceEntries = [];
    const lines = ["## BRAIN AREAS", ""];

    for (const area of orderedAreas) {
      const bullets = parsed.areas.get(area) || [];
      const sources = areaSources.get(area) || [];
      lines.push(`### AREA: ${area}`);
      if (!bullets.length) {
        const fallback = this.appendSourceTag(
          "- No explicit information found for this area.",
          sources,
        );
        lines.push(fallback);
        traceEntries.push({ id: `${area}#1`, sources: sources.slice(0, 3) });
      } else {
        let idx = 0;
        for (const bullet of bullets) {
          idx += 1;
          const tagged = this.appendSourceTag(bullet, sources);
          lines.push(tagged);
          traceEntries.push({ id: `${area}#${idx}`, sources: sources.slice(0, 3) });
        }
      }
      lines.push("");
    }

    const canonical = this.renderCanonicalDecisionsSection(canonicalState);
    lines.push(...canonical.lines);
    traceEntries.push(...canonical.traceEntries);
    lines.push(...this.renderContradictionsSection(contradictions));
    lines.push(...this.renderTraceabilitySection(traceEntries));

    lines.push("## CONTEXT ASSIGNMENTS");
    const sortedAssignments = [...parsed.assignments.entries()].sort((a, b) => compareContextNames(a[0], b[0]));
    if (!sortedAssignments.length) {
      lines.push("- none");
    } else {
      for (const [ctx, areaValue] of sortedAssignments) lines.push(`- ${ctx} => ${areaValue}`);
    }
    return lines.join("\n").trim();
  }

  async writeMemorySnapshot(memoryText) {
    const safeText = String(memoryText || "");
    if (!safeText.trim()) return;
    await ensureDir(this.snapshotDir);
    const now = new Date();
    const pad = (v) => String(v).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    let fileName = `AGENT_MEMORY_${stamp}.md`;
    let abs = safeResolveInside(this.snapshotDir, fileName);
    if (fs.existsSync(abs)) {
      const suffix = crypto.randomBytes(2).toString("hex");
      fileName = `AGENT_MEMORY_${stamp}_${suffix}.md`;
      abs = safeResolveInside(this.snapshotDir, fileName);
    }
    await fsp.writeFile(abs, safeText, "utf8");

    const files = (await fsp.readdir(this.snapshotDir))
      .filter((name) => /^AGENT_MEMORY_\d{8}_\d{6}(?:_[a-f0-9]{4})?\.md$/i.test(String(name)))
      .sort((a, b) => String(b).localeCompare(String(a), "en"));
    const extra = files.slice(MEMORY_SNAPSHOT_KEEP_COUNT);
    for (const name of extra) {
      const oldAbs = safeResolveInside(this.snapshotDir, name);
      if (fs.existsSync(oldAbs)) await fsp.unlink(oldAbs);
    }
  }

  async callOllama(systemPrompt, prompt) {
    const payload = {
      model: this.model,
      system: systemPrompt,
      prompt,
      stream: false,
      options: { temperature: 0.1 },
    };
    const baseTimeoutMs = Math.max(60000, Math.floor(this.timeoutSec * 1000));
    const retryTimeoutMs = Math.min(900000, Math.floor(baseTimeoutMs * 1.8));
    const timeouts = [baseTimeoutMs, retryTimeoutMs];
    let lastError = null;

    for (let attempt = 0; attempt < timeouts.length; attempt += 1) {
      const timeoutMs = timeouts[attempt];
      try {
        const response = await fetch(this.ollamaUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const generated = String(data.response || "").trim();
        if (!generated) {
          throw new Error("Ollama respondeu sem texto em 'response'.");
        }
        return generated;
      } catch (err) {
        lastError = err;
        const message = String(err || "");
        const timeoutLike =
          /timeout/i.test(message) || /aborted/i.test(message) || /timed out/i.test(message);
        if (!timeoutLike || attempt >= timeouts.length - 1) break;
        this.ui.warn(
          "OLLAMA",
          `Timeout na tentativa ${attempt + 1} (${Math.round(timeoutMs / 1000)}s). Repetindo com timeout maior...`,
        );
      }
    }
    throw lastError || new Error("Falha desconhecida ao consultar Ollama.");
  }

  ollamaBaseHost() {
    return this.ollamaUrl.replace(/\/api\/generate$/, "");
  }

  async getOllamaStatus() {
    if (!this.isOllamaEnabled()) {
      return {
        ok: true,
        reachable: false,
        host: "",
        modelConfigured: "algorithm",
        modelInstalled: true,
        models: [],
        checkedAt: new Date().toISOString(),
        error: null,
        engine: "algorithm",
        message: "Deterministic algorithm mode enabled. Ollama is disabled for this session.",
      };
    }
    const now = Date.now();
    if (
      this.ollamaStatusCache.payload
      && now - this.ollamaStatusCache.checkedAtMs < 5000
    ) {
      return this.ollamaStatusCache.payload;
    }
    const host = this.ollamaBaseHost();
    const configuredModel = this.model;
    const tagsUrl = `${host}/api/tags`;

    try {
      const response = await fetch(tagsUrl, {
        method: "GET",
        signal: AbortSignal.timeout(Math.max(5, Math.min(this.timeoutSec, 20)) * 1000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const modelNames = Array.isArray(data.models)
        ? data.models
            .map((item) => String((item && item.name) || "").trim())
            .filter(Boolean)
        : [];

      const needle = configuredModel.toLowerCase();
      const modelInstalled = modelNames.some((name) => {
        const n = name.toLowerCase();
        return n === needle || n.startsWith(`${needle}:`) || needle.startsWith(`${n}:`);
      });

      const payload = {
        ok: Boolean(modelInstalled),
        reachable: true,
        host,
        modelConfigured: configuredModel,
        modelInstalled,
        models: modelNames.slice(0, 100),
        checkedAt: new Date().toISOString(),
        error: null,
        engine: "ollama",
      };
      this.ollamaStatusCache = { checkedAtMs: now, payload };
      return payload;
    } catch (err) {
      const payload = {
        ok: false,
        reachable: false,
        host,
        modelConfigured: configuredModel,
        modelInstalled: false,
        models: [],
        checkedAt: new Date().toISOString(),
        error: String(err),
        engine: "ollama",
      };
      this.ollamaStatusCache = { checkedAtMs: now, payload };
      return payload;
    }
  }

  async loadGraphSnapshot(force = false) {
    if (!force && this.graphSnapshotLoaded) return this.graphSnapshot;
    this.graphSnapshotLoaded = true;
    if (!fs.existsSync(this.graphSnapshotFile)) {
      this.graphSnapshot = null;
      return null;
    }
    try {
      const raw = await fsp.readFile(this.graphSnapshotFile, "utf8");
      const parsed = JSON.parse(raw);
      const graph = parsed && typeof parsed === "object" && parsed.graph ? parsed.graph : {};
      const payload = {
        graph: {
          nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
          links: Array.isArray(graph.links) ? graph.links : [],
        },
        updatedAt: String((parsed && parsed.updatedAt) || ""),
        signature: String((parsed && parsed.signature) || ""),
        contextCount: Number(parsed && parsed.contextCount) || 0,
      };
      this.graphSnapshot = payload;
      return payload;
    } catch {
      this.graphSnapshot = null;
      return null;
    }
  }

  async saveGraphSnapshot(graph, metadata = {}) {
    const safeGraph = {
      nodes: Array.isArray(graph && graph.nodes) ? graph.nodes : [],
      links: Array.isArray(graph && graph.links) ? graph.links : [],
    };
    const payload = {
      graph: safeGraph,
      updatedAt: new Date().toISOString(),
      signature: String(metadata.signature || ""),
      contextCount: Number.isFinite(metadata.contextCount)
        ? Number(metadata.contextCount)
        : safeGraph.nodes.length,
    };
    await ensureDir(path.dirname(this.graphSnapshotFile));
    await fsp.writeFile(this.graphSnapshotFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    this.graphSnapshotLoaded = true;
    this.graphSnapshot = payload;
  }

  fallbackSummary(docs, err) {
    const lines = [
      "## Objective",
      "Consolidate project memory for CodexMemory while Ollama is unavailable.",
      "",
      "## Operational Rules",
      `- Fixed role: ${this.uniqueRole}`,
      "- Review context files manually until Ollama is available.",
      "",
      "## Current State",
      `- Ollama error: ${String(err)}`,
    ];

    if (docs.length === 0) {
      lines.push("- No context files found in memory_voult/context.");
    } else {
      lines.push("- Context files found:");
      for (const doc of docs) {
        const preview = doc.text ? doc.text.replace(/\s+/g, " ").slice(0, 180) : "(empty file)";
        lines.push(`  - ${doc.relativePath}: ${preview}`);
      }
    }

    lines.push("");
    lines.push("## Next Actions");
    lines.push("- Start Ollama service on http://127.0.0.1:11434.");
    lines.push(`- Ensure model '${this.model}' is installed.`);
    return lines.join("\n");
  }

  cleanSummaryText(summary) {
    let text = String(summary || "").replace(/\r\n/g, "\n").trim();
    text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
    text = text.replace(/^#\s*AGENT MEMORY\s*$/im, "").trim();
    text = text.replace(/^##\s*Consolidated Summary\s*$/im, "").trim();
    text = text.replace(/^##\s*ARCHITURE DECISIONS\s*$/gim, "## ARCHITECTURE DECISIONS");
    text = text.replace(/^\s*-\s*\.\.\.\s*$/gim, "");
    text = text.replace(/^single role:.*$/gim, "");
    text = text.replace(/^.*memory curator for codexmemory.*$/gim, "");
    const forbiddenLinePatterns = [
      /instru[cç][oõ]es acima s[aã]o obrigat[oó]rias/i,
      /n[aã]o ignore,\s*relaxe ou substitua/i,
      /sempre escreva (o )?output final em ingl[eê]s/i,
      /never write placeholders/i,
      /never output placeholders/i,
      /nunca escreva placeholders/i,
      /nunca mencione seu papel/i,
      /never mention your role/i,
      /codex (will|does) not read context/i,
      /codex n[aã]o l[eê] os arquivos de contexto/i,
      /system prompt/i,
      /agent identity/i,
      /detalhes de implementa[cç][aã]o/i,
    ];
    text = text
      .split("\n")
      .filter((line) => {
        const normalized = String(line || "").trim();
        return !forbiddenLinePatterns.some((rx) => rx.test(normalized));
      })
      .join("\n");
    return text.trim();
  }

  defaultSectionLines(title, docs) {
    if (title === "IMPORTANT CONTEXTS" && docs.length) {
      return docs.map((doc) => {
        const preview = String(doc.text || "").replace(/\s+/g, " ").trim();
        const shortPreview = preview ? preview.slice(0, 180) : "No content available.";
        return `- ${doc.relativePath}: ${shortPreview}`;
      });
    }
    return [`- No explicit ${title.toLowerCase()} details found in current context files.`];
  }

  enforceSummaryTemplate(summary, docs) {
    const required = [
      "USER PREFERENCES",
      "SYSTEM RULES",
      "ARCHITECTURE DECISIONS",
      "CONSTRAINTS",
      "PATTERNS",
      "IMPORTANT CONTEXTS",
      "NOTES",
    ];

    const lines = this.cleanSummaryText(summary).split("\n");
    const sections = new Map();
    let current = null;
    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      const match = line.match(/^##\s+(.+?)\s*$/);
      if (match) {
        current = match[1].trim().toUpperCase();
        if (!sections.has(current)) sections.set(current, []);
      } else if (current) {
        sections.get(current).push(line);
      }
    }

    const out = [];
    for (const title of required) {
      const block = (sections.get(title) || [])
        .map((line) => line.trim())
        .filter((line) => line && line !== "- ...");
      out.push(`## ${title}`);
      if (block.length) {
        out.push(...block);
      } else {
        out.push(...this.defaultSectionLines(title, docs));
      }
      out.push("");
    }
    return out.join("\n").trim();
  }

  resolveMemoryHeader(previousMemoryText) {
    const marker = "## Consolidated Summary";
    const normalized = String(previousMemoryText || "").replace(/\r\n/g, "\n");
    const legacyTimestampRx = /^\d{4}-\d{2}-\d{2}\s+\|\s+\d{2}:\d{2}:\d{2}$/;
    const idx = normalized.indexOf(marker);
    if (idx >= 0) {
      const beforeMarker = normalized.slice(0, idx);
      const cleanedBefore = beforeMarker
        .split("\n")
        .filter((line) => {
          const trimmed = String(line).trim();
          if (!trimmed) return true;
          if (/^single role:/i.test(trimmed)) return false;
          if (legacyTimestampRx.test(trimmed)) return false;
          return true;
        })
        .join("\n")
        .trimEnd();
      if (!cleanedBefore) {
        return ["# AGENT MEMORY", "", marker].join("\n");
      }
      return `${cleanedBefore}\n\n${marker}`;
    }
    return [
      "# AGENT MEMORY",
      "",
      marker,
    ].join("\n");
  }

  buildMemoryFile(summary, docs, previousMemoryText = "") {
    const rawSummary = String(summary || "").trim();
    const normalizedSummary = rawSummary.startsWith("## BRAIN AREAS")
      ? rawSummary
      : this.enforceSummaryTemplate(summary, docs);
    const header = this.resolveMemoryHeader(previousMemoryText);
    const lines = [header, "", normalizedSummary, "", "## Processed Context Files"];

    if (docs.length === 0) {
      lines.push("- none");
    } else {
      for (const doc of docs) {
        lines.push(`- ${doc.relativePath}`);
      }
    }
    return `${lines.join("\n").trimEnd()}\n`;
  }

  async refreshMemory(reason, forceOllama = true, bypassUnchangedCheck = false) {
    this.ui.info("SYNC", `Atualizando AGENT_MEMORY.md (${reason})`);
    const useOllama = this.isOllamaEnabled() && Boolean(forceOllama);
    const promptMd = useOllama ? await this.loadPrompt() : "";
    await this.compactContextsIfNeeded();
    const docs = await this.loadContextDocs();
    if (useOllama) {
      this.ui.info(
        "SYNC",
        `Prompt carregado (${path.basename(this.paths.promptFile)}) e ${docs.length} arquivo(s) de contexto.`,
      );
    } else {
      this.ui.info(
        "SYNC",
        `Modo algoritmo ativo e ${docs.length} arquivo(s) de contexto carregado(s).`,
      );
    }
    const contextState = await this.loadContextState();
    const { changedDocs, removed, nextHashes } = this.detectChangedContexts(docs, contextState.hashes || {});
    let previousMemoryText = "";
    if (fs.existsSync(this.paths.memoryFile)) {
      previousMemoryText = await fsp.readFile(this.paths.memoryFile, "utf8");
    }
    const previousAssignments = parseContextAssignments(previousMemoryText);
    const contextCandidates = docs
      .filter((doc) => /^context_(\d+)\.md$/i.test(String(doc.name || "")))
      .map((doc) => ({
        name: String(doc.name || path.basename(String(doc.relativePath || ""))),
        relativePath: String(doc.relativePath || ""),
        text: String(doc.text || ""),
      }));
    const qualityByName = this.buildContextQualityMetrics(
      contextCandidates,
      previousAssignments,
      contextState.metrics || {},
    );
    const contextMetrics = {};
    for (const doc of contextCandidates) {
      const metric = qualityByName[String(doc.name)] || null;
      if (!metric) continue;
      contextMetrics[String(doc.name)] = metric;
      contextMetrics[String(doc.relativePath)] = metric;
    }
    const refreshSignature = this.buildRefreshSignature(promptMd, docs);

    if (
      !bypassUnchangedCheck
      && fs.existsSync(this.paths.memoryFile)
      && changedDocs.length === 0
      && removed.length === 0
      && (await this.shouldSkipOllama(refreshSignature, bypassUnchangedCheck))
    ) {
      this.ui.info("SYNC", "Sem mudancas nos contextos/prompt. Atualizacao pulada para economizar hardware.");
      this.lastMemoryText = await fsp.readFile(this.paths.memoryFile, "utf8");
      this.lastRefreshSignature = refreshSignature;
      const existingSnapshot = await this.loadGraphSnapshot();
      if (!existingSnapshot || !existingSnapshot.graph) {
        try {
          const graph = buildGraphFromContexts(docs, this.lastMemoryText);
          await this.saveGraphSnapshot(graph, { signature: refreshSignature, contextCount: docs.length });
        } catch (err) {
          this.ui.warn("GRAPH", `Falha ao persistir snapshot de neuronios: ${String(err)}`);
        }
      }
      return this.lastMemoryText;
    }

    let summary;
    let generatedByOllama = false;
    if (useOllama) {
      const ollamaSystemPrompt = this.buildSystemPrompt(promptMd);
      const previousSummary = this.extractExistingSummary(previousMemoryText);
      const docsForOllama = changedDocs.length ? changedDocs : docs;
      const ollamaPrompt = this.buildAreaOllamaInput(docsForOllama, previousSummary);
      this.ui.info(
        "OLLAMA",
        `Chamando modelo '${this.model}' para atualizar memoria por areas (${docsForOllama.length} contexto(s) alterado(s)).`,
      );
      try {
        const patch = await this.callOllama(ollamaSystemPrompt, ollamaPrompt);
        summary = this.mergeAreaSummary(previousMemoryText, patch, docsForOllama, removed);
        generatedByOllama = true;
        this.ui.info("OLLAMA", "Atualizacao por areas recebida do Ollama com sucesso.");
      } catch (err) {
        this.ui.warn("OLLAMA", `Falha ao consultar Ollama (${String(err)}). Mantendo memoria atual.`);
        summary = this.extractExistingSummary(previousMemoryText) || this.fallbackSummary(docs, err);
      }
    } else {
      summary = this.buildAlgorithmSummary(docs, previousMemoryText, contextMetrics);
    }

    const summaryAssignments = parseContextAssignments(summary);
    const previousCanonical = await this.loadCanonicalState();
    const canonicalCandidates = this.extractCanonicalCandidates(docs, summaryAssignments);
    const { nextState: nextCanonicalState, contradictions } = this.mergeCanonicalDecisions(
      previousCanonical,
      canonicalCandidates,
    );
    await this.saveCanonicalState(nextCanonicalState);
    summary = this.buildIntelligentSummary(
      summary,
      docs,
      nextCanonicalState,
      contradictions,
      contextMetrics,
    );

    const memoryText = this.buildMemoryFile(summary, docs, previousMemoryText);
    await ensureDir(path.dirname(this.paths.memoryFile));
    await fsp.writeFile(this.paths.memoryFile, memoryText, "utf8");
    if (memoryText !== previousMemoryText) {
      await this.writeMemorySnapshot(memoryText);
    }
    this.lastMemoryText = memoryText;
    await this.saveSyncState(refreshSignature, generatedByOllama);
    await this.saveContextState({ hashes: nextHashes, metrics: contextMetrics });
    try {
      const graph = buildGraphFromContexts(docs, memoryText);
      await this.saveGraphSnapshot(graph, { signature: refreshSignature, contextCount: docs.length });
    } catch (err) {
      this.ui.warn("GRAPH", `Falha ao persistir snapshot de neuronios: ${String(err)}`);
    }
    this.ui.info("SYNC", `AGENT_MEMORY.md atualizado em ${this.paths.memoryFile.replace(/\\/g, "/")}`);
    return memoryText;
  }

  async getMemoryText() {
    if (this.lastMemoryText) return this.lastMemoryText;
    if (fs.existsSync(this.paths.memoryFile)) {
      this.lastMemoryText = await fsp.readFile(this.paths.memoryFile, "utf8");
      return this.lastMemoryText;
    }
    return this.refreshMemory("arquivo inexistente");
  }
}

class DaemonRunner {
  constructor(coordinator, ui, refreshSec) {
    this.coordinator = coordinator;
    this.ui = ui;
    this.refreshSec = Math.max(30, refreshSec);
    this.running = true;
  }

  async run(runOnce = false) {
    this.ui.info("DAEMON", `Modo daemon ativo. Intervalo: ${this.refreshSec}s.`);
    while (this.running) {
      try {
        await this.coordinator.refreshMemory("daemon loop");
      } catch (err) {
        this.ui.error("DAEMON", `Falha ao atualizar memoria: ${String(err)}`);
      }

      if (runOnce) {
        this.ui.info("DAEMON", "Execucao unica concluida.");
        return 0;
      }

      await new Promise((resolve) => setTimeout(resolve, this.refreshSec * 1000));
    }
    return 0;
  }
}

class GUIController {
  constructor(coordinator, ui, refreshSec) {
    this.coordinator = coordinator;
    this.ui = ui;
    this.refreshSec = Math.max(30, refreshSec);
    this.timer = null;
    this.running = false;
    this.lastRunAt = null;
    this.lastError = null;
  }

  async syncNow(reason = "gui sync", options = {}) {
    const bypassUnchangedCheck = Boolean(options.bypassUnchangedCheck);
    try {
      await this.coordinator.refreshMemory(reason, true, bypassUnchangedCheck);
      this.lastRunAt = new Date().toISOString();
      this.lastError = null;
      return { ok: true };
    } catch (err) {
      this.lastError = String(err);
      return { ok: false, error: String(err) };
    }
  }

  async start() {
    if (this.running) return this.status();
    this.running = true;
    await this.syncNow("daemon start");
    this.timer = setInterval(() => {
      void this.syncNow("daemon tick");
    }, this.refreshSec * 1000);
    this.ui.info("GUI", "Daemon interno iniciado pela GUI.");
    return this.status();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    this.ui.info("GUI", "Daemon interno parado pela GUI.");
    return this.status();
  }

  async restart() {
    this.stop();
    return this.start();
  }

  status() {
    return {
      running: this.running,
      refreshSec: this.refreshSec,
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
    };
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function safeResolveInside(baseDir, userRelativePath) {
  const resolved = path.resolve(baseDir, userRelativePath);
  const baseResolved = path.resolve(baseDir);
  if (resolved === baseResolved || resolved.startsWith(`${baseResolved}${path.sep}`)) {
    return resolved;
  }
  throw new Error("Caminho fora da pasta permitida.");
}

function sanitizeContextFileName(name) {
  if (typeof name !== "string") {
    throw new Error("Nome de arquivo invalido.");
  }
  const trimmed = name.trim();
  if (!/^[a-zA-Z0-9._-]+\.md$/.test(trimmed)) {
    throw new Error("Nome de arquivo invalido. Use apenas letras, numeros, ., _ e - terminando com .md");
  }
  return trimmed;
}

function contextFileOrderKey(fileName) {
  const base = path.basename(String(fileName || ""));
  const match = base.match(/^context_(\d+)\.md$/i);
  if (!match) return { isContext: false, num: Number.POSITIVE_INFINITY, base };
  return {
    isContext: true,
    num: Number(match[1]),
    base,
  };
}

function compareContextNames(aName, bName) {
  const a = contextFileOrderKey(aName);
  const b = contextFileOrderKey(bName);
  if (a.isContext && b.isContext && a.num !== b.num) return a.num - b.num;
  if (a.isContext !== b.isContext) return a.isContext ? -1 : 1;
  return a.base.localeCompare(b.base, "en", { numeric: true, sensitivity: "base" });
}

class ContextRepository {
  constructor(paths) {
    this.paths = paths;
    this.meta = [];
    this.version = "";
    this.cache = new Map();
    this.lastScanAt = 0;
    this.minScanIntervalMs = 900;
  }

  getVersion() {
    return this.version;
  }

  invalidate(fileAbs) {
    if (fileAbs) this.cache.delete(path.resolve(fileAbs));
    this.meta = [];
    this.version = "";
    this.lastScanAt = 0;
  }

  async ensureScanned(force = false) {
    const now = Date.now();
    if (!force && this.meta.length && now - this.lastScanAt < this.minScanIntervalMs) {
      return this.meta;
    }
    await ensureDir(this.paths.contextDir);
    const files = await walkMarkdownFiles(this.paths.contextDir);
    const stats = await Promise.all(
      files.map(async (abs) => {
        const st = await fsp.stat(abs);
        return {
          abs: path.resolve(abs),
          name: path.basename(abs),
          relativePath: path.relative(this.paths.root, abs).replace(/\\/g, "/"),
          size: st.size,
          mtimeMs: st.mtimeMs,
          mtime: st.mtime.toISOString(),
        };
      }),
    );
    stats.sort((a, b) => compareContextNames(a.name, b.name));
    const nextVersion = stats.map((e) => `${e.relativePath}|${e.size}|${Math.floor(e.mtimeMs)}`).join(";");
    if (nextVersion !== this.version) {
      const valid = new Set(stats.map((e) => e.abs));
      for (const key of this.cache.keys()) {
        if (!valid.has(key)) this.cache.delete(key);
      }
      this.version = nextVersion;
      this.meta = stats;
    } else {
      this.meta = stats;
    }
    this.lastScanAt = now;
    return this.meta;
  }

  normalizePreview(text) {
    return String(text || "").replace(/\s+/g, " ").trim().slice(0, 160);
  }

  async readPreview(abs) {
    let fh;
    try {
      fh = await fsp.open(abs, "r");
      const buf = Buffer.alloc(2048);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      return this.normalizePreview(buf.toString("utf8", 0, bytesRead));
    } finally {
      if (fh) await fh.close();
    }
  }

  getCache(entry) {
    const cached = this.cache.get(entry.abs);
    if (!cached) return null;
    if (cached.mtimeMs !== entry.mtimeMs || cached.size !== entry.size) return null;
    return cached;
  }

  async ensureText(entry) {
    const cached = this.getCache(entry);
    if (cached && typeof cached.text === "string") return cached.text;
    const text = await fsp.readFile(entry.abs, "utf8");
    const next = {
      mtimeMs: entry.mtimeMs,
      size: entry.size,
      text,
      preview: this.normalizePreview(text),
    };
    this.cache.set(entry.abs, next);
    return text;
  }

  async listContexts() {
    const entries = await this.ensureScanned();
    const contexts = [];
    for (const entry of entries) {
      let cached = this.getCache(entry);
      if (!cached || typeof cached.preview !== "string") {
        const preview = cached && typeof cached.text === "string"
          ? this.normalizePreview(cached.text)
          : await this.readPreview(entry.abs);
        cached = {
          mtimeMs: entry.mtimeMs,
          size: entry.size,
          text: cached && typeof cached.text === "string" ? cached.text : null,
          preview,
        };
        this.cache.set(entry.abs, cached);
      }
      contexts.push({
        name: entry.name,
        relativePath: entry.relativePath,
        size: entry.size,
        mtime: entry.mtime,
        preview: cached.preview || "",
      });
    }
    return contexts;
  }

  async getContextText(fileName) {
    const normalized = sanitizeContextFileName(fileName);
    const entries = await this.ensureScanned();
    const entry = entries.find((item) => item.name === normalized);
    if (!entry) return null;
    return this.ensureText(entry);
  }

  async getContextDocs() {
    const entries = await this.ensureScanned();
    const docs = await Promise.all(
      entries.map(async (entry) => ({
        absolutePath: entry.abs,
        relativePath: entry.relativePath,
        name: entry.name,
        text: (await this.ensureText(entry)).trim(),
      })),
    );
    return docs;
  }
}

async function listContexts(paths, contextRepo = null) {
  if (contextRepo) return contextRepo.listContexts();
  const repo = new ContextRepository(paths);
  return repo.listContexts();
}

async function getNextContextFileName(paths, contextRepo = null) {
  const contexts = await listContexts(paths, contextRepo);
  let maxN = 0;
  for (const item of contexts) {
    const match = item.name.match(/^context_(\d+)\.md$/i);
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > maxN) maxN = n;
    }
  }
  return `context_${maxN + 1}.md`;
}

function tokenizeForNLP(text) {
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "your",
    "have",
    "will",
    "into",
    "como",
    "para",
    "com",
    "sem",
    "que",
    "uma",
    "das",
    "dos",
    "por",
    "não",
    "nao",
    "ele",
    "ela",
    "isso",
    "isso",
    "quando",
    "onde",
    "sobre",
    "entre",
  ]);

  const normalized = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const raw = normalized.match(/[a-z0-9_]{3,}/g) || [];
  return raw.filter((token) => !stopwords.has(token));
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildContextMentionPatterns(fileName) {
  const rawName = String(fileName || "").trim().toLowerCase();
  const noExt = rawName.replace(/\.md$/i, "");
  const patterns = [];

  if (rawName) {
    patterns.push(new RegExp(`\\b${escapeRegex(rawName)}\\b`, "i"));
  }
  if (noExt) {
    patterns.push(new RegExp(`\\b${escapeRegex(noExt)}\\b`, "i"));
    const flexibleSep = escapeRegex(noExt).replace(/[_-]+/g, "[\\\\s_-]*");
    patterns.push(new RegExp(`\\b${flexibleSep}\\b`, "i"));

    const contextNumber = noExt.match(/^context[_-]?(\d+)$/i);
    if (contextNumber) {
      patterns.push(new RegExp(`\\bcontext[\\s_-]*${contextNumber[1]}\\b`, "i"));
    }
  }

  return patterns;
}

function pairKey(a, b) {
  return [a, b].sort((x, y) => String(x).localeCompare(String(y))).join("::");
}

function isFoundationContextId(value) {
  return String(value || "").trim().toLowerCase() === FOUNDATION_CONTEXT_FILE;
}

function ensureFoundationNode(nodes, assignments = new Map()) {
  const list = Array.isArray(nodes) ? nodes : [];
  const existing = list.find((node) => isFoundationContextId(node && node.id));
  if (existing) return existing;

  const assignment = assignments.get(FOUNDATION_CONTEXT_FILE) || {
    area: "PROJECT_MEMORY",
    subarea: "foundation",
  };
  const node = {
    id: FOUNDATION_CONTEXT_FILE,
    label: FOUNDATION_CONTEXT_FILE,
    name: FOUNDATION_CONTEXT_FILE,
    relativePath: `memory_voult/context/${FOUNDATION_CONTEXT_FILE}`.replace(/\\/g, "/"),
    area: String(assignment.area || "PROJECT_MEMORY").trim().toUpperCase().replace(/\s+/g, "_"),
    subarea: String(assignment.subarea || "foundation").trim(),
    archived: false,
    tokenCount: 220,
    keywords: ["foundation", "core-memory"],
    keywordSet: new Set(["foundation", "core-memory"]),
    textNorm: "",
    mentionPatterns: buildContextMentionPatterns(FOUNDATION_CONTEXT_FILE),
  };
  list.push(node);
  return node;
}

function ensureMandatoryFoundationLinks(nodes, links) {
  const nodeList = Array.isArray(nodes) ? nodes : [];
  const linkList = Array.isArray(links) ? links : [];
  const foundationNode = nodeList.find((node) => isFoundationContextId(node && node.id));
  if (!foundationNode) return linkList;

  const foundationId = foundationNode.id;
  const existingPairs = new Set();
  for (const link of linkList) {
    if (!link || !link.source || !link.target) continue;
    const key = pairKey(link.source, link.target);
    existingPairs.add(key);
    const touchesFoundation = isFoundationContextId(link.source) || isFoundationContextId(link.target);
    if (!touchesFoundation) continue;
    if (!Array.isArray(link.shared)) {
      link.shared = ["foundation-anchor"];
    } else if (!link.shared.includes("foundation-anchor")) {
      link.shared.unshift("foundation-anchor");
    }
  }

  for (const node of nodeList) {
    if (!node || !node.id || isFoundationContextId(node.id)) continue;
    const key = pairKey(node.id, foundationId);
    if (existingPairs.has(key)) continue;
    linkList.push({
      source: foundationId,
      target: node.id,
      weight: 0.92,
      shared: ["foundation-anchor"],
    });
    existingPairs.add(key);
  }
  return linkList;
}

function buildMemoryCoMentionPairs(nodes, memoryText) {
  const pairs = new Set();
  const normalized = String(memoryText || "").replace(/\r\n/g, "\n").toLowerCase();
  if (!normalized.trim()) return pairs;

  // Co-mention is only valid when 2+ contexts are mentioned in the same line.
  // This prevents "all-to-all" links caused by global file mentions.
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const mentioned = [];
    for (const node of nodes) {
      if (node.mentionPatterns.some((rx) => rx.test(line))) {
        mentioned.push(node.id);
      }
    }
    const unique = [...new Set(mentioned)];
    if (unique.length < 2) continue;
    for (let i = 0; i < unique.length; i += 1) {
      for (let j = i + 1; j < unique.length; j += 1) {
        pairs.add(pairKey(unique[i], unique[j]));
      }
    }
  }

  return pairs;
}

function parseContextAssignments(memoryText) {
  const map = new Map();
  const text = String(memoryText || "").replace(/\r\n/g, "\n");
  if (!text.trim()) return map;
  const lines = text.split("\n");
  let inBlock = false;
  for (const raw of lines) {
    const line = String(raw || "").trim();
    if (/^##\s*CONTEXT ASSIGNMENTS\s*$/i.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock && /^##\s+/.test(line)) break;
    if (!inBlock || !line.startsWith("-")) continue;
    const m = line.match(/^-+\s*(.+?)\s*=>\s*(.+?)(?:\s*::\s*(.+))?$/i);
    if (!m) continue;
    const rawPath = m[1].trim().replace(/\\/g, "/");
    const area = String(m[2] || "").trim().toUpperCase().replace(/\s+/g, "_");
    const subarea = String(m[3] || "").trim();
    if (!area) continue;
    const base = path.basename(rawPath).toLowerCase();
    map.set(rawPath.toLowerCase(), { area, subarea });
    map.set(base, { area, subarea });
  }
  return map;
}

function parseProcessedContextNames(memoryText) {
  const names = [];
  const text = String(memoryText || "").replace(/\r\n/g, "\n");
  if (!text.trim()) return names;
  const lines = text.split("\n");
  let inBlock = false;
  for (const raw of lines) {
    const line = String(raw || "").trim();
    if (/^##\s*Processed Context Files\s*$/i.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock && /^##\s+/.test(line)) break;
    if (!inBlock || !line.startsWith("-")) continue;
    const entry = line.replace(/^-+\s*/, "").trim().replace(/\\/g, "/");
    if (!entry || /^none$/i.test(entry)) continue;
    const base = path.basename(entry);
    if (/\.md$/i.test(base)) names.push(base);
  }
  return [...new Set(names)].sort(compareContextNames);
}

function buildGraphFromMemoryOnly(memoryText = "", knownContextNames = []) {
  const assignments = parseContextAssignments(memoryText);
  const names = new Set(parseProcessedContextNames(memoryText));

  for (const rawName of knownContextNames || []) {
    const base = path.basename(String(rawName || "")).trim();
    if (/^context_\d+\.md$/i.test(base)) names.add(base);
  }

  for (const key of assignments.keys()) {
    const base = path.basename(String(key || "")).trim();
    if (/\.md$/i.test(base)) names.add(base);
  }

  // Foundation neuron must always exist in graph persistence view.
  names.add(FOUNDATION_CONTEXT_FILE);

  const nodeSeeds = [...names]
    .filter((name) => /\.md$/i.test(name))
    .sort(compareContextNames)
    .map((name) => {
      const assignment = assignments.get(String(name || "").toLowerCase()) || {
        area: "INCREMENTAL_LEARNING",
        subarea: "",
      };
      return {
        id: name,
        label: name,
        name,
        relativePath: `memory_voult/context/${name}`.replace(/\\/g, "/"),
        area: String(assignment.area || "INCREMENTAL_LEARNING").trim().toUpperCase().replace(/\s+/g, "_"),
        subarea: String(assignment.subarea || "").trim(),
        archived: false,
        tokenCount: 64,
        keywords: [],
        mentionPatterns: buildContextMentionPatterns(name),
      };
    });
  ensureFoundationNode(nodeSeeds, assignments);

  const memoryPairs = buildMemoryCoMentionPairs(nodeSeeds, memoryText);
  const links = [];
  for (const pair of memoryPairs) {
    const [source, target] = String(pair).split("::");
    if (!source || !target) continue;
    links.push({
      source,
      target,
      weight: 0.8,
      shared: ["memory-reference"],
    });
  }
  const anchoredLinks = ensureMandatoryFoundationLinks(nodeSeeds, links);

  return {
    nodes: nodeSeeds.map((n) => ({
      id: n.id,
      label: n.label,
      relativePath: n.relativePath,
      area: n.area,
      subarea: n.subarea,
      archived: n.archived,
      tokenCount: n.tokenCount,
      keywords: n.keywords,
      radius: 18,
    })),
    links: anchoredLinks,
  };
}

function buildGraphFromContexts(contextItems, memoryText = "") {
  const assignments = parseContextAssignments(memoryText);
  const nodes = contextItems.map((item) => {
    const tokens = tokenizeForNLP(item.text || "");
    const freq = new Map();
    for (const token of tokens) {
      freq.set(token, (freq.get(token) || 0) + 1);
    }
    const keywords = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k]) => k);
    const fallbackAssignment = {
      area: String(item.area || "UNASSIGNED").trim().toUpperCase().replace(/\s+/g, "_") || "UNASSIGNED",
      subarea: String(item.subarea || "").trim(),
    };
    const assignment =
      assignments.get(String(item.relativePath || "").toLowerCase())
      || assignments.get(String(item.name || "").toLowerCase())
      || fallbackAssignment;
    return {
      id: item.name,
      label: item.name,
      relativePath: item.relativePath,
      area: assignment.area,
      subarea: assignment.subarea,
      archived: Boolean(item.archived),
      tokenCount: tokens.length,
      keywords,
      keywordSet: new Set(keywords),
      textNorm: String(item.text || "").toLowerCase(),
      mentionPatterns: buildContextMentionPatterns(item.name),
    };
  });
  ensureFoundationNode(nodes, assignments);

  const links = [];
  const memoryPairs = buildMemoryCoMentionPairs(nodes, memoryText);
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const inter = [...a.keywordSet].filter((k) => b.keywordSet.has(k));
      const union = new Set([...a.keywordSet, ...b.keywordSet]);
      const similarity = union.size ? inter.length / union.size : 0;
      const aMentionsB = b.mentionPatterns.some((rx) => rx.test(a.textNorm));
      const bMentionsA = a.mentionPatterns.some((rx) => rx.test(b.textNorm));
      const explicitMentionInContexts = aMentionsB || bMentionsA;
      const explicitMentionInMemory = memoryPairs.has(pairKey(a.id, b.id));
      const explicitMention = explicitMentionInContexts || explicitMentionInMemory;

      if (explicitMention || inter.length >= 2 || similarity >= 0.22) {
        const weight = explicitMentionInMemory
          ? Math.max(0.78, similarity)
          : explicitMention
            ? Math.max(0.65, similarity)
            : similarity;
        const shared = inter.slice(0, 5);
        if (explicitMentionInContexts) {
          shared.unshift("explicit-reference");
        }
        if (explicitMentionInMemory) {
          shared.unshift("memory-reference");
        }
        links.push({
          source: a.id,
          target: b.id,
          weight: Number(weight.toFixed(3)),
          shared: shared.slice(0, 5),
        });
      }
    }
  }
  const anchoredLinks = ensureMandatoryFoundationLinks(nodes, links);

  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      label: n.label,
      relativePath: n.relativePath,
      area: n.area,
      subarea: n.subarea,
      archived: n.archived,
      tokenCount: n.tokenCount,
      keywords: n.keywords,
      radius: Math.max(12, Math.min(34, 12 + Math.floor(Math.sqrt(Math.max(1, n.tokenCount))))),
    })),
    links: anchoredLinks,
  };
}

function createGUIServer(paths, coordinator, contextRepo, ui, refreshSec, host, port) {
  const controller = new GUIController(coordinator, ui, refreshSec);
  const guiRoot = path.join(paths.root, "GUI");
  const languagesRoot = path.join(paths.root, "languages");
  const graphCache = { key: "", data: null };
  const memoryCache = { mtimeMs: -1, size: -1, text: "" };

  const mimeByExt = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
  };

  async function getMemoryTextCached() {
    await ensureDir(path.dirname(paths.memoryFile));
    if (!fs.existsSync(paths.memoryFile)) {
      memoryCache.mtimeMs = -1;
      memoryCache.size = -1;
      memoryCache.text = "";
      return { text: "", mtimeMs: -1, size: 0 };
    }
    const st = await fsp.stat(paths.memoryFile);
    if (st.mtimeMs === memoryCache.mtimeMs && st.size === memoryCache.size) {
      return { text: memoryCache.text, mtimeMs: st.mtimeMs, size: st.size };
    }
    const text = await fsp.readFile(paths.memoryFile, "utf8");
    memoryCache.mtimeMs = st.mtimeMs;
    memoryCache.size = st.size;
    memoryCache.text = text;
    return { text, mtimeMs: st.mtimeMs, size: st.size };
  }

  async function handleApi(req, res, pathname) {
    if (req.method === "GET" && pathname === "/api/status") {
      const ollama = await coordinator.getOllamaStatus();
      return sendJson(res, 200, {
        daemon: controller.status(),
        paths: {
          contextDir: paths.contextDir,
          memoryFile: paths.memoryFile,
          promptFile: paths.promptFile,
        },
        ollama,
      });
    }

    if (req.method === "GET" && pathname === "/api/ollama-status") {
      const ollama = await coordinator.getOllamaStatus();
      return sendJson(res, 200, ollama);
    }

    if (req.method === "POST" && pathname === "/api/sync") {
      const result = await controller.syncNow("gui manual sync");
      return sendJson(res, result.ok ? 200 : 500, result);
    }

    if (req.method === "POST" && pathname === "/api/memory/force") {
      const result = await controller.syncNow("gui force agent memory", {
        bypassUnchangedCheck: true,
      });
      return sendJson(res, result.ok ? 200 : 500, result);
    }

    if (req.method === "POST" && pathname === "/api/daemon/start") {
      const status = await controller.start();
      return sendJson(res, 200, { ok: true, daemon: status });
    }
    if (req.method === "POST" && pathname === "/api/daemon/stop") {
      const status = controller.stop();
      return sendJson(res, 200, { ok: true, daemon: status });
    }
    if (req.method === "POST" && pathname === "/api/daemon/restart") {
      const status = await controller.restart();
      return sendJson(res, 200, { ok: true, daemon: status });
    }

    if (req.method === "GET" && pathname === "/api/contexts") {
      const contexts = await listContexts(paths, contextRepo);
      return sendJson(res, 200, { contexts });
    }

    if (req.method === "POST" && pathname === "/api/contexts") {
      const bodyRaw = await readBody(req);
      const body = bodyRaw ? JSON.parse(bodyRaw) : {};
      const fileName = body.name
        ? sanitizeContextFileName(body.name)
        : await getNextContextFileName(paths, contextRepo);
      const text = typeof body.text === "string" ? body.text : "";
      const abs = safeResolveInside(paths.contextDir, fileName);
      await ensureDir(paths.contextDir);
      await fsp.writeFile(abs, text, "utf8");
      contextRepo.invalidate(abs);
      graphCache.key = "";
      const contexts = await listContexts(paths, contextRepo);
      return sendJson(res, 200, { ok: true, created: fileName, contexts });
    }

    if (pathname.startsWith("/api/contexts/")) {
      const encodedName = pathname.slice("/api/contexts/".length);
      const fileName = sanitizeContextFileName(decodeURIComponent(encodedName));
      const abs = safeResolveInside(paths.contextDir, fileName);

      if (req.method === "GET") {
        if (!fs.existsSync(abs)) return sendJson(res, 404, { error: "Context nao encontrado." });
        const text = await contextRepo.getContextText(fileName);
        if (text == null) return sendJson(res, 404, { error: "Context nao encontrado." });
        return sendJson(res, 200, { name: fileName, text });
      }

      if (req.method === "PUT") {
        const bodyRaw = await readBody(req);
        const body = bodyRaw ? JSON.parse(bodyRaw) : {};
        const text = typeof body.text === "string" ? body.text : "";
        await ensureDir(paths.contextDir);
        await fsp.writeFile(abs, text, "utf8");
        contextRepo.invalidate(abs);
        graphCache.key = "";
        return sendJson(res, 200, { ok: true, updated: fileName });
      }

      if (req.method === "DELETE") {
        if (!fs.existsSync(abs)) return sendJson(res, 404, { error: "Context nao encontrado." });
        await fsp.unlink(abs);
        contextRepo.invalidate(abs);
        graphCache.key = "";
        return sendJson(res, 200, { ok: true, deleted: fileName });
      }
    }

    if (req.method === "GET" && pathname === "/api/memory") {
      const { text } = await getMemoryTextCached();
      return sendJson(res, 200, { text });
    }

    if (req.method === "PUT" && pathname === "/api/memory") {
      const bodyRaw = await readBody(req);
      const body = bodyRaw ? JSON.parse(bodyRaw) : {};
      const text = typeof body.text === "string" ? body.text : "";
      await ensureDir(path.dirname(paths.memoryFile));
      await fsp.writeFile(paths.memoryFile, text, "utf8");
      memoryCache.text = text;
      if (fs.existsSync(paths.memoryFile)) {
        const st = await fsp.stat(paths.memoryFile);
        memoryCache.mtimeMs = st.mtimeMs;
        memoryCache.size = st.size;
      }
      graphCache.key = "";
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && pathname === "/api/graph") {
      const snapshot = await coordinator.loadGraphSnapshot();
      if (snapshot && snapshot.graph) {
        return sendJson(res, 200, snapshot.graph);
      }

      await contextRepo.ensureScanned();
      const contextVersion = contextRepo.getVersion();
      await coordinator.loadCompressedState();
      const archivedVersion = coordinator.getCompressedStateVersion();
      const memory = await getMemoryTextCached();
      const graphKey = `${contextVersion}|${archivedVersion}|${Math.floor(memory.mtimeMs)}|${memory.size}`;
      if (graphCache.key === graphKey && graphCache.data) {
        return sendJson(res, 200, graphCache.data);
      }
      const contextItems = await contextRepo.getContextDocs();
      const archivedItems = await coordinator.getArchivedContextDocs();
      const merged = new Map();
      for (const item of contextItems) {
        if (!item || !item.name) continue;
        merged.set(String(item.name), item);
      }
      for (const item of archivedItems) {
        if (!item || !item.name) continue;
        if (!merged.has(String(item.name))) merged.set(String(item.name), item);
      }
      const graph = buildGraphFromContexts([...merged.values()], memory.text);
      graphCache.key = graphKey;
      graphCache.data = graph;
      try {
        await coordinator.saveGraphSnapshot(graph, { signature: graphKey, contextCount: merged.size });
      } catch {
        // noop: graph still served even if snapshot persistence fails
      }
      return sendJson(res, 200, graph);
    }

    if (req.method === "GET" && pathname === "/api/graph/snapshot") {
      const snapshot = await coordinator.loadGraphSnapshot();
      if (snapshot && snapshot.graph) {
        return sendJson(res, 200, snapshot.graph);
      }
      const { text } = await getMemoryTextCached();
      const entries = await contextRepo.ensureScanned();
      const knownNames = Array.isArray(entries) ? entries.map((e) => e && e.name).filter(Boolean) : [];
      const fallbackGraph = buildGraphFromMemoryOnly(text, knownNames);
      try {
        await coordinator.saveGraphSnapshot(fallbackGraph, {
          signature: `snapshot-memory-only|${knownNames.length}|${Math.floor(Date.now() / 1000)}`,
          contextCount: fallbackGraph.nodes.length,
        });
      } catch {
        // noop
      }
      return sendJson(res, 200, fallbackGraph);
    }

    if (req.method === "GET" && pathname.startsWith("/languages/")) {
      const rel = pathname.replace(/^\/languages\//, "");
      const safeAbs = safeResolveInside(languagesRoot, rel);
      if (!fs.existsSync(safeAbs) || !fs.statSync(safeAbs).isFile()) {
        return sendJson(res, 404, { error: "Idioma nao encontrado." });
      }
      const content = await fsp.readFile(safeAbs);
      const ext = path.extname(safeAbs).toLowerCase();
      const mime = ext === ".json" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8";
      res.writeHead(200, { "Content-Type": mime, "Content-Length": content.length });
      res.end(content);
      return;
    }

    sendJson(res, 404, { error: "Endpoint nao encontrado." });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      const pathname = url.pathname;

      if (pathname.startsWith("/api/")) {
        await handleApi(req, res, pathname);
        return;
      }

      let rel = pathname === "/" ? "/index.html" : pathname;
      rel = rel.replace(/^\/+/, "");
      const safeAbs = safeResolveInside(guiRoot, rel);
      if (!fs.existsSync(safeAbs) || !fs.statSync(safeAbs).isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      const ext = path.extname(safeAbs).toLowerCase();
      const mime = mimeByExt[ext] || "application/octet-stream";
      const content = await fsp.readFile(safeAbs);
      res.writeHead(200, { "Content-Type": mime, "Content-Length": content.length });
      res.end(content);
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
  });

  return {
    listen() {
      server.once("error", (err) => {
        ui.error("GUI", `Falha ao iniciar interface web em http://${host}:${port} (${String(err)})`);
        process.exitCode = 1;
        setTimeout(() => process.exit(1), 50);
      });
      server.listen(port, host, () => {
        ui.info("GUI", `Interface web ativa em http://${host}:${port}`);
      });
    },
    server,
    controller,
  };
}

function resolvePromptFile(root) {
  const candidates = [
    path.join(root, "OLLAMA_PROMPT.md"),
    path.join(root, "OLLAMA_prompt.md"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(root, DEFAULT_PROMPT_FILENAME);
}

function resolveCodexPromptExampleFile(root) {
  return path.join(root, DEFAULT_CODEX_PROMPT_EXAMPLE_FILENAME);
}

async function loadAIPathsConfig(root, ui) {
  const configFile = path.join(root, AI_PATHS_CONFIG_RELATIVE);
  const defaultBaseRoot = path.dirname(root);
  const projectFolderName = path.basename(root);
  const defaultConfig = {
    baseRootPath: defaultBaseRoot,
  };

  await ensureDir(path.dirname(configFile));
  if (!fs.existsSync(configFile)) {
    await fsp.writeFile(configFile, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf8");
    ui.info("CONFIG", `Arquivo criado: ${normalizePathForPrompt(configFile)}`);
  }

  let userConfig = {};
  try {
    const raw = await fsp.readFile(configFile, "utf8");
    userConfig = raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    ui.warn("CONFIG", `Falha ao ler ai_paths.json (${String(err)}). Usando padrao.`);
  }

  const configBaseRoot =
    userConfig && typeof userConfig.baseRootPath === "string" && userConfig.baseRootPath.trim()
      ? path.resolve(userConfig.baseRootPath.trim())
      : defaultBaseRoot;
  const configuredProjectRoot = path.resolve(configBaseRoot, projectFolderName);
  const effectiveProjectRoot = fs.existsSync(configuredProjectRoot) ? configuredProjectRoot : root;
  if (effectiveProjectRoot !== configuredProjectRoot) {
    ui.warn(
      "CONFIG",
      `Projeto nao encontrado em ${normalizePathForPrompt(configuredProjectRoot)}. Usando raiz atual.`,
    );
  }

  const fallbackPromptFile = resolvePromptFile(effectiveProjectRoot);
  const resolved = {
    root: effectiveProjectRoot,
    configFile,
    baseRootPath: configBaseRoot,
    promptFile: fallbackPromptFile,
    codexPromptExampleFile: path.join(effectiveProjectRoot, DEFAULT_CODEX_PROMPT_EXAMPLE_FILENAME),
    contextDir: path.join(effectiveProjectRoot, "memory_voult", "context"),
    memoryFile: path.join(effectiveProjectRoot, "memory_voult", "AGENT_MEMORY.md"),
  };

  resolved.promptVars = buildPromptPathVars(resolved);
  return resolved;
}

function buildPaths(root) {
  return {
    root,
    promptFile: resolvePromptFile(root),
    codexPromptExampleFile: resolveCodexPromptExampleFile(root),
    configFile: path.join(root, AI_PATHS_CONFIG_RELATIVE),
    contextDir: path.join(root, "memory_voult", "context"),
    memoryFile: path.join(root, "memory_voult", "AGENT_MEMORY.md"),
  };
}

function parseArgs(argv) {
  const parsed = {
    mode: "gui",
    refreshSec: Number(process.env.DAEMON_REFRESH_SEC || 300),
    once: false,
    guiHost: process.env.GUI_HOST || "127.0.0.1",
    guiPort: Number(process.env.GUI_PORT || 4173),
    guiPortExplicit: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode" && argv[i + 1]) {
      parsed.mode = argv[i + 1];
      i += 1;
    } else if (arg === "--daemon") {
      parsed.mode = "daemon";
    } else if (arg === "--gui") {
      parsed.mode = "gui";
    } else if (arg === "--once") {
      parsed.once = true;
    } else if (arg === "--refresh-sec" && argv[i + 1]) {
      parsed.refreshSec = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--gui-host" && argv[i + 1]) {
      parsed.guiHost = String(argv[i + 1]);
      i += 1;
    } else if (arg === "--gui-port" && argv[i + 1]) {
      parsed.guiPort = Number(argv[i + 1]);
      parsed.guiPortExplicit = true;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    }
  }
  const supportedModes = new Set(["gui", "daemon"]);
  if (!supportedModes.has(String(parsed.mode || "").toLowerCase())) {
    parsed.mode = "gui";
  }
  if (!Number.isFinite(parsed.refreshSec) || parsed.refreshSec <= 0) parsed.refreshSec = 300;
  if (!Number.isFinite(parsed.guiPort) || parsed.guiPort <= 0) parsed.guiPort = 4173;
  return parsed;
}

function canListen(host, port) {
  return new Promise((resolve) => {
    const tester = http.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}

async function pickFreeGuiPort(host, startPort, attempts = 20) {
  let port = Number(startPort) || 4173;
  for (let i = 0; i < attempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const free = await canListen(host, port);
    if (free) return port;
    port += 1;
  }
  throw new Error(`Nenhuma porta livre entre ${startPort} e ${startPort + attempts - 1}.`);
}

function printHelp() {
  const help = [
    "Uso: node server.js [opcoes]",
    "",
    "Opcoes:",
    "  --mode <daemon|gui>      Define modo de execucao (padrao: gui)",
    "  --daemon                 Atalho para --mode daemon",
    "  --gui                    Atalho para --mode gui",
    "  --refresh-sec <n>        Intervalo do daemon em segundos (padrao: 300)",
    "  --once                   No modo daemon, executa uma vez e encerra",
    "  --gui-host <host>        Host da GUI (padrao: 127.0.0.1)",
    "  --gui-port <port>        Porta da GUI (padrao: 4173)",
    "  -h, --help               Mostra esta ajuda",
  ];
  process.stdout.write(`${help.join("\n")}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  const root = path.resolve(__dirname);
  const ui = new TerminalUI();
  ui.banner();

  const mode = String(args.mode || "gui").toLowerCase();
  const model = process.env.OLLAMA_MODEL || DEFAULT_MODEL;
  const memoryEngine = normalizeMemoryEngine(process.env.MEMORY_ENGINE || DEFAULT_MEMORY_ENGINE);
  const ollamaHost = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
  const timeoutSec = Number(process.env.OLLAMA_TIMEOUT_SEC || 300);
  const contextMaxPerFile = Number(
    process.env.OLLAMA_CONTEXT_MAX_CHARS_PER_FILE || DEFAULT_CONTEXT_MAX_CHARS_PER_FILE,
  );
  const contextMaxTotal = Number(
    process.env.OLLAMA_CONTEXT_MAX_TOTAL_CHARS || DEFAULT_CONTEXT_MAX_TOTAL_CHARS,
  );
  const safeTimeoutSec = Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : 300;
  const safeContextMaxPerFile =
    Number.isFinite(contextMaxPerFile) && contextMaxPerFile > 0
      ? Math.floor(contextMaxPerFile)
      : DEFAULT_CONTEXT_MAX_CHARS_PER_FILE;
  const safeContextMaxTotal =
    Number.isFinite(contextMaxTotal) && contextMaxTotal > 0
      ? Math.floor(contextMaxTotal)
      : DEFAULT_CONTEXT_MAX_TOTAL_CHARS;
  const paths = await loadAIPathsConfig(root, ui);
  paths.promptVars = buildPromptPathVars(paths);
  await syncPromptPathBlocks(paths, ui);
  const contextRepo = new ContextRepository(paths);

  ui.info("CONFIG", `Prompt: ${paths.promptFile.replace(/\\/g, "/")}`);
  ui.info("CONFIG", `Codex prompt example: ${paths.codexPromptExampleFile.replace(/\\/g, "/")}`);
  ui.info("CONFIG", `AI paths config: ${paths.configFile.replace(/\\/g, "/")}`);
  ui.info("CONFIG", `Base root path: ${paths.baseRootPath.replace(/\\/g, "/")}`);
  ui.info("CONFIG", `Project root: ${paths.root.replace(/\\/g, "/")}`);
  ui.info("CONFIG", `Contextos: ${paths.contextDir.replace(/\\/g, "/")}`);
  ui.info("CONFIG", `Memoria: ${paths.memoryFile.replace(/\\/g, "/")}`);
  ui.info("CONFIG", `Modo: ${mode}`);
  ui.info("CONFIG", `Engine: ${memoryEngine}`);
  if (memoryEngine === "ollama") {
    ui.info("CONFIG", `Ollama: ${ollamaHost} | Modelo: ${model}`);
  } else {
    ui.info("CONFIG", "Ollama desativado nesta sessao (modo algoritmo deterministico).");
  }
  ui.info(
    "CONFIG",
    `Context prompt limits: per-file=${safeContextMaxPerFile} | total=${safeContextMaxTotal}`,
  );

  const coordinator = new AgentMemoryCoordinator(
    paths,
    ui,
    model,
    ollamaHost,
    safeTimeoutSec,
    safeContextMaxPerFile,
    safeContextMaxTotal,
    contextRepo,
    memoryEngine,
  );

  if (mode === "daemon") {
    const daemon = new DaemonRunner(coordinator, ui, args.refreshSec);
    return daemon.run(Boolean(args.once));
  }

  if (mode === "gui") {
    const requestedPort = args.guiPort;
    const resolvedPort = args.guiPortExplicit
      ? requestedPort
      : await pickFreeGuiPort(args.guiHost, requestedPort, 20);
    if (resolvedPort !== requestedPort) {
      ui.warn(
        "GUI",
        `Porta ${requestedPort} ocupada. Usando ${resolvedPort}.`,
      );
    }
    const gui = createGUIServer(
      paths,
      coordinator,
      contextRepo,
      ui,
      args.refreshSec,
      args.guiHost,
      resolvedPort,
    );
    gui.listen();
    ui.info("GUI", "Inicializacao rapida ativa: consolidacao sob demanda (sem carga de contextos no boot).");
    void gui.controller.start().catch((err) => {
      ui.error("GUI", `Falha ao iniciar daemon interno automaticamente: ${String(err)}`);
    });
    return 0;
  }

  ui.warn("CONFIG", `Modo '${mode}' nao suportado. Iniciando GUI.`);
  const fallbackRequestedPort = args.guiPort;
  const fallbackResolvedPort = await pickFreeGuiPort(args.guiHost, fallbackRequestedPort, 20);
  if (fallbackResolvedPort !== fallbackRequestedPort) {
    ui.warn(
      "GUI",
      `Porta ${fallbackRequestedPort} ocupada. Usando ${fallbackResolvedPort}.`,
    );
  }
  const gui = createGUIServer(
    paths,
    coordinator,
    contextRepo,
    ui,
    args.refreshSec,
    args.guiHost,
    fallbackResolvedPort,
  );
  gui.listen();
  ui.info("GUI", "Inicializacao rapida ativa: consolidacao sob demanda (sem carga de contextos no boot).");
  void gui.controller.start().catch((err) => {
    ui.error("GUI", `Falha ao iniciar daemon interno automaticamente: ${String(err)}`);
  });
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => {
      if (typeof code === "number" && code !== 0) process.exit(code);
    })
    .catch((err) => {
      process.stderr.write(`[FATAL] ${String(err)}\n`);
      process.exit(1);
    });
}

module.exports = {
  AgentMemoryCoordinator,
  ContextRepository,
  parseContextAssignments,
  compareContextNames,
  normalizeMemoryEngine,
  BRAIN_AREAS,
  DEFAULT_MEMORY_ENGINE,
  CONTEXT_COMPRESSION_BATCH_SIZE,
  CONTEXT_COMPRESSION_TRIGGER_COUNT,
};
