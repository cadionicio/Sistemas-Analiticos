// Punto de entrada común del HTML y del EXE.
import { iniciar } from './ui/app.js';
window.addEventListener('error', e => console.error('Error no controlado:', e.message));
document.addEventListener('DOMContentLoaded', () => {
  iniciar().catch(e => {
    document.body.innerHTML = '<div style="padding:24px;font-family:sans-serif"><h1>No se pudo iniciar la aplicación</h1><p>' +
      String(e && e.message || e).replace(/</g, '&lt;') + '</p><p>Cierre y vuelva a abrir. Si persiste, use un respaldo.</p></div>';
  });
});
