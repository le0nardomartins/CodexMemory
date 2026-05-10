<p align="center">
  <img src="assets/logo_name.png" alt="Codex Memory logo" width="500" />
</p>

<h1 align="center">Codex Memory</h1>

<p align="center">
Open source memory orchestration for context driven coding workflows.
</p>

## Overview

Codex Memory is a local memory service that reads markdown contexts, consolidates long term operational memory with a selectable engine (`ollama` or deterministic `algorithm`), and exposes a visual interface to inspect memory relationships.

The project runs in three modes:

1. Desktop app with Electron
2. Web GUI mode
3. Daemon mode for scheduled memory refresh

## Why This Project Exists

Context files are easy to write but hard to keep synchronized over time. Codex Memory addresses this by:

1. Consolidating multiple `context_*.md` files into one operational memory file
2. Keeping memory updated through daemon or manual sync
3. Providing a neural style graph to inspect links between context nodes
4. Exposing local APIs for automation and integration

## Key Features

1. Selectable memory engine per session: `ollama` or deterministic `algorithm`
2. Automatic or manual `AGENT_MEMORY.md` refresh with stable header (`# AGENT MEMORY`) and no timestamp line
3. Fast GUI startup without blocking consolidation on boot
4. Context CRUD from GUI and API
5. Graph based context visualization with hover metadata
6. Persisted neuron graph snapshot for faster visualization loading
7. Multi language UI with automatic locale detection
8. Desktop icon and branding from project assets
9. Canonical decisions with contradiction tracking and source traceability
10. Rolling `AGENT_MEMORY.md` snapshots (latest 10)
11. Context compression feature disabled (contexts are preserved)

## Foundation Context (`context_1.md`)

`context_1.md` is the foundation context of the memory system and should be written and maintained by a human.

Why this matters:

1. It anchors long-term project rules and non-negotiable decisions.
2. The graph engine treats it as the foundation neuron (`context_1.md`) and keeps it central in visualization and linkage.
3. Other contexts should reference it so algorithmic linking can preserve a consistent memory backbone.
4. Keeping this file human-curated reduces drift and prevents accidental loss of core project intent.

## Quick Start

### Requirements

1. Node.js 18+
2. Ollama installed and available in `PATH` only if you run with `MEMORY_ENGINE=ollama`

### Install

```powershell
npm install
```

### Configure Paths Before First Run

Before using the project, create `config/ai_paths.json` from `config/ai_paths.json.example` and set the absolute base path to your local parent folder.

```powershell
copy config\ai_paths.json.example config\ai_paths.json
```

Then edit `config/ai_paths.json` and update `baseRootPath` to your absolute path, for example:

```json
{
  "baseRootPath": "C:/Users/leona/Documents"
}
```

### Run Desktop

```powershell
npm start
```

### Run Web GUI

```powershell
node server.js --mode gui
```

### Run Daemon

```powershell
node server.js --mode daemon --refresh-sec 300
```

One time daemon run:

```powershell
node server.js --mode daemon --once
```

## Project Structure

```text
CodexMemory/
  electron/
    main.js
  GUI/
    index.html
    app.js
    styles.css
    languages/
  languages/
    en-US.json
    pt-BR.json
    es-ES.json
  memory_voult/
    AGENT_MEMORY.md
    .context_state.json
    .canonical_state.json
    .neuron_graph_snapshot.json
    snapshots/
    context/
      context_*.md
  assets/
    logo_name.png
    favicon/
  scripts/
  server.js
  setup_codex_memory.bat
```

## Environment Variables

1. `OLLAMA_MODEL` default `qwen2.5:3b`
2. `MEMORY_ENGINE` default `ollama` (`ollama` or `algorithm`)
3. `OLLAMA_HOST` default `http://127.0.0.1:11434`
4. `OLLAMA_TIMEOUT_SEC` default `300`
5. `OLLAMA_CONTEXT_MAX_CHARS_PER_FILE` default `3500`
6. `OLLAMA_CONTEXT_MAX_TOTAL_CHARS` default `22000`
7. `DAEMON_REFRESH_SEC` default `300`
8. `GUI_HOST` default `127.0.0.1`
9. `GUI_PORT` default `4173`

When `MEMORY_ENGINE=algorithm`, Ollama is not loaded during the session.

## Regression Tests

```powershell
npm run test:memory
```

## API Summary

1. `GET /api/status`
2. `GET /api/ollama-status`
3. `POST /api/sync`
4. `POST /api/memory/force`
5. `POST /api/daemon/start`
6. `POST /api/daemon/stop`
7. `POST /api/daemon/restart`
8. `GET /api/contexts`
9. `POST /api/contexts`
10. `GET /api/contexts/:name`
11. `PUT /api/contexts/:name`
12. `DELETE /api/contexts/:name`
13. `GET /api/memory`
14. `PUT /api/memory`
15. `GET /api/graph`

## Open Source Notes

This repository is prepared for public open source collaboration.

1. Clear code boundaries between GUI, server, and desktop runtime
2. No hidden remote services required for core workflow
3. Local first behavior by default
4. Community friendly markdown based context model

## Documentation

For implementation level details, read:

[TECHNICAL_README.md](https://github.com/le0nardomartins/CodexMemory/blob/main/TECHNICAL_README.md)
