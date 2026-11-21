/** Resultados vigentes del Super Agente (una ejecución completa del Coordinador). */
import type { ResultadoSkill } from '../analitica/contrato';
import type { DescriptivoVentas, DescriptivoKardex } from '../analitica/descriptivo';
import type { DiagnosticoVentas, DiagnosticoKardex } from '../analitica/diagnostico';
import type { PredictivoVentas, PredictivoKardex } from '../analitica/predictivo';
import type { Prescriptivo } from '../analitica/prescriptivo';
import type { Simulacion } from '../analitica/montecarlo';

export interface Resultados {
  dv?: ResultadoSkill<DescriptivoVentas>; gv?: ResultadoSkill<DiagnosticoVentas>; pv?: ResultadoSkill<PredictivoVentas>;
  dk?: ResultadoSkill<DescriptivoKardex>; gk?: ResultadoSkill<DiagnosticoKardex>; pk?: ResultadoSkill<PredictivoKardex>;
  pr?: ResultadoSkill<Prescriptivo>; sm?: ResultadoSkill<Simulacion>;
  generadoEn?: string; desactualizado?: boolean;
}
