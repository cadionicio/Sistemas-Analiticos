// Genera el Excel 06 oficial y verifica que se reimporta sin errores (se ejecuta con vitest para usar TypeScript).
import { it, expect } from 'vitest';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import initSqlJs from 'sql.js';
import { generarPlantilla, leerExcel } from '../src/core/excel';
import { validarConjunto } from '../src/core/contrato';
import { confirmarCarga } from '../src/core/carga';
import { Repo } from '../src/core/db';
import * as P from '../src/core/permisos';
import * as D from '../src/core/dominio';
it('Excel 06', async () => {
  const buf = await generarPlantilla();
  const destino = process.env.SALIDA_06 ?? '/tmp/06_Informacion_Carga.xlsx';
  fs.writeFileSync(destino, Buffer.from(buf));
  const hojas = await leerExcel(buf);
  const { errores, datos } = validarConjunto(hojas);
  expect(errores).toEqual([]);
  const SQL = await initSqlJs(); const r = Repo.iniciar(new SQL.Database());
  P.asegurarUsuarios(r); r.transaccion(() => D.asegurarParametros(r));
  confirmarCarga(r, 'U01', datos, { hash: 'x', nombre: '06', bytes: buf.byteLength, datasetId: '06' });
  console.log('HOJAS', hojas.length ?? Object.keys(hojas).length, 'SHA', createHash('sha256').update(Buffer.from(buf)).digest('hex'), 'supuestos', r.num('SELECT COUNT(*) FROM supuesto_economico'), 'modelo', r.num('SELECT COUNT(*) FROM modelo_simulacion'), 'escenarios', r.num('SELECT COUNT(*) FROM escenario_demanda'));
});
