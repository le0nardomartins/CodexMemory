const { app, BrowserWindow, dialog, Menu } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const GUI_HOST = "127.0.0.1";
const GUI_PORT_START = 4173;
const GUI_PORT_ATTEMPTS = 20;
const SERVER_BOOT_TIMEOUT_MS = 180000;
const SERVER_POLL_INTERVAL_MS = 1000;
const APP_ICON_PATH = path.resolve(__dirname, "..", "assets", "favicon", "favicon.ico");
const BOOT_LOG_DIR = path.resolve(__dirname, "..", "memory_voult", "logs");
const BOOT_LOG_FILE = path.join(BOOT_LOG_DIR, "desktop_boot.log");

let serverProcess = null;
let mainWindow = null;
let recentServerLines = [];

function bootLog(message) {
  const line = `[${new Date().toISOString()}] ${String(message)}`;
  try {
    fs.mkdirSync(BOOT_LOG_DIR, { recursive: true });
    fs.appendFileSync(BOOT_LOG_FILE, `${line}\n`, "utf8");
  } catch {
    // noop
  }
  process.stdout.write(`[DESKTOP] ${line}\n`);
}

function pushRecentLines(prefix, chunk) {
  const text = String(chunk || "");
  if (!text) return;
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
  for (const line of lines) {
    const entry = `${prefix} ${line}`;
    recentServerLines.push(entry);
    if (recentServerLines.length > 80) {
      recentServerLines = recentServerLines.slice(-80);
    }
    bootLog(entry);
  }
}

function canListen(port) {
  return new Promise((resolve) => {
    const tester = http.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, GUI_HOST);
  });
}

async function pickFreePort(start, attempts) {
  let port = start;
  for (let i = 0; i < attempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const free = await canListen(port);
    if (free) return port;
    port += 1;
  }
  throw new Error(`Nenhuma porta livre entre ${start} e ${start + attempts - 1}.`);
}

function waitForServer(url, timeoutMs = SERVER_BOOT_TIMEOUT_MS, getExitState = () => null) {
  const started = Date.now();
  let attempts = 0;
  let lastProbe = "none";
  return new Promise((resolve, reject) => {
    const ping = () => {
      attempts += 1;
      const exitState = getExitState();
      if (exitState) {
        reject(
          new Error(
            `Servidor encerrou antes de responder (code=${exitState.code ?? "null"}, signal=${exitState.signal ?? "null"}).`,
          ),
        );
        return;
      }

      const req = http.get(`${url}/`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          lastProbe = `HTTP ${res.statusCode}`;
          resolve();
          return;
        }
        lastProbe = `HTTP ${res.statusCode || "unknown"}`;
        if (Date.now() - started > timeoutMs) {
          reject(
            new Error(
              `Timeout aguardando servidor GUI (${Math.round(timeoutMs / 1000)}s). url=${url} attempts=${attempts} lastProbe=${lastProbe}`,
            ),
          );
          return;
        }
        setTimeout(ping, SERVER_POLL_INTERVAL_MS);
      });

      req.on("error", (err) => {
        lastProbe = err && err.code ? String(err.code) : String(err || "request_error");
        const exitState = getExitState();
        if (exitState) {
          reject(
            new Error(
              `Servidor encerrou antes de responder (code=${exitState.code ?? "null"}, signal=${exitState.signal ?? "null"}). lastProbe=${lastProbe}`,
            ),
          );
          return;
        }
        if (Date.now() - started > timeoutMs) {
          reject(
            new Error(
              `Timeout aguardando servidor GUI (${Math.round(timeoutMs / 1000)}s). url=${url} attempts=${attempts} lastProbe=${lastProbe}`,
            ),
          );
          return;
        }
        setTimeout(ping, SERVER_POLL_INTERVAL_MS);
      });
    };
    ping();
  });
}

function killServer() {
  if (!serverProcess || serverProcess.killed) return;
  try {
    bootLog(`Killing server process pid=${serverProcess.pid || "unknown"}.`);
    serverProcess.kill();
  } catch {
    // noop
  }
}

async function startServer() {
  const port = await pickFreePort(GUI_PORT_START, GUI_PORT_ATTEMPTS);
  const rootDir = path.resolve(__dirname, "..");
  const serverPath = path.join(rootDir, "server.js");
  const serverUrl = `http://${GUI_HOST}:${port}`;
  const nodeExec = process.env.npm_node_execpath || process.execPath;
  const useElectronAsNode = !process.env.npm_node_execpath && /electron/i.test(path.basename(process.execPath));

  let exitState = null;
  const childEnv = {
    ...process.env,
    GUI_HOST,
    GUI_PORT: String(port),
  };
  if (useElectronAsNode) {
    childEnv.ELECTRON_RUN_AS_NODE = "1";
  }
  recentServerLines = [];
  bootLog(`Desktop boot start. serverUrl=${serverUrl}`);
  bootLog(`Spawning server process: ${nodeExec} ${serverPath} --mode gui --gui-host ${GUI_HOST} --gui-port ${port}`);
  if (useElectronAsNode) {
    bootLog("ELECTRON_RUN_AS_NODE=1 enabled for child process.");
  }

  serverProcess = spawn(nodeExec, [serverPath, "--mode", "gui", "--gui-host", GUI_HOST, "--gui-port", String(port)], {
    cwd: rootDir,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  bootLog(`Server process started with pid=${serverProcess.pid || "unknown"}.`);

  if (serverProcess.stdout) {
    serverProcess.stdout.on("data", (chunk) => {
      pushRecentLines("[SERVER-OUT]", chunk);
    });
  }
  if (serverProcess.stderr) {
    serverProcess.stderr.on("data", (chunk) => {
      pushRecentLines("[SERVER-ERR]", chunk);
    });
  }

  serverProcess.on("error", (err) => {
    bootLog(`Server process spawn error: ${String(err)}`);
  });

  serverProcess.on("exit", (code, signal) => {
    exitState = { code, signal };
    bootLog(`Server process exited. code=${code ?? "null"} signal=${signal ?? "null"}`);
    if (!app.isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        "Servidor encerrado",
        `O servidor interno foi encerrado (codigo ${code ?? "desconhecido"}, signal ${signal ?? "n/a"}).\nLog: ${BOOT_LOG_FILE}`,
      );
      mainWindow.close();
    }
  });

  try {
    await waitForServer(serverUrl, SERVER_BOOT_TIMEOUT_MS, () => exitState);
    bootLog(`Server responded successfully at ${serverUrl}.`);
  } catch (err) {
    const tail = recentServerLines.slice(-20).join("\n");
    const message = [
      String(err),
      `Log: ${BOOT_LOG_FILE}`,
      tail ? "Ultimas linhas do servidor:" : "",
      tail || "",
    ]
      .filter(Boolean)
      .join("\n");
    bootLog(`Server boot failure: ${message}`);
    throw new Error(message);
  }
  return serverUrl;
}

async function createWindow() {
  const serverUrl = await startServer();
  const iconPath = fs.existsSync(APP_ICON_PATH) ? APP_ICON_PATH : undefined;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: "CodexMemory",
    backgroundColor: "#070a14",
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  await mainWindow.loadURL(serverUrl);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("window-all-closed", () => {
  app.isQuitting = true;
  killServer();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  killServer();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  return createWindow();
}).catch((err) => {
  bootLog(`Fatal desktop init error: ${String(err)}`);
  dialog.showErrorBox("Falha ao iniciar CodexMemory", `${String(err)}\n\nLog: ${BOOT_LOG_FILE}`);
  app.exit(1);
});
