// Formato numérico aprobado por el estudiante (configuración regional de su Windows):
// separador de miles «.», separador decimal «,», 2 decimales en importes, negativos con «-» y en rojo.
// Ejemplo: 1.234,10 · -1.234,10. Implementación propia: no depende del idioma del navegador.

export function fmtNum(n: number, d = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const neg = n < 0 && Math.abs(n) >= 0.5 * Math.pow(10, -d);
  const fixed = Math.abs(n).toFixed(d);
  const [ent, dec] = fixed.split(".");
  const grp = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (neg ? "-" : "") + grp + (d > 0 ? "," + dec : "");
}

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return "S/ " + fmtNum(n, 2);
}

/**
 * Interpreta lo que escribe el usuario.
 *  - Con coma: la coma es decimal y los puntos son miles («1.234,10» → 1234.1).
 *  - Sin coma y con varios puntos: los puntos son miles («1.234.567» → 1234567).
 *  - Sin coma y un solo punto seguido de exactamente 3 dígitos: miles («1.200» → 1200).
 *  - Sin coma y un solo punto en otro caso: decimal («26.25» → 26.25), para no multiplicar por error.
 * Devuelve null si está vacío y NaN si no es un número.
 */
export function parseNumero(v: string): number | null {
  let t = String(v ?? "").trim().replace(/\s/g, "").replace(/^S\/\.?/i, "");
  if (t === "") return null;
  if (t.includes(",")) {
    t = t.replace(/\./g, "").replace(",", ".");
    if (t.includes(",")) return NaN;
  } else {
    const puntos = (t.match(/\./g) || []).length;
    if (puntos > 1) t = t.replace(/\./g, "");
    else if (puntos === 1 && /^-?\d{1,3}\.\d{3}$/.test(t)) t = t.replace(".", "");
  }
  if (!/^-?\d*(\.\d+)?$/.test(t) || t === "-" || t === "") return NaN;
  return Number(t);
}
