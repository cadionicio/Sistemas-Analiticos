// Pruebas de I03: un caso de prueba por ESC-ID asignado a I03 (los que dependen de I04 se marcan como parciales en el registro).
import { describe, it, expect, beforeEach } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import ExcelJS from 'exceljs';
import { Repo } from '../src/core/db';
import { validarConjunto } from '../src/core/contrato';
import { confirmarCarga } from '../src/core/carga';
import * as D from '../src/core/dominio';
import * as P from '../src/core/permisos';
import { hojasDemo, tablasDemo, aHojas } from '../src/core/demo';
import { leerExcel, generarPlantilla } from '../src/core/excel';

let SQL: SqlJsStatic;
let repo: Repo;
const T0 = '2026-11-13T12:00:00-05:00';
const DATOS = 'U01', PED = 'U02', ALM = 'U03', PLAN = 'U04', SUP = 'U05', ANA = 'U06';
const disp = (prod: string, nodo?: string) => D.existencias(repo).filter((e) => e.producto_id === prod && (!nodo || e.nodo_id === nodo)).reduce((a, e) => a + e.disponible_mil, 0) / 1000;
const ped = (id: string) => D.pedidos(repo).find((p) => p.pedido_id === id)!;
function nuevo(tablas = tablasDemo()) {
  repo = Repo.iniciar(new SQL.Database());
  repo.reloj = () => T0;
  P.asegurarUsuarios(repo);
  repo.transaccion(() => D.asegurarParametros(repo));
  const { errores, datos } = validarConjunto(aHojas(tablas));
  if (errores.length) throw new Error(JSON.stringify(errores.slice(0, 3)));
  confirmarCarga(repo, DATOS, datos, { hash: 'demo', nombre: 'demo', bytes: 0, datasetId: 'demo' });
}
async function libro(mod: (wb: ExcelJS.Workbook) => void) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await generarPlantilla());
  mod(wb);
  return validarConjunto(await leerExcel((await wb.xlsx.writeBuffer()) as ArrayBuffer));
}
const producto = (id: string, extra: Record<string, unknown> = {}) => ({ producto_id: id, nombre_generico: 'Producto prueba', familia: 'Prueba', unidad_base: 'unidad', peso_kg_por_unidad_mil: 25000, vol_cm3_por_unidad: 40000, fraccionable: 0, activo: 1, ...extra });

beforeEach(async () => { SQL ??= await initSqlJs(); nuevo(); });

describe('A — Maestros', () => {
  it('ESC-A01 alta válida persiste y se puede elegir', () => {
    D.guardarMaestro(repo, DATOS, 'producto', producto('PX1'), 'alta');
    D.guardarMaestro(repo, DATOS, 'presentacion', { presentacion_id: 'PX1-U', producto_id: 'PX1', nombre: 'Unidad', factor_base_mil: 1000, activo: 1 }, 'alta');
    const id = P.rolesVigentes(repo, PED).length && D.crearPedido(repo, PED, { cliente_id: 'CLI-001', destino_id: 'DES-001', fecha_pedido: '2026-11-13', ventana_inicio: '2026-11-20T08:00:00-05:00', ventana_fin: '2026-11-21T18:00:00-05:00', prioridad: 'NORMAL', permite_parcial: false, permite_entregas_divididas: false, lineas: [{ producto_id: 'PX1', presentacion_id: 'PX1-U', cantidad_presentacion_mil: 2000, precio_neto_base_p4: 100000 }] });
    expect(id).toBeTruthy();
  });
  it('ESC-A02 código duplicado se rechaza sin duplicar', () => {
    expect(() => D.guardarMaestro(repo, DATOS, 'producto', producto('P01'), 'alta')).toThrow(/Ya existe/);
    expect(repo.num("SELECT COUNT(*) FROM producto WHERE producto_id='P01'")).toBe(1);
  });
  it('ESC-A03 obligatorio ausente: error por campo y sin alta', () => {
    try { D.guardarMaestro(repo, DATOS, 'producto', producto('PX2', { nombre_generico: '' }), 'alta'); expect.fail(); }
    catch (e) { expect((e as D.ErrorValidacion).campos.nombre_generico).toMatch(/Obligatorio/); }
    expect(repo.num("SELECT COUNT(*) FROM producto WHERE producto_id='PX2'")).toBe(0);
  });
  it('ESC-A04 unidades incompatibles no se suman y factor no positivo se bloquea', () => {
    expect(() => D.sumarCompatibles([{ q_mil: 1000, unidad: 'saco' }, { q_mil: 1000, unidad: 'kg' }])).toThrow(/unidades distintas/);
    expect(() => D.guardarMaestro(repo, DATOS, 'presentacion', { presentacion_id: 'P01-Z', producto_id: 'P01', nombre: 'Cero', factor_base_mil: 0, activo: 1 }, 'alta')).toThrow(/mayor que cero/);
  });
  it('ESC-A05 capacidad negativa se rechaza', () => {
    expect(() => D.guardarMaestro(repo, DATOS, 'nodo', { nodo_id: 'ALM-X', nombre: 'X', tipo: 'ALMACEN', region: 'Arequipa', capacidad_almacen_kg_mil: -1, permite_espera_nocturna: 0, activo: 1 }, 'alta')).toThrow(/negativo/);
  });
  it('ESC-A06 editar maestro referenciado conserva el snapshot del pedido', () => {
    const antes = repo.uno("SELECT nombre_producto_snapshot n, precio_neto_base_p4 p FROM pedido_linea WHERE pedido_linea_id='PED-0001-01'")!;
    const p = repo.uno("SELECT * FROM producto WHERE producto_id='P01'")!;
    D.guardarMaestro(repo, DATOS, 'producto', { ...p, nombre_generico: 'Nombre nuevo' }, 'edicion');
    expect(repo.uno("SELECT nombre_producto_snapshot n, precio_neto_base_p4 p FROM pedido_linea WHERE pedido_linea_id='PED-0001-01'")).toEqual(antes);
    expect(repo.num("SELECT COUNT(*) FROM maestro_historial WHERE entidad='producto' AND entidad_id='P01'")).toBeGreaterThan(0);
  });
  it('ESC-A07 inactivar bloquea selecciones nuevas y mantiene operaciones existentes', () => {
    D.cambiarActivo(repo, DATOS, 'producto', 'P01', false);
    expect(() => D.crearPedido(repo, PED, { cliente_id: 'CLI-001', destino_id: 'DES-001', fecha_pedido: '2026-11-13', ventana_inicio: '2026-11-20T08:00:00-05:00', ventana_fin: '2026-11-21T18:00:00-05:00', prioridad: 'NORMAL', permite_parcial: false, permite_entregas_divididas: false, lineas: [{ producto_id: 'P01', presentacion_id: 'P01-U', cantidad_presentacion_mil: 1000, precio_neto_base_p4: 1 }] })).toThrow(/inactivo/);
    expect(D.reservarFefo(repo, ALM, 'PED-0001').resultado.asignaciones.length).toBe(2);
  });
  it('ESC-A08 tarifa nueva aplica por vigencia sin alterar la anterior', () => {
    D.registrarTarifa(repo, DATOS, { tarifa_id: 'TAR-CAM', modo: 'VIAL', base_fija_cent: 50000, costo_kg_p4: 1000, minimo_cent: 0, vigente_desde: '2026-11-01T00:00:00-05:00' });
    D.registrarTarifa(repo, DATOS, { tarifa_id: 'TAR-CAM', modo: 'VIAL', base_fija_cent: 60000, costo_kg_p4: 1000, minimo_cent: 0, vigente_desde: '2026-11-15T00:00:00-05:00' });
    expect(D.tarifaVigente(repo, 'TAR-CAM', '2026-11-14T10:00:00-05:00')!.base_fija_cent).toBe(50000);
    expect(D.tarifaVigente(repo, 'TAR-CAM', '2026-11-15T00:00:00-05:00')!.base_fija_cent).toBe(60000);
  });
});

