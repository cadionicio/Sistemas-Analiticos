// Pruebas de reglas del núcleo común (node pruebas/nucleo.test.js)
const N = require("../web/js/nucleo.js");
let f = 0; const caso = (n, o, e) => { const ok = JSON.stringify(o) === JSON.stringify(e); if (!ok) f++; console.log(`${ok ? "PASA " : "FALLA"} ${n}: esperado=${JSON.stringify(e)} obtenido=${JSON.stringify(o)}`); };
const T = 1000000;
[[900, "CRITICO"], [901, "URGENTE"], [2700, "URGENTE"], [2701, "NORMAL"], [1, "CRITICO"], [0, "FUNCION_INICIADA"], [-60, "FUNCION_INICIADA"]].forEach(([s, e]) => caso(`prioridad ${s}s`, N.prioridad(T + s, T).nivel, e));
caso("horario desconocido", N.prioridad(null, T, "DESCONOCIDO").nivel, "VERIFICAR_HORARIO");
caso("horario contradictorio", N.prioridad(T + 99, T, "CONTRADICTORIO").nivel, "VERIFICAR_HORARIO");
caso("resuelto", N.prioridad(T + 99, T, "CONFIRMADO", "RESUELTO").nivel, "CERRADO");
caso("minutos 14:59", N.prioridad(T + 899, T).minutos, 14);
caso("enlace permitido", N.validarEnlace("https://example.com").ok, true);
caso("enlace http rechazado", N.validarEnlace("http://example.com").ok, false);
caso("dominio no aprobado", N.validarEnlace("https://google.com").ok, false);
(async () => {
  const h = await N.hashClave("Demo2026", "00112233445566778899aabbccddeeff");
  caso("PBKDF2 igual que Python", h, "d0cd4dd78b7339d873e8b4bd88b0c18304ff579943e98f7662ab289437e9526b");
caso("feriados: normaliza y descarta inválidos", N.normalizarFeriados([{date: "2026-12-08", localName: "Inmaculada Concepción", name: "Immaculate Conception", global: true}, {date: "x", localName: "y"}, {date: "2025-01-01", localName: "otro año"}, {date: "2026-12-08", localName: "Inmaculada Concepción"}], 2026).length, 1);
caso("feriados: dominio de la API aprobado", N.validarEnlace("https://date.nager.at/api/v3/PublicHolidays/2026/PE").ok, true);
  console.log(`\nResultado: ${f ? "FALLA" : "PASA"} (${f} fallos)`); process.exit(f ? 1 : 0);
})();
