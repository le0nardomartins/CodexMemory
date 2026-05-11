# Codex Memory Technical README

> This file is the legacy technical reference kept at the root for compatibility.  
> The maintained per-language technical docs are in [`docs/`](docs/):
>
> | Language | Link |
> |---|---|
> | 🇧🇷 Português | [docs/pt-BR/TECHNICAL.md](docs/pt-BR/TECHNICAL.md) |
> | 🇺🇸 English | [docs/en-US/TECHNICAL.md](docs/en-US/TECHNICAL.md) |
> | 🇪🇸 Español | [docs/es-ES/TECHNICAL.md](docs/es-ES/TECHNICAL.md) |

---

## Purpose

This document describes internal architecture, runtime behavior, data flow, and extension points for contributors working on Codex Memory.

## Runtime Components

1. `server.js`  
   Local HTTP server, engine orchestration (`ollama` or `algorithm`), on-demand memory consolidation, and graph snapshot serving.

2. `GUI/`  
   Browser client for operational control, context editing, memory viewing, and graph rendering.

3. `electron/main.js`  
   Desktop runtime that starts the GUI server and opens the native window with project branding.

4. `setup_codex_memory.bat`  
   Windows control script for setup, dependency checks, launch modes, shutdown, and localized menu output.

## Operating Modes

### Desktop Mode

Entry point: `npm start` or `npm run desktop`  
Electron launches the app window and points it to the local GUI server.

### GUI Mode

Entry point: `node server.js --mode gui`  
Runs HTTP API and static GUI assets without Electron.  
Startup is non-blocking: GUI mode does not run consolidation at boot and does not auto-start the internal daemon.

### Daemon Mode

Entry point: `node server.js --mode daemon`  
Periodically updates `memory_voult/AGENT_MEMORY.md`.  
Use `--once` for a single update pass.

## Data Model

### Context Inputs

Path: `memory_voult/context/context_*.md`  
Each file is an input memory source. Files are loaded during consolidation (daemon/manual sync/force), not during GUI startup.

### Prompt Source

Path: `OLLAMA_PROMPT.md`  
Loaded on each consolidation call and used as the system prompt basis for Ollama.

### Consolidated Output

Path: `memory_voult/AGENT_MEMORY.md`  
Generated from context content plus prompt rules. Header preservation logic keeps stable top metadata, enforces `# AGENT MEMORY`, and does not include a timestamp line at the top.

### Memory State Files

1. `memory_voult/.context_state.json`  
Stores context hashes plus per-context quality metrics used by incremental consolidation and traceability.

2. `memory_voult/.canonical_state.json`  
Stores canonical decisions, confidence, source links, and superseded decision lineage.

3. `memory_voult/.neuron_graph_snapshot.json`  
Stores the latest computed graph payload so GUI can render neurons quickly without rebuilding from all contexts at startup.

4. `memory_voult/snapshots/AGENT_MEMORY_*.md`  
Versioned memory snapshots with rolling retention (latest 10).

5. `memory_voult/.compressed_context_state.json`  
Legacy state file kept for compatibility. Context compression workflow is currently disabled.

## Consolidation Pipeline

1. Trigger from daemon tick, manual sync, or force-memory endpoint.
2. Read context files and normalize text.
3. Resolve memory engine (`MEMORY_ENGINE=ollama` or `MEMORY_ENGINE=algorithm`).
4. If `ollama`: read `OLLAMA_PROMPT.md`, build model payload, and call Ollama API.
5. If `algorithm`: run deterministic semantic classification and summarization pipeline.
6. Merge with preserved memory header and strip legacy timestamp lines if present.
7. Write final `AGENT_MEMORY.md`.
8. Persist graph snapshot for GUI consumers.

## Graph Engine

Graph endpoint: `GET /api/graph`

Read path:

1. Return persisted graph from `.neuron_graph_snapshot.json` when available.
2. If snapshot is missing, rebuild from contexts + memory and persist snapshot.

Node creation rules:

1. One node per context file
2. Metadata includes title, category, references, and mention patterns

Edge creation rules:

1. Keyword and similarity based links from context analysis
2. Memory co mention links from lines that reference multiple contexts in `AGENT_MEMORY.md`
3. Distance controls in frontend physics to avoid unlimited stretching

Frontend simulation characteristics:

1. Foundation neuron fixed at center and visually scaled up
2. Area-based zoning with normalized fallback area for unknown assignments
3. High-range zoom/pan navigation for dense graphs
4. Hover tooltip with context name, reference count, and area

## API Surface

### Health and Status

1. `GET /api/status`
2. `GET /api/ollama-status`

### Synchronization

1. `POST /api/sync`
2. `POST /api/memory/force`

### Daemon Control

1. `POST /api/daemon/start`
2. `POST /api/daemon/stop`
3. `POST /api/daemon/restart`

### Context Management

1. `GET /api/contexts`
2. `POST /api/contexts`
3. `GET /api/contexts/:name`
4. `PUT /api/contexts/:name`
5. `DELETE /api/contexts/:name`

### Memory and Visualization

1. `GET /api/memory`
2. `PUT /api/memory`
3. `GET /api/graph`
4. `GET /languages/:filename`

## Internationalization

Locale files live in `languages/` and are loaded dynamically by the GUI.

Current locale strategy:

1. Detect browser preferred language at startup
2. Map to supported locale set
3. Fetch locale table through server endpoint
4. Apply translated labels to static and dynamic interface strings

The localization scope is the interface only. Memory content remains controlled by consolidation rules.

## Configuration

1. `MEMORY_ENGINE`
2. `OLLAMA_MODEL`
3. `OLLAMA_HOST`
4. `OLLAMA_TIMEOUT_SEC`
5. `OLLAMA_CONTEXT_MAX_CHARS_PER_FILE`
6. `OLLAMA_CONTEXT_MAX_TOTAL_CHARS`
7. `DAEMON_REFRESH_SEC`
8. `GUI_HOST`
9. `GUI_PORT`

## Development Workflow

1. Install dependencies with `npm install`
2. Start desktop mode with `npm start` for integrated testing
3. Use `node server.js --mode gui` for browser only debugging
4. Use daemon once mode to validate consolidation pipeline quickly
5. Validate prompts and memory generation against real context files

## Contribution Focus Areas

1. Prompt safety and output quality controls
2. Context to memory extraction accuracy
3. Graph relevance and visual readability
4. UI localization coverage and language quality
5. Reliability of Windows operational scripts

## Security and Operational Notes

1. Service is local first by design
2. Ollama endpoint is configurable and should remain trusted local infrastructure by default
3. Context and memory files may contain sensitive project information
4. Avoid exposing GUI and API ports to untrusted networks
