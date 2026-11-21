/**
 * Arranque del "Sistema de Análisis de Datos y Predictivo de Gestión de Inventarios".
 * Interfaz profesional (Paso 9): 14 pantallas sobre el motor en segundo plano (Web Worker).
 */
import './ui/estilos.css';
import './ui/pantallas/dashboard';
import './ui/pantallas/datos';
import './ui/pantallas/analisis';
import './ui/pantallas/simulacion';
import './ui/pantallas/copiloto';
import './ui/pantallas/informes';
import './ui/pantallas/otras';
import { iniciarApp } from './ui/app';

const raiz = document.getElementById('app')!;
iniciarApp(raiz).catch((e) => {
  console.error(e);
  raiz.innerHTML = `<div style="font-family:Segoe UI,sans-serif;padding:40px;max-width:640px"><h2>No se pudo iniciar el sistema</h2><p>${String((e as Error).message ?? e)}</p>
    <p>Si abrió el archivo desde un ZIP, extráigalo primero. Si el problema continúa, use la versión HTML en Microsoft Edge o Google Chrome.</p></div>`;
});
