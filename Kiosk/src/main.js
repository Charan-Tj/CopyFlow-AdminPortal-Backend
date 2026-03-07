const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { Agent } = require('./worker/agent');

let mainWindow;
let agent;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 860,
    minWidth: 1100,
    minHeight: 760,
    title: 'CopyFlow Print Agent',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function wireIpc() {
  ipcMain.handle('agent:getSnapshot', async () => {
    return agent.getSnapshot();
  });

  ipcMain.handle('agent:action', async (_event, payload) => {
    return agent.handleAction(payload);
  });

  // ── Self-registration ──────────────────────────────────────────────────
  ipcMain.handle('register:validate', async (_event, code) => {
    return agent.validateRegistrationCode(code);
  });

  ipcMain.handle('register:complete', async (_event, { code, email, password }) => {
    return agent.completeRegistration(code, email, password);
  });
}

function wireAgentEvents() {
  agent.on('state:update', (snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent:stateUpdate', snapshot);
    }
  });

  agent.on('log', (entry) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent:log', entry);
    }
  });

  agent.on('registration:required', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent:registrationRequired');
    }
  });
}

app.whenReady().then(async () => {
  createMainWindow();

  agent = new Agent();
  wireIpc();
  wireAgentEvents();
  await agent.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (agent) {
    await agent.stop();
  }
});
