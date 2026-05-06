<p align="center">
  <img src="assets/logo_name.png" alt="Codex Memory logo" width="360" />
</p>

<h1 align="center">Codex Memory</h1>

<p align="center">
Open source memory orchestration for context driven coding workflows.
</p>

## Overview

Codex Memory is a local memory service that reads markdown contexts, consolidates long term operational memory with Ollama, and exposes a visual interface to inspect memory relationships.

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

1. Ollama driven memory consolidation with strict prompt rules
2. Automatic or manual `AGENT_MEMORY.md` refresh
3. Context CRUD from GUI and API
4. Graph based context visualization with hover metadata
5. Multi language UI with automatic locale detection
6. Desktop icon and branding from project assets

## Quick Start

### Requirements

1. Node.js 18+
2. Ollama installed and available in `PATH`

### Install

```powershell
npm install
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
2. `OLLAMA_HOST` default `http://127.0.0.1:11434`
3. `OLLAMA_TIMEOUT_SEC` default `120`
4. `OLLAMA_CONTEXT_MAX_CHARS_PER_FILE` default `3500`
5. `OLLAMA_CONTEXT_MAX_TOTAL_CHARS` default `22000`
6. `DAEMON_REFRESH_SEC` default `300`
7. `GUI_HOST` default `127.0.0.1`
8. `GUI_PORT` default `4173`

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

`TECHNICAL_README.md`
