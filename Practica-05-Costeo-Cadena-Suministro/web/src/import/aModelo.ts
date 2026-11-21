// Convierte un Paquete en la entrada del motor para un período (usado en pruebas y en vista previa de importación).
import { Paquete } from "./paquete";
import { ModeloInput } from "../domain/motor";
import { costoEmpresa } from "../domain/abc";

export function paqueteAInput(P: Paquete, periodo: string): ModeloInput {
  const puesto = new Map(P.puestos.map((p) => [p.codigo, p]));
  return {
    igv: P.empresa.igv,
    centros: P.centros.map((c) => ({ id: c.codigo, codigo: c.codigo, nombre: c.nombre, participacion: c.participacion, pct: c.pct ?? null })),
    actividades: P.actividades.map((a) => ({ id: a.codigo, codigo: a.codigo, nombre: a.nombre, centroId: a.centro, alcance: a.alcance, pct: a.pct ?? null, clase: a.clase ?? null })),
    materiales: P.materiales.map((m) => {
      const pr = P.precios.find((x) => x.material === m.codigo && x.periodo === periodo);
      return { id: m.codigo, codigo: m.codigo, nombre: m.nombre, unidad: m.unidadConsumo, costoFactura: pr ? pr.costoFactura : m.costoFactura, cantidadFactura: m.cantidadFactura, equivalencia: m.equivalencia, incluyeIgv: m.incluyeIgv, igvRecuperable: m.igvRecuperable, tratamientoValidado: m.validado };
    }),
    consumos: P.consumos.filter((c) => c.periodo === periodo).map((c) => ({ actividadId: c.actividad, materialId: c.material, cantidad: c.cantidad })),
    servicios: P.servicios.filter((s) => s.periodo === periodo).map((s, i) => ({ id: "S" + i, actividadId: s.actividad, proveedor: s.proveedor, servicio: s.servicio, cantidad: s.cantidad, unidad: s.unidad, tarifa: s.tarifa })),
    personas: P.personas.map((p) => {
      const c = P.costos.find((x) => x.persona === p.codigo && x.periodo === periodo);
      return {
        id: p.codigo, codigo: p.codigo, nombre: p.nombre, puesto: puesto.get(p.puesto)?.nombre || p.puesto, tipo: puesto.get(p.puesto)?.tipo || "DIRECTO", centroId: p.centro ?? null,
        costo: c ? costoEmpresa(c) : 0, horas: c ? c.horas : 0, autorizada: c ? c.autorizada : false, agregado: p.agregado,
      };
    }),
    horas: P.horas.filter((h) => h.periodo === periodo).map((h) => ({ personaId: h.persona, actividadId: h.actividad, horas: h.horas })),
    ecs: P.ecs.map((e) => ({ id: e.codigo, codigo: e.codigo, nombre: e.nombre, monto: P.ecMontos.find((m) => m.ec === e.codigo && m.periodo === periodo)?.monto || 0 })),
    reglas: P.reglas.map((r) => ({ id: r.codigo, codigo: r.codigo, nivel: r.nivel, origenId: r.origen, centroId: r.centro ?? null, inductor: r.inductor, unidad: r.unidad, tipo: r.tipo, baseDesde: r.baseDesde ?? null })),
    bases: P.bases.filter((b) => b.periodo === periodo).map((b) => ({ reglaId: b.regla, destinoId: b.destino, valor: b.valor, estado: b.estado })),
    objetos: P.objetos.map((o) => ({ id: o.codigo, codigo: o.codigo, nombre: o.nombre, magnitud: o.magnitud, cantidad: P.magnitudes.find((m) => m.objeto === o.codigo && m.periodo === periodo)?.cantidad ?? null, clase: o.clase })),
  };
}
