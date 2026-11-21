// Fechas y horas en zona fija de Lima (UTC-05:00, sin horario de verano).
// Representación persistida: 'AAAA-MM-DDTHH:MM:SS-05:00' (ordenable como texto).
const OFF_MS = -5 * 3600 * 1000;
const pad = (n, w = 2) => String(n).padStart(w, '0');

export function msAIso(ms) {
  const d = new Date(ms + OFF_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}-05:00`;
}
export function isoAMs(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error('Fecha inválida: ' + iso);
  return ms;
}
export function ahoraIso() { return msAIso(Date.now()); }

// Texto local 'AAAA-MM-DD HH:MM' (o con T) → ISO Lima; null si no es válido
export function textoLocalAIso(txt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(txt).trim());
  if (!m) return null;
  const [_, y, mo, d, h, mi, s] = m;
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)) - OFF_MS;
  const iso = msAIso(ms);
  // rechaza fechas imposibles (31/02, 25:00)
  if (iso.slice(0, 16) !== `${y}-${mo}-${d}T${h}:${mi}`) return null;
  return iso;
}
export function textoFechaValida(txt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(txt).trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
// Número de serie de Excel (días desde 1899-12-30) interpretado como hora local de Lima
export function serialExcelAIso(n) {
  const msLocal = Math.round((n - 25569) * 86400 * 1000 / 60000) * 60000;
  return msAIso(msLocal - OFF_MS);
}
export function serialExcelAFecha(n) { return serialExcelAIso(n).slice(0, 10); }

// Presentación: dd/mm/aaaa HH:MM (hora de Lima)
export function mostrarFH(iso) {
  if (!iso) return '—';
  const s = msAIso(isoAMs(iso));
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}`;
}
export function mostrarF(fecha) {
  if (!fecha) return '—';
  const s = String(fecha);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}
export function minutosEntre(aIso, bIso) { return Math.round((isoAMs(bIso) - isoAMs(aIso)) / 60000); }
export function sello() { // AAAAMMDD_HHMM
  const s = ahoraIso();
  return s.slice(0, 10).replace(/-/g, '') + '_' + s.slice(11, 16).replace(':', '');
}
