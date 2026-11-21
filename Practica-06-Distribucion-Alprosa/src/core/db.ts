// Envoltura transaccional sobre SQLite (sql.js) común a EXE y HTML.
import type { Database, SqlValue } from 'sql.js';
import { DDL_V2, DDL_V3_TRANSPORTE, DDL_V4_OPERACION, DDL_V5_ANALITICA, DDL_V6_SIMULACION, DDL_V7_CONTINUIDAD, SCHEMA_VERSION } from './schema';
import { migrar } from './migraciones';
import { ahoraLima } from './util';

export type Fila = Record<string, SqlValue>;

export class Repo {
  private enTx = false;
  /** Reloj inyectable para pruebas de vigencias; por defecto hora de Lima. */
  reloj: () => string = ahoraLima;
  constructor(public db: Database) {}

  static iniciar(db: Database): Repo {
    db.exec('PRAGMA foreign_keys = ON;');
    const r = new Repo(db);
    const hayMeta = r.uno("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'");
    const v = hayMeta ? Number(r.uno("SELECT valor FROM meta WHERE clave='schema_version'")?.valor ?? 0) : 0;
    if (v > SCHEMA_VERSION) throw new Error(`La base usa el esquema ${v}, posterior a este programa (${SCHEMA_VERSION}). No se abrirá para escritura.`);
    if (v === 0) {
      db.exec(DDL_V2);
      db.exec(DDL_V3_TRANSPORTE);
      db.exec(DDL_V4_OPERACION);
      db.exec(DDL_V5_ANALITICA);
      db.exec(DDL_V6_SIMULACION);
      db.exec(DDL_V7_CONTINUIDAD);
      r.run("INSERT INTO meta(clave, valor) VALUES ('schema_version', ?)", [String(SCHEMA_VERSION)]);
      r.run('INSERT INTO migracion VALUES (?,?,?)', [SCHEMA_VERSION, ahoraLima(), 'Creación directa del esquema']);
    } else if (v < SCHEMA_VERSION) {
      migrar(r, v);
    }
    return r;
  }

  todos(sql: string, p: SqlValue[] = []): Fila[] {
    const st = this.db.prepare(sql);
    try {
      st.bind(p);
      const out: Fila[] = [];
      while (st.step()) out.push(st.getAsObject() as Fila);
      return out;
    } finally {
      st.free();
    }
  }
  uno(sql: string, p: SqlValue[] = []): Fila | undefined { return this.todos(sql, p)[0]; }
  run(sql: string, p: SqlValue[] = []) { this.db.run(sql, p); }
  num(sql: string, p: SqlValue[] = []): number { return Number(Object.values(this.uno(sql, p) ?? { x: 0 })[0] ?? 0); }

  /** Copia coherente: nunca durante una transacción abierta (BD01). */
  exportar(): Uint8Array {
    if (this.enTx) throw new Error('No se puede copiar la base con una transacción en curso.');
    return this.db.export();
  }

  /** Ensayo aislado: ejecuta fn y deshace TODO al terminar (simulación sobre reservas/planes hipotéticos). Nunca deja cambios. */
  ensayo<T>(fn: () => T): T {
    if (this.enTx) throw new Error('No se puede ensayar con una transacción en curso.');
    this.db.exec('BEGIN IMMEDIATE');
    this.enTx = true;
    try { return fn(); } finally { this.db.exec('ROLLBACK'); this.enTx = false; }
  }

  /** Ejecuta fn de forma atómica. Si falla, no queda ningún cambio (RN-07, RN-19, RN-25, AH01). */
  transaccion<T>(fn: () => T): T {
    if (this.enTx) return fn(); // anidada: forma parte de la transacción externa
    this.db.exec('BEGIN IMMEDIATE');
    this.enTx = true;
    try {
      const r = fn();
      const fk = this.todos('PRAGMA foreign_key_check');
      if (fk.length) throw new Error('Integridad referencial violada en ' + String(fk[0].table));
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    } finally {
      this.enTx = false;
    }
  }

  /** Comando idempotente: el mismo command_id devuelve el resultado original sin repetir efectos (RN-14, F04, G08, AG07). */
  comando<T>(commandId: string, tipo: string, actor: { usuario_id: string; roles: string[] }, fn: () => T): { resultado: T; repetido: boolean } {
    const previo = this.uno('SELECT resultado FROM comando WHERE command_id = ?', [commandId]);
    if (previo) return { resultado: JSON.parse(String(previo.resultado)) as T, repetido: true };
    const resultado = this.transaccion(() => {
      const r = fn();
      const t = this.reloj();
      this.run('INSERT INTO comando(command_id, tipo, aplicado_en, resultado) VALUES (?,?,?,?)', [commandId, tipo, t, JSON.stringify(r ?? null)]);
      this.auditar(actor, tipo, commandId, r ?? null);
      return r;
    });
    return { resultado, repetido: false };
  }

  auditar(actor: { usuario_id: string; roles: string[] }, accion: string, commandId: string | null, detalle: unknown) {
    this.run('INSERT INTO auditoria(registrado_en, usuario_id, roles, accion, command_id, detalle) VALUES (?,?,?,?,?,?)',
      [this.reloj(), actor.usuario_id, actor.roles.join(','), accion, commandId, JSON.stringify(detalle)]);
  }
}
