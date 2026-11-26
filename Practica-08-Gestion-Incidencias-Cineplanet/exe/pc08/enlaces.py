"""Función conectada de la solución EXE: HEAD a enlaces HTTPS de la lista aprobada (8 s, sin redirecciones)."""
import ipaddress
import socket
import ssl
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

DOMINIOS = {"www.gob.pe", "www.inei.gob.pe", "example.com", "www.example.com", "date.nager.at"}
MAX_BYTES = 300_000
ESPERA_S = 8


class _SinRedireccion(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def consultar(url: str) -> dict:
    url = (url or "").strip()
    p = urlsplit(url)
    host = (p.hostname or "").lower()
    if p.scheme != "https" or host not in DOMINIOS or len(url) > 1000:
        return {"estado": "NO_VERIFICADO", "codigo_http": None, "detalle": "Dominio fuera de la lista aprobada o enlace no válido."}
    inicio = time.monotonic()
    try:
        dirs = {ai[4][0] for ai in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)}
        if any(not ipaddress.ip_address(d.split("%")[0]).is_global for d in dirs):
            return {"estado": "NO_VERIFICADO", "codigo_http": None, "detalle": "El destino no es una dirección pública."}
    except OSError:
        pass  # sin DNS directo (red con proxy): decide la consulta
    abridor = urllib.request.build_opener(_SinRedireccion, urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    pedido = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "PC08-Verificador/1.0"})
    try:
        with abridor.open(pedido, timeout=max(1.0, ESPERA_S - (time.monotonic() - inicio))) as r:
            return {"estado": "DISPONIBLE", "codigo_http": r.status, "detalle": f"El recurso respondió {r.status}. El contenido se revisa manualmente."}
    except urllib.error.HTTPError as e:
        if 300 <= e.code < 400:
            return {"estado": "NO_VERIFICADO", "codigo_http": e.code, "detalle": "El servidor solicita redirección; no se sigue automáticamente."}
        if e.code in (405, 501):
            return {"estado": "NO_VERIFICADO", "codigo_http": e.code, "detalle": "El servidor no acepta la consulta HEAD."}
        return {"estado": "NO_DISPONIBLE", "codigo_http": e.code, "detalle": f"El servidor respondió {e.code}."}
    except Exception as e:  # red caída, DNS, TLS o tiempo agotado
        return {"estado": "NO_VERIFICADO", "codigo_http": None,
                "detalle": f"No se pudo completar la conexión ({type(getattr(e, 'reason', e)).__name__}). Los datos siguen disponibles en modo local."}


def obtener_json(url: str) -> dict:
    """GET de datos públicos en JSON (feriados oficiales). Misma lista aprobada, HTTPS, 8 s, sin redirecciones y tamaño máximo."""
    url = (url or "").strip()
    p = urlsplit(url)
    if p.scheme != "https" or (p.hostname or "").lower() not in DOMINIOS or len(url) > 1000:
        return {"estado": "NO_VERIFICADO", "codigo_http": None, "detalle": "Dominio fuera de la lista aprobada o enlace no válido.", "datos": None}
    abridor = urllib.request.build_opener(_SinRedireccion, urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    pedido = urllib.request.Request(url, headers={"User-Agent": "PC08-Consulta/1.0", "Accept": "application/json"})
    try:
        with abridor.open(pedido, timeout=ESPERA_S) as r:
            cuerpo = r.read(MAX_BYTES + 1)
            if len(cuerpo) > MAX_BYTES:
                return {"estado": "NO_VERIFICADO", "codigo_http": r.status, "detalle": "La respuesta supera el tamaño permitido.", "datos": None}
            import json
            return {"estado": "DISPONIBLE", "codigo_http": r.status, "detalle": f"El servicio respondió {r.status}.", "datos": json.loads(cuerpo.decode("utf-8"))}
    except urllib.error.HTTPError as e:
        return {"estado": "NO_DISPONIBLE", "codigo_http": e.code, "detalle": f"El servicio respondió {e.code}.", "datos": None}
    except ValueError:
        return {"estado": "NO_VERIFICADO", "codigo_http": None, "detalle": "La respuesta no tiene el formato esperado (JSON).", "datos": None}
    except Exception as e:  # red caída, DNS, TLS o tiempo agotado
        return {"estado": "NO_VERIFICADO", "codigo_http": None,
                "detalle": f"No se pudo completar la conexión ({type(getattr(e, 'reason', e)).__name__}). Se conserva la última descarga y los datos siguen disponibles en modo local.", "datos": None}
