# Technical Documentation — Codex Memory

<p align="right">
  🌐
  <a href="../pt-BR/TECHNICAL.md">Português</a> ·
  <strong>English</strong> ·
  <a href="../es-ES/TECHNICAL.md">Español</a>
</p>

## Purpose

This document describes internal architecture, runtime behavior, data flow, and extension points for contributors working on Codex Memory.

---

## Runtime Components

| Component | File | Responsibility |
|---|---|---|
| HTTP Server | `server.js` | REST API, engine orchestration, memory consolidation, graph snapshot |
| GUI | `GUI/` | Browser client for control, context editing, and graph rendering |
| Desktop | `electron/main.js` | Electron runtime that starts the GUI server and opens the native window |
| Setup | `setup_codex_memory.bat` | Windows script for setup, dependency checks, and launch modes |
| Visual config | `GUI/config.json` | Neuron animation and layout parameters (editable without recompiling) |

---

## Operating Modes

### Desktop
Entry point: `npm start`  
Electron starts the server and points the window to `http://localhost:4173`.

### GUI
Entry point: `node server.js --mode gui`  
Starts the HTTP server and serves static GUI assets.  
Does not run consolidation on boot and does not auto-start the internal daemon.

### Daemon
Entry point: `node server.js --mode daemon`  
Periodically updates `memory_voult/AGENT_MEMORY.md`.  
Use `--once` for a single pass.

---

## Data Model

### Context Inputs
Path: `memory_voult/context/context_*.md`  
Each file is a memory source. Loaded during consolidation (daemon / manual sync / force), not at GUI boot.

### Prompt Source
Path: `OLLAMA_PROMPT.md`  
Loaded on each consolidation call as the system prompt basis for Ollama.

### Consolidated Output
Path: `memory_voult/AGENT_MEMORY.md`  
Generated from context content plus prompt rules. Header preservation logic keeps stable metadata, enforces `# AGENT MEMORY`, and does not include a timestamp line at the top.

### State Files

| File | Contents |
|---|---|
| `.context_state.json` | Context hashes and quality metrics per file |
| `.canonical_state.json` | Canonical decisions, confidence, source links, supersession lineage |
| `.neuron_graph_snapshot.json` | Latest computed graph payload for fast GUI rendering |
| `snapshots/AGENT_MEMORY_*.md` | Rolling snapshots (latest 10) |
| `.compressed_context_state.json` | Legacy file kept for compatibility (compression disabled) |

---

## Consolidation Pipeline

```
Trigger (daemon / sync / force)
  ↓
Read and normalize context files
  ↓
Resolve engine (MEMORY_ENGINE)
  ↓
  ├── ollama → read OLLAMA_PROMPT.md → call Ollama API
  └── algorithm → deterministic semantic classification pipeline
  ↓
Merge with preserved header, strip legacy timestamp lines
  ↓
Write AGENT_MEMORY.md
  ↓
Persist graph snapshot
```

---

## Graph Engine

**Endpoint:** `GET /api/graph`

**Read path:**
1. Return persisted graph from `.neuron_graph_snapshot.json` when available
2. If missing, rebuild from contexts and persist new snapshot

**Node creation rules:**
- One node per context file
- Metadata: title, category, references, mention patterns

**Edge creation rules:**
- Keyword and similarity based links from context analysis
- Memory co-mention links from lines referencing multiple contexts in `AGENT_MEMORY.md`

**Frontend simulation characteristics:**

| Aspect | Behavior |
|---|---|
| Foundation neuron | Fixed at center, visually scaled up (`foundationScale` in `config.json`) |
| Normal neurons | Sinusoidal idle animation around anchor position (`homeX`/`homeY`) |
| Area zones | Memory-area based distribution with iterative separation |
| Zoom/pan | Unbounded, infinite navigation |
| Tooltip | Context name, reference count, area |

---

## Neural Network Configuration (`GUI/config.json`)

`GUI/config.json` exposes visual and animation parameters:

```json
{
  "neuron": {
    "foundationScale": 5,
    "normalScale": 2.82,
    "minSpacing": 74,
    "maxSpacing": 190
  },
  "idle": {
    "enabled": true,
    "tickSpeed": 0.018,
    "freqVariation": 0.6,
    "yRatio": 0.71
  }
}
```

| Parameter | Effect |
|---|---|
| `foundationScale` | Relative size of the foundation neuron |
| `normalScale` | Relative size of normal neurons |
| `minSpacing` / `maxSpacing` | Distance between neurons in a zone (world units) |
| `idle.enabled` | Enable/disable idle animation |
| `idle.tickSpeed` | Global speed of all animations |
| `idle.freqVariation` | Frequency variation between neurons (prevents sync) |
| `idle.yRatio` | Y/X frequency ratio (creates elliptical trajectory) |

---

## Internationalization

Locale files live in `languages/` and are loaded dynamically by the GUI.

**Current locale strategy:**
1. Detect browser preferred language via `navigator.languages`
2. Map to supported locale set (`pt-BR`, `en-US`, `es-ES`)
3. Fetch locale table through server endpoint
4. Apply translated labels to static and dynamic interface strings

The localization scope is the interface only. Memory content remains controlled by consolidation rules.

---

## API Surface

### Status

```
GET  /api/status
GET  /api/ollama-status
```

### Sync and Memory

```
POST /api/sync
POST /api/memory/force
GET  /api/memory
PUT  /api/memory
```

### Daemon Control

```
POST /api/daemon/start
POST /api/daemon/stop
POST /api/daemon/restart
```

### Context Management

```
GET    /api/contexts
POST   /api/contexts
GET    /api/contexts/:name
PUT    /api/contexts/:name
DELETE /api/contexts/:name
```

### Graph and Assets

```
GET /api/graph
GET /api/graph/snapshot
GET /languages/:filename
```

---

## Development Workflow

1. `npm install` — install dependencies
2. `npm start` — desktop mode for integrated testing
3. `node server.js --mode gui` — browser-only debugging
4. `node server.js --mode daemon --once` — quickly validate consolidation pipeline
5. `npm run test:memory` — regression tests

---

## Contribution Focus Areas

1. Prompt safety and output quality controls
2. Context to memory extraction accuracy
3. Graph relevance and visual readability
4. UI localization coverage and language quality
5. Reliability of Windows operational scripts

---

## Security and Operational Notes

1. Service is local first by design
2. Ollama endpoint is configurable and should remain trusted local infrastructure by default
3. Context and memory files may contain sensitive project information
4. Avoid exposing GUI and API ports to untrusted networks
