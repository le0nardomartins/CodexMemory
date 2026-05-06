# Codex Memory Technical README

## Purpose

This document describes internal architecture, runtime behavior, data flow, and extension points for contributors working on Codex Memory.

## Runtime Components

1. `server.js`  
   Local HTTP server, Ollama orchestration, context loading, memory consolidation, and graph generation.

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

### Daemon Mode

Entry point: `node server.js --mode daemon`  
Periodically updates `memory_voult/AGENT_MEMORY.md`.  
Use `--once` for a single update pass.

## Data Model

### Context Inputs

Path: `memory_voult/context/context_*.md`  
Each file is an input memory source. The server reads all matching files and builds a consolidation payload.

### Prompt Source

Path: `OLLAMA_PROMPT.md`  
Loaded on each consolidation call and used as the system prompt basis for Ollama.

### Consolidated Output

Path: `memory_voult/AGENT_MEMORY.md`  
Generated from context content plus prompt rules. Header preservation logic keeps stable top metadata and avoids rewriting user managed header sections when possible.

## Consolidation Pipeline

1. Read context files and normalize text.
2. Read `OLLAMA_PROMPT.md`.
3. Build system prompt and user payload for the model.
4. Call Ollama generate API.
5. Sanitize model output to remove forbidden self referential content and placeholders.
6. Merge with preserved memory header.
7. Write final `AGENT_MEMORY.md`.
8. Refresh graph state for GUI consumers.

## Graph Engine

Graph endpoint: `GET /api/graph`

Node creation rules:

1. One node per context file
2. Metadata includes title, category, references, and mention patterns

Edge creation rules:

1. Keyword and similarity based links from context analysis
2. Memory co mention links from lines that reference multiple contexts in `AGENT_MEMORY.md`
3. Distance controls in frontend physics to avoid unlimited stretching

Frontend simulation characteristics:

1. Orbital movement around node home positions
2. Local repulsion and damping
3. Synapse flow animation with moving particles
4. Hover tooltip with context name and reference count

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

1. `OLLAMA_MODEL`
2. `OLLAMA_HOST`
3. `OLLAMA_TIMEOUT_SEC`
4. `OLLAMA_CONTEXT_MAX_CHARS_PER_FILE`
5. `OLLAMA_CONTEXT_MAX_TOTAL_CHARS`
6. `DAEMON_REFRESH_SEC`
7. `GUI_HOST`
8. `GUI_PORT`

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