describe('B — Importación', () => {
  it('ESC-B01 archivo válido: una carga coherente', async () => { const r = await libro(() => {}); expect(r.errores).toEqual([]); expect(r.datos.Pedidos.length).toBe(44); }); // I04-a: +4 pedidos a destinos remotos
  it('ESC-B02 falta hoja obligatoria: lista de faltantes', async () => { const r = await libro((wb) => wb.removeWorksheet(wb.getWorksheet('Lotes')!.id)); expect(r.errores.some((e) => e.hoja === 'Lotes' && /Falta la hoja/.test(e.mensaje))).toBe(true); });
  it('ESC-B03 fecha inválida con hoja y celda', async () => { const r = await libro((wb) => { wb.getWorksheet('Lotes')!.getCell('E2').value = '31/02/2027'; }); expect(r.errores.some((e) => e.hoja === 'Lotes' && e.celda === 'E2')).toBe(true); });
  it('ESC-B04 número como texto se rechaza', async () => { const r = await libro((wb) => { wb.getWorksheet('MovimientosIniciales')!.getCell('D2').value = '40'; }); expect(r.errores.some((e) => e.celda === 'D2' && /texto/.test(e.mensaje))).toBe(true); });
  it('ESC-B05 FK inexistente con detalle', async () => { const r = await libro((wb) => { wb.getWorksheet('Lotes')!.getCell('B2').value = 'P99'; }); expect(r.errores.some((e) => e.celda === 'B2' && /Referencia inexistente/.test(e.mensaje))).toBe(true); });
  it('ESC-B06 duplicado dentro del archivo señala ambas filas', async () => { const r = await libro((wb) => { wb.getWorksheet('Clientes')!.getCell('A3').value = 'CLI-001'; }); expect(r.errores.some((e) => /duplicado \(también en la fila 2\)/.test(e.mensaje))).toBe(true); });
  it('ESC-B07 mismo hash informa carga anterior', async () => {
    const { cargaPrevia } = await import('../src/core/carga');
    repo.run("UPDATE meta SET valor='h1' WHERE clave='dataset_hash'"); repo.run("UPDATE carga SET file_hash='h1'");
    expect(cargaPrevia(repo, 'h1')).toBeTruthy();
  });
  it('ESC-B08 error tardío revierte también filas válidas', () => {
    const r2 = Repo.iniciar(new SQL.Database()); P.asegurarUsuarios(r2);
    const { datos } = validarConjunto(hojasDemo());
    datos.PedidoDetalle.push({ ...datos.PedidoDetalle[0], pedido_linea_id: 'X', pedido_id: 'NO-EXISTE' });
    expect(() => confirmarCarga(r2, DATOS, datos, { hash: 'h', nombre: 'n', bytes: 0, datasetId: 'd' })).toThrow();
    expect(r2.num('SELECT COUNT(*) FROM producto')).toBe(0);
  });
  it('ESC-O01 hojas y columnas reordenadas se leen igual', async () => {
    const r = await libro((wb) => {
      const ws = wb.getWorksheet('Productos')!;
      const filas = (ws.getSheetValues().slice(1) as ExcelJS.CellValue[][]).map((f) => f.slice(1));
      filas.forEach((f, i) => (ws.getRow(i + 1).values = [...f].reverse()));
      wb.worksheets.reverse();
    });
    expect(r.errores).toEqual([]);
    expect(r.datos.Productos.length).toBe(10);
  });
});

