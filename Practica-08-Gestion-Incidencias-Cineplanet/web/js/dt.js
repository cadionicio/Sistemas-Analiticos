"use strict";
/* Design Thinking: 5 etapas, 10 herramientas, versiones, completitud, validación y avance. Común a PC08.exe y PC08.html. */
const DT = (() => {
  const CLASIF = ["Observado", "Declarado", "Inferido", "Simulado"];
  const SN = ["Sí", "No"];
  const ETAPAS = [["EMPATIZAR", "Empatizar"], ["DEFINIR", "Definir"], ["IDEAR", "Idear"], ["PROTOTIPAR", "Prototipar"], ["PROBAR", "Probar"]];
  const PESOS = {valor: 0.40, factibilidad: 0.25, viabilidad: 0.20, riesgo: 0.15};
  /* Esquema por herramienta: campos simples y listas con columnas [clave, título, tipo, opciones] */
  const H = {
    EM1: {etapa: "EMPATIZAR", nombre: "Mapa de empatía", pantalla: 21, campos: [["perfil", "Perfil del usuario"], ["contexto", "Contexto del episodio"]],
      listas: {entradas: {titulo: "Entradas del mapa", cols: [["cuadrante", "Cuadrante", "sel", ["Dice", "Hace", "Piensa", "Siente", "Oye", "Ve", "Dolores", "Ganancias"]], ["texto", "Contenido", "txt"], ["clasificacion", "Tipo de evidencia", "sel", CLASIF], ["evidencia", "Respaldo (código)", "txt"]]}}},
    EM2: {etapa: "EMPATIZAR", nombre: "Mapa del cliente", pantalla: 22, campos: [["perfil", "Perfil"], ["escenario", "Escenario"]],
      listas: {etapas: {titulo: "Etapas del recorrido", cols: [["etapa", "Etapa", "txt"], ["canal", "Canal", "sel", ["Web o app", "Atención Digital", "Boletería", "Ingreso a sala"]], ["accion", "Acción del cliente", "txt"], ["expectativa", "Expectativa", "txt"], ["friccion", "Fricción o dato faltante", "txt"], ["espera_min", "Espera (min)", "num"], ["emocion", "Ánimo (1–5)", "num"], ["resultado", "Resultado", "txt"]]}}},
    DF1: {etapa: "DEFINIR", nombre: "Diagrama causa-efecto", pantalla: 23, campos: [["efecto", "Efecto (problema)"]],
      listas: {causas: {titulo: "Causas e hipótesis", cols: [["categoria", "Categoría", "sel", ["Personas", "Proceso", "Datos", "Recursos", "Reglas", "Entorno"]], ["causa", "Causa", "txt"], ["mecanismo", "Mecanismo", "txt"], ["evidencia", "Evidencia a favor o en contra", "txt"], ["estado", "Estado", "sel", ["Hipótesis", "Respaldada", "Descartada"]], ["pendiente", "Dato pendiente", "txt"]]}}},
    DF2: {etapa: "DEFINIR", nombre: "Punto de vista y «¿Cómo podríamos…?»", pantalla: 24, campos: [["usuario", "Usuario"], ["necesidad", "Necesidad"], ["hallazgo", "Porque (hallazgo)"], ["pregunta", "¿Cómo podríamos…?"], ["alcance", "Alcance"], ["indicador", "Indicador de éxito"], ["criterio", "Criterio de éxito"]], listas: {}},
    ID1: {etapa: "IDEAR", nombre: "Brainwriting", pantalla: 25, campos: [["reto", "Reto de entrada"]],
      listas: {ideas: {titulo: "Ideas (rondas 6-3-5 simplificadas)", cols: [["idea", "Idea", "txt"], ["mecanismo", "Cómo funciona", "txt"], ["usuario", "Usuario beneficiado", "txt"], ["beneficio", "Beneficio esperado", "txt"], ["supuesto", "Supuesto a probar", "txt"], ["ronda", "Ronda", "num"]]}}},
    ID2: {etapa: "IDEAR", nombre: "Matriz de priorización", pantalla: 26, campos: [["seleccion", "Idea seleccionada"], ["justificacion", "Justificación"], ["confirmado_por", "Elección confirmada por (usuario responsable)"]],
      listas: {filas: {titulo: "Valoración (1 a 5; 5 = más favorable)", cols: [["idea", "Idea", "txt"], ["valor", "Valor 40 %", "num"], ["factibilidad", "Factibilidad 25 %", "num"], ["viabilidad", "Viabilidad 20 %", "num"], ["riesgo", "Control del riesgo 15 %", "num"], ["motivo", "Motivo", "txt"]]}}},
    PR1: {etapa: "PROTOTIPAR", nombre: "Guion gráfico", pantalla: 27, campos: [["idea", "Idea que se prototipa"]],
      listas: {escenas: {titulo: "Escenas", cols: [["tipo", "Ruta", "sel", ["Normal", "Excepción"]], ["titulo", "Escena", "txt"], ["actor", "Actor", "txt"], ["accion", "Acción", "txt"], ["respuesta", "Respuesta observable", "txt"], ["traspaso", "Traspaso / responsable", "txt"]]}}},
    PR2: {etapa: "PROTOTIPAR", nombre: "Fichas de prototipo de baja fidelidad", pantalla: 28, campos: [],
      listas: {fichas: {titulo: "Fichas", cols: [["tipo", "Tipo", "sel", ["FÍSICO", "SERVICIO"]], ["nombre", "Nombre", "txt"], ["version", "Versión", "txt"], ["hipotesis", "Hipótesis", "txt"], ["materiales", "Materiales o insumos", "txt"], ["costo", "Costo (S/)", "num"], ["tarea", "Tarea que se ensaya", "txt"], ["roles", "Roles, traspaso y contingencia", "txt"]]}}},
    PV1: {etapa: "PROBAR", nombre: "Prueba moderada por tareas", pantalla: 29, campos: [["protocolo", "Protocolo"], ["umbral", "Umbral previo (% de éxito sin ayuda)"]],
      listas: {intentos: {titulo: "Intentos registrados", cols: [["tarea", "Tarea", "txt"], ["participante", "Participante (código)", "txt"], ["version", "Versión", "txt"], ["tiempo_s", "Tiempo (s)", "num"], ["exito", "Éxito", "sel", SN], ["ayuda", "Con ayuda", "sel", SN], ["error", "Error crítico", "sel", SN], ["naturaleza", "Naturaleza", "sel", ["Ensayo sintético", "Prueba ejecutada", "Validación de campo"]], ["observacion", "Observación", "txt"]]}}},
    PV2: {etapa: "PROBAR", nombre: "Resultados, mejoras y decisión", pantalla: 30, campos: [["decision", "Decisión", "sel", ["Iterar el prototipo", "Ampliar el piloto", "Descartar la idea"]], ["limitaciones", "Limitaciones"], ["confirmado_por", "Decisión confirmada por (usuario responsable)"]],
      listas: {mejoras: {titulo: "Hallazgos y mejoras", cols: [["hallazgo", "Hallazgo", "txt"], ["evidencia", "Evidencia", "txt"], ["mejora", "Mejora", "txt"], ["version", "Versión destino", "txt"], ["prioridad", "Prioridad", "sel", ["Alta", "Media", "Baja"]]]}}},
  };
  const ORDEN = ["EM1", "EM2", "DF1", "DF2", "ID1", "ID2", "PR1", "PR2", "PV1", "PV2"];

  /* ---------------- reglas de completitud (Programación §6) ---------------- */
  const lleno = x => String(x ?? "").trim().length > 0;
  /* «Oye» y «Ve» (v0.7.0) son opcionales: la regla de completitud sigue exigiendo los seis cuadrantes originales */
  const EM1_OBLIGATORIOS = ["Dice", "Hace", "Piensa", "Siente", "Dolores", "Ganancias"];
  function faltantes(cod, c) {
    const f = [], h = H[cod];
    for (const [k, t] of h.campos) if (!lleno(c[k])) f.push(`Completar «${t}»`);
    const L = k => (c[k] || []).filter(r => Object.values(r).some(lleno));
    if (cod === "EM1") { for (const q of EM1_OBLIGATORIOS) if (!L("entradas").some(r => r.cuadrante === q && lleno(r.texto))) f.push(`Agregar al menos una entrada en «${q}»`);
      if (L("entradas").some(r => !lleno(r.clasificacion))) f.push("Clasificar cada entrada (observado, declarado, inferido o simulado)"); }
    if (cod === "EM2" && L("etapas").length < 4) f.push("Registrar al menos 4 etapas del recorrido");
    if (cod === "EM2" && L("etapas").some(r => !lleno(r.friccion) && !lleno(r.resultado))) f.push("Cada etapa necesita fricción o resultado");
    if (cod === "DF1") { if (L("causas").length < 4) f.push("Registrar al menos 4 causas"); if (new Set(L("causas").map(r => r.categoria)).size < 3) f.push("Cubrir al menos 3 categorías de causas"); }
    if (cod === "ID1" && L("ideas").length < 3) f.push("Registrar al menos 3 ideas");
    if (cod === "ID2") { if (L("filas").length < 3) f.push("Valorar al menos 3 ideas");
      if (L("filas").some(r => ["valor", "factibilidad", "viabilidad", "riesgo"].some(k => !(Number(r[k]) >= 1 && Number(r[k]) <= 5)))) f.push("Puntajes entre 1 y 5 en todos los criterios");
      if (lleno(c.seleccion) && !L("filas").some(r => r.idea === c.seleccion)) f.push("La idea seleccionada debe estar en la matriz"); }
    if (cod === "PR1") { if (L("escenas").filter(r => r.tipo === "Normal").length < 4) f.push("Al menos 4 escenas de la ruta normal"); if (!L("escenas").some(r => r.tipo === "Excepción")) f.push("Al menos una escena de excepción"); }
    if (cod === "PR2") { for (const t of ["FÍSICO", "SERVICIO"]) if (!L("fichas").some(r => r.tipo === t)) f.push(`Agregar la ficha ${t === "FÍSICO" ? "física" : "de servicio"}`);
      if (L("fichas").some(r => !lleno(r.hipotesis) || !lleno(r.materiales) || r.costo === "" || r.costo == null)) f.push("Cada ficha necesita hipótesis, materiales y costo"); }
    if (cod === "PV1" && L("intentos").length < 3) f.push("Registrar al menos 3 intentos");
    if (cod === "PV2" && L("mejoras").length < 1) f.push("Registrar al menos un hallazgo con mejora");
    return f;
  }
  function puntaje(r) { return Math.round((PESOS.valor * r.valor + PESOS.factibilidad * r.factibilidad + PESOS.viabilidad * r.viabilidad + PESOS.riesgo * r.riesgo) * 100) / 100; }
  function ranking(filas) {
    return (filas || []).filter(r => r.idea).map(r => ({...r, puntaje: puntaje({valor: +r.valor, factibilidad: +r.factibilidad, viabilidad: +r.viabilidad, riesgo: +r.riesgo})}))
      .sort((a, b) => b.puntaje - a.puntaje || b.valor - a.valor || b.factibilidad - a.factibilidad);
  }
  function resumenPrueba(c, umbralTexto) {
    const it = (c.intentos || []).filter(r => r.tarea), ok = it.filter(r => r.exito === "Sí" && r.ayuda === "No" && r.error === "No").length;
    const umbral = Number(String(umbralTexto ?? c.umbral ?? "").replace(/[^\d.,]/g, "").replace(",", ".")) || null;
    const tasa = it.length ? ok / it.length * 100 : null;
    return {intentos: it.length, exitos: ok, tasa, umbral, cumple: tasa != null && umbral != null ? tasa >= umbral : null, porNaturaleza: it.reduce((m, r) => (m[r.naturaleza] = (m[r.naturaleza] || 0) + 1, m), {})};
  }

  /* ---------------- contenido inicial v1 (sintético, rotulado) ---------------- */
  const S = "Simulado";
  const INICIAL = {
    EM1: {perfil: "María, 29 años, compra por app para la función de las 19:30 en CP Alcázar (perfil sintético).", contexto: "Pagó con tarjeta, no ve su entrada y faltan 25 minutos para la función.",
      entradas: [
        {cuadrante: "Dice", texto: "«Ya me cobraron, pero no aparece mi entrada en la app».", clasificacion: "Declarado", evidencia: "INC-0126"},
        {cuadrante: "Dice", texto: "«Ya expliqué esto por el chat, ¿tengo que repetirlo?».", clasificacion: S, evidencia: "INC-0130"},
        {cuadrante: "Hace", texto: "Revisa el correo, reinstala la app y luego va a boletería con captura del cobro.", clasificacion: S, evidencia: "EM2 etapa 3"},
        {cuadrante: "Piensa", texto: "Que perderá la función y que el cobro puede no devolverse.", clasificacion: "Inferido", evidencia: "—"},
        {cuadrante: "Siente", texto: "Ansiedad creciente a medida que se acerca la hora de inicio.", clasificacion: "Inferido", evidencia: "—"},
        {cuadrante: "Oye", texto: "Amigos le dicen que en boletería «siempre lo resuelven», pero que la devolución tarda.", clasificacion: S, evidencia: "—"},
        {cuadrante: "Ve", texto: "La cola en boletería y el contador de la función que avanza en la app.", clasificacion: S, evidencia: "EM2 etapa 4"},
        {cuadrante: "Dolores", texto: "Repetir datos en cada canal; no saber quién tiene su caso.", clasificacion: S, evidencia: "INC-0130"},
        {cuadrante: "Ganancias", texto: "Entrar a tiempo con un solo código y saber el siguiente paso.", clasificacion: "Inferido", evidencia: "DF2"},
      ]},
    EM2: {perfil: "Cliente con compra digital y función próxima (sintético).", escenario: "Cobro sin entrada, 25 min antes de la función en CP Alcázar.",
      etapas: [
        {etapa: "1. Compra en app", canal: "Web o app", accion: "Paga 2 entradas", expectativa: "Recibir la entrada al instante", friccion: "La confirmación no llega", espera_min: 2, emocion: 3, resultado: "Cobro visible sin entrada"},
        {etapa: "2. Reporte", canal: "Web o app", accion: "Reporta la incidencia", expectativa: "Respuesta clara", friccion: "No sabe si el reporte llegó", espera_min: 3, emocion: 2, resultado: "Código INC asignado"},
        {etapa: "3. Atención Digital", canal: "Atención Digital", accion: "Espera verificación", expectativa: "Que revisen su pago", friccion: "Estado de compra, pago y emisión dispersos", espera_min: 6, emocion: 2, resultado: "Pago confirmado, emisión pendiente"},
        {etapa: "4. Boletería", canal: "Boletería", accion: "Se acerca con su código", expectativa: "No repetir datos", friccion: "Sin el código el agente empieza de cero", espera_min: 5, emocion: 2, resultado: "Retoma con el mismo expediente"},
        {etapa: "5. Ingreso", canal: "Ingreso a sala", accion: "Valida su entrada", expectativa: "Entrar antes del inicio", friccion: "—", espera_min: 1, emocion: 4, resultado: "Ingresa 9 min antes"},
      ]},
    DF1: {efecto: "Incidencias de compra digital resueltas tarde o repetidas al cambiar de canal.",
      causas: [
        {categoria: "Datos", causa: "El estado de la compra llega incompleto al canal de atención", mecanismo: "Compra, pago y emisión se consultan en sistemas distintos", evidencia: "INC-0126: pago confirmado y emisión por verificar", estado: "Hipótesis", pendiente: "Registros autorizados de emisión"},
        {categoria: "Proceso", causa: "Los contactos de una incidencia quedan dispersos", mecanismo: "Cada canal abre su propio caso", evidencia: "INC-0130 duplica INC-0122", estado: "Respaldada", pendiente: "Tasa real de duplicados"},
        {categoria: "Reglas", causa: "La cercanía de la función pesa poco en la prioridad", mecanismo: "La cola se ordena por llegada", evidencia: "Bandeja sintética: críticos detrás de casos normales", estado: "Hipótesis", pendiente: "Reglas internas de priorización"},
        {categoria: "Personas", causa: "El agente no sabe quién es responsable del siguiente paso", mecanismo: "La derivación no registra responsable ni hora esperada", evidencia: "EM2 etapa 4", estado: "Hipótesis", pendiente: "Observación en sede"},
        {categoria: "Entorno", causa: "Demora del medio de pago (explicación alternativa)", mecanismo: "La confirmación externa tarda más que la ventana útil", evidencia: "INC-0127 sin respuesta del servicio", estado: "Hipótesis", pendiente: "Tiempos del procesador de pagos"},
      ]},
    DF2: {usuario: "Cliente con incidencia de compra digital y función próxima", necesidad: "Obtener una solución antes del inicio sin repetir su caso en cada canal", hallazgo: "El estado y el responsable se pierden al pasar de la app a atención digital y a boletería (EM2, DF1)",
      pregunta: "¿Cómo podríamos ayudar al cliente a obtener una solución antes del inicio de su función, conservando la información y el responsable del caso al cambiar de canal?", alcance: "Piloto CP Alcázar; 8 tipos prioritarios; canales app, Atención Digital y Boletería",
      indicador: "Incidencias elegibles con solución verificada antes del inicio / incidencias elegibles abiertas antes del inicio", criterio: "Mejora de al menos 5 puntos porcentuales frente al flujo actual en escenarios equivalentes"},
    ID1: {reto: "DF2 · ¿Cómo podríamos…?",
      ideas: [
        {idea: "Expediente único con código compartido", mecanismo: "Un código INC visible para cliente, Atención Digital y Boletería", usuario: "Cliente y agentes", beneficio: "Sin repetir datos", supuesto: "El cliente conserva el código", ronda: 1},
        {idea: "Prioridad por minutos a la función", mecanismo: "Crítico ≤15 min, urgente ≤45 min", usuario: "Agentes", beneficio: "Atender primero lo que vence", supuesto: "La hora de función es confiable", ronda: 1},
        {idea: "Tarjeta física de traspaso en boletería", mecanismo: "Tarjeta con código, estado y siguiente paso", usuario: "Personal de boletería", beneficio: "Retomar sin sistema adicional", supuesto: "El personal la completa", ronda: 2},
        {idea: "Reembolso automático ante cualquier cobro sin entrada", mecanismo: "Devolver sin verificar", usuario: "Cliente", beneficio: "Rapidez", supuesto: "El costo es aceptable", ronda: 2},
      ]},
    ID2: {seleccion: "Expediente único con código compartido", justificacion: "Mayor valor para el usuario y factible con datos existentes; combina con la prioridad por minutos.", confirmado_por: "",
      filas: [
        {idea: "Expediente único con código compartido", valor: 5, factibilidad: 4, viabilidad: 4, riesgo: 4, motivo: "Ataca la causa de dispersión"},
        {idea: "Prioridad por minutos a la función", valor: 4, factibilidad: 5, viabilidad: 4, riesgo: 4, motivo: "Regla simple y medible"},
        {idea: "Tarjeta física de traspaso en boletería", valor: 3, factibilidad: 5, viabilidad: 5, riesgo: 3, motivo: "Bajo costo; complemento del expediente"},
        {idea: "Reembolso automático ante cualquier cobro sin entrada", valor: 3, factibilidad: 3, viabilidad: 2, riesgo: 1, motivo: "Riesgo de fraude y costo"},
      ]},
    PR1: {idea: "Expediente único con código compartido",
      escenas: [
        {tipo: "Normal", titulo: "1. Reporte en app", actor: "Cliente", accion: "Reporta cobro sin entrada", respuesta: "Recibe INC-0126 y prioridad", traspaso: "Atención Digital"},
        {tipo: "Normal", titulo: "2. Verificación", actor: "Atención Digital", accion: "Verifica compra, pago y emisión", respuesta: "Estados separados visibles", traspaso: "Atención Digital"},
        {tipo: "Normal", titulo: "3. Derivación", actor: "Atención Digital", accion: "Deriva a boletería con siguiente paso", respuesta: "Responsable y hora esperada", traspaso: "Boletería CP Alcázar"},
        {tipo: "Normal", titulo: "4. Resolución", actor: "Boletería", accion: "Retoma por código y resuelve", respuesta: "Resolución con evidencia antes del inicio", traspaso: "Cierre"},
        {tipo: "Excepción", titulo: "E1. Validación sin respuesta", actor: "Atención Digital", accion: "El servicio de pagos no responde", respuesta: "Caso abierto con datos locales; reintento o escalamiento", traspaso: "Validación de pagos"},
      ]},
    PR2: {fichas: [
      {tipo: "FÍSICO", nombre: "Tarjeta de traspaso en boletería", version: "v1", hipotesis: "Con la tarjeta, el agente retoma sin volver a pedir datos", materiales: "Cartulina A6, plumón, sello de hora, porta-tarjetas", costo: 12, tarea: "Retomar INC-0126 en menos de 2 min", roles: "Atención Digital llena; boletería recibe; si falta dato, llamar a supervisión"},
      {tipo: "SERVICIO", nombre: "Ensayo del traspaso entre canales", version: "v1", hipotesis: "El responsable y el siguiente paso se conservan al cambiar de canal", materiales: "Guion impreso, 3 roles, cronómetro, notas adhesivas", costo: 0, tarea: "Del reporte a la resolución antes del inicio", roles: "Cliente, agente digital, boletería y validador; contingencia: servicio sin respuesta"},
    ]},
    PV1: {protocolo: "Tres participantes codificados ejecutan las tareas con el prototipo v1; se mide tiempo, éxito, ayuda y error crítico.", umbral: "80",
      intentos: [
        {tarea: "Retomar caso por código", participante: "P1", version: "v1", tiempo_s: 95, exito: "Sí", ayuda: "No", error: "No", naturaleza: "Ensayo sintético", observacion: "Encontró el caso a la primera"},
        {tarea: "Retomar caso por código", participante: "P2", version: "v1", tiempo_s: 140, exito: "Sí", ayuda: "Sí", error: "No", naturaleza: "Ensayo sintético", observacion: "Dudó entre código y pedido"},
        {tarea: "Registrar resolución con evidencia", participante: "P3", version: "v1", tiempo_s: 120, exito: "Sí", ayuda: "No", error: "No", naturaleza: "Ensayo sintético", observacion: "—"},
        {tarea: "Derivar con siguiente paso", participante: "P1", version: "v1", tiempo_s: 80, exito: "No", ayuda: "No", error: "Sí", naturaleza: "Ensayo sintético", observacion: "Omitió el responsable"},
      ]},
    PV2: {decision: "Iterar el prototipo", limitaciones: "Ensayo sintético con participantes simulados; falta prueba ejecutada y validación de campo.", confirmado_por: "",
      mejoras: [
        {hallazgo: "Confusión entre código de incidencia y pedido", evidencia: "PV1 · P2", mejora: "Buscador único que acepta ambos", version: "v2", prioridad: "Alta"},
        {hallazgo: "Derivación sin responsable", evidencia: "PV1 · P1", mejora: "Responsable obligatorio y vista previa antes de confirmar", version: "v2", prioridad: "Alta"},
      ]},
  };

  /* ---------------- operaciones ---------------- */
  async function versiones(A, pid, cod) { return (await A.leer("instrumento_version", {proyecto_id: pid})).filter(v => !cod || v.codigo === cod).sort((a, b) => a.codigo.localeCompare(b.codigo) || a.version - b.version); }
  const vigente = vs => vs.reduce((m, v) => (!m[v.codigo] || v.version > m[v.codigo].version ? (m[v.codigo] = v, m) : m), {});
  function opsSemilla(proyectoRef, t) {
    return ORDEN.map(cod => ({op: "insertar", tabla: "instrumento_version", fila: {proyecto_id: proyectoRef, codigo: cod, version: 1, estado: faltantes(cod, INICIAL[cod]).length ? "BORRADOR" : "COMPLETA", contenido: JSON.stringify(INICIAL[cod]), naturaleza: "SIMULADO", autor: "Equipo de análisis (contenido inicial simulado)", fecha_utc: t, revisado_por: null, fecha_revision_utc: null, nota_revision: null}}));
  }
  async function avance(A, pid) {
    const vg = vigente(await versiones(A, pid));
    const herr = ORDEN.map(cod => { const v = vg[cod], c = v ? JSON.parse(v.contenido) : {}; return {codigo: cod, nombre: H[cod].nombre, etapa: H[cod].etapa, pantalla: H[cod].pantalla, version: v?.version || 0, estado: v?.estado || "SIN_INICIAR", faltantes: v ? faltantes(cod, c) : ["Sin iniciar"], revisado_por: v?.revisado_por || null, fecha: v?.fecha_utc || null}; });
    const completas = herr.filter(h => ["COMPLETA", "VALIDADA"].includes(h.estado)).length, validadas = herr.filter(h => h.estado === "VALIDADA").length;
    const etapas = ETAPAS.map(([k, n]) => { const hs = herr.filter(h => h.etapa === k), c = hs.filter(h => ["COMPLETA", "VALIDADA"].includes(h.estado)).length; return {clave: k, nombre: n, herramientas: hs, completas: c, estado: c === 2 ? (hs.every(h => h.estado === "VALIDADA") ? "VALIDADA" : "COMPLETA") : c || hs.some(h => h.version) ? "EN_CURSO" : "SIN_INICIAR"}; });
    return {herramientas: herr, etapas, completas, validadas, total: 10, porcentaje: completas * 10};
  }
  async function guardar(A, pid, cod, contenido, versionBase, usuario) {
    if (!H[cod]) throw new Error("Herramienta no válida");
    const vs = await versiones(A, pid, cod), ult = vs[vs.length - 1];
    if (ult && versionBase != null && ult.version !== versionBase) throw Object.assign(new Error(`Otra persona guardó la versión ${ult.version} de esta herramienta. Recargue para ver la vigente.`), {codigo: "CONFLICTO"});
    const f = faltantes(cod, contenido), t = Math.floor(Date.now() / 1000), version = (ult?.version || 0) + 1;
    await A.aplicar([{op: "insertar", tabla: "instrumento_version", fila: {proyecto_id: pid, codigo: cod, version, estado: f.length ? "BORRADOR" : "COMPLETA", contenido: JSON.stringify(contenido), naturaleza: ult?.naturaleza || "SIMULADO", autor: usuario.nombre, fecha_utc: t, revisado_por: null, fecha_revision_utc: null, nota_revision: null}}]);
    return {version, estado: f.length ? "BORRADOR" : "COMPLETA", faltantes: f};
  }
  async function validar(A, pid, cod, revisor, nota) {
    const vs = await versiones(A, pid, cod), ult = vs[vs.length - 1];
    if (!ult) throw new Error("La herramienta no tiene versiones.");
    if (ult.estado === "BORRADOR") throw new Error("Solo se valida una versión completa. Complete los campos pendientes primero.");
    if (!String(revisor || "").trim()) throw Object.assign(new Error("Indique quién revisó."), {campos: {revisor: "Indique quién revisó."}});
    await A.aplicar([{op: "actualizar", tabla: "instrumento_version", id: ult.id, cambios: {estado: "VALIDADA", revisado_por: String(revisor).trim().slice(0, 120), fecha_revision_utc: Math.floor(Date.now() / 1000), nota_revision: String(nota || "").slice(0, 500)}}]);
  }
  return {H, ORDEN, ETAPAS, PESOS, CLASIF, INICIAL, faltantes, puntaje, ranking, resumenPrueba, versiones, vigente, opsSemilla, avance, guardar, validar};
})();
if (typeof module !== "undefined") module.exports = DT;
