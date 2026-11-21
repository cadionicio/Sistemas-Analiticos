/**
 * Reglas de calidad de datos. Nada se corrige en silencio: cada hallazgo se registra
 * con su regla, severidad, cantidad de registros y ejemplos (fila de origen).
 *
 * Índice de calidad (0–100) = 100 × (1 − Σ peso(severidad) × afectados / total).
 * Pesos: CRITICA 1 · ALTA 0.5 · MEDIA 0.2 · BAJA 0.05 · INFO 0 (los hallazgos INFO son de negocio, no errores).
 */
export type Severidad = 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAJA' | 'INFO';

export interface Hallazgo {
  regla: string;
  descripcion: string;
  severidad: Severidad;
  afectados: number;
  ejemplos: number[]; // filas de origen (1 = primera fila del Excel)
  detalle?: string;
}

export const PESO: Record<Severidad, number> = { CRITICA: 1, ALTA: 0.5, MEDIA: 0.2, BAJA: 0.05, INFO: 0 };

export class Acumulador {
  private mapa = new Map<string, Hallazgo>();
  agregar(regla: string, descripcion: string, severidad: Severidad, fila?: number, detalle?: string): void {
    let h = this.mapa.get(regla);
    if (!h) {
      h = { regla, descripcion, severidad, afectados: 0, ejemplos: [], detalle };
      this.mapa.set(regla, h);
    }
    h.afectados++;
    if (fila != null && h.ejemplos.length < 50) h.ejemplos.push(fila);
  }
  fijar(h: Hallazgo): void {
    this.mapa.set(h.regla, h);
  }
  lista(): Hallazgo[] {
    const orden: Severidad[] = ['CRITICA', 'ALTA', 'MEDIA', 'BAJA', 'INFO'];
    return [...this.mapa.values()].sort((a, b) => orden.indexOf(a.severidad) - orden.indexOf(b.severidad) || b.afectados - a.afectados);
  }
}

export function indiceCalidad(hallazgos: Hallazgo[], total: number): number {
  if (total <= 0) return 0;
  const pen = hallazgos.reduce((s, h) => s + PESO[h.severidad] * Math.min(h.afectados, total) / total, 0);
  return Math.max(0, Math.min(100, Math.round((1 - pen) * 1000) / 10));
}

/** Mediana y desviación absoluta mediana (MAD) para detectar valores atípicos robustos. */
export function medianaMAD(xs: number[]): { mediana: number; mad: number } {
  const s = [...xs].sort((a, b) => a - b);
  const med = (arr: number[]) => (arr.length === 0 ? 0 : arr.length % 2 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2);
  const mediana = med(s);
  const mad = med(s.map((x) => Math.abs(x - mediana)).sort((a, b) => a - b));
  return { mediana, mad };
}
