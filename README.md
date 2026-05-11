<p align="center">
  <img src="assets/logo_name.png" alt="Codex Memory logo" width="500" />
</p>

<h1 align="center">Codex Memory</h1>

<p align="center">
Open source memory orchestration for context driven coding workflows.
</p>

<!-- Language selector — GitHub renders static content, so pick your language below -->
<p align="center">
  🌐 &nbsp;
  <a href="docs/pt-BR/README.md"><img src="https://flagcdn.com/20x15/br.png" alt="pt-BR" /> Português</a>
  &nbsp;·&nbsp;
  <a href="docs/en-US/README.md"><img src="https://flagcdn.com/20x15/us.png" alt="en-US" /> English</a>
  &nbsp;·&nbsp;
  <a href="docs/es-ES/README.md"><img src="https://flagcdn.com/20x15/es.png" alt="es-ES" /> Español</a>
</p>

---

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
2. Automatic or manual `AGENT_MEMORY.md` refresh with stable header and no timestamp line
3. Fast GUI startup without blocking consolidation on boot
4. Context CRUD from GUI and API
5. Graph based context visualization with hover metadata
6. Persisted neuron graph snapshot for faster visualization loading
7. Multi language UI with automatic locale detection
8. Desktop icon and branding from project assets
9. Canonical decisions with contradiction tracking and source traceability
10. Rolling `AGENT_MEMORY.md` snapshots (latest 10)

## Foundation Context (`context_1.md`)

`context_1.md` is the foundation context of the memory system and should be written and maintained by a human.

Why this matters:

1. It anchors long-term project rules and non-negotiable decisions.
2. The graph engine treats it as the foundation neuron and keeps it central in visualization and linkage.
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

```powershell
copy config\ai_paths.json.example config\ai_paths.json
```

Edit `config/ai_paths.json` and update `baseRootPath` to your absolute path:

```json
{
  "baseRootPath": "C:/Users/your_username/Documents"
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

One time run:

```powershell
node server.js --mode daemon --once
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_MODEL` | `qwen2.5:3b` | Ollama model to use |
| `MEMORY_ENGINE` | `ollama` | Memory engine (`ollama` or `algorithm`) |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama endpoint |
| `OLLAMA_TIMEOUT_SEC` | `300` | Ollama call timeout |
| `OLLAMA_CONTEXT_MAX_CHARS_PER_FILE` | `3500` | Max chars per context file |
| `OLLAMA_CONTEXT_MAX_TOTAL_CHARS` | `22000` | Total max chars sent |
| `DAEMON_REFRESH_SEC` | `300` | Daemon refresh interval |
| `GUI_HOST` | `127.0.0.1` | GUI host |
| `GUI_PORT` | `4173` | GUI port |

When `MEMORY_ENGINE=algorithm`, Ollama is not loaded during the session.

## Regression Tests

```powershell
npm run test:memory
```

## API Summary

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/status` | Daemon and engine status |
| `POST` | `/api/sync` | Manual sync |
| `POST` | `/api/memory/force` | Force consolidation |
| `POST` | `/api/daemon/start` | Start daemon |
| `POST` | `/api/daemon/stop` | Stop daemon |
| `POST` | `/api/daemon/restart` | Restart daemon |
| `GET` | `/api/contexts` | List contexts |
| `POST` | `/api/contexts` | Create context |
| `GET` | `/api/contexts/:name` | Read context |
| `PUT` | `/api/contexts/:name` | Update context |
| `DELETE` | `/api/contexts/:name` | Delete context |
| `GET` | `/api/memory` | Read consolidated memory |
| `GET` | `/api/graph` | Neuron graph |

## Open Source Notes

1. Clear code boundaries between GUI, server, and desktop runtime
2. No hidden remote services required for core workflow
3. Local first behavior by default
4. Community friendly markdown based context model

---

## Documentation

| Language | README | Installation | Technical |
|---|---|---|---|
| 🇧🇷 Português | [docs/pt-BR/README.md](docs/pt-BR/README.md) | [INSTALL.md](docs/pt-BR/INSTALL.md) | [TECHNICAL.md](docs/pt-BR/TECHNICAL.md) |
| 🇺🇸 English | [docs/en-US/README.md](docs/en-US/README.md) | [INSTALL.md](docs/en-US/INSTALL.md) | [TECHNICAL.md](docs/en-US/TECHNICAL.md) |
| 🇪🇸 Español | [docs/es-ES/README.md](docs/es-ES/README.md) | [INSTALL.md](docs/es-ES/INSTALL.md) | [TECHNICAL.md](docs/es-ES/TECHNICAL.md) |
