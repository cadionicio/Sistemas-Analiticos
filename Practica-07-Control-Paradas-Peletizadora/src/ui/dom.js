// Utilidades de interfaz: elementos, diálogo modal, avisos visibles y protector por pantalla.
import { esc } from '../nucleo/formato.js';

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export function html(strings, ...vals) {
  return strings.reduce((a, s, i) => a + s + (i < vals.length ? (vals[i] && vals[i].__html ? vals[i].__html : esc(vals[i])) : ''), '');
}
export const crudo = s => ({ __html: s });

// Diálogo modal propio (siempre por encima de cualquier panel). Devuelve el valor del botón pulsado o null.
export function dialogo({ titulo, cuerpo, botones = [{ texto: 'Cerrar', valor: null }], ancho = 760 }) {
  return new Promise(resolve => {
    const capa = document.createElement('div');
    capa.className = 'capa-dialogo';
    capa.innerHTML = `<div class="dialogo" role="dialog" aria-modal="true" aria-labelledby="dlg-titulo" style="max-width:${ancho}px">
      <h2 id="dlg-titulo">${esc(titulo)}</h2><div class="dlg-cuerpo">${cuerpo}</div>
      <div class="dlg-botones"></div></div>`;
    const cont = capa.querySelector('.dlg-botones');
    const cerrar = v => { document.removeEventListener('keydown', tecla); capa.remove(); resolve(v); };
    botones.forEach(b => {
      const bt = document.createElement('button');
      bt.type = 'button';
      bt.className = 'btn' + (b.principal ? ' principal' : '') + (b.peligro ? ' peligro' : '');
      bt.textContent = b.texto;
      if (b.deshabilitado) bt.disabled = true;
      bt.onclick = () => cerrar(b.valor);
      cont.appendChild(bt);
    });
    const tecla = e => { if (e.key === 'Escape') cerrar(null); };
    document.addEventListener('keydown', tecla);
    document.body.appendChild(capa);
    (cont.querySelector('.principal:not([disabled])') || cont.querySelector('button')).focus();
  });
}

// Aviso visible en la franja superior. tipo: ok | info | error | alerta
export function aviso(texto, tipo = 'info', accion) {
  const zona = $('#avisos');
  const d = document.createElement('div');
  d.className = 'aviso ' + tipo;
  d.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  d.innerHTML = `<span>${esc(texto)}</span>`;
  if (accion) {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = accion.texto; b.onclick = () => { d.remove(); accion.fn(); };
    d.appendChild(b);
  }
  const x = document.createElement('button');
  x.className = 'btn-x'; x.setAttribute('aria-label', 'Cerrar aviso'); x.textContent = '×'; x.onclick = () => d.remove();
  d.appendChild(x);
  zona.prepend(d);
  [...zona.children].slice(2).forEach(x => x.remove()); // como máximo dos avisos visibles
  setTimeout(() => d.remove(), tipo === 'error' ? 60000 : accion ? 30000 : tipo === 'alerta' ? 15000 : 8000);
  return d;
}

// Protector por pantalla: si una vista falla, solo esa muestra el error; el menú sigue disponible.
export async function protegido(contenedor, nombre, fn) {
  try { await fn(); }
  catch (e) {
    console.error(e);
    contenedor.innerHTML = `<div class="tarjeta error-vista"><h2>No se pudo mostrar «${esc(nombre)}»</h2>
      <p>${esc(e.message || String(e))}</p><p>El menú y los datos guardados siguen disponibles.</p>
      <button class="btn principal" type="button" id="reintentar">Volver a intentar</button></div>`;
    contenedor.querySelector('#reintentar').onclick = () => protegido(contenedor, nombre, fn);
  }
}

