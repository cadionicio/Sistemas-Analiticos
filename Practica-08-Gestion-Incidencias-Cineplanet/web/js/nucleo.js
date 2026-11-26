"use strict";
/* Núcleo de reglas del Caso 12 (Cineplanet). Común a las dos soluciones aisladas:
   PC08.exe (almacén SQLite) y PC08.html (almacén IndexedDB). No usa la red ni la interfaz. */
const Nucleo = (() => {
  const VERSION = "0.8.2", SEMILLA = "7", PROYECTO = "CP-C12", PILOTO = "CP Alcázar";
  const CRITICO_S = 15 * 60, URGENTE_S = 45 * 60, REVISION_ESCALAMIENTO_MIN = 5, REAPERTURA_H = 24;
  const ORDEN = {CRITICO: 0, VERIFICAR_HORARIO: 1, URGENTE: 2, NORMAL: 3, FUNCION_INICIADA: 4, CERRADO: 5};
  const ETQ = {CRITICO: "Crítico", URGENTE: "Urgente", NORMAL: "Normal", VERIFICAR_HORARIO: "Verificar horario", FUNCION_INICIADA: "Función iniciada", CERRADO: "Sin urgencia"};
  const ESTADOS = {NUEVO: "Nuevo", EN_VERIFICACION: "En verificación", EN_ATENCION: "En atención", ESCALADO: "Escalado", RESUELTO: "Resuelto", CERRADO: "Cerrado"};
  const PARTES = {CONFIRMADO: "Confirmado", POR_VERIFICAR: "Por verificar", FALLIDO: "Fallido", PENDIENTE: "Pendiente", EMITIDA: "Emitida", NO_EMITIDA: "No emitida", VALIDADO: "Validado", RECHAZADO: "Rechazado", NO_APLICA: "No aplica", DUPLICADO: "Duplicado"};
  const OPC_PARTES = {compra: ["CONFIRMADO", "PENDIENTE", "FALLIDO", "POR_VERIFICAR"], pago: ["CONFIRMADO", "PENDIENTE", "DUPLICADO", "FALLIDO", "POR_VERIFICAR"], emision: ["EMITIDA", "NO_EMITIDA", "POR_VERIFICAR"], ingreso: ["NO_APLICA", "VALIDADO", "RECHAZADO", "POR_VERIFICAR"]};
  const CANALES = {CLIENTE: "Web o app", DIGITAL: "Atención Digital", BOLETERIA: "Boletería", CARGA: "Carga de datos", SISTEMA: "Sistema", SUPERVISION: "Supervisión"};
  const ROLES = {CLIENTE: "Cliente", DIGITAL: "Atención Digital", BOLETERIA: "Boletería", SUPERVISION: "Supervisión"};
  const RESULTADOS = ["Entrada recuperada y entregada al cliente", "Compra confirmada y entrada reenviada", "Ingreso habilitado tras validar la entrada", "Cambio de función aprobado", "Cobro duplicado derivado a devolución", "Sin solución antes de la función"];
  const SEDES = ["CP Alcázar", "CP Arequipa Mall Plaza", "CP Arequipa Paseo Central", "CP Arequipa Real Plaza", "CP Brasil", "CP Cajamarca", "CP Canto Grande", "CP Centro", "CP Centro Cívico", "CP Chiclayo Mall Aventura", "CP Chiclayo Real Plaza", "CP Comas", "CP Cusco", "CP El Polo", "CP Guardia Civil", "CP Huancayo Real Plaza", "CP Huánuco Real Plaza", "CP Juliaca", "CP La Molina", "CP La Molina Senco", "CP Lurín", "CP Mall del Sur", "CP Norte", "CP Parque de la Molina", "CP Piura", "CP Piura Real Plaza", "CP Plaza Santa Catalina", "CP Primavera", "CP Pro", "CP Pucallpa", "CP Puno", "CP Puruchuco", "CP Risso", "CP Salaverry", "CP San Borja", "CP San Juan de Lurigancho", "CP San Miguel", "CP Santa Clara", "CP Santa Catalina Plaza", "CP Tacna", "CP Trujillo Centro", "CP Ventanilla", "CP Villa El Salvador", "CP Villa María del Triunfo"];
  const PELICULAS = ["Avengers: Doomsday", "Los Juegos del Hambre: Amanecer en la cosecha", "Minotauro", "Ratoncitos en apuros", "Yo soy Rocky"];
  const TIPOS = [
    ["T01", "Cobro sin entrada disponible", "Compra y pago", 1, "Atención Digital", "Verificar pago y emisión antes de orientar o escalar", "R11/R12", "cobro,cobraron,pago,sin entrada,no encuentro"],
    ["T02", "Compra pendiente de confirmación", "Compra y pago", 1, "Atención Digital", "Solicitar verificación del estado de pago", "R12", "pendiente,confirmación,procesando"],
    ["T03", "Posible cobro duplicado", "Compra y pago", 1, "Validación de pagos", "Revisar ambos identificadores de transacción", "R13", "dos veces,duplicado,doble cobro"],
    ["T04", "Confirmación o entrada no localizada", "Emisión e ingreso", 1, "Atención Digital", "Comprobar si la entrada está emitida y orientar por canal autorizado", "R14", "correo,confirmación,no llegó,no aparece"],
    ["T05", "Entrada que no valida al ingreso", "Emisión e ingreso", 1, "Boletería", "Revisar función, condición de la entrada y evidencia de uso", "R15", "no valida,ingreso,lector,rechaza"],
    ["T06", "Diferencia de función o datos de la compra", "Función y sede", 1, "Responsable de sede", "Verificar evento y solicitud; derivar a quien aprueba alternativa", "R16", "asiento,sala,fecha,sede equivocada,hora"],
    ["T07", "Cambio o cancelación de la función", "Función y sede", 1, "Responsable de sede", "Verificar el evento y registrar la alternativa aprobada", "R16", "cancelada,cancelación,cambio de función"],
    ["T08", "Contacto duplicado o reingreso por otro canal", "Continuidad", 1, "Atención Digital", "Buscar coincidencias y vincular al expediente original", "R04", "ya reporté,otra vez,código anterior"],
    ["T90", "Otro motivo (flujo general)", "Otros", 0, "Atención Digital", "Registrar, clasificar y derivar según catálogo", "R29", ""],
  ];
  const DOMINIOS = ["www.gob.pe", "www.inei.gob.pe", "example.com", "www.example.com", "date.nager.at"];
  /* Cuentas: [correo, nombre, vistas autorizadas, sede, ámbito, contraseña]. Demostración: una sola cuenta con las cuatro vistas.
     Producción: una cuenta de cliente (solo su vista) y una del personal (Atención Digital, Boletería y Supervisión). */
  const CUENTAS = [
    ["demo@cpdemo.pe", "Equipo de demostración", ["CLIENTE", "DIGITAL", "BOLETERIA", "SUPERVISION"], PILOTO, "DEMO", "demo2026"],
    ["cliente@cpdemo.pe", "María Quispe", ["CLIENTE"], null, "PRODUCCION", "cliente2026"],
    ["personal@cpdemo.pe", "Ana Torres", ["DIGITAL", "BOLETERIA", "SUPERVISION"], PILOTO, "PRODUCCION", "personal2026"],
  ];
  const TABLAS_DATOS = ["instrumento_version", "lote_importado", "verificacion_enlace", "verificacion", "evento", "contacto", "evidencia", "incidencia", "compra", "funcion", "tipo_incidencia", "usuario", "sede", "configuracion", "proyecto"];

  class ErrorValidacion extends Error { constructor(campos) { super("Datos no válidos"); this.campos = campos; } }
  class ErrorNegocio extends Error { constructor(m, codigo = "NEGOCIO") { super(m); this.codigo = codigo; } }

  const ahora = () => Math.floor(Date.now() / 1000);
  const fmtHora = u => u == null ? "—" : new Date(u * 1000).toLocaleTimeString("es-PE", {hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Lima"});
  const fmtFechaHora = u => u == null ? "—" : new Date(u * 1000).toLocaleString("es-PE", {day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Lima"});
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
  async function hashClave(clave, salHex, it = 100000) {
    const sal = new Uint8Array(salHex.match(/../g).map(h => parseInt(h, 16)));
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave), "PBKDF2", false, ["deriveBits"]);
    return hex(await crypto.subtle.deriveBits({name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: it}, k, 256));
  }
  function azar(semilla) { let s = semilla >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* R07–R10 */
  function prioridad(inicio, t, horario = "CONFIRMADO", estado = "NUEVO") {
    const r = (nivel, seg, regla) => ({nivel, etiqueta: ETQ[nivel], segundos: seg, minutos: seg == null ? null : (seg >= 0 ? Math.floor(seg / 60) : -Math.floor(-seg / 60)), regla, orden: ORDEN[nivel]});
    if (estado === "RESUELTO" || estado === "CERRADO") return r("CERRADO", null, "R21");
    if (horario !== "CONFIRMADO" || inicio == null) return r("VERIFICAR_HORARIO", null, "R09");
    const s = inicio - t;
    if (s <= 0) return r("FUNCION_INICIADA", s, "R10");
    if (s <= CRITICO_S) return r("CRITICO", s, "R08");
    if (s <= URGENTE_S) return r("URGENTE", s, "R08");
    return r("NORMAL", s, "R08");
  }
  const comparar = (a, b) => (a.prioridad.orden - b.prioridad.orden) || ((a.inicio_utc ?? 9e15) - (b.inicio_utc ?? 9e15)) || (a.apertura_utc - b.apertura_utc);

  /* ------------------------------------------------ v0.8.0 · historial sintético de las 44 sedes (30 días) + funciones de hoy por sede
     Códigos propios (HIS-Snn-nnn, FUN-Snn-…, PED-Snn-…) para no alterar el guion INC-0101..0130 ni la numeración INC-0131.
     Modelo de tiempos coherente con la simulación P-02 (flujo actual): verificación 6–18 min, repetición 10–25 min si cambia de canal, cola 0–20 min. */
  const PERSONAL = {DIGITAL: ["Ana Torres", "Jorge Ramos", "Lucía Paredes", "Diego Salas"], BOLETERIA: ["Luis Huamán", "Rosa Quispe", "Carlos Rojas", "Milagros Vega", "Pedro Castillo"]};
  function historicoSedes(ops, ev, base, t, sref, ests, responsables) {
    const R = azar(20261127), U = (a, b) => a + R() * (b - a), pick = L => L[Math.floor(R() * L.length)];
    const PESO = [["T01", 18], ["T02", 14], ["T03", 8], ["T04", 16], ["T05", 10], ["T06", 9], ["T07", 7], ["T08", 8], ["T90", 4]], TOT = PESO.reduce((s, x) => s + x[1], 0);
    const tipoAzar = () => { let r = R() * TOT; for (const [k, w] of PESO) { if ((r -= w) < 0) return k; } return "T01"; };
    const dia0 = (() => { const d = new Date((t - 5 * 3600) * 1000); return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000) + 5 * 3600; })(); /* 00:00 de hoy en Lima */
    SEDES.forEach((sede, si) => {
      const ss = String(si + 1).padStart(2, "0"), sr = sref(sede), n = sede === PILOTO ? 24 : 6 + Math.floor(R() * 10);
      /* funciones de hoy (para que el cliente pueda reportar en cualquier sede) */
      if (sede !== PILOTO) {
        const hoy = [45, 110, 200, 320].map((m, k) => ({ref: `hoy${si}_${k}`, inicio: base + (m + (si % 5) * 5) * 60, pel: PELICULAS[(si + k) % PELICULAS.length]}));
        hoy.forEach((f, k) => ops.push({op: "insertar", tabla: "funcion", ref: f.ref, fila: {proyecto_id: {$ref: "p"}, sede_id: sr, codigo: `FUN-S${ss}-H${k + 1}`, pelicula: f.pel, sala: `Sala ${(k % 6) + 1}`, inicio_utc: f.inicio, horario_estado: "CONFIRMADO", naturaleza: "SINTETICO"}}));
        /* casos abiertos de hoy en cada sede (prioridad normal: funciones a más de 45 min) para que Bandeja, Mostrador y Panel muestren actividad en todos los cines */
        const abiertos = 1 + Math.floor(R() * 3);
        for (let k = 0; k < abiertos; k++) {
          const f = hoy[1 + (k % 3)], tipo = tipoAzar(), est = pick(["NUEVO", "EN_VERIFICACION", "EN_ATENCION", "ESCALADO"]), tip = TIPOS.find(z => z[0] === tipo), [ec, ep, ee] = ests[tipo] || ests.T04;
          const ap = t - Math.floor(U(5, 40)) * 60, cod = `INC-S${ss}-${String(k + 1).padStart(2, "0")}`, ped = `PED-S${ss}-A${k + 1}`, cref = `ac${si}_${k}`, iref = `ai${si}_${k}`, dig = pick(PERSONAL.DIGITAL);
          ops.push({op: "insertar", tabla: "compra", ref: cref, fila: {proyecto_id: {$ref: "p"}, codigo_pedido: ped, funcion_id: {$ref: f.ref}, canal: R() < 0.6 ? "APP" : "WEB", entradas: 1 + Math.floor(R() * 3), monto_centimos: 1900 * (1 + Math.floor(R() * 3)), estado_compra: ec, estado_pago: ep, estado_emision: ee, estado_ingreso: "NO_APLICA", fuente_estado: "DISPONIBLE", creado_utc: ap - 3600, naturaleza: "SINTETICO"}});
          ops.push({op: "insertar", tabla: "incidencia", ref: iref, fila: {proyecto_id: {$ref: "p"}, codigo: cod, compra_id: {$ref: cref}, funcion_id: {$ref: f.ref}, sede_id: sr, tipo_codigo: tipo, pedido_declarado: ped, cliente_id: null,
            descripcion: `Caso sintético de hoy · ${tip[1].toLowerCase()}`, canal_origen: R() < 0.75 ? "CLIENTE" : "DIGITAL", estado: est, provisional: 0, responsable: responsables[est], siguiente_accion: tip[5], resultado: null, evidencia_resolucion: null, resuelto_por: null, a_tiempo: null,
            naturaleza: "SINTETICO", version: 1, apertura_utc: ap, actualizado_utc: ap, resuelto_utc: null, cerrado_utc: null}});
          ops.push({op: "insertar", tabla: "contacto", fila: {incidencia_id: {$ref: iref}, canal: "CLIENTE", clave_origen: `hoy-${si}-${k}-1`, registrado_utc: ap, detalle: "Reporte inicial"}});
          ev.push([iref, ap, "REPORTE_RECIBIDO", "CLIENTE", "Cliente", `Motivo: ${tip[1]}`, "R01/R02"]);
          ev.push([iref, ap + 120, "ASIGNACION_AUTOMATICA", "SISTEMA", "Sistema", `Bandeja asignada: ${tip[4]}. Siguiente acción: ${tip[5]}`, "R18"]);
          if (est !== "NUEVO") ev.push([iref, ap + 240, "EN_VERIFICACION", "DIGITAL", dig, "Verificación de compra iniciada", "R12"]);
          if (est === "EN_ATENCION") { ev.push([iref, ap + 420, "DERIVACION", "DIGITAL", dig, `Derivado a Boletería ${sede}`, "R19"]); }
          if (est === "ESCALADO") ev.push([iref, ap + 420, "ESCALAMIENTO", "DIGITAL", dig, "Escalado a Validación de pagos · revisión esperada en 5 min", "R19"]);
        }
      }
      for (let k = 0; k < n; k++) {
        const tipo = tipoAzar(), dias = 1 + Math.floor(R() * 30), inicio = dia0 - dias * 86400 + Math.floor(U(14, 22.5) * 4) * 900;
        const r = R(), posterior = r < 0.04, antes = posterior ? -U(1, 20) : r < 0.19 ? U(1, 15) : r < 0.52 ? U(16, 45) : U(46, 150);
        const apertura = Math.round(inicio - antes * 60), cambia = R() < 0.6, verif = U(6, 18), rep = cambia ? U(10, 25) : 0, cola = U(0, 20), bloqueado = ["T03", "T07"].includes(tipo) && R() < 0.10;
        const dur = (verif + rep + cola) * 60 * (bloqueado ? 3 : 1), resuelto = Math.round(apertura + dur), duplicado = tipo === "T08" && R() < 0.5;
        const aTiempo = posterior ? null : resuelto < inicio ? 1 : 0, cod = `HIS-S${ss}-${String(k + 1).padStart(3, "0")}`, ped = `PED-S${ss}-${String(k + 1).padStart(3, "0")}`;
        const fref = `hf${si}_${k}`, cref = `hc${si}_${k}`, iref = `hi${si}_${k}`, [ec, ep, ee] = ests[tipo] || ests.T04, dig = pick(PERSONAL.DIGITAL), bol = pick(PERSONAL.BOLETERIA), tip = TIPOS.find(z => z[0] === tipo);
        const canal = R() < 0.75 ? "CLIENTE" : "DIGITAL", estado = duplicado ? "CERRADO" : R() < 0.7 ? "CERRADO" : "RESUELTO";
        ops.push({op: "insertar", tabla: "funcion", ref: fref, fila: {proyecto_id: {$ref: "p"}, sede_id: sr, codigo: `FUN-S${ss}-${String(k + 1).padStart(3, "0")}`, pelicula: pick(PELICULAS), sala: `Sala ${1 + Math.floor(R() * 8)}`, inicio_utc: inicio, horario_estado: "CONFIRMADO", naturaleza: "SINTETICO"}});
        ops.push({op: "insertar", tabla: "compra", ref: cref, fila: {proyecto_id: {$ref: "p"}, codigo_pedido: ped, funcion_id: {$ref: fref}, canal: R() < 0.6 ? "APP" : "WEB", entradas: 1 + Math.floor(R() * 4), monto_centimos: 1900 * (1 + Math.floor(R() * 4)), estado_compra: ec, estado_pago: ep, estado_emision: ee, estado_ingreso: tipo === "T05" ? "RECHAZADO" : "NO_APLICA", fuente_estado: "DISPONIBLE", creado_utc: apertura - 3600, naturaleza: "SINTETICO"}});
        const resultado = duplicado ? `Contacto vinculado a HIS-S${ss}-${String(Math.max(1, k)).padStart(3, "0")}` : aTiempo === 0 ? RESULTADOS[0] + " (después del inicio)" : RESULTADOS[Math.floor(R() * 4)];
        ops.push({op: "insertar", tabla: "incidencia", ref: iref, fila: {proyecto_id: {$ref: "p"}, codigo: cod, compra_id: {$ref: cref}, funcion_id: {$ref: fref}, sede_id: sr, tipo_codigo: tipo, pedido_declarado: ped, cliente_id: null,
          descripcion: `Historial sintético · ${tip[1].toLowerCase()}`, canal_origen: canal, estado, provisional: 0, responsable: responsables[estado], siguiente_accion: "Sin acción pendiente", resultado,
          evidencia_resolucion: duplicado ? null : `Registro sintético de solución ${cod}`, resuelto_por: duplicado ? null : bol, a_tiempo: duplicado ? null : aTiempo, naturaleza: "SINTETICO", version: 1, apertura_utc: apertura, actualizado_utc: resuelto, resuelto_utc: duplicado ? null : resuelto, cerrado_utc: estado === "CERRADO" ? resuelto : null}});
        ops.push({op: "insertar", tabla: "contacto", fila: {incidencia_id: {$ref: iref}, canal, clave_origen: `his-${si}-${k}-1`, registrado_utc: apertura, detalle: "Reporte inicial"}});
        ev.push([iref, apertura, "REPORTE_RECIBIDO", canal, canal === "CLIENTE" ? "Cliente" : dig, `Motivo: ${tip[1]}`, "R01/R02"]);
        ev.push([iref, apertura + 120, "ASIGNACION_AUTOMATICA", "SISTEMA", "Sistema", `Bandeja asignada: ${tip[4]}`, "R18"]);
        ev.push([iref, apertura + Math.round(cola * 60), "EN_VERIFICACION", "DIGITAL", dig, "Verificación de compra iniciada", "R12"]);
        ops.push({op: "insertar", tabla: "verificacion", fila: {incidencia_id: {$ref: iref}, utc: apertura + Math.round((cola + verif) * 60), actor: dig, estado_compra: ec, estado_pago: ep, estado_emision: ee, estado_ingreso: tipo === "T05" ? "RECHAZADO" : "NO_APLICA", origen: "Historial sintético", nota: "Verificación registrada"}});
        if (duplicado) { ev.push([iref, apertura + 60, "POSIBLE_DUPLICADO", "SISTEMA", "Sistema", "Coincide con otro expediente de la sede (pedido y motivo)", "R04"]); ev.push([iref, apertura + 400, "VINCULACION", "DIGITAL", dig, "Vinculado al expediente original", "R04"]); continue; }
        if (bloqueado) ev.push([iref, apertura + Math.round((cola + verif) * 60) + 30, "ESCALAMIENTO", "DIGITAL", dig, tipo === "T03" ? "Escalado a Validación de pagos" : "Escalado a Responsable de sede", "R19"]);
        if (cambia) {
          const td = apertura + Math.round((cola + verif) * 60) + 60;
          ev.push([iref, td, "DERIVACION", "DIGITAL", dig, `Derivado a Boletería ${sede}`, "R19"]);
          ops.push({op: "insertar", tabla: "contacto", fila: {incidencia_id: {$ref: iref}, canal: "BOLETERIA", clave_origen: `his-${si}-${k}-2`, registrado_utc: td + 240, detalle: "Cliente se acerca a boletería y repite el caso"}});
          ev.push([iref, td + 240 + Math.round(rep * 30), "RETOMA", "BOLETERIA", bol, "Caso retomado en boletería", "R20"]);
        }
        ev.push([iref, resuelto, "RESOLUCION", "BOLETERIA", bol, `Resultado registrado${aTiempo === 1 ? " antes del inicio" : aTiempo === 0 ? " después del inicio" : ""}`, "R21"]);
      }
    });
  }

  /* ------------------------------------------------ semilla de demostración (30 incidencias reproducibles) */
  async function construirSemilla(t) {
    const R = azar(20261126), ops = [], ev = [];
    const base = (() => { const d = new Date(t * 1000); d.setSeconds(0, 0); return Math.floor(d.getTime() / 1000) + ((5 - d.getMinutes() % 5) % 5) * 60; })();
    ops.push({op: "insertar", tabla: "proyecto", ref: "p", fila: {codigo: PROYECTO, caso_catalogo: 12, nombre: "Cineplanet · Continuidad de incidencias de compra digital", sector: "SERVICIOS", tamano: "GRANDE", naturaleza: "SINTETICO", objetivo: "Resolver la incidencia antes del inicio de la función conservando información y responsable", alcance: `${PILOTO} (piloto); canales web/app, Atención Digital y Boletería`, creado_utc: t}});
    ops.push({op: "insertar", tabla: "configuracion", fila: {clave: "modo", valor: "DEMO"}});
    ops.push({op: "insertar", tabla: "configuracion", fila: {clave: "semilla", valor: SEMILLA}});
    SEDES.forEach((s, i) => ops.push({op: "insertar", tabla: "sede", ref: "s" + i, fila: {proyecto_id: {$ref: "p"}, codigo: `S${String(i + 1).padStart(2, "0")}`, nombre: s, piloto: s === PILOTO ? 1 : 0}}));
    const sref = n => ({$ref: "s" + SEDES.indexOf(n)});
    for (const [c, n, roles, sede, amb, clave] of CUENTAS) {
      const sal = hex(crypto.getRandomValues(new Uint8Array(16)));
      ops.push({op: "insertar", tabla: "usuario", ref: "u:" + c, fila: {correo: c, nombre: n, rol: roles[0], roles: roles.join(","), sede_id: sede ? sref(sede) : null, ambito: amb, sal, hash: await hashClave(clave, sal), iteraciones: 100000, activo: 1}});
    }
    TIPOS.forEach(x => ops.push({op: "insertar", tabla: "tipo_incidencia", fila: {codigo: x[0], nombre: x[1], grupo: x[2], prioritario: x[3], responsable_defecto: x[4], accion_sugerida: x[5], regla: x[6], palabras_clave: x[7], activo: 1, version: 1}}));
    // funciones de hoy en el piloto (desfase en minutos respecto del arranque) + una con horario desconocido + una en CP San Miguel
    const desf = [-55, -20, 9, 25, 40, 60, 95, 150];
    const fun = desf.map((m, i) => ({ref: "f" + i, codigo: `FUN-${String(i + 1).padStart(2, "0")}`, pelicula: PELICULAS[i % PELICULAS.length], sala: `Sala ${(i % 6) + 1}`, inicio: base + m * 60, sede: PILOTO, horario: "CONFIRMADO"}));
    fun.push({ref: "f8", codigo: "FUN-09", pelicula: PELICULAS[2], sala: "Sala 7", inicio: null, sede: PILOTO, horario: "DESCONOCIDO"});
    fun.push({ref: "f9", codigo: "FUN-10", pelicula: PELICULAS[0], sala: "Sala 2", inicio: base + 50 * 60, sede: "CP San Miguel", horario: "CONFIRMADO"});
    fun.forEach(f => ops.push({op: "insertar", tabla: "funcion", ref: f.ref, fila: {proyecto_id: {$ref: "p"}, sede_id: sref(f.sede), codigo: f.codigo, pelicula: f.pelicula, sala: f.sala, inicio_utc: f.inicio, horario_estado: f.horario, naturaleza: "SINTETICO"}}));
    // 30 incidencias INC-0101..INC-0130; el guion usa INC-0126 (PED-0418) e INC-0127 (verificación interrumpida)
    const plan = [];
    for (let k = 0; k < 30; k++) {
      const n = 101 + k, tipo = TIPOS[k % 8][0];
      let fi = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9][Math.floor(R() * 10)];
      let estado = ["NUEVO", "EN_VERIFICACION", "EN_ATENCION", "ESCALADO", "RESUELTO", "RESUELTO", "CERRADO"][Math.floor(R() * 7)];
      if (n === 126) { fi = 3; estado = "EN_VERIFICACION"; }
      if (n === 127) { fi = 4; estado = "EN_VERIFICACION"; }
      plan.push({n, tipo: n === 126 ? "T01" : n === 127 ? "T02" : tipo, fi, estado, pedido: n === 126 ? "PED-0418" : `PED-0${300 + k}`});
    }
    const p22 = plan.find(z => z.n === 122); p22.estado = "EN_VERIFICACION"; Object.assign(plan.find(z => z.n === 130), {pedido: p22.pedido, tipo: p22.tipo, fi: p22.fi, estado: "NUEVO", duplicaDe: 122});
    const ests = {T01: ["CONFIRMADO", "CONFIRMADO", "NO_EMITIDA"], T02: ["PENDIENTE", "PENDIENTE", "NO_EMITIDA"], T03: ["CONFIRMADO", "DUPLICADO", "EMITIDA"], T04: ["CONFIRMADO", "CONFIRMADO", "EMITIDA"], T05: ["CONFIRMADO", "CONFIRMADO", "EMITIDA"], T06: ["CONFIRMADO", "CONFIRMADO", "EMITIDA"], T07: ["CONFIRMADO", "CONFIRMADO", "EMITIDA"], T08: ["CONFIRMADO", "CONFIRMADO", "EMITIDA"]};
    const responsables = {NUEVO: "Sin asignar", EN_VERIFICACION: "Atención Digital", EN_ATENCION: "Boletería", ESCALADO: "Validación de pagos", RESUELTO: "Boletería", CERRADO: "Atención Digital"};
    for (const x of plan) {
      const f = fun[x.fi], [ec, ep, ee] = ests[x.tipo];
      const inicio = f.inicio ?? base + 30 * 60;
      const apertura = Math.min(t - 15 * 60, inicio - Math.floor(20 + R() * 70) * 60);
      const ap = x.n === 126 ? t - 12 * 60 : x.n === 127 ? t - 8 * 60 : apertura;
      const resuelto = ["RESUELTO", "CERRADO"].includes(x.estado) ? Math.min(t - 60, ap + Math.floor(6 + R() * 50) * 60) : null;
      const ingreso = x.tipo === "T05" ? "RECHAZADO" : "NO_APLICA";
      const comRef = "c" + (x.duplicaDe || x.n);
      if (!x.duplicaDe) ops.push({op: "insertar", tabla: "compra", ref: comRef, fila: {proyecto_id: {$ref: "p"}, codigo_pedido: x.pedido, funcion_id: {$ref: f.ref}, canal: x.n % 2 ? "APP" : "WEB", entradas: 1 + (x.n % 3), monto_centimos: 1900 * (1 + (x.n % 3)), estado_compra: ec, estado_pago: ep, estado_emision: ee, estado_ingreso: ingreso, fuente_estado: x.n === 127 ? "SIN_RESPUESTA" : "DISPONIBLE", creado_utc: ap - 1800, naturaleza: "SINTETICO"}});
      const tip = TIPOS.find(z => z[0] === x.tipo);
      const aTiempo = resuelto != null && f.inicio != null ? (resuelto < f.inicio ? 1 : 0) : null;
      const iref = "i" + x.n;
      ops.push({op: "insertar", tabla: "incidencia", ref: iref, fila: {proyecto_id: {$ref: "p"}, codigo: `INC-0${x.n}`, compra_id: {$ref: comRef}, funcion_id: {$ref: f.ref}, sede_id: sref(f.sede), tipo_codigo: x.tipo, pedido_declarado: x.pedido, cliente_id: x.n === 126 || x.n === 113 ? {$ref: "u:demo@cpdemo.pe"} : null, descripcion: x.n === 126 ? "El pago aparece, pero no encuentro mi entrada" : `Caso sintético ${x.n}: ${tip[1].toLowerCase()}`, canal_origen: x.n % 4 === 0 ? "DIGITAL" : "CLIENTE", estado: x.estado, provisional: 0, responsable: responsables[x.estado], siguiente_accion: ["RESUELTO", "CERRADO"].includes(x.estado) ? "Sin acción pendiente" : tip[5], resultado: resuelto ? (aTiempo === 0 ? RESULTADOS[0] + " (después del inicio)" : RESULTADOS[x.n % 4]) : null, evidencia_resolucion: resuelto ? `Registro sintético de solución ${x.n}` : null, resuelto_por: resuelto ? "Luis Huamán" : null, a_tiempo: aTiempo, naturaleza: "SINTETICO", version: 1, apertura_utc: ap, actualizado_utc: resuelto ?? ap, resuelto_utc: resuelto, cerrado_utc: x.estado === "CERRADO" ? resuelto : null}});
      ops.push({op: "insertar", tabla: "contacto", fila: {incidencia_id: {$ref: iref}, canal: "CLIENTE", clave_origen: `semilla-${x.n}-1`, registrado_utc: ap, detalle: "Reporte inicial"}});
      ev.push([iref, ap, "REPORTE_RECIBIDO", "CLIENTE", "Cliente", `Motivo: ${tip[1]}`, "R01/R02"]);
      ev.push([iref, ap + 180, "ASIGNACION_AUTOMATICA", "SISTEMA", "Sistema", `Bandeja asignada: ${tip[4]}. Siguiente acción: ${tip[5]}`, "R18"]);
      if (x.estado !== "NUEVO") ev.push([iref, ap + 300, "EN_VERIFICACION", "DIGITAL", "Ana Torres", "Verificación de compra iniciada", "R12"]);
      if (["EN_ATENCION", "RESUELTO"].includes(x.estado)) { ev.push([iref, ap + 540, "DERIVACION", "DIGITAL", "Ana Torres", `Derivado a Boletería ${f.sede}`, "R19"]); ops.push({op: "insertar", tabla: "contacto", fila: {incidencia_id: {$ref: iref}, canal: "BOLETERIA", clave_origen: `semilla-${x.n}-2`, registrado_utc: ap + 660, detalle: "Cliente se acerca a boletería"}}); }
      if (x.estado === "ESCALADO") ev.push([iref, ap + 600, "ESCALAMIENTO", "DIGITAL", "Jorge Ramos", "Escalado a Validación de pagos · revisión esperada en 5 min", "R19"]);
      if (x.duplicaDe) ev.push([iref, ap + 1, "POSIBLE_DUPLICADO", "SISTEMA", "Sistema", `Coincide con INC-0${x.duplicaDe} (pedido y motivo). Revisar vinculación`, "R04"]);
      if (resuelto) ev.push([iref, resuelto, "RESOLUCION", "BOLETERIA", "Luis Huamán", `Resultado registrado${aTiempo === 1 ? " antes del inicio" : aTiempo === 0 ? " después del inicio" : ""}`, "R21"]);
    }
    historicoSedes(ops, ev, base, t, sref, ests, responsables);
    if (typeof DT !== "undefined") ops.push(...DT.opsSemilla({$ref: "p"}, t));
    ev.forEach(([i, u, tp, cn, ac, det, rg]) => ops.push({op: "insertar", tabla: "evento", fila: {incidencia_id: {$ref: i}, utc: Math.min(u, t - 30), tipo: tp, canal: cn, actor: ac, detalle: det, regla: rg}}));
    return ops;
  }
  async function asegurarDemo(A, forzar = false) {
    const v = forzar ? null : await A.estadoSemilla();
    if (v === SEMILLA) return false;
    /* Los feriados descargados son datos reales (no de demostración): se conservan al restablecer */
    const fer = await A.leer("configuracion", {clave: CLAVE_FERIADOS}).catch(() => []), ops = await construirSemilla(ahora());
    if (fer[0]) ops.push({op: "insertar", tabla: "configuracion", fila: {clave: CLAVE_FERIADOS, valor: fer[0].valor}});
    await A.sembrar(SEMILLA, TABLAS_DATOS, ops);
    return true;
  }

  /* ------------------------------------------------ sesión y modo */
  /* Cada apertura de la solución HTML comienza en «Datos de demostración» (en el EXE lo hace la aplicación al iniciar). */
  async function iniciarEnDemo(A) {
    if (A.nombre !== "HTML") return;
    const c = (await A.leer("configuracion", {clave: "modo"}))[0];
    if (c && c.valor !== "DEMO") await A.aplicar([{op: "actualizar", tabla: "configuracion", id: c.id, cambios: {valor: "DEMO"}}]);
  }
  async function modo(A) { return (await A.leer("configuracion", {clave: "modo"}))[0]?.valor || "DEMO"; }
  async function cuentaDemo(A) { if (await modo(A) !== "DEMO") return null; const c = CUENTAS.find(x => x[4] === "DEMO"); return {correo: c[0], clave: c[5]}; }
  async function iniciarSesion(A, correo, clave) {
    correo = String(correo || "").trim().toLowerCase();
    if (!correo || !clave) throw new ErrorValidacion({correo: !correo ? "Escribe tu correo." : undefined, clave: !clave ? "Escribe tu contraseña." : undefined});
    if (A.iniciarSesion) return A.iniciarSesion(correo, clave);
    const m = await modo(A), u = (await A.leer("usuario", {correo}))[0];
    if (!u || !u.activo || u.ambito !== m || await hashClave(clave, u.sal, u.iteraciones) !== u.hash) throw new ErrorNegocio("Correo o contraseña incorrectos.", "CREDENCIALES");
    return publico(u, await A.leer("sede", {}));
  }
  function publico(u, sedes) { return {id: u.id, correo: u.correo, nombre: u.nombre, roles: (u.roles || u.rol).split(",").filter(Boolean), rol: null, sede_id: u.sede_id, sede: sedes.find(s => s.id === u.sede_id)?.nombre || null}; }
  async function elegirRol(A, usuario, rol) {
    if (!usuario?.roles?.includes(rol)) throw new ErrorNegocio("Esta vista no está autorizada para su cuenta.", "PERMISO");
    if (A.elegirRol) await A.elegirRol(rol);
    return {...usuario, rol, rol_texto: ROLES[rol]};
  }
  async function cambiarModo(A, nuevo, claveSupervision) {
    if (A.cambiarModo) return A.cambiarModo(nuevo, claveSupervision || "");
    const actual = await modo(A);
    if (nuevo === actual) return actual;
    if (nuevo === "DEMO") {
      const sup = (await A.leer("usuario", {})).filter(u => (u.roles || u.rol).split(",").includes("SUPERVISION") && u.ambito === "PRODUCCION" && u.activo);
      let ok = false; for (const u of sup) if (await hashClave(claveSupervision || "", u.sal, u.iteraciones) === u.hash) ok = true;
      if (!ok) throw new ErrorNegocio("Contraseña del personal incorrecta.", "CREDENCIALES");
    }
    const c = (await A.leer("configuracion", {clave: "modo"}))[0];
    await A.aplicar([{op: "actualizar", tabla: "configuracion", id: c.id, cambios: {valor: nuevo}}]);
    return nuevo;
  }

  /* ------------------------------------------------ consultas */
  async function proyecto(A) { const p = (await A.leer("proyecto", {codigo: PROYECTO}))[0]; if (!p) throw new ErrorNegocio("Datos de demostración no inicializados"); return p; }
  async function contexto(A, usuario) {
    const p = await proyecto(A), t = ahora();
    const sedes = (await A.leer("sede", {proyecto_id: p.id})).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    const funciones = (await A.leer("funcion", {proyecto_id: p.id})).filter(f => f.inicio_utc == null || f.inicio_utc > t - 3 * 3600).sort((a, b) => (a.inicio_utc ?? 9e15) - (b.inicio_utc ?? 9e15))
      .map(f => ({id: f.id, sede_id: f.sede_id, codigo: f.codigo, pelicula: f.pelicula, sala: f.sala, hora: fmtHora(f.inicio_utc), inicio_utc: f.inicio_utc, horario_estado: f.horario_estado, prioridad: prioridad(f.inicio_utc, t, f.horario_estado)}));
    const tipos = (await A.leer("tipo_incidencia", {})).filter(x => x.activo).sort((a, b) => b.prioritario - a.prioritario || a.codigo.localeCompare(b.codigo));
    const piloto = sedes.find(s => s.piloto);
    return {proyecto: p, sedes, piloto, funciones, tipos, ahora: fmtHora(t), usuario};
  }
  async function tablas(A, pid) {
    /* Solo las columnas que usa la bandeja: reduce el volumen que viaja desde la base (prueba de carga v0.6.0) */
    const CI = ["id", "codigo", "compra_id", "funcion_id", "sede_id", "tipo_codigo", "pedido_declarado", "estado", "responsable", "siguiente_accion", "provisional", "cliente_id", "apertura_utc", "version", "naturaleza", "resultado", "resuelto_utc", "a_tiempo"];
    const [inc, fun, com, tip, sed] = await Promise.all([A.leer("incidencia", {proyecto_id: pid}, CI), A.leer("funcion", {proyecto_id: pid}, ["id", "inicio_utc", "horario_estado", "pelicula", "sala"]), A.leer("compra", {proyecto_id: pid}, ["id", "codigo_pedido"]), A.leer("tipo_incidencia", {}, ["codigo", "nombre"]), A.leer("sede", {proyecto_id: pid}, ["id", "nombre"])]);
    const m = a => new Map(a.map(x => [x.id, x]));
    return {inc, F: m(fun), C: m(com), T: new Map(tip.map(x => [x.codigo, x])), S: m(sed)};
  }
  function fila(i, d, t) {
    const f = d.F.get(i.funcion_id), c = d.C.get(i.compra_id);
    return {id: i.id, codigo: i.codigo, pedido: c?.codigo_pedido || i.pedido_declarado || "—", motivo: d.T.get(i.tipo_codigo)?.nombre || i.tipo_codigo, tipo: i.tipo_codigo,
      funcion: fmtHora(f?.inicio_utc), pelicula: f?.pelicula || "—", sala: f?.sala || "—", sede: d.S.get(i.sede_id)?.nombre || "—", sede_id: i.sede_id, estado: i.estado, estado_texto: ESTADOS[i.estado],
      responsable: i.responsable, siguiente_accion: i.siguiente_accion, provisional: !!i.provisional, cliente_id: i.cliente_id,
      prioridad: prioridad(f?.inicio_utc ?? null, t, f ? f.horario_estado : "DESCONOCIDO", i.estado),
      apertura: fmtHora(i.apertura_utc), apertura_utc: i.apertura_utc, inicio_utc: f?.inicio_utc ?? null, version: i.version, naturaleza: i.naturaleza,
      resultado: i.resultado, resuelto: fmtHora(i.resuelto_utc), a_tiempo: i.a_tiempo};
  }
  async function listar(A, {q = "", estado = "", urgencia = "", tipo = "", sede_id = "", activas = true, cliente_id = null, pagina = 1, porPagina = 25} = {}) {
    const p = await proyecto(A), d = await tablas(A, p.id), t = ahora();
    let items = d.inc.filter(i => (!activas || !["RESUELTO", "CERRADO"].includes(i.estado)) && (!estado || i.estado === estado) && (!tipo || i.tipo_codigo === tipo) && (!sede_id || i.sede_id === Number(sede_id)) && (cliente_id == null || i.cliente_id === cliente_id)).map(i => fila(i, d, t));
    if (q) { const Q = q.trim().toUpperCase(); items = items.filter(x => x.codigo.includes(Q) || x.pedido.toUpperCase().includes(Q)); }
    if (urgencia) items = items.filter(x => x.prioridad.nivel === urgencia);
    items.sort(comparar);
    const resumen = Object.fromEntries(Object.keys(ORDEN).map(n => [n, items.filter(x => x.prioridad.nivel === n).length]));
    pagina = Math.max(1, pagina | 0);
    return {total: items.length, pagina, por_pagina: porPagina, resumen, items: items.slice((pagina - 1) * porPagina, pagina * porPagina), ahora: fmtHora(t)};
  }
  async function detalle(A, codigo) {
    const p = await proyecto(A);
    const i = (await A.leer("incidencia", {proyecto_id: p.id, codigo: String(codigo).trim().toUpperCase()}))[0];
    if (!i) return null;
    const d = await tablas(A, p.id), x = fila(i, d, ahora()), c = i.compra_id ? await A.obtener("compra", i.compra_id) : null;
    x.descripcion = i.descripcion; x.evidencia_resolucion = i.evidencia_resolucion; x.resuelto_por = i.resuelto_por; x.resuelto_utc = i.resuelto_utc;
    x.compra = c ? {pedido: c.codigo_pedido, canal: c.canal, entradas: c.entradas, monto: c.monto_centimos / 100} : null;
    const vs = (await A.leer("verificacion", {incidencia_id: i.id})).sort((a, b) => b.utc - a.utc);
    const v = vs[0];
    x.verificacion = v ? {hora: fmtHora(v.utc), actor: v.actor, origen: v.origen, nota: v.nota} : null;
    x.estados = {compra: v?.estado_compra || "POR_VERIFICAR", pago: v?.estado_pago || "POR_VERIFICAR", emision: v?.estado_emision || "POR_VERIFICAR", ingreso: v?.estado_ingreso || "POR_VERIFICAR"};
    x.estados_texto = Object.fromEntries(Object.entries(x.estados).map(([k, e]) => [k, PARTES[e]]));
    x.eventos = (await A.leer("evento", {incidencia_id: i.id})).sort((a, b) => a.utc - b.utc || a.id - b.id).map(e => ({hora: fmtHora(e.utc), tipo: e.tipo, canal: CANALES[e.canal] || e.canal, actor: e.actor, detalle: e.detalle, regla: e.regla}));
    x.contactos = (await A.leer("contacto", {incidencia_id: i.id})).sort((a, b) => a.registrado_utc - b.registrado_utc).map(k => ({hora: fmtHora(k.registrado_utc), canal: CANALES[k.canal] || k.canal, detalle: k.detalle}));
    x.candidatos = d.inc.filter(o => o.id !== i.id && !["CERRADO"].includes(o.estado) && ((i.compra_id && o.compra_id === i.compra_id) || (i.pedido_declarado && o.pedido_declarado === i.pedido_declarado))).map(o => fila(o, d, ahora()));
    return x;
  }

  /* ------------------------------------------------ registro del cliente (R01–R05, R18) */
  async function registrarCliente(A, datos, usuario, intento = 0) {
    const e = {};
    const clave = String(datos.clave_origen || "").trim(), pedido = String(datos.pedido || "").trim().toUpperCase();
    const tipo = String(datos.tipo || "").trim().toUpperCase(), desc = String(datos.descripcion || "").trim(), url = String(datos.evidencia_url || "").trim();
    if (!/^[A-Za-z0-9-]{8,64}$/.test(clave)) e.clave_origen = "Falta el identificador del envío. Recarga la página e inténtalo de nuevo.";
    if (pedido && !/^[A-Z0-9-]{3,30}$/.test(pedido)) e.pedido = "Usa solo letras, números y guiones (por ejemplo, PED-0418).";
    if (!desc) e.descripcion = "Describe brevemente lo ocurrido."; else if (desc.length > 2000) e.descripcion = "Máximo 2.000 caracteres.";
    if (url && (!/^https:\/\//i.test(url) || url.length > 1000)) e.evidencia_url = "El enlace debe empezar con https:// (máximo 1.000 caracteres).";
    if (!datos.sede_id) e.sede_id = "Selecciona la sede.";
    const p = await proyecto(A);
    const tip = (await A.leer("tipo_incidencia", {codigo: tipo}))[0];
    if (!tip || !tip.activo) e.tipo = "Selecciona el motivo.";
    if (Object.keys(e).length) throw new ErrorValidacion(e);
    const previo = (await A.leer("contacto", {clave_origen: clave}))[0];
    if (previo) { const i = await A.obtener("incidencia", previo.incidencia_id); return {codigo: i.codigo, reintento: true}; } // R03
    const t = ahora();
    const compra = pedido ? (await A.leer("compra", {proyecto_id: p.id, codigo_pedido: pedido}))[0] : null;
    const ev = [];
    let fid, provisional, accion, sede_id = Number(datos.sede_id);
    if (compra) { fid = compra.funcion_id; provisional = 0; accion = tip.accion_sugerida; const fc = await A.obtener("funcion", fid); sede_id = fc.sede_id;
      if (datos.funcion_id && Number(datos.funcion_id) !== fid) ev.push(["DATO_CONTRADICTORIO", "Sistema", "La función indicada no coincide con la compra; se usa la función de la compra y se pide verificar", "R16"]);
    } else { fid = datos.funcion_id ? Number(datos.funcion_id) : null; provisional = 1; accion = "Verificar la compra: caso provisional sin pedido confirmado";
      ev.push(["CASO_PROVISIONAL", "Sistema", "Pedido no localizado o no informado; queda por verificar", "R05"]); }
    const f = fid ? await A.obtener("funcion", fid) : null;
    const pr = prioridad(f?.inicio_utc ?? null, t, f ? f.horario_estado : "DESCONOCIDO");
    const todas = await A.leer("incidencia", {proyecto_id: p.id});
    const codigo = await A.siguienteCodigo("incidencia", "INC-");
    const base = [["REPORTE_RECIBIDO", "Cliente", `Motivo: ${tip.nombre}`, "R01/R02"], ["ASIGNACION_AUTOMATICA", "Sistema", `Bandeja asignada: ${tip.responsable_defecto}. Siguiente acción: ${accion}`, "R18"],
      ["PRIORIDAD_CALCULADA", "Sistema", pr.etiqueta + (pr.minutos != null && pr.minutos >= 0 ? ` · faltan ${pr.minutos} min` : ""), pr.regla]];
    if (compra) { const dup = todas.find(x => x.compra_id === compra.id && x.tipo_codigo === tipo && !["RESUELTO", "CERRADO"].includes(x.estado));
      if (dup) base.push(["POSIBLE_DUPLICADO", "Sistema", `Coincide con ${dup.codigo} (pedido y motivo). Revisar vinculación`, "R04"]); }
    const ops = [{op: "insertar", tabla: "incidencia", ref: "i", fila: {proyecto_id: p.id, codigo, compra_id: compra?.id ?? null, funcion_id: fid, sede_id, tipo_codigo: tipo, pedido_declarado: pedido || null, cliente_id: usuario?.rol === "CLIENTE" ? usuario.id : null, descripcion: desc, canal_origen: "CLIENTE", estado: "NUEVO", provisional, responsable: tip.responsable_defecto, siguiente_accion: accion, resultado: null, evidencia_resolucion: null, resuelto_por: null, a_tiempo: null, naturaleza: "SINTETICO", version: 1, apertura_utc: t, actualizado_utc: t, resuelto_utc: null, cerrado_utc: null}},
      {op: "insertar", tabla: "contacto", fila: {incidencia_id: {$ref: "i"}, canal: "CLIENTE", clave_origen: clave, registrado_utc: t, detalle: "Reporte desde web o app"}}];
    [...base, ...ev].forEach(([tp, actor, det, regla]) => ops.push({op: "insertar", tabla: "evento", fila: {incidencia_id: {$ref: "i"}, utc: t, tipo: tp, canal: actor === "Cliente" ? "CLIENTE" : "SISTEMA", actor, detalle: det, regla}}));
    if (url) {
      ops.push({op: "insertar", tabla: "evidencia", fila: {proyecto_id: p.id, codigo: await A.siguienteCodigo("evidencia", "EV-"), incidencia_id: {$ref: "i"}, tipo: "ENLACE", naturaleza: "SINTETICO", fecha_utc: t, origen: "Cliente", contenido: "Evidencia aportada", url_https: url}}); }
    try { await A.aplicar(ops); }
    catch (err) { if (err.codigo === "UNICO") { const r = (await A.leer("contacto", {clave_origen: clave}))[0]; if (r) return {codigo: (await A.obtener("incidencia", r.incidencia_id)).codigo, reintento: true}; if (intento < 3) return registrarCliente(A, datos, usuario, intento + 1); } throw err; }
    return {codigo, reintento: false, prioridad: pr, responsable: tip.responsable_defecto};
  }

  /* ------------------------------------------------ acciones sobre el expediente */
  async function incidenciaVigente(A, codigo, version) {
    const p = await proyecto(A), i = (await A.leer("incidencia", {proyecto_id: p.id, codigo}))[0];
    if (!i) throw new ErrorNegocio(`No existe la incidencia ${codigo}.`, "NO_EXISTE");
    if (version != null && i.version !== version) throw Object.assign(new ErrorNegocio("Otro usuario guardó un cambio en este expediente. Se mostrará la versión vigente.", "CONFLICTO"), {vigente: i});
    if (i.estado === "CERRADO") throw new ErrorNegocio("El expediente está cerrado.", "CERRADO");
    return i;
  }
  const evento = (iid, t, tipo, canal, actor, detalle, regla) => ({op: "insertar", tabla: "evento", fila: {incidencia_id: iid, utc: t, tipo, canal, actor, detalle, regla}});
  const canalDe = u => u.rol === "BOLETERIA" ? "BOLETERIA" : u.rol === "SUPERVISION" ? "SUPERVISION" : "DIGITAL";

  /* R06/R12: consulta (simulada) al registro de compras para autocompletar la verificación */
  async function consultarRegistroCompra(A, codigo) {
    const i = await incidenciaVigente(A, codigo);
    if (!i.compra_id) return {disponible: false, motivo: "SIN_PEDIDO", mensaje: "El caso es provisional: no hay pedido vinculado para consultar."};
    const c = await A.obtener("compra", i.compra_id);
    if (c.fuente_estado === "SIN_RESPUESTA") return {disponible: false, motivo: "SIN_RESPUESTA", mensaje: "El servicio de validación de pagos no respondió en el tiempo esperado."};
    return {disponible: true, origen: "Registro sintético de compras", sugerido: {compra: c.estado_compra, pago: c.estado_pago, emision: c.estado_emision, ingreso: c.estado_ingreso}};
  }
  async function guardarVerificacion(A, codigo, version, estados, nota, origen, u) {
    const e = {}; for (const k of Object.keys(OPC_PARTES)) if (!OPC_PARTES[k].includes(estados[k])) e[k] = "Selecciona un estado válido.";
    if (Object.keys(e).length) throw new ErrorValidacion(e);
    const i = await incidenciaVigente(A, codigo, version), t = ahora();
    const completo = estados.compra === "CONFIRMADO" && estados.pago === "CONFIRMADO";
    const accion = estados.pago === "DUPLICADO" ? "Derivar a Validación de pagos con ambos identificadores (R13)" : estados.emision === "EMITIDA" ? "Orientar la recuperación de la entrada o derivar a Boletería (R14)" : completo ? "Emitir o recuperar la entrada; derivar a Boletería si el cliente está en sede (R11)" : "Mantener abierto: confirmar pago con el responsable (R12)";
    await A.aplicar([
      {op: "insertar", tabla: "verificacion", fila: {incidencia_id: i.id, utc: t, actor: u.nombre, estado_compra: estados.compra, estado_pago: estados.pago, estado_emision: estados.emision, estado_ingreso: estados.ingreso, origen: origen || "Registro manual", nota: String(nota || "").slice(0, 500)}},
      {op: "actualizar", tabla: "incidencia", id: i.id, version: i.version, cambios: {estado: ["NUEVO"].includes(i.estado) ? "EN_VERIFICACION" : i.estado, responsable: i.responsable === "Sin asignar" ? ROLES[u.rol] : i.responsable, siguiente_accion: accion, actualizado_utc: t}},
      evento(i.id, t, "VERIFICACION", canalDe(u), u.nombre, `Compra ${PARTES[estados.compra]} · pago ${PARTES[estados.pago]} · emisión ${PARTES[estados.emision]} · ingreso ${PARTES[estados.ingreso]} (${origen || "registro manual"})`, "R06"),
    ]);
    return {accion};
  }
  async function registrarFalloExterno(A, codigo, u) {
    const i = await incidenciaVigente(A, codigo), t = ahora();
    await A.aplicar([evento(i.id, t, "VERIFICACION_INTERRUMPIDA", canalDe(u), "Sistema", "El servicio de validación no respondió. El caso sigue abierto con los datos locales.", "R27")]);
  }
  async function vincular(A, codigoOriginal, codigoDuplicado, version, u) {
    const o = await incidenciaVigente(A, codigoOriginal), d = await incidenciaVigente(A, codigoDuplicado, version), t = ahora();
    const contactos = await A.leer("contacto", {incidencia_id: d.id});
    await A.aplicar([
      ...contactos.map(k => ({op: "actualizar", tabla: "contacto", id: k.id, cambios: {incidencia_id: o.id, detalle: `${k.detalle} (vinculado desde ${d.codigo})`}})),
      {op: "actualizar", tabla: "incidencia", id: d.id, version: d.version, cambios: {estado: "CERRADO", siguiente_accion: `Vinculado a ${o.codigo}`, resultado: `Contacto vinculado a ${o.codigo}`, cerrado_utc: t, actualizado_utc: t}},
      {op: "actualizar", tabla: "incidencia", id: o.id, cambios: {actualizado_utc: t}},
      evento(o.id, t, "VINCULACION", canalDe(u), u.nombre, `Se vinculó el contacto de ${d.codigo}; se conservan sus registros`, "R04"),
      evento(d.id, t, "VINCULACION", canalDe(u), u.nombre, `Vinculado al expediente original ${o.codigo}`, "R04"),
    ]);
    return {original: o.codigo};
  }
  async function mantenerSeparado(A, codigo, otro, u) {
    const i = await incidenciaVigente(A, codigo), t = ahora();
    await A.aplicar([evento(i.id, t, "DECISION_DUPLICADO", canalDe(u), u.nombre, `Se mantiene separado de ${otro}: corresponden a episodios distintos`, "R04")]);
  }
  async function derivar(A, codigo, version, datos, u, tipo = "DERIVACION") {
    const e = {};
    if (!String(datos.motivo || "").trim()) e.motivo = "Indica el motivo.";
    if (!String(datos.siguiente || "").trim()) e.siguiente = "Indica la acción siguiente.";
    if (!String(datos.responsable || "").trim()) e.responsable = "Selecciona el responsable.";
    if (Object.keys(e).length) throw new ErrorValidacion(e);
    const i = await incidenciaVigente(A, codigo, version), t = ahora(), revision = t + REVISION_ESCALAMIENTO_MIN * 60;
    const estado = tipo === "ESCALAMIENTO" ? "ESCALADO" : "EN_ATENCION";
    await A.aplicar([
      {op: "actualizar", tabla: "incidencia", id: i.id, version: i.version, cambios: {estado, responsable: datos.responsable, siguiente_accion: datos.siguiente, actualizado_utc: t}},
      evento(i.id, t, tipo, canalDe(u), u.nombre, `${tipo === "ESCALAMIENTO" ? "Escalado" : "Derivado"} a ${datos.destino || datos.responsable} · Motivo: ${datos.motivo} · Revisión esperada ${fmtHora(revision)}`, "R19"),
    ]);
    return {estado: ESTADOS[estado], revision: fmtHora(revision)};
  }
  async function retomar(A, codigo, u) {
    const i = await incidenciaVigente(A, codigo), t = ahora();
    await A.aplicar([
      {op: "insertar", tabla: "contacto", fila: {incidencia_id: i.id, canal: "BOLETERIA", clave_origen: `ret-${i.id}-${t}-${Math.random().toString(36).slice(2, 8)}`, registrado_utc: t, detalle: `Cliente atendido en boletería por ${u.nombre}`}},
      {op: "actualizar", tabla: "incidencia", id: i.id, cambios: {estado: i.estado === "RESUELTO" ? i.estado : "EN_ATENCION", responsable: `Boletería · ${u.nombre}`, actualizado_utc: t}},
      evento(i.id, t, "RETOMA", "BOLETERIA", u.nombre, "Atención retomada con el mismo código, sin repetir datos", "R01/R02"),
    ]);
  }
  async function vistaPreviaResolucion(A, codigo) {
    const i = await incidenciaVigente(A, codigo), f = i.funcion_id ? await A.obtener("funcion", i.funcion_id) : null, t = ahora();
    const aTiempo = f?.inicio_utc != null ? t < f.inicio_utc : null;
    return {a_tiempo: aTiempo, minutos: f?.inicio_utc != null ? Math.floor((f.inicio_utc - t) / 60) : null, funcion: fmtHora(f?.inicio_utc)};
  }
  async function resolver(A, codigo, version, datos, u) {
    const e = {};
    if (!RESULTADOS.includes(datos.resultado)) e.resultado = "Selecciona el resultado.";
    if (String(datos.evidencia || "").trim().length < 5) e.evidencia = "Describe la evidencia operativa (mínimo 5 caracteres).";
    if (Object.keys(e).length) throw new ErrorValidacion(e);
    const i = await incidenciaVigente(A, codigo, version), t = ahora(), f = i.funcion_id ? await A.obtener("funcion", i.funcion_id) : null;
    const resuelto = datos.resultado !== "Sin solución antes de la función";
    const aTiempo = resuelto && f?.inicio_utc != null ? (t < f.inicio_utc ? 1 : 0) : (resuelto ? null : 0);
    await A.aplicar([
      {op: "actualizar", tabla: "incidencia", id: i.id, version: i.version, cambios: {estado: resuelto ? "RESUELTO" : "EN_ATENCION", resultado: datos.resultado, evidencia_resolucion: String(datos.evidencia).trim().slice(0, 1000), resuelto_por: u.nombre, a_tiempo: aTiempo, resuelto_utc: resuelto ? t : null, siguiente_accion: resuelto ? "Sin acción pendiente" : "Atención posterior al inicio: registrar alternativa (R10)", actualizado_utc: t}},
      evento(i.id, t, resuelto ? "RESOLUCION" : "SIN_SOLUCION_A_TIEMPO", canalDe(u), u.nombre, `${datos.resultado} · Evidencia: ${String(datos.evidencia).trim().slice(0, 160)}${aTiempo === 1 ? " · antes del inicio" : aTiempo === 0 ? " · después del inicio" : ""}`, "R21"),
    ]);
    return {a_tiempo: aTiempo};
  }

  /* ------------------------------------------------ función conectada */
  function validarEnlace(url) {
    let x; try { x = new URL(String(url).trim()); } catch { return {ok: false, dominio: "—", detalle: "El enlace debe usar https:// y tener un dominio válido."}; }
    if (x.protocol !== "https:" || String(url).length > 1000) return {ok: false, dominio: x.hostname || "—", detalle: "El enlace debe usar https:// y tener un dominio válido."};
    if (!DOMINIOS.includes(x.hostname.toLowerCase())) return {ok: false, dominio: x.hostname, detalle: "Dominio fuera de la lista aprobada para comprobación automática. Requiere revisión humana."};
    return {ok: true, dominio: x.hostname.toLowerCase()};
  }
  async function verificarEnlace(A, url) {
    const v = validarEnlace(url), t = ahora();
    const r = v.ok ? await A.consultarEnlace(String(url).trim()) : {estado: "NO_VERIFICADO", codigo_http: null, detalle: v.detalle};
    const reg = {url: String(url).trim().slice(0, 1000), dominio: v.dominio, estado: r.estado, codigo_http: r.codigo_http ?? null, detalle: r.detalle, utc: t, evidencia_id: null};
    await A.aplicar([{op: "insertar", tabla: "verificacion_enlace", fila: reg}]);
    return reg;
  }
  /* ------------------------------------------------ feriados oficiales del Perú (dato real por internet) */
  const CLAVE_FERIADOS = "feriados_PE", FUENTE_FERIADOS = "Nager.Date (date.nager.at)";
  const urlFeriados = anio => `https://date.nager.at/api/v3/PublicHolidays/${anio}/PE`;
  function normalizarFeriados(datos, anio) {
    if (!Array.isArray(datos)) return [];
    const vistos = new Set();
    return datos.filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.date.startsWith(String(anio)) && typeof (x.localName || x.name) === "string")
      .map(x => ({fecha: x.date, nombre: String(x.localName || x.name).slice(0, 120), nombre_en: String(x.name || "").slice(0, 120), nacional: x.global !== false ? 1 : 0}))
      .filter(x => !vistos.has(x.fecha + x.nombre) && vistos.add(x.fecha + x.nombre)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  }
  async function feriados(A) {
    const f = (await A.leer("configuracion", {clave: CLAVE_FERIADOS}).catch(() => []))[0];
    if (!f) return null;
    try { const d = JSON.parse(f.valor); d.lista = Object.values(d.anios || {}).flat().sort((a, b) => a.fecha.localeCompare(b.fecha)); return d; } catch { return null; }
  }
  const hoyLima = (t = ahora()) => new Date(t * 1000).toLocaleDateString("en-CA", {timeZone: "America/Lima"});
  function proximosFeriados(info, n = 5, t = ahora()) {
    const hoy = hoyLima(t), base = Date.parse(hoy + "T00:00:00Z");
    return (info?.lista || []).filter(x => x.fecha >= hoy).slice(0, n).map(x => ({...x, dias: Math.round((Date.parse(x.fecha + "T00:00:00Z") - base) / 86400000)}));
  }
  async function actualizarFeriados(A, anios) {
    const t = ahora(), y = Number(hoyLima(t).slice(0, 4)); anios = anios || [y, y + 1];
    const previo = await feriados(A), nuevos = {}, resultado = [];
    for (const anio of anios) {
      const r = await A.consultarFeriados(anio), lista = r.estado === "DISPONIBLE" ? normalizarFeriados(r.datos, anio) : [];
      const ok = lista.length > 0, estado = ok ? "DISPONIBLE" : r.estado === "DISPONIBLE" ? "NO_VERIFICADO" : r.estado;
      const detalle = ok ? `Feriados ${anio}: ${lista.length} registros oficiales recibidos.` : r.estado === "DISPONIBLE" ? `Feriados ${anio}: la respuesta no contiene feriados válidos.` : r.detalle;
      if (ok) nuevos[anio] = lista;
      resultado.push({anio, estado, codigo_http: r.codigo_http ?? null, detalle, cantidad: lista.length});
      await A.aplicar([{op: "insertar", tabla: "verificacion_enlace", fila: {url: urlFeriados(anio), dominio: "date.nager.at", estado, codigo_http: r.codigo_http ?? null, detalle, utc: ahora(), evidencia_id: null}}]);
    }
    if (Object.keys(nuevos).length) {
      const valor = JSON.stringify({fuente: FUENTE_FERIADOS, pais: "PE", consultado_utc: t, anios: {...(previo?.anios || {}), ...nuevos}});
      const fila = (await A.leer("configuracion", {clave: CLAVE_FERIADOS}))[0];
      await A.aplicar([fila ? {op: "actualizar", tabla: "configuracion", id: fila.id, cambios: {valor}} : {op: "insertar", tabla: "configuracion", fila: {clave: CLAVE_FERIADOS, valor}}]);
    }
    return {resultado, guardados: Object.values(nuevos).reduce((n, l) => n + l.length, 0), info: await feriados(A)};
  }

  async function operacion(A) {
    const conteos = {};
    for (const tb of ["incidencia", "contacto", "evento", "verificacion", "compra", "funcion", "sede", "usuario", "verificacion_enlace"]) conteos[tb] = (await A.leer(tb, {})).length;
    const verif = (await A.leer("verificacion_enlace", {})).sort((a, b) => b.id - a.id).slice(0, 8);
    return {version: VERSION, modo: await modo(A), conteos, verificaciones: verif, ...(await A.info())};
  }
  async function reprogramarDemo(A) {
    const p = await proyecto(A), fs = (await A.leer("funcion", {proyecto_id: p.id})).filter(f => f.inicio_utc != null);
    if (!fs.length) return "Sin funciones para reprogramar";
    const ref = Math.max(...fs.map(f => f.inicio_utc)) - 150 * 60, d = (() => { const x = new Date(); x.setSeconds(0, 0); return Math.floor(x.getTime() / 1000); })() - ref;
    await A.aplicar(fs.map(f => ({op: "actualizar", tabla: "funcion", id: f.id, cambios: {inicio_utc: f.inicio_utc + d}})));
    return "Horarios de funciones desplazados a partir de la hora actual";
  }

  return {VERSION, PILOTO, ROLES, ESTADOS, PARTES, OPC_PARTES, RESULTADOS, DOMINIOS, ErrorValidacion, ErrorNegocio, prioridad, fmtHora, fmtFechaHora,
    asegurarDemo, iniciarEnDemo, modo, cuentaDemo, iniciarSesion, elegirRol, cambiarModo, contexto, listar, detalle, registrarCliente,
    consultarRegistroCompra, guardarVerificacion, registrarFalloExterno, vincular, mantenerSeparado, derivar, retomar, vistaPreviaResolucion, resolver,
    validarEnlace, verificarEnlace, feriados, actualizarFeriados, proximosFeriados, normalizarFeriados, urlFeriados, FUENTE_FERIADOS, operacion, reprogramarDemo, proyecto, TIPOS, SEDES, hashClave};
})();
if (typeof module !== "undefined") module.exports = Nucleo;
