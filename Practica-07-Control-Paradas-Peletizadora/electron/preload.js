// Puente mínimo y validado entre la página y el proceso principal (6 canales).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hostCPR', {
  info: () => ipcRenderer.invoke('cpr:info'),
  cargar: () => ipcRenderer.invoke('cpr:cargar'),
  guardar: (bytes, rev, motivo) => ipcRenderer.invoke('cpr:guardar', bytes, rev, String(motivo || '')),
  listarRespaldos: () => ipcRenderer.invoke('cpr:listar'),
  obtenerRespaldo: id => ipcRenderer.invoke('cpr:obtener', String(id)),
  tipoCambio: () => ipcRenderer.invoke('cpr:tipocambio'),
});
