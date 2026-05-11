# Installation Guide

<p align="right">
  🌐
  <a href="../pt-BR/INSTALL.md">Português</a> ·
  <strong>English</strong> ·
  <a href="../es-ES/INSTALL.md">Español</a>
</p>

## Requirements

| Dependency | Minimum version | Note |
|---|---|---|
| Node.js | 18+ | Always required |
| Ollama | Any | Required only if `MEMORY_ENGINE=ollama` |

Ollama must be available in your `PATH` with the configured model installed. To run without an LLM, use `MEMORY_ENGINE=algorithm`.

---

## 1. Clone and Install Dependencies

```powershell
git clone https://github.com/le0nardomartins/CodexMemory.git
cd CodexMemory
npm install
```

---

## 2. Configure Paths

Before the first run, create the path configuration file from the example:

```powershell
copy config\ai_paths.json.example config\ai_paths.json
```

Open `config/ai_paths.json` and set the absolute base path to your parent folder:

```json
{
  "baseRootPath": "C:/Users/your_username/Documents"
}
```

> Use forward slashes `/` in JSON even on Windows.

---

## 3. Running Modes

### Desktop (Electron)

Opens the native window with integrated GUI:

```powershell
npm start
```

### Browser GUI

Starts the HTTP server and serves the GUI at `http://localhost:4173`:

```powershell
node server.js --mode gui
```

Custom port and host:

```powershell
node server.js --mode gui --port 8080 --host 0.0.0.0
```

### Daemon (automatic refresh)

Periodically updates `AGENT_MEMORY.md` (default: 300 seconds):

```powershell
node server.js --mode daemon --refresh-sec 300
```

Single run (no loop):

```powershell
node server.js --mode daemon --once
```

---

## 4. Environment Variables

Create a `.env` file at the root or export variables before running:

```powershell
$env:MEMORY_ENGINE = "algorithm"   # or "ollama"
$env:OLLAMA_MODEL  = "qwen2.5:3b"
$env:GUI_PORT      = "4173"
```

Or in a `.env` file:

```
MEMORY_ENGINE=algorithm
OLLAMA_MODEL=qwen2.5:3b
GUI_PORT=4173
```

---

## 5. Windows Autostart (optional)

The scripts in `scripts/` allow installing the daemon as a Windows scheduled task:

```powershell
# Install as scheduled task
.\scripts\install-autostart.ps1

# Check status
.\scripts\status-autostart.ps1

# Uninstall
.\scripts\uninstall-autostart.ps1
```

---

## 6. Verify Installation

After starting the server, confirm it is working:

```powershell
curl http://localhost:4173/api/status
```

Expected response:

```json
{
  "daemon": { "running": false },
  "ollama": { "reachable": true, "modelInstalled": true }
}
```

---

## Troubleshooting

| Problem | Likely cause | Solution |
|---|---|---|
| `EADDRINUSE` on port 4173 | Another instance running | Kill the process or change `GUI_PORT` |
| Ollama not found | Not installed or not in PATH | Install Ollama or use `MEMORY_ENGINE=algorithm` |
| `config/ai_paths.json` missing | Example not copied | Run the `copy` command from step 2 |
| Neurons not showing in GUI | Graph not yet generated | Click "Sync Now" to force consolidation |
