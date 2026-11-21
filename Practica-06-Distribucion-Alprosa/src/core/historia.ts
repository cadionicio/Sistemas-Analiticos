// I05: historia SINTÉTICA cerrada de 52 semanas (DEC-I01-D6) para analítica descriptiva, diagnóstica y predictiva.
// No representa datos reales de Alprosa. Determinista: mismo generador LCG del §9 con semilla propia.
import { FILAS_PARAMETROS, PARAMETROS_DEFECTO } from './simulacion';
import { SUPUESTOS_DEFECTO } from './economia';
import { generador, tablasDemo, type Tabla } from './demo';

export const SEMILLA_HISTORIA = 52026;
export const HISTORIA_INICIO = '2025-11-10'; // lunes
export const HISTORIA_SEMANAS = 52;
export const HISTORIA_CORTE = '2026-11-09T00:00:00-05:00'; // fin de la historia cerrada (corte de evaluación)

type Celda = string | number | boolean | null;
const REGIONES = ['Arequipa', 'Puno', 'Cusco', 'Madre de Dios', 'Apurímac', 'Ayacucho', 'Moquegua', 'Tacna', 'Ica', 'Lima'];
const REMOTOS: Record<number, string> = { 5: 'Puno', 10: 'Madre de Dios', 15: 'Cusco', 20: 'Madre de Dios' };
export const regionDestino = (i: number) => REMOTOS[i] ?? REGIONES[(i - 1) % REGIONES.length];
const PESO: Record<string, number> = { P01: 25, P02: 15, P03: 1, P04: 40, P05: 3, P06: 1, P07: 6, P08: 30, P09: 1, P10: 20 };
const GRANEL = new Set(['P03', 'P06', 'P09']);
const DIA = 86400000;
const iso = (ms: number) => new Date(ms - 5 * 3600000).toISOString().slice(0, 19) + '-05:00';
const ms = (s: string) => Date.parse(s.length === 10 ? s + 'T00:00:00-05:00' : s);
const r2 = (x: number) => Math.round(x * 1000) / 1000;

/** Rutas típicas por región: tramos con medio, capacidad (kg) y costo (S/ por kg + fijo). */
function ruta(region: string, remoto: boolean): { modo: string; o: string; d: string; h: number; cap: number; kg: number; fijo: number }[] {
  if (!remoto) {
    const h: Record<string, number> = { Arequipa: 3, Moquegua: 4, Tacna: 6, Ica: 10, Lima: 16, Puno: 5, Cusco: 9, 'Apurímac': 12, Ayacucho: 14, 'Madre de Dios': 20 };
    return [{ modo: 'VIAL', o: 'ALM-AQP', d: 'CLIENTE', h: h[region] ?? 8, cap: 10000, kg: 0.12, fijo: 120 }];
  }
  if (region === 'Puno') return [{ modo: 'VIAL', o: 'ALM-AQP', d: 'TB-PUNO', h: 5, cap: 10000, kg: 0.1, fijo: 150 }, { modo: 'LACUSTRE', o: 'TB-PUNO', d: 'CLIENTE', h: 2.5, cap: 1200, kg: 0.25, fijo: 80 }];
  if (region === 'Cusco') return [{ modo: 'VIAL', o: 'ALM-CUS', d: 'TB-SIERRA', h: 6, cap: 3000, kg: 0.15, fijo: 120 }, { modo: 'ANIMAL', o: 'TB-SIERRA', d: 'CLIENTE', h: 8, cap: 120, kg: 0.6, fijo: 40 }];
  return [{ modo: 'VIAL', o: 'ALM-CUS', d: 'TB-FLUV', h: 10, cap: 10000, kg: 0.12, fijo: 200 }, { modo: 'FLUVIAL', o: 'TB-FLUV', d: 'CLIENTE', h: 6, cap: 3000, kg: 0.3, fijo: 150 }];
}

