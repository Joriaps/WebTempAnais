/* ==========================================================================
   Figura del mapa corporal — geometría procedural (sin modelos de terceros).
   Maniquí neutro y estilizado definido como unión suave de elipsoides y
   "round cones" (campo de distancia con signo). Lo usan:
   - js/bodymap.js (navegador): nube de puntos dorada en 3D.
   - static/build.mjs (Node): silueta SVG frontal del modo estático.
   Unidades: metros aprox. (altura ≈ 1,78). Y arriba, Z hacia delante.
   Es el respaldo del maniquí 3D (assets/models/figure.glb): misma postura en A
   y mismas alturas; en z el modelo está desplazado FIG_Z (ver bodymap.js).
   Tipos: e = elipsoide { c, r }, c = round cone { a, b, ra, rb }.
   m: true → se duplica en espejo (x → -x). k = suavizado de la unión.
   ========================================================================== */
/** Desplazamiento en z de esta figura respecto al modelo glTF (las anclas de bodymap.json siguen al modelo). */
export const FIG_Z = -0.07;
export const PRIMS = [
  { t: 'e', c: [0, 1.615, 0.005], r: [0.078, 0.102, 0.092], k: 0 },          // cabeza
  { t: 'e', c: [0, 1.64, -0.015], r: [0.08, 0.085, 0.085], k: 0.03 },        // cráneo
  { t: 'e', c: [0, 1.555, 0.022], r: [0.058, 0.055, 0.065], k: 0.04 },       // mandíbula
  { t: 'c', a: [0, 1.4, -0.005], b: [0, 1.53, 0], ra: 0.048, rb: 0.042, k: 0.03 }, // cuello
  { t: 'e', c: [0, 1.27, 0], r: [0.145, 0.15, 0.095], k: 0.06 },             // tórax
  { t: 'c', a: [0, 1.385, -0.01], b: [0.165, 1.37, -0.005], ra: 0.055, rb: 0.05, k: 0.05, m: true }, // hombros
  { t: 'e', c: [0.185, 1.345, 0], r: [0.055, 0.06, 0.055], k: 0.04, m: true }, // deltoides
  { t: 'e', c: [0, 1.08, 0], r: [0.11, 0.13, 0.08], k: 0.07 },               // cintura
  { t: 'e', c: [0, 0.93, -0.01], r: [0.155, 0.11, 0.1], k: 0.06 },           // caderas
  { t: 'e', c: [0.07, 0.89, -0.05], r: [0.08, 0.085, 0.07], k: 0.04, m: true }, // glúteo (suave)
  { t: 'c', a: [0.19, 1.33, 0], b: [0.335, 1.19, -0.01], ra: 0.046, rb: 0.036, k: 0.025, m: true }, // brazo (postura en A, como el modelo 3D)
  { t: 'c', a: [0.335, 1.19, -0.01], b: [0.455, 1.07, 0.02], ra: 0.036, rb: 0.026, k: 0.02, m: true }, // antebrazo
  { t: 'e', c: [0.49, 1.0, 0.03], r: [0.034, 0.06, 0.042], k: 0.02, m: true }, // mano
  { t: 'c', a: [0.085, 0.9, 0], b: [0.095, 0.52, 0.005], ra: 0.082, rb: 0.05, k: 0.03, m: true }, // muslo
  { t: 'c', a: [0.095, 0.52, 0.005], b: [0.09, 0.1, -0.01], ra: 0.05, rb: 0.03, k: 0.02, m: true }, // pierna
  { t: 'e', c: [0.097, 0.37, -0.018], r: [0.045, 0.1, 0.045], k: 0.03, m: true }, // gemelo
  { t: 'c', a: [0.09, 0.045, -0.025], b: [0.105, 0.022, 0.11], ra: 0.036, rb: 0.022, k: 0.02, m: true }, // pie
];

/** Lista expandida (espejos incluidos). */
export function expand(prims = PRIMS) {
  const out = [];
  for (const p of prims) {
    out.push(p);
    if (p.m) {
      const f = (v) => [-v[0], v[1], v[2]];
      out.push(p.t === 'e' ? { ...p, c: f(p.c) } : { ...p, a: f(p.a), b: f(p.b) });
    }
  }
  return out;
}

