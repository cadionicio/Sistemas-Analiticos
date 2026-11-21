// Paquete normalizado de un modelo (independiente del formato de origen).
export interface Paquete {
  formato: "PLANTILLA_PROFESOR" | "EJEMPLO_APLICATIVO" | "PC05_NORMALIZADO";
  modelo: { codigo: string; nombre: string; descripcion: string; origen: "PLANTILLA" | "EJEMPLO" | "DEMO" | "USUARIO" };
  empresa: { nombre: string; sintetico: boolean; igv: number; moneda: string };
  archivo: string;
  sha256: string;
  periodos: { codigo: string; nombre: string; orden: number }[];
  centros: { codigo: string; nombre: string; participacion: "PARTICIPA" | "NO_PARTICIPA" | "PARCIAL"; pct?: number | null; nota?: string }[];
  actividades: { codigo: string; nombre: string; centro: string; alcance: "INCLUIDA" | "EXCLUIDA" | "PARCIAL"; pct?: number | null; clase?: string | null; nota?: string; orden: number }[];
  puestos: { codigo: string; nombre: string; tipo: "DIRECTO" | "INDIRECTO" }[];
  personas: { codigo: string; nombre: string; puesto: string; centro?: string | null; sintetico: boolean; agregado: boolean }[];
  costos: { persona: string; periodo: string; remuneracion: number; essalud: number; gratificacion: number; cts: number; vacaciones: number; bonos: number; otros: number; horas: number; autorizada: boolean; justificacion?: string; fuente: string }[];
  horas: { persona: string; actividad: string; periodo: string; horas: number; fuente: string }[];
  materiales: { codigo: string; nombre: string; unidadConsumo: string; unidadFactura?: string; costoFactura: number; cantidadFactura: number; equivalencia: number; equivalenciaTexto?: string; incluyeIgv: boolean; igvRecuperable: boolean; validado: boolean; fuente: string }[];
  precios: { material: string; periodo: string; costoFactura: number }[];
  consumos: { actividad: string; material: string; periodo: string; cantidad: number; fuente: string }[];
  servicios: { actividad: string; periodo: string; proveedor: string; servicio: string; cantidad: number; unidad: string; tarifa: number; documento?: string; fuente: string }[];
  ecs: { codigo: string; nombre: string; tipo?: string }[];
  ecMontos: { ec: string; periodo: string; monto: number; fuente: string }[];
  reglas: { codigo: string; nivel: "EC_CA" | "CA_AC" | "AC_OC"; origen: string; centro?: string | null; inductor: string; unidad: string; tipo: "cantidad" | "porcentaje" | "importe" | "directo" | "plano"; baseDesde?: string | null; fuente: string }[];
  bases: { regla: string; destino: string; periodo: string; valor: number | null; estado: "REAL" | "ESTIMADO" | "AJUSTADO" | "PENDIENTE"; metodo?: string; fuente: string }[];
  objetos: { codigo: string; nombre: string; magnitud: string; clase: "OBJETO" | "OBJETO_REVISION" | "KPI"; nota?: string }[];
  magnitudes: { objeto: string; periodo: string; cantidad: number | null; fuente: string }[];
  presupuesto: { periodo: string; concepto: string; monto: number; unidad: string }[];
  finanzas: { periodo: string; ventas: number | null; costoVentas: number | null; otrosGastos: number | null; tasaImpuesto: number | null }[];
  parametrosEva: { clave: string; valor: number | null; unidad: string; descripcion: string }[];
  escenarios: { escenario: string; variable: string; distribucion: string; minimo: number; moda: number; maximo: number }[];
  referencias: { hoja: string; celda: string; concepto: string; clave: string; valor: number | null; formula?: string }[];
  advertencias: string[];
}

export function paqueteVacio(formato: Paquete["formato"]): Paquete {
  return {
    formato, modelo: { codigo: "", nombre: "", descripcion: "", origen: "USUARIO" }, empresa: { nombre: "", sintetico: false, igv: 0.18, moneda: "PEN" },
    archivo: "", sha256: "", periodos: [], centros: [], actividades: [], puestos: [], personas: [], costos: [], horas: [], materiales: [], precios: [],
    consumos: [], servicios: [], ecs: [], ecMontos: [], reglas: [], bases: [], objetos: [], magnitudes: [], presupuesto: [], finanzas: [], parametrosEva: [], escenarios: [], referencias: [], advertencias: [],
  };
}

export const norm = (s: any) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