/** Genera las hojas Hist* del Excel 06. */
export function tablasHistoria(): Tabla[] {
  const u = generador(SEMILLA_HISTORIA);
  const ent = (a: number, b: number) => a + Math.floor(u() * (b - a + 1));
  const elegir = <X,>(xs: X[]) => xs[Math.floor(u() * xs.length)];
  const ped: Celda[][] = [], lin: Celda[][] = [], entr: Celda[][] = [], eta: Celda[][] = [], dev: Celda[][] = [], sinDatos: Celda[][] = [];
  const t0 = ms(HISTORIA_INICIO);
  let n = 0;
  // Semanas sin captura de datos (faltante ≠ cero): Ayacucho semanas 20–22
  for (const w of [20, 21, 22]) sinDatos.push(['Ayacucho', iso(t0 + w * 7 * DIA).slice(0, 10), 'Sin registro por cambio de digitador (dato faltante, no demanda cero)']);
  for (let w = 0; w < HISTORIA_SEMANAS; w++) {
    const semana = t0 + w * 7 * DIA;
    const mes = new Date(semana - 5 * 3600000).getUTCMonth() + 1;
    const lluvias = mes >= 12 || mes <= 3;
    for (let i = 1; i <= 20; i++) {
      const region = regionDestino(i), remoto = i % 5 === 0;
      if (region === 'Ayacucho' && w >= 20 && w <= 22) continue; // no hay registros esa semana
      const tasa = (remoto ? 0.7 : 1.3) * (1 + 0.25 * Math.sin((w / 52) * 2 * Math.PI)) * (1 + w / 260);
      const k = Math.max(Math.floor(tasa + u() * 1.1), w === 31 && i === 1 ? 1 : 0); // semana 31: feria en Arequipa (atípico garantizado)
      for (let j = 0; j < k; j++) {
        n++;
        const id = `H-${String(n).padStart(5, '0')}`, cli = `CLI-${String(i).padStart(3, '0')}`, des = `DES-${String(i).padStart(3, '0')}`;
        const fPed = semana + ent(0, 4) * DIA + ent(8, 17) * 3600000;
        const regPed = u() < 0.05 ? fPed + ent(2, 26) * 3600000 : fPed + ent(0, 30) * 60000;
        const ini = Math.floor((fPed + (remoto ? 3 : 2) * DIA) / DIA) * DIA + 13 * 3600000; // 08:00 Lima
        const fin = ini + ent(2, 4) * DIA + 10 * 3600000; // 18:00
        const tipo = u() < 0.03 ? 'CONSULTA' : u() < 0.01 ? 'DUPLICADO' : 'FIRME';
        const prioridad = u() < 0.1 ? 'URGENTE' : 'NORMAL';
        // líneas
        const nl = u() < 0.3 ? 2 : 1;
        const prods: string[] = [];
        const cartera = region === 'Madre de Dios' ? ['P03', 'P06', 'P09', 'P05'] : remoto ? ['P01', 'P03', 'P04', 'P08'] : ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08'];
        if (w === 31 && i === 1 && j === 0) prods.push('P03');
        if (w >= 40 && u() < 0.15) prods.push('P10'); // producto nuevo: serie corta
        while (prods.length < nl) { const p = elegir(cartera); if (!prods.includes(p)) prods.push(p); }
        const quiebre = tipo === 'FIRME' && u() < 0.05;
        let kgTot = 0;
        const lineas = prods.map((p, li) => {
          let q = GRANEL.has(p) ? ent(80, 600) : ent(8, 60);
          if (p === 'P09' && u() < 0.55) q = 0; // serie intermitente: semanas sin pedido de P09
          if (region === 'Arequipa' && p === 'P03' && w === 31) q *= 6; // atípico (feria): se conserva y se señala
          const noAt = quiebre && li === 0 ? Math.round(q * (0.2 + u() * 0.4)) : 0;
          kgTot += (q - noAt) * PESO[p];
          return { p, q, noAt };
        }).filter((x) => x.q > 0);
        if (!lineas.length) { n--; continue; }
        // cancelaciones
        let cancel: number | null = null, motCancel: string | null = null;
        if (tipo === 'CONSULTA') { cancel = fPed + ent(1, 20) * 3600000; motCancel = 'Consulta no confirmada'; }
        else if (tipo === 'DUPLICADO') { cancel = fPed + ent(1, 5) * 3600000; motCancel = 'Pedido duplicado'; }
        else if (u() < 0.03) { const antes = u() < 0.6; cancel = antes ? ini - ent(5, 30) * 3600000 : fin + ent(5, 48) * 3600000; motCancel = antes ? 'Cliente desiste antes del compromiso' : 'Cliente desiste tras el vencimiento'; }
        const tramos = ruta(region, remoto);
        ped.push([id, cli, des, region, remoto, iso(fPed), iso(regPed), iso(ini), iso(fin), prioridad, tipo, cancel ? iso(cancel) : null, motCancel, tramos[0].o, tramos.at(-1)!.modo, tramos.length]);
        lineas.forEach((l, li) => lin.push([id, li + 1, l.p, l.q, l.q - l.noAt, l.noAt, l.noAt ? 'Falta de stock (demanda censurada)' : null]));
        if (cancel && cancel < fin) continue; // cancelado antes de cumplir: sin ejecución
        // ejecución y causa del resultado
        const pAtraso = 0.07 + (remoto ? 0.18 : 0) + (lluvias && ['Puno', 'Cusco', 'Madre de Dios', 'Apurímac', 'Ayacucho'].includes(region) ? 0.1 : 0);
        const tarde = u() < pAtraso;
        const causas: [string, number][] = remoto
          ? [['Conexión perdida en transbordo', 0.3], [lluvias ? 'Huaico o deslizamiento' : 'Estiaje (bajo caudal)', 0.25], ['Cliente ausente', 0.15], ['Avería del medio', 0.1], ['Sin causa registrada', 0.2]]
          : [['Congestión o demora en ruta', 0.3], ['Cliente ausente', 0.2], ['Avería del medio', 0.15], [lluvias ? 'Huaico o deslizamiento' : 'Demora en despacho', 0.1], ['Sin causa registrada', 0.25]];
        let causa: string | null = null;
        if (tarde) { let x = u(); for (const [c, p] of causas) { if ((x -= p) <= 0) { causa = c; break; } } causa ??= 'Sin causa registrada'; }
        // etapas
        let tiempo = ini - (tramos.reduce((a, t) => a + t.h, 0) + 4) * 3600000;
        tramos.forEach((t, k) => {
          const salPlan = tiempo + (k ? 1 : 0) * 3600000, llePlan = salPlan + t.h * 3600000;
          const perdida = tarde && causa === 'Conexión perdida en transbordo' && k === 1;
          const extra = (perdida ? ent(16, 30) : tarde && k === tramos.length - 1 && causa !== 'Cliente ausente' ? ent(6, 50) : u() < 0.2 ? ent(0, 2) : 0) * 3600000;
          const salReal = salPlan + (perdida ? extra : 0), lleReal = llePlan + extra;
          const est = Math.round((t.fijo / (k ? 3 : 4) + kgTot * t.kg) * 100);
          const real = Math.round(est * (0.92 + u() * 0.18) + (tarde && k === tramos.length - 1 && causa === 'Avería del medio' ? 15000 : 0));
          const dia = iso(salPlan).slice(0, 10);
          eta.push([`${id}-T${k + 1}`, id, k + 1, t.modo, t.o, t.d === 'CLIENTE' ? `N-${des}` : t.d, `${t.modo}-${t.o}-${dia}`, iso(salPlan), iso(salReal), iso(llePlan), iso(lleReal), r2(kgTot), t.cap, perdida, est, real, k === tramos.length - 1 && tarde ? causa : perdida ? causa : null]);
          tiempo = lleReal;
        });
        // entregas (intentos)
        let ocur = tarde ? fin + ent(3, 60) * 3600000 : Math.max(ini + 3600000, fin - ent(2, 40) * 3600000);
        let intento = 1;
        if (tarde && causa === 'Cliente ausente') {
          const fall = fin - ent(3, 20) * 3600000;
          entr.push([`${id}-E1`, id, 1, iso(fall), iso(fall + 3600000), 'FALLIDO', 'Cliente ausente', null, null, null]);
          intento = 2;
        }
        const tardio = u() < 0.05; // registro tardío de la evidencia: afecta la vista ORIGINAL según conocimiento
        const reg = ocur + (tardio ? ent(3, 10) * DIA : ent(10, 120) * 60000);
        const parcial = u() < 0.05;
        lineas.forEach((l, li) => {
          const comp = l.q - l.noAt;
          const rech = parcial && li === 0 ? Math.max(1, Math.round(comp * 0.1)) : 0;
          entr.push([`${id}-E${intento}`, id, intento, iso(ocur), iso(reg), rech ? 'PARCIAL' : 'TOTAL', rech ? 'Producto dañado en tránsito' : null, li + 1, comp - rech, rech]);
          if (u() < 0.02 && comp - rech > 1) { const d = ocur + ent(2, 12) * DIA; dev.push([id, li + 1, Math.max(1, Math.round((comp - rech) * 0.2)), iso(d), iso(d + 3600000), 'Producto con humedad']); }
        });
        ocur += 0;
      }
    }
  }
  const T = (hoja: string, cols: string, filas: Celda[][]): Tabla => ({ hoja, cols: cols.split(','), filas });
  return [
    T('HistPedidos', 'pedido_id,cliente_id,destino_id,region,remoto,fecha_pedido,registrado_en,compromiso_inicio,compromiso_fin,prioridad,tipo_demanda,cancelado_en,motivo_cancelacion,origen_nodo,modo_final,tramos', ped),
    T('HistLineas', 'pedido_id,linea,producto_id,solicitado,comprometido,no_atendido,motivo_no_atendido', lin),
    T('HistEntregas', 'entrega_id,pedido_id,intento,ocurrido_en,registrado_en,estado,motivo,linea,aceptado,rechazado', entr),
    T('HistEtapas', 'etapa_id,pedido_id,tramo,modo_id,nodo_origen_id,nodo_destino_id,servicio_ref,salida_plan,salida_real,llegada_plan,llegada_real,kg,capacidad_kg,conexion_perdida,costo_estimado_cent,costo_real_cent,motivo_retraso', eta),
    T('HistDevoluciones', 'pedido_id,linea,cantidad,ocurrido_en,registrado_en,motivo', dev),
    T('HistSinDatos', 'region,semana_inicio,motivo', sinDatos),
    // Retorno PARCIAL de envases: 4 contenedores salen con un pedido de CLI-005 y vuelven 3 (uno queda en custodia del cliente)
    T('HistRetornables', 'activo_id,tipo_movimiento,desde,hacia,pedido_ref,condicion,ocurrido_en,registrado_en,documento', [
      ...['CONT-001', 'CONT-002', 'CONT-003', 'CONT-004'].map((a) => [a, 'ENTREGA', 'ALM-AQP', 'CLI-005', 'H-00004', 'DISPONIBLE', '2025-11-14T10:00:00-05:00', '2025-11-14T10:05:00-05:00', 'Guía G-0101']),
      ...['CONT-001', 'CONT-002', 'CONT-003'].map((a) => [a, 'RETORNO_RECIBIDO', 'CLI-005', 'ALM-AQP', 'H-00004', 'DISPONIBLE', '2025-11-28T09:00:00-05:00', '2025-11-28T09:30:00-05:00', 'Guía de retorno R-0033'])]),
    // Diferencia de conteo RESUELTA: conteo con faltante, recuento que la confirma y ajuste aprobado por otra persona
    T('HistConteos', 'conteo_id,nodo_id,lote_id,condicion,corte,contado,sistema,estado,recuento_de,resolucion,registrado_por', [
      ['CNT-H001', 'ALM-AQP', 'L-P01-A', 'APTO', '2026-10-31T18:00:00-05:00', 118, 120, 'RESUELTO', null, 'Recontado en CNT-H002', 'U03'],
      ['CNT-H002', 'ALM-AQP', 'L-P01-A', 'APTO', '2026-10-31T18:00:00-05:00', 118, 120, 'RESUELTO', 'CNT-H001', 'Ajuste −2 aprobado por supervisión (rotura de sacos)', 'U03']]),
  ];
}

