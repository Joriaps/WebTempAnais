/* Imperium Beauty Studio — JS mínimo (progressive enhancement).
   Todo el contenido es visible sin JS; aquí solo se añade comportamiento. */
(function () {
  'use strict';
  var doc = document.documentElement;
  doc.classList.remove('no-js');
  doc.classList.add('js');

  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var reduced = reduceMQ.matches;
  if (!reduced) doc.classList.add('motion');

  /* ---------- Navegación local (file://): añade index.html a enlaces de carpeta ---------- */
  if (location.protocol === 'file:') {
    document.querySelectorAll('a[href]').forEach(function (a) {
      var h = a.getAttribute('href');
      if (/^(?:[a-z]+:|#|\/\/)/i.test(h)) return;
      var parts = h.split('#');
      if (parts[0] === '' && h.charAt(0) !== '#') parts[0] = './';
      if (/\/$/.test(parts[0]) || parts[0] === '.' || parts[0] === '..') {
        parts[0] = parts[0].replace(/\/?$/, '/') + 'index.html';
        a.setAttribute('href', parts.join('#'));
      }
    });
  }

  /* ---------- Header: sombra al hacer scroll ---------- */
  var header = document.querySelector('.site-header');
  function onScrollHeader() { if (header) header.classList.toggle('is-scrolled', window.scrollY > 8); }

  /* ---------- Menú móvil accesible ---------- */
  var toggle = document.querySelector('.menu-toggle');
  var nav = document.getElementById('site-nav');
  if (toggle && nav) {
    var setOpen = function (open, returnFocus) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? toggle.dataset.labelClose : toggle.dataset.labelOpen);
      nav.classList.toggle('is-open', open);
      if (open) {
        var r = header.getBoundingClientRect();
        nav.style.setProperty('--nav-top', Math.max(0, r.bottom) + 'px');
        var first = nav.querySelector('a');
        if (first) first.focus();
      } else if (returnFocus) {
        toggle.focus();
      }
    };
    toggle.addEventListener('click', function () { setOpen(toggle.getAttribute('aria-expanded') !== 'true', false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') setOpen(false, true);
    });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false, false); });
    window.matchMedia('(min-width: 64em)').addEventListener('change', function (e) { if (e.matches) setOpen(false, false); });
  }

  /* ---------- Parallax ligero (rAF + transform) ---------- */
  var layers = Array.prototype.slice.call(document.querySelectorAll('[data-speed]'));
  var ticking = false;
  function parallax() {
    ticking = false;
    if (reduced) return;
    var y = window.scrollY;
    var k = window.innerWidth < 768 ? 0.35 : 1; // móvil: parallax muy suave
    for (var i = 0; i < layers.length; i++) {
      var el = layers[i];
      var scope = el.parentElement;
      if (y > scope.offsetTop + scope.offsetHeight) continue; // fuera de vista
      var s = parseFloat(el.dataset.speed) || 0;
      el.style.transform = 'translate3d(0,' + (y * s * k).toFixed(1) + 'px,0)';
    }
  }
  function onScroll() {
    onScrollHeader();
    if (!ticking && layers.length) { ticking = true; requestAnimationFrame(parallax); }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  onScroll();

  reduceMQ.addEventListener('change', function (e) {
    reduced = e.matches;
    doc.classList.toggle('motion', !reduced);
    if (reduced) layers.forEach(function (el) { el.style.transform = ''; });
    else onScroll();
  });

  /* ---------- Revelado al scroll ---------- */
  var reveals = document.querySelectorAll('.reveal');
  if (!reduced && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ---------- Filtro del catálogo ---------- */
  var filterBar = document.querySelector('[data-filter-bar]');
  if (filterBar) {
    var groups = document.querySelectorAll('[data-cat-group]');
    var live = document.getElementById('filter-status');
    var buttons = filterBar.querySelectorAll('button[data-filter]');
    var apply = function (cat, fromUser) {
      var shown = 0;
      buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.filter === cat)); });
      groups.forEach(function (g) {
        var on = cat === 'all' || g.dataset.catGroup === cat;
        g.hidden = !on;
        if (on) shown += g.querySelectorAll('.card').length;
      });
      if (live) live.textContent = shown + (shown === 1 ? ' tratamiento' : ' tratamientos');
      if (fromUser && history.replaceState) history.replaceState(null, '', cat === 'all' ? location.pathname + location.search : '#' + cat);
    };
    filterBar.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-filter]');
      if (b) apply(b.dataset.filter, true);
    });
    var hash = decodeURIComponent(location.hash.slice(1));
    var match = hash && filterBar.querySelector('button[data-filter="' + hash.replace(/"/g, '') + '"]');
    apply(match ? hash : 'all', false);
  }

  /* ---------- Pestañas accesibles (precios) ---------- */
  document.querySelectorAll('[data-tabs]').forEach(function (root) {
    var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
    var panels = tabs.map(function (t) { return document.getElementById(t.getAttribute('aria-controls')); });
    root.querySelector('[role="tablist"]').hidden = false;
    panels.forEach(function (p) {
      p.setAttribute('role', 'tabpanel');
      p.setAttribute('tabindex', '0');
      var h = p.querySelector('[data-tab-heading]');
      if (h) h.classList.add('visually-hidden');
    });
    var select = function (i, focus) {
      tabs.forEach(function (t, j) {
        var on = i === j;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        panels[j].hidden = !on;
      });
      if (focus) tabs[i].focus();
    };
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(i, false); });
      t.addEventListener('keydown', function (e) {
        var n = tabs.length, k = e.key, to = null;
        if (k === 'ArrowRight' || k === 'ArrowDown') to = (i + 1) % n;
        else if (k === 'ArrowLeft' || k === 'ArrowUp') to = (i - 1 + n) % n;
        else if (k === 'Home') to = 0;
        else if (k === 'End') to = n - 1;
        if (to !== null) { e.preventDefault(); select(to, true); }
      });
    });
    var hash = location.hash.slice(1);
    var start = Math.max(0, panels.findIndex(function (p) { return p.id === hash || p.id === 'precios-' + hash; }));
    select(start, false);
  });

  /* ---------- Formularios: endpoint (POST) o WhatsApp ---------- */
  document.querySelectorAll('form[data-form]').forEach(function (form) {
    var status = form.querySelector('.form__status');
    var setStatus = function (msg, kind) {
      if (!status) return;
      status.textContent = msg;
      status.className = 'form__status' + (kind ? ' is-' + kind : '');
    };
    form.addEventListener('submit', function (e) {
      // Validación nativa + foco en el primer campo inválido
      if (!form.checkValidity()) {
        e.preventDefault();
        var bad = form.querySelector(':invalid');
        form.querySelectorAll('input,select,textarea').forEach(function (f) { f.setAttribute('aria-invalid', String(!f.validity.valid)); });
        setStatus(form.dataset.msgInvalid || 'Revisa los campos marcados.', 'error');
        if (bad) bad.focus();
        return;
      }
      form.querySelectorAll('[aria-invalid]').forEach(function (f) { f.removeAttribute('aria-invalid'); });
      var data = new FormData(form);
      if (data.get('_gotcha')) { e.preventDefault(); return; }
      var endpoint = form.dataset.endpoint;
      e.preventDefault();
      if (endpoint) {
        setStatus(form.dataset.msgSending || 'Enviando…', '');
        fetch(endpoint, { method: 'POST', body: data, headers: { Accept: 'application/json' } })
          .then(function (r) {
            if (!r.ok) throw new Error(String(r.status));
            form.reset();
            setStatus(form.dataset.msgOk || '¡Gracias! Te responderemos muy pronto.', 'ok');
          })
          .catch(function () { setStatus(form.dataset.msgError || 'No se pudo enviar. Escríbenos por WhatsApp.', 'error'); });
        return;
      }
      // Sin endpoint: compone el mensaje y abre WhatsApp
      var lines = [form.dataset.waIntro || ''];
      form.querySelectorAll('[data-wa-label]').forEach(function (f) {
        var v = (f.type === 'checkbox') ? '' : String(f.value || '').trim();
        if (v) lines.push(f.dataset.waLabel + ': ' + v);
      });
      var url = 'https://wa.me/' + form.dataset.wa + '?text=' + encodeURIComponent(lines.filter(Boolean).join('\n'));
      var w = window.open(url, '_blank');
      if (w) w.opener = null; else location.href = url;
      setStatus(form.dataset.msgWa || 'Abriendo WhatsApp…', 'ok');
    });
  });

  /* ---------- Año del footer ---------- */
  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = String(new Date().getFullYear()); });
})();
