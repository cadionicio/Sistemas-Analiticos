// Registro de las exportaciones hechas en esta sesión (se muestra en «Exportar resultados»).
const lista = [];
export function registrarExportacion(libro, nombre, id) { lista.unshift({ libro, nombre, id, hora: new Date() }); }
export const exportacionesSesion = () => lista.slice(0, 15);
