import { useMemo, useState } from 'react';
import logoSvg from '../assets/alprosa_vectorizado.svg?raw';
import type { Servicio } from './servicio';
import { P, S } from './servicio';

/** Pantalla de ingreso: elegir la persona y escribir su PIN (DEC-I04-USUARIOS). */
export function Ingreso({ svc, mensaje, entrar }: { svc: Servicio; mensaje: string | null; entrar: (usuario: string) => void }) {
  const usuarios = useMemo(() => svc.usuarios().filter((u) => u.activo === 1 && u.usuario_id !== 'LEGADO' && u.usuario_id !== S.EVAL_ID), [svc]);
  const [sel, setSel] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cambio, setCambio] = useState<{ usuario: string; actual: string } | null>(null);
  const enviar = async (id = sel, clave = pin) => {
    if (!id) return;
    try {
      const r = await svc.ingresar(id, clave);
      if (!r.ok) { setError(r.mensaje); setPin(''); return; }
      if (r.debe_cambiar) { setCambio({ usuario: id, actual: clave }); return; }
      entrar(id);
    } catch (e) { setError((e as Error).message); setPin(''); }
  };
  if (cambio) return (
    <div className="ingreso"><div className="ingreso-caja">
      <h1>Cree su PIN personal</h1>
      <p className="nota">Su PIN fue asignado por el administrador y debe cambiarlo antes de continuar.</p>
      <FormPin svc={svc} usuario={cambio.usuario} actual={cambio.actual} listo={() => entrar(cambio.usuario)} />
    </div></div>
  );
  return (
    <div className="ingreso">
      <div className="ingreso-caja">
        <div className="marca" role="img" aria-label="Alprosa" dangerouslySetInnerHTML={{ __html: logoSvg }} />
        <h1>Sistema de Distribución</h1>
        {mensaje && <p className="alerta-suave" role="status">{mensaje}</p>}
        <button className="tarjeta-evaluacion" onClick={() => void enviar(S.EVAL_ID, '')}>
          <span className="te-etiqueta">MODO PRUEBA</span>
          <strong>Entrar como {S.EVAL_NOMBRE}</strong>
          <span>Todas las secciones y permisos, sin PIN. Para revisar y probar el sistema completo. En operación real cada persona entra con su propio usuario.</span>
        </button>
        <p>O elija su nombre y escriba su PIN:</p>
        <div className="ingreso-usuarios" role="radiogroup" aria-label="Usuarios">
          {usuarios.map((u) => {
            const roles = P.rolesVigentes(svc.repo, String(u.usuario_id));
            return (
              <button key={String(u.usuario_id)} role="radio" aria-checked={sel === u.usuario_id} className={'tarjeta-usuario' + (sel === u.usuario_id ? ' activa' : '')} disabled={!roles.length}
                onClick={() => { setSel(String(u.usuario_id)); setPin(''); setError(null); }}>
                <strong>{String(u.nombre_ficticio)}</strong>
                <span>{roles.length ? roles.map((r) => P.NOMBRE_ROL[r]).join(' · ') : 'Sin roles vigentes'}{u.compartida ? ' · cuenta compartida' : ''}</span>
              </button>
            );
          })}
        </div>
        {sel && <form className="ingreso-pin" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
          <label>Escriba su PIN: <input type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={8} aria-label="PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></label>
          <button type="submit" className="primario" disabled={pin.length < 4}>Entrar</button>
        </form>}
        {error && <p className="error-campo" role="alert">{error}</p>}
        <p className="nota">Cada persona ve solo las pantallas de su función. Tras 5 intentos fallidos el usuario se bloquea 5 minutos. Datos sintéticos de demostración: los PIN iniciales figuran en el manual de usuario.</p>
      </div>
    </div>
  );
}

function FormPin({ svc, usuario, actual, listo }: { svc: Servicio; usuario: string; actual?: string; listo: () => void }) {
  const [f, setF] = useState({ actual: actual ?? '', nuevo: '', repetir: '' });
  const [error, setError] = useState<string | null>(null);
  const limpio = (v: string) => v.replace(/\D/g, '');
  return (
    <form className="formulario" onSubmit={async (e) => {
      e.preventDefault();
      try {
        if (f.nuevo !== f.repetir) throw new Error('Los dos PIN nuevos no coinciden.');
        await svc.op('cambio de PIN', () => S.cambiarPin(svc.repo, usuario, f.actual, f.nuevo));
        listo();
      } catch (ex) { setError((ex as Error).message); }
    }}>
      {actual === undefined && <label>PIN actual <input type="password" inputMode="numeric" value={f.actual} onChange={(e) => setF({ ...f, actual: limpio(e.target.value) })} /></label>}
      <label>PIN nuevo (4 a 8 dígitos) <input type="password" inputMode="numeric" maxLength={8} value={f.nuevo} onChange={(e) => setF({ ...f, nuevo: limpio(e.target.value) })} /></label>
      <label>Repita el PIN nuevo <input type="password" inputMode="numeric" maxLength={8} value={f.repetir} onChange={(e) => setF({ ...f, repetir: limpio(e.target.value) })} /></label>
      {error && <p className="error-campo" role="alert">{error}</p>}
      <div className="botonera"><button type="submit" className="primario">Guardar PIN</button></div>
    </form>
  );
}

export function CambioPin({ svc, usuario, cerrar }: { svc: Servicio; usuario: string; cerrar: (mensaje?: string) => void }) {
  return (
    <div className="panel-fondo" onKeyDown={(e) => e.key === 'Escape' && cerrar()}>
      <div className="panel" role="dialog" aria-modal="true" aria-label="Cambiar PIN">
        <div className="panel-cab"><h2>Cambiar mi PIN</h2><button onClick={() => cerrar()} aria-label="Cerrar">×</button></div>
        <FormPin svc={svc} usuario={usuario} listo={() => cerrar('PIN actualizado. Úselo en su próximo ingreso.')} />
      </div>
    </div>
  );
}
