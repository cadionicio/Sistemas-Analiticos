export interface Clima { ok: boolean; texto: string; temperatura?: number; precipitacion?: number; lluvia_hoy?: number | null; prob_lluvia?: number | null; viento?: number; observado?: string }
// Adaptadores de persistencia por modalidad. Las reglas de negocio son las mismas; solo cambia dónde se guarda el archivo SQLite.
export interface ResultadoGuardado { guardado: boolean; respaldo: 'VERIFICADO' | 'PENDIENTE'; detalle: string; conflicto?: boolean }
export interface Almacen {
  modalidad: 'EXE' | 'HTML';
  persistente: boolean;
  descripcion: string;
  cargar(): Promise<Uint8Array | null>;
  guardar(bytes: Uint8Array, motivo: string): Promise<ResultadoGuardado>;
  clima?: (lat: number, lon: number) => Promise<Clima>;
}

interface Nativo {
  cargarDb(): Promise<Uint8Array | null>;
  guardarDb(bytes: Uint8Array, motivo: string): Promise<ResultadoGuardado>;
  carpetaDatos(): Promise<string>;
  clima(lat: number, lon: number): Promise<Clima>;
  version(): Promise<string>;
}
declare global { interface Window { alprosaNative?: Nativo } }

class AlmacenExe implements Almacen {
  modalidad = 'EXE' as const; persistente = true; descripcion = '';
  constructor(private n: Nativo) {}
  async iniciar() { this.descripcion = 'Archivo SQLite en ' + (await this.n.carpetaDatos()); return this; }
  cargar() { return this.n.cargarDb(); }
  guardar(b: Uint8Array, m: string) { return this.n.guardarDb(b, m); }
  clima = (lat: number, lon: number) => this.n.clima(lat, lon);
}

const IDB = 'alprosa-distribucion', STORE = 'base', MAX_COPIAS = 10;
function abrirIdb(): Promise<IDBDatabase> {
  return new Promise((ok, mal) => {
    if (typeof indexedDB === 'undefined') return mal(new Error('IndexedDB no disponible'));
    const r = indexedDB.open(IDB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
}

/**
 * HTML: cada pestaña trabaja sobre su copia en memoria. Para que dos pestañas no se pisen (AG03/BB03), la base guarda un número de
 * REVISIÓN; solo se guarda si la revisión no cambió desde que esta pestaña la leyó. Si otra pestaña guardó antes, se informa conflicto
 * y no se escribe. Además se avisa a las demás pestañas por BroadcastChannel.
 */
class AlmacenHtml implements Almacen {
  modalidad = 'HTML' as const; persistente = false; descripcion = 'Temporal: guarde un respaldo antes de salir';
  private db?: IDBDatabase;
  private revision = 0;
  private canal: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('alprosa-distribucion') : null;
  /** Se llama cuando OTRA pestaña guarda cambios. */
  alCambiarFuera?: () => void;
  async iniciar() {
    try {
      this.db = await abrirIdb();
      this.persistente = true;
      let duradero = false;
      try { duradero = (await navigator.storage?.persist?.()) ?? false; } catch { /* sin API */ }
      this.descripcion = 'Base SQLite guardada en el almacenamiento del navegador (IndexedDB)' + (duradero ? ', marcado como persistente' : '');
      if (this.canal) this.canal.onmessage = (e) => { if (e.data?.tipo === 'guardado' && e.data.revision !== this.revision) this.alCambiarFuera?.(); };
    } catch {
      this.persistente = false;
    }
    return this;
  }
  cargar(): Promise<Uint8Array | null> {
    if (!this.db) return Promise.resolve(null);
    return new Promise((ok, mal) => {
      const st = this.db!.transaction(STORE, 'readonly').objectStore(STORE);
      const r = st.get('actual'), rv = st.get('revision');
      rv.onsuccess = () => { this.revision = Number(rv.result ?? 0); };
      r.onsuccess = () => ok(r.result ? new Uint8Array(r.result as ArrayBuffer) : null);
      r.onerror = () => mal(r.error);
    });
  }
  guardar(bytes: Uint8Array, motivo: string): Promise<ResultadoGuardado> {
    if (!this.db) return Promise.resolve({ guardado: false, respaldo: 'PENDIENTE', detalle: 'Almacenamiento no disponible: use «Respaldar».' });
    return new Promise((ok) => {
      const tx = this.db!.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      let conflicto = false;
      const rv = st.get('revision');
      rv.onsuccess = () => {
        const actual = Number(rv.result ?? 0);
        if (actual !== this.revision) { conflicto = true; tx.abort(); return; }
        const copia = bytes.slice().buffer;
        st.put(copia, 'actual');
        st.put(actual + 1, 'revision');
        st.put({ creada: new Date().toISOString(), motivo, datos: copia }, 'copia-' + Date.now());
        const keys = st.getAllKeys();
        keys.onsuccess = () => {
          const copias = (keys.result as string[]).filter((k) => String(k).startsWith('copia-')).sort();
          for (const k of copias.slice(0, Math.max(0, copias.length - MAX_COPIAS))) st.delete(k);
        };
      };
      tx.oncomplete = () => { this.revision++; this.canal?.postMessage({ tipo: 'guardado', revision: this.revision }); ok({ guardado: true, respaldo: 'VERIFICADO', detalle: 'Guardado en el navegador con copia automática (últimas 10).' }); };
      tx.onabort = () => ok(conflicto ? { guardado: false, conflicto: true, respaldo: 'PENDIENTE', detalle: 'Otra pestaña guardó cambios antes que esta: su operación no se guardó.' } : { guardado: false, respaldo: 'PENDIENTE', detalle: 'No se pudo guardar: ' + (tx.error?.message ?? 'transacción anulada') });
      tx.onerror = () => { if (!conflicto) ok({ guardado: false, respaldo: 'PENDIENTE', detalle: 'No se pudo guardar: ' + tx.error?.message }); };
    });
  }
}

export async function crearAlmacen(): Promise<Almacen> {
  if (window.alprosaNative) return new AlmacenExe(window.alprosaNative).iniciar();
  return new AlmacenHtml().iniciar();
}

export function descargar(nombre: string, datos: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([datos], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
