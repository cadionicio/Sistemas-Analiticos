/**
 * Capa de "anfitrión": aísla lo que depende de dónde corre el sistema.
 *  - HTML (navegador): sin rastro (sin localStorage ni IndexedDB, EX-2); la BD vive en memoria y los archivos se descargan.
 *  - EXE (WebView2): la página se sirve en memoria desde http://sadpgi.localhost/ y el anfitrión en Go ofrece
 *    /__host/bd (BD persistente en la carpeta oculta junto al EXE), /__host/guardar ("Guardar como" nativo),
 *    /__host/config (modo sin rastro) y /__host/cerrar (cierre ordenado). Nada sale a la red.
 */
export const esEXE = () => location.hostname === 'sadpgi.localhost';
export const modo = () => (esEXE() ? 'EXE (WebView2)' : 'HTML (navegador)');

export interface InfoHost { modo: string; version: string; soloLectura: boolean; carpetaDatos: string; exe: string; sinRastro: boolean }
let info: InfoHost | null = null;
export async function infoHost(): Promise<InfoHost | null> {
  if (!esEXE()) return null;
  if (!info) { try { info = await (await fetch('/__host/info')).json(); } catch { info = null; } }
  return info;
}

export const deBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Guarda un archivo generado en memoria: en el EXE con "Guardar como" nativo; en HTML como descarga del navegador. */
export async function guardarArchivo(nombre: string, datos: Uint8Array | string, mime: string): Promise<boolean> {
  const bytes = typeof datos === 'string' ? new TextEncoder().encode(datos) : datos;
  if (esEXE()) {
    const r = await (await fetch(`/__host/guardar?nombre=${encodeURIComponent(nombre)}`, { method: 'POST', body: bytes as BodyInit })).json() as { ok: boolean; error?: string; ruta?: string };
    if (!r.ok && r.error !== 'cancelado') throw new Error(r.error ?? 'No se pudo guardar el archivo');
    return r.ok;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}
export function guardarDataUrl(nombre: string, dataUrl: string): Promise<boolean> {
  return guardarArchivo(nombre, deBase64(dataUrl.split(',')[1]), dataUrl.slice(5, dataUrl.indexOf(';')));
}

/** Abre un selector de archivos y devuelve los bytes (no toca el archivo original). */
export function elegirArchivos(accept: string, multiple = false): Promise<{ nombre: string; datos: Uint8Array }[]> {
  return new Promise((ok) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = multiple;
    i.onchange = async () => ok(await Promise.all([...(i.files ?? [])].map(async (f) => ({ nombre: f.name, datos: new Uint8Array(await f.arrayBuffer()) }))));
    i.click();
  });
}

/** BD persistente: solo en el EXE (carpeta oculta junto al ejecutable). En HTML la BD vive en memoria. */
export async function cargarBDPersistida(): Promise<Uint8Array | undefined> {
  if (!esEXE()) return undefined;
  try {
    const r = await fetch('/__host/bd');
    if (r.status !== 200) return undefined;
    const b = new Uint8Array(await r.arrayBuffer());
    return b.length > 100 ? b : undefined;
  } catch { return undefined; }
}
export async function persistirBD(bytes: Uint8Array): Promise<boolean> {
  if (!esEXE() || (await infoHost())?.soloLectura) return false;
  try { return ((await (await fetch('/__host/bd', { method: 'POST', body: bytes as BodyInit })).json()) as { ok: boolean }).ok; } catch { return false; }
}
export async function configurarHost(c: { sinRastro: boolean }): Promise<void> {
  if (esEXE()) await fetch('/__host/config', { method: 'POST', body: JSON.stringify(c) });
}
export const avisarCierreListo = () => fetch('/__host/cerrar', { method: 'POST' }).catch(() => undefined);
