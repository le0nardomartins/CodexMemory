const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { URL } = require("node:url");

const SERVER_NAME = "codex-memory-server";
const SERVER_VERSION = "2.0.0-js";
const DEFAULT_PROMPT_FILENAME = "OLLAMA_PROMPT.md";
const DEFAULT_CODEX_PROMPT_EXAMPLE_FILENAME = "CODEX_PROMPT_EXAMPLE.md";
const DEFAULT_MODEL = "qwen2.5:3b";
const DEFAULT_CONTEXT_MAX_CHARS_PER_FILE = 3500;
const DEFAULT_CONTEXT_MAX_TOTAL_CHARS = 22000;
const AI_PATHS_CONFIG_RELATIVE = path.join("config", "ai_paths.json");

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

function formatDateAndTimeLine() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return `${date} | ${time}`;
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
  result.sort((a, b) => a.localeCompare(b, "en"));
  return result;
}

class AgentMemoryCoordinator {
  constructor(paths, ui, model, ollamaHost, timeoutSec, contextMaxPerFile, contextMaxTotal) {
    this.paths = paths;
    this.promptVars = buildPromptPathVars(paths);
    this.ui = ui;
    this.model = model;
    this.timeoutSec = timeoutSec;
    this.contextMaxPerFile = contextMaxPerFile;
    this.contextMaxTotal = contextMaxTotal;
    this.ollamaUrl = `${ollamaHost.replace(/\/+$/, "")}/api/generate`;
    this.lastMemoryText = "";
    this.uniqueRole =
      "Memory curator for CodexMemory: read all context .md files and consolidate a single operational memory in AGENT_MEMORY.md.";
  }

