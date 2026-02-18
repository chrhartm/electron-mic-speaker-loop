const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  log: (message, meta) => ipcRenderer.invoke('debug-log', message, meta),
  getPermissionStatuses: () => ipcRenderer.invoke('permissions-status')
});
