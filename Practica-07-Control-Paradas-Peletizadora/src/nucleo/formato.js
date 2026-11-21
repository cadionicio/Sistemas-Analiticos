// Formato numérico acordado: coma para miles y punto decimal en magnitudes (12,000.00);
// conteos enteros sin agrupación (12000). Negativos con signo menos y clase CSS 'neg' (rojo).
export function fmtMagnitud(x, dec = 2) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  const s = Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return (x < 0 ? '-' : '') + s;
}
export function fmtConteo(n) {
  if (n === null || n === undefined) return '—';
  return (n < 0 ? '-' : '') + String(Math.abs(Math.trunc(n)));
}
export function fmtSoles(cent) { return 'S/ ' + fmtMagnitud(cent / 100, 2); }
export function claseNum(x) { return x < 0 ? 'num neg' : 'num'; }
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