export function elegirArchivo(accept) {
  return new Promise(resolve => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept; i.style.display = 'none';
    i.onchange = async () => {
      const f = i.files && i.files[0];
      i.remove();
      if (!f) return resolve(null);
      resolve({ nombre: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    };
    // Si el usuario cancela, no se resuelve nada: la pantalla queda igual.
    document.body.appendChild(i);
    i.click();
  });
}

export function descargar(bytes, nombre, tipo = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}

// Fecha y hora local de Lima para un <input type="datetime-local">
export function aLocalInput(iso) { return iso ? iso.slice(0, 16) : ''; }
export function ahoraLocalInput() {
  const d = new Date(Date.now() - 5 * 3600e3);
  return d.toISOString().slice(0, 16);
}

// Formulario modal. campos: [{id, etiqueta, tipo: texto|area|numero|fechahora|fecha|select|casilla|info, opciones:[[valor, texto]], valor, ayuda}]
// Devuelve un objeto con los valores o null si se cancela. validar(valores) puede devolver un mensaje de error.
export function formulario({ titulo, campos, textoOk = 'Confirmar', validar, ancho = 620, intro = '' }) {
  return new Promise(resolve => {
    const capa = document.createElement('div');
    capa.className = 'capa-dialogo';
    const ctrl = c => {
      const v = c.valor ?? '';
      const id = `f-${c.id}`;
      switch (c.tipo) {
        case 'area': return `<textarea id="${id}" rows="3">${esc(v)}</textarea>`;
        case 'numero': return `<input id="${id}" type="number" step="1" min="${c.min ?? 1}" value="${esc(v)}">`;
        case 'fechahora': return `<input id="${id}" type="datetime-local" value="${esc(v)}">`;
        case 'fecha': return `<input id="${id}" type="date" value="${esc(v)}">`;
        case 'select': return `<select id="${id}">${(c.opciones || []).map(([val, txt]) => `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(txt)}</option>`).join('')}</select>`;
        case 'casilla': return `<label class="casilla"><input id="${id}" type="checkbox"${v ? ' checked' : ''}> ${esc(c.texto || '')}</label>`;
        case 'info': return `<div class="info-campo">${c.html || esc(v)}</div>`;
        default: return `<input id="${id}" type="text" value="${esc(v)}" autocomplete="off">`;
      }
    };
    capa.innerHTML = `<form class="dialogo formulario" style="max-width:${ancho}px" novalidate>
      <h2>${esc(titulo)}</h2>${intro ? `<div class="intro">${intro}</div>` : ''}
      <div class="campos">${campos.map(c => `<div class="campo"><label for="f-${c.id}">${esc(c.etiqueta)}</label>${ctrl(c)}${c.ayuda ? `<small>${esc(c.ayuda)}</small>` : ''}</div>`).join('')}</div>
      <div class="error-form" role="alert"></div>
      <div class="dlg-botones"><button type="button" class="btn" data-x>Cancelar</button><button type="submit" class="btn principal">${esc(textoOk)}</button></div></form>`;
    const form = capa.querySelector('form');
    const cerrar = v => { document.removeEventListener('keydown', tecla); capa.remove(); resolve(v); };
    const tecla = e => { if (e.key === 'Escape') cerrar(null); };
    document.addEventListener('keydown', tecla);
    capa.querySelector('[data-x]').onclick = () => cerrar(null);
    form.onsubmit = e => {
      e.preventDefault();
      const vals = {};
      let incompleto = null;
      campos.forEach(c => {
        if (c.tipo === 'info') return;
        const el = form.querySelector(`#f-${c.id}`);
        el.classList.remove('incompleto');
        if ((c.tipo === 'fechahora' || c.tipo === 'fecha') && el.validity && el.validity.badInput) { el.classList.add('incompleto'); incompleto = c.etiqueta; }
        vals[c.id] = c.tipo === 'casilla' ? el.checked : el.value;
      });
      const zona = form.querySelector('.error-form');
      if (incompleto) { zona.textContent = `La fecha «${incompleto}» está incompleta.`; return; }
      const m = validar ? validar(vals) : null;
      if (m) { zona.textContent = m; return; }
      cerrar(vals);
    };
    document.body.appendChild(capa);
    const primero = form.querySelector('input:not([type=checkbox]), select, textarea');
    if (primero) primero.focus();
  });
}

// Indicador de progreso para operaciones largas: la ventana sigue respondiendo y el usuario ve el paso actual.
export const cuadro = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
export function progreso(titulo) {
  const capa = document.createElement('div');
  capa.className = 'capa-dialogo capa-progreso';
  capa.setAttribute('role', 'status');
  capa.innerHTML = `<div class="dialogo progreso"><h2>${esc(titulo)}</h2><p class="prog-txt">Preparando…</p><div class="prog-barra"><i style="width:0%"></i></div><p class="prog-t subtexto"></p></div>`;
  document.body.appendChild(capa);
  const t0 = performance.now();
  return {
    async paso(texto, pct) {
      capa.querySelector('.prog-txt').textContent = texto;
      capa.querySelector('.prog-barra i').style.width = Math.max(0, Math.min(100, pct)) + '%';
      capa.querySelector('.prog-t').textContent = `Transcurrido: ${((performance.now() - t0) / 1000).toFixed(1)} s`;
      await cuadro();
    },
    fin() { capa.remove(); return Math.round(performance.now() - t0); },
  };
}