describe('C — Pedidos', () => {
  it('ESC-C01 pedido completo confirma y reserva conforme a política', () => {
    D.confirmarPedido(repo, PED, 'PED-0004');
    expect(D.reservarFefo(repo, ALM, 'PED-0004').resultado.pendientes).toEqual([]);
    expect(ped('PED-0004').estado).toBe('Reservado');
  });
  it('ESC-C02 prioridad urgente adelanta el orden propuesto', () => {
    repo.run("UPDATE pedido SET prioridad='URGENTE' WHERE pedido_id='PED-0003'");
    expect(D.ordenPrioridad(repo)[0].pedido_id).toBe('PED-0003');
  });
  it('ESC-C03 stock cero deja pendiente con reserva cero', () => {
    D.guardarMaestro(repo, DATOS, 'producto', producto('P11'), 'alta');
    D.guardarMaestro(repo, DATOS, 'presentacion', { presentacion_id: 'P11-U', producto_id: 'P11', nombre: 'Unidad', factor_base_mil: 1000, activo: 1 }, 'alta');
    repo.run("INSERT INTO pedido_linea VALUES ('PED-0003-03','PED-0003','P11','P11-U',1000,1000,1000,0,0,0,'x')");
    D.reservarFefo(repo, ALM, 'PED-0003');
    const l = ped('PED-0003').lineas.find((x) => x.pedido_linea_id === 'PED-0003-03')!;
    expect([l.reservada_mil, l.pendiente_mil]).toEqual([0, 1000]);
  });
  it('ESC-C04 falta parcial: total o parcial explícito, nunca inventa stock', () => {
    expect(() => D.reservarFefo(repo, ALM, 'PED-0002')).toThrow(/No se reservó nada/);
    expect(D.reservarFefo(repo, ALM, 'PED-0003').resultado.pendientes.find((p) => p.pedido_linea_id === 'PED-0003-01')!.q_mil).toBe(1000);
  });
  it('ESC-C05 cancelar antes de salida libera reservas sin movimiento', () => {
    D.reservarFefo(repo, ALM, 'PED-0001');
    const movs = repo.num('SELECT COUNT(*) FROM movimiento');
    D.cancelarPedido(repo, PED, 'PED-0001', 'Cliente desiste');
    expect(disp('P01')).toBe(120); expect(repo.num('SELECT COUNT(*) FROM movimiento')).toBe(movs); expect(ped('PED-0001').estado).toBe('Cancelado');
  });
  it('ESC-C06 modificar un pedido reservado exige liberar y revalidar', () => {
    D.reservarFefo(repo, ALM, 'PED-0001');
    expect(() => D.modificarLinea(repo, PED, 'PED-0001-01', 60000)).toThrow(/libérelos primero/);
    D.liberarReservas(repo, ALM, { pedido_id: 'PED-0001' });
    D.modificarLinea(repo, PED, 'PED-0001-01', 60000);
    expect(ped('PED-0001').lineas[0].solicitada_mil).toBe(60000);
  });
  it('ESC-C07 compromiso vencido sigue pendiente y aparece atrasado', () => {
    expect(D.pedidos(repo, '2026-11-25T00:00:00-05:00').find((p) => p.pedido_id === 'PED-0001')!.atrasado).toBe(true);
  });
  it('ESC-C08 cantidad cero o negativa se rechaza sin confirmar', () => {
    expect(() => D.crearPedido(repo, PED, { cliente_id: 'CLI-001', destino_id: 'DES-001', fecha_pedido: '2026-11-13', ventana_inicio: '2026-11-20T08:00:00-05:00', ventana_fin: '2026-11-21T18:00:00-05:00', prioridad: 'NORMAL', permite_parcial: false, permite_entregas_divididas: false, lineas: [{ producto_id: 'P01', presentacion_id: 'P01-U', cantidad_presentacion_mil: 0, precio_neto_base_p4: 1 }] })).toThrow(/mayor que cero/);
  });
});

describe('D — Inventario', () => {
  it('ESC-D01 FEFO con desempate determinista', () => { const r = D.reservarFefo(repo, ALM, 'PED-0001').resultado; expect(r.asignaciones.map((a) => [a.lote, a.q_mil])).toEqual([['A', 40000], ['B', 10000]]); });
  it('ESC-D02 lote vencido se excluye con motivo', () => { const r = D.reservarFefo(repo, ALM, 'PED-0001').resultado; expect(r.excluidos.some((e) => e.lote === 'V' && /Vence/.test(e.motivo))).toBe(true); });
  it('ESC-D03 cuarentena no se reserva', () => { const q = D.existencias(repo).find((e) => e.condicion === 'CUARENTENA')!; expect([q.disponible_mil, q.motivo_no_disponible]).toEqual([0, 'Condición CUARENTENA']); });
  it('ESC-D04 cantidad exacta deja disponible cero', () => { repo.run("UPDATE pedido_linea SET q_solicitada_mil=120000 WHERE pedido_linea_id='PED-0001-01'"); D.reservarFefo(repo, ALM, 'PED-0001'); expect(disp('P01')).toBe(0); });
  it('ESC-D05 reservar por encima: bloquea sin parcialidad', () => { repo.run("UPDATE pedido_linea SET q_solicitada_mil=121000 WHERE pedido_linea_id='PED-0001-01'"); expect(() => D.reservarFefo(repo, ALM, 'PED-0001')).toThrow(/No se reservó nada/); expect(disp('P01')).toBe(120); });
  it('ESC-D06 liberar resta compromiso sin ingreso físico', () => { D.reservarFefo(repo, ALM, 'PED-0001'); const m = repo.num('SELECT COUNT(*) FROM movimiento'); D.liberarReservas(repo, ALM, { pedido_id: 'PED-0001' }); expect(disp('P01')).toBe(120); expect(repo.num('SELECT COUNT(*) FROM movimiento')).toBe(m); });
  it('ESC-D07 traslado origen→tránsito→destino con transfer_id', () => {
    const tr = D.trasladar(repo, ALM, { lote_id: 'L-P01-A', origen: 'ALM-AQP', destino: 'ALM-JUL', q_mil: 10000, fecha_prevista: '2026-11-15' }).resultado.transfer_id;
    expect(disp('P01', 'ALM-AQP')).toBe(110); expect(disp('P01', 'ALM-JUL')).toBe(0);
    D.recibirTraslado(repo, ALM, tr, 10000);
    expect(disp('P01', 'ALM-JUL')).toBe(10);
    expect(repo.num('SELECT COUNT(*) FROM movimiento WHERE transfer_id = ?', [tr])).toBe(2);
    expect(D.balanceLote(repo, 'L-P01-A').cuadra).toBe(true);
  });
  it('ESC-D08 ajuste con motivo, conciliación y auditoría', () => {
    expect(() => D.solicitarAjuste(repo, ALM, { lote_id: 'L-P01-A', nodo_id: 'ALM-AQP', condicion: 'APTO', q_delta_mil: -2000, motivo: '' })).toThrow(/Obligatorio/);
    const id = D.solicitarAjuste(repo, ALM, { lote_id: 'L-P01-A', nodo_id: 'ALM-AQP', condicion: 'APTO', q_delta_mil: -2000, motivo: 'Conteo físico con faltante' });
    D.resolverAjuste(repo, SUP, id, true, 'Verificado');
    expect(disp('P01')).toBe(118);
    expect(repo.num("SELECT COUNT(*) FROM auditoria WHERE accion='APROBAR_AJUSTE'")).toBe(1);
    expect(D.balanceLote(repo, 'L-P01-A').cuadra).toBe(true);
  });
});

