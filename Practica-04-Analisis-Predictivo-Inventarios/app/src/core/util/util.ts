/**
 * Utilidades comunes: fechas de Excel, normalización de texto, hash SHA-256,
 * formato numérico peruano (decidido en el PC1) y reloj en hora de Lima.
 */

/** Convierte un número de serie de Excel (sistema 1900) a 'aaaa-mm-dd', sin efectos de zona horaria. */
export function serialExcelAISO(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400) * 1000; // 25569 = días entre 1899-12-30 y 1970-01-01
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Acepta serie de Excel, Date, 'dd/mm/aaaa', 'aaaa-mm-dd'. Devuelve ISO o null si no es fecha válida. */
export function aFechaISO(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && isFinite(v) && v > 1 && v < 2958466) return serialExcelAISO(v);
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valida(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const anio = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return valida(anio, +m[2], +m[1]);
  }
  return null;
}

function valida(a: number, m: number, d: number): string | null {
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Normaliza un texto para comparar encabezados: minúsculas, sin tildes ni signos. */
export function normalizar(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Convierte a número; acepta '1,234.56', '1 234,56' y 'S/ 1,234'. */
export function aNumero(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).replace(/S\/|\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return isFinite(n) ? n : null;
}

/** SHA-256 hexadecimal (Web Crypto en navegador/WebView2/Node; respaldo en JS puro). */
export async function sha256(datos: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const h = await subtle.digest('SHA-256', bytes as unknown as BufferSource);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256JS(bytes);
}

/** Implementación de respaldo (FIPS 180-4) para contextos sin Web Crypto. */
export function sha256JS(m: Uint8Array): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const l = m.length, nb = ((l + 9 + 63) >> 6) << 6, b = new Uint8Array(nb);
  b.set(m); b[l] = 0x80;
  const dv = new DataView(b.buffer);
  dv.setUint32(nb - 4, (l * 8) >>> 0); dv.setUint32(nb - 8, Math.floor((l * 8) / 2 ** 32));
  const w = new Uint32Array(64);
  const r = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < nb; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, bb, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += bb; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** Formato numérico único (PC1): miles con coma, decimales con punto. */
export function fmtNum(n: number | null | undefined, dec = 0): string {
  if (n == null || !isFinite(n)) return '—';
  if (Math.abs(n) < 0.5 * 10 ** -dec) n = 0; // evita "-0.0"
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
export const fmtSoles = (n: number | null | undefined, dec = 2) => (n == null ? '—' : `S/ ${fmtNum(n, dec)}`);
export const fmtMillones = (n: number | null | undefined, dec = 1) => (n == null ? '—' : `S/ ${fmtNum(n / 1e6, dec)} M`);
export const fmtPct = (x: number | null | undefined, dec = 2) => (x == null || !isFinite(x) ? '—' : `${fmtNum(x * 100, dec)} %`);

/** Marca de tiempo local de Lima (UTC−5, sin horario de verano) en formato ISO sin zona. */
export function ahoraLima(): string {
  const d = new Date(Date.now() - 5 * 3600 * 1000);
  return d.toISOString().slice(0, 19);
}

/** Identificador único para run_id. */
export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const v = (Math.random() * 16) | 0;
    return (ch === 'x' ? v : (v & 0x3) | 0x8).toString(16);
  });
}
