/* PC08 · v0.8.0 · Generación automática de las 10 herramientas de Design Thinking desde los datos registrados.
   Insumos: incidencias, contactos, eventos, verificaciones, funciones y catálogo de motivos (los mismos que usan los indicadores).
   Cada herramienta guarda en «_generado» la fecha, la base de datos usada y la regla aplicada.
   No decide por el usuario: la elección (ID2) y la decisión final (PV2) quedan pendientes de confirmación humana. */
(function (G) {
  "use strict";
  const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : 0;
  const fp = (a, b) => (b ? Math.round(a / b * 1000) / 10 : 0).toLocaleString("de-DE", {minimumFractionDigits: 1, maximumFractionDigits: 1});
  const fmt = (x, d = 1) => Number(x).toLocaleString("de-DE", {minimumFractionDigits: d, maximumFractionDigits: d});
  const med = L => { const s = L.filter(x => x != null && isFinite(x)).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const codigos = (L, n = 4) => L.length ? L.slice(0, n).map(x => x.codigo || x).join(", ") + (L.length > n ? ` y ${L.length - n} más` : "") : "—";
  const lim = (v, a = 1, b = 5) => Math.max(a, Math.min(b, Math.round(v)));
  const CANAL = {CLIENTE: "Web o app", DIGITAL: "Atención Digital", BOLETERIA: "Boletería", CARGA: "Carga de datos", SISTEMA: "Sistema"};

  /* Catálogo de ideas por causa (regla: cada causa con evidencia activa su idea; valor = casos que atiende) */
  const IDEAS = {
    traspaso: ["Expediente único con código compartido", "El cliente recibe un código y cada canal abre el mismo historial, responsable y siguiente acción", "Atención Digital y Boletería", "No repetir el caso al cambiar de canal", "El personal usa el código en lugar de volver a preguntar", 4, 4, 4, "Cambiar el flujo de traspaso entre áreas"],
    estado: ["Consulta del estado de compra en un solo paso", "Muestra juntos compra, pago, emisión e ingreso con su fecha de actualización", "Atención Digital", "Diagnóstico correcto en el primer contacto", "Los estados llegan a tiempo desde los sistemas de prueba", 3, 4, 4, "Depende de la integración con pagos"],
    prioridad: ["Cola priorizada por minutos al inicio", "Ordena la bandeja por los minutos que faltan para la función (crítico ≤ 15, urgente ≤ 45)", "Atención Digital y Boletería", "Atender primero lo que vence antes", "El horario de la función es confiable", 4, 4, 4, "Ninguno relevante"],
    validacion: ["Modo local con verificación diferida", "Si el servicio de validación no responde, el caso sigue con datos locales y se reintenta", "Atención Digital", "No detener la atención por una caída", "Los datos locales bastan para orientar", 3, 3, 4, "Decisiones con datos no verificados"],
    duplicado: ["Detección y vinculación de contactos duplicados", "Busca por pedido y cliente al registrar y propone vincular al expediente original", "Atención Digital", "Un solo responsable por episodio", "El pedido declarado identifica el caso", 4, 5, 5, "Falsos positivos al vincular"],
    horario: ["Verificación del horario al registrar", "Marca VERIFICAR_HORARIO y pide confirmarlo antes de priorizar", "Atención Digital", "Prioridad calculada con datos correctos", "El horario se puede confirmar en la sede", 4, 5, 4, "Retraso si la sede no responde"],
    boleteria: ["Tarjeta de caso para Boletería", "Tarjeta impresa o en pantalla con código, estado y siguiente acción para retomar sin preguntar", "Boletería", "Retomar el caso en segundos", "El cliente presenta el código", 5, 5, 4, "Pérdida de la tarjeta física"],
    cambio: ["Aviso proactivo de cambio de función", "Avisa al cliente y a Boletería cuando cambia o se cancela la función", "Cliente y Boletería", "Menos reclamos por cambios", "Los cambios se registran a tiempo", 3, 3, 3, "Mensajes no leídos"],
    reembolso: ["Reembolso automático por cobro sin entrada", "Devuelve el cobro sin intervención cuando no hay entrada emitida", "Cliente", "Recupera su dinero sin gestiones", "El banco procesa a tiempo", 2, 2, 2, "No recupera la función; riesgo financiero"],
  };
  /* Causas: [clave, categoría, causa, mecanismo, función que cuenta los casos con evidencia, idea] */
  const CAUSAS = [
    ["traspaso", "Proceso", "Traspaso entre canales sin expediente compartido", "Cada canal vuelve a preguntar y el responsable se pierde al derivar", d => d.conDerivacion, "traspaso"],
    ["estado", "Datos", "Estado de compra, pago o emisión no visible al atender", "Se diagnostica sin saber si hubo cobro o entrada emitida", d => d.cobroOEmision, "estado"],
    ["boleteria", "Personas", "Boletería retoma el caso sin el historial", "El cliente repite el problema frente a la fila", d => d.retomados, "boleteria"],
    ["prioridad", "Reglas", "La atención no considera los minutos que faltan para la función", "Casos críticos esperan detrás de casos con más margen", d => d.criticosTarde, "prioridad"],
    ["validacion", "Recursos", "El servicio de validación no responde", "La verificación se interrumpe y el caso se detiene", d => d.interrumpidas, "validacion"],
    ["duplicado", "Datos", "El cliente reingresa por otro canal y se duplica el caso", "Dos responsables atienden el mismo episodio", d => d.duplicados, "duplicado"],
    ["horario", "Entorno", "Horario de la función desconocido o contradictorio", "No se puede calcular la prioridad ni la ventana útil", d => d.sinHorario, "horario"],
    ["cambio", "Entorno", "Cambio o cancelación de la función", "El cliente se entera en la sede y reclama", d => d.cambios, "cambio"],
  ];
  /* Materiales de bajo costo (precio referencial en soles, rotulado como supuesto) */
  const MAT = {tarjeta: ["Cartulina A4 (10 tarjetas)", 2.0], impresion: ["Impresión b/n (20 hojas)", 2.0], plumon: ["Plumones (2)", 4.0], sticker: ["Etiquetas adhesivas (1 plancha)", 3.0], mica: ["Micas de protección (5)", 2.5],
    guion: ["Guion de juego de roles impreso", 0.0], celular: ["Celular propio con cronómetro", 0.0], hoja: ["Hoja de registro de tiempos", 0.0], post: ["Notas adhesivas (1 bloque)", 3.5]};
  const FICHAS = {
    FÍSICO: ["tarjeta", "impresion", "plumon", "mica"],
    SERVICIO: ["guion", "celular", "hoja", "post"],
  };

  async function cargar(A, sede_id = "") {
    const p = await Nucleo.proyecto(A), r = await Resultados.calcular(A, {sede_id});
    let [inc, ev, ct, ver, fun] = await Promise.all([A.leer("incidencia", {proyecto_id: p.id}), A.leer("evento", {}), A.leer("contacto", {}), A.leer("verificacion", {}), A.leer("funcion", {proyecto_id: p.id})]);
    if (sede_id) { inc = inc.filter(i => i.sede_id === Number(sede_id)); const ids = new Set(inc.map(i => i.id)); ev = ev.filter(e => ids.has(e.incidencia_id)); ct = ct.filter(c => ids.has(c.incidencia_id)); ver = ver.filter(v => ids.has(v.incidencia_id)); }
    const porInc = m => m.reduce((o, x) => ((o[x.incidencia_id] ||= []).push(x), o), {});
    return {p, r, inc, E: porInc(ev), C: porInc(ct), V: porInc(ver), fun, ev, ct, sede_id};
  }
  /* Vista por sede: calcula las 10 herramientas para una sede sin guardar versiones (las versiones guardadas son de todas las sedes) */
  async function porSede(A, sede_id) {
    const p = await Nucleo.proyecto(A), D = await cargar(A, sede_id); if (!D.inc.length) return null;
    const vg = DT.vigente(await DT.versiones(A, p.id)), previo = Object.fromEntries(Object.entries(vg).map(([k, v]) => [k, JSON.parse(v.contenido)]));
    const g = generar(D, previo); for (const k of DT.ORDEN) conservar(k, g.contenidos[k], {}); return g;
  }

  function analizar(D) {
    const {r, inc, E, C, V} = D, casos = r.casos, byCod = new Map(casos.map(c => [c.codigo, c]));
    const vig = inc.filter(i => byCod.get(i.codigo)?.grupo !== "DUPLICADO_VINCULADO");
    const conEv = t => vig.filter(i => (E[i.id] || []).some(e => t.includes(e.tipo)));
    const d = {
      total: inc.length, vigentes: vig.length, eventos: D.ev.length, contactos: D.ct.length,
      conDerivacion: conEv(["DERIVACION", "ESCALAMIENTO"]),
      cobroOEmision: vig.filter(i => ["T01", "T02", "T03", "T04"].includes(i.tipo_codigo) || (V[i.id] || []).some(v => v.estado_pago === "CONFIRMADO" && v.estado_emision !== "EMITIDA")),
      retomados: conEv(["RETOMA"]),
      criticosTarde: vig.filter(i => { const c = byCod.get(i.codigo); return c && c.grupo === "ELEGIBLE" && c.minutos_antes != null && c.minutos_antes <= 45 && c.resultado !== "A_TIEMPO"; }),
      interrumpidas: conEv(["VERIFICACION_INTERRUMPIDA"]),
      duplicados: inc.filter(i => i.tipo_codigo === "T08" || byCod.get(i.codigo)?.grupo === "DUPLICADO_VINCULADO" || (E[i.id] || []).some(e => ["POSIBLE_DUPLICADO", "VINCULACION"].includes(e.tipo))),
      sinHorario: vig.filter(i => byCod.get(i.codigo)?.grupo === "VERIFICAR_HORARIO"),
      cambios: vig.filter(i => ["T06", "T07"].includes(i.tipo_codigo)),
      multiContacto: vig.filter(i => (C[i.id] || []).length > 1),
      ind: r.ind, porMotivo: r.porMotivo, casos,
    };
    const motivos = Object.values(vig.reduce((m, i) => { const c = byCod.get(i.codigo); (m[i.tipo_codigo] ||= {tipo: i.tipo_codigo, motivo: c?.motivo || i.tipo_codigo, n: 0, inc: []}).n++; m[i.tipo_codigo].inc.push(i); return m; }, {})).sort((a, b) => b.n - a.n);
    d.motivos = motivos;
    d.minAntes = med(casos.filter(c => c.minutos_antes != null && c.grupo === "ELEGIBLE").map(c => c.minutos_antes));
    d.urgentes = casos.filter(c => c.minutos_antes != null && c.minutos_antes <= 45 && c.grupo === "ELEGIBLE");
    d.canalOrigen = Object.entries(vig.reduce((m, i) => (m[i.canal_origen] = (m[i.canal_origen] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]);
    /* Esperas por etapa (mediana en minutos) desde los eventos registrados */
    const primero = (i, f) => (E[i.id] || []).filter(f).sort((a, b) => a.utc - b.utc)[0]?.utc;
    const tramo = (f1, f2) => med(vig.map(i => { const a = f1(i), b = f2(i); return a != null && b != null && b >= a ? (b - a) / 60 : null; }));
    const esDig = e => e.canal === "DIGITAL" && e.tipo !== "REPORTE_RECIBIDO", esBol = e => e.canal === "BOLETERIA";
    d.esperas = {
      reporte: tramo(i => i.apertura_utc, i => primero(i, esDig)),
      digital: tramo(i => primero(i, esDig), i => primero(i, e => ["DERIVACION", "ESCALAMIENTO", "RESOLUCION"].includes(e.tipo))),
      boleteria: tramo(i => primero(i, e => e.tipo === "DERIVACION"), i => primero(i, esBol)),
      ingreso: tramo(i => primero(i, esBol), i => i.resuelto_utc),
    };
    d.causas = CAUSAS.map(([k, cat, causa, mec, f, idea]) => { const L = f(d); return {k, cat, causa, mec, L, idea}; }).sort((a, b) => b.L.length - a.L.length);
    return d;
  }

  function generar(D, previo = {}, t = Math.floor(Date.now() / 1000)) {
    const d = analizar(D), I = d.ind, nat = D.r.naturaleza === "SINTETICO" ? "sintéticos" : "registrados";
    const base = `${d.total} incidencias, ${d.contactos} contactos y ${d.eventos} eventos ${nat}`, sello = regla => ({utc: t, base, regla});
    const top = d.motivos[0], vigN = d.vigentes || 1, umbralCausa = Math.max(2, Math.ceil(vigN * 0.1));
    const out = {};

    /* EM1 · Mapa de empatía */
    const dice = d.motivos.slice(0, 3).map(m => { const i = m.inc.find(x => x.descripcion) || m.inc[0]; return {cuadrante: "Dice", texto: `«${String(i.descripcion).slice(0, 140)}» (${m.motivo}, ${m.n} casos)`, clasificacion: "Declarado", evidencia: i.codigo}; });
    const can = d.canalOrigen.map(([c, n]) => `${CANAL[c] || c} ${fp(n, vigN)} %`).join(", ");
    out.EM1 = {_generado: sello("Dice = descripciones de los 3 motivos más frecuentes; Hace = canales y contactos; Piensa/Siente/Oye/Ve = inferencias por regla; Esfuerzos y Resultados = indicadores P-01."),
      perfil: `Cliente que compró por web o app y reporta una incidencia antes de su función (${d.vigentes} casos analizados; motivo principal: ${top?.motivo || "—"}).`,
      contexto: `Reporta con una mediana de ${d.minAntes != null ? fmt(d.minAntes, 0) : "—"} minutos antes del inicio; ${fp(d.urgentes.length, I.elegibles)} % de los casos elegibles llega con 45 minutos o menos. Base: ${base}.`,
      entradas: [...dice,
        {cuadrante: "Hace", texto: `Reporta por: ${can || "—"}.`, clasificacion: "Observado", evidencia: `${d.vigentes} incidencias`},
        {cuadrante: "Hace", texto: `Vuelve a contactar: ${d.multiContacto.length} casos con más de un contacto (${fmt(I.contactos_por_incidencia ?? 0, 2)} contactos por incidencia).`, clasificacion: "Observado", evidencia: codigos(d.multiContacto)},
        {cuadrante: "Piensa", texto: `Que perdió su dinero: ${fp(d.cobroOEmision.length, vigN)} % de los casos involucra cobro, pago pendiente o entrada no emitida.`, clasificacion: "Inferido", evidencia: codigos(d.cobroOEmision)},
        {cuadrante: "Siente", texto: `Urgencia: ${d.urgentes.length} de ${I.elegibles} casos elegibles reportan con 45 minutos o menos para la función.`, clasificacion: "Inferido", evidencia: codigos(d.urgentes)},
        {cuadrante: "Oye", texto: `Que debe ir a otro canal: ${d.conDerivacion.length} casos fueron derivados o escalados.`, clasificacion: "Inferido", evidencia: codigos(d.conDerivacion)},
        {cuadrante: "Ve", texto: `Que su compra aparece incompleta: ${d.cobroOEmision.length} casos con cobro o emisión sin resolver.`, clasificacion: "Inferido", evidencia: codigos(d.cobroOEmision)},
        {cuadrante: "Dolores", texto: `${I.sin_solucion + I.despues} de ${I.elegibles} casos elegibles no se resolvieron antes del inicio.`, clasificacion: "Observado", evidencia: codigos(d.casos.filter(c => ["SIN_SOLUCION", "DESPUES"].includes(c.resultado)))},
        {cuadrante: "Dolores", texto: `Repite su caso: ${d.duplicados.length} contactos duplicados o reingresos por otro canal.`, clasificacion: "Observado", evidencia: codigos(d.duplicados)},
        {cuadrante: "Ganancias", texto: `${I.a_tiempo} de ${I.elegibles} casos elegibles resueltos antes del inicio (${fmt(I.tasa ?? 0)} %).`, clasificacion: "Observado", evidencia: codigos(d.casos.filter(c => c.resultado === "A_TIEMPO"))},
        {cuadrante: "Ganancias", texto: `Mediana de atención: ${I.mediana_atencion_min != null ? fmt(I.mediana_atencion_min, 0) : "—"} minutos desde el reporte hasta la solución.`, clasificacion: "Observado", evidencia: "Indicadores"}]};

    /* EM2 · Mapa del cliente (esperas medianas por tramo, ánimo por regla) */
    const animo = (esp, fr) => lim(5 - (esp || 0) / 8 - (fr ? 1 : 0));
    const es = d.esperas, frTras = fp(d.conDerivacion.length, vigN), frEst = fp(d.cobroOEmision.length, vigN), une = (...x) => x.filter(Boolean).join("; ") || "—";
    const etapas = [
      ["1. Compra y pago", "Web o app", "Compra la entrada y paga en línea", "Recibir la entrada al instante", d.cobroOEmision.length ? `${frEst} % con cobro o emisión sin resolver` : "—", 0, 4, "Pago registrado"],
      ["2. Reporte del problema", "Web o app", "Reporta la incidencia desde la app", "Que alguien la atienda rápido", `Espera mediana ${fmt(es.reporte ?? 0, 0)} min hasta la primera atención`, es.reporte, null, `${d.vigentes} reportes registrados`],
      ["3. Atención Digital", "Atención Digital", "Explica el caso y espera la verificación", "Diagnóstico en el primer contacto", une(d.interrumpidas.length && `${d.interrumpidas.length} verificaciones interrumpidas`, d.conDerivacion.length && `${frTras} % derivados o escalados`), es.digital, null, `${I.a_tiempo} resueltos a tiempo en total`],
      ["4. Boletería", "Boletería", "Llega a la sede y retoma el caso", "No repetir la explicación", une(d.retomados.length && `${d.retomados.length} casos retomados`, d.multiContacto.length && `${d.multiContacto.length} casos con más de un contacto`), es.boleteria, null, "Caso retomado con código"],
      ["5. Ingreso a sala", "Ingreso a sala", "Ingresa a la función o recibe alternativa", "Entrar antes del inicio", I.sin_solucion ? `${I.sin_solucion} casos con la función iniciada sin solución` : "—", es.ingreso, null, `${fmt(I.tasa ?? 0)} % resuelto antes del inicio`],
    ].map(([etapa, canal, accion, expectativa, friccion, esp, a0, resultado]) => ({etapa, canal, accion, expectativa, friccion, espera_min: esp != null ? Math.round(esp) : 0, emocion: a0 ?? animo(esp, friccion !== "—"), resultado}));
    if (I.sin_solucion > 0) etapas[4].emocion = Math.min(etapas[4].emocion, 2);
    out.EM2 = {_generado: sello("Esperas = mediana de minutos entre eventos registrados de cada canal; ánimo = 5 − espera/8 − 1 si la etapa tiene fricción (escala 1 a 5)."),
      perfil: out.EM1.perfil, escenario: `Recorrido real de ${d.vigentes} casos desde la compra hasta el ingreso (${base}).`, etapas};

    /* DF1 · Causa-efecto (frecuencia de evidencia) */
    out.DF1 = {_generado: sello(`Cada causa se cuenta con casos que tienen su evidencia en los registros. Respaldada: ${umbralCausa} casos o más (10 % de los vigentes, mínimo 2); Hipótesis: 1 caso o más; Descartada: sin casos.`),
      efecto: `Solo ${I.a_tiempo} de ${I.elegibles} incidencias elegibles tienen solución verificada antes del inicio (${fmt(I.tasa ?? 0)} %): ${I.sin_solucion + I.despues} ya no la tuvieron y ${I.pendientes} siguen pendientes.`,
      causas: d.causas.map(c => ({categoria: c.cat, causa: c.causa, mecanismo: c.mec, evidencia: `${c.L.length} casos: ${codigos(c.L)}`, estado: c.L.length >= umbralCausa ? "Respaldada" : c.L.length ? "Hipótesis" : "Descartada", pendiente: c.L.length >= umbralCausa ? "" : c.L.length ? "Confirmar con más casos" : "Sin evidencia en los registros actuales"}))};
    const resp = d.causas.filter(c => c.L.length >= umbralCausa), activas = d.causas.filter(c => c.L.length > 0), c1 = resp[0] || activas[0] || d.causas[0];

    /* DF2 · Punto de vista */
    const pe = etapas.slice(1).reduce((m, e) => e.emocion < m.emocion ? e : m, etapas[1]);
    out.DF2 = {_generado: sello("Hallazgo = causa respaldada con más casos + etapa de menor ánimo del mapa del cliente; indicador P-01; criterio fijo de +5 pp sobre la tasa actual."),
      usuario: "Cliente con incidencia de compra digital y función próxima.", necesidad: "Obtener una solución antes del inicio sin repetir su caso en cada canal.",
      hallazgo: `${c1.causa} (${c1.L.length} casos); el momento crítico es «${pe.etapa.replace(/^\d+\.\s*/, "")}» con ánimo ${pe.emocion} de 5 (EM2, DF1).`,
      pregunta: `¿Cómo podríamos ayudar al cliente a obtener una solución antes del inicio de su función, evitando que «${c1.causa.toLowerCase()}»?`,
      alcance: `Piloto ${Nucleo.PILOTO}; ${d.motivos.length} motivos con casos (${d.motivos.slice(0, 4).map(m => m.tipo).join(", ")}${d.motivos.length > 4 ? "…" : ""}); canales app, Atención Digital y Boletería.`,
      indicador: "Incidencias elegibles con solución verificada antes del inicio / incidencias elegibles abiertas antes del inicio",
      criterio: `+5 puntos porcentuales sobre la tasa actual (${fmt(I.tasa ?? 0)} %) en escenarios equivalentes.`};

    /* ID1 · Brainwriting (ronda 1: causas respaldadas; ronda 2: hipótesis; ronda 3: alternativa de contraste) */
    const ideas = [], vistas = new Set(), push = (k, ronda, n) => { if (vistas.has(k)) return; vistas.add(k); const x = IDEAS[k]; ideas.push({idea: x[0], mecanismo: x[1], usuario: x[2], beneficio: `${x[3]} (${n} casos)`, supuesto: x[4], ronda, _k: k, _n: n}); };
    resp.slice(0, 3).forEach(c => push(c.idea, 1, c.L.length));
    activas.filter(c => !vistas.has(c.idea)).slice(0, 3).forEach(c => push(c.idea, 2, c.L.length));
    if (d.cobroOEmision.length) push("reembolso", 3, d.cobroOEmision.length);
    for (const c of d.causas) { if (ideas.length >= 3) break; push(c.idea, 3, c.L.length); }
    out.ID1 = {_generado: sello("Cada causa con evidencia activa una idea del catálogo: ronda 1 = causas respaldadas, ronda 2 = hipótesis, ronda 3 = alternativa de contraste."),
      reto: "DF2 · ¿Cómo podríamos…?", ideas: ideas.map(({_k, _n, ...x}) => x)};

    /* ID2 · Matriz (valor = casos que atiende frente al máximo; factibilidad, viabilidad y riesgo del catálogo) */
    const maxN = Math.max(1, ...ideas.map(x => x._n));
    const filas = ideas.map(x => { const k = IDEAS[x._k]; return {idea: x.idea, valor: lim(1 + 4 * x._n / maxN), factibilidad: k[6], viabilidad: k[7], riesgo: k[5], motivo: `Atiende ${x._n} casos; riesgo: ${k[8]}`}; });
    const rk = DT.ranking(filas), elegida = rk[0];
    out.ID2 = {_generado: sello("Valor = 1 + 4 × casos que atiende ÷ casos de la idea con más casos; factibilidad, viabilidad y control del riesgo según el catálogo de ideas. La propuesta es la de mayor puntaje ponderado; la elección la confirma el usuario responsable."),
      seleccion: elegida?.idea || "", justificacion: elegida ? `Mayor puntaje ponderado (${fmt(elegida.puntaje, 2)} de 5): ${elegida.motivo}.${rk[1] && rk[1].puntaje === elegida.puntaje ? ` Empata con «${rk[1].idea}»; se propone por orden de valor y factibilidad.` : ""}` : "", confirmado_por: "", filas};

    /* PR1 · Guion gráfico desde el caso real más representativo (resuelto a tiempo con más traspasos) */
    const repr = D.inc.map(i => ({i, c: D.r.casos.find(c => c.codigo === i.codigo), ev: (D.E[i.id] || []).sort((a, b) => a.utc - b.utc)})).filter(x => x.c?.resultado === "A_TIEMPO")
      .sort((a, b) => new Set(b.ev.map(e => e.canal)).size - new Set(a.ev.map(e => e.canal)).size || b.ev.length - a.ev.length)[0];
    let escenas = [];
    if (repr) escenas = repr.ev.filter(e => e.tipo !== "ASIGNACION_AUTOMATICA").slice(0, 6).map((e, k, L) => ({tipo: "Normal", titulo: `${k + 1}. ${e.tipo.replace(/_/g, " ").toLowerCase().replace(/^./, s => s.toUpperCase())}`, actor: e.actor, accion: String(e.detalle).slice(0, 160), respuesta: `Queda registrado en ${repr.i.codigo} (regla ${e.regla || "—"})`, traspaso: L[k + 1] ? (CANAL[L[k + 1].canal] || L[k + 1].canal) : "Caso resuelto"}));
    const plantilla = ["Reporta desde la app", "Atención Digital verifica la compra", "Deriva a Boletería con código", "Boletería resuelve y registra evidencia"];
    while (escenas.filter(e => e.tipo === "Normal").length < 4) { const k = escenas.length; escenas.push({tipo: "Normal", titulo: `${k + 1}. ${plantilla[k] || "Cierre"}`, actor: ["Cliente", "Atención Digital", "Atención Digital", "Boletería"][k] || "Boletería", accion: plantilla[k] || "Cierre del caso", respuesta: "Paso de la plantilla (sin evento registrado)", traspaso: "Siguiente canal"}); }
    const ex = D.ev.find(e => e.tipo === "VERIFICACION_INTERRUMPIDA") || D.ev.find(e => e.tipo === "ESCALAMIENTO");
    escenas.push({tipo: "Excepción", titulo: `E1. ${ex ? ex.tipo.replace(/_/g, " ").toLowerCase().replace(/^./, s => s.toUpperCase()) : "Servicio no disponible"}`, actor: ex?.actor || "Sistema", accion: ex ? String(ex.detalle).slice(0, 160) : "La verificación no responde", respuesta: "El caso sigue abierto con datos locales y responsable visible", traspaso: "Supervisión revisa si vence la ventana"});
    out.PR1 = {_generado: sello(repr ? `Escenas tomadas de los eventos reales de ${repr.i.codigo} (caso resuelto a tiempo con más canales); excepción tomada del primer evento de interrupción o escalamiento registrado.` : "Sin caso resuelto a tiempo: se usa la plantilla del flujo propuesto."),
      idea: out.ID2.seleccion, escenas};

    /* PR2 · Fichas con materiales de bajo costo y costo calculado */
    const ficha = (tipo, nombre, hip, tarea, roles) => { const m = FICHAS[tipo].map(k => MAT[k]); return {tipo, nombre, version: "v1", hipotesis: hip, materiales: m.map(x => x[0]).join(", "), costo: Math.round(m.reduce((s, x) => s + x[1], 0) * 100) / 100, tarea, roles}; };
    const sel = out.ID2.seleccion || "Expediente único con código compartido";
    out.PR2 = {_generado: sello("Materiales del catálogo de bajo costo con precio referencial (supuesto); el costo es la suma. Ficha física = soporte visible del código; ficha de servicio = juego de roles del traspaso."),
      fichas: [ficha("FÍSICO", `Tarjeta de caso · ${sel}`, `Con la tarjeta, Boletería retoma el caso sin preguntar de nuevo (${d.conDerivacion.length} casos derivados o escalados).`, "Retomar un caso derivado en menos de 2 minutos", "Atención Digital entrega el código; Boletería lo lee; si falta la tarjeta se busca por pedido."),
        ficha("SERVICIO", `Juego de roles · ${sel}`, `El traspaso con código reduce los casos sin solución antes del inicio (${I.sin_solucion + I.despues} hoy).`, "Resolver un caso crítico (≤ 15 min) de punta a punta", "Cliente, Atención Digital y Boletería; el moderador cronometra; contingencia: verificación en modo local.")]};

    /* PV1 · Prueba con los casos registrados (cada caso elegible es un intento) */
    const el = D.r.casos.filter(c => c.grupo === "ELEGIBLE" && c.resultado !== "PENDIENTE");
    const escalados = new Set(D.inc.filter(i => (D.E[i.id] || []).some(e => e.tipo === "ESCALAMIENTO")).map(i => i.codigo));
    const umbral = previo.PV1?.umbral || "80";
    out.PV1 = {_generado: sello("Cada caso elegible cerrado es un intento: éxito = resuelto antes del inicio con evidencia; ayuda = fue escalado; error crítico = la función empezó sin solución; tiempo = minutos de atención."),
      protocolo: `Prueba con ${el.length} casos registrados del flujo actual (${base}). Tarea = motivo del caso; participante = código de incidencia. Umbral previo conservado de la versión anterior.`, umbral,
      intentos: el.map(c => ({tarea: `Resolver «${c.motivo}»`, participante: c.codigo, version: "Flujo actual", tiempo_s: c.minutos_atencion != null ? c.minutos_atencion * 60 : Math.max(0, (c.inicio_utc - c.apertura_utc)), exito: c.resultado === "A_TIEMPO" ? "Sí" : "No", ayuda: escalados.has(c.codigo) ? "Sí" : "No", error: c.resultado === "SIN_SOLUCION" ? "Sí" : "No", naturaleza: D.r.naturaleza === "SINTETICO" ? "Ensayo sintético" : "Prueba ejecutada", observacion: `${{A_TIEMPO: "Resuelto a tiempo", DESPUES: "Resuelto después del inicio", SIN_SOLUCION: "Sin solución al inicio"}[c.resultado] || c.resultado} · reportó ${c.minutos_antes} min antes del inicio`}))};

    /* PV2 · Mejoras por motivo con peor resultado y decisión propuesta por regla */
    const pr = DT.resumenPrueba(out.PV1), sim = Resultados.simularCon(D.r), dpp = sim.diferencia_pp ?? 0;
    const decision = pr.cumple ? "Ampliar el piloto" : dpp >= 5 ? "Iterar el prototipo" : "Descartar la idea";
    const peores = [...d.porMotivo].filter(m => m.elegibles > 0).sort((a, b) => (a.tasa ?? 0) - (b.tasa ?? 0)).slice(0, 3);
    out.PV2 = {_generado: sello(`Decisión propuesta: «Ampliar» si la prueba cumple el umbral; «Iterar» si no lo cumple pero la simulación mejora 5 pp o más (hoy ${fmt(dpp)} pp); «Descartar» en otro caso. Mejoras = 3 motivos con menor tasa a tiempo. La decisión la confirma el usuario responsable.`),
      decision, limitaciones: `Datos ${nat} (${base}); ${pr.intentos} intentos; la simulación usa semilla ${sim.semilla} y ${sim.n} episodios. Requiere validación de campo antes de ampliar.`, confirmado_por: "",
      mejoras: peores.map(m => ({hallazgo: `«${m.motivo}»: ${m.a_tiempo} de ${m.elegibles} a tiempo (${fmt(m.tasa ?? 0)} %)`, evidencia: codigos(d.casos.filter(c => c.motivo === m.motivo && c.grupo === "ELEGIBLE")), mejora: (() => { const t = d.casos.find(c => c.motivo === m.motivo)?.tipo, k = ["T01", "T02", "T03", "T04"].includes(t) ? "estado" : t === "T05" ? "boleteria" : ["T06", "T07"].includes(t) ? "cambio" : t === "T08" ? "duplicado" : null; return k && IDEAS[k][0] !== out.ID2.seleccion ? `${out.ID2.seleccion} + ${IDEAS[k][0].toLowerCase()}` : `${out.ID2.seleccion}: aplicar primero a este motivo`; })(), version: "v2", prioridad: (m.tasa ?? 0) < 50 ? "Alta" : (m.tasa ?? 0) < 80 ? "Media" : "Baja"}))};
    if (!out.PV2.mejoras.length) out.PV2.mejoras = [{hallazgo: "Sin casos elegibles cerrados", evidencia: "—", mejora: "Registrar o cargar más casos", version: "v2", prioridad: "Alta"}];
    return {contenidos: out, base, d};
  }

  /* Huella de los datos: cambia cuando se agrega o modifica una incidencia, contacto, evento o verificación */
  const huella = D => [D.inc.length, Math.max(0, ...D.inc.map(i => i.actualizado_utc || 0)), D.inc.reduce((t, i) => t + (i.version || 1), 0), D.ev.length, D.ct.length, Object.values(D.V).flat().length].join("-");
  const SEMILLA_AUTOR = "Equipo de análisis (contenido inicial simulado)";
  const sinSello = c => { const {_generado, ...x} = c || {}; return JSON.stringify(x); };
  function conservar(cod, nuevo, ant) {
    if (cod === "ID2" && ant.confirmado_por && ant.seleccion === nuevo.seleccion) nuevo.confirmado_por = ant.confirmado_por;
    if (cod === "PV2" && ant.confirmado_por && ant.decision === nuevo.decision) nuevo.confirmado_por = ant.confirmado_por;
    if (cod === "PV1" && ant.umbral) nuevo.umbral = ant.umbral;
  }

  /* Genera y guarda. forzar = también reemplaza herramientas editadas a mano. Conserva la confirmación humana si la propuesta no cambió. */
  async function ejecutar(A, usuario, avance = () => {}, forzar = true) {
    const p = await Nucleo.proyecto(A); avance("Leyendo incidencias, contactos y eventos");
    const D = await cargar(A); if (!D.inc.length) throw Object.assign(new Error("No hay incidencias registradas: cargue datos antes de generar."), {codigo: "VALIDACION"});
    const vs = await DT.versiones(A, p.id), vg = DT.vigente(vs), previo = Object.fromEntries(Object.entries(vg).map(([k, v]) => [k, JSON.parse(v.contenido)]));
    const h = huella(D); avance("Aplicando reglas a las 10 herramientas"); const g = generar(D, previo);
    const res = [], manuales = [];
    for (const cod of DT.ORDEN) {
      const v = vg[cod], ant = previo[cod] || {}, auto = !v || !!ant._generado || v.autor === SEMILLA_AUTOR, nuevo = g.contenidos[cod];
      nuevo._generado.huella = h;
      if (!auto && !forzar) { manuales.push(cod); continue; }
      conservar(cod, nuevo, ant);
      if (v && ant._generado && sinSello(ant) === sinSello(nuevo)) continue; /* sin cambios: no se crea versión */
      avance(`Guardando ${DT.H[cod].nombre}`); res.push({codigo: cod, ...(await DT.guardar(A, p.id, cod, nuevo, null, usuario))});
    }
    return {base: g.base, huella: h, resultados: res, manuales, perdidas: ["ID2", "PV2"].filter(k => previo[k]?.confirmado_por && !(g.contenidos[k].confirmado_por))};
  }

  /* Sincronización automática: si los datos cambiaron desde la última generación, actualiza las herramientas automáticas. */
  let enCurso = null;
  async function pendiente(A) {
    const p = await Nucleo.proyecto(A), D = await cargar(A); if (!D.inc.length) return null;
    const vg = DT.vigente(await DT.versiones(A, p.id)), previo = Object.fromEntries(Object.entries(vg).map(([k, v]) => [k, JSON.parse(v.contenido)])), g = generar(D, previo);
    const viejas = DT.ORDEN.filter(c => { const v = vg[c], ant = previo[c] || {}; if (v && !ant._generado && v.autor !== SEMILLA_AUTOR) return false; if (!v || !ant._generado) return true; conservar(c, g.contenidos[c], ant); return sinSello(ant) !== sinSello(g.contenidos[c]); });
    return viejas.length ? {herramientas: viejas} : null;
  }
  function sincronizar(A, usuario, avance) {
    if (enCurso) return enCurso;
    enCurso = (async () => { try { const pend = await pendiente(A); if (!pend) return null; return await ejecutar(A, usuario, avance, false); } finally { enCurso = null; } })();
    return enCurso;
  }

  G.DTAuto = {cargar, porSede, analizar, generar, ejecutar, sincronizar, pendiente, huella, IDEAS, CAUSAS, MAT};
})(typeof window !== "undefined" ? window : globalThis);
