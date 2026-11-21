/**
 * Capa de datos — SQLite en memoria mediante sql.js (WASM).
 * Un solo código para el EXE y el HTML: la persistencia (archivo .sqlite)
 * la resuelve la capa de plataforma (src/platform), no esta clase.
 * Sistema de Análisis de Datos y Predictivo de Gestión de Inventarios.
 */
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import schemaSql from './schema.sql?raw';

export type Fila = Record<string, SqlValue>;

let sqlPromise: Promise<SqlJsStatic> | null = null;

/** Carga el motor sql.js una sola vez. En el navegador recibe la URL (data:) del WASM embebido. */
export function cargarMotor(wasmUrl?: string): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
  }
  return sqlPromise;
}

export class BaseDatos {
  private constructor(public readonly db: Database) {}

  /** Crea una BD nueva con el esquema v1.0, o abre una existente desde bytes (.sqlite). */
  static async abrir(bytes?: Uint8Array, wasmUrl?: string): Promise<BaseDatos> {
    const SQL = await cargarMotor(wasmUrl);
    const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    const bd = new BaseDatos(db);
    db.exec('PRAGMA foreign_keys = ON;');
    if (!bytes || !bd.existeTabla('dataset')) db.exec(schemaSql);
    return bd;
  }

  existeTabla(nombre: string): boolean {
    return this.valor<number>("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", [nombre]) > 0;
  }

  /** Ejecuta una sentencia sin resultados. */
  run(sql: string, params: SqlValue[] = []): void {
    this.db.run(sql, params);
  }

  /** Devuelve todas las filas como objetos. */
  todas<T = Fila>(sql: string, params: SqlValue[] = []): T[] {
    const st = this.db.prepare(sql);
    try {
      st.bind(params);
      const out: T[] = [];
      while (st.step()) out.push(st.getAsObject() as T);
      return out;
    } finally {
      st.free();
    }
  }

  una<T = Fila>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.todas<T>(sql, params)[0];
  }

  valor<T = SqlValue>(sql: string, params: SqlValue[] = []): T {
    const st = this.db.prepare(sql);
    try {
      st.bind(params);
      return (st.step() ? st.get()[0] : null) as T;
    } finally {
      st.free();
    }
  }

  ultimoId(): number {
    return this.valor<number>('SELECT last_insert_rowid()');
  }

  /** Ejecuta fn dentro de una transacción; revierte si hay error. */
  transaccion<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Inserción masiva con una sentencia preparada (rápida para miles de filas). */
  insertarMuchos(sql: string, filas: SqlValue[][]): void {
    const st = this.db.prepare(sql);
    try {
      for (const f of filas) st.run(f);
    } finally {
      st.free();
    }
  }

  /** Exporta la BD completa (para guardar el archivo .sqlite). */
  exportar(): Uint8Array {
    return this.db.export();
  }

  cerrar(): void {
    this.db.close();
  }
}