describe('Integridad, migración y copias', () => {
  it('ESC-AH01 fallo durante traslado compuesto revierte todo', () => {
    const m = repo.num('SELECT COUNT(*) FROM movimiento'), s = repo.num('SELECT COUNT(*) FROM suministro_esperado');
    repo.run("UPDATE nodo SET activo = 0 WHERE nodo_id='TRANSITO'");
    expect(() => D.trasladar(repo, ALM, { lote_id: 'L-P01-A', origen: 'ALM-AQP', destino: 'ALM-JUL', q_mil: 1000, fecha_prevista: '2026-11-15' })).toThrow();
    expect([repo.num('SELECT COUNT(*) FROM movimiento'), repo.num('SELECT COUNT(*) FROM suministro_esperado')]).toEqual([m, s]);
  });
  it('ESC-AH06 restauración válida reemplaza atómicamente', () => {
    const copia = repo.exportar();
    D.reservarFefo(repo, ALM, 'PED-0001');
    const r2 = Repo.iniciar(new SQL.Database(copia));
    expect(r2.num("SELECT COUNT(*) FROM reserva WHERE estado='ACTIVA'")).toBe(0);
    expect(r2.uno('PRAGMA integrity_check')!.integrity_check).toBe('ok');
  });
  it('ESC-BD01 la copia no se toma con una transacción abierta', () => {
    expect(() => repo.transaccion(() => repo.exportar())).toThrow(/transacción en curso/);
  });
  it('ESC-AM05 y ESC-AM06 migración v1→v2 con alias y balances verificados, pendientes declarados', () => {
    const v1 = new SQL.Database();
    v1.exec(`CREATE TABLE meta (clave TEXT PRIMARY KEY, valor TEXT NOT NULL); INSERT INTO meta VALUES ('schema_version','1');
      CREATE TABLE producto (producto_id TEXT PRIMARY KEY, nombre_generico TEXT, familia TEXT, unidad_base TEXT, peso_kg_por_unidad_mil INTEGER, activo INTEGER);
      CREATE TABLE ubicacion (ubicacion_id TEXT PRIMARY KEY, nombre TEXT, tipo TEXT, activa INTEGER);
      CREATE TABLE lote (lote_id TEXT PRIMARY KEY, producto_id TEXT, codigo_lote TEXT, fecha_fabricacion TEXT, fecha_vencimiento TEXT, estado_lote TEXT);
      CREATE TABLE movimiento (movimiento_id TEXT PRIMARY KEY, lote_id TEXT, ubicacion_origen_id TEXT, ubicacion_destino_id TEXT, condicion TEXT, q_mil INTEGER, ocurrido_en TEXT, registrado_en TEXT, tipo TEXT, command_id TEXT);
      CREATE TABLE pedido (pedido_id TEXT PRIMARY KEY, cliente_id TEXT, destino_id TEXT, fecha_pedido TEXT, ventana_inicio TEXT, ventana_fin TEXT, permite_parcial INTEGER, estado_importado TEXT);
      CREATE TABLE pedido_linea (pedido_linea_id TEXT PRIMARY KEY, pedido_id TEXT, producto_id TEXT, q_solicitada_mil INTEGER, precio_neto_base_cent INTEGER);
      CREATE TABLE reserva (reserva_id TEXT PRIMARY KEY, pedido_linea_id TEXT, lote_id TEXT, ubicacion_id TEXT, q_mil INTEGER, estado TEXT, creada_en TEXT, command_id TEXT);
      CREATE TABLE comando (command_id TEXT PRIMARY KEY, tipo TEXT, aplicado_en TEXT, resultado TEXT);
      CREATE TABLE carga (carga_id TEXT PRIMARY KEY, file_hash TEXT, nombre_archivo TEXT, bytes INTEGER, registrado_en TEXT, resultado TEXT, dataset_id TEXT);
      CREATE TABLE auditoria (evento_id INTEGER PRIMARY KEY AUTOINCREMENT, registrado_en TEXT, perfil TEXT, accion TEXT, command_id TEXT, detalle TEXT);
      INSERT INTO producto VALUES ('P01','Saco','AA','unidad',25000,1); INSERT INTO ubicacion VALUES ('ALM-AQP','Almacén','ALMACEN',1),('TRANSITO','Tránsito','TRANSITO',1);
      INSERT INTO lote VALUES ('L1','P01','A','2026-01-01','2027-01-01','LIBERADO');
      INSERT INTO movimiento VALUES ('M1','L1',NULL,'ALM-AQP','APTO',40000,'2026-11-01','2026-11-01','SALDO_APERTURA','c');
      INSERT INTO pedido VALUES ('PED-1','C1','D1','2026-11-13','2026-11-18T08:00:00-05:00','2026-11-20T18:00:00-05:00',0,'CONFIRMADO');
      INSERT INTO pedido_linea VALUES ('PED-1-01','PED-1','P01',10000,9250);
      INSERT INTO reserva VALUES ('R1','PED-1-01','L1','ALM-AQP',10000,'ACTIVA','2026-11-13','c2');`);
    const r = Repo.iniciar(v1);
    expect(r.uno("SELECT valor FROM meta WHERE clave='schema_version'")!.valor).toBe('7');
    expect(r.uno("SELECT alias_legado FROM nodo WHERE nodo_id='ALM-AQP'")!.alias_legado).toBe('UB:ALM-AQP');
    expect(r.uno("SELECT alias_legado FROM nodo WHERE nodo_id='N-D1'")!.alias_legado).toBe('DE:D1');
    expect(D.existencias(r).find((e) => e.lote_id === 'L1')!.reservado_mil).toBe(10000);
    expect(JSON.parse(String(r.uno("SELECT valor FROM meta WHERE clave='pendientes_migracion'")!.valor)).some((p: { campo: string }) => p.campo === 'vol_cm3_por_unidad')).toBe(true);
    expect(() => Repo.iniciar(v1)).not.toThrow(); // idempotente: ya está en v2
  });
});

