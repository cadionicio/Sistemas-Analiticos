// Acceso a la base SQLite (sql.js) y adaptadores de persistencia por host.
import initSqlJs from "sql.js/dist/sql-wasm.js";
import { DDL, SCHEMA_VERSION, MIGRACIONES_COLUMNAS } from "./schema";

declare const __SQL_WASM_B64__: string;
declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

type Row = Record<string, any>;

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)));
  return btoa(s);
}

// ---------- Adaptadores de almacenamiento (puerto StoragePort) ----------
export interface SaveInfo {
  ok: boolean;
  bytes: number;
  where: string;
  at: string;
  error?: string;
}
export interface StorageAdapter {
  kind: "EXE" | "HTML";
  describe(): Promise<string>;
  load(): Promise<Uint8Array | null>;
  save(bytes: Uint8Array): Promise<SaveInfo>;
  exportFile(nombre: string, bytes: Uint8Array, mime: string): Promise<string>;
}

const w = window as any;
const BLOQUE = 2 * 1024 * 1024; // 2 MB por mensaje entre la interfaz y el host del EXE

/** Host EXE: funciones enlazadas por el host Go (hostInfo, hostDbLoad, hostDbSave, hostExport). */
class ExeStorage implements StorageAdapter {
  kind = "EXE" as const;
  async describe() {
    const info = await w.hostInfo();
    return `Archivo SQLite en ${info.dbPath}`;
  }
  async load() {
    if (typeof w.hostDbLoadChunk !== "function") {
      const b64: string = await w.hostDbLoad();
      return b64 ? b64ToBytes(b64) : null;
    }
    // Lectura por bloques (bases grandes): evita un único mensaje de decenas de MB por el puente del host.
    const info = await w.hostDbInfo();
    if (!info || !info.exists || !info.size) return null;
    const out = new Uint8Array(info.size);
    const status = document.getElementById("boot");
    for (let off = 0; off < info.size; off += BLOQUE) {
      const b = b64ToBytes(await w.hostDbLoadChunk(off, BLOQUE));
      out.set(b, off);
      if (status && info.size > BLOQUE) status.textContent = `Abriendo la base de datos local… ${Math.min(100, Math.round(((off + b.length) / info.size) * 100))} % de ${(info.size / 1048576).toFixed(1).replace(".", ",")} MB`;
    }
    return out;
  }
  async save(bytes: Uint8Array) {
    if (typeof w.hostDbSaveBegin !== "function" || bytes.length <= BLOQUE) {
      const r = await w.hostDbSave(bytesToB64(bytes));
      return { ok: !!r.ok, bytes: r.bytes, where: r.path, at: r.at, error: r.error };
    }
    const id: string = await w.hostDbSaveBegin(bytes.length);
    for (let off = 0; off < bytes.length; off += BLOQUE) {
      const ok = await w.hostDbSaveChunk(id, bytesToB64(bytes.subarray(off, off + BLOQUE)));
      if (!ok) return { ok: false, bytes: 0, where: "", at: new Date().toISOString(), error: "falló el envío de un bloque al host" };
    }
    const r = await w.hostDbSaveCommit(id);
    return { ok: !!r.ok, bytes: r.bytes, where: r.path, at: r.at, error: r.error };
  }
  async exportFile(nombre: string, bytes: Uint8Array) {
    let r: any;
    if (typeof w.hostExportCommit === "function" && bytes.length > BLOQUE) {
      const id: string = await w.hostDbSaveBegin(bytes.length);
      for (let off = 0; off < bytes.length; off += BLOQUE) {
        if (!(await w.hostDbSaveChunk(id, bytesToB64(bytes.subarray(off, off + BLOQUE))))) throw new Error("falló el envío de un bloque al host");
      }
      r = await w.hostExportCommit(id, nombre);
    } else r = await w.hostExport(nombre, bytesToB64(bytes));
    if (!r.ok) throw new Error(r.error || "No se pudo guardar el archivo");
    return r.path as string;
  }
}

