// Utilidades de presentación compartidas (sin lógica de costeo).
import { fmtNum, fmtMoney, parseNumero } from "../domain/formato";
export const money = (n: number | null | undefined) => fmtMoney(n as any);
export const num = (n: number | null | undefined, d = 2) => fmtNum(n as any, d);
export const neg = (n: number | null | undefined) => (typeof n === "number" && n < -0.004 ? " neg" : "");
export const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const parseNum = (v: string): number | null => parseNumero(v);
export const fechaHora = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
export const pct = (x: number | null | undefined, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? "—" : fmtNum(x * 100, d) + " %");
export function pillEstado(e: string): string {
  const m: Record<string, [string, string]> = {
    CALCULADO: ["ok", "Calculado"], CON_SALDO: ["warn", "Con saldo"], PENDIENTE: ["err", "Pendiente"], BLOQUEADO: ["err", "Bloqueado"],
    CONCILIADO: ["ok", "Conciliado"], CALCULADO_CON_SALDOS: ["warn", "Calculado con saldos"], CALCULADO_CON_BLOQUEOS: ["err", "Calculado con bloqueos"],
    REAL: ["ok", "Real"], ESTIMADO: ["calc", "Estimado"], AJUSTADO: ["warn", "Ajustado"],
  };
  const [c, t] = m[e] || ["none", e];
  return `<span class="pill ${c}">${esc(t)}</span>`;
}

/** Abrevia un nombre largo en un encabezado: corta en un espacio y agrega «…» (el nombre completo va en title). */
export const abrev = (t: string, n: number) => {
  if (!t || t.length <= n) return t;
  const c = t.slice(0, n - 1), sp = c.lastIndexOf(" ");
  return (sp > n * 0.5 ? c.slice(0, sp) : c).replace(/[\s,·—-]+$/, "") + "…";
};
