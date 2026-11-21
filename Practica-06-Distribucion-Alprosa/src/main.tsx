import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { Servicio } from './ui/servicio';
import './ui/estilos.css';

const raiz = document.getElementById('raiz')!;
new Servicio().iniciar()
  .then((svc) => { (window as unknown as { __svc: Servicio }).__svc = svc; createRoot(raiz).render(<App svc={svc} />); })
  .catch((e) => { raiz.textContent = 'No se pudo iniciar el sistema: ' + (e as Error).message; });
