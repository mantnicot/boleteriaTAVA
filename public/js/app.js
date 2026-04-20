(function () {
  const TZ = 'America/Bogota';

  function todayYYYYMMDD() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  function toISO(d, m, y) {
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function isPastDMY(d, mo, y) {
    const dd = parseInt(String(d), 10);
    const mm = parseInt(String(mo), 10);
    const yy = parseInt(String(y), 10);
    if (!dd || !mm || !yy) return true;
    return toISO(dd, mm, yy) < todayYYYYMMDD();
  }

  function formatDMY(d, m, y) {
    return `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`;
  }

  /** @type {{ fechas: string[], tarifas: {valor:string,cantidad:number}[], vendedores: string[] }} */
  const ev = { fechas: [], tarifas: [], vendedores: [] };
  const ed = { fechas: [], tarifas: [], vendedores: [] };

  let cacheEventos = [];
  let selectedBoletaEvent = null;
  const authState = { loggedIn: false, email: '' };
  const curtainState = { playing: false };
  const CURTAIN_ANIM_MS = 9200;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function showAlert(title, msg) {
    $('#dialog-alert-title').textContent = title || 'Aviso';
    $('#dialog-alert-msg').textContent = msg || '';
    $('#dialog-alert').classList.remove('hidden');
    return new Promise((resolve) => {
      const ok = $('#dialog-alert-ok');
      const done = () => {
        ok.removeEventListener('click', done);
        $('#dialog-alert').classList.add('hidden');
        resolve();
      };
      ok.addEventListener('click', done);
    });
  }

  const THEATER_LOADING_PHRASES = [
    'Levantando el telón…',
    'Comedia y tragedia preparan la escena…',
    'Luces, cámara… guardando en el tablado…',
    'Entre bastidores, un momento más…',
    'El público aguarda — casi listo…',
    'Afinando el último detalle teatral…',
  ];

  let theaterLoadingTimer = null;

  function showTheaterLoading() {
    const root = $('#theater-loading');
    const msgEl = $('#theater-loading-msg');
    if (!root || !msgEl) return;
    let i = 0;
    msgEl.textContent = THEATER_LOADING_PHRASES[0];
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    theaterLoadingTimer = window.setInterval(() => {
      i = (i + 1) % THEATER_LOADING_PHRASES.length;
      msgEl.textContent = THEATER_LOADING_PHRASES[i];
    }, 2100);
  }

  function hideTheaterLoading() {
    const root = $('#theater-loading');
    if (theaterLoadingTimer) {
      clearInterval(theaterLoadingTimer);
      theaterLoadingTimer = null;
    }
    if (root) {
      root.classList.add('hidden');
      root.setAttribute('aria-hidden', 'true');
    }
  }

  async function withTheaterLoading(factory) {
    showTheaterLoading();
    try {
      return await factory();
    } finally {
      hideTheaterLoading();
    }
  }

  function showConfirm(title, msg) {
    $('#dialog-confirm-title').textContent = title || 'Confirmar';
    $('#dialog-confirm-msg').textContent = msg || '';
    $('#dialog-confirm').classList.remove('hidden');
    return new Promise((resolve) => {
      const yes = $('#dialog-confirm-yes');
      const no = $('#dialog-confirm-no');
      const clean = (v) => {
        yes.removeEventListener('click', onYes);
        no.removeEventListener('click', onNo);
        $('#dialog-confirm').classList.add('hidden');
        resolve(v);
      };
      function onYes() {
        clean(true);
      }
      function onNo() {
        clean(false);
      }
      yes.addEventListener('click', onYes);
      no.addEventListener('click', onNo);
    });
  }

  function setSubBars(view) {
    $('#sub-bar-form').classList.toggle('hidden', view !== 'eventos');
    $('#sub-bar-boletas').classList.toggle('hidden', view !== 'boletas');
    $('#sub-bar-reportes').classList.toggle('hidden', view !== 'reportes');
  }

  function setNavActive(view) {
    $$('.main-nav a[data-nav]').forEach((a) => {
      a.classList.toggle('active', a.dataset.nav === view);
    });
  }

  function applyAuthUi() {
    const nav = document.querySelector('.main-nav');
    const lockMsg = $('#intro-lock-msg');
    const gate = $('#auth-gate-overlay');
    const userPill = $('#auth-user-pill');
    const logoutBtn = $('#btn-logout');
    const allowedPanel = $('#allowed-emails-panel');

    const logged = !!authState.loggedIn;
    document.body.classList.toggle('is-authenticated', logged);
    document.body.classList.toggle('auth-locked', !logged);
    if (gate) gate.classList.toggle('hidden', logged);
    if (nav) nav.classList.toggle('hidden', !logged);
    if (lockMsg) lockMsg.classList.toggle('hidden', logged);
    if (userPill) {
      userPill.textContent = logged ? `Ingresaste como: ${authState.email}` : '';
      userPill.classList.toggle('hidden', !logged);
    }
    if (logoutBtn) logoutBtn.classList.toggle('hidden', !logged);
    if (allowedPanel) allowedPanel.classList.toggle('hidden', !logged);

    const curtain = $('#curtain-overlay');
    if (curtain && !logged) {
      curtain.classList.remove('hidden');
      curtain.classList.remove('opening');
    }
  }

  function playCurtainIntro() {
    const overlay = $('#curtain-overlay');
    if (!overlay || curtainState.playing) return;
    curtainState.playing = true;
    overlay.classList.remove('hidden');
    overlay.classList.remove('opening');
    void overlay.offsetWidth;
    overlay.classList.add('opening');
    window.setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.classList.remove('opening');
      curtainState.playing = false;
    }, CURTAIN_ANIM_MS);
  }

  function pulseActionTarget(el) {
    if (!el || !(el instanceof HTMLElement)) return;
    el.classList.remove('action-pop');
    void el.offsetWidth;
    el.classList.add('action-pop');
    window.setTimeout(() => el.classList.remove('action-pop'), 360);
  }

  function renderAllowedEmails(items) {
    const list = $('#allowed-email-list');
    if (!list) return;
    list.innerHTML = '';
    const rows = Array.isArray(items) ? items : [];
    if (rows.length === 0) {
      list.innerHTML = '<span class="allowed-email-item">Sin restricciones (cualquier correo válido)</span>';
      return;
    }
    rows.forEach((row) => {
      const item = document.createElement('span');
      item.className = 'allowed-email-item';
      const canRemove = row.source !== 'env';
      item.innerHTML = `${escapeHtml(row.email)} <span class="allowed-email-src">${escapeHtml(row.source)}</span>${
        canRemove ? ' <button type="button" aria-label="Eliminar">&times;</button>' : ''
      }`;
      if (canRemove) {
        const btn = item.querySelector('button');
        btn?.addEventListener('click', async () => {
          try {
            const out = await api(`/api/auth/allowed-emails?email=${encodeURIComponent(row.email)}`, {
              method: 'DELETE',
            });
            renderAllowedEmails(out.items);
          } catch (e) {
            await showAlert('No se pudo eliminar', e.message || String(e));
          }
        });
      }
      list.appendChild(item);
    });
  }

  async function loadAllowedEmails() {
    if (!authState.loggedIn) return;
    const out = await api('/api/auth/allowed-emails');
    renderAllowedEmails(out.items);
  }

  function route() {
    let h = (location.hash || '#inicio').replace(/^#/, '') || 'inicio';
    if (!['inicio', 'eventos', 'boletas', 'reportes'].includes(h)) h = 'inicio';
    if (!authState.loggedIn && h !== 'inicio') {
      h = 'inicio';
      if (location.hash !== '#inicio') location.hash = '#inicio';
    }

    const shell = document.querySelector('.app-shell');
    if (shell) {
      shell.classList.add('theater-scene-change');
      setTimeout(() => shell.classList.remove('theater-scene-change'), 720);
    }

    $$('[data-view]').forEach((el) => {
      const match = el.dataset.view === h;
      el.hidden = !match;
    });

    setSubBars(h === 'inicio' ? '' : h);
    setNavActive(h === 'inicio' ? '' : h);

    if (authState.loggedIn && h === 'boletas') {
      refreshBoletaEventosSelect().catch(async (e) => {
        await showAlert('No fue posible cargar eventos', e.message || String(e));
      });
    }
    if (authState.loggedIn && h === 'reportes') {
      refreshReportes().catch(async (e) => {
        await showAlert('No fue posible cargar reportes', e.message || String(e));
      });
    }
  }

  function renderFechasTable(tbodyId, list, onDel) {
    const tb = $(tbodyId);
    tb.innerHTML = '';
    list.forEach((f, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${f}</td><td><button type="button" class="icon-btn" data-i="${i}" title="Eliminar">🗑</button></td>`;
      tr.querySelector('button').addEventListener('click', () => onDel(i));
      tb.appendChild(tr);
    });
  }

  function renderTarifasTable(tbodyId, list, onDel) {
    const tb = $(tbodyId);
    tb.innerHTML = '';
    list.forEach((t, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${t.valor}</td><td>${t.cantidad}</td><td><button type="button" class="icon-btn" data-i="${i}">🗑</button></td>`;
      tr.querySelector('button').addEventListener('click', () => onDel(i));
      tb.appendChild(tr);
    });
  }

  function renderChips(containerId, list, onDel) {
    const el = $(containerId);
    el.innerHTML = '';
    list.forEach((v, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `${escapeHtml(v)} <button type="button" aria-label="Quitar">&times;</button>`;
      chip.querySelector('button').addEventListener('click', () => onDel(i));
      el.appendChild(chip);
    });
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function redrawEvFechas() {
    renderFechasTable('#tbl-fechas tbody', ev.fechas, (i) => {
      ev.fechas.splice(i, 1);
      redrawEvFechas();
    });
  }

  function redrawEvTarifas() {
    renderTarifasTable('#tbl-tarifas tbody', ev.tarifas, (i) => {
      ev.tarifas.splice(i, 1);
      redrawEvTarifas();
    });
  }

  function redrawEvVends() {
    renderChips('#chips-vendedores', ev.vendedores, (i) => {
      ev.vendedores.splice(i, 1);
      redrawEvVends();
    });
  }

  function resetEvForm() {
    ev.fechas = [];
    ev.tarifas = [];
    ev.vendedores = [];
    $('#ev-nombre').value = '';
    $('#ev-desc').value = '';
    $('#ev-dir').value = '';
    $('#ev-hora').value = '';
    $('#ev-terminos').value = '';
    $('#ev-fondo').value = '';
    $('#ev-fondo-name').textContent = '';
    redrawEvFechas();
    redrawEvTarifas();
    redrawEvVends();
  }

  async function api(path, opts = {}) {
    const r = await fetch(path, {
      headers: { Accept: 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) {
      if (r.status === 401 && typeof data === 'object' && data.code === 'AUTH_REQUIRED') {
        authState.loggedIn = false;
        authState.email = '';
        applyAuthUi();
        route();
        throw new Error('Debes iniciar sesión con correo para continuar.');
      }
      if (r.status === 401 && typeof data === 'object' && data.code === 'OAUTH_REQUIRED') {
        const err = new Error(
          (data.error || 'Debes reconectar Google para continuar.') +
            '\n\nUsa el enlace «Conectar cuenta Google» en la pantalla de ingreso y vuelve a intentar.'
        );
        err.code = 'OAUTH_REQUIRED';
        err.authUrl = data.authUrl || '/auth/google';
        throw err;
      }
      const err = typeof data === 'object' && data.error ? data.error : r.statusText;
      throw new Error(err);
    }
    return data;
  }

  /** Respuestas JSON de fetch manual (FormData, etc.): redirige si falta OAuth. */
  async function fetchOAuthJson(res) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.code === 'AUTH_REQUIRED') {
      authState.loggedIn = false;
      authState.email = '';
      applyAuthUi();
      route();
      throw new Error('Debes iniciar sesión con correo para continuar.');
    }
    if (res.status === 401 && data.code === 'OAUTH_REQUIRED') {
      const err = new Error(
        (data.error || 'Debes reconectar Google para continuar.') +
          '\n\nUsa el enlace «Conectar cuenta Google» en la pantalla de ingreso y vuelve a intentar.'
      );
      err.code = 'OAUTH_REQUIRED';
      err.authUrl = data.authUrl || '/auth/google';
      throw err;
    }
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  async function loadEventos() {
    cacheEventos = await api('/api/eventos');
    return cacheEventos;
  }

  function firstFechaLabel(fechasJson) {
    try {
      const a = JSON.parse(fechasJson || '[]');
      return Array.isArray(a) && a.length ? a[0] : '—';
    } catch {
      return '—';
    }
  }

  async function refreshBoletaEventosSelect() {
    await loadEventos();
    const sel = $('#bl-evento');
    const cur = sel.value;
    sel.innerHTML = '<option value="">— SELECCIONE EL EVENTO A GENERAR BOLETA —</option>';
    cacheEventos.forEach((e) => {
      const o = document.createElement('option');
      o.value = e.eventId;
      o.textContent = e.nombreProyecto;
      sel.appendChild(o);
    });
    if (cur && cacheEventos.some((e) => e.eventId === cur)) sel.value = cur;
    else sel.value = '';
    sel.dispatchEvent(new Event('change'));
  }

  async function loadReporteDetalle() {
    const sel = $('#rep-evento');
    const id = sel.value;
    const det = $('#tbl-reporte-detalle tbody');
    det.innerHTML = '';
    if (!id) return;
    const { boletas } = await api(`/api/reportes/evento/${id}`);
    boletas.forEach((b) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(b.boletaId)}</td><td>${escapeHtml(b.nombre)}</td><td>${escapeHtml(
        b.correo || ''
      )}</td><td>${b.cantidad}</td><td>${escapeHtml(b.valorLabel)}</td><td>${b.total ?? ''}</td><td>${escapeHtml(
        b.vendedor
      )}</td><td>${escapeHtml(b.fechaEvento)}</td><td><button type="button" class="icon-btn btn-ver-pdf" data-id="${
        b.boletaId
      }" title="Ver / descargar">👁</button></td>`;
      det.appendChild(tr);
    });
    $$('.btn-ver-pdf').forEach((btn) =>
      btn.addEventListener('click', () => {
        window.open(`/api/boletas/${btn.dataset.id}/pdf`, '_blank');
      })
    );
  }

  async function refreshReportes() {
    await loadEventos();
    const sel = $('#rep-evento');
    const cur = sel.value;
    sel.innerHTML = '<option value="">— SELECCIONE EL EVENTO A GENERAR REPORTE —</option>';
    const boletasAll = await api('/api/boletas').catch(() => []);
    const counts = {};
    (Array.isArray(boletasAll) ? boletasAll : []).forEach((b) => {
      counts[b.eventId] = (counts[b.eventId] || 0) + 1;
    });

    cacheEventos.forEach((e) => {
      const o = document.createElement('option');
      o.value = e.eventId;
      o.textContent = e.nombreProyecto;
      sel.appendChild(o);
    });
    if (cur) sel.value = cur;

    const tb = $('#tbl-resumen-eventos tbody');
    tb.innerHTML = '';
    for (const e of cacheEventos) {
      const vendidas = counts[e.eventId] || 0;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(e.nombreProyecto)}</td><td>${escapeHtml(
        firstFechaLabel(e.fechasJson)
      )}</td><td>${vendidas}</td><td><button type="button" class="icon-btn btn-edit-ev" data-id="${
        e.eventId
      }" title="Editar">✎</button></td>`;
      tb.appendChild(tr);
    }
    $$('.btn-edit-ev').forEach((b) =>
      b.addEventListener('click', () => openEditModal(b.dataset.id))
    );

    if (sel.value) await loadReporteDetalle();
    loadAsistentesTodos().catch(() => {});
  }

  function fillBoletaFormFromEvent(e) {
    let tarifas = [];
    let fechas = [];
    let vends = [];
    try {
      tarifas = JSON.parse(e.tarifasJson || '[]');
    } catch (_) {}
    try {
      fechas = JSON.parse(e.fechasJson || '[]');
    } catch (_) {}
    try {
      vends = JSON.parse(e.vendedoresJson || '[]');
    } catch (_) {}
    if (!Array.isArray(tarifas)) tarifas = [];
    if (!Array.isArray(fechas)) fechas = [];
    if (!Array.isArray(vends)) vends = [];

    const sv = $('#bl-valor');
    sv.innerHTML = '';
    tarifas.forEach((t) => {
      const o = document.createElement('option');
      o.value = t.valor;
      o.textContent = t.valor;
      sv.appendChild(o);
    });

    const sf = $('#bl-fecha');
    sf.innerHTML = '';
    fechas.forEach((f) => {
      const o = document.createElement('option');
      o.value = f;
      o.textContent = f;
      sf.appendChild(o);
    });

    const svend = $('#bl-vend');
    svend.innerHTML = '';
    vends.forEach((v) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      svend.appendChild(o);
    });

    updateTicketPreview();
  }

  async function loadAsistentes(eventId) {
    const rows = await api(`/api/eventos/${eventId}/asistentes`);
    const tb = $('#tbl-asistentes tbody');
    tb.innerHTML = '';
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(r.nombre)}</td><td>${escapeHtml(String(r.edad || '—'))}</td><td>${escapeHtml(
        String(r.telefono || '—')
      )}</td><td>${escapeHtml(String(r.email || '—'))}</td><td>${r.cantidad}</td><td>${escapeHtml(
        r.vendedor
      )}</td><td>${escapeHtml(r.fecha)}</td>`;
      tb.appendChild(tr);
    });
  }

  async function loadAsistentesTodos() {
    const tb = $('#tbl-asistentes-todos tbody');
    if (!tb) return;
    tb.innerHTML = '';
    const rows = await api('/api/reportes/asistentes-todos');
    if (!Array.isArray(rows) || rows.length === 0) {
      tb.innerHTML = '<tr><td colspan="4">Sin asistentes registrados todavía.</td></tr>';
      return;
    }
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(r.nombre)}</td><td>${escapeHtml(r.edad)}</td><td>${escapeHtml(
        r.telefono
      )}</td><td>${escapeHtml(r.email)}</td>`;
      tb.appendChild(tr);
    });
  }

  function updateTicketPreview() {
    const e = selectedBoletaEvent;
    if (!e) return;
    const nombre = $('#bl-nombre').value.trim() || '—';
    const fecha = $('#bl-fecha').value || '—';
    const cant = $('#bl-cant').value || '—';
    const edad = ($('#bl-edad')?.value || '').trim() || '—';
    const tel = ($('#bl-tel')?.value || '').trim() || '—';
    const codigo = '—';
    $('#ticket-left').innerHTML = `<strong>Nombre:</strong> ${escapeHtml(nombre)}<br/>
      <strong>Edad:</strong> ${escapeHtml(edad)}<br/>
      <strong>Teléfono:</strong> ${escapeHtml(tel)}<br/>
      <strong>Fecha:</strong> ${escapeHtml(fecha)}<br/>
      <strong>Cantidad:</strong> ${escapeHtml(String(cant))}<br/>
      <strong>Código boleta:</strong> ${codigo}<br/><br/>
      <strong>Hora del evento:</strong> ${escapeHtml(e.hora || '—')}<br/>
      <strong>Dirección:</strong> ${escapeHtml(e.direccion || '—')}`;
    $('#ticket-terms').textContent = e.terminos || '';
    const bg = $('#ticket-bg');
    if (e.fondoFileId) {
      bg.style.backgroundImage = `url(/api/media/${encodeURIComponent(e.fondoFileId)})`;
    } else {
      bg.style.backgroundImage = 'none';
      bg.style.backgroundColor = '#e8e0e2';
    }
  }

  async function openEditModal(eventId) {
    const e = await api(`/api/eventos/${eventId}`);
    $('#ed-id').value = e.eventId;
    $('#ed-nombre').value = e.nombreProyecto;
    $('#ed-desc').value = e.descripcion || '';
    $('#ed-dir').value = e.direccion || '';
    $('#ed-hora').value = e.hora || '';
    $('#ed-terminos').value = e.terminos || '';
    ed.fechas = JSON.parse(e.fechasJson || '[]');
    ed.tarifas = JSON.parse(e.tarifasJson || '[]');
    ed.vendedores = JSON.parse(e.vendedoresJson || '[]');
    $('#ed-fondo').value = '';
    $('#ed-fondo-name').textContent = e.fondoFileId ? 'Imagen actual en servidor (opcional reemplazar)' : '';

    redrawEdF();
    redrawEdT();
    redrawEdV();

    $('#modal-edit').classList.remove('hidden');
  }

  function closeEditModal() {
    $('#modal-edit').classList.add('hidden');
  }

  $('#modal-edit-close').addEventListener('click', closeEditModal);
  $('#modal-edit').addEventListener('click', (ev) => {
    if (ev.target.id === 'modal-edit') closeEditModal();
  });

  $('#ev-fondo-btn').addEventListener('click', () => $('#ev-fondo').click());
  $('#ev-fondo').addEventListener('change', () => {
    const f = $('#ev-fondo').files[0];
    $('#ev-fondo-name').textContent = f ? f.name : '';
  });
  $('#ed-fondo-btn').addEventListener('click', () => $('#ed-fondo').click());
  $('#ed-fondo').addEventListener('change', () => {
    const f = $('#ed-fondo').files[0];
    if (f) $('#ed-fondo-name').textContent = f.name;
  });

  $('#rep-evento').addEventListener('change', () => loadReporteDetalle());

  $('#ev-add-fecha').addEventListener('click', async () => {
    const d = $('#ev-dia').value.trim();
    const m = $('#ev-mes').value.trim();
    const y = $('#ev-ano').value.trim();
    if (isPastDMY(d, m, y)) {
      await showAlert('Restricción', 'No se permiten fechas anteriores a la fecha actual.');
      return;
    }
    const f = formatDMY(d, m, y);
    if (ev.fechas.includes(f)) {
      await showAlert('Aviso', 'Esa fecha ya está en la lista.');
      return;
    }
    ev.fechas.push(f);
    $('#ev-dia').value = '';
    $('#ev-mes').value = '';
    $('#ev-ano').value = '';
    redrawEvFechas();
  });

  function addEvVendedorFromInput() {
    const n = $('#ev-vend-nombre').value.trim();
    if (!n) return;
    ev.vendedores.push(n);
    $('#ev-vend-nombre').value = '';
    redrawEvVends();
  }
  $('#ev-add-vend').addEventListener('click', addEvVendedorFromInput);
  $('#ev-vend-nombre').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addEvVendedorFromInput();
    }
  });

  $('#ev-add-tarifa').addEventListener('click', async () => {
    const valor = $('#ev-valor').value.trim();
    const cant = parseInt($('#ev-valor-cant').value, 10);
    if (!valor || !Number.isFinite(cant) || cant < 1) {
      await showAlert('Aviso', 'Indique valor y cantidad válidos.');
      return;
    }
    ev.tarifas.push({ valor, cantidad: cant });
    $('#ev-valor').value = '';
    $('#ev-valor-cant').value = '';
    redrawEvTarifas();
  });

  $('#ed-add-fecha').addEventListener('click', async () => {
    const d = $('#ed-dia').value.trim();
    const m = $('#ed-mes').value.trim();
    const y = $('#ed-ano').value.trim();
    if (isPastDMY(d, m, y)) {
      await showAlert('Restricción', 'No se permiten fechas anteriores a la fecha actual.');
      return;
    }
    const f = formatDMY(d, m, y);
    if (ed.fechas.includes(f)) {
      await showAlert('Aviso', 'Esa fecha ya está en la lista.');
      return;
    }
    ed.fechas.push(f);
    $('#ed-dia').value = '';
    $('#ed-mes').value = '';
    $('#ed-ano').value = '';
    redrawEdF();
  });

  function redrawEdF() {
    renderFechasTable('#ed-tbl-fechas tbody', ed.fechas, (i) => {
      ed.fechas.splice(i, 1);
      redrawEdF();
    });
  }

  function addEdVendedorFromInput() {
    const n = $('#ed-vend-nombre').value.trim();
    if (!n) return;
    ed.vendedores.push(n);
    $('#ed-vend-nombre').value = '';
    redrawEdV();
  }
  $('#ed-add-vend').addEventListener('click', addEdVendedorFromInput);
  $('#ed-vend-nombre').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addEdVendedorFromInput();
    }
  });
  function redrawEdV() {
    renderChips('#ed-chips-vendedores', ed.vendedores, (i) => {
      ed.vendedores.splice(i, 1);
      redrawEdV();
    });
  }

  $('#ed-add-tarifa').addEventListener('click', () => {
    const valor = $('#ed-valor').value.trim();
    const cant = parseInt($('#ed-valor-cant').value, 10);
    if (!valor || !Number.isFinite(cant) || cant < 1) {
      showAlert('Aviso', 'Indique valor y cantidad válidos.');
      return;
    }
    ed.tarifas.push({ valor, cantidad: cant });
    $('#ed-valor').value = '';
    $('#ed-valor-cant').value = '';
    redrawEdT();
  });
  function redrawEdT() {
    renderTarifasTable('#ed-tbl-tarifas tbody', ed.tarifas, (i) => {
      ed.tarifas.splice(i, 1);
      redrawEdT();
    });
  }

  $('#btn-guardar-evento').addEventListener('click', async () => {
    const ok = await showConfirm('Confirmar', '¿Desea guardar este evento en el sistema?');
    if (!ok) return;
    const fd = new FormData();
    fd.append('nombreProyecto', $('#ev-nombre').value.trim());
    fd.append('descripcion', $('#ev-desc').value);
    fd.append('direccion', $('#ev-dir').value);
    fd.append('hora', $('#ev-hora').value);
    fd.append('terminos', $('#ev-terminos').value);
    fd.append('fechasJson', JSON.stringify(ev.fechas));
    fd.append('tarifasJson', JSON.stringify(ev.tarifas));
    fd.append('vendedoresJson', JSON.stringify(ev.vendedores));
    const file = $('#ev-fondo').files[0];
    if (file) fd.append('fondo', file);
    try {
      const r = await withTheaterLoading(() => fetch('/api/eventos', { method: 'POST', body: fd }));
      await fetchOAuthJson(r);
      await showAlert('Éxito', 'El evento se guardó correctamente.');
      resetEvForm();
    } catch (e) {
      await showAlert('Error', e.message || String(e));
    }
  });

  $('#bl-evento').addEventListener('change', async () => {
    const id = $('#bl-evento').value;
    $('#bl-panel').classList.toggle('hidden', !id);
    if (!id) {
      selectedBoletaEvent = null;
      return;
    }
    selectedBoletaEvent = cacheEventos.find((x) => x.eventId === id) || null;
    if (!selectedBoletaEvent) {
      await loadEventos();
      selectedBoletaEvent = cacheEventos.find((x) => x.eventId === id) || null;
    }
    if (selectedBoletaEvent) {
      fillBoletaFormFromEvent(selectedBoletaEvent);
      await loadAsistentes(id);
    }
  });

  ['bl-nombre', 'bl-correo', 'bl-fecha', 'bl-cant', 'bl-valor', 'bl-edad', 'bl-tel'].forEach((id) => {
    $(`#${id}`).addEventListener('input', updateTicketPreview);
    $(`#${id}`).addEventListener('change', updateTicketPreview);
  });

  $('#btn-crear-boleta').addEventListener('click', async () => {
    const ok = await showConfirm(
      'Confirmar',
      '¿Crear esta boleta? Se guardará el PDF en Google Drive y, si hay SMTP, se enviará por correo.'
    );
    if (!ok) return;
    const eventId = $('#bl-evento').value;
    const body = {
      eventId,
      nombre: $('#bl-nombre').value.trim(),
      correo: $('#bl-correo').value.trim(),
      valorLabel: $('#bl-valor').value,
      cantidad: parseInt($('#bl-cant').value, 10),
      fechaEvento: $('#bl-fecha').value,
      vendedor: $('#bl-vend').value,
      edad: ($('#bl-edad')?.value || '').trim(),
      telefono: ($('#bl-tel')?.value || '').trim(),
    };
    try {
      const res = await withTheaterLoading(() =>
        fetch('/api/boletas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      );
      const data = await fetchOAuthJson(res);

      let msg = 'Boleta creada. El PDF quedó guardado en la carpeta de Google Drive del sistema.';
      if (data.pdfDriveUrl) {
        msg += `\n\nAbrir en Drive: ${data.pdfDriveUrl}`;
      }
      if (data.emailSent) msg += '\n\nSe envió el correo al destinatario.';
      else if (data.emailError) msg += `\n\nNo se pudo enviar el correo: ${data.emailError}`;
      else if (data.emailInfo) msg += `\n\n${data.emailInfo}`;
      await showAlert('Éxito', msg);
      await loadAsistentes(eventId);
      $('#bl-nombre').value = '';
      $('#bl-correo').value = '';
      if ($('#bl-edad')) $('#bl-edad').value = '';
      if ($('#bl-tel')) $('#bl-tel').value = '';
      updateTicketPreview();
      loadAsistentesTodos().catch(() => {});
    } catch (e) {
      await showAlert('No permitido o error', e.message || String(e));
    }
  });

  const btnAsistentesTodos = $('#btn-asistentes-todos');
  if (btnAsistentesTodos) {
    btnAsistentesTodos.addEventListener('click', async () => {
      try {
        await withTheaterLoading(() => loadAsistentesTodos());
        await showAlert('Listo', 'Tabla de asistentes únicos actualizada.');
      } catch (e) {
        await showAlert('Error', e.message || String(e));
      }
    });
  }

  $('#btn-total-excel').addEventListener('click', async () => {
    const ok = await showConfirm('Confirmar', '¿Generar y descargar el Excel con todos los eventos y boletas?');
    if (!ok) return;
    try {
      const r = await withTheaterLoading(() => fetch('/api/reportes/excel/total-eventos'));
      if (!r.ok) {
        const errData = await r.json().catch(() => ({}));
        if (r.status === 401 && errData.code === 'OAUTH_REQUIRED') {
          window.location.href = errData.authUrl || '/auth/google';
          return;
        }
        throw new Error(errData.error || r.statusText);
      }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `reporte-total-${Date.now()}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
      await showAlert('Éxito', 'Reporte Excel descargado.');
    } catch (e) {
      await showAlert('Error', e.message || String(e));
    }
  });

  $('#btn-editar-evento').addEventListener('click', async () => {
    const id = $('#ed-id').value;
    const ok = await showConfirm('Confirmar', '¿Guardar los cambios de este evento?');
    if (!ok) return;
    const fd = new FormData();
    fd.append('nombreProyecto', $('#ed-nombre').value.trim());
    fd.append('descripcion', $('#ed-desc').value);
    fd.append('direccion', $('#ed-dir').value);
    fd.append('hora', $('#ed-hora').value);
    fd.append('terminos', $('#ed-terminos').value);
    fd.append('fechasJson', JSON.stringify(ed.fechas));
    fd.append('tarifasJson', JSON.stringify(ed.tarifas));
    fd.append('vendedoresJson', JSON.stringify(ed.vendedores));
    const file = $('#ed-fondo').files[0];
    if (file) fd.append('fondo', file);
    try {
      const r = await withTheaterLoading(() => fetch(`/api/eventos/${id}`, { method: 'PUT', body: fd }));
      await fetchOAuthJson(r);
      await showAlert('Éxito', 'Evento actualizado.');
      closeEditModal();
      if (location.hash === '#reportes') refreshReportes();
      if (location.hash === '#boletas') refreshBoletaEventosSelect();
    } catch (e) {
      await showAlert('Error', e.message || String(e));
    }
  });

  $('#btn-eliminar-evento').addEventListener('click', async () => {
    const id = $('#ed-id').value;
    const ok = await showConfirm(
      'Eliminar evento',
      '¿Eliminar este evento y todas sus boletas asociadas? Esta acción no se puede deshacer.'
    );
    if (!ok) return;
    try {
      const r = await withTheaterLoading(() => fetch(`/api/eventos/${id}`, { method: 'DELETE' }));
      await fetchOAuthJson(r);
      await showAlert('Éxito', 'Evento eliminado.');
      closeEditModal();
      refreshReportes();
    } catch (e) {
      await showAlert('Error', e.message || String(e));
    }
  });

  window.addEventListener('hashchange', route);
  document.addEventListener('click', (ev) => {
    const target = ev.target.closest('.btn, .icon-btn, .main-nav a, .header-logout-btn');
    if (target) pulseActionTarget(target);
  });

  async function init() {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('oauth') === 'ok') {
      await showAlert(
        'Cuenta vinculada',
        'Tu cuenta de Google quedó conectada. Sheets y Drive ya están disponibles.'
      );
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    } else if (qs.get('oauth') === 'error') {
      await showAlert(
        'No se pudo conectar',
        decodeURIComponent(qs.get('reason') || 'Error desconocido') +
          '\n\nRevisa GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en .env y que la URI de redirección en Google Cloud sea exactamente la de GOOGLE_REDIRECT_URI.'
      );
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    }

    try {
      const me = await api('/api/auth/me');
      authState.loggedIn = !!me.loggedIn;
      authState.email = me.email || '';
    } catch (_) {
      authState.loggedIn = false;
      authState.email = '';
    }
    applyAuthUi();

    try {
      if (authState.loggedIn) {
        const s = await withTheaterLoading(() => api('/api/setup'));
        if (s.needsOAuth) {
          await showAlert(
            'Conectar Google',
            'Para usar el sistema debes vincular tu cuenta Google en este equipo. Se abrirá la página de autorización.'
          );
          window.location.href = s.authUrl || '/auth/google';
          return;
        }
        if (!sessionStorage.getItem('tava-curtain-opened')) {
          sessionStorage.setItem('tava-curtain-opened', '1');
          playCurtainIntro();
        }
      }
    } catch (_) {}
    if (!location.hash) location.hash = '#inicio';
    route();
    resetEvForm();

    const loginForm = $('#login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async (evn) => {
        evn.preventDefault();
        const email = ($('#login-email')?.value || '').trim().toLowerCase();
        if (!email) {
          await showAlert('Correo requerido', 'Ingresa un correo para iniciar sesión.');
          return;
        }
        try {
          const out = await withTheaterLoading(() =>
            api('/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email }),
            })
          );
          authState.loggedIn = !!out.loggedIn;
          authState.email = out.email || email;
          applyAuthUi();
          const s = await withTheaterLoading(() => api('/api/setup'));
          if (s.needsOAuth) {
            await showAlert(
              'Conectar Google',
              'Para usar el sistema debes vincular tu cuenta Google. Se abrirá la página de autorización.'
            );
            window.location.href = s.authUrl || '/auth/google';
            return;
          }
          sessionStorage.setItem('tava-curtain-opened', '1');
          playCurtainIntro();
          await loadAllowedEmails().catch(() => {});
          location.hash = '#eventos';
          route();
        } catch (e) {
          await showAlert('No fue posible ingresar', e.message || String(e));
        }
      });
    }

    const allowedForm = $('#allowed-email-form');
    if (allowedForm) {
      allowedForm.addEventListener('submit', async (evn) => {
        evn.preventDefault();
        const input = $('#allowed-email-input');
        const email = (input?.value || '').trim().toLowerCase();
        if (!email) return;
        try {
          const out = await api('/api/auth/allowed-emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });
          if (input) input.value = '';
          renderAllowedEmails(out.items);
        } catch (e) {
          await showAlert('No se pudo agregar', e.message || String(e));
        }
      });
    }

    const logoutBtn = $('#btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        try {
          await api('/api/auth/logout', { method: 'POST' });
        } catch (_) {}
        authState.loggedIn = false;
        authState.email = '';
        sessionStorage.removeItem('tava-curtain-opened');
        applyAuthUi();
        renderAllowedEmails([]);
        location.hash = '#inicio';
        route();
      });
    }

    if (authState.loggedIn) {
      await loadAllowedEmails().catch(() => {});
    }

    const IDLE_LIMIT_MS = 5 * 60 * 1000;
    const IDLE_EXIT_SECONDS = 60;
    let idleDeadlineTimer = null;
    let idleCountdownTimer = null;

    function clearIdleTimers() {
      clearTimeout(idleDeadlineTimer);
      if (idleCountdownTimer) {
        clearInterval(idleCountdownTimer);
        idleCountdownTimer = null;
      }
    }

    function scheduleIdleDeadline() {
      clearTimeout(idleDeadlineTimer);
      idleDeadlineTimer = setTimeout(showIdleExitCountdown, IDLE_LIMIT_MS);
    }

    function showIdleExitCountdown() {
      const banner = $('#idle-banner');
      const msg = $('#idle-banner-msg');
      if (!banner || !msg) return;
      let s = IDLE_EXIT_SECONDS;
      banner.classList.remove('hidden');
      msg.textContent = `Sin actividad: la aplicación se reiniciará en ${s} s. Mueva el ratón o pulse una tecla para seguir.`;
      idleCountdownTimer = setInterval(() => {
        s -= 1;
        if (s <= 0) {
          clearInterval(idleCountdownTimer);
          idleCountdownTimer = null;
          window.location.reload();
          return;
        }
        msg.textContent = `Sin actividad: la aplicación se reiniciará en ${s} s. Mueva el ratón o pulse una tecla para seguir.`;
      }, 1000);
    }

    function bumpActivity() {
      const banner = $('#idle-banner');
      if (banner && !banner.classList.contains('hidden')) {
        banner.classList.add('hidden');
      }
      clearIdleTimers();
      scheduleIdleDeadline();
    }

    ['click', 'keydown', 'scroll', 'touchstart'].forEach((ev) => {
      document.addEventListener(ev, bumpActivity, { passive: true });
    });
    let lastMoveBump = 0;
    document.addEventListener(
      'mousemove',
      () => {
        const n = Date.now();
        if (n - lastMoveBump < 2500) return;
        lastMoveBump = n;
        bumpActivity();
      },
      { passive: true }
    );
    scheduleIdleDeadline();
  }

  init();
})();
