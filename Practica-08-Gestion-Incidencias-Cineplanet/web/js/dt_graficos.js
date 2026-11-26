/* PC08 · Vistas gráficas de las herramientas de Design Thinking (solo presentación).
   No modifica datos, reglas, versiones ni exportaciones: dibuja el mismo contenido que ya guarda DT. */
(function (G) {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const lleno = x => String(x ?? "").trim().length > 0 && String(x).trim() !== "—";
  const n1 = (x, d = 1) => Number(x).toLocaleString("de-DE", {minimumFractionDigits: d, maximumFractionDigits: d});
  const filas = a => (a || []).filter(r => Object.values(r).some(lleno));
  function partir(t, max, tope) { const p = String(t ?? "").split(/\s+/), L = []; let l = "";
    for (const w of p) { if ((l + " " + w).trim().length > max && l) { L.push(l); l = w; } else l = (l + " " + w).trim(); }
    if (l) L.push(l); if (tope && L.length > tope) { L.length = tope; L[tope - 1] = L[tope - 1].replace(/\s*\S*$/, "") + "…"; } return L; }
  const ic = {
    usuario: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
    cerebro: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
    oido: '<path d="M6 9a6 6 0 1 1 12 0c0 4-4 5-4 9a3 3 0 0 1-6 0"/><path d="M10 9a2 2 0 1 1 4 0"/>',
    ojo: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    globo: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>',
    alerta: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>',
    trofeo: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6"/>',
    flecha: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    check: '<path d="M5 12l5 5 9-10"/>', reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    caja: '<path d="M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10"/>', personas: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15 14.5c3 0 6 2 6 5.5"/>',
  };
  const svgI = (k, cl = "") => `<svg class="gi ${cl}" viewBox="0 0 24 24" aria-hidden="true">${ic[k]}</svg>`;
  const chipEv = c => `<span class="g-chip ${c === "Observado" ? "verde" : c === "Declarado" ? "azul" : c === "Inferido" ? "lila" : "amar"}">${esc(c || "Sin clasificar")}</span>`;

  /* ---------- EM1 · Mapa de empatía (distribución estándar, escala a muchas entradas) ---------- */
  const VIS_EM = 4;
  function EM1(c) {
    const E = filas(c.entradas), de = (...q) => E.filter(e => q.includes(e.cuadrante));
    const una = e => `<div class="g-nota" title="Respaldo: ${esc(e.evidencia || "—")}">${esc(e.texto)}<div>${chipEv(e.clasificacion)}${lleno(e.evidencia) ? `<small>${esc(e.evidencia)}</small>` : ""}</div></div>`;
    const notas = (L, vacio = "Sin hallazgos registrados") => !L.length ? `<div class="g-vacio">${vacio}</div>`
      : `<div class="em-notas">${L.slice(0, VIS_EM).map(una).join("")}</div>${L.length > VIS_EM ? `<details class="g-mas"><summary>Ver ${L.length - VIS_EM} más</summary><div class="em-notas">${L.slice(VIS_EM).map(una).join("")}</div></details>` : ""}`;
    const zona = (cl, icono, titulo, L, vacio) => `<section class="em-z ${cl}"><header>${svgI(icono)}<h3>${titulo}</h3>${L.length ? `<span class="g-cuenta">${L.length}</span>` : ""}</header>${notas(L, vacio)}</section>`;
    return `<div class="g-em1"><div class="em-lienzo"><svg class="em-x" aria-hidden="true"></svg>
      ${zona("z-ps", "cerebro", "Piensa y siente", de("Piensa", "Siente"))}
      ${zona("z-oy", "oido", "Oye", de("Oye"), "Opcional: qué escucha de otros")}
      <div class="em-celda"><div class="em-centro">${svgI("usuario")}<b>Usuario</b><span>${esc(c.perfil || "Perfil objetivo")}</span></div></div>
      ${zona("z-ve", "ojo", "Ve", de("Ve"), "Opcional: qué ve en su entorno")}
      ${zona("z-dh", "globo", "Dice y hace", de("Dice", "Hace"))}</div>
      <div class="em-pie">${zona("z-es", "alerta", "Esfuerzos (dolores)", de("Dolores"))}${zona("z-re", "trofeo", "Resultados (ganancias)", de("Ganancias"))}</div>
      ${lleno(c.contexto) ? `<p class="g-ctx"><b>Contexto del episodio:</b> ${esc(c.contexto)}</p>` : ""}</div>`;
  }
  /* ---------- EM2 · Mapa del cliente con curva de experiencia (amplitud alta, desplazable con muchas etapas) ---------- */
  const COL_CANAL = {"Web o app": "#08467E", "Atención Digital": "#009AB7", "Boletería": "#F89500", "Ingreso a sala": "#087A4F"};
  function EM2(c) {
    const S = filas(c.etapas); if (!S.length) return '<div class="g-vacio">Registra etapas para ver el recorrido.</div>';
    const n = S.length, K = 200, W = n * K, H = 320, y0 = 22, y1 = 298, Y = v => y1 - (Math.min(5, Math.max(1, Number(v) || 0)) - 1) / 4 * (y1 - y0), X = i => (i + .5) * K;
    const P = S.map((s, i) => lleno(s.emocion) ? [X(i), Y(s.emocion), Number(s.emocion), i] : null).filter(Boolean);
    let d = P.length ? `M${P[0][0]},${P[0][1]}` : ""; for (let i = 1; i < P.length; i++) { const [a, b] = [P[i - 1], P[i]], m = (b[0] - a[0]) / 2; d += ` C${a[0] + m},${a[1]} ${b[0] - m},${b[1]} ${b[0]},${b[1]}`; }
    const area = P.length ? `${d} L${P[P.length - 1][0]},${y1} L${P[0][0]},${y1} Z` : "";
    const min = Math.min(...P.map(p => p[2])), total = S.reduce((t, s) => t + (Number(s.espera_min) || 0), 0);
    const deltas = P.slice(1).map((b, k) => { const a = P[k], dv = b[2] - a[2]; if (!dv) return ""; const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      return `<g class="cj-delta ${dv < 0 ? "baja" : "sube"}"><rect x="${mx - 24}" y="${my - 13 + (dv < 0 ? -18 : 18)}" width="48" height="24" rx="12"/><text x="${mx}" y="${my + 4 + (dv < 0 ? -18 : 18)}" text-anchor="middle">${dv < 0 ? "▼" : "▲"} ${Math.abs(dv)}</text></g>`; }).join("");
    const graf = `<svg class="cj-graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Curva de ánimo del cliente por etapa">
      <defs><linearGradient id="cjA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0069AB" stop-opacity=".22"/><stop offset="1" stop-color="#0069AB" stop-opacity="0"/></linearGradient></defs>
      <rect x="0" y="${y0}" width="${W}" height="${(y1 - y0) / 4}" fill="#E4F8EE"/><rect x="0" y="${y1 - (y1 - y0) / 4}" width="${W}" height="${(y1 - y0) / 4}" fill="#FFE8EF"/>
      ${[1, 2, 3, 4, 5].map(v => `<line x1="0" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" class="cj-rej"/><text x="6" y="${Y(v) - 5}" class="cj-eje">${v}</text>`).join("")}
      ${S.map((s, i) => `<line x1="${X(i)}" x2="${X(i)}" y1="${y0}" y2="${y1}" class="cj-vert"/>`).join("")}
      <text x="${W - 10}" y="${y0 + 18}" text-anchor="end" class="cj-zona ok">Satisfecho</text><text x="${W - 10}" y="${y1 - 10}" text-anchor="end" class="cj-zona rj">Insatisfecho</text>
      <path d="${area}" fill="url(#cjA)"/><path d="${d}" class="cj-curva"/>${deltas}
      ${P.map(([x, y, v]) => `<g><circle cx="${x}" cy="${y}" r="${v === min ? 16 : 13}" class="cj-pt ${v <= 2 ? "bajo" : v >= 4 ? "alto" : ""}"/><text x="${x}" y="${y + 5}" text-anchor="middle" class="cj-pt-t">${v}</text></g>`).join("")}
      ${P.filter(p => p[2] === min).slice(0, 1).map(([x, y]) => `<text x="${x}" y="${y + 38 > y1 - 4 ? y - 26 : y + 38}" text-anchor="middle" class="cj-crit">Momento crítico</text>`).join("")}
    </svg>`;
    return `<div class="g-em2"><div class="cj-cab"><div><small>Perfil</small><b>${esc(c.perfil)}</b></div><div><small>Escenario</small><b>${esc(c.escenario)}</b></div><div class="cj-tot"><small>${n} etapas · espera acumulada</small><b class="num">${n1(total, 0)} min</b></div></div>
      <div class="cj-leyenda"><span><i class="l-curva"></i>Ánimo del cliente (1 a 5)</span><span><b class="cj-lb">▼ 1</b> baja entre etapas</span><span><b class="cj-ls">▲ 1</b> sube entre etapas</span>${n > 6 ? "<span>Desliza a la derecha para ver todas las etapas →</span>" : ""}</div>
      <div class="cj-scroll"><div class="cj-rejilla" style="--n:${n}">
        ${S.map((s, i) => `<div class="cj-et" style="--c:${COL_CANAL[s.canal] || "#0069AB"}"><span class="cj-num">${String(i + 1).padStart(2, "0")}</span><b>${esc(String(s.etapa).replace(/^\d+\.\s*/, ""))}</b><small>${esc(s.canal)}</small></div>`).join("")}
        <div class="cj-g" style="grid-column:1/-1">${graf}</div>
        ${S.map(s => `<div class="cj-det">${lleno(s.espera_min) ? `<span class="cj-min">${svgI("reloj")}${n1(s.espera_min, 0)} min de espera</span>` : ""}<p><small>Hace</small>${esc(s.accion)}</p><p><small>Espera</small>${esc(s.expectativa)}</p>${lleno(s.friccion) ? `<p class="cj-fr"><small>Fricción</small>${esc(s.friccion)}</p>` : ""}<p class="cj-res"><small>Resultado</small>${esc(s.resultado)}</p></div>`).join("")}
      </div></div></div>`;
  }
  /* ---------- DF1 · Causa-efecto con líneas rectas (el tamaño crece con el número de causas) ---------- */
  function DF1(c) {
    const C = filas(c.causas), arriba = ["Personas", "Proceso", "Datos"], abajo = ["Recursos", "Reglas", "Entorno"], col = {Respaldada: "#087A4F", Descartada: "#8A99AD", Hipótesis: "#E0A800"};
    const LH = 16, ESP = 14, prep = cat => C.filter(r => r.categoria === cat).map(r => ({r, lin: partir(r.causa, 31, 3)}));
    const alto = L => L.reduce((t, x) => t + x.lin.length * LH + ESP, 0);
    const A = arriba.map(prep), B = abajo.map(prep), spanA = Math.max(250, ...A.map(alto)) + 30, spanB = Math.max(250, ...B.map(alto)) + 30;
    const PEND = 0.45, dxA = spanA * PEND, dxB = spanB * PEND, dx = Math.max(dxA, dxB), PASO = 275, L0 = 250;
    const fin = [0, 1, 2].map(k => L0 + dx + k * PASO), espFin = fin[2] + 40, W = espFin + 300, yA = 58, ys = yA + spanA, yB = ys + spanB, H = yB + 58;
    let s = `<svg class="g-df1" viewBox="0 0 ${W} ${H}" style="min-width:${Math.round(W * .82)}px" role="img" aria-label="Diagrama causa-efecto">
      <defs><marker id="pz" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#E60048"/></marker></defs>
      <line x1="10" y1="${ys}" x2="${espFin}" y2="${ys}" class="if-espina" marker-end="url(#pz)"/>`;
    const rama = (cat, L, k, sup) => { const xE = fin[k], span = sup ? spanA : spanB, dd = span * PEND, x0 = xE - dd, yIni = sup ? ys - span : ys + span, xEn = y => xE - dd * Math.abs(ys - y) / span;
      let o = `<line x1="${x0}" y1="${yIni}" x2="${xE}" y2="${ys}" class="if-rama"/><rect x="${x0 - 80}" y="${sup ? yIni - 40 : yIni + 6}" width="160" height="32" rx="16" class="if-cat"/><text x="${x0}" y="${sup ? yIni - 19 : yIni + 27}" text-anchor="middle" class="if-cat-t">${cat}${L.length ? ` · ${L.length}` : ""}</text>`;
      if (!L.length) return o + `<text x="${xEn((yIni + ys) / 2) - 14}" y="${(yIni + ys) / 2}" text-anchor="end" class="if-vacio">Sin causas registradas</text>`;
      const tot = alto(L), hueco = (span - 30 - tot) / (L.length + 1); let y = (sup ? yIni : ys) + 15 + hueco;
      L.forEach(({r, lin}) => { const h = lin.length * LH; y += h; const x = xEn(y), top = y - 7 - (lin.length - 1) * LH, xt = (sup ? xEn(top - 12) : x) - 12;
        o += `<g><title>${esc(r.causa)}\nMecanismo: ${esc(r.mecanismo)}\nEvidencia: ${esc(r.evidencia)}\nEstado: ${esc(r.estado)}${lleno(r.pendiente) ? "\nDato pendiente: " + esc(r.pendiente) : ""}</title>
          <line x1="${x - 258}" y1="${y}" x2="${x}" y2="${y}" class="if-sub"/><circle cx="${x - 258}" cy="${y}" r="6" fill="${col[r.estado] || col.Hipótesis}"/>
          ${lin.map((l, j) => `<text x="${xt}" y="${top + j * LH}" text-anchor="end" class="if-causa">${esc(l)}</text>`).join("")}</g>`;
        y += ESP + hueco; });
      return o; };
    A.forEach((L, k) => s += rama(arriba[k], L, k, true)); B.forEach((L, k) => s += rama(abajo[k], L, k, false));
    const ef = partir(c.efecto || "Efecto sin definir", 24, 6), ex = espFin + 12;
    s += `<rect x="${ex}" y="${ys - 30 - ef.length * 12}" width="275" height="${60 + ef.length * 24}" rx="14" class="if-efecto"/>
      <text x="${ex + 137}" y="${ys - 8 - ef.length * 12}" text-anchor="middle" class="if-ef-k">PROBLEMA</text>
      ${ef.map((l, j) => `<text x="${ex + 137}" y="${ys + 18 - ef.length * 12 + j * 24}" text-anchor="middle" class="if-ef-t">${esc(l)}</text>`).join("")}</svg>`;
    return `<div class="g-df1w"><div class="g-scroll">${s}</div><div class="g-ley"><span><i style="background:#E0A800"></i>Hipótesis</span><span><i style="background:#087A4F"></i>Respaldada</span><span><i style="background:#8A99AD"></i>Descartada</span><span>${C.length} causas en ${new Set(C.map(r => r.categoria)).size} categorías</span><span class="g-ley-n">Pasa el cursor sobre una causa para ver mecanismo, evidencia y dato pendiente.</span></div></div>`;
  }
  /* ---------- DF2 · Punto de vista y ¿Cómo podríamos…? ---------- */
  function DF2(c) {
    const [num, den] = String(c.indicador || "").split("/").map(x => x.trim()), pp = String(c.criterio || "").match(/(\d+[.,]?\d*)\s*puntos?/i);
    const caja = (t, v) => `<div class="pv-caja"><h4>${t}</h4><p>${esc(v || "Pendiente")}</p></div>`;
    return `<div class="g-df2"><section class="pv-blq"><span class="pv-tit">01 · Punto de vista (POV)</span>
        <div class="pv-fila">${caja("Usuario", c.usuario)}<span class="pv-con">necesita</span>${caja("Necesidad", c.necesidad)}<span class="pv-con">porque</span>${caja("Hallazgo", c.hallazgo)}</div></section>
      <div class="pv-baja">${svgI("flecha")}</div>
      <section class="pv-blq"><span class="pv-tit">02 · ¿Cómo podríamos…? (HMW)</span><p class="pv-hmw">${esc(c.pregunta || "Pendiente")}</p></section>
      <section class="pv-blq"><span class="pv-tit sec">Alcance y validación del reto</span><div class="pv-val">
        <div><span class="pv-pill">Alcance</span><p>${esc(c.alcance || "Pendiente")}</p></div>
        <div><span class="pv-pill">Indicador de éxito</span>${den ? `<div class="pv-frac"><span>${esc(num)}</span><span>${esc(den)}</span></div>` : `<p>${esc(c.indicador || "Pendiente")}</p>`}</div>
        <div><span class="pv-pill">Criterio de éxito</span>${pp ? `<div class="pv-big">+${esc(pp[1])} puntos porcentuales</div>` : ""}<p>${esc(c.criterio || "Pendiente")}</p></div></div></section></div>`;
  }

  /* ---------- ID1 · Brainwriting: rondas × ideas (filas y columnas según los datos) ---------- */
  function ID1(c, x = {}) {
    const I = filas(c.ideas), ron = i => Math.max(1, Math.round(Number(i.ronda) || 1)), maxR = Math.max(0, ...I.map(ron));
    const rondas = Math.max(3, maxR < 6 ? maxR + 1 : maxR), de = r => I.filter(i => ron(i) === r), cols = Math.max(3, ...Array.from({length: rondas}, (_, r) => de(r + 1).length));
    const reto = /^DF2/.test(c.reto || "") && x.df2?.pregunta ? x.df2.pregunta : c.reto;
    return `<div class="g-id1"><div class="bw-reto"><small>Reto de entrada${/^DF2/.test(c.reto || "") ? " (desde DF2)" : ""}</small><b>${esc(reto || "Pendiente")}</b></div>
      <div class="g-scroll"><div class="bw-grid" style="grid-template-columns:110px repeat(${cols},minmax(210px,1fr))"><div class="bw-h"></div>${Array.from({length: cols}, (_, k) => `<div class="bw-h">Idea ${k + 1}</div>`).join("")}
      ${Array.from({length: rondas}, (_, r) => `<div class="bw-r">Ronda ${r + 1}<small>${de(r + 1).length} ideas</small></div>${Array.from({length: cols}, (_, k) => { const i = de(r + 1)[k];
        return i ? `<div class="bw-c"><b>${esc(i.idea)}</b><p>${esc(i.mecanismo)}</p><small>${svgI("personas")}${esc(i.usuario)} · Supuesto: ${esc(i.supuesto)}</small></div>` : `<div class="bw-c vacia">Espacio libre</div>`; }).join("")}`).join("")}</div></div>
      <p class="g-nota-pie">Cada ronda construye sobre las anteriores (6-3-5 simplificado). ${I.length} ideas en ${maxR} ronda${maxR === 1 ? "" : "s"}.${cols > 4 ? " Desliza a la derecha para ver todas las ideas." : ""}</p></div>`;
  }
  /* ---------- ID2 · Matriz impacto / esfuerzo + ranking ponderado ---------- */
  function ID2(c, x = {}) {
    const rk = (x.ranking || (r => r))(c.filas || []), q = v => Math.min(5, Math.max(1, Number(v) || 1));
    const pos = rk.map((r, i) => ({...r, i: i + 1, imp: q(r.valor), esf: 6 - (q(r.factibilidad) + q(r.viabilidad)) / 2}));
    const zona = p => (p.imp >= 4 ? (p.esf <= 3 ? "qw" : "mp") : (p.esf <= 3 ? "co" : "ev"));
    const nota = p => `<div class="mx-nota ${p.idea === c.seleccion ? "sel" : ""}"><span>${p.i}</span>${esc(p.idea)}<small>Impacto ${p.imp} · Esfuerzo ${n1(p.esf)} · Riesgo ${esc(p.riesgo)}</small></div>`;
    const Q = (k, t, d) => `<div class="q ${k}"><h5>${t}<small>${d}</small></h5><div class="mx-notas">${pos.filter(p => zona(p) === k).map(nota).join("")}</div></div>`;
    const max = Math.max(5, ...rk.map(r => r.puntaje || 0));
    return `<div class="g-id2"><aside class="mx-lista"><h4>Ideas por puntaje ponderado</h4><small>Valor 40 % · Factibilidad 25 % · Viabilidad 20 % · Control del riesgo 15 %</small>
        ${rk.map((r, i) => `<div class="mx-it ${r.idea === c.seleccion ? "sel" : ""}"><span class="mx-n">${i + 1}</span><div><b>${esc(r.idea)}</b><div class="mx-bar"><i style="width:${(r.puntaje || 0) / max * 100}%"></i></div></div><b class="num">${n1(r.puntaje || 0, 2)}</b></div>`).join("")}
        <div class="${c.confirmado_por ? "aviso ok" : "aviso pend"}" style="margin-top:12px"><div><b>${c.confirmado_por ? `Elección confirmada por ${esc(c.confirmado_por)}` : "Elección pendiente de confirmación del usuario responsable"}</b>${esc(c.justificacion || "")}</div></div></aside>
      <div class="mx-zona"><div class="mx-eje-y">IMPACTO (valor)</div><div class="mx-cuad">
          ${Q("qw", "Victorias rápidas", "Hacer primero")}${Q("mp", "Proyectos mayores", "Planificar")}${Q("co", "Complementos", "Sumar si alcanza")}${Q("ev", "Evitar", "No priorizar")}
          <span class="mx-t a">Alto</span><span class="mx-t b">Bajo</span></div>
        <div class="mx-eje-x"><span>Bajo</span>ESFUERZO (inverso de factibilidad y viabilidad)<span>Alto</span></div></div></div>`;
  }

  /* ---------- PR1 · Guion gráfico ---------- */
  function PR1(c) {
    const E = filas(c.escenas), N = E.filter(e => e.tipo !== "Excepción"), X = E.filter(e => e.tipo === "Excepción");
    const vin = (e, i, exc) => `<div class="sb-v ${exc ? "exc" : ""}"><div class="sb-cab"><span>${exc ? "!" : i + 1}</span><b>${esc(String(e.titulo).replace(/^E?\d+\.\s*/, ""))}</b></div>
      <div class="sb-esc">${svgI(/Boleter/i.test(e.actor) ? "caja" : /Cliente/i.test(e.actor) ? "usuario" : "personas")}<small>${esc(e.actor)}</small></div>
      <p><small>Hace</small>${esc(e.accion)}</p><p class="sb-ve"><small>Ve / recibe</small>${esc(e.respuesta)}</p><footer>${svgI("flecha")} ${esc(e.traspaso)}</footer></div>`;
    return `<div class="g-pr1"><div class="sb-idea"><small>Idea que se prototipa</small><b>${esc(c.idea)}</b></div>
      <h4 class="sb-lin">Ruta normal</h4><div class="sb-fila" style="--n:${Math.max(1, N.length)}">${N.map((e, i) => vin(e, i)).join('')}</div>
      ${X.length ? `<h4 class="sb-lin exc">Ruta de excepción</h4><div class="sb-fila" style="--n:${Math.max(N.length, 1)}">${X.map(e => vin(e, 0, true)).join("")}</div>` : ""}</div>`;
  }

  /* ---------- PR2 · Fichas de prototipo ---------- */
  function PR2(c) {
    return `<div class="g-pr2">${filas(c.fichas).map(f => `<article class="fc ${f.tipo === "FÍSICO" ? "fis" : "ser"}"><header>${svgI(f.tipo === "FÍSICO" ? "caja" : "personas")}<div><small>Prototipo ${f.tipo === "FÍSICO" ? "físico" : "de servicio"} · ${esc(f.version)}</small><h4>${esc(f.nombre)}</h4></div><b class="fc-costo num">S/ ${n1(Number(f.costo) || 0, 2)}</b></header>
      <p class="fc-hip"><small>Hipótesis</small>${esc(f.hipotesis)}</p>
      <div class="fc-mat"><small>Materiales o insumos</small><div>${String(f.materiales || "").split(/,\s*/).filter(lleno).map(m => `<span class="g-chip gris">${esc(m)}</span>`).join("")}</div></div>
      <div class="fc-2"><p><small>Tarea que se ensaya</small>${esc(f.tarea)}</p><p><small>Roles, traspaso y contingencia</small>${esc(f.roles)}</p></div></article>`).join("") || '<div class="g-vacio">Sin fichas</div>'}</div>`;
  }

  /* ---------- PV1 / PV2 · Resultados de la prueba ---------- */
  function medidor(r) {
    const t = r.tasa ?? 0, u = r.umbral;
    return `<div class="pv-med"><div class="pv-med-t"><div><small>Éxito sin ayuda ni error</small><b class="num">${r.tasa == null ? "—" : n1(r.tasa) + " %"}</b><span>${r.exitos} de ${r.intentos} intentos</span></div>
      <span class="pv-ver ${r.cumple == null ? "" : r.cumple ? "si" : "no"}">${r.cumple == null ? "Sin umbral" : r.cumple ? "Cumple el umbral" : "No cumple el umbral"}</span></div>
      <div class="pv-barra"><i style="width:${t}%" class="${r.cumple ? "si" : "no"}"></i>${u != null ? `<em style="left:${u}%"><span>Umbral ${u} %</span></em>` : ""}</div>
      <div class="pv-esc"><span>0 %</span><span>50 %</span><span>100 %</span></div></div>`;
  }
  function PV1(c, x = {}) {
    const r = x.resumen, I = filas(c.intentos), T = [...new Set(I.map(i => i.tarea))], P = [...new Set(I.map(i => i.participante))].sort((a, b) => String(a).localeCompare(String(b), "es", {numeric: true}));
    const est = i => i.error === "Sí" ? ["rj", "Error crítico"] : i.exito === "Sí" && i.ayuda === "No" ? ["ok", "Éxito sin ayuda"] : i.exito === "Sí" ? ["am", "Éxito con ayuda"] : ["rj", "No logró"];
    const intento = i => { const [k, l] = est(i); return `<div class="pv-int ${k}" title="${esc(i.observacion)}"><b>${l}</b><span class="num">${n1(i.tiempo_s, 0)} s · ${esc(i.version)}</span>${lleno(i.observacion) ? `<small>${esc(i.observacion)}</small>` : ""}</div>`; };
    const porTarea = t => { const L = I.filter(i => i.tarea === t), ok = L.filter(i => est(i)[0] === "ok").length; return `<span class="pv-tt">${ok} de ${L.length} sin ayuda</span>`; };
    return `<div class="g-pv1">${r ? medidor(r) : ""}<div class="tabla-cont"><table class="pv-mat"><thead><tr><th>Tarea</th>${P.map(p => `<th>${esc(p)}</th>`).join("")}</tr></thead><tbody>
      ${T.map(t => `<tr><th>${esc(t)}${porTarea(t)}</th>${P.map(p => { const L = I.filter(z => z.tarea === t && z.participante === p);
        return L.length ? `<td class="pv-c">${L.map(intento).join("")}</td>` : '<td class="pv-c no-ap">—</td>'; }).join("")}</tr>`).join("")}</tbody></table></div>
      <div class="g-ley"><span><i style="background:#087A4F"></i>Éxito sin ayuda</span><span><i style="background:#E0A800"></i>Éxito con ayuda</span><span><i style="background:#E60048"></i>Error crítico o no logró</span><span>${I.length} intentos · ${T.length} tareas · ${P.length} participantes</span><span class="g-ley-n">${Object.entries(r?.porNaturaleza || {}).map(([k, v]) => `${esc(k)}: ${v}`).join(" · ")}</span></div></div>`;
  }
  function PV2(c, x = {}) {
    const ops = ["Iterar el prototipo", "Ampliar el piloto", "Descartar la idea"];
    return `<div class="g-pv2">${x.resumen ? medidor(x.resumen) : ""}<div class="dc-sel">${ops.map(o => `<div class="${o === c.decision ? "on" : ""}">${o === c.decision ? svgI("check") : ""}${o}</div>`).join("")}</div>
      <h4 class="sb-lin">Del hallazgo a la mejora</h4>${filas(c.mejoras).map(m => `<div class="dc-flujo"><div class="dc-h"><small>Hallazgo · ${esc(m.evidencia)}</small>${esc(m.hallazgo)}</div><span class="dc-fl">${svgI("flecha")}</span><div class="dc-m"><small>Mejora · ${esc(m.version)}</small>${esc(m.mejora)}</div><span class="g-chip ${m.prioridad === "Alta" ? "rojo" : m.prioridad === "Media" ? "amar" : "gris"}">Prioridad ${esc(String(m.prioridad).toLowerCase())}</span></div>`).join("")}
      ${lleno(c.limitaciones) ? `<p class="g-ctx"><b>Limitaciones:</b> ${esc(c.limitaciones)}</p>` : ""}
      <div class="${c.confirmado_por ? "aviso ok" : "aviso pend"}"><div><b>${c.confirmado_por ? `Decisión confirmada por ${esc(c.confirmado_por)}` : "Decisión pendiente de confirmación del usuario responsable"}</b></div></div></div>`;
  }

  /* ---------- Trazabilidad del problema a la decisión ---------- */
  function trazabilidad(t) {
    const E = [["Empatizar", "#08467E", [["Evidencia", t.evidencia, "EM1"], ["Fricción", t.friccion, "EM2"]]], ["Definir", "#0069AB", [["Hipótesis", t.hipotesis, "DF1"], ["Reto", t.reto, "DF2"]]],
      ["Idear", "#009AB7", [["Idea elegida", t.idea, "ID2"], ["Puntaje", t.puntaje, "ID2"]]], ["Prototipar", "#F89500", [["Guion", t.guion, "PR1"], ["Prototipo", t.prototipo, "PR2"]]], ["Probar", "#087A4F", [["Tarea", t.tarea, "PV1"], ["Resultado", t.resultado, "PV1"], ["Decisión", t.decision, "PV2", 1]]]];
    return `<div class="tz">${E.map(([n, col, it], i) => `<div class="tz-col" style="--c:${col}"><div class="tz-chev"><span>${i + 1}</span>${n}</div>
      ${it.map(([k, v, cod, fin]) => `<a class="tz-card ${fin ? "fin" : ""} ${lleno(v) ? "" : "pend"}" href="#/dt/${cod}"><small>${k} · ${cod}</small><span>${esc(lleno(v) ? v : "Pendiente")}</span></a>`).join("")}</div>`).join("")}</div>`;
  }

  /* Líneas del mapa de empatía: del centro del usuario a cada esquina de su celda y de ahí a la esquina del lienzo.
     Pasan solo por la celda del usuario y por las celdas de esquina, que están vacías: nunca cruzan una nota. */
  function trazarEmpatia(L) {
    const svg = L.querySelector(".em-x"), cen = L.querySelector(".em-centro"), cel = L.querySelector(".em-celda"); if (!svg || !cen || !cel) return;
    const R = L.getBoundingClientRect(), c = cen.getBoundingClientRect(), k = cel.getBoundingClientRect(), g = 9;
    const cx = c.left + c.width / 2 - R.left, cy = c.top + c.height / 2 - R.top, x1 = k.left - R.left - g, x2 = k.right - R.left + g, y1 = k.top - R.top - g, y2 = k.bottom - R.top + g;
    svg.setAttribute("viewBox", `0 0 ${R.width} ${R.height}`);
    svg.innerHTML = [[x1, y1, 0, 0], [x2, y1, R.width, 0], [x1, y2, 0, R.height], [x2, y2, R.width, R.height]].map(([vx, vy, ex, ey]) => `<polyline points="${cx},${cy} ${vx},${vy} ${ex},${ey}"/>`).join("");
  }
  if (typeof window !== "undefined" && typeof MutationObserver !== "undefined") {
    const vistos = new WeakSet(), ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(es => es.forEach(e => trazarEmpatia(e.target))) : null;
    const buscar = () => document.querySelectorAll(".em-lienzo").forEach(L => { if (vistos.has(L)) return; vistos.add(L); trazarEmpatia(L); ro && ro.observe(L); L.addEventListener("toggle", () => trazarEmpatia(L), true); });
    const iniciar = () => { buscar(); new MutationObserver(buscar).observe(document.body, {childList: true, subtree: true}); };
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", iniciar) : iniciar();
  }

  G.DTG = {EM1, EM2, DF1, DF2, ID1, ID2, PR1, PR2, PV1, PV2, trazabilidad, trazarEmpatia, tiene: cod => ["EM1", "EM2", "DF1", "DF2", "ID1", "ID2", "PR1", "PR2", "PV1", "PV2"].includes(cod)};
})(typeof window !== "undefined" ? window : globalThis);