/* ---------- Campo de distancia (fórmulas de I. Quílez) ---------- */
function sdEllipsoid(x, y, z, p) {
  const px = x - p.c[0], py = y - p.c[1], pz = z - p.c[2];
  const [rx, ry, rz] = p.r;
  const qx = px / rx, qy = py / ry, qz = pz / rz, k0 = Math.sqrt(qx * qx + qy * qy + qz * qz);
  const wx = qx / rx, wy = qy / ry, wz = qz / rz, k1 = Math.sqrt(wx * wx + wy * wy + wz * wz);
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}
function sdRoundCone(x, y, z, p) {
  const [ax, ay, az] = p.a, [bx, by, bz] = p.b;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = p.ra - p.rb, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = x - ax, pay = y - ay, paz = z - az;
  const yy = pax * bax + pay * bay + paz * baz, zz = yy - l2;
  const xvx = pax * l2 - bax * yy, xvy = pay * l2 - bay * yy, xvz = paz * l2 - baz * yy;
  const x2 = xvx * xvx + xvy * xvy + xvz * xvz;
  const y2 = yy * yy * l2, z2 = zz * zz * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - p.rb;
  if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - p.ra;
  return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - p.ra;
}
const smin = (a, b, k) => {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
export function makeSdf(list = expand()) {
  // Esfera envolvente por pieza: si está más lejos que d + k, no puede afectar a la unión suave
  const B = list.map((p) => (p.t === 'e'
    ? { x: p.c[0], y: p.c[1], z: p.c[2], R: Math.max(...p.r), e: true, p }
    : { x: (p.a[0] + p.b[0]) / 2, y: (p.a[1] + p.b[1]) / 2, z: (p.a[2] + p.b[2]) / 2, R: Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]) / 2 + Math.max(p.ra, p.rb), e: false, p }));
  const n = B.length;
  return (x, y, z) => {
    let d = 1e9;
    for (let i = 0; i < n; i++) {
      const b = B[i], dx = x - b.x, dy = y - b.y, dz = z - b.z;
      const ds = Math.sqrt(dx * dx + dy * dy + dz * dz) - b.R;
      if (ds > d + b.p.k) continue;
      d = smin(d, b.e ? sdEllipsoid(x, y, z, b.p) : sdRoundCone(x, y, z, b.p), b.p.k);
    }
    return d;
  };
}

/* ---------- Muestreo de la superficie: posiciones + normales ---------- */
function rng(seed) { // mulberry32: misma figura en cada carga
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function area(p) {
  if (p.t === 'e') { const [a, b, c] = p.r, q = 1.6; return 4 * Math.PI * Math.pow((Math.pow(a * b, q) + Math.pow(a * c, q) + Math.pow(b * c, q)) / 3, 1 / q); }
  const len = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]);
  return Math.PI * (p.ra + p.rb) * len + 2 * Math.PI * (p.ra * p.ra + p.rb * p.rb);
}
function randDir(r) {
  const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return [s * Math.cos(th), u, s * Math.sin(th)];
}
function seedPoint(p, r) {
  if (p.t === 'e') { const d = randDir(r); return [p.c[0] + d[0] * p.r[0], p.c[1] + d[1] * p.r[1], p.c[2] + d[2] * p.r[2]]; }
  if (r() < 0.2) { const end = r() < 0.5, c = end ? p.a : p.b, rad = end ? p.ra : p.rb, d = randDir(r); return [c[0] + d[0] * rad, c[1] + d[1] * rad, c[2] + d[2] * rad]; }
  const t = r(), ax = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]];
  const len = Math.hypot(...ax); ax[0] /= len; ax[1] /= len; ax[2] /= len;
  const ref = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u = [ax[1] * ref[2] - ax[2] * ref[1], ax[2] * ref[0] - ax[0] * ref[2], ax[0] * ref[1] - ax[1] * ref[0]];
  const ul = Math.hypot(...u); u = u.map((v) => v / ul);
  const w = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]];
  const th = r() * Math.PI * 2, rad = p.ra + (p.rb - p.ra) * t, c = Math.cos(th) * rad, s = Math.sin(th) * rad;
  return [p.a[0] + ax[0] * len * t + u[0] * c + w[0] * s, p.a[1] + ax[1] * len * t + u[1] * c + w[1] * s, p.a[2] + ax[2] * len * t + u[2] * c + w[2] * s];
}

