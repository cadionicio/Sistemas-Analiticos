/**
 * Cliente del MOTOR (Web Worker). La interfaz llama a métodos del motor como promesas;
 * el motor trabaja en segundo plano y emite eventos de avance del Super Agente.
 */
import MotorWorker from '../worker/motor.worker.ts?worker&inline';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

export interface Progreso { tipo: 'progreso'; paso: string; estado: string; pct: number; detalle: string }
type Pendiente = { ok: (v: unknown) => void; ko: (e: Error) => void };

const worker: Worker = new MotorWorker();
const pendientes = new Map<number, Pendiente>();
const oyentes = new Set<(p: Progreso) => void>();
let sec = 0;

worker.onmessage = (ev: MessageEvent) => {
  const m = ev.data;
  if (m?.tipo === 'progreso') { oyentes.forEach((f) => f(m)); return; }
  const p = pendientes.get(m.id);
  if (!p) return;
  pendientes.delete(m.id);
  if (m.ok) p.ok(m.resultado); else p.ko(new Error(m.error));
};
worker.onerror = (e) => { console.error('Error en el motor:', e.message); };

/** Invoca un método del motor. Los Uint8Array se transfieren sin copiar. */
export function llamar<T = unknown>(metodo: string, ...args: unknown[]): Promise<T> {
  const id = ++sec;
  const transfer = args.filter((a): a is Uint8Array => a instanceof Uint8Array).map((a) => a.buffer as ArrayBuffer);
  return new Promise<T>((ok, ko) => {
    pendientes.set(id, { ok: ok as (v: unknown) => void, ko });
    worker.postMessage({ id, metodo, args }, transfer);
  });
}

export const alProgresar = (f: (p: Progreso) => void) => { oyentes.add(f); return () => oyentes.delete(f); };
export const iniciarMotor = (bytes?: Uint8Array) => llamar<InfoMotor>('iniciar', wasmUrl, bytes);

export interface DatasetInfo { id: number; nombre: string; tipo: 'ventas' | 'kardex'; archivo: string; filas_validas: number; fecha_min: string; fecha_max: string; ultimo_mes_cerrado: string; estado: string; cargado_en: string }
export interface InfoMotor { tablas: number; datasets: DatasetInfo[]; hayResultados: boolean; desactualizado: boolean }