/** Host HTML file://: IndexedDB del navegador + descarga de respaldo. */
class HtmlStorage implements StorageAdapter {
  kind = "HTML" as const;
  private dbp: Promise<IDBDatabase> | null = null;
  private open(): Promise<IDBDatabase> {
    if (!this.dbp)
      this.dbp = new Promise((res, rej) => {
        const r = indexedDB.open("pc05_costeo", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    return this.dbp;
  }
  async describe() {
    let persist = "no confirmada";
    try {
      if (navigator.storage && navigator.storage.persisted) persist = (await navigator.storage.persisted()) ? "persistente" : "no garantizada por el navegador";
    } catch {}
    return `IndexedDB del navegador (${location.protocol}) · persistencia ${persist}`;
  }
  async load() {
    try {
      const db = await this.open();
      return await new Promise<Uint8Array | null>((res, rej) => {
        const t = db.transaction("kv", "readonly").objectStore("kv").get("sqlite");
        t.onsuccess = () => res(t.result ? new Uint8Array(t.result) : null);
        t.onerror = () => rej(t.error);
      });
    } catch (e) {
      return null;
    }
  }
  async save(bytes: Uint8Array) {
    const at = new Date().toISOString();
    try {
      const db = await this.open();
      await new Promise<void>((res, rej) => {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(bytes.slice().buffer, "sqlite");
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error);
      });
      try {
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      } catch {}
      return { ok: true, bytes: bytes.length, where: "IndexedDB", at };
    } catch (e: any) {
      return { ok: false, bytes: 0, where: "IndexedDB", at, error: String(e && e.message ? e.message : e) };
    }
  }
  async exportFile(nombre: string, bytes: Uint8Array, mime: string) {
    const blob = new Blob([bytes], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 2000);
    return `Descargas del navegador / ${nombre}`;
  }
}

export function detectarStorage(): StorageAdapter {
  return typeof w.hostDbLoad === "function" ? new ExeStorage() : new HtmlStorage();
}

// ---------- Base de datos ----------
export class Store {
  db: any;
  storage: StorageAdapter;
  lastSave: SaveInfo | null = null;
  dirty = false;
  /** Contador de cambios (invalida memorias de la interfaz, p. ej. analítica). */
  rev = 0;
  onSaved: (i: SaveInfo) => void = () => {};
  private timer: any = null;
  private constructor(db: any, storage: StorageAdapter) {
    this.db = db;
    this.storage = storage;
  }

  static async open(storage: StorageAdapter): Promise<Store> {
    const SQL = await (initSqlJs as any)({ wasmBinary: b64ToBytes(__SQL_WASM_B64__) });
    const bytes = await storage.load();
    let db: any;
    if (bytes && bytes.length) {
      db = new SQL.Database(bytes);
    } else {
      db = new SQL.Database();
    }
    db.run(DDL);
    migrarColumnas(db);
    const s = new Store(db, storage);
    (s as any).SQL = SQL;
    if (!s.one("SELECT valor FROM meta WHERE clave='schema_version'")) {
      s.run("INSERT INTO meta(clave,valor) VALUES('schema_version',?),('creada_en',?),('app_version',?)", [String(SCHEMA_VERSION), new Date().toISOString(), APP_VERSION]);
    } else {
      s.run("UPDATE meta SET valor=? WHERE clave='schema_version'", [String(SCHEMA_VERSION)]);
      s.run("INSERT INTO meta(clave,valor) VALUES('app_version',?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor", [APP_VERSION]);
    }
    limpiarTextosHeredados(db);
    // la marca de versión al abrir no es un cambio del usuario: no debe mostrar «Cambios sin guardar»
    s.dirty = false;
    s.rev = 0;
    return s;
  }

  all(sql: string, params: any[] = []): Row[] {
    const st = this.db.prepare(sql);
    try {
      st.bind(params);
      const out: Row[] = [];
      while (st.step()) out.push(st.getAsObject());
      return out;
    } finally {
      st.free();
    }
  }
  one(sql: string, params: any[] = []): Row | null {
    return this.all(sql, params)[0] || null;
  }
  run(sql: string, params: any[] = []) {
    this.db.run(sql, params);
    this.dirty = true;
    this.rev++;
  }
  /** Transacción atómica: todo o nada (MT-04). */
  tx<T>(fn: () => T): T {
    this.db.run("BEGIN");
    try {
      const r = fn();
      this.db.run("COMMIT");
      this.dirty = true;
      return r;
    } catch (e) {
      this.db.run("ROLLBACK");
      throw e;
    }
  }
  audit(accion: string, entidad: string, entidadId: string, antes: any, despues: any) {
    this.db.run("INSERT INTO auditoria(ts,actor,accion,entidad,entidad_id,antes,despues) VALUES(?,?,?,?,?,?,?)", [
      new Date().toISOString(),
      "usuario-local",
      accion,
      entidad,
      entidadId,
      antes == null ? null : JSON.stringify(antes),
      despues == null ? null : JSON.stringify(despues),
    ]);
  }
  export(): Uint8Array {
    return this.db.export();
  }
  private guardando: Promise<SaveInfo> | null = null;
  private pendiente = false;
  private ultimoTamano = 0;
  async saveNow(): Promise<SaveInfo> {
    clearTimeout(this.timer);
    // Un solo guardado a la vez: si llega otro pedido mientras se guarda, se repite al terminar (con los datos más recientes).
    if (this.guardando) {
      this.pendiente = true;
      return this.guardando;
    }
    const revAntes = this.rev;
    this.guardando = (async () => {
      const bytes = this.export();
      this.ultimoTamano = bytes.length;
      const info = await this.storage.save(bytes);
      this.lastSave = info;
      if (info.ok && this.rev === revAntes) this.dirty = false;
      this.onSaved(info);
      return info;
    })();
    try {
      return await this.guardando;
    } finally {
      this.guardando = null;
      if (this.pendiente) {
        this.pendiente = false;
        this.scheduleSave();
      }
    }
  }
  scheduleSave() {
    clearTimeout(this.timer);
    // Bases grandes (más de 20 MB): se agrupan más cambios por guardado para no repetir escrituras pesadas.
    this.timer = setTimeout(() => this.saveNow(), this.ultimoTamano > 20e6 ? 1500 : 350);
  }
  /** Restaura desde un archivo .sqlite validando que sea una base PC05. */
  async restore(bytes: Uint8Array): Promise<void> {
    const SQL = (this as any).SQL;
    const test = new SQL.Database(bytes);
    try {
      const r = test.exec("SELECT valor FROM meta WHERE clave='schema_version'");
      if (!r.length) throw new Error("El archivo no es una base de este sistema (falta la tabla meta).");
      const fk = test.exec("PRAGMA foreign_key_check");
      if (fk.length && fk[0].values.length) throw new Error("El respaldo tiene referencias rotas (foreign_key_check).");
      const ic = test.exec("PRAGMA integrity_check");
      if (ic[0].values[0][0] !== "ok") throw new Error("Integridad SQLite: " + ic[0].values[0][0]);
    } catch (e) {
      test.close();
      throw e;
    }
    this.db.close();
    this.db = test;
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run(DDL);
    migrarColumnas(this.db);
    limpiarTextosHeredados(this.db);
    this.audit("RESTAURAR_RESPALDO", "base", "-", null, { bytes: bytes.length });
    await this.saveNow();
  }
  counts(): { tabla: string; n: number }[] {
    const t = this.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    return t.map((r) => ({ tabla: r.name, n: (this.one(`SELECT COUNT(*) n FROM "${r.name}"`) as any).n }));
  }
}

export function uid(prefix = ""): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return prefix + Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hashStr(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function migrarColumnas(db: any) {
  for (const [tabla, col, tipo] of MIGRACIONES_COLUMNAS) {
    const r = db.exec(`PRAGMA table_info(${tabla})`);
    const cols = r.length ? r[0].values.map((v: any[]) => v[1]) : [];
    if (!cols.includes(col)) db.run(`ALTER TABLE ${tabla} ADD COLUMN ${col} ${tipo}`);
  }
}

/** Textos descriptivos guardados por versiones anteriores: se reescriben con la terminología actual.
 *  Solo columnas informativas (nombres de modelo, notas, advertencias, causas de saldo); ninguna entra
 *  al cálculo ni a la huella de parámetros, por lo que las corridas guardadas siguen vigentes. */
const TEXTOS_HEREDADOS: [string, string][] = [
  ["modelo", "nombre"], ["modelo", "descripcion"], ["modelo_version", "nota"], ["saldo", "causa"],
  ["modelo_origen", "advertencias"], ["empresa", "nombre"], ["costo_persona", "justificacion"],
  ["centro", "nota"], ["actividad", "nota"], ["objeto_costo", "nota"],
];
export function limpiarTexto(t: string): string {
  return t
    .replace(/\s*\((?:D-\d\d(?:,\s*D-\d\d)*|I\d(?:[–-]I\d)?|T\d\d(?:\/T\d\d)*)\)/g, "")
    .replace(/,\s*D-\d\d(?:,\s*D-\d\d)*(?=\))/g, "")
    .replace(/\(D-\d\d\):\s*/g, ": ")
    .replace(/Plantilla del profesor \(Excel de referencia\)/g, "Plantilla ABC de referencia (Excel)")
    .replace(/Excel del profesor/g, "Excel de referencia")
    .replace(/[Pp]lantilla del profesor/g, (m) => (m[0] === "P" ? "Plantilla" : "plantilla") + " de referencia")
    .replace(/formato del profesor/g, "formato de referencia")
    .replace(/Verificación I1 \(vectores V7\)/g, "Caso de verificación del motor (sintético)")
    .replace(/Versión inicial I1/g, "Versión inicial")
    .replace(/la prueba de la Iteración 1/g, "verificar el motor")
    .replace(/verificación I1/g, "verificación")
    .replace(/formato PC05 normalizado/g, "formato normalizado");
}
function limpiarTextosHeredados(db: any) {
  for (const [tabla, col] of TEXTOS_HEREDADOS) {
    const r = db.exec(`SELECT rowid, ${col} FROM ${tabla} WHERE ${col} IS NOT NULL`);
    if (!r.length) continue;
    for (const [rowid, v] of r[0].values) {
      const n = limpiarTexto(String(v));
      if (n !== v) db.run(`UPDATE ${tabla} SET ${col}=? WHERE rowid=?`, [n, rowid]);
    }
  }
  db.run("UPDATE modelo SET codigo='MV' WHERE codigo='M03-I1'");
}
