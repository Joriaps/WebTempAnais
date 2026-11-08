/* ==========================================================================
   Mapa corporal 3D (sección #zonas de la portada) — módulo ES.
   - Sin JS / sin WebGL / prefers-reduced-motion: se queda la versión estática
     (silueta SVG + acordeón) que ya trae el HTML con todo el contenido.
   - Si no: cuando la sección se acerca a la vista se carga Three.js (versión
     fijada, URL en data-three) y se monta una escena fijada (sticky): el scroll
     orbita la cámara de zona en zona. El contenido del panel se copia de los
     elementos .bm-zone del HTML (ningún texto vive en este archivo).
   ========================================================================== */
import { sampleSurface, sampleContours, makeSdf, makeGrad } from './bodymap-figure.js';

const sec = document.querySelector('[data-bodymap]');
if (sec) setup(sec);

function webglOk() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch (e) { return false; }
}

function setup(sec) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (mq.matches || !('IntersectionObserver' in window) || !sec.dataset.three || !webglOk()) return;
  const zoneEls = Array.prototype.slice.call(sec.querySelectorAll('.bm-zone'));
  if (!zoneEls.length) return;
  let app = null, loading = false;
  const io = new IntersectionObserver((es) => {
    if (loading || !es.some((e) => e.isIntersecting)) return;
    loading = true; io.disconnect(); load();
  }, { rootMargin: '900px 0px' });
  io.observe(sec);

  async function load() {
    let THREE;
    try { THREE = await import(sec.dataset.three); } catch (e) { return; } // sin red / CDN: versión estática
    if (mq.matches) return;
    try { app = await createApp(THREE, sec, zoneEls); } catch (e) { app = null; }
  }
  const onMq = (e) => { if (e.matches && app) { app.destroy(); app = null; } };
  if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, t) => { const x = clamp((t - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
const tick = () => new Promise((r) => setTimeout(r, 0));
const el = (tag, cls, attrs) => { const n = document.createElement(tag); if (cls) n.className = cls; if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };

/** Nube de puntos de la figura, en trozos para no bloquear el hilo principal. */
async function samplePoints(total) {
  const chunks = Math.max(4, Math.round(total / 3500)), parts = [];
  for (let i = 0; i < chunks; i++) {
    parts.push([sampleSurface(Math.round((total * 0.55) / chunks), 101 + i), 0]);
    await tick();
    parts.push([sampleContours(Math.round((total * 0.45) / chunks), 0.026, 301 + i), 1]);
    await tick();
  }
  const n = parts.reduce((s, [p]) => s + p.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), line = new Float32Array(n), rnd = new Float32Array(n);
  let o = 0;
  for (const [p, isLine] of parts) {
    pos.set(p.positions, o * 3); nor.set(p.normals, o * 3);
    for (let i = 0; i < p.count; i++) { line[o + i] = isLine; rnd[o + i] = Math.random(); }
    o += p.count;
  }
  return { pos, nor, line, rnd, n };
}

const FIG_VS = `
attribute float aLine; attribute float aRand;
uniform float uTime, uScale, uPR, uFocusAmt;
uniform vec3 uFocus, uGold, uDeep, uAccent, uLight;
varying vec3 vColor; varying float vAlpha;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  vec3 wn = normalize(mat3(modelMatrix) * normal);
  vec3 V = normalize(cameraPosition - wp.xyz);
  float ndv = dot(wn, V);
  float facing = smoothstep(-0.25, 0.35, ndv);
  float rim = pow(1.0 - clamp(ndv, 0.0, 1.0), 2.5);
  float lam = clamp(dot(wn, uLight) * 0.5 + 0.5, 0.0, 1.0);
  float f = uFocusAmt * (1.0 - smoothstep(0.02, 0.13, distance(position, uFocus)));
  vec3 c = mix(uDeep, uGold, lam);
  c = mix(c, vec3(1.0, 0.93, 0.76), rim * 0.4);
  c = mix(c, uAccent, f * 0.35);
  float tw = 0.78 + 0.22 * sin(uTime * 1.6 + aRand * 40.0);
  float base = mix(0.3, 1.0, aLine);
  vAlpha = clamp((base + rim * 0.25 + f * 0.45) * mix(0.1, 1.0, facing) * tw, 0.0, 1.0);
  vColor = c;
  float size = mix(0.0062, 0.0056, aLine) * (0.75 + 0.5 * aRand) * (1.0 + f * 0.6);
  gl_PointSize = clamp(size * uScale / -mv.z, 1.5 * uPR, 7.0 * uPR);
  gl_Position = projectionMatrix * mv;
}`;
const DOT_FS = `
varying vec3 vColor; varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.12, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;
const DECO_VS = `
attribute float aRand; attribute float aDrift;
uniform float uTime, uScale, uPR;
uniform vec3 uGold;
varying vec3 vColor; varying float vAlpha;
void main() {
  vec3 p = position;
  float tw = 0.6 + 0.4 * sin(uTime * (0.8 + aRand) + aRand * 30.0);
  float a = 0.55;
  if (aDrift > 0.5) {
    p.y = mod(p.y + uTime * 0.035 * (0.4 + aRand), 2.1);
    p.x += sin(uTime * 0.3 + aRand * 6.28) * 0.04;
    p.z += cos(uTime * 0.27 + aRand * 6.28) * 0.04;
    a = 0.55 * sin(3.14159 * p.y / 2.1);
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vAlpha = a * tw;
  vColor = uGold;
  gl_PointSize = clamp((0.003 + 0.004 * aRand) * uScale / -mv.z, 1.0, 3.5 * uPR);
  gl_Position = projectionMatrix * mv;
}`;

async function createApp(THREE, sec, zoneEls) {
  const mobile = window.matchMedia('(max-width: 47.99em), (pointer: coarse)').matches;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const css = getComputedStyle(document.documentElement);
  const col = (n, d) => css.getPropertyValue(n).trim() || d;
  const ds = sec.dataset;

  const sdf = makeSdf(), grad = makeGrad(sdf);
  const zones = zoneEls.map((li) => {
    const v = (li.dataset.view || '0,5,1.5').split(',').map(Number);
    const a = (li.dataset.anchor || '0,0.95,0').split(',').map(Number);
    const t = li.querySelector('.bm-zone__title');
    return { id: li.dataset.zone, li, label: t ? t.textContent.trim() : '', body: li.querySelector('.bm-zone__body'), az: v[0] || 0, el: v[1] || 0, zoom: (v[2] || 1.5) * (mobile ? 0.72 : 1), // en móvil, algo más lejos (pantalla estrecha)
      anchor: a, normal: grad(a[0], a[1], a[2]) };
  });
  const steps = [{ overview: true, label: ds.overview || '', az: -22, el: 6, zoom: mobile ? 0.8 : 1, anchor: [0, 0.9, 0] }].concat(zones);
  const N = steps.length;

  /* ---------- Geometría (antes de tocar el DOM: si falla, la página no cambia) ---------- */
  const P = await samplePoints(mobile ? 15000 : 38000);

  /* ---------- DOM de la escena ---------- */
  const track = el('div', 'bm__track');
  track.style.setProperty('--bm-steps', N);
  const stage = el('div', 'bm__stage');
  const canvas = el('canvas', 'bm__canvas', { 'aria-hidden': 'true' });
  const hotLayer = el('div', 'bm__hotspots');
  const panel = el('div', 'bm__panel', { 'aria-live': 'polite' });
  const pCounter = el('p', 'bm__counter'), pTitle = el('h3', 'bm__ptitle'), pBody = el('div', 'bm__pbody');
  panel.append(pCounter, pTitle, pBody);
  const nav = el('nav', 'bm__dots', { 'aria-label': ds.nav || '' });
  const ol = el('ol');
  const goLabel = (s) => (ds.goto || '{zone}').replace('{zone}', s.label);
  const dots = steps.map((s, k) => {
    const li = el('li'), b = el('button', 'bm-dot' + (k === 0 ? ' bm-dot--overview' : ''), { type: 'button', 'aria-label': goLabel(s) });
    const lab = el('span', 'bm-dot__label', { 'aria-hidden': 'true' }); lab.textContent = s.label;
    b.append(lab); b.addEventListener('click', () => goTo(k));
    li.append(b); ol.append(li); return b;
  });
  nav.append(ol);
  const hots = zones.map((z, i) => {
    const b = el('button', 'bm-hot', { type: 'button', 'aria-label': goLabel(z) });
    b.hidden = true; b.addEventListener('click', () => goTo(i + 1));
    hotLayer.append(b); return { b, vis: false, x: 0, y: 0 };
  });
  const hint = el('p', 'bm__hint', { 'aria-hidden': 'true' }); hint.textContent = ds.hint || '';
  stage.append(canvas, hotLayer, panel, nav, hint);
  track.append(stage);

  /* ---------- Three.js ---------- */
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.03, 30);
  const D0 = mobile ? 4.4 : 3.4;
  const gold = new THREE.Color(col('--c-gold', '#C9A24B'));
  const common = { uTime: { value: 0 }, uScale: { value: 800 }, uPR: { value: 1 }, uGold: { value: gold } };

  const g1 = new THREE.BufferGeometry();
  g1.setAttribute('position', new THREE.BufferAttribute(P.pos, 3));
  g1.setAttribute('normal', new THREE.BufferAttribute(P.nor, 3));
  g1.setAttribute('aLine', new THREE.BufferAttribute(P.line, 1));
  g1.setAttribute('aRand', new THREE.BufferAttribute(P.rnd, 1));
  const figU = Object.assign({}, common, {
    uFocus: { value: new THREE.Vector3(0, 1, 0) }, uFocusAmt: { value: 0 },
    uDeep: { value: new THREE.Color(col('--c-gold-strong', '#7a6025')) },
    uAccent: { value: new THREE.Color(col('--c-coral', '#F07C6C')) },
    uLight: { value: new THREE.Vector3(0.45, 0.75, 0.5).normalize() },
  });
  const m1 = new THREE.ShaderMaterial({ uniforms: figU, vertexShader: FIG_VS, fragmentShader: DOT_FS, transparent: true, depthWrite: false });
  scene.add(new THREE.Points(g1, m1));

  // Polvo dorado ascendente + anillos de pedestal
  const nDust = mobile ? 140 : 320, nRing = mobile ? 260 : 520;
  const dn = nDust + nRing * 2;
  const dPos = new Float32Array(dn * 3), dRnd = new Float32Array(dn), dDrift = new Float32Array(dn);
  for (let i = 0; i < dn; i++) {
    const r = Math.random(); dRnd[i] = r;
    if (i < nDust) {
      const rad = 0.28 + Math.random() * 0.75, th = Math.random() * Math.PI * 2;
      dPos.set([Math.cos(th) * rad, Math.random() * 2.1, Math.sin(th) * rad], i * 3); dDrift[i] = 1;
    } else {
      const ring = i < nDust + nRing ? 0.3 : 0.4, th = Math.random() * Math.PI * 2, j = (Math.random() - 0.5) * 0.006;
      dPos.set([Math.cos(th) * (ring + j), 0.002, Math.sin(th) * (ring + j)], i * 3);
    }
  }
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  g2.setAttribute('aRand', new THREE.BufferAttribute(dRnd, 1));
  g2.setAttribute('aDrift', new THREE.BufferAttribute(dDrift, 1));
  const m2 = new THREE.ShaderMaterial({ uniforms: common, vertexShader: DECO_VS, fragmentShader: DOT_FS, transparent: true, depthWrite: false });
  scene.add(new THREE.Points(g2, m2));

  /* ---------- Montaje: se cambia a modo 3D conservando la posición de lectura ---------- */
  const before = sec.getBoundingClientRect(), h0 = sec.offsetHeight;
  sec.querySelector('.bm__end').before(track);
  sec.classList.add('bm--3d');
  if (before.bottom <= 0) window.scrollBy(0, sec.offsetHeight - h0);

  /* ---------- Medidas y progreso ---------- */
  const hdr = document.querySelector('.site-header');
  const M = { top: 0, h: 1, stageH: 1, off: 0, w: 1, wh: 1 };
  function measure() {
    M.off = hdr ? Math.max(0, Math.round(hdr.getBoundingClientRect().height)) : 0;
    sec.style.setProperty('--bm-top', M.off + 'px');
    const r = track.getBoundingClientRect();
    M.top = r.top + window.scrollY; M.h = track.offsetHeight; M.stageH = stage.offsetHeight;
  }
  const progress = () => clamp((window.scrollY + M.off - M.top) / Math.max(1, M.h - M.stageH), 0, 1);
  function goTo(k) {
    measure();
    const y = M.top - M.off + (k / (N - 1)) * (M.h - M.stageH);
    window.scrollTo({ top: Math.round(y) + 1, behavior: 'smooth' });
  }

  function resize() {
    const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
    const pr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Hueco para el panel: a la izquierda en escritorio, abajo en móvil
    M.wide = w >= 900;
    if (M.wide) camera.setViewOffset(w, h, -w * 0.15, 0, w, h); else camera.setViewOffset(w, h, 0, h * 0.2, w, h);
    camera.updateProjectionMatrix();
    common.uPR.value = pr;
    common.uScale.value = (h * pr) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    M.w = w; M.wh = h;
    measure();
    M.panelTop = M.wide ? h : panel.offsetTop;
  }

  /* ---------- Panel y estado activo ---------- */
  let active = -1;
  function setActive(k) {
    active = k;
    const s = steps[k];
    pCounter.textContent = k === 0 ? '' : (ds.counter || '{n} / {total}').replace('{n}', k).replace('{total}', zones.length);
    pTitle.textContent = s.label;
    pBody.textContent = '';
    if (k === 0) {
      const ul = el('ul', 'bm__chips');
      zones.forEach((z, i) => {
        const li = el('li'), b = el('button', 'bm__chip', { type: 'button' });
        b.textContent = z.label; b.addEventListener('click', () => goTo(i + 1));
        li.append(b); ul.append(li);
      });
      pBody.append(ul);
    } else if (s.body) {
      const c = s.body.cloneNode(true);
      c.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      pBody.append(c);
    }
    panel.classList.remove('is-in'); void panel.offsetWidth; panel.classList.add('is-in');
    stage.classList.toggle('is-overview', k === 0);
    dots.forEach((d, i) => { if (i === k) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current'); });
    hots.forEach((h, i) => h.b.classList.toggle('is-active', i + 1 === k));
  }

  /* ---------- Cámara ---------- */
  const cur = { az: 0, el: 0, ld: 0, tx: 0, ty: 0, tz: 0, fa: 0, ready: false };
  const ptr = { tx: 0, ty: 0, x: 0, y: 0 };
  const tgt = new THREE.Vector3(), v3 = new THREE.Vector3(), focus = new THREE.Vector3();
  let time = 0, last = 0;

  function frame(now) {
    raf = 0;
    if (!running) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now; time += dt;
    const s = progress() * (N - 1);
    const i0 = Math.min(Math.floor(s), N - 1), i1 = Math.min(i0 + 1, N - 1), f = s - i0, fe = smooth(0.2, 0.8, f);
    const A = steps[i0], B = steps[i1];
    let az = lerp(A.az, B.az, fe), elv = lerp(A.el, B.el, fe);
    // Al orbitar mucho, la cámara se aleja a mitad de camino (no atraviesa la figura)
    const pull = Math.sin(Math.PI * fe) * Math.min(1, Math.abs(B.az - A.az) / 120) * 0.55;
    const ld = lerp(Math.log(D0 / A.zoom), Math.log(D0 / B.zoom), fe) + Math.log(1 + pull);
    const tx = lerp(A.anchor[0], B.anchor[0], fe), ty = lerp(A.anchor[1], B.anchor[1], fe), tz = lerp(A.anchor[2], B.anchor[2], fe);
    az += Math.sin(time * 0.25) * 2.5; elv += Math.sin(time * 0.2) * 1.2;
    ptr.x += (ptr.tx - ptr.x) * Math.min(1, dt * 4); ptr.y += (ptr.ty - ptr.y) * Math.min(1, dt * 4);
    az += ptr.x * 7; elv -= ptr.y * 4;
    const k = cur.ready ? 1 - Math.exp(-dt * 5) : 1;
    cur.az += (az - cur.az) * k; cur.el += (elv - cur.el) * k; cur.ld += (ld - cur.ld) * k;
    cur.tx += (tx - cur.tx) * k; cur.ty += (ty - cur.ty) * k; cur.tz += (tz - cur.tz) * k;
    cur.ready = true;
    const a = (cur.az * Math.PI) / 180, e = (clamp(cur.el, -60, 75) * Math.PI) / 180, dist = Math.exp(cur.ld);
    tgt.set(cur.tx, cur.ty, cur.tz);
    camera.position.set(tgt.x + Math.sin(a) * Math.cos(e) * dist, tgt.y + Math.sin(e) * dist, tgt.z + Math.cos(a) * Math.cos(e) * dist);
    camera.lookAt(tgt);

    const act = f < 0.5 ? i0 : i1;
    if (act !== active) setActive(act);
    const z = steps[act];
    focus.set(z.anchor[0], z.anchor[1], z.anchor[2]);
    figU.uFocus.value.lerp(focus, cur.fa === 0 ? 1 : Math.min(1, dt * 6));
    cur.fa += ((act > 0 ? 1 : 0) - cur.fa) * Math.min(1, dt * 3);
    figU.uFocusAmt.value = cur.fa;
    common.uTime.value = time;
    hint.classList.toggle('is-hidden', s > 0.35);

    renderer.render(scene, camera);
    placeHotspots();
    raf = requestAnimationFrame(frame);
  }

  function placeHotspots() {
    camera.updateMatrixWorld();
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i], h = hots[i];
      v3.set(z.anchor[0], z.anchor[1], z.anchor[2]);
      const cx = camera.position.x - v3.x, cy = camera.position.y - v3.y, cz = camera.position.z - v3.z;
      const cl = Math.hypot(cx, cy, cz) || 1;
      const facing = (z.normal[0] * cx + z.normal[1] * cy + z.normal[2] * cz) / cl;
      v3.project(camera);
      const x = (v3.x * 0.5 + 0.5) * M.w, y = (-v3.y * 0.5 + 0.5) * M.wh;
      const vis = facing > (i + 1 === active ? -0.35 : 0.2) && v3.z < 1 && x > 16 && x < M.w - 16 && y > 16 && y < Math.min(M.wh, M.panelTop) - 16;
      if (vis !== h.vis) { h.vis = vis; h.b.hidden = !vis; }
      if (vis && (Math.abs(x - h.x) > 0.3 || Math.abs(y - h.y) > 0.3)) {
        h.x = x; h.y = y; h.b.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      }
    }
  }

  /* ---------- Bucle: solo con la escena en vista y la pestaña visible ---------- */
  let raf = 0, running = false, inView = false;
  function update() {
    const should = inView && !document.hidden;
    if (should && !running) { running = true; last = 0; raf = requestAnimationFrame(frame); }
    else if (!should && running) { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  }
  const vio = new IntersectionObserver((es) => { inView = es[es.length - 1].isIntersecting; update(); }, { rootMargin: '120px 0px' });
  vio.observe(track);
  const onVis = () => update();
  document.addEventListener('visibilitychange', onVis);

  const onMove = (e) => {
    const r = stage.getBoundingClientRect();
    ptr.tx = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
    ptr.ty = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
  };
  const onLeave = () => { ptr.tx = 0; ptr.ty = 0; };
  if (fine) { stage.addEventListener('pointermove', onMove); stage.addEventListener('pointerleave', onLeave); }

  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(stage);
  const onResize = () => resize();
  window.addEventListener('resize', onResize);
  window.addEventListener('load', measure);
  const onLost = (e) => { e.preventDefault(); destroy(); };
  canvas.addEventListener('webglcontextlost', onLost);

  resize();
  setActive(0);

  function destroy() {
    running = false; if (raf) cancelAnimationFrame(raf);
    vio.disconnect(); if (ro) ro.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('load', measure);
    canvas.removeEventListener('webglcontextlost', onLost);
    g1.dispose(); g2.dispose(); m1.dispose(); m2.dispose(); renderer.dispose();
    track.remove(); sec.classList.remove('bm--3d'); sec.style.removeProperty('--bm-top');
  }
  return { destroy };
}