describe('AO — Multi-origen', () => {
  function pedidoP03(q: number, divididas: boolean, parcial = false) {
    return D.crearPedido(repo, PED, { cliente_id: 'CLI-001', destino_id: 'DES-001', fecha_pedido: '2026-11-13', ventana_inicio: '2026-11-20T08:00:00-05:00', ventana_fin: '2026-11-21T18:00:00-05:00', prioridad: 'NORMAL', permite_parcial: parcial, permite_entregas_divididas: divididas, lineas: [{ producto_id: 'P03', presentacion_id: 'P03-U', cantidad_presentacion_mil: q * 1000, precio_neto_base_p4: 64000 }] });
  }
  const porNodo = () => Object.fromEntries(['ALM-AQP', 'ALM-JUL', 'ALM-CUS'].map((n) => [n, disp('P03', n)]));
  it('ESC-AO01 dos orígenes con entregas divididas: reservas trazables, demanda única', () => {
    const n = porNodo(); const q = n['ALM-AQP'] + 10;
    const id = pedidoP03(q, true); D.confirmarPedido(repo, PED, id);
    const r = D.reservarFefo(repo, ALM, id).resultado;
    expect(new Set(r.asignaciones.map((a) => a.nodo_id)).size).toBeGreaterThan(1);
    expect(r.asignaciones.reduce((a, x) => a + x.q_mil, 0)).toBe(q * 1000);
    expect(ped(id).lineas[0].solicitada_mil).toBe(q * 1000);
  });
  it('ESC-AO02 no se traslada stock virtualmente: solo se reserva donde hay existencia', () => {
    const id = pedidoP03(5, true); D.confirmarPedido(repo, PED, id);
    D.reservarFefo(repo, ALM, id, undefined, { soloNodo: 'ALM-JUL' });
    expect(ped(id).lineas[0].reservas.every((r) => r.nodo_id === 'ALM-JUL')).toBe(true);
    expect(repo.num("SELECT COUNT(*) FROM movimiento WHERE tipo LIKE 'TRASLADO%'")).toBe(0);
  });
  it('ESC-AO03 una partida por producto y código; duplicado en otro nodo se rechaza', () => {
    const t = tablasDemo(); t.find((x) => x.hoja === 'Lotes')!.filas.push(['L-P01-A2', 'P01', 'A', '2026-09-01', '2027-01-15', 'LIBERADO']);
    expect(validarConjunto(aHojas(t)).errores.some((e) => /ya está registrada como L-P01-A/.test(e.mensaje))).toBe(true);
  });
  it('ESC-AO04 presentaciones distintas se convierten a base antes de asignar', () => {
    const id = D.crearPedido(repo, PED, { cliente_id: 'CLI-001', destino_id: 'DES-001', fecha_pedido: '2026-11-13', ventana_inicio: '2026-11-20T08:00:00-05:00', ventana_fin: '2026-11-21T18:00:00-05:00', prioridad: 'NORMAL', permite_parcial: true, permite_entregas_divididas: true,
      lineas: [{ producto_id: 'P03', presentacion_id: 'P03-S25', cantidad_presentacion_mil: 2000, precio_neto_base_p4: 64000 }, { producto_id: 'P06', presentacion_id: 'P06-U', cantidad_presentacion_mil: 30000, precio_neto_base_p4: 50000 }] });
    expect(ped(id).lineas.map((l) => l.solicitada_mil)).toEqual([50000, 30000]);
  });
  it('ESC-AO05 cambiar el origen de la rama no ejecutada preserva lo demás', () => {
    const n = porNodo(); const id = pedidoP03(Math.min(n['ALM-JUL'], n['ALM-CUS']) - 1, false); D.confirmarPedido(repo, PED, id);
    D.reservarFefo(repo, ALM, id, undefined, { soloNodo: 'ALM-JUL' });
    D.reasignarOrigen(repo, ALM, id, 'ALM-JUL', 'ALM-CUS');
    expect(ped(id).lineas[0].reservas.every((r) => r.nodo_id === 'ALM-CUS')).toBe(true);
    expect(disp('P03', 'ALM-JUL')).toBe(n['ALM-JUL']);
  });
  it('ESC-AO06 sin entregas divididas y ningún almacén cubre: inviable aunque el total alcance', () => {
    const n = porNodo(); const q = Math.max(...Object.values(n)) + 1;
    const id = pedidoP03(q, false); D.confirmarPedido(repo, PED, id);
    expect(() => D.reservarFefo(repo, ALM, id)).toThrow(/no admite entregas divididas/);
  });
  it('ESC-AO07 cancelar la contribución de un origen mantiene la otra', () => {
    const n = porNodo(); const id = pedidoP03(n['ALM-AQP'] + 10, true); D.confirmarPedido(repo, PED, id);
    const r = D.reservarFefo(repo, ALM, id).resultado; const otro = r.asignaciones.find((a) => a.nodo_id !== 'ALM-AQP')!.nodo_id;
    D.liberarReservas(repo, ALM, { pedido_id: id, nodo_id: 'ALM-AQP' });
    const l = ped(id).lineas[0];
    expect(l.reservas.every((x) => x.nodo_id === otro)).toBe(true);
    expect(l.pendiente_mil).toBe(n['ALM-AQP'] * 1000);
  });
  it('ESC-AO08 un traslado no se promete dos veces (origen y destino)', () => {
    const antes = disp('P01');
    D.trasladar(repo, ALM, { lote_id: 'L-P01-B', origen: 'ALM-AQP', destino: 'ALM-JUL', q_mil: 20000, fecha_prevista: '2026-11-15' });
    const serie = D.disponibilidadAFecha(repo, 'P01', null);
    expect(serie[0].acumulado_mil / 1000).toBe(antes - 20);
    expect(serie.at(-1)!.acumulado_mil / 1000).toBe(antes);
  });
});

