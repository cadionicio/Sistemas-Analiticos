"""Registro canonico de especialistas del superagente.

Un unico lugar donde se declara la plantilla completa de agentes. La CLI, la
Torre de Control y las pruebas la consumen desde aqui en lugar de repetir la
lista: si en el futuro se anade un especialista, se incorpora a las tres vias
de ejecucion sin que ninguna quede desactualizada en silencio.
"""

from __future__ import annotations

from agents.core_agent import AgenteControlDatos, AgenteEspecialista
from agents.descriptivo import AgenteDescriptivo
from agents.diagnostico import AgenteDiagnostico
from agents.predictivo import AgentePredictivo
from agents.prescriptivo import AgentePrescriptivo
from db.db_manager import DatabaseManager


def agentes_completos(db: DatabaseManager | None = None) -> list[AgenteEspecialista]:
    """Devuelve instancias nuevas de los cinco especialistas.

    Se devuelven INSTANCIAS NUEVAS en cada llamada: un agente conserva el
    logger y la referencia a la base, y reutilizar la misma instancia entre
    corridas mezclaria el estado de dos ejecuciones distintas.

    Args:
        db: gestor de base de datos a inyectar. Por defecto, el Singleton.

    Returns:
        list[AgenteEspecialista]: en el orden analitico canonico.
    """
    return [
        AgenteControlDatos(db=db),
        AgenteDescriptivo(db=db),
        AgenteDiagnostico(db=db),
        AgentePredictivo(db=db),
        AgentePrescriptivo(db=db),
    ]
