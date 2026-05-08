const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  AgentMemoryCoordinator,
  CONTEXT_COMPRESSION_BATCH_SIZE,
} = require("../server.js");

function makeCoordinator(tmpRoot) {
  return makeCoordinatorWithEngine(tmpRoot, "ollama");
}

function makeCoordinatorWithEngine(tmpRoot, memoryEngine) {
  const paths = {
    root: tmpRoot,
    promptFile: path.join(tmpRoot, "OLLAMA_PROMPT.md"),
    codexPromptExampleFile: path.join(tmpRoot, "CODEX_PROMPT_EXAMPLE.md"),
    memoryFile: path.join(tmpRoot, "memory_voult", "AGENT_MEMORY.md"),
    contextDir: path.join(tmpRoot, "memory_voult", "context"),
  };
  const ui = { info() {}, warn() {}, error() {}, stderr() {}, banner() {} };
  const contextRepo = {
    async getContextDocs() { return []; },
    async listContexts() { return []; },
    async getContextText() { return ""; },
    invalidate() {},
  };
  return new AgentMemoryCoordinator(
    paths,
    ui,
    "fake-model",
    "http://127.0.0.1:11434",
    30,
    3500,
    22000,
    contextRepo,
    memoryEngine,
  );
}

test("semantic compression keeps high-value recent contexts", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-memory-test-"));
  const coordinator = makeCoordinator(tmpRoot);
  const assignments = new Map();
  const candidates = [];

  for (let i = 1; i <= 21; i += 1) {
    const name = `context_${i}.md`;
    const relativePath = `memory_voult/context/${name}`;
    const text = i <= 15
      ? "- temporary note\n- duplicated note\n- duplicated note"
      : `- Security rule ${i}\n- Must keep audit trail ${i}\n- Architecture boundary ${i}`;
    candidates.push({ name, relativePath, text });
    assignments.set(relativePath.toLowerCase(), { area: "PROJECT_MEMORY", subarea: "" });
    assignments.set(name.toLowerCase(), { area: "PROJECT_MEMORY", subarea: "" });
  }

  const metrics = coordinator.buildContextQualityMetrics(candidates, assignments, {});
  const batch = coordinator.pickBatchForCompression(candidates, metrics);
  const names = new Set(batch.map((item) => item.name));

  assert.equal(batch.length, CONTEXT_COMPRESSION_BATCH_SIZE);
  assert.ok(names.has("context_1.md"));
  assert.ok(names.has("context_5.md"));
  assert.ok(!names.has("context_21.md"));
});

test("canonical decisions mark contradictions as superseded", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-memory-test-"));
  const coordinator = makeCoordinator(tmpRoot);
  const previous = {
    decisions: [
      {
        id: "dec_old",
        key: "theme_force_dark",
        text: "The interface must always force dark theme for all users.",
        area: "REQUIREMENT_UNDERSTANDING",
        polarity: 1,
        confidence: 0.81,
        sources: ["context_4.md"],
        status: "active",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
        lastSeenAt: "2026-05-01T00:00:00.000Z",
      },
    ],
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
  const candidates = [
    {
      id: "dec_new",
      key: "theme_no_force_dark",
      text: "The interface must not force dark theme globally.",
      area: "REQUIREMENT_UNDERSTANDING",
      polarity: -1,
      confidence: 0.9,
      source: "context_21.md",
    },
  ];
  const merged = coordinator.mergeCanonicalDecisions(previous, candidates);
  const active = merged.nextState.decisions.filter((item) => item.status === "active");
  const superseded = merged.nextState.decisions.filter((item) => item.status === "superseded");

  assert.equal(merged.contradictions.length, 1);
  assert.equal(active.length, 1);
  assert.equal(active[0].id, "dec_new");
  assert.equal(superseded.length, 1);
  assert.equal(superseded[0].id, "dec_old");
  assert.equal(superseded[0].supersededBySource, "context_21.md");
});

test("intelligent summary includes traceability and canonical sections", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-memory-test-"));
  const coordinator = makeCoordinator(tmpRoot);
  const baseSummary = [
    "## BRAIN AREAS",
    "",
    "### AREA: PROJECT_MEMORY",
    "- Keep runtime always on.",
    "",
    "### AREA: INCREMENTAL_LEARNING",
    "- Reclassify new contexts.",
    "",
    "## CONTEXT ASSIGNMENTS",
    "- memory_voult/context/context_11.md => PROJECT_MEMORY :: runtime",
  ].join("\n");

  const docs = [
    {
      name: "context_11.md",
      relativePath: "memory_voult/context/context_11.md",
      text: "- Keep runtime always on.",
    },
  ];
  const canonicalState = {
    decisions: [
      {
        id: "dec_a",
        key: "runtime_always_on",
        text: "Runtime must stay always on with reconnection.",
        area: "EXECUTION_AND_TOOLING",
        polarity: 1,
        confidence: 0.87,
        sources: ["context_11.md"],
        status: "active",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
        lastSeenAt: "2026-05-01T00:00:00.000Z",
      },
    ],
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
  const summary = coordinator.buildIntelligentSummary(
    baseSummary,
    docs,
    canonicalState,
    [],
    { "context_11.md": { qualityScore: 0.8, recencyScore: 0.9 } },
  );

  assert.match(summary, /## CANONICAL DECISIONS/);
  assert.match(summary, /\[src:/);
  assert.match(summary, /## TRACEABILITY INDEX/);
});

test("memory snapshots keep only latest 10 versions", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-memory-test-"));
  const coordinator = makeCoordinator(tmpRoot);
  for (let i = 0; i < 12; i += 1) {
    await coordinator.writeMemorySnapshot(`# Snapshot ${i}\n`);
  }
  const files = fs
    .readdirSync(coordinator.snapshotDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^AGENT_MEMORY_/i.test(entry.name));
  assert.ok(files.length <= 10);
});

test("algorithm engine builds deterministic summary without ollama", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-memory-test-"));
  const coordinator = makeCoordinatorWithEngine(tmpRoot, "algorithm");
  const docs = [
    {
      name: "context_1.md",
      relativePath: "memory_voult/context/context_1.md",
      text: "- Runtime must stay always on.\n- Serial logs should remain visible.",
    },
    {
      name: "context_2.md",
      relativePath: "memory_voult/context/context_2.md",
      text: "- Security validation must fail fast for missing token.",
    },
  ];
  const summary = coordinator.buildAlgorithmSummary(docs, "", {
    "context_1.md": { qualityScore: 0.8 },
    "context_2.md": { qualityScore: 0.9 },
  });

  assert.match(summary, /## BRAIN AREAS/);
  assert.match(summary, /## CONTEXT ASSIGNMENTS/);
  assert.match(summary, /memory_voult\/context\/context_1\.md =>/);
  assert.match(summary, /memory_voult\/context\/context_2\.md =>/);
});

test("algorithm engine reports ollama as disabled", async () => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-memory-test-"));
  const coordinator = makeCoordinatorWithEngine(tmpRoot, "algorithm");
  const status = await coordinator.getOllamaStatus();
  assert.equal(status.engine, "algorithm");
  assert.equal(status.modelConfigured, "algorithm");
});