/**
 * Devuelve { positions: Float32Array, normals: Float32Array, count } con `n` puntos
 * repartidos por la superficie suavizada (proyección de Newton sobre el SDF).
 */
/** Normal (gradiente normalizado del SDF) — tetraédrico, 4 evaluaciones. */
export function makeGrad(sdf, e = 0.0015) {
  return (x, y, z) => {
    const a = sdf(x + e, y - e, z - e), b = sdf(x - e, y - e, z + e), c = sdf(x - e, y + e, z - e), d = sdf(x + e, y + e, z + e);
    const gx = a - b - c + d, gy = -a - b + c + d, gz = -a + b - c + d, l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    return [gx / l, gy / l, gz / l];
  };
}

export function sampleSurface(n, seed = 7) {
  const list = expand(), sdf = makeSdf(list), r = rng(seed);
  const areas = list.map(area), total = areas.reduce((a, b) => a + b, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  const grad = makeGrad(sdf);
  let count = 0, guard = 0;
  while (count < n && guard++ < n * 6) {
    // primitiva elegida en proporción a su área
    let pick = r() * total, i = 0;
    while (i < list.length - 1 && (pick -= areas[i]) > 0) i++;
    let [x, y, z] = seedPoint(list[i], r);
    if (sdf(x, y, z) < -0.012) continue; // enterrado dentro de otra pieza
    let g = [0, 1, 0], d = 0;
    for (let it = 0; it < 3; it++) { d = sdf(x, y, z); g = grad(x, y, z); x -= g[0] * d; y -= g[1] * d; z -= g[2] * d; }
    d = sdf(x, y, z);
    if (Math.abs(d) > 0.004 || y < 0) continue;
    pos[count * 3] = x; pos[count * 3 + 1] = y; pos[count * 3 + 2] = z;
    nor[count * 3] = g[0]; nor[count * 3 + 1] = g[1]; nor[count * 3 + 2] = g[2];
    count++;
  }
  return { positions: pos.subarray(0, count * 3), normals: nor.subarray(0, count * 3), count };
}

/**
 * Puntos alineados en curvas de nivel horizontales (cada `spacing` m): dan a la
 * figura el aspecto de malla de líneas doradas. Se parte de puntos de superficie,
 * se fija su altura a la línea más cercana y se proyectan en horizontal sobre el SDF.
 */
export function sampleContours(n, spacing = 0.026, seed = 11) {
  const sdf = makeSdf(), grad = makeGrad(sdf);
  const cand = sampleSurface(Math.round(n * 1.5), seed);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let count = 0;
  for (let i = 0; i < cand.count && count < n; i++) {
    let x = cand.positions[i * 3], z = cand.positions[i * 3 + 2];
    const y = Math.round(cand.positions[i * 3 + 1] / spacing) * spacing;
    if (y <= 0.004) continue;
    let ok = true, g = [0, 1, 0];
    for (let it = 0; it < 4; it++) {
      const d = sdf(x, y, z); g = grad(x, y, z);
      const h2 = g[0] * g[0] + g[2] * g[2];
      if (h2 < 0.2) { ok = false; break; } // superficie casi horizontal: no hay curva limpia
      x -= (g[0] / h2) * d; z -= (g[2] / h2) * d;
    }
    if (!ok || Math.abs(sdf(x, y, z)) > 0.003) continue;
    pos[count * 3] = x; pos[count * 3 + 1] = y; pos[count * 3 + 2] = z;
    nor[count * 3] = g[0]; nor[count * 3 + 1] = g[1]; nor[count * 3 + 2] = g[2];
    count++;
  }
  return { positions: pos.subarray(0, count * 3), normals: nor.subarray(0, count * 3), count };
}
