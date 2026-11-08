/* Imperium Beauty Studio — JS mínimo (progressive enhancement).
   Todo el contenido es visible sin JS; aquí solo se añade comportamiento.
   Sin textos propios: los mensajes traducidos llegan en atributos data-* generados por build.mjs. */
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

  var heroFx = initImmersiveHero(document.querySelector('[data-immersive]'));

  // Al llegar con un ancla (p. ej. #quienes-somos), el hero cambia de altura tras cargar
  // y el navegador queda mal posicionado: se vuelve a llevar al destino ya con el layout final.
  if (location.hash.length > 1) {
    var fixHash = function () {
      var target = null;
      try { target = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (e) {}
      if (target) target.scrollIntoView({ block: 'start' });
    };
    requestAnimationFrame(function () { requestAnimationFrame(fixHash); });
    window.addEventListener('load', fixHash, { once: true });
  }

  reduceMQ.addEventListener('change', function (e) {
    reduced = e.matches;
    doc.classList.toggle('motion', !reduced);
    doc.classList.toggle('motion-ok', !reduced);
    if (reduced) layers.forEach(function (el) { el.style.transform = ''; });
    else onScroll();
    if (heroFx) { if (reduced) heroFx.disable(); else heroFx.enable(); }
  });

  /* ---------- Botones flotantes (móvil): se apartan al bajar leyendo ---------- */
  var fabStack = document.querySelector('.fab-stack');
  if (fabStack) {
    var lastY = window.scrollY, fabTick = false;
    var fabMQ = window.matchMedia('(max-width: 47.99em)');
    // En la primera pantalla ya hay botones de reserva propios (hero), así que no se muestran.
    var updateFab = function (force) {
      fabTick = false;
      var y = window.scrollY, dy = y - lastY;
      if (!force && Math.abs(dy) < 6) return;
      var vh = window.innerHeight;
      var nearEnd = y + vh > document.documentElement.scrollHeight - 160;
      var inHero = y < vh * .55;
      fabStack.classList.toggle('is-tucked', fabMQ.matches && !nearEnd && (inHero || dy > 0));
      lastY = y;
    };
    window.addEventListener('scroll', function () { if (!fabTick) { fabTick = true; requestAnimationFrame(function () { updateFab(false); }); } }, { passive: true });
    fabMQ.addEventListener('change', function () { updateFab(true); });
    updateFab(true);
  }

  /* ==========================================================================
     Hero inmersivo: un único bucle rAF que lee el progreso del scroll (0→1)
     dentro de la sección fijada y dirige capas, titular, partículas y cursor.
     Solo transform / opacity / filter moderado. Se pausa fuera de vista o con
     la pestaña oculta. Con reduced-motion no se activa (hero estático).
     ========================================================================== */
  function initImmersiveHero(root) {
    if (!root) return null;
    var stage = root.querySelector('.hx__stage');
    var track = root.querySelector('.hx__track');
    var content = root.querySelector('.hx__content');
    var title = root.querySelector('.hx-title');
    var lines = root.querySelectorAll('.hx-title__line');
    var words = root.querySelectorAll('.hx__word');
    var visual = root.querySelector('.hx__visual');
    var rig = root.querySelector('.hx__rig');
    var glow = root.querySelector('.hx__glow');
    var hint = root.querySelector('.hx__hint');
    var canvas = root.querySelector('.hx__particles');
    var ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    var bg2 = root.querySelector('.hx__bg--2'), bg3 = root.querySelector('.hx__bg--3');
    var reveals = Array.prototype.slice.call(root.querySelectorAll('[data-hx-reveal]'));
    var allLayers = Array.prototype.slice.call(root.querySelectorAll('.hx__layer')).map(function (el) {
      return { el: el, z: +el.dataset.z || 0, fly: +el.dataset.fly || 0, depth: +el.dataset.depth || 0, rot: +el.dataset.rot || 0, blur: -1, op: -1 };
    });
    var hdr = document.querySelector('.site-header');
    var coarse = window.matchMedia('(hover: none), (pointer: coarse)').matches;

    var on = false, running = false, inView = true, raf = 0;
    var M = {}; // medidas
    var p = 0, pd = 0, lastScroll = window.scrollY;
    var ptr = { tx: 0, ty: 0, x: 0, y: 0, px: -9999, py: -9999, gx: 0, gy: 0, active: false, pressed: false, last: 0 };
    var parts = [], gold = '#C9A24B', goldStrong = '#9a7420';

    var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
    var c01 = function (v) { return clamp(v, 0, 1); };
    var ease = function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
    var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };
    var lerp = function (a, b, t) { return a + (b - a) * t; };

    function measure() {
      if (!on) return;
      var vw = window.innerWidth, vh = window.innerHeight;
      var hh = hdr ? hdr.offsetHeight : 72;
      root.style.setProperty('--hx-hh', hh + 'px');
      var sh = stage.offsetHeight;
      var top = sh > vh - hh ? Math.min(hh, vh - sh) : hh;
      root.style.setProperty('--hx-top', top + 'px');
      sh = stage.offsetHeight;
      M.vw = vw; M.vh = vh; M.top = top; M.sh = sh;
      M.W = stage.clientWidth; M.H = Math.min(sh, vh - Math.max(top, 0));
      M.dist = Math.max(1, track.offsetHeight - sh);
      M.trackTop = track.getBoundingClientRect().top + window.scrollY;
      M.desktop = vw >= 960;
      M.layers = allLayers.filter(function (l) { return l.el.offsetParent !== null; });
      // FLIP del titular: posición final (layout) → gigante y centrado al inicio
      title.style.transform = 'none';
      if (visual) visual.style.transform = 'none';
      var sr = stage.getBoundingClientRect();
      var tr = title.getBoundingClientRect();
      for (var i = 0; i < lines.length; i++) lines[i].style.transform = 'none';
      var minL = Infinity, maxR = -Infinity;
      title.querySelectorAll('.hx-w').forEach(function (w) { var b = w.getBoundingClientRect(); minL = Math.min(minL, b.left); maxR = Math.max(maxR, b.right); });
      var tw = maxR > minL ? Math.min(tr.width, maxR - minL) : tr.width;
      var cy = M.H * (M.desktop ? .5 : .46);
      M.ts = clamp(Math.min((M.W * (M.desktop ? .9 : .94)) / tw, (M.H * .62) / tr.height), 1, 2.4);
      var tcx = maxR > minL ? (minL + maxR) / 2 : tr.left + tr.width / 2;
      title.style.transformOrigin = (tcx - tr.left).toFixed(1) + 'px 50%';
      M.tdx = M.W / 2 - (tcx - sr.left);
      M.tdy = cy - (tr.top - sr.top + tr.height / 2);
      if (visual) {
        var vr = visual.getBoundingClientRect();
        M.vdx = M.W / 2 - (vr.left - sr.left + vr.width / 2);
        M.vdy = M.H * .5 - (vr.top - sr.top + vr.height / 2);
      }
      sizeCanvas();
    }

    /* ---- Partículas doradas (canvas) ---- */
    function sizeCanvas() {
      if (!ctx) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = stage.clientWidth, h = stage.offsetHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      M.cw = w; M.ch = h;
      var n = Math.round(clamp((w * h) / 13000, 22, w < 768 ? 38 : 110));
      while (parts.length < n) parts.push(newPart(w, h));
      parts.length = n;
    }
    function newPart(w, h) {
      var r = Math.random();
      var size = r < .7 ? .6 + Math.random() * 1.2 : 1.8 + Math.random() * 2.2;
      return { x: Math.random() * w, y: Math.random() * h, vx: 0, vy: 0, bx: (Math.random() - .5) * .25, by: -(.08 + Math.random() * .35), r: size, a: .35 + Math.random() * .6, ph: Math.random() * 6.28, star: size > 2.6 };
    }
    function burst(x, y, power) {
      for (var i = 0; i < parts.length; i++) {
        var q = parts[i], dx = q.x - x, dy = q.y - y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d < 260) { var f = (1 - d / 260) * power; q.vx += dx / d * f; q.vy += dy / d * f; }
      }
    }
    function drawParticles(t, scrollDelta) {
      if (!ctx) return;
      var w = M.cw, h = M.ch, R = M.desktop ? 150 : 110, R2 = R * R;
      ctx.clearRect(0, 0, w, h);
      var px = ptr.px, py = ptr.py, act = ptr.active, attract = ptr.pressed;
      for (var i = 0; i < parts.length; i++) {
        var q = parts[i];
        if (act) {
          var dx = q.x - px, dy = q.y - py, d2 = dx * dx + dy * dy;
          if (d2 < R2 && d2 > 1) {
            var d = Math.sqrt(d2), f = (1 - d / R) * (attract ? -.55 : .9);
            q.vx += dx / d * f; q.vy += dy / d * f;
          }
        }
        q.vx = q.vx * .93 + q.bx * .07;
        q.vy = q.vy * .93 + q.by * .07;
        q.x += q.vx; q.y += q.vy - scrollDelta * q.r * .18;
        if (q.x < -10) q.x = w + 10; else if (q.x > w + 10) q.x = -10;
        if (q.y < -10) q.y = h + 10; else if (q.y > h + 10) q.y = -10;
        ctx.globalAlpha = q.a * (.55 + .45 * Math.sin(t * .0021 + q.ph));
        ctx.fillStyle = q.star ? goldStrong : gold;
        ctx.beginPath();
        if (q.star) {
          var s = q.r * 1.6, k = s * .28;
          ctx.moveTo(q.x, q.y - s); ctx.quadraticCurveTo(q.x + k, q.y - k, q.x + s, q.y);
          ctx.quadraticCurveTo(q.x + k, q.y + k, q.x, q.y + s); ctx.quadraticCurveTo(q.x - k, q.y + k, q.x - s, q.y);
          ctx.quadraticCurveTo(q.x - k, q.y - k, q.x, q.y - s);
        } else {
          ctx.arc(q.x, q.y, q.r, 0, 6.2832);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    /* ---- Fotograma ---- */
    function frame(t) {
      raf = 0;
      if (!running) return;
      var sy = window.scrollY, sd = sy - lastScroll; lastScroll = sy;
      p = c01((sy + M.top - M.trackTop) / M.dist);
      pd += (p - pd) * .16; if (Math.abs(p - pd) < .0005) pd = p;
      var P = pd;

      // Cursor con inercia (en táctil o sin ratón: deriva suave automática)
      if (!ptr.active || t - ptr.last > 3500) {
        ptr.tx = Math.sin(t * .00042) * .45; ptr.ty = Math.cos(t * .00031) * .3;
        if (!ptr.active) { ptr.gx = lerp(ptr.gx, M.W * (.5 + ptr.tx * .5), .03); ptr.gy = lerp(ptr.gy, M.H * (.45 + ptr.ty * .5), .03); }
      }
      ptr.x += (ptr.tx - ptr.x) * .07; ptr.y += (ptr.ty - ptr.y) * .07;
      if (ptr.active) { ptr.gx = lerp(ptr.gx, ptr.px, .12); ptr.gy = lerp(ptr.gy, ptr.py, .12); }
      var mx = ptr.x, my = ptr.y;

      // Fondo: el degradado cambia de color a lo largo del recorrido
      bg2.style.opacity = (c01((P - .08) / .3) * (1 - c01((P - .55) / .3))).toFixed(3);
      bg3.style.opacity = c01((P - .5) / .35).toFixed(3);
      if (glow) glow.style.transform = 'translate3d(' + ptr.gx.toFixed(1) + 'px,' + ptr.gy.toFixed(1) + 'px,0)';

      // Escena 3D: inclinación con el cursor + capas que vuelan en profundidad
      if (rig) rig.style.transform = 'rotateX(' + (-my * 6).toFixed(2) + 'deg) rotateY(' + (mx * 8).toFixed(2) + 'deg)';
      var L = M.layers;
      for (var i = 0; i < L.length; i++) {
        var l = L[i];
        var z = l.z + ease(P) * l.fly;
        var x = mx * l.depth * 46, y = my * l.depth * 34 - P * l.depth * 60;
        l.el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,' + z.toFixed(0) + 'px) rotate(' + (P * l.rot).toFixed(2) + 'deg)';
        var b = z > 0 ? z / 120 : -z / 240; b = Math.round(clamp(b, 0, M.desktop ? 10 : 6) * 2) / 2;
        if (b !== l.blur) { l.blur = b; l.el.style.filter = b ? 'blur(' + b + 'px)' : ''; }
        var o = z > 420 ? c01(1 - (z - 420) / 360) : 1; o = Math.round(o * 50) / 50;
        if (o !== l.op) { l.op = o; l.el.style.opacity = o; }
      }

      // Palabras gigantes: se abren en horizontal con giro, escala y desenfoque
      var sp = ease(c01(P / .62));
      for (var w = 0; w < words.length; w++) {
        var dir = w ? 1 : -1;
        var wb = Math.round(sp * 9 * 2) / 2;
        words[w].style.transform = 'translate3d(' + (dir * sp * 62 - mx * 3 * (w ? -1 : 1)) .toFixed(2) + 'vw,' + (my * 14 + dir * sp * -6).toFixed(1) + 'vh,0) rotate(' + (dir * sp * 13).toFixed(2) + 'deg) scale(' + (1 + sp * .55).toFixed(3) + ')';
        words[w].style.filter = wb ? 'blur(' + wb + 'px)' : '';
        words[w].style.opacity = (1 - c01((P - .15) / .4)).toFixed(3);
      }

      // Titular: gigante y centrado → se divide y gira → aterriza en su sitio
      var tp = c01(P / .58), te = ease(tp), split = Math.sin(Math.PI * tp);
      var s = lerp(M.ts, 1, te);
      title.style.transform = 'translate(' + (M.tdx * (1 - te) + mx * 10).toFixed(1) + 'px,' + (M.tdy * (1 - te) + my * 6).toFixed(1) + 'px) scale(' + s.toFixed(4) + ')';
      for (var j = 0; j < lines.length; j++) {
        var d2 = j ? 1 : -1;
        lines[j].style.transform = 'translateX(' + (d2 * split * M.W * .11 / s).toFixed(1) + 'px) rotate(' + (d2 * split * 5).toFixed(2) + 'deg)';
      }

      // Arco de foto: llega desde el fondo (desktop) o atraviesa la cámara (móvil)
      if (visual) {
        if (M.desktop) {
          var ve = easeOut(c01((P - .12) / .5));
          var vb = Math.round((1 - ve) * 6 * 2) / 2;
          visual.style.transform = 'translate(' + (M.vdx * (1 - ve) - mx * 18).toFixed(1) + 'px,' + (M.vdy * (1 - ve) - my * 12).toFixed(1) + 'px) scale(' + lerp(.42, 1, ve).toFixed(3) + ') rotate(' + lerp(-10, 0, ve).toFixed(2) + 'deg)';
          visual.style.filter = vb ? 'blur(' + vb + 'px)' : '';
          visual.style.opacity = lerp(.55, 1, ve).toFixed(3);
        } else {
          var mv = ease(c01(P / .45));
          var mb = Math.round(mv * 8 * 2) / 2;
          visual.style.transform = 'translate(' + (-mx * 14).toFixed(1) + 'px,' + (-my * 10 - mv * 40).toFixed(1) + 'px) scale(' + (1 + mv * 1.8).toFixed(3) + ')';
          visual.style.filter = mb ? 'blur(' + mb + 'px)' : '';
          visual.style.opacity = (.4 * (1 - mv)).toFixed(3);
        }
      }

      // Contenido: entrada escalonada al final del recorrido
      for (var k = 0; k < reveals.length; k++) {
        var st = .5 + k * .065, rr = easeOut(c01((P - st) / .16));
        var el = reveals[k];
        el.style.opacity = rr.toFixed(3);
        el.style.transform = rr >= 1 ? 'none' : 'translate3d(0,' + ((1 - rr) * 42).toFixed(1) + 'px,0)';
      }
      if (hint) hint.style.opacity = (1 - c01(P * 6)).toFixed(3);

      drawParticles(t, sd);
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (running || !on || !inView || document.hidden) return;
      running = true; lastScroll = window.scrollY;
      raf = requestAnimationFrame(frame);
    }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

    function clearStyles() {
      var els = [title, visual, rig, glow, hint, bg2, bg3].concat(Array.prototype.slice.call(lines), Array.prototype.slice.call(words), reveals, allLayers.map(function (l) { return l.el; }));
      els.forEach(function (el) { if (el) { el.style.transform = ''; el.style.filter = ''; el.style.opacity = ''; el.style.visibility = ''; } });
      title.style.transformOrigin = '';
      allLayers.forEach(function (l) { l.blur = -1; l.op = -1; });
      root.style.removeProperty('--hx-top'); root.style.removeProperty('--hx-hh');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    /* ---- Interacción ---- */
    function setPtr(cx, cy) {
      var r = stage.getBoundingClientRect();
      ptr.px = cx - r.left; ptr.py = cy - r.top;
      ptr.tx = clamp((ptr.px / r.width) * 2 - 1, -1, 1);
      ptr.ty = clamp((ptr.py / Math.min(r.height, window.innerHeight)) * 2 - 1, -1, 1);
      ptr.active = true; ptr.last = performance.now();
    }
    root.addEventListener('pointermove', function (e) { if (on && e.pointerType === 'mouse') setPtr(e.clientX, e.clientY); }, { passive: true });
    root.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { ptr.active = false; ptr.pressed = false; } });
    root.addEventListener('pointerdown', function (e) {
      if (!on || e.pointerType !== 'mouse') return;
      setPtr(e.clientX, e.clientY); ptr.pressed = true;
    });
    window.addEventListener('pointerup', function (e) {
      if (e.pointerType === 'mouse' && ptr.pressed) { ptr.pressed = false; if (on) burst(ptr.px, ptr.py, 7); }
    });
    // Táctil: el dedo aparta las partículas y un toque las hace estallar (sin giroscopio)
    root.addEventListener('touchstart', function (e) {
      if (!on) return; var t0 = e.touches[0]; setPtr(t0.clientX, t0.clientY); burst(ptr.px, ptr.py, 6);
    }, { passive: true });
    root.addEventListener('touchmove', function (e) { if (on) { var t0 = e.touches[0]; setPtr(t0.clientX, t0.clientY); } }, { passive: true });
    root.addEventListener('touchend', function () { ptr.active = false; }, { passive: true });

    // Teclado: si el foco entra en el contenido aún oculto, saltamos al final de la coreografía
    content.addEventListener('focusin', function () {
      if (!on || pd > .9) return;
      var jump = function () {
        window.scrollTo({ top: M.trackTop - M.top + M.dist * .96, behavior: 'instant' });
        p = pd = c01((window.scrollY + M.top - M.trackTop) / M.dist);
      };
      jump(); setTimeout(jump, 0); // después del desplazamiento propio del foco
    });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) {
        inView = en[0].isIntersecting;
        if (inView) start(); else stop();
      }, { rootMargin: '80px 0px' }).observe(root);
    }
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
    var rz = 0;
    window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(measure, 120); }, { passive: true });
    window.addEventListener('load', measure);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

    function enable() {
      if (on) return;
      var cs = getComputedStyle(document.documentElement);
      gold = (cs.getPropertyValue('--c-gold') || gold).trim() || gold;
      goldStrong = (cs.getPropertyValue('--c-gold-strong') || goldStrong).trim() || goldStrong;
      on = true; root.classList.add('hx-on');
      if (coarse) ptr.active = false;
      measure();
      pd = p = c01((window.scrollY + M.top - M.trackTop) / M.dist);
      ptr.gx = M.W * .5; ptr.gy = M.H * .45;
      start();
    }
    function disable() {
      on = false; stop(); root.classList.remove('hx-on'); clearStyles();
    }
    if (!reduced) enable();
    return { enable: enable, disable: disable };
  }

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
      // Textos traducidos desde el HTML (content/i18n/ui.json → countOne / countMany)
      if (live) live.textContent = String((shown === 1 ? filterBar.dataset.countOne : filterBar.dataset.countMany) || '{n}').replace('{n}', shown);
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
        setStatus(form.dataset.msgInvalid || '', 'error');
        if (bad) bad.focus();
        return;
      }
      form.querySelectorAll('[aria-invalid]').forEach(function (f) { f.removeAttribute('aria-invalid'); });
      var data = new FormData(form);
      if (data.get('_gotcha')) { e.preventDefault(); return; }
      var endpoint = form.dataset.endpoint;
      e.preventDefault();
      if (endpoint) {
        setStatus(form.dataset.msgSending || '', '');
        fetch(endpoint, { method: 'POST', body: data, headers: { Accept: 'application/json' } })
          .then(function (r) {
            if (!r.ok) throw new Error(String(r.status));
            form.reset();
            setStatus(form.dataset.msgOk || '', 'ok');
          })
          .catch(function () { setStatus(form.dataset.msgError || '', 'error'); });
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
      setStatus(form.dataset.msgWa || '', 'ok');
    });
  });

  /* ---------- Año del footer ---------- */
  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = String(new Date().getFullYear()); });
})();