/** Contenido completo del Excel 06: maestros/operación vigente de NutriDemo + historia cerrada de 52 semanas. */
export function tablasExcel06(): Tabla[] { return [...tablasDemo(), ...tablasHistoria(), ...tablasModelos()]; }

/** I06: parámetros de simulación, supuestos económicos y un escenario de promoción comunicado (AU06). */
export function tablasModelos(): Tabla[] {
  const T = (hoja: string, cols: string, filas: Celda[][]): Tabla => ({ hoja, cols: cols.split(','), filas });
  return [
    T('ParametrosSimulacion', 'parametro,valor,unidad,descripcion', FILAS_PARAMETROS.map(([k, u, d]) => [k, k === 'shock_comun' ? (PARAMETROS_DEFECTO.shock_comun ? 1 : 0) : (PARAMETROS_DEFECTO[k] as number), u, d])),
    T('SupuestosEconomicos', 'clave,valor,unidad,descripcion,fuente', SUPUESTOS_DEFECTO.map((s) => [s.clave, s.valor, s.unidad, s.descripcion, s.fuente])),
    T('EscenariosDemanda', 'escenario_id,nombre,producto_id,desde,hasta,aumento_pct,fuente', [
      ['ESC-PROMO-P01', 'Promoción de verano P01', 'P01', '2027-01-11', '2027-02-08', 35, 'Área comercial NutriDemo (supuesto comunicado el 2026-11-02)']]),
  ];
}
