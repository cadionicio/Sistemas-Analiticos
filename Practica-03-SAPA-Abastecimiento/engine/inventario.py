"""Motor determinista de cantidades: teoria de inventarios y lote dinamico.

Separacion de responsabilidades que el sistema respeta de forma estricta: el
motor predictivo ESTIMA, este motor CALCULA. Ninguna cifra de este modulo
proviene de un modelo de lenguaje ni de una heuristica no documentada; todas
son formulas cerradas o programacion dinamica exacta, auditables linea a linea.

Contenido:
    - Stock de seguridad con lead time estocastico (formula de King).
    - Punto de pedido y posicion de inventario.
    - Lote economico de Harris (1913).
    - Wagner-Whitin (1958): lote dinamico multiperiodo OPTIMO, O(T^2).
    - Proyeccion recursiva del balance con empaque, MOQ y arrastre de excedente.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from config import settings
from engine.validacion import cuantil_normal

_EPS = 1e-9


# =============================================================================
# 1. PROTECCION CONTRA LA INCERTIDUMBRE
# =============================================================================
def sigma_demanda_durante_lead_time(
    sigma_demanda: float, demanda_media: float,
    lead_time_medio: float, sigma_lead_time: float,
) -> float:
    """Desviacion estandar de la demanda durante el plazo de proteccion.

    Formula de King (2011), valida bajo independencia entre demanda y plazo:

        sigma_DDLT = sqrt( L_bar * sigma_d^2  +  d_bar^2 * sigma_L^2 )
                          \_____________/        \_______________/
                        varianza por demanda    varianza por plazo

    El SEGUNDO sumando es el que casi siempre se omite. Su peso crece con el
    cuadrado de la demanda media, de modo que en un material de alta rotacion
    con plazo volatil -por ejemplo un importado- domina por completo la
    varianza total. Usar `z * sigma_d * sqrt(L)` en ese caso subestima la
    proteccion justo donde el quiebre es mas caro.

    Args:
        sigma_demanda: desviacion de la demanda por periodo.
        demanda_media: demanda media por periodo.
        lead_time_medio: plazo medio EN LA MISMA UNIDAD de periodo.
        sigma_lead_time: desviacion del plazo, misma unidad.

    Returns:
        float: sigma de la demanda durante el lead time.
    """
    l = max(float(lead_time_medio), 0.0)
    sd = max(float(sigma_demanda), 0.0)
    d = max(float(demanda_media), 0.0)
    sl = max(float(sigma_lead_time), 0.0)
    return math.sqrt(l * sd * sd + d * d * sl * sl)


def parametros_lognormal(media_exceso: float, sigma_exceso: float) -> tuple[float, float]:
    """Convierte (media, desviacion) del exceso a parametros log-normales.

    El lead time se modela como log-normal DESPLAZADA:

        LT = LT_min + LogNormal(mu_ln, sigma_ln)

    Error que esta funcion evita: pasar la media deseada directamente como `mu`.
    En una log-normal `mu` es la media del LOGARITMO, no de la variable, de modo
    que hacerlo produce E[LT] = exp(mu + sigma^2/2), un plazo sistematicamente
    mayor al pretendido, con un sesgo que crece con sigma. La parametrizacion
    correcta por momentos es:

        sigma_ln^2 = ln(1 + s^2 / m^2)
        mu_ln      = ln(m) - sigma_ln^2 / 2

    Vive aqui, y no en el generador sintetico, porque la necesitan dos
    consumidores: la simulacion de datos y la IMPORTACION de parametria real,
    donde el usuario declara plazo medio y desviacion en dias y el sistema debe
    derivar los parametros de la distribucion sin pedirselos.

    Args:
        media_exceso: media deseada del exceso sobre el lead time minimo.
        sigma_exceso: desviacion estandar deseada de ese exceso.

    Returns:
        tuple[float, float]: (mu_ln, sigma_ln).
    """
    m = max(float(media_exceso), 1e-6)
    s = max(float(sigma_exceso), 1e-9)
    sigma_ln = math.sqrt(math.log(1.0 + (s * s) / (m * m)))
    mu_ln = math.log(m) - 0.5 * sigma_ln * sigma_ln
    return mu_ln, sigma_ln


def segmento_kraljic(score_impacto: float, score_riesgo: float, corte: float = 0.50) -> str:
    """Deriva el cuadrante de Kraljic a partir de sus dos scores.

    Se deriva y no se pide: un campo de texto libre para el segmento admite
    errores de tipeo, queda desalineado de los scores en cuanto uno cambia y no
    es reproducible. Con esta funcion, el segmento es siempre recalculable desde
    los datos que lo justifican.

    Args:
        score_impacto: impacto economico normalizado [0,1].
        score_riesgo: riesgo de suministro normalizado [0,1].
        corte: umbral de cuadrante; politica documentada, no ley natural.

    Returns:
        str: ESTRATEGICO, APALANCADO, CUELLO_DE_BOTELLA o RUTINARIO.
    """
    alto_i = float(score_impacto) >= corte
    alto_r = float(score_riesgo) >= corte
    if alto_i and alto_r:
        return "ESTRATEGICO"
    if alto_i:
        return "APALANCADO"
    if alto_r:
        return "CUELLO_DE_BOTELLA"
    return "RUTINARIO"


def z_nivel_servicio(clase_abc: str | None = None, nivel: float | None = None) -> float:
    """Cuantil normal asociado al nivel de servicio de ciclo objetivo.

    Advertencia de interpretacion que el sistema debe mostrar al usuario: un
    nivel de servicio de CICLO del 95% no es un fill rate del 95%. El primero
    es la probabilidad de no quebrar durante un ciclo de reposicion; el segundo
    es la fraccion de unidades atendidas. Confundirlos sobredimensiona o
    subdimensiona el inventario segun el caso.

    Args:
        clase_abc: clase del articulo; define el objetivo por politica.
        nivel: nivel explicito en (0,1); tiene prioridad sobre la clase.

    Returns:
        float: valor de z.
    """
    if nivel is None:
        nivel = settings.INVENTARIO.nivel_servicio_por_clase.get(
            (clase_abc or "C").upper(), 0.90
        )
    nivel = min(max(float(nivel), 0.50), 0.9999)
    return cuantil_normal(nivel)


def stock_seguridad(
    z: float, sigma_demanda: float, demanda_media: float,
    lead_time_medio: float, sigma_lead_time: float,
) -> float:
    """Stock de seguridad = z * sigma_DDLT.

    Notese lo que NO es: un porcentaje fijo de las ventas. El "20% de la venta
    mensual" tan extendido ignora la variabilidad y el plazo, de modo que
    protege de mas los articulos estables y de menos los erraticos.
    """
    return max(0.0, float(z) * sigma_demanda_durante_lead_time(
        sigma_demanda, demanda_media, lead_time_medio, sigma_lead_time
    ))


def punto_pedido(
    demanda_media: float, lead_time_medio: float, stock_seg: float
) -> float:
    """Punto de pedido = demanda esperada durante el plazo + stock de seguridad.

    Se compara contra la POSICION de inventario (disponible + pedidos abiertos
    - reservas), nunca contra el stock fisico: comparar contra el fisico ignora
    lo que ya viene en camino y dispara compras duplicadas.
    """
    return max(0.0, float(demanda_media) * float(lead_time_medio) + float(stock_seg))


def eoq(demanda_anual: float, costo_pedido: float, costo_mantener_unitario: float) -> float:
    """Lote economico de Harris (1913).

        Q* = sqrt( 2 * D * S / H )

    Supone demanda y costos estables. No resuelve por si solo restricciones de
    caja, descuentos por tramos, caducidad ni campanas: por eso el sistema lo
    usa como referencia de orden de magnitud y deja la decision multiperiodo a
    Wagner-Whitin.
    """
    d = max(float(demanda_anual), 0.0)
    h = max(float(costo_mantener_unitario), _EPS)
    return math.sqrt(2.0 * d * max(float(costo_pedido), 0.0) / h)


def redondear_lote(cantidad: float, lote_multiplo: float, moq: float) -> float:
    """Ajusta una cantidad a empaque y minimo de compra.

        Q = empaque * techo( max(necesidad, MOQ) / empaque )   si necesidad > 0
        Q = 0                                                   si necesidad = 0

    La condicion `necesidad > 0` es esencial: sin ella, un articulo sin
    necesidad terminaria comprando su MOQ cada periodo.
    """
    if cantidad <= _EPS:
        return 0.0
    lote = max(float(lote_multiplo), _EPS)
    objetivo = max(float(cantidad), max(float(moq), 0.0))
    return float(lote * math.ceil(objetivo / lote - 1e-9))


# =============================================================================
# 2. LOTE DINAMICO MULTIPERIODO (WAGNER-WHITIN)
# =============================================================================
@dataclass
class PlanLote:
    """Resultado del algoritmo de lote dinamico.

    Attributes:
        periodos_pedido: indices (base 0) en los que se emite un pedido.
        ventanas: para cada pedido, el rango [inicio, fin] que cubre.
        costo_total: costo optimo de pedidos mas mantenimiento.
    """

    periodos_pedido: list[int] = field(default_factory=list)
    ventanas: list[tuple[int, int]] = field(default_factory=list)
    costo_total: float = 0.0


def wagner_whitin(
    requerimientos: np.ndarray, costo_pedido: float, costo_mantener_periodo: float
) -> PlanLote:
    """Lote dinamico optimo por programacion dinamica (Wagner-Whitin, 1958).

    Resuelve exactamente el problema de dimensionamiento de lote con demanda
    determinista variable en el tiempo, costo fijo por pedido y costo de
    mantener proporcional:

        coste(i, j) = S + h * sum_{t=i..j} (t - i) * R_t
        F(j)        = min_{i <= j} [ F(i-1) + coste(i, j) ]
        F(-1)       = 0

    Complejidad O(T^2) en tiempo y O(T) en memoria, lo que para T = 12 es
    instantaneo. Se prefiere a un solver MILP externo por dos razones: es
    exacto para este subproblema (no una relajacion), y no obliga a empaquetar
    un binario de terceros dentro del .EXE.

    Propiedad que el algoritmo explota: en el optimo nunca se pide en un
    periodo que aun tiene inventario. Por eso basta considerar particiones en
    ventanas contiguas.

    Args:
        requerimientos: necesidades netas por periodo, no negativas.
        costo_pedido: costo fijo S de emitir una orden.
        costo_mantener_periodo: costo h de mantener una unidad un periodo.

    Returns:
        PlanLote: periodos de pedido, ventanas cubiertas y costo optimo.
    """
    R = np.maximum(np.asarray(requerimientos, dtype=float), 0.0)
    T = R.size
    if T == 0:
        return PlanLote()

    S = max(float(costo_pedido), 0.0)
    h = max(float(costo_mantener_periodo), 0.0)

    F = np.full(T + 1, np.inf)
    F[0] = 0.0
    origen = np.zeros(T + 1, dtype=int)

    for j in range(1, T + 1):
        for i in range(1, j + 1):
            # Coste de cubrir los periodos i..j con un unico pedido en i
            mantener = 0.0
            for t in range(i, j + 1):
                mantener += (t - i) * R[t - 1]
            # Un pedido de cantidad cero no cuesta: si la ventana no tiene
            # requerimiento, no se paga el costo fijo.
            hay_demanda = float(R[i - 1 : j].sum()) > _EPS
            coste = (S if hay_demanda else 0.0) + h * mantener
            total = F[i - 1] + coste
            if total < F[j]:
                F[j] = total
                origen[j] = i

    # Reconstruccion hacia atras
    plan = PlanLote(costo_total=float(F[T]))
    j = T
    while j > 0:
        i = int(origen[j])
        if float(R[i - 1 : j].sum()) > _EPS:
            plan.periodos_pedido.append(i - 1)
            plan.ventanas.append((i - 1, j - 1))
        j = i - 1
    plan.periodos_pedido.reverse()
    plan.ventanas.reverse()
    return plan


# =============================================================================
# 3. PROYECCION DEL BALANCE
# =============================================================================
@dataclass
class ParametrosArticulo:
    """Parametria completa de un articulo para la proyeccion multiperiodo."""

    sku: str
    proveedor_id: str
    inventario_inicial: float
    precio_unitario: float
    costo_unitario: float
    lote_multiplo: float
    moq: float
    lead_time_dias: float
    sigma_lead_time_dias: float
    stock_seguridad: float
    volumen_m3: float = 0.0
    clase_abc: str = "C"


@dataclass
class FilaBalance:
    """Una linea de la canasta: un articulo en un periodo."""

    periodo_idx: int
    demanda: float
    inventario_inicial: float
    recepcion_confirmada: float
    stock_seguridad: float
    necesidad_neta: float
    compra: float
    inventario_final: float
    faltante: float
    costo: float


def proyectar_balance(
    demanda: np.ndarray,
    parametros: ParametrosArticulo,
    recepciones_confirmadas: np.ndarray | None = None,
    costo_pedido: float | None = None,
    usar_wagner_whitin: bool = True,
) -> tuple[list[FilaBalance], str]:
    """Proyecta el balance mensual y determina las compras del horizonte.

    Ecuacion de balance aplicada en cada periodo:

        inventario_final = inventario_inicial + recepciones_confirmadas
                           + compra - demanda_atendida

    Secuencia de calculo:
        1. Pasada lote-a-lote para obtener las necesidades netas del horizonte.
        2. Wagner-Whitin sobre esas necesidades para decidir en que periodos
           conviene consolidar pedidos (costo fijo vs. costo de mantener).
        3. Simulacion recursiva hacia adelante aplicando empaque y MOQ. El
           EXCEDENTE DE REDONDEO DE UN PERIODO SE ARRASTRA AL SIGUIENTE; no
           volver a comprar como si el inventario fuese siempre exactamente la
           reserva es lo que evita la sobrecompra sistematica.

    Args:
        demanda: demanda planificada por periodo del horizonte.
        parametros: parametria del articulo.
        recepciones_confirmadas: ordenes abiertas que llegan en cada periodo.
        costo_pedido: costo fijo por emision; por defecto el de politica.
        usar_wagner_whitin: si False, aplica lote a lote puro.

    Returns:
        tuple: (filas del balance, metodo de lote aplicado).
    """
    D = np.maximum(np.asarray(demanda, dtype=float), 0.0)
    T = D.size
    C = (np.zeros(T) if recepciones_confirmadas is None
         else np.maximum(np.asarray(recepciones_confirmadas, float), 0.0))
    if C.size < T:
        C = np.pad(C, (0, T - C.size))

    SS = max(float(parametros.stock_seguridad), 0.0)
    S = (settings.INVENTARIO.costo_por_pedido if costo_pedido is None else float(costo_pedido))
    # Costo de mantener una unidad un mes = costo unitario * tasa anual / 12
    h_mes = parametros.costo_unitario * settings.INVENTARIO.factor_costo_mantener / 12.0

    # --- Paso 1: necesidades netas lote a lote -------------------------------
    necesidades = np.zeros(T)
    inv = float(parametros.inventario_inicial)
    for t in range(T):
        disponible = inv + C[t]
        # Necesidad neta = max(0, demanda + reserva objetivo - disponible)
        necesidades[t] = max(0.0, D[t] + SS - disponible)
        inv = max(0.0, disponible + necesidades[t] - D[t])

    # --- Paso 2: consolidacion optima ----------------------------------------
    if usar_wagner_whitin and float(necesidades.sum()) > _EPS:
        plan = wagner_whitin(necesidades, S, h_mes)
        metodo = "WAGNER_WHITIN"
        ventanas = {ini: fin for ini, fin in plan.ventanas}
    else:
        ventanas = {t: t for t in range(T) if necesidades[t] > _EPS}
        metodo = "LOTE_A_LOTE"

    # --- Paso 3: simulacion recursiva con empaque y MOQ ----------------------
    filas: list[FilaBalance] = []
    inv = float(parametros.inventario_inicial)
    for t in range(T):
        inv_ini = inv
        disponible = inv_ini + C[t]

        compra = 0.0
        if t in ventanas:
            fin = ventanas[t]
            # Cubrir la ventana completa mas la reserva al cierre de la ventana
            requerido = float(D[t : fin + 1].sum()) + SS
            ya_disponible = disponible + float(C[t + 1 : fin + 1].sum())
            bruto = max(0.0, requerido - ya_disponible)
            compra = redondear_lote(bruto, parametros.lote_multiplo, parametros.moq)

        total_disponible = disponible + compra
        atendida = min(D[t], total_disponible)
        faltante = max(0.0, D[t] - total_disponible)
        inv = max(0.0, total_disponible - atendida)

        filas.append(
            FilaBalance(
                periodo_idx=t,
                demanda=float(D[t]),
                inventario_inicial=inv_ini,
                recepcion_confirmada=float(C[t]),
                stock_seguridad=SS,
                necesidad_neta=float(necesidades[t]),
                compra=compra,
                inventario_final=inv,
                faltante=faltante,
                costo=compra * float(parametros.precio_unitario),
            )
        )
    return filas, metodo


def verificar_balance(filas: list[FilaBalance], tolerancia: float = 0.01) -> list[int]:
    """Comprueba la ecuacion de balance en cada fila.

    Args:
        filas: balance proyectado.
        tolerancia: desviacion admitida por redondeo de presentacion.

    Returns:
        list[int]: indices de periodo que no cuadran. Vacia si todo es correcto.
    """
    fallos: list[int] = []
    for f in filas:
        atendida = f.demanda - f.faltante
        esperado = (f.inventario_inicial + f.recepcion_confirmada + f.compra - atendida)
        if abs(esperado - f.inventario_final) > tolerancia:
            fallos.append(f.periodo_idx)
    return fallos
