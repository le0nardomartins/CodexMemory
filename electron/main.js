const { app, BrowserWindow, dialog, Menu } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const GUI_HOST = "127.0.0.1";
const GUI_PORT_START = 4173;
const GUI_PORT_ATTEMPTS = 20;
const SERVER_BOOT_TIMEOUT_MS = 180000;
const SERVER_POLL_INTERVAL_MS = 1000;

let serverProcess = null;
let mainWindow = null;

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

function waitForServer(url, timeoutMs = SERVER_BOOT_TIMEOUT_MS, hasProcessExited = () => false) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const ping = () => {
      if (hasProcessExited()) {
        reject(new Error("Servidor encerrou antes de responder."));
        return;
      }

      const req = http.get(`${url}/api/status`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve();
          return;
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error("Timeout aguardando servidor GUI."));
          return;
        }
        setTimeout(ping, SERVER_POLL_INTERVAL_MS);
      });

      req.on("error", () => {
        if (hasProcessExited()) {
          reject(new Error("Servidor encerrou antes de responder."));
          return;
        }
        if (Date.now() - started > timeoutMs) {
          reject(
            new Error(
              `Timeout aguardando servidor GUI (${Math.round(timeoutMs / 1000)}s).`,
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

  let serverExited = false;
  serverProcess = spawn(process.execPath, [serverPath, "--mode", "gui", "--gui-port", String(port)], {
    cwd: rootDir,
    env: {
      ...process.env,
      GUI_HOST,
      GUI_PORT: String(port),
    },
    stdio: "inherit",
  });

  serverProcess.on("exit", (code) => {
    serverExited = true;
    if (!app.isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        "Servidor encerrado",
        `O servidor interno foi encerrado (codigo ${code ?? "desconhecido"}).`,
      );
      mainWindow.close();
    }
  });

  await waitForServer(serverUrl, SERVER_BOOT_TIMEOUT_MS, () => serverExited);
  return serverUrl;
}

async function createWindow() {
  const serverUrl = await startServer();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: "CodexMemory",
    backgroundColor: "#070a14",
    autoHideMenuBar: true,
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
  dialog.showErrorBox("Falha ao iniciar CodexMemory", String(err));
  app.exit(1);
});