describe('AP — Disponibilidad a fecha y propuestas', () => {
  function escenarioAP01() {
    // Producto PX: hoy 100, entran 80 el día 2 (CONFIRMADO), 120 ya prometidos para el día 3.
    D.guardarMaestro(repo, DATOS, 'producto', producto('PX', { unidad_base: 'kg', peso_kg_por_unidad_mil: 1000, vol_cm3_por_unidad: 1500, fraccionable: 1 }), 'alta');
    D.guardarMaestro(repo, DATOS, 'presentacion', { presentacion_id: 'PX-U', producto_id: 'PX', nombre: 'kg', factor_base_mil: 1000, activo: 1 }, 'alta');
    D.guardarMaestro(repo, DATOS, 'lote', { lote_id: 'L-PX', producto_id: 'PX', codigo_lote: 'PX1', fecha_fabricacion: '2026-11-01', fecha_vencimiento: '2027-11-01', estado_lote: 'LIBERADO' }, 'alta');
    repo.run("INSERT INTO movimiento VALUES ('MX','L-PX',NULL,'ALM-AQP','APTO',100000,?,?,'SALDO_APERTURA',NULL,NULL,'U01','c')", [T0, T0]);
    D.registrarSuministro(repo, PLAN, { producto_id: 'PX', nodo_destino_id: 'ALM-AQP', q_mil: 80000, fecha_prevista: '2026-11-15', estado: 'CONFIRMADO' });
    const otro = D.crearPedido(repo, PED, { cliente_id: 'CLI-002', destino_id: 'DES-002', fecha_pedido: '2026-11-13', ventana_inicio: '2026-11-16T08:00:00-05:00', ventana_fin: '2026-11-16T18:00:00-05:00', prioridad: 'NORMAL', permite_parcial: false, permite_entregas_divididas: true, lineas: [{ producto_id: 'PX', presentacion_id: 'PX-U', cantidad_presentacion_mil: 120000, precio_neto_base_p4: 1 }] });
    repo.run("INSERT INTO compromiso_futuro VALUES ('CF1', ?, 'PX', 'ALM-AQP', NULL, NULL, 120000, '2026-11-16', 'FIRME', 'ACTIVO', ?, NULL)", [otro + '-01', T0]);
  }
  it('ESC-AP01 se protege la promesa posterior: solo 60 prometibles hoy', () => {
    escenarioAP01();
    const s = D.disponibilidadAFecha(repo, 'PX', null);
    expect(s[0].prometible_mil).toBe(60000);
    expect(s[0].acumulado_mil).toBe(100000);
  });
  it('ESC-AP02 suministro no confirmado no respalda oferta firme', () => {
    escenarioAP01();
    D.registrarSuministro(repo, PLAN, { producto_id: 'PX', nodo_destino_id: 'ALM-AQP', q_mil: 50000, fecha_prevista: '2026-11-14', estado: 'NO_CONFIRMADO' });
    expect(D.disponibilidadAFecha(repo, 'PX', null).find((p) => p.fecha === '2026-11-14')).toBeUndefined();
    expect(D.disponibilidadAFecha(repo, 'PX', null, { incluirNoConfirmados: true }).find((p) => p.fecha === '2026-11-14')!.acumulado_mil).toBe(150000);
  });
  it('ESC-AP03 dos pedidos no pueden prometer la misma entrada futura', () => {
    D.registrarSuministro(repo, PLAN, { producto_id: 'P02', nodo_destino_id: 'ALM-AQP', q_mil: 50000, fecha_prevista: '2026-11-16', estado: 'CONFIRMADO' });
    const mk = () => { const id = D.crearPedido(repo, PED, { cliente_id: 'CLI-001', destino_id: 'DES-001', fecha_pedido: '2026-11-13', ventana_inicio: '2026-11-20T08:00:00-05:00', ventana_fin: '2026-11-25T18:00:00-05:00', prioridad: 'NORMAL', permite_parcial: false, permite_entregas_divididas: true, lineas: [{ producto_id: 'P02', presentacion_id: 'P02-U', cantidad_presentacion_mil: 150000, precio_neto_base_p4: 1 }] }); D.confirmarPedido(repo, PED, id); return id; };
    const a = mk(), b = mk();
    expect(D.proponerFecha(repo, PED, a).fecha).toBe('2026-11-16');
    expect(() => D.proponerFecha(repo, PED, b)).toThrow(/No existe disponibilidad/);
  });
  it('ESC-AP04 retraso del suministro invalida la propuesta sin cambiar la ventana original', () => {
    const sid = D.registrarSuministro(repo, PLAN, { producto_id: 'P02', nodo_destino_id: 'ALM-AQP', q_mil: 50000, fecha_prevista: '2026-11-16', estado: 'CONFIRMADO' });
    const id = D.crearPedido(repo, PED, { cliente_id: 'CLI-001', destino_id: 'DES-001', fecha_pedido: '2026-11-13', ventana_inicio: '2026-11-20T08:00:00-05:00', ventana_fin: '2026-11-25T18:00:00-05:00', prioridad: 'NORMAL', permite_parcial: false, permite_entregas_divididas: true, lineas: [{ producto_id: 'P02', presentacion_id: 'P02-U', cantidad_presentacion_mil: 150000, precio_neto_base_p4: 1 }] });
    D.confirmarPedido(repo, PED, id);
    D.proponerFecha(repo, PED, id);
    expect(D.actualizarSuministro(repo, PLAN, sid, 'RETRASADO', '2026-11-28').pedidosAfectados).toEqual([id]);
    expect(repo.uno('SELECT estado FROM propuesta_entrega WHERE pedido_id = ?', [id])!.estado).toBe('INVALIDADA');
    expect(ped(id).ventana_fin).toBe('2026-11-25T18:00:00-05:00');
  });
  it('ESC-AP05 vigencia [inicio, vencimiento): 29:59 acepta, 30:00 vence', () => {
    D.confirmarPedido(repo, PED, 'PED-0004');
    const p1 = D.proponerFecha(repo, PED, 'PED-0004');
    expect(D.aceptarPropuesta(repo, PED, p1.propuesta_id, '2026-11-13T12:29:59-05:00').aceptada).toBe(true);
    const id2 = D.crearPedido(repo, PED, { cliente_id: 'CLI-005', destino_id: 'DES-005', fecha_pedido: '2026-11-13', ventana_inicio: '2026-11-20T08:00:00-05:00', ventana_fin: '2026-11-25T18:00:00-05:00', prioridad: 'NORMAL', permite_parcial: false, permite_entregas_divididas: true, lineas: [{ producto_id: 'P03', presentacion_id: 'P03-U', cantidad_presentacion_mil: 1000, precio_neto_base_p4: 1 }] });
    D.confirmarPedido(repo, PED, id2);
    const p2 = D.proponerFecha(repo, PED, id2);
    expect(D.aceptarPropuesta(repo, PED, p2.propuesta_id, '2026-11-13T12:30:00-05:00').aceptada).toBe(false);
  });
  it('ESC-AP06 al vencer se libera el compromiso temporal una sola vez, sin ingreso físico', () => {
    D.confirmarPedido(repo, PED, 'PED-0004');
    const p = D.proponerFecha(repo, PED, 'PED-0004');
    const m = repo.num('SELECT COUNT(*) FROM movimiento');
    expect(D.expirarPropuestas(repo, '2026-11-13T13:00:00-05:00')).toBe(1);
    expect(D.expirarPropuestas(repo, '2026-11-13T14:00:00-05:00')).toBe(0);
    expect(repo.uno('SELECT estado FROM compromiso_futuro WHERE propuesta_id = ?', [p.propuesta_id])!.estado).toBe('LIBERADO');
    expect(repo.num('SELECT COUNT(*) FROM movimiento')).toBe(m);
  });
  it('ESC-AP07 una cancelación muestra fecha más temprana sin cambiar la aceptada', () => {
    D.registrarSuministro(repo, PLAN, { producto_id: 'P02', nodo_destino_id: 'ALM-AQP', q_mil: 50000, fecha_prevista: '2026-11-18', estado: 'CONFIRMADO' });
    const mk = (q: number) => { const id = D.crearPedido(repo, PED, { cliente_id: 'CLI-001', destino_id: 'DES-001', fecha_pedido: '2026-11-13', ventana_inicio: '2026-11-20T08:00:00-05:00', ventana_fin: '2026-11-25T18:00:00-05:00', prioridad: 'NORMAL', permite_parcial: false, permite_entregas_divididas: true, lineas: [{ producto_id: 'P02', presentacion_id: 'P02-U', cantidad_presentacion_mil: q, precio_neto_base_p4: 1 }] }); D.confirmarPedido(repo, PED, id); return id; };
    const a = mk(100000); const pa = D.proponerFecha(repo, PED, a); D.aceptarPropuesta(repo, PED, pa.propuesta_id);
    const b = mk(60000); const pb = D.proponerFecha(repo, PED, b); D.aceptarPropuesta(repo, PED, pb.propuesta_id);
    expect(pb.fecha).toBe('2026-11-18');
    D.cancelarPedido(repo, PED, a, 'Cliente desiste');
    expect(D.alternativasMasTempranas(repo)).toEqual([{ pedido_id: b, fecha_aceptada: '2026-11-18', fecha_posible: '2026-11-13' }]);
    expect(repo.uno('SELECT fecha_propuesta FROM propuesta_entrega WHERE propuesta_id = ?', [pb.propuesta_id])!.fecha_propuesta).toBe('2026-11-18');
  });
  it('ESC-AP08 plazo fijo y promesa factible se muestran por separado', () => {
    D.registrarSuministro(repo, PLAN, { producto_id: 'P02', nodo_destino_id: 'ALM-AQP', q_mil: 50000, fecha_prevista: '2026-11-20', estado: 'CONFIRMADO' });
    const id = D.crearPedido(repo, PED, { cliente_id: 'CLI-001', destino_id: 'DES-001', fecha_pedido: '2026-11-13', ventana_inicio: '2026-11-14T08:00:00-05:00', ventana_fin: '2026-11-16T18:00:00-05:00', prioridad: 'NORMAL', permite_parcial: false, permite_entregas_divididas: true, lineas: [{ producto_id: 'P02', presentacion_id: 'P02-U', cantidad_presentacion_mil: 150000, precio_neto_base_p4: 1 }] });
    D.confirmarPedido(repo, PED, id);
    const p = D.proponerFecha(repo, PED, id);
    expect([p.estimacion_plazo_fijo, p.fecha, p.dentro_de_ventana]).toEqual(['2026-11-16', '2026-11-20', false]);
  });
});

