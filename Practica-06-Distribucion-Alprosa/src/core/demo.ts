// Conjunto de demostración NutriDemo (DATOS SINTÉTICOS) generado de forma determinista (semilla 2026, generador §9).
// Pasa por la MISMA validación que un Excel importado. No contiene cifras reales de Alprosa.
import type { HojaCruda, Celda } from './contrato';

export const DATASET_DEMO_ID = 'NUTRIDEMO-I06-v6';
export const SEMILLA_DEMO = 2026;

/** Generador congruencial del contrato §9: estado = (1664525·estado + 1013904223) mod 2^32; u = (estado + 0,5) / 2^32. */
export function generador(semilla: number) {
  let estado = semilla >>> 0;
  return () => { estado = (Math.imul(1664525, estado) + 1013904223) >>> 0; return (estado + 0.5) / 4294967296; };
}

export type Tabla = { hoja: string; cols: string[]; filas: Celda[][] };

export function tablasDemo(): Tabla[] {
  const u = generador(SEMILLA_DEMO);
  const ent = (a: number, b: number) => a + Math.floor(u() * (b - a + 1));
  const T = (hoja: string, cols: string, filas: Celda[][]): Tabla => ({ hoja, cols: cols.split(','), filas });

  const productos: Celda[][] = [
    ['P01', 'Alimento balanceado aves — saco 25 kg', 'Alimento animal', 'unidad', 25, 0.04, false, true],
    ['P02', 'Alimento para perros adulto — saco 15 kg', 'Mascotas', 'unidad', 15, 0.025, false, true],
    ['P03', 'Mezcla nutricional andina — granel', 'Alimentación humana', 'kg', 1, 0.0016, true, true],
    ['P04', 'Alimento balanceado porcinos — saco 40 kg', 'Alimento animal', 'unidad', 40, 0.06, false, true],
    ['P05', 'Alimento para gatos — bolsa 3 kg', 'Mascotas', 'unidad', 3, 0.006, false, true],
    ['P06', 'Concentrado lechero — granel', 'Alimento animal', 'kg', 1, 0.0018, true, true],
    ['P07', 'Bebida nutricional en polvo — caja 12 u', 'Alimentación humana', 'unidad', 6, 0.012, false, true],
    ['P08', 'Alimento para cuyes — saco 30 kg', 'Alimento animal', 'unidad', 30, 0.045, false, true],
    ['P09', 'Cereal andino instantáneo — granel', 'Alimentación humana', 'kg', 1, 0.0022, true, true],
    ['P10', 'Suplemento mineral — balde 20 kg', 'Alimento animal', 'unidad', 20, 0.025, false, false],
  ];
  const conversiones: Celda[][] = [];
  for (const p of productos) {
    conversiones.push([`${p[0]}-U`, p[0], p[3] === 'kg' ? 'Kilogramo' : 'Unidad', 1, true]);
    if (p[3] === 'kg') { conversiones.push([`${p[0]}-S25`, p[0], 'Saco 25 kg', 25, true], [`${p[0]}-T`, p[0], 'Tonelada', 1000, true]); }
    else conversiones.push([`${p[0]}-C10`, p[0], 'Paquete de 10', 10, true]);
  }
  const regiones = ['Arequipa', 'Puno', 'Cusco', 'Madre de Dios', 'Apurímac', 'Ayacucho', 'Moquegua', 'Tacna', 'Ica', 'Lima'];
  const nodos: Celda[][] = [
    ['ALM-AQP', 'Almacén principal Arequipa (demostrativo)', 'ALMACEN', 'Arequipa', 800000, true, true, 'SINTETICO'],
    ['ALM-JUL', 'Almacén de apoyo Juliaca (demostrativo)', 'ALMACEN', 'Puno', 200000, true, true, 'SINTETICO'],
    ['ALM-CUS', 'Almacén de apoyo Cusco (demostrativo)', 'ALMACEN', 'Cusco', 150000, true, true, 'SINTETICO'],
    ['TRANSITO', 'En tránsito', 'TRANSITO', '—', null, true, true, 'SINTETICO'],
    ['TB-PUNO', 'Embarcadero lacustre Puno (demostrativo)', 'TRANSBORDO', 'Puno', 20000, false, true, 'SINTETICO'],
    ['TB-FLUV', 'Embarcadero fluvial selva (demostrativo)', 'TRANSBORDO', 'Madre de Dios', 15000, true, true, 'SINTETICO'],
    ['TB-SIERRA', 'Fin de carretera altoandina (demostrativo)', 'TRANSBORDO', 'Cusco', 5000, true, true, 'SINTETICO'],
  ];
  const coords: Record<string, [number, number]> = { Arequipa: [-16.40, -71.54], Puno: [-15.84, -70.02], Cusco: [-13.53, -71.97], 'Madre de Dios': [-12.59, -69.19], 'Apurímac': [-13.64, -72.88],
    Ayacucho: [-13.16, -74.22], Moquegua: [-17.19, -70.93], Tacna: [-18.01, -70.25], Ica: [-14.07, -75.73], Lima: [-12.05, -77.04] };
  const clientes: Celda[][] = [], destinos: Celda[][] = [];
  for (let i = 1; i <= 20; i++) {
    const cid = `CLI-${String(i).padStart(3, '0')}`;
    clientes.push([cid, `Distribuidora ficticia ${i}`, true]);
    const remotos: Record<number, string> = { 5: 'Puno', 10: 'Madre de Dios', 15: 'Cusco', 20: 'Madre de Dios' };
    const reg = remotos[i] ?? regiones[(i - 1) % regiones.length];
    const [la, lo] = coords[reg];
    const did = `DES-${String(i).padStart(3, '0')}`;
    const remoto = i % 5 === 0;
    nodos.push([`N-${did}`, `Punto de entrega ${did}`, 'DESTINO', reg, null, false, true, 'SINTETICO']);
    destinos.push([did, cid, `${remoto ? ({ 5: 'Isla lacustre', 10: 'Comunidad ribereña', 15: 'Comunidad altoandina', 20: 'Comunidad ribereña alta' } as Record<number, string>)[i] : 'Local'} ficticio ${i} — ${reg}`, reg, `0${(i % 9) + 1}-${String(100 + i)}`, 'CAT-FICTICIO-NUTRIDEMO', '2026.1',
      remoto ? la : Math.round((la + (u() - 0.5) * 0.2) * 1e4) / 1e4, remoto ? lo : Math.round((lo + (u() - 0.5) * 0.2) * 1e4) / 1e4,
      remoto ? 'CENTROIDE' : i % 3 === 0 ? 'CENTROIDE' : 'APROXIMADA', `N-${did}`, i % 4 === 0, i % 6 === 0 ? 30 : 0, true]);
  }
  // Lotes: los de P01 y P02 reproducen los casos numéricos de referencia (§14 #2 y #3).
  const lotes: Celda[][] = [
    ['L-P01-A', 'P01', 'A', '2026-09-01', '2027-01-15', 'LIBERADO'], ['L-P01-B', 'P01', 'B', '2026-10-01', '2027-03-30', 'LIBERADO'], ['L-P01-V', 'P01', 'V', '2026-05-01', '2026-11-10', 'LIBERADO'],
    ['L-P02-C', 'P02', 'C', '2026-08-15', '2027-02-28', 'LIBERADO'], ['L-P02-X', 'P02', 'X', '2026-08-20', '2027-04-30', 'BLOQUEADO'],
  ];
  const movs: Celda[][] = [
    ['MI-001', 'L-P01-A', 'ALM-AQP', 40, '2026-11-01', 'APTO'], ['MI-002', 'L-P01-B', 'ALM-AQP', 80, '2026-11-01', 'APTO'], ['MI-003', 'L-P01-V', 'ALM-AQP', 30, '2026-11-01', 'APTO'],
    ['MI-004', 'L-P02-C', 'ALM-AQP', 120, '2026-11-01', 'APTO'], ['MI-005', 'L-P02-X', 'ALM-AQP', 50, '2026-11-01', 'APTO'],
  ];
  let m = 6;
  for (const p of productos.slice(2)) {
    const pid = String(p[0]);
    for (const [k, alm] of [['1', 'ALM-AQP'], ['2', 'ALM-JUL'], ['3', 'ALM-CUS']] as const) {
      const fab = `2026-${String(ent(6, 10)).padStart(2, '0')}-${String(ent(1, 28)).padStart(2, '0')}`;
      const ven = `2027-${String(ent(1, 12)).padStart(2, '0')}-${String(ent(1, 28)).padStart(2, '0')}`;
      const lid = `L-${pid}-${k}`;
      lotes.push([lid, pid, `${pid}-26${k}`, fab, ven, 'LIBERADO']);
      const q = p[3] === 'kg' ? ent(5, 40) * 100 : ent(20, 200);
      movs.push([`MI-${String(m++).padStart(3, '0')}`, lid, alm, q, '2026-11-01', 'APTO']);
    }
  }
  movs.push([`MI-${String(m++).padStart(3, '0')}`, 'L-P03-1', 'ALM-AQP', 25.5, '2026-11-01', 'CUARENTENA']);
  const usuarios: Celda[][] = [
    ['U01', 'Ana (Datos y administración)', true, false], ['U02', 'Bruno (Pedidos)', true, false], ['U03', 'Carla (Almacén)', true, false], ['U04', 'Diego (Planificación)', true, false],
    ['U05', 'Elena (Supervisión)', true, false], ['U06', 'Fabio (Análisis)', true, false], ['U07', 'Soporte técnico', true, false], ['U08', 'Cuenta compartida de mostrador', true, true],
  ];
  const D = '2026-01-01T00:00';
  const roles: Celda[][] = [
    ['U01', 'RESPONSABLE_DATOS', D, null], ['U01', 'ADMINISTRADOR', D, null], ['U02', 'ENCARGADO_PEDIDOS', D, null], ['U03', 'ENCARGADO_ALMACEN', D, null],
    ['U04', 'PLANIFICADOR', D, null], ['U05', 'SUPERVISOR', D, null], ['U06', 'ANALISTA', D, null], ['U07', 'SOPORTE', D, null], ['U08', 'ENCARGADO_PEDIDOS', D, null],
  ];
  const pedidos: Celda[][] = [
    ['PED-0001', 'CLI-001', 'DES-001', '2026-11-13', '2026-11-18T08:00', '2026-11-20T18:00', 'NORMAL', false, false, 'CONFIRMADO', 'U02'],
    ['PED-0002', 'CLI-002', 'DES-002', '2026-11-13', '2026-11-19T08:00', '2026-11-21T18:00', 'NORMAL', false, false, 'CONFIRMADO', 'U02'],
    ['PED-0003', 'CLI-003', 'DES-003', '2026-11-13', '2026-11-19T08:00', '2026-11-22T18:00', 'NORMAL', true, true, 'CONFIRMADO', 'U02'],
    ['PED-0004', 'CLI-004', 'DES-004', '2026-11-13', '2026-11-20T08:00', '2026-11-25T18:00', 'NORMAL', false, false, 'BORRADOR', 'U02'],
  ];
  const detalle: Celda[][] = [
    ['PED-0001-01', 'PED-0001', 'P01', 'P01-U', 50, 92.5], ['PED-0002-01', 'PED-0002', 'P02', 'P02-U', 121, 78.9],
    ['PED-0003-01', 'PED-0003', 'P02', 'P02-U', 121, 78.9], ['PED-0003-02', 'PED-0003', 'P03', 'P03-U', 200.25, 6.4], ['PED-0004-01', 'PED-0004', 'P03', 'P03-S25', 10, 6.4],
  ];
  for (let i = 5; i <= 40; i++) {
    const c = ent(1, 20), pid = `PED-${String(i).padStart(4, '0')}`;
    const dia = ent(14, 30), dur = ent(1, 4);
    pedidos.push([pid, `CLI-${String(c).padStart(3, '0')}`, `DES-${String(c).padStart(3, '0')}`, '2026-11-13', `2026-11-${String(dia).padStart(2, '0')}T08:00`,
      `2026-${dia + dur > 30 ? '12' : '11'}-${String(dia + dur > 30 ? dia + dur - 30 : dia + dur).padStart(2, '0')}T18:00`,
      u() < 0.15 ? 'URGENTE' : 'NORMAL', u() < 0.5, u() < 0.4, u() < 0.85 ? 'CONFIRMADO' : 'BORRADOR', u() < 0.9 ? 'U02' : null]);
    const nl = ent(1, 3);
    const usados = new Set<number>();
    for (let k = 1; k <= nl; k++) {
      let pi = ent(3, 9); while (usados.has(pi)) pi = pi === 9 ? 3 : pi + 1; usados.add(pi);
      const p = productos[pi - 1];
      const granel = p[3] === 'kg';
      const pres = granel ? (u() < 0.5 ? `${p[0]}-S25` : `${p[0]}-U`) : `${p[0]}-U`;
      const cant = granel ? (pres.endsWith('S25') ? ent(2, 20) : ent(50, 600)) : ent(5, 60);
      detalle.push([`${pid}-${String(k).padStart(2, '0')}`, pid, p[0], pres, cant, Math.round((granel ? 4 + u() * 6 : 30 + u() * 120) * 10000) / 10000]);
    }
  }
  const suministros: Celda[][] = [
    ['SUM-001', 'P04', null, 'ALM-AQP', 80, '2026-11-16', 'CONFIRMADO'], ['SUM-002', 'P05', null, 'ALM-AQP', 120, '2026-11-18', 'CONFIRMADO'],
    ['SUM-003', 'P06', null, 'ALM-JUL', 1500, '2026-11-20', 'NO_CONFIRMADO'],
  ];

  // ------------------------------------------------------------ Red multimodal demostrativa (I04). Tiempos, capacidades y tarifas SINTÉTICOS.
  const modos: Celda[][] = [['VIAL', 'Camión', true, false], ['VIAL_LIGERO', 'Camioneta', true, false], ['LACUSTRE', 'Lancha lacustre', true, true], ['FLUVIAL', 'Embarcación fluvial', true, true],
    ['ANIMAL', 'Recua de carga', true, true], ['PEATONAL', 'Porteadores', true, true], ['AEREO', 'Avioneta (contingencia)', true, true]];
  const capModo: Record<string, [number, number, number | null, number, number]> = { // kg, dm3, máx bulto kg, tarifa fija S/, S/ por kg
    VIAL: [10000, 40000, null, 500, 0.05], VIAL_LIGERO: [1500, 6000, null, 150, 0.08], LACUSTRE: [1200, 5000, 50, 300, 0.10], FLUVIAL: [3000, 12000, 50, 300, 0.10],
    ANIMAL: [120, 600, 40, 60, 0], PEATONAL: [50, 250, 30, 40, 0], AEREO: [400, 2000, 50, 1500, 2] };
  const horas: Record<string, string[]> = { VIAL: ['06:00'], VIAL_LIGERO: ['07:00', '15:00'], LACUSTRE: ['09:00', '14:00'], FLUVIAL: ['10:30', '16:00'], ANIMAL: ['07:00'], PEATONAL: ['07:30'], AEREO: ['08:00'] };
  const enlaces: Celda[][] = [], recursos: Celda[][] = [], servicios: Celda[][] = [];
  const hReg: Record<string, number> = { Arequipa: 2, Puno: 6, Cusco: 10, 'Madre de Dios': 20, 'Apurímac': 12, Ayacucho: 14, Moquegua: 4, Tacna: 6, Ica: 10, Lima: 16 };
  const enl = (o: string, d: string, modo: string, h: number, km: number, estado = 'NORMAL', maxKg: number | null = null, prob = 0.05, retraso = 2) => {
    const id = `E-${o}-${d}-${modo}`;
    const m = Math.round(h * 60);
    enlaces.push([id, o, d, modo, km, h, Math.round(m * 0.9) / 60, h, Math.round(m * 1.4) / 60, prob, retraso, `COR-${o}-${d}`, estado, maxKg, 'Datos sintéticos de demostración', true]);
    const [kg, dm3, mb, fijo, var_] = capModo[modo];
    // Un recurso por franja horaria: un mismo vehículo/embarcación no puede estar en dos salidas que se solapan (E04/AC02)
    const ridDe = (k: number) => (horas[modo].length > 1 ? `R-${id.slice(2)}-${'ABCD'[k]}` : `R-${id.slice(2)}`);
    horas[modo].forEach((_, k) => recursos.push([ridDe(k), `${modos.find((x) => x[0] === modo)![1]} ${o}→${d}${horas[modo].length > 1 ? ' (salida ' + horas[modo][k] + ')' : ''}`, modo, `Operador ficticio ${modo.toLowerCase()}`, kg, dm3 / 1000, mb, true]));
    for (let dia = 14; dia <= 35; dia++) {
      const f = dia <= 30 ? `2026-11-${String(dia).padStart(2, '0')}` : `2026-12-${String(dia - 30).padStart(2, '0')}`;
      if (modo === 'AEREO' && ![1, 3, 5].includes(new Date(f + 'T12:00:00Z').getUTCDay())) continue;
      for (const [k, hh] of horas[modo].entries()) {
        const rid = ridDe(k);
        const sal = `${f}T${hh}`;
        const lleg = new Date(Date.parse(sal + ':00Z') + m * 60000).toISOString().slice(0, 16);
        servicios.push([`S-${id.slice(2)}-${f.slice(5).replace('-', '')}-${hh.replace(':', '')}`, id, rid, sal, lleg, fijo, var_, 'PROGRAMADO']);
      }
    }
  };
  for (const d of destinos) {
    const [did, , , reg] = d as [string, string, string, string];
    const n = Number(did.slice(4));
    if ([5, 10, 15, 20].includes(n)) continue;
    enl('ALM-AQP', `N-${did}`, 'VIAL', hReg[reg], hReg[reg] * 55);
    if (reg === 'Puno') enl('ALM-JUL', `N-${did}`, 'VIAL', 2, 90);
    if (reg === 'Cusco' || reg === 'Apurímac') enl('ALM-CUS', `N-${did}`, 'VIAL', reg === 'Cusco' ? 2 : 5, reg === 'Cusco' ? 60 : 200);
  }
  enl('ALM-AQP', 'ALM-JUL', 'VIAL', 5, 280); enl('ALM-JUL', 'ALM-AQP', 'VIAL', 5, 280);
  enl('ALM-AQP', 'ALM-CUS', 'VIAL', 10, 510); enl('ALM-CUS', 'ALM-AQP', 'VIAL', 10, 510);
  enl('ALM-JUL', 'ALM-CUS', 'VIAL', 7, 340); enl('ALM-CUS', 'ALM-JUL', 'VIAL', 7, 340);
  enl('ALM-JUL', 'TB-PUNO', 'VIAL_LIGERO', 1, 45); enl('ALM-AQP', 'TB-PUNO', 'VIAL', 6, 300);
  enl('TB-PUNO', 'N-DES-005', 'LACUSTRE', 3, 35);
  enl('ALM-CUS', 'TB-FLUV', 'VIAL', 10, 480); enl('TB-FLUV', 'N-DES-010', 'FLUVIAL', 6, 120);
  enl('TB-FLUV', 'N-DES-020', 'FLUVIAL', 8, 160, 'NORMAL');
  enl('ALM-AQP', 'TB-FLUV', 'AEREO', 2, 600, 'NORMAL', null, 0.1, 6);
  enl('ALM-CUS', 'TB-SIERRA', 'VIAL_LIGERO', 4, 110, 'NORMAL', 2000);
  enl('TB-SIERRA', 'N-DES-015', 'ANIMAL', 5, 18); enl('TB-SIERRA', 'N-DES-015', 'PEATONAL', 6, 15);
  const compat: Celda[][] = [['P07', 'ANIMAL', false, 'Requiere protección contra humedad no disponible en recua'], ['P05', 'AEREO', true, 'Permitido']];
  const receptores: Celda[][] = destinos.map((d) => [`RA-${d[0]}`, d[0], `Responsable de recepción ficticio ${String(d[0]).slice(4)}`, '2026-01-01T00:00', null]);
  const condiciones: Celda[][] = [['CA-001', 'E-TB-FLUV-N-DES-020-FLUVIAL', 'INTERRUMPIDO', 'Estiaje: bajo caudal impide la navegación (escenario sintético)', '2026-11-01T00:00', '2027-01-01T00:00', '2026-11-12T09:00', 'Reporte demostrativo — datos sintéticos']];
  pedidos.push(
    ['PED-0041', 'CLI-005', 'DES-005', '2026-11-13', '2026-11-17T08:00', '2026-11-28T18:00', 'NORMAL', false, false, 'CONFIRMADO', 'U02'],
    ['PED-0042', 'CLI-010', 'DES-010', '2026-11-13', '2026-11-18T08:00', '2026-11-29T18:00', 'NORMAL', false, true, 'CONFIRMADO', 'U02'],
    ['PED-0043', 'CLI-015', 'DES-015', '2026-11-13', '2026-11-18T08:00', '2026-11-30T18:00', 'URGENTE', false, false, 'CONFIRMADO', 'U02'],
    ['PED-0044', 'CLI-020', 'DES-020', '2026-11-13', '2026-11-18T08:00', '2026-11-30T18:00', 'NORMAL', false, true, 'CONFIRMADO', 'U02']);
  detalle.push(['PED-0041-01', 'PED-0041', 'P03', 'P03-U', 300, 6.4], ['PED-0042-01', 'PED-0042', 'P06', 'P06-U', 200, 5.2],
    ['PED-0043-01', 'PED-0043', 'P04', 'P04-U', 3, 120], ['PED-0044-01', 'PED-0044', 'P06', 'P06-U', 100, 5.2]);
  return [
    T('Usuarios', 'usuario_id,nombre_ficticio,activo,compartida', usuarios),
    T('RolesAsignados', 'usuario_id,rol,vigente_desde,vigente_hasta', roles),
    T('Productos', 'producto_id,nombre_generico,familia,unidad_base,peso_kg_por_unidad,volumen_m3_por_unidad,fraccionable,activo', productos),
    T('Conversiones', 'presentacion_id,producto_id,nombre,unidades_base_por_presentacion,activo', conversiones),
    T('Clientes', 'cliente_id,nombre_ficticio,activo', clientes),
    T('NodosLogisticos', 'nodo_id,nombre,tipo,region,capacidad_almacen_kg,permite_espera_nocturna,activo,fuente_dato,manipulacion_min', nodos.map((n) => [...n, n[2] === 'TRANSBORDO' ? 30 : 45])),
    T('Destinos', 'destino_id,cliente_id,nombre_ficticio,region,codigo_territorial,catalogo_territorial,version_catalogo,latitud,longitud,precision_geografica,nodo_id,acepta_anticipadas,vida_util_min_dias,activo', destinos),
    T('Lotes', 'lote_id,producto_id,codigo_lote,fecha_fabricacion,fecha_vencimiento,estado_lote', lotes),
    T('MovimientosIniciales', 'movimiento_id,lote_id,nodo_id,cantidad_base,fecha,condicion', movs),
    T('SuministrosEsperados', 'suministro_id,producto_id,lote_id,nodo_destino_id,cantidad_base,fecha_prevista,estado', suministros),
    T('Pedidos', 'pedido_id,cliente_id,destino_id,fecha_pedido,ventana_inicio,ventana_fin,prioridad,permite_parcial,permite_entregas_divididas,estado,responsable_id', pedidos),
    T('ModosTransporte', 'modo_id,nombre,activo,requiere_habilitacion', modos),
    T('Recursos', 'recurso_id,nombre,modo_id,operador,capacidad_kg,capacidad_m3,max_bulto_kg,activo', recursos),
    T('EnlacesMultimodales', 'enlace_id,nodo_origen_id,nodo_destino_id,modo_id,distancia_km,duracion_h,min_h,moda_h,max_h,prob_incidencia,retraso_incidencia_h,corredor_id,estado_acceso,max_kg_recurso,fuente_dato,activo', enlaces),
    T('ServiciosTransporte', 'servicio_id,enlace_id,recurso_id,salida,llegada,tarifa_fija,costo_por_kg,estado', servicios),
    T('Transbordos', 'regla_transbordo_id,nodo_id,modo_entrada_id,modo_salida_id,duracion_h,costo_fijo,costo_por_kg,fraccionamiento_permitido', [
      ['TR-PUNO', 'TB-PUNO', 'VIAL', 'LACUSTRE', 0.75, 25, 0.02, true], ['TR-PUNO-L', 'TB-PUNO', 'VIAL_LIGERO', 'LACUSTRE', 0.75, 25, 0.02, true],
      ['TR-FLUV', 'TB-FLUV', 'VIAL', 'FLUVIAL', 1, 30, 0.02, true], ['TR-FLUV-A', 'TB-FLUV', 'AEREO', 'FLUVIAL', 1, 30, 0.02, true],
      ['TR-SIER-A', 'TB-SIERRA', 'VIAL_LIGERO', 'ANIMAL', 1, 20, 0, true], ['TR-SIER-P', 'TB-SIERRA', 'VIAL_LIGERO', 'PEATONAL', 1, 20, 0, true]]),
    T('ActivosRetornables', 'activo_id,tipo,propietario,tara_kg,volumen_m3,nodo_id,condicion', [
      ...Array.from({ length: 6 }, (_, i) => [`CONT-${String(i + 1).padStart(3, '0')}`, 'Contenedor plástico 60 L', 'ALPROSA', 2.5, 0.07, 'ALM-AQP', 'DISPONIBLE']),
      ['PAL-001', 'Pallet de madera', 'ALPROSA', 18, 0.2, 'ALM-AQP', 'DISPONIBLE'], ['PAL-T01', 'Pallet de madera', 'Operador logístico ficticio', 18, 0.2, 'ALM-AQP', 'DISPONIBLE']]),
    T('Compatibilidades', 'producto_id,modo_id,permitido,motivo', compat),
    T('ReceptoresAutorizados', 'receptor_id,destino_id,nombre_ficticio,vigente_desde,vigente_hasta', receptores),
    T('CondicionesAcceso', 'condicion_id,enlace_id,estado,motivo,vigente_desde,vigente_hasta,registrado_en,fuente', condiciones),
    T('PedidoDetalle', 'pedido_linea_id,pedido_id,producto_id,presentacion_id,cantidad_presentacion,precio_neto_base', detalle),
  ];
}

const colLetra = (i: number) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
export function aHojas(tablas: Tabla[]): HojaCruda[] {
  return tablas.map((t) => ({ nombre: t.hoja, encabezados: t.cols,
    filas: t.filas.map((f, i) => ({ fila: i + 2, celdas: Object.fromEntries(t.cols.map((c, j) => [c, { valor: f[j] ?? null, ref: `${colLetra(j)}${i + 2}` }])) })) }));
}
export const hojasDemo = () => aHojas(tablasDemo());
export { colLetra };
