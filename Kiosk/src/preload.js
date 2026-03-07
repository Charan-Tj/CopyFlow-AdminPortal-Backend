const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentApi', {
  getSnapshot: () => ipcRenderer.invoke('agent:getSnapshot'),
  performAction: (payload) => ipcRenderer.invoke('agent:action', payload),
  onStateUpdate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('agent:stateUpdate', handler);
    return () => ipcRenderer.removeListener('agent:stateUpdate', handler);
  },
  onLog: (callback) => {
    const handler = (_event, entry) => callback(entry);
    ipcRenderer.on('agent:log', handler);
    return () => ipcRenderer.removeListener('agent:log', handler);
  },
  onRegistrationRequired: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('agent:registrationRequired', handler);
    return () => ipcRenderer.removeListener('agent:registrationRequired', handler);
  }
});

contextBridge.exposeInMainWorld('registrationApi', {
  validate: (code) => ipcRenderer.invoke('register:validate', code),
  complete: (code, email, password) => ipcRenderer.invoke('register:complete', { code, email, password })
});
