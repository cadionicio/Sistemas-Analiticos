// Puente mínimo y explícito entre la interfaz y el proceso principal (sin acceso general a Node).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('alprosaNative', {
  cargarDb: () => ipcRenderer.invoke('alprosa:cargar'),
  guardarDb: (bytes, motivo) => ipcRenderer.invoke('alprosa:guardar', bytes, String(motivo)),
  carpetaDatos: () => ipcRenderer.invoke('alprosa:carpeta'),
  clima: (lat, lon) => ipcRenderer.invoke('alprosa:clima', Number(lat), Number(lon)),
  version: () => ipcRenderer.invoke('alprosa:version'),
});