describe('AQ — Precisión', () => {
  it('ESC-AQ01 una tonelada se convierte con factor declarado', () => {
    const id = D.crearPedido(repo, PED, { cliente_id: 'CLI-001', destino_id: 'DES-001', fecha_pedido: '2026-11-13', ventana_inicio: '2026-11-20T08:00:00-05:00', ventana_fin: '2026-11-21T18:00:00-05:00', prioridad: 'NORMAL', permite_parcial: false, permite_entregas_divididas: false, lineas: [{ producto_id: 'P03', presentacion_id: 'P03-T', cantidad_presentacion_mil: 1000, precio_neto_base_p4: 1 }] });
    const l = repo.uno('SELECT * FROM pedido_linea WHERE pedido_id = ?', [id])!;
    expect([l.q_solicitada_mil, l.factor_snapshot_mil, l.presentacion_id]).toEqual([1000000, 1000000, 'P03-T']);
  });
  it('ESC-AQ02 1,000 kg en tres porciones: 0,333 + 0,333 + 0,334', () => { expect(D.repartir(1000, 3)).toEqual([333, 333, 334]); });
  it('ESC-AQ08 desborde o exceso de decimales se rechaza antes de confirmar', () => {
    expect(() => D.multMil(Number.MAX_SAFE_INTEGER, 2000)).toThrow(/rango/);
    expect(() => D.multMil(1, 1)).toThrow(/3 decimales/);
  });
});

