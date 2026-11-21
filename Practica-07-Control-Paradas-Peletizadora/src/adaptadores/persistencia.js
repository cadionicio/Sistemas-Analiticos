// Persistencia local con una interfaz común:
//  - EXE (Electron): archivo SQLite en %APPDATA%\ControlParadasP01\datos con escritura atómica y respaldos rotativos.
//  - HTML: IndexedDB del navegador («CPR_P01»), con revisión y aviso entre pestañas.
const MAX_RESPALDOS = 10;

function crearIDB() {
  const NOMBRE = 'CPR_P01';
  let canal = null;
  try { canal = new BroadcastChannel('CPR_P01'); } catch { /* sin soporte */ }
  const abrirIDB = () => new Promise((res, rej) => {
    const rq = indexedDB.open(NOMBRE, 1);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains('estado')) d.createObjectStore('estado');
      if (!d.objectStoreNames.contains('respaldos')) d.createObjectStore('respaldos', { keyPath: 'id', autoIncrement: true });
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error || new Error('No se pudo abrir el almacenamiento del navegador'));
  });
  const tx = async (stores, modo, fn) => {
    const d = await abrirIDB();
    return new Promise((res, rej) => {
      const t = d.transaction(stores, modo);
      let out;
      Promise.resolve(fn(t)).then(v => { out = v; });
      t.oncomplete = () => { d.close(); res(out); };
      t.onerror = () => { d.close(); rej(t.error); };
      t.onabort = () => { d.close(); rej(t.error || new Error('Operación de guardado cancelada')); };
    });
  };
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  let revBase = null;
  const oyentesExternos = new Set();
  if (canal) canal.onmessage = ev => oyentesExternos.forEach(f => f(ev.data));
  return {
    tipo: 'HTML',
    ubicacion: async () => 'Este navegador · almacenamiento local «CPR_P01» (IndexedDB)',
    async cargar() {
      const r = await tx(['estado'], 'readonly', t => req(t.objectStore('estado').get('actual')));
      if (!r) { revBase = 0; return null; }
      revBase = r.rev;
      return { bytes: new Uint8Array(r.bytes), rev: r.rev, instante: r.instante };
    },
    async guardar(bytes, rev, motivo) {
      const instante = new Date().toISOString();
      let conflicto = false;
      const res = await tx(['estado', 'respaldos'], 'readwrite', async t => {
        const st = t.objectStore('estado');
        const previo = await req(st.get('actual'));
        if (previo && revBase !== null && previo.rev !== revBase) {
          conflicto = true;
          t.abort();
          return { conflicto: true };
        }
        if (previo) {
          const rs = t.objectStore('respaldos');
          await req(rs.add({ instante: previo.instante, rev: previo.rev, motivo: 'Antes de: ' + motivo, bytes: previo.bytes }));
          const claves = await req(rs.getAllKeys());
          for (const k of claves.slice(0, Math.max(0, claves.length - MAX_RESPALDOS))) await req(rs.delete(k));
        }
        await req(st.put({ rev, instante, motivo, bytes: bytes.slice().buffer }, 'actual'));
        return { ok: true };
      }).catch(e => (conflicto ? { conflicto: true } : Promise.reject(e)));
      if (res && res.conflicto) throw new Error('Otra pestaña guardó cambios más recientes. Pulse «Recargar» para trabajar con los datos actuales; este cambio no se guardó.');
      revBase = rev;
      if (canal) canal.postMessage({ rev, instante });
      return { ok: true, instante };
    },
    async listarRespaldos() {
      const l = await tx(['respaldos'], 'readonly', t => req(t.objectStore('respaldos').getAll()));
      return (l || []).map(r => ({ id: r.id, instante: r.instante, rev: r.rev, motivo: r.motivo })).reverse();
    },
    async obtenerRespaldo(id) {
      const r = await tx(['respaldos'], 'readonly', t => req(t.objectStore('respaldos').get(id)));
      if (!r) throw new Error('Respaldo no encontrado');
      return new Uint8Array(r.bytes);
    },
    alCambiarFuera(f) { oyentesExternos.add(f); },
  };
}

function crearHost(h) {
  return {
    tipo: 'EXE',
    ubicacion: async () => (await h.info()).ruta,
    async cargar() { const r = await h.cargar(); return r ? { bytes: new Uint8Array(r.bytes), rev: r.rev, instante: r.instante } : null; },
    async guardar(bytes, rev, motivo) {
      const r = await h.guardar(bytes, rev, motivo);
      if (!r || !r.ok) throw new Error((r && r.error) || 'No se pudo guardar en disco');
      return r;
    },
    async listarRespaldos() { return h.listarRespaldos(); },
    async obtenerRespaldo(id) { return new Uint8Array(await h.obtenerRespaldo(id)); },
    alCambiarFuera() { /* una sola instancia en el EXE */ },
  };
}

export function crearPersistencia() {
  return globalThis.hostCPR ? crearHost(globalThis.hostCPR) : crearIDB();
}