  async contextPaths() {
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
    const files = await this.contextPaths();
    const docs = await Promise.all(
      files.map(async (abs) => {
        const text = (await fsp.readFile(abs, "utf8")).trim();
        return {
          absolutePath: abs,
          relativePath: path.relative(this.paths.root, abs).replace(/\\/g, "/"),
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

  async callOllama(systemPrompt, prompt) {
    const payload = {
      model: this.model,
      system: systemPrompt,
      prompt,
      stream: false,
      options: { temperature: 0.1 },
    };

    const response = await fetch(this.ollamaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutSec * 1000),
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
  }

  ollamaBaseHost() {
    return this.ollamaUrl.replace(/\/api\/generate$/, "");
  }

  async getOllamaStatus() {
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

      return {
        ok: Boolean(modelInstalled),
        reachable: true,
        host,
        modelConfigured: configuredModel,
        modelInstalled,
        models: modelNames.slice(0, 100),
        checkedAt: new Date().toISOString(),
        error: null,
      };
    } catch (err) {
      return {
        ok: false,
        reachable: false,
        host,
        modelConfigured: configuredModel,
        modelInstalled: false,
        models: [],
        checkedAt: new Date().toISOString(),
        error: String(err),
      };
    }
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
    const idx = normalized.indexOf(marker);
    if (idx >= 0) {
      const beforeMarker = normalized.slice(0, idx);
      const cleanedBefore = beforeMarker
        .split("\n")
        .filter((line) => !/^single role:/i.test(String(line).trim()))
        .join("\n")
        .trimEnd();
      return `${cleanedBefore}\n\n${marker}`;
    }
    return [
      formatDateAndTimeLine(),
      "# AGENT MEMORY",
      "",
      marker,
    ].join("\n");
  }

  buildMemoryFile(summary, docs, previousMemoryText = "") {
    const normalizedSummary = this.enforceSummaryTemplate(summary, docs);
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

  async refreshMemory(reason, forceOllama = true) {
    this.ui.info("SYNC", `Atualizando AGENT_MEMORY.md (${reason})`);
    const promptMd = await this.loadPrompt();
    const docs = await this.loadContextDocs();
    this.ui.info(
      "SYNC",
      `Prompt carregado (${path.basename(this.paths.promptFile)}) e ${docs.length} arquivo(s) de contexto.`,
    );

    let summary;
    if (forceOllama) {
      const ollamaSystemPrompt = this.buildSystemPrompt(promptMd);
      const ollamaPrompt = this.buildOllamaInput(docs);
      this.ui.info("OLLAMA", `Chamando modelo '${this.model}' para consolidar memoria.`);
      try {
        summary = await this.callOllama(ollamaSystemPrompt, ollamaPrompt);
        this.ui.info("OLLAMA", "Resumo recebido do Ollama com sucesso.");
      } catch (err) {
        this.ui.warn("OLLAMA", `Falha ao consultar Ollama (${String(err)}). Usando fallback local.`);
        summary = this.fallbackSummary(docs, err);
      }
    } else {
      summary = this.fallbackSummary(docs, new Error("Modo sem consulta ao Ollama."));
    }

    let previousMemoryText = "";
    if (fs.existsSync(this.paths.memoryFile)) {
      previousMemoryText = await fsp.readFile(this.paths.memoryFile, "utf8");
    }
    const memoryText = this.buildMemoryFile(summary, docs, previousMemoryText);
    await ensureDir(path.dirname(this.paths.memoryFile));
    await fsp.writeFile(this.paths.memoryFile, memoryText, "utf8");
    this.lastMemoryText = memoryText;
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

  async syncNow(reason = "gui sync") {
    try {
      await this.coordinator.refreshMemory(reason);
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

async function listContexts(paths) {
  await ensureDir(paths.contextDir);
  const files = await walkMarkdownFiles(paths.contextDir);
  const contexts = [];
  for (const file of files) {
    const stat = await fsp.stat(file);
    const text = await fsp.readFile(file, "utf8");
    contexts.push({
      name: path.basename(file),
      relativePath: path.relative(paths.root, file).replace(/\\/g, "/"),
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      preview: text.replace(/\s+/g, " ").slice(0, 160),
    });
  }
  contexts.sort((a, b) => a.name.localeCompare(b.name));
  return contexts;
}

async function getNextContextFileName(paths) {
  const contexts = await listContexts(paths);
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

function buildGraphFromContexts(contextItems, memoryText = "") {
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
    return {
      id: item.name,
      label: item.name,
      relativePath: item.relativePath,
      tokenCount: tokens.length,
      keywords,
      keywordSet: new Set(keywords),
      textNorm: String(item.text || "").toLowerCase(),
      mentionPatterns: buildContextMentionPatterns(item.name),
    };
  });

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

  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      label: n.label,
      relativePath: n.relativePath,
      tokenCount: n.tokenCount,
      keywords: n.keywords,
      radius: Math.max(12, Math.min(34, 12 + Math.floor(Math.sqrt(Math.max(1, n.tokenCount))))),
    })),
    links,
  };
}

function createGUIServer(paths, coordinator, ui, refreshSec, host, port) {
  const controller = new GUIController(coordinator, ui, refreshSec);
  const guiRoot = path.join(paths.root, "GUI");
  const languagesRoot = path.join(paths.root, "languages");

  const mimeByExt = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
  };

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
      const result = await controller.syncNow("gui force agent memory");
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
      const contexts = await listContexts(paths);
      return sendJson(res, 200, { contexts });
    }

    if (req.method === "POST" && pathname === "/api/contexts") {
      const bodyRaw = await readBody(req);
      const body = bodyRaw ? JSON.parse(bodyRaw) : {};
      const fileName = body.name ? sanitizeContextFileName(body.name) : await getNextContextFileName(paths);
      const text = typeof body.text === "string" ? body.text : "";
      const abs = safeResolveInside(paths.contextDir, fileName);
      await ensureDir(paths.contextDir);
      await fsp.writeFile(abs, text, "utf8");
      const contexts = await listContexts(paths);
      return sendJson(res, 200, { ok: true, created: fileName, contexts });
    }

    if (pathname.startsWith("/api/contexts/")) {
      const encodedName = pathname.slice("/api/contexts/".length);
      const fileName = sanitizeContextFileName(decodeURIComponent(encodedName));
      const abs = safeResolveInside(paths.contextDir, fileName);

      if (req.method === "GET") {
        if (!fs.existsSync(abs)) return sendJson(res, 404, { error: "Context nao encontrado." });
        const text = await fsp.readFile(abs, "utf8");
        return sendJson(res, 200, { name: fileName, text });
      }

      if (req.method === "PUT") {
        const bodyRaw = await readBody(req);
        const body = bodyRaw ? JSON.parse(bodyRaw) : {};
        const text = typeof body.text === "string" ? body.text : "";
        await ensureDir(paths.contextDir);
        await fsp.writeFile(abs, text, "utf8");
        return sendJson(res, 200, { ok: true, updated: fileName });
      }

      if (req.method === "DELETE") {
        if (!fs.existsSync(abs)) return sendJson(res, 404, { error: "Context nao encontrado." });
        await fsp.unlink(abs);
        return sendJson(res, 200, { ok: true, deleted: fileName });
      }
    }

    if (req.method === "GET" && pathname === "/api/memory") {
      await ensureDir(path.dirname(paths.memoryFile));
      const text = fs.existsSync(paths.memoryFile) ? await fsp.readFile(paths.memoryFile, "utf8") : "";
      return sendJson(res, 200, { text });
    }

    if (req.method === "PUT" && pathname === "/api/memory") {
      const bodyRaw = await readBody(req);
      const body = bodyRaw ? JSON.parse(bodyRaw) : {};
      const text = typeof body.text === "string" ? body.text : "";
      await ensureDir(path.dirname(paths.memoryFile));
      await fsp.writeFile(paths.memoryFile, text, "utf8");
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && pathname === "/api/graph") {
      const contextFiles = await walkMarkdownFiles(paths.contextDir);
      const contextItems = [];
      for (const abs of contextFiles) {
        const text = await fsp.readFile(abs, "utf8");
        contextItems.push({
          name: path.basename(abs),
          relativePath: path.relative(paths.root, abs).replace(/\\/g, "/"),
          text,
        });
      }
      const memoryText = fs.existsSync(paths.memoryFile)
        ? await fsp.readFile(paths.memoryFile, "utf8")
        : "";
      return sendJson(res, 200, buildGraphFromContexts(contextItems, memoryText));
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
  const ollamaHost = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
  const timeoutSec = Number(process.env.OLLAMA_TIMEOUT_SEC || 120);
  const contextMaxPerFile = Number(
    process.env.OLLAMA_CONTEXT_MAX_CHARS_PER_FILE || DEFAULT_CONTEXT_MAX_CHARS_PER_FILE,
  );
  const contextMaxTotal = Number(
    process.env.OLLAMA_CONTEXT_MAX_TOTAL_CHARS || DEFAULT_CONTEXT_MAX_TOTAL_CHARS,
  );
  const safeTimeoutSec = Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : 120;
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

  ui.info("CONFIG", `Prompt: ${paths.promptFile.replace(/\\/g, "/")}`);
  ui.info("CONFIG", `Codex prompt example: ${paths.codexPromptExampleFile.replace(/\\/g, "/")}`);
  ui.info("CONFIG", `AI paths config: ${paths.configFile.replace(/\\/g, "/")}`);
  ui.info("CONFIG", `Base root path: ${paths.baseRootPath.replace(/\\/g, "/")}`);
  ui.info("CONFIG", `Project root: ${paths.root.replace(/\\/g, "/")}`);
  ui.info("CONFIG", `Contextos: ${paths.contextDir.replace(/\\/g, "/")}`);
  ui.info("CONFIG", `Memoria: ${paths.memoryFile.replace(/\\/g, "/")}`);
  ui.info("CONFIG", `Modo: ${mode}`);
  ui.info("CONFIG", `Ollama: ${ollamaHost} | Modelo: ${model}`);
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
  );

  try {
    await coordinator.refreshMemory("boot do server");
  } catch (err) {
    ui.error("BOOT", `Falha na atualizacao inicial da memoria: ${String(err)}`);
  }

  if (mode === "daemon") {
    const daemon = new DaemonRunner(coordinator, ui, args.refreshSec);
    return daemon.run(Boolean(args.once));
  }

  if (mode === "gui") {
    const gui = createGUIServer(paths, coordinator, ui, args.refreshSec, args.guiHost, args.guiPort);
    gui.listen();
    // Inicia o daemon automaticamente para que GUI e sync rodem juntos.
    await gui.controller.start();
    return 0;
  }

  ui.warn("CONFIG", `Modo '${mode}' nao suportado. Iniciando GUI.`);
  const gui = createGUIServer(paths, coordinator, ui, args.refreshSec, args.guiHost, args.guiPort);
  gui.listen();
  await gui.controller.start();
  return 0;
}

main()
  .then((code) => {
    if (typeof code === "number" && code !== 0) process.exit(code);
  })
  .catch((err) => {
    process.stderr.write(`[FATAL] ${String(err)}\n`);
    process.exit(1);
  });