describe('AT — Territorio', () => {
  it('ESC-AT01 homónimos en regiones distintas son destinos distintos', () => {
    const d = repo.uno("SELECT * FROM destino WHERE destino_id='DES-001'")!;
    D.guardarMaestro(repo, DATOS, 'destino', { ...d, destino_id: 'DES-H1', region: 'Puno', codigo_territorial: '09-999' }, 'alta');
    expect(repo.num("SELECT COUNT(*) FROM destino WHERE nombre_ficticio = ?", [d.nombre_ficticio])).toBe(2);
  });
  it('ESC-AT02 código con ceros iniciales se conserva como texto', async () => {
    expect(repo.uno("SELECT codigo_territorial c FROM destino WHERE destino_id='DES-001'")!.c).toBe('02-101');
    const r = await libro((wb) => { wb.getWorksheet('Destinos')!.getCell('E2').value = 2101; });
    expect(r.errores.some((e) => e.celda === 'E2' && /como texto/.test(e.mensaje))).toBe(true);
  });
  it('ESC-AT03 catálogo y versión se guardan; código sin catálogo se rechaza', () => {
    const d = repo.uno("SELECT * FROM destino WHERE destino_id='DES-001'")!;
    expect([d.catalogo_territorial, d.version_catalogo]).toEqual(['CAT-FICTICIO-NUTRIDEMO', '2026.1']);
    expect(() => D.guardarMaestro(repo, DATOS, 'destino', { ...d, catalogo_territorial: null }, 'edicion')).toThrow(/catálogo/);
  });
  it('ESC-AT04 con límites confiables cargados se marca la inconsistencia sin corregir', () => {
    repo.run("INSERT INTO limite_region VALUES ('Arequipa', -17.5, -14.5, -75.5, -70.5, 'Fixture de prueba')");
    repo.run("UPDATE destino SET region='Arequipa', latitud=-12.05, longitud=-77.04 WHERE destino_id='DES-001'");
    const v = D.verificacionTerritorial(repo, 'DES-001');
    expect(v.estado).toBe('INCONSISTENTE');
    expect(repo.uno("SELECT region FROM destino WHERE destino_id='DES-001'")!.region).toBe('Arequipa');
  });
  it('ESC-AT05 latitud fuera de rango (intercambio) se detecta', () => {
    const d = repo.uno("SELECT * FROM destino WHERE destino_id='DES-001'")!;
    expect(() => D.guardarMaestro(repo, DATOS, 'destino', { ...d, latitud: -100.5, longitud: -16.4 }, 'edicion')).toThrow(/Intercambió/);
    expect(D.verificacionTerritorial(repo, 'DES-002').estado).toBe('PENDIENTE');
  });
  it('ESC-AT06 centroide se identifica como aproximado', () => {
    const c = repo.uno("SELECT destino_id FROM destino WHERE precision_geografica='CENTROIDE' LIMIT 1")!;
    expect(D.verificacionTerritorial(repo, String(c.destino_id)).detalle).toMatch(/centroide/);
  });
  it('ESC-AT07 cambio administrativo de código conserva identidad y alias', () => {
    D.cambiarCodigoTerritorial(repo, DATOS, 'DES-001', '02-555', 'CAT-FICTICIO-NUTRIDEMO', '2026.2', 'Recodificación del catálogo');
    expect(repo.uno("SELECT codigo_anterior FROM destino_alias WHERE destino_id='DES-001'")!.codigo_anterior).toBe('02-101');
    expect(repo.num("SELECT COUNT(*) FROM destino WHERE cliente_id='CLI-001'")).toBe(1);
  });
});

describe('BG — Roles y relevo', () => {
  it('ESC-BG01 al desactivar se revoca y se reasignan pendientes, sin perder autoría', () => {
    const autoria = repo.num("SELECT COUNT(*) FROM auditoria WHERE usuario_id='U02'");
    expect(D.pedidosSinResponsable(repo).length).toBe(D.pedidos(repo).filter((p) => p.estado !== 'Borrador' && p.estado !== 'Cancelado' && !p.responsable_id).length);
    const r = P.desactivarUsuario(repo, DATOS, 'U02', 'Sale de la organización', 'U08');
    expect(r.pedidosReasignados).toBeGreaterThan(0);
    expect(() => D.confirmarPedido(repo, 'U02', 'PED-0004')).toThrow(/desactivado/);
    expect(repo.num("SELECT COUNT(*) FROM auditoria WHERE usuario_id='U02'")).toBe(autoria);
  });
  it('ESC-BG02 el permiso se revalida al confirmar el comando', () => {
    const as = repo.uno("SELECT asignacion_id FROM rol_asignacion WHERE usuario_id='U03' AND rol='ENCARGADO_ALMACEN'")!;
    P.revocarRol(repo, DATOS, String(as.asignacion_id), T0);
    expect(() => D.reservarFefo(repo, ALM, 'PED-0001')).toThrow(/no permite esta acción/);
  });
  it('ESC-BG03 pedidos sin responsable vigente aparecen en la cola', () => {
    P.desactivarUsuario(repo, DATOS, 'U02', 'Vacaciones prolongadas', null);
    expect(D.pedidosSinResponsable(repo).some((p) => p.pedido_id === 'PED-0001')).toBe(true);
  });
  it('ESC-BG04 quien solicita un ajuste no puede aprobarlo', () => {
    P.otorgarRol(repo, DATOS, 'U03', 'SUPERVISOR', '2026-01-01T00:00:00-05:00', null);
    const id = D.solicitarAjuste(repo, ALM, { lote_id: 'L-P01-A', nodo_id: 'ALM-AQP', condicion: 'APTO', q_delta_mil: 1000, motivo: 'Sobrante en conteo' });
    expect(() => D.resolverAjuste(repo, ALM, id, true, 'ok')).toThrow(/doble revisión/);
  });
  it('ESC-BG05 permiso temporal [inicio, fin) caduca aunque la sesión siga', () => {
    P.otorgarRol(repo, DATOS, ANA, 'ENCARGADO_ALMACEN', '2026-11-13T11:00:00-05:00', '2026-11-13T12:00:00-05:00');
    expect(() => D.reservarFefo(repo, ANA, 'PED-0001')).toThrow(/no permite/);
    repo.reloj = () => '2026-11-13T11:59:59-05:00';
    expect(D.reservarFefo(repo, ANA, 'PED-0001').resultado.asignaciones.length).toBe(2);
  });
  it('ESC-BG06 usuario desactivado conserva su historia y no se atribuye a otro', () => {
    D.reservarFefo(repo, ALM, 'PED-0001');
    P.desactivarUsuario(repo, DATOS, 'U03', 'Baja definitiva', null);
    expect(repo.num("SELECT COUNT(*) FROM auditoria WHERE usuario_id='U03' AND accion='RESERVAR_FEFO'")).toBe(1);
    expect(repo.uno("SELECT activo FROM usuario WHERE usuario_id='U03'")!.activo).toBe(0);
  });
  it('ESC-BG07 cuenta compartida no puede ejecutar acciones sensibles', () => { expect(() => D.confirmarPedido(repo, 'U08', 'PED-0004')).toThrow(/compartida/); });
  it('ESC-BG08 soporte ve diagnóstico sin datos comerciales ni permisos de negocio', () => {
    const d = D.diagnostico(repo);
    expect(Object.keys(d)).toEqual(['schema', 'migraciones', 'conteos', 'integridad']);
    expect(P.puede(repo, 'U07', 'VER_NEGOCIO')).toBe(false);
  });
  it('ESC-BG10 no se puede quedar sin administrador', () => {
    const as = repo.uno("SELECT asignacion_id FROM rol_asignacion WHERE usuario_id='U01' AND rol='ADMINISTRADOR'")!;
    expect(() => P.revocarRol(repo, DATOS, String(as.asignacion_id), T0)).toThrow(/Administración/);
  });
});
