const {
  contextBridge,
  ipcRenderer,
} = require('electron');

// Setup API in context bridge, allowing renderer to invoke main.js API
contextBridge.exposeInMainWorld('api', {
  // Invocation API
  GetAppState: () => ipcRenderer.invoke('state-get'),
  SerialListPorts: () => ipcRenderer.invoke('serial-list-ports'),
  SerialConnect: (settings) => ipcRenderer.invoke('serial-connect', settings),
  SerialDisconnect: () => ipcRenderer.invoke('serial-disconnect'),
  RunToggleNotify: (config) => ipcRenderer.invoke('run-toggle-notify'),
  ConfigUpdate: (config) => ipcRenderer.invoke('config-update', config),
  SelectSaveFolder: () => ipcRenderer.invoke('select-save-folder'),
  GetPlotData: () => ipcRenderer.invoke('plot-data-get'),


  // Listener API
  On_StateUpdate: (callback) => {
    ipcRenderer.on('state-update', (_, data) => callback(data));
  }
});