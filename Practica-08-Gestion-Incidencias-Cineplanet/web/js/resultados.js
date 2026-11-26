"use strict";
/* Indicadores, simulación de escenarios, estimación de valor y exportaciones (Excel 07 y 08). Común a PC08.exe y PC08.html. */
const Resultados = (() => {
  const FORMULA = "v1 · 2026-11-25";
  const mediana = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const pct = (n, d) => d ? n / d * 100 : null;

  /* ---------------- indicadores sobre los registros (P-01) ---------------- */
  async function calcular(A, {sede_id = "", desde = null, hasta = null} = {}) {
    const p = await Nucleo.proyecto(A);
    const [inc, fun, cont, sed, tip] = await Promise.all([A.leer("incidencia", {proyecto_id: p.id}), A.leer("funcion", {proyecto_id: p.id}), A.leer("contacto", {}), A.leer("sede", {proyecto_id: p.id}), A.leer("tipo_incidencia", {})]);
    const F = new Map(fun.map(f => [f.id, f])), S = new Map(sed.map(s => [s.id, s.nombre])), T = new Map(tip.map(t => [t.codigo, t.nombre]));
    const nCont = cont.reduce((m, c) => (m[c.incidencia_id] = (m[c.incidencia_id] || 0) + 1, m), {});
    const corte = Math.floor(Date.now() / 1000);
    const casos = inc.filter(i => (!sede_id || i.sede_id === Number(sede_id)) && (desde == null || i.apertura_utc >= desde) && (hasta == null || i.apertura_utc < hasta)).map(i => {
      const f = F.get(i.funcion_id), ini = f?.horario_estado === "CONFIRMADO" ? f.inicio_utc : null;
      const vinculado = i.estado === "CERRADO" && /^Contacto vinculado/.test(i.resultado || "");
      const resuelto = ["RESUELTO", "CERRADO"].includes(i.estado) && !vinculado && i.resuelto_utc != null && !!i.evidencia_resolucion;
      let grupo;
      if (vinculado) grupo = "DUPLICADO_VINCULADO"; else if (ini == null) grupo = "VERIFICAR_HORARIO"; else if (i.apertura_utc >= ini) grupo = "POSTERIOR_AL_INICIO"; else grupo = "ELEGIBLE";
      const aTiempo = grupo === "ELEGIBLE" && resuelto && i.resuelto_utc < ini;
      const resultadoGrupo = grupo !== "ELEGIBLE" ? "—" : aTiempo ? "A_TIEMPO" : resuelto ? "DESPUES" : ini <= corte ? "SIN_SOLUCION" : "PENDIENTE";
      return {codigo: i.codigo, sede: S.get(i.sede_id), motivo: T.get(i.tipo_codigo) || i.tipo_codigo, tipo: i.tipo_codigo, estado: i.estado, canal_origen: i.canal_origen,
        apertura_utc: i.apertura_utc, inicio_utc: ini, resuelto_utc: resuelto ? i.resuelto_utc : null, minutos_antes: ini != null ? Math.round((ini - i.apertura_utc) / 60) : null,
        minutos_atencion: resuelto ? Math.round((i.resuelto_utc - i.apertura_utc) / 60) : null, contactos: nCont[i.id] || 0, grupo, resultado: resultadoGrupo, evidencia: i.evidencia_resolucion || "", naturaleza: i.naturaleza};
    });
    const el = casos.filter(c => c.grupo === "ELEGIBLE"), cuenta = r => el.filter(c => c.resultado === r).length;
    const resueltos = casos.filter(c => c.resuelto_utc != null), vigentes = casos.filter(c => c.grupo !== "DUPLICADO_VINCULADO");
    const ind = {
      elegibles: el.length, a_tiempo: cuenta("A_TIEMPO"), despues: cuenta("DESPUES"), sin_solucion: cuenta("SIN_SOLUCION"), pendientes: cuenta("PENDIENTE"),
      tasa: pct(cuenta("A_TIEMPO"), el.length), posteriores: casos.filter(c => c.grupo === "POSTERIOR_AL_INICIO").length, verificar_horario: casos.filter(c => c.grupo === "VERIFICAR_HORARIO").length,
      vinculados: casos.filter(c => c.grupo === "DUPLICADO_VINCULADO").length, total: casos.length,
      contactos_por_incidencia: vigentes.length ? vigentes.reduce((s, c) => s + c.contactos, 0) / vigentes.length : null,
      mediana_atencion_min: mediana(resueltos.map(c => c.minutos_atencion)), reaperturas: 0,
    };
    const porMotivo = Object.values(el.reduce((m, c) => { (m[c.tipo] ||= {motivo: c.motivo, elegibles: 0, a_tiempo: 0}).elegibles++; if (c.resultado === "A_TIEMPO") m[c.tipo].a_tiempo++; return m; }, {})).map(x => ({...x, tasa: pct(x.a_tiempo, x.elegibles)})).sort((a, b) => b.elegibles - a.elegibles);
    return {ind, casos, porMotivo, corte, formula: FORMULA, sede: sede_id ? S.get(Number(sede_id)) : "Todas las sedes", desde, hasta, naturaleza: "SINTETICO"};
  }
  function filasIndicadores(r) {
    const i = r.ind;
    return [
      ["IND-01", "Incidencias elegibles con solución verificada antes del inicio", i.a_tiempo, i.elegibles, i.tasa, "%", "Indicador principal (P-01). Elegible: primer contacto antes del inicio y horario conocido."],
      ["IND-02", "Incidencias resueltas después del inicio (dentro del universo elegible)", i.despues, i.elegibles, pct(i.despues, i.elegibles), "%", "Solución verificada fuera de la ventana útil"],
      ["IND-03", "Elegibles sin solución con la función ya iniciada", i.sin_solucion, i.elegibles, pct(i.sin_solucion, i.elegibles), "%", "Atención posterior al inicio (R10)"],
      ["IND-04", "Elegibles pendientes con la función aún por iniciar", i.pendientes, i.elegibles, pct(i.pendientes, i.elegibles), "%", "Aún dentro de la ventana útil"],
      ["IND-05", "Contactos por incidencia", null, null, i.contactos_por_incidencia, "contactos", "Excluye duplicados vinculados (control de doble conteo)"],
      ["IND-06", "Tiempo de atención mediano", null, null, i.mediana_atencion_min, "min", "Desde el primer contacto hasta la solución verificada"],
      ["IND-07", "Reaperturas", i.reaperturas, null, i.reaperturas, "casos", "Reapertura por el mismo motivo dentro de 24 h (R22)"],
      ["IND-08", "Abiertas después del inicio (fuera del universo)", i.posteriores, null, i.posteriores, "casos", "Se reportan aparte (P-01)"],
      ["IND-09", "Con horario por verificar (fuera del universo)", i.verificar_horario, null, i.verificar_horario, "casos", "Se reportan aparte hasta confirmar la hora (R09)"],
      ["IND-10", "Contactos duplicados vinculados", i.vinculados, null, i.vinculados, "casos", "Se cuentan una sola vez en el expediente original"],
    ];
  }

  /* ---------------- simulación de escenarios equivalentes (P-02 A) ---------------- */
  const SUPUESTOS = [
    ["Volumen central", "104 incidencias en 30 días (1 % de 10.368 pedidos digitales; Alcance §4)"],
    ["Episodios fuera del universo", "4 de 104 se abren después del inicio de la función"],
    ["Anticipación al llegar", "15 % entre 1 y 15 min; 35 % entre 16 y 45 min; 50 % entre 46 y 150 min antes de la función"],
    ["Cambio de canal", "60 % de los episodios pasan de la app a Atención Digital o Boletería"],
    ["Flujo actual", "Verificación 6–18 min; si cambia de canal, se repite la historia (+10–25 min); cola por orden de llegada (espera 0–20 min)"],
    ["Flujo propuesto", "Verificación 6–18 min; con el mismo código, el traspaso agrega 0–5 min; prioridad por minutos: crítico y urgente esperan 0–5 min, normal 0–20 min"],
    ["Sin solución posible a tiempo", "10 % de los casos de cobro duplicado y cambio de función en ambos flujos (requieren aprobación externa)"],
    ["Semilla", "20261126 (mismos episodios en ambos flujos)"],
  ];
  /* v0.8.0: perfil de calibración tomado de los casos registrados (anticipación, cambio de canal, motivos, aperturas posteriores).
     La estimación se recalcula cada vez que cambian los datos; sin casos suficientes se usa el escenario de referencia. */
  function perfil(r) {
    const cs = (r?.casos || []).filter(c => c.grupo !== "DUPLICADO_VINCULADO"), antes = cs.filter(c => c.grupo === "ELEGIBLE" && c.minutos_antes > 0).map(c => c.minutos_antes);
    if (antes.length < 5) return null;
    const pri = Nucleo.TIPOS.slice(0, 8).map(t => t[0]), tipos = cs.map(c => c.tipo).filter(t => pri.includes(t));
    return {casos: cs.length, antes, post: cs.filter(c => c.grupo === "POSTERIOR_AL_INICIO").length / cs.length, cambia: cs.filter(c => c.contactos > 1 || c.canal_origen !== "CLIENTE").length / cs.length, tipos: tipos.length ? tipos : pri};
  }
  function simularCon(r, n = 104) { return simular(n, 20261126, perfil(r)); }
  function supuestos(sim) {
    const P = sim?.perfil; if (!P) return SUPUESTOS;
    const q = f => Math.round(P.antes.filter(f).length / P.antes.length * 100);
    return [["Calibración", `Con ${P.casos} incidencias registradas (se recalcula cuando cambian los datos)`], ["Volumen simulado", `${sim.n} episodios generados con el perfil de los casos registrados`],
      ["Episodios fuera del universo", `${Math.round(P.post * 100)} % se abren después del inicio (dato registrado)`],
      ["Anticipación al llegar", `Remuestreo de ${P.antes.length} casos elegibles (±3 min): ${q(x => x <= 15)} % hasta 15 min; ${q(x => x > 15 && x <= 45)} % entre 16 y 45 min; ${q(x => x > 45)} % más de 45 min`],
      ["Cambio de canal", `${Math.round(P.cambia * 100)} % (casos con más de un contacto u originados fuera de la app)`], SUPUESTOS[4], SUPUESTOS[5], SUPUESTOS[6], SUPUESTOS[7]];
  }
  function simular(n = 104, semilla = 20261126, P = null) {
    let s = semilla >>> 0; const R = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const U = (a, b) => a + R() * (b - a), tipos = P ? P.tipos : Nucleo.TIPOS.slice(0, 8).map(t => t[0]);
    const posteriores = Math.round(n * (P ? P.post : 4 / 104)), ep = [];
    for (let k = 0; k < n; k++) {
      const r = R(), antes = k < posteriores ? -U(1, 20) : P ? Math.max(0.5, P.antes[Math.floor(R() * P.antes.length)] + U(-3, 3)) : r < 0.15 ? U(1, 15) : r < 0.50 ? U(16, 45) : U(46, 150);
      const tipo = tipos[Math.floor(R() * tipos.length)], cambia = R() < (P ? P.cambia : 0.6), verif = U(6, 18), rep = U(10, 25), traspaso = U(0, 5), colaA = U(0, 20), colaPN = U(0, 20), colaPU = U(0, 5);
      const bloqueado = ["T03", "T07"].includes(tipo) && R() < 0.10;
      const urgente = antes > 0 && antes <= 45;
      const tA = verif + (cambia ? rep : 0) + colaA, tP = verif + (cambia ? traspaso : 0) + (urgente ? colaPU : colaPN);
      ep.push({episodio: `SIM-${String(k + 1).padStart(3, "0")}`, tipo, minutos_antes: Math.round(antes * 10) / 10, cambia_canal: cambia ? "Sí" : "No", elegible: antes > 0 ? "Sí" : "No",
        min_actual: Math.round(tA * 10) / 10, a_tiempo_actual: antes > 0 && !bloqueado && tA < antes ? "Sí" : "No", min_propuesto: Math.round(tP * 10) / 10, a_tiempo_propuesto: antes > 0 && !bloqueado && tP < antes ? "Sí" : "No"});
    }
    const el = ep.filter(e => e.elegible === "Sí"), a = el.filter(e => e.a_tiempo_actual === "Sí").length, b = el.filter(e => e.a_tiempo_propuesto === "Sí").length;
    return {episodios: ep, elegibles: el.length, actual: a, propuesto: b, tasa_actual: pct(a, el.length), tasa_propuesto: pct(b, el.length), diferencia_pp: el.length ? (b - a) / el.length * 100 : null, n, semilla, perfil: P, calibrada: !!P};
  }
  /* Valor (R30): solo con supuestos explícitos; sin ellos queda «Por estimar». */
  function valor(sim, sup) {
    const num = k => sup?.[k] === "" || sup?.[k] == null ? null : Number(sup[k]);
    const margen = num("margen"), costo = num("costo_contacto"), incremental = num("costo_incremental");
    if (margen == null || incremental == null) return null;
    const adicionales = sim.propuesto - sim.actual, contactosEvitados = Math.round(sim.episodios.filter(e => e.cambia_canal === "Sí" && e.elegible === "Sí").length * 0.5);
    const esc = f => ({adicionales: Math.round(adicionales * f), beneficio: Math.round((adicionales * f * margen + (costo || 0) * contactosEvitados * f - incremental) * 100) / 100});
    return {conservador: esc(0.5), central: esc(1), favorable: esc(1.5), contactosEvitados};
  }

  /* ---------------- exportaciones ---------------- */
  const fecha = u => u == null ? null : new Date(u * 1000);
  const T = {A_TIEMPO: "A tiempo", DESPUES: "Después del inicio", SIN_SOLUCION: "Sin solución (función iniciada)", PENDIENTE: "Pendiente", "—": "Fuera del universo"};
  const G = {ELEGIBLE: "Elegible", VERIFICAR_HORARIO: "Verificar horario", POSTERIOR_AL_INICIO: "Abierta después del inicio", DUPLICADO_VINCULADO: "Duplicado vinculado"};
  function excelResultados(r, sim, val, usuario) {
    const f = filasIndicadores(r);
    return XLSX.escribir([
      {nombre: "Resumen", sinEncabezado: true, anchos: [34, 70], filas: [["Resultados de la solución · Gestión de incidencias Cineplanet"], [], ["Alcance", `${r.sede} · Caso 12 · piloto ${Nucleo.PILOTO}`], ["Periodo (apertura)", r.desde || r.hasta ? `${r.desde ? Carga.fmtF(r.desde) : "inicio"} a ${r.hasta ? Carga.fmtF(r.hasta) : "corte"}` : "Todos los registros"], ["Fecha de corte", fecha(r.corte)], ["Naturaleza de los datos", "SINTÉTICOS (demostración)"], ["Versión de fórmulas", r.formula], ["Generado por", usuario], [],
        ["Indicador principal", r.ind.tasa == null ? "Sin datos para calcular" : `${r.ind.a_tiempo} de ${r.ind.elegibles} = ${r.ind.tasa.toFixed(2).replace(".", ",")} %`], ["Comparación simulada (mismos episodios)", sim.tasa_actual == null ? "—" : `Actual ${sim.actual}/${sim.elegibles} · Propuesto ${sim.propuesto}/${sim.elegibles} · Diferencia ${sim.diferencia_pp.toFixed(2).replace(".", ",")} puntos porcentuales`], ["Valor monetario", val ? `Central: S/ ${val.central.beneficio.toFixed(2).replace(".", ",")} (supuestos del usuario)` : "Por estimar (faltan supuestos de margen y costo)"]]},
      {nombre: "Indicadores", anchos: [10, 62, 12, 12, 12, 12, 70], formatos: {4: "decimal"}, filas: [["Código", "Indicador", "Numerador", "Denominador", "Valor", "Unidad", "Definición y observación"], ...f.map(x => [x[0], x[1], x[2], x[3], x[4] == null ? "Sin datos para calcular" : Math.round(x[4] * 100) / 100, x[5], x[6]])]},
      {nombre: "Casos_filtrados", anchos: [12, 22, 36, 16, 14, 18, 18, 18, 12, 12, 10, 24, 28, 30], formatos: {5: "fecha", 6: "fecha", 7: "fecha"}, filas: [["Código", "Sede", "Motivo", "Estado", "Canal origen", "Apertura", "Inicio función", "Solución verificada", "Min. antes", "Min. atención", "Contactos", "Grupo", "Resultado", "Evidencia"],
        ...r.casos.map(c => [c.codigo, c.sede, c.motivo, c.estado, c.canal_origen, fecha(c.apertura_utc), fecha(c.inicio_utc), fecha(c.resuelto_utc), c.minutos_antes, c.minutos_atencion, c.contactos, G[c.grupo], T[c.resultado], c.evidencia])]},
      {nombre: "Por_motivo", anchos: [44, 12, 12, 12], formatos: {3: "decimal"}, filas: [["Motivo", "Elegibles", "A tiempo", "Tasa %"], ...r.porMotivo.map(m => [m.motivo, m.elegibles, m.a_tiempo, m.tasa == null ? "Sin datos" : Math.round(m.tasa * 100) / 100])]},
      {nombre: "Escenarios", anchos: [12, 8, 12, 12, 10, 14, 14, 16, 16], formatos: {2: "decimal", 5: "decimal", 7: "decimal"}, filas: [["Episodio", "Tipo", "Min. antes", "Cambia canal", "Elegible", "Min. flujo actual", "A tiempo actual", "Min. flujo propuesto", "A tiempo propuesto"], ...sim.episodios.map(e => [e.episodio, e.tipo, e.minutos_antes, e.cambia_canal, e.elegible, e.min_actual, e.a_tiempo_actual, e.min_propuesto, e.a_tiempo_propuesto])]},
      {nombre: "Supuestos", anchos: [32, 100], filas: [["Supuesto", "Valor (simulación rotulada)"], ...supuestos(sim)]},
      {nombre: "Calidad_de_datos", anchos: [12, 30, 60], filas: [["Código", "Observación", "Tratamiento"], ...r.casos.filter(c => c.grupo !== "ELEGIBLE").map(c => [c.codigo, G[c.grupo], c.grupo === "VERIFICAR_HORARIO" ? "Excluido hasta confirmar la hora (R09)" : c.grupo === "POSTERIOR_AL_INICIO" ? "Reportado aparte (P-01)" : "Contado una vez en el expediente original"])]},
    ]);
  }
  async function excelDT(A, usuario, porSede = null) {
    const p = await Nucleo.proyecto(A), vs = await DT.versiones(A, p.id), av = await DT.avance(A, p.id);
    /* Por sede: las 10 herramientas calculadas al momento para esa sede (no son versiones guardadas) */
    const vg = porSede?.g ? Object.fromEntries(DT.ORDEN.map(c => [c, {version: "Sede", estado: DT.faltantes(c, porSede.g.contenidos[c]).length ? "PENDIENTE" : "CALCULADA", contenido: JSON.stringify(porSede.g.contenidos[c])}])) : DT.vigente(vs);
    const filasEtapa = etapa => { const out = [["Herramienta", "Versión", "Estado", "Sección", "Elemento", "Detalle"]];
      for (const cod of DT.ORDEN.filter(c => DT.H[c].etapa === etapa)) { const v = vg[cod]; if (!v) continue; const c = JSON.parse(v.contenido), H = DT.H[cod];
        for (const [k, t] of H.campos) out.push([H.nombre, v.version, v.estado, "Dato", t, c[k] ?? ""]);
        for (const [k, L] of Object.entries(H.listas)) (c[k] || []).forEach((r, i) => out.push([H.nombre, v.version, v.estado, L.titulo, `Fila ${i + 1}`, L.cols.map(([q, tt]) => `${tt}: ${r[q] ?? ""}`).join(" | ")]));
        if (cod === "ID2") DT.ranking(c.filas).forEach((r, i) => out.push([H.nombre, v.version, v.estado, "Puntaje ponderado", `${i + 1}. ${r.idea}`, r.puntaje]));
        if (cod === "PV1") { const s = DT.resumenPrueba(c); out.push([H.nombre, v.version, v.estado, "Resultado", "Éxito sin ayuda ni error", s.tasa == null ? "Sin datos" : `${s.exitos} de ${s.intentos} = ${s.tasa.toFixed(2).replace(".", ",")} % (umbral ${s.umbral} %)`]); }
      } return out; };
    const pr2 = vg.PR2 ? JSON.parse(vg.PR2.contenido).fichas || [] : [], pv1 = vg.PV1 ? JSON.parse(vg.PV1.contenido).intentos || [] : [];
    const ev = await A.leer("evidencia", {proyecto_id: p.id});
    return XLSX.escribir([
      {nombre: "Resumen", anchos: [14, 44, 12, 12, 30, 20], formatos: {5: "fecha"}, filas: [["Etapa", "Herramienta", "Versión", "Estado", "Revisado por", "Fecha"], ...(porSede ? [["Ámbito", `${porSede.nombre}: análisis calculado con los datos de la sede (${porSede.g?.base || "sin incidencias"})`, "", "", "", ""]] : [["Ámbito", "Todas las sedes (versiones guardadas)", "", "", "", ""]]), ...av.herramientas.map(h => [DT.ETAPAS.find(e => e[0] === h.etapa)[1], h.nombre, h.version, h.estado, h.revisado_por || "—", fecha(h.fecha)]), [], ["Avance", `${av.completas} de 10 completas · ${av.validadas} validadas · ${av.porcentaje} %`], ["Naturaleza", "Contenido inicial SIMULADO; decisiones del usuario responsable registradas en la aplicación"], ["Generado por", usuario]]},
      ...DT.ETAPAS.map(([k, n]) => ({nombre: n, anchos: [34, 9, 12, 26, 30, 110], filas: filasEtapa(k)})),
      {nombre: "Prototipos", anchos: [10, 34, 8, 50, 50, 10, 34, 60], formatos: {5: "decimal"}, filas: [["Tipo", "Nombre", "Versión", "Hipótesis", "Materiales", "Costo S/", "Tarea", "Roles y contingencia"], ...pr2.map(f => [f.tipo, f.nombre, f.version, f.hipotesis, f.materiales, Number(f.costo) || 0, f.tarea, f.roles])]},
      {nombre: "Pruebas", anchos: [34, 12, 8, 10, 8, 10, 12, 18, 40], filas: [["Tarea", "Participante", "Versión", "Tiempo s", "Éxito", "Ayuda", "Error crítico", "Naturaleza", "Observación"], ...pv1.map(r => [r.tarea, r.participante, r.version, Number(r.tiempo_s) || null, r.exito, r.ayuda, r.error, r.naturaleza, r.observacion])]},
      {nombre: "Evidencias", anchos: [12, 14, 30, 60, 30], filas: [["Código", "Tipo", "Origen", "Contenido", "Enlace"], ...ev.map(e => [e.codigo, e.tipo, e.origen, e.contenido, e.url_https || ""])]},
      {nombre: "Versiones", anchos: [8, 8, 12, 40, 20, 30, 12, 80], formatos: {4: "fecha"}, filas: [["Código", "Versión", "Estado", "Autor", "Fecha", "Revisado por", "Origen", "Regla aplicada"], ...vs.map(v => { let g = null; try { g = JSON.parse(v.contenido)._generado; } catch {} return [v.codigo, v.version, v.estado, v.autor, fecha(v.fecha_utc), v.revisado_por || "", g ? "Automático" : "Manual", g ? g.regla : ""]; })]},
    ]);
  }
  return {calcular, filasIndicadores, simular, simularCon, perfil, supuestos, valor, SUPUESTOS, excelResultados, excelDT, FORMULA};
})();
