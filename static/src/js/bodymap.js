/* ==========================================================================
   Mapa corporal 3D (sección #zonas de la portada) — módulo ES.
   - Sin JS / sin WebGL / prefers-reduced-motion: se queda la versión estática
     (silueta SVG + acordeón) que ya trae el HTML con todo el contenido.
   - Si no: cuando la sección se acerca a la vista se carga Three.js (versión
     fijada, URL en data-three) y se monta una escena fijada (sticky): el scroll
     orbita la cámara de zona en zona. El contenido del panel se copia de los
     elementos .bm-zone del HTML (ningún texto vive en este archivo).
   - Figura: maniquí de cuerpo completo (assets/models/figure.glb, malla base
     CC0 de MakeHuman, comprimida con meshopt; ver assets/models/CREDITS.md)
     con material satinado nude-perla. Se carga con GLTFLoader (misma versión
     de Three, resuelto con el import map de la página). Si el modelo o el
     cargador fallan, se usa la figura procedural de bodymap-figure.js como
     nube de puntos dorada (respaldo).
   ========================================================================== */
import { sampleSurface, sampleContours, makeSdf, makeGrad, FIG_Z } from './bodymap-figure.js';

/* ---------- Ajustes: vida del maniquí (solo figura sólida; metros, segundos, grados) ---------- */
const LIFE = {
  breathPeriod: 4.6,  // duración de una respiración completa
  chestDepth: 0.055,  // expansión del pecho hacia delante (fracción de la distancia al eje: ≈ 5 mm)
  bellyDepth: 0.035,  // expansión del abdomen
  backShare: 0.3,     // parte de esa expansión que nota la espalda
  width: 0.016,       // ensanchamiento lateral del torso
  lift: 0.0025,       // subida de hombros; brazos, cuello y cabeza suben en bloque con ellos
  bellyLag: 0.5,      // retraso del abdomen respecto al pecho (radianes)
  swayZ: 0.28, swayZPeriod: 7.8,   // balanceo lateral, rígido y con los pies como eje
  swayX: 0.14, swayXPeriod: 10.7,  // balanceo adelante-atrás
  fadeIn: 2.5,        // entrada gradual del movimiento al aparecer la figura
};
/* Alturas del cuerpo normalizado a 1,74 m [inicio, fin de la transición] (medidas sobre figure.glb) */
const TORSO = {
  axisZ: -0.075,                                   // eje de la columna
  chestUp: [1.0, 1.26], chestDown: [1.32, 1.46],   // pecho: crece y se apaga antes del cuello
  bellyUp: [0.9, 1.04], bellyDown: [1.12, 1.26],   // abdomen
  lift: [1.16, 1.4],                               // a partir de aquí sube en bloque
  armX: 0.185, armY: 1.26, armSlope: 0.7, armSoft: [-0.02, 0.03], // recta que separa el brazo (postura en A) del torso
};
/* Piezas del modelo, según el nombre del nodo. El cuerpo usa --c-nude (ver figureMaterial). */
const PARTS = {
  hair: { color: '#54311f', roughness: 0.5, sheen: 0.35, sheenColor: '#c98a58', clearcoat: 0.22, rim: 0.2 }, // castaño cobrizo satinado
  brows: { color: '#5b3d2f', roughness: 0.75, rim: 0 },
  lashes: { color: '#3a2a24', roughness: 0.75, rim: 0 },
  eyes: { color: '#e9d8cb', roughness: 0.34, clearcoat: 0.3, rim: 0 }, // marfil discreto
};
const LOOK_ZONE = 'mirada'; // única zona que tiñe también cejas y pestañas
const LOOK_AMOUNT = 0.45;   // fuerza de ese tinte (0…1): que sigan oscuras

/* Poses (modelos con esqueleto): zona activa → clip del GLB. Sin entrada, sin clip o sin esqueleto = reposo. */
const POSES = {
  'brazos-axilas': 'pose_brazos',
  manos: 'pose_manos',
  rostro: 'pose_rostro', mirada: 'pose_rostro', labios: 'pose_rostro',
  espalda: 'pose_espalda',
  piernas: 'pose_piernas', pies: 'pose_piernas',
};
const POSE_REST = 'pose_reposo';   // base de las zonas sin pose propia (si el clip no existe, bind pose)
const POSE_LEVEL = ['pose_rostro']; // clips en los que se anula el ladeo y el giro fijo de cuello y cabeza (se conserva el cabeceo)
const POSE_TIME = 1.0;             // duración de la mezcla de cada hueso (s)
/* Retraso (s) con que arranca cada hueso: columna → brazo → mano. Raíz y piernas, siempre a la vez (pies quietos). */
const POSE_DELAY = [[/^clavicle/, 0.04], [/^(neck|head)/, 0.07], [/^upperarm/, 0.08], [/^lowerarm/, 0.14], [/^wrist/, 0.18], [/^finger/, 0.22]];
/* Giro de cabeza de lado a lado sobre el eje vertical, sumado a la pose (grados, segundos). */
const TURN = {
  period: 8,           // ciclo completo: centro → un lado → centro → otro lado → centro
  hold: 1.8,           // pausa en el centro (1 = seno puro; más = más pausa)
  amp: { rostro: 14, mirada: 5, labios: 5, general: 4 }, // amplitud por zona activa ('general' = vista general)
  other: 3,            // resto de zonas
  ease: 1.6,           // rapidez con que cambia la amplitud de una zona a otra (1/s)
  share: { neck01: 0.25, neck03: 0.3, head: 0.45 }, // reparto entre huesos (suma 1)
};
/* Micro-movimiento: [huesos, grados, periodo medio (s), ejes locales]. Cada hueso lleva su fase y su periodo.
   No incluye raíz ni piernas: los pies no se mueven. En móvil se omiten los dedos. */
const MICRO = [
  [/^spine01/, 0.45, 6.4, 'xz'],
  [/^clavicle/, 0.6, 5.2, 'xz'],
  [/^upperarm01/, 0.8, 7.1, 'xz'],
  [/^lowerarm01/, 0.8, 5.9, 'xz'],
  [/^wrist/, 1.3, 4.7, 'xz'],
  [/^finger\d-[12]/, 1.6, 4.1, 'x'],
];
/* Luz y piel: nude cálido y luminoso. La piel parte de --c-nude y se calienta hacia `warm`. */
const SKIN = { warm: '#e29a70', warmth: 0.62, sheen: 0.4, sheenColor: '#ffd9b0', envMap: 0.4 };
const LIGHT = {
  exposure: 1.0,
  sky: 0xfff0e4, ground: 0xf0b595, hemi: 0.95,  // relleno general; el suelo devuelve luz cálida (sombras interiores suaves)
  key: 1.25,                                    // principal (alta): da volumen
  fill: 0.35,                                   // rosado lateral
  low: 0.5,                                     // cálido, frontal y bajo (entrepierna, barbilla, axilas)
  head: 0.45,                                   // acompaña a la cámara: rostro y espalda nunca a oscuras
  rim: 1.3, rim2: 0.7,                          // contraluces dorados
  shadow: 0.1,                                  // opacidad de la sombra del suelo
};

const sec = document.querySelector('[data-bodymap]');
/* Diagnóstico: con ?diag=1 en la dirección se muestra en pantalla qué ha pasado con el 3D. Sin ello no hace nada. */
const DIAG = /[?&]diag=1/.test(location.search);
let diagBox = null;
function diag(msg) {
  if (!DIAG) return;
  if (!diagBox) {
    diagBox = document.createElement('pre');
    diagBox.style.cssText = 'position:fixed;left:8px;right:8px;top:76px;z-index:9999;margin:0;padding:10px;max-height:45vh;overflow:auto;white-space:pre-wrap;font:12px/1.4 monospace;background:#2B2024;color:#fff;border-radius:8px';
    document.body.append(diagBox);
  }
  diagBox.textContent += msg + String.fromCharCode(10);
}
if (DIAG) {
  diag('v4 · ' + navigator.userAgent);
  window.addEventListener('error', (e) => diag('ERROR ' + e.message));
  window.addEventListener('unhandledrejection', (e) => diag('RECHAZO ' + (e.reason && e.reason.message || e.reason)));
}
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
  diag('Reducir movimiento: ' + (mq.matches ? 'ACTIVADO' : 'no') + ' · WebGL: ' + (DIAG ? (webglOk() ? 'sí' : 'NO') : ''));
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
    try { THREE = await import(sec.dataset.three); } catch (e) { diag('Librería 3D: FALLO ' + e.message); return; } // sin red / CDN: versión estática
    diag('Librería 3D: cargada');
    if (mq.matches) return;
    // Cargador glTF + decodificador meshopt + entorno de estudio (en paralelo con el montaje)
    const ds = sec.dataset;
    const mods = ds.model && ds.gltf
      ? Promise.all([import(ds.gltf), ds.meshopt ? import(ds.meshopt) : null, ds.roomenv ? import(ds.roomenv).catch(() => null) : null]).catch((e) => { diag('Cargadores: FALLO ' + e.message); return null; })
      : Promise.resolve(null);
    try { app = await createApp(THREE, sec, zoneEls, mods); } catch (e) { app = null; diag('Escena: FALLO ' + e.message + ' ' + (e.stack || '').slice(0, 300)); }
  }
  // iOS puede cortar el WebGL (memoria, cambio de app): se vuelve a montar al verse la página, como mucho 2 veces
  let retries = 0;
  sec.addEventListener('bm:lost', () => {
    app = null;
    if (retries++ >= 2) return;
    const again = () => {
      if (document.hidden || mq.matches) return;
      document.removeEventListener('visibilitychange', again);
      diag('Reintento ' + retries); load();
    };
    document.addEventListener('visibilitychange', again);
    setTimeout(again, 1200);
  });
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
  float f = uFocusAmt * (1.0 - smoothstep(0.02, 0.13, distance(wp.xyz, uFocus)));
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

/* ---------- Respiración ----------
   Campo de desplazamiento en función de la posición en reposo. Lo comparten todas las
   piezas (cuerpo, pelo, cejas…), así que nada se separa; de cuello para arriba y en los
   brazos es una traslación pura (no deforma). breathe() es su gemelo en JS (anclas). */
const gf = (n) => { const s = String(n); return /[.e]/.test(s) ? s : s + '.0'; };
const gs = (p, v) => `smoothstep(${gf(p[0])}, ${gf(p[1])}, ${v})`;
const BREATH_GLSL = `
uniform vec2 uBreath;
vec3 bmBreath(vec3 p) {
  float arm = ${gs(TORSO.armSoft, `abs(p.x) - (${gf(TORSO.armX)} + max(0.0, ${gf(TORSO.armY)} - p.y) * ${gf(TORSO.armSlope)})`)};
  float chest = ${gs(TORSO.chestUp, 'p.y')} * (1.0 - ${gs(TORSO.chestDown, 'p.y')}) * uBreath.x;
  float belly = ${gs(TORSO.bellyUp, 'p.y')} * (1.0 - ${gs(TORSO.bellyDown, 'p.y')}) * uBreath.y;
  float up = 1.0 - (1.0 - ${gs(TORSO.lift, 'p.y')}) * (1.0 - arm);
  float z = p.z - (${gf(TORSO.axisZ)});
  float share = mix(${gf(LIFE.backShare)}, 1.0, smoothstep(-0.04, 0.04, z));
  return vec3(p.x * ${gf(LIFE.width)} * (chest + belly * 0.5) * (1.0 - arm),
    ${gf(LIFE.lift)} * up * uBreath.x,
    z * share * (chest * ${gf(LIFE.chestDepth)} + belly * ${gf(LIFE.bellyDepth)}) * (1.0 - arm));
}
`;
function breathe(p, b, out) {
  const [x, y, z0] = p, st = (r, v) => smooth(r[0], r[1], v);
  const arm = st(TORSO.armSoft, Math.abs(x) - (TORSO.armX + Math.max(0, TORSO.armY - y) * TORSO.armSlope));
  const chest = st(TORSO.chestUp, y) * (1 - st(TORSO.chestDown, y)) * b.x;
  const belly = st(TORSO.bellyUp, y) * (1 - st(TORSO.bellyDown, y)) * b.y;
  const up = 1 - (1 - st(TORSO.lift, y)) * (1 - arm);
  const z = z0 - TORSO.axisZ, share = lerp(LIFE.backShare, 1, smooth(-0.04, 0.04, z));
  return out.set(x + x * LIFE.width * (chest + belly * 0.5) * (1 - arm), y + LIFE.lift * up * b.x,
    z0 + z * share * (chest * LIFE.chestDepth + belly * LIFE.bellyDepth) * (1 - arm));
}
/** Curva 0…1: inspira algo más rápido de lo que espira. */
const breathCurve = (ph) => 0.5 - 0.5 * Math.cos(ph + 0.35 * Math.sin(ph));

/** Pieza del modelo según el nombre del nodo (o de sus padres) o del material; '' si no se reconoce. */
function partOf(o, mat) {
  const test = (n) => (/brow|ceja/i.test(n) ? 'brows' : /lash|pesta/i.test(n) ? 'lashes' : /hair|pelo/i.test(n) ? 'hair'
    : /teeth|tongue|dientes|lengua/i.test(n) ? 'drop' : /eye|ojo/i.test(n) ? 'eyes' : /body|cuerpo/i.test(n) ? 'body' : '');
  for (let n = o; n; n = n.parent) { const k = test(n.name || ''); if (k) return k; }
  return test((mat && mat.name) || '');
}

/* Material del maniquí: satinado nude-perla + borde dorado (fresnel), tinte
   coral-dorado en la zona activa y aparición de pies a cabeza con filo dorado. */
function figureMaterial(THREE, col, U, fineNormals) {
  const pearl = new THREE.Color(col('--c-nude', '#F1DDD0')).lerp(new THREE.Color(SKIN.warm), SKIN.warmth);
  const m = new THREE.MeshPhysicalMaterial({
    color: pearl, roughness: 0.46, metalness: 0,
    sheen: SKIN.sheen, sheenRoughness: 0.45, sheenColor: new THREE.Color(SKIN.sheenColor),
    clearcoat: 0.2, clearcoatRoughness: 0.5, envMapIntensity: SKIN.envMap,
  });
  return patchMaterial(m, U, fineNormals, false);
}

/** Material de pelo, cejas, pestañas u ojos. `src`: material original (se conserva su recorte alfa). */
function partMaterial(THREE, kind, src, U) {
  const c = PARTS[kind], cut = !!(src && src.map && (src.transparent || src.alphaTest > 0));
  const m = new THREE.MeshPhysicalMaterial({
    color: c.color, roughness: c.roughness, metalness: 0, envMapIntensity: 0.45,
    sheen: c.sheen || 0, sheenRoughness: 0.45, sheenColor: new THREE.Color(c.sheenColor || '#000'),
    clearcoat: c.clearcoat || 0, clearcoatRoughness: 0.45, side: THREE.DoubleSide,
  });
  if (cut) { m.map = src.map; m.alphaTest = 0.35; }
  if (kind === 'brows' || kind === 'lashes') { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2; } // casi pegadas a la piel
  return patchMaterial(m, Object.assign({}, U, { uRimAmt: { value: c.rim } }), false, cut);
}

/* Todo se evalúa en la posición de reposo (uRestM: geometría → cuerpo en reposo, sin pose ni balanceo):
   la respiración se suma antes del skinning, y el tinte y la aparición no resbalan sobre la piel. */
function patchMaterial(m, U, fineNormals, alphaOnly) {
  m.customProgramCacheKey = () => 'bm' + (fineNormals ? 1 : 0) + (alphaOnly ? 1 : 0);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec3 vBmW;\nuniform mat4 uRestM;\nuniform mat3 uRestInv;\n' + BREATH_GLSL + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      vBmW = (uRestM * vec4(position, 1.0)).xyz;
      vec3 bmD = bmBreath(vBmW);` + (fineNormals ? `
      vec3 bmN = normalize(mat3(uRestM) * objectNormal);
      const float bmE = 0.01;
      bmN -= vec3(dot(bmBreath(vBmW + vec3(bmE, 0.0, 0.0)) - bmD, bmN), dot(bmBreath(vBmW + vec3(0.0, bmE, 0.0)) - bmD, bmN), dot(bmBreath(vBmW + vec3(0.0, 0.0, bmE)) - bmD, bmN)) / bmE;
      objectNormal = normalize(uRestInv * bmN);` : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += uRestInv * bmD;');
    if (alphaOnly) sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = diffuse;'); // del mapa solo vale el recorte
    sh.fragmentShader = 'varying vec3 vBmW;\nuniform vec3 uFocus, uAccent, uRim;\nuniform float uFocusAmt, uFocusR, uReveal, uRimAmt;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vBmW.y > uReveal) discard;
        float bmEdge = 1.0 - smoothstep(0.0, 0.04, uReveal - vBmW.y);
        float bmF = uFocusAmt * (1.0 - smoothstep(uFocusR * 0.2, uFocusR, distance(vBmW, uFocus)));
        diffuseColor.rgb = mix(diffuseColor.rgb, uAccent, bmF * 0.3);`)
      // Pelvis sin sombra marcada (maniquí liso): la luz la trata como una superficie plana hacia el frente
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 bmQ = (vBmW - vec3(0.0, 0.82, 0.0)) / vec3(0.15, 0.17, 1.0);
        float bmPelvis = (1.0 - smoothstep(0.35, 1.0, length(bmQ.xy))) * smoothstep(-0.15, -0.09, vBmW.z);
        vec3 bmFront = normalize((viewMatrix * vec4(0.0, 0.1, 1.0, 0.0)).xyz);
        normal = normalize(mix(normal, bmFront, bmPelvis * 0.97 * smoothstep(0.0, 0.5, bmFront.z)));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uAccent * bmF * 0.09 + uRim * bmEdge * 1.6;`)
      .replace('#include <opaque_fragment>', `float bmNdv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        outgoingLight += uRim * pow(1.0 - bmNdv, 3.0) * uRimAmt * (0.7 + 0.3 * (1.0 - bmF));
        #include <opaque_fragment>`);
  };
  return m;
}

/** Geometría → mundo con el esqueleto en reposo (en una malla con skin, su propio nodo no cuenta). Llamar antes de posar. */
function restMatrix(THREE, o) {
  if (!o.isSkinnedMesh) return o.matrixWorld.clone();
  return new THREE.Matrix4().multiplyMatrices(o.skeleton.bones[0].matrixWorld, o.skeleton.boneInverses[0]).multiply(o.bindMatrix);
}

/**
 * Poses (último fotograma de cada clip), giro de cabeza y micro-movimiento.
 * `base` = pose mezclada; encima, cada fotograma, se suma la vida (no altera la base ni la cámara).
 */
function makeRig(THREE, root, pivot, clips, mobile) {
  const nodes = new Map(), poses = { '': new Map() };
  const load = (name) => {
    const clip = clips.find((c) => c.name === name), pose = new Map();
    if (!clip) return null;
    for (const tr of clip.tracks) {
      const d = tr.name.lastIndexOf('.'), prop = tr.name.slice(d + 1), o = root.getObjectByName(tr.name.slice(0, d));
      if (!o || !(prop === 'quaternion' || prop === 'position' || prop === 'scale')) continue;
      const v = o[prop].clone().fromArray(tr.createInterpolant().evaluate(tr.times[tr.times.length - 1]));
      const key = o.uuid + prop, dl = POSE_DELAY.find(([re]) => re.test(o.name));
      if (!nodes.has(key)) nodes.set(key, { o, val: o[prop], rest: o[prop].clone(), from: o[prop].clone(), base: o[prop].clone(), q: prop === 'quaternion', delay: dl ? dl[1] : 0 });
      pose.set(key, v);
    }
    return pose;
  };
  for (const name of new Set(Object.values(POSES))) { const p = load(name); if (p) poses[name] = p; }
  poses[''] = load(POSE_REST) || poses[''];
  if (!nodes.size) return null;
  const maxDelay = Math.max(...[...nodes.values()].map((n) => n.delay));
  const bone = (n) => root.getObjectByName(n) || null;
  const chain = Object.keys(TURN.share).map(bone);
  const turnOk = chain.every((b) => b && nodes.has(b.uuid + 'quaternion'));

  // Cuello y cabeza a nivel en las poses indicadas: orientación en el mundo respecto al reposo, solo con cabeceo
  const qw = (o, get, out) => { out.identity(); for (let n = o; n && n !== pivot; n = n.parent) out.premultiply(get(n)); return out; };
  if (turnOk) {
    const A = new THREE.Quaternion(), B = new THREE.Quaternion(), P = new THREE.Quaternion(), e = new THREE.Euler();
    const restQ = (n) => { const k = nodes.get(n.uuid + 'quaternion'); return k ? k.rest : n.quaternion; };
    for (const name of POSE_LEVEL) {
      const pose = poses[name];
      if (!pose) continue;
      const poseQ = (n) => pose.get(n.uuid + 'quaternion') || restQ(n);
      const want = chain.map((b) => { // se calcula todo antes de corregir: cada hueso depende de su padre
        const restW = qw(b, restQ, A), d = qw(b, poseQ, B).clone().multiply(restW.clone().invert());
        e.setFromQuaternion(d, 'YXZ'); e.y = 0; e.z = 0;
        return new THREE.Quaternion().setFromEuler(e).multiply(restW);
      });
      chain.forEach((b, i) => pose.set(b.uuid + 'quaternion', qw(b.parent, poseQ, P).clone().invert().multiply(want[i])));
    }
  }

  // Huesos con micro-movimiento
  const micro = [], seen = new Set();
  nodes.forEach((n) => {
    if (!n.q || seen.has(n.o)) return;
    const def = MICRO.find(([re]) => re.test(n.o.name));
    if (!def || (mobile && /^finger/.test(n.o.name))) return;
    seen.add(n.o);
    const i = micro.length, w = (k) => (Math.PI * 2) / (def[2] * (0.84 + 0.32 * ((i * 0.618 + k) % 1)));
    micro.push({ q: n.o.quaternion, a: (def[1] * Math.PI) / 360, wx: w(0), wz: w(0.37), px: i * 2.4, pz: i * 1.7 + 1, z: def[3].includes('z') });
  });

  // Pies: durante la mezcla, la raíz compensa lo que se desplazaría su punto medio
  const feet = [bone('foot_L'), bone('foot_R')], hip = bone('root'), hipN = hip && nodes.get(hip.uuid + 'position');
  const lockFeet = !!(feet[0] && feet[1] && hipN && hip.parent);
  const f0 = new THREE.Vector3(), f1 = new THREE.Vector3(), fv = new THREE.Vector3(), fw = new THREE.Vector3(), inv = new THREE.Matrix4();
  const feetMid = (out) => { out.setFromMatrixPosition(feet[0].matrixWorld); return out.add(fw.setFromMatrixPosition(feet[1].matrixWorld)).multiplyScalar(0.5); };
  const place = (get) => { nodes.forEach((n, key) => n.val.copy(get(n, key))); pivot.updateMatrixWorld(true); };
  const goal = (n, key) => poses[cur].get(key) || n.rest;

  const ease = (x) => x * x * (x * (x * (x * 3 - 7.5) + 4) + 1.5); // arranque y frenado suaves
  let cur = '', t = POSE_TIME + maxDelay, turn = 0, first = true;
  nodes.forEach((n, key) => n.base.copy(goal(n, key)));
  const q = new THREE.Quaternion(), p = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), liveQ = (n) => n.quaternion;
  return {
    /** Mezcla la pose de la zona. Devuelve true si la base ha cambiado (los huesos quedan en la base, sin vida; pivot sin balanceo). */
    blend(dt, want) {
      const name = poses[want] ? want : '';
      if (name !== cur) {
        cur = name; t = 0;
        nodes.forEach((n) => n.from.copy(n.base));
        if (lockFeet) { place((n) => n.from); feetMid(f0); place(goal); feetMid(f1); }
      } else if (t >= POSE_TIME + maxDelay) {
        if (!first) return false;
        first = false; place((n) => n.base);
        return true;
      }
      first = false;
      t += dt;
      nodes.forEach((n, key) => {
        const k = ease(clamp((t - n.delay) / POSE_TIME, 0, 1));
        if (n.q) n.base.slerpQuaternions(n.from, goal(n, key), k); else n.base.lerpVectors(n.from, goal(n, key), k);
      });
      place((n) => n.base);
      if (lockFeet) {
        feetMid(fv); fw.copy(f0).lerp(f1, ease(clamp(t / POSE_TIME, 0, 1)));
        fv.subVectors(fw, fv); // desvío en el mundo → espacio del padre de la raíz
        const s = inv.copy(hip.parent.matrixWorld).invert().elements, x = fv.x, y = fv.y, z = fv.z;
        hipN.base.x += s[0] * x + s[4] * y + s[8] * z; hipN.base.y += s[1] * x + s[5] * y + s[9] * z; hipN.base.z += s[2] * x + s[6] * y + s[10] * z;
        hipN.val.copy(hipN.base); pivot.updateMatrixWorld(true);
      }
      return true;
    },
    /** Suma micro-movimiento y giro de cabeza a la base. */
    live(dt, id, time, amp) {
      nodes.forEach((n) => n.val.copy(n.base));
      for (const m of micro) {
        const x = Math.sin(time * m.wx + m.px) * m.a * amp, z = m.z ? Math.sin(time * m.wz + m.pz) * m.a * amp : 0;
        m.q.multiply(q.set(x, 0, z, 1).normalize());
      }
      if (!turnOk) return;
      const want = id in TURN.amp ? TURN.amp[id] : TURN.other;
      turn += (want - turn) * (1 - Math.exp(-dt * TURN.ease));
      const s = Math.sin((time / TURN.period) * Math.PI * 2);
      const yaw = Math.sign(s) * Math.pow(Math.abs(s), TURN.hold) * turn * amp * (Math.PI / 180);
      chain.forEach((b) => { // giro sobre el eje vertical del cuerpo, llevado al espacio del padre de cada hueso
        qw(b.parent, liveQ, p);
        b.quaternion.premultiply(q.setFromAxisAngle(Y, yaw * TURN.share[b.name]).multiply(p).premultiply(p.invert()));
      });
    },
  };
}

/** Sombra de contacto: degradado radial en un plano (sin coste de sombras reales). */
function contactShadow(THREE) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(70,45,30,0.42)'); grd.addColorStop(0.45, 'rgba(70,45,30,0.16)'); grd.addColorStop(1, 'rgba(70,45,30,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.6), m);
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.001; mesh.renderOrder = -1;
  return { mesh, dispose() { tex.dispose(); m.dispose(); mesh.geometry.dispose(); } };
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function createApp(THREE, sec, zoneEls, modsP) {
  const mobile = window.matchMedia('(max-width: 47.99em), (pointer: coarse)').matches;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const css = getComputedStyle(document.documentElement);
  const col = (n, d) => css.getPropertyValue(n).trim() || d;
  const ds = sec.dataset;

  let sdf = null, grad = null; // SDF de la figura procedural (solo en el respaldo o para normales iniciales)
  const procNormal = (a) => { if (!grad) { sdf = makeSdf(); grad = makeGrad(sdf); } return grad(a[0], a[1], a[2] - FIG_Z); };
  const zones = zoneEls.map((li) => {
    const v = (li.dataset.view || '0,5,1.5').split(',').map(Number);
    const a = (li.dataset.anchor || '0,0.95,0').split(',').map(Number);
    const t = li.querySelector('.bm-zone__title');
    const zoom = v[2] || 1.5;
    return { id: li.dataset.zone, li, label: t ? t.textContent.trim() : '', body: li.querySelector('.bm-zone__body'), az: v[0] || 0, el: v[1] || 0, zoom: zoom * (mobile ? 0.72 : 1), // en móvil, algo más lejos (pantalla estrecha)
      anchor: a, normal: [0, 0, 1], radius: clamp(0.5 / zoom, 0.07, 0.3) };
  });
  const steps = [{ overview: true, label: ds.overview || '', az: -22, el: 6, zoom: mobile ? 0.74 : 0.9, anchor: [0, 0.88, -0.05], radius: 0.3 }].concat(zones);
  const N = steps.length;

  /* ---------- DOM de la escena ---------- */
  const track = el('div', 'bm__track');
  track.style.setProperty('--bm-steps', N);
  const stage = el('div', 'bm__stage', { 'aria-busy': 'true' });
  const canvas = el('canvas', 'bm__canvas', { 'aria-hidden': 'true' });
  const loader = el('div', 'bm__loader', { 'aria-hidden': 'true' });
  loader.append(el('span', 'bm__loader-ring'), el('span', 'bm__loader-glow'));
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
  stage.append(canvas, loader, hotLayer, panel, nav, hint);
  track.append(stage);

  /* ---------- Three.js: render de estudio ---------- */
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !mobile, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LIGHT.exposure;
  const shadows = !mobile;
  if (shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.03, 30);
  const D0 = mobile ? 4.4 : 3.4;
  const gold = new THREE.Color(col('--c-gold', '#C9A24B'));
  const coral = new THREE.Color(col('--c-coral', '#F07C6C'));
  const common = { uTime: { value: 0 }, uScale: { value: 800 }, uPR: { value: 1 }, uGold: { value: gold } };
  const disposables = [];

  // Luces: principal cálida (con sombra suave en escritorio), relleno rosado y contraluz dorado
  scene.add(new THREE.HemisphereLight(LIGHT.sky, LIGHT.ground, LIGHT.hemi));
  const key = new THREE.DirectionalLight(0xffeedd, LIGHT.key);
  key.position.set(1.2, 5, 2); // alta: sombra corta y suave
  if (shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5, near: 1, far: 10 });
    key.shadow.radius = 6; key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02;
  }
  key.target.position.set(0, 0.9, 0);
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xffd6cc, LIGHT.fill); fill.position.set(-2.4, 1.2, 1.6); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffd9a0, LIGHT.rim); rim.position.set(-0.8, 2.4, -2.6); scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xffe7c4, LIGHT.rim2); rim2.position.set(1.8, 1.6, -2.2); scene.add(rim2);
  const low = new THREE.DirectionalLight(0xffd2b4, LIGHT.low); low.position.set(0.3, -1.1, 2.6); scene.add(low);
  const head = new THREE.DirectionalLight(0xffe6d4, LIGHT.head); scene.add(head); // se coloca en la cámara en cada fotograma

  // Suelo: sombra real (escritorio) + sombra de contacto difusa (siempre)
  const cs = contactShadow(THREE); scene.add(cs.mesh); disposables.push(cs);
  let ground = null;
  if (shadows) {
    ground = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.ShadowMaterial({ opacity: LIGHT.shadow, color: 0x5a3a28 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    disposables.push(ground.geometry, ground.material);
  }

  // Polvo dorado ascendente + anillos de pedestal
  const nDust = mobile ? 110 : 240, nRing = mobile ? 220 : 440;
  const dn = nDust + nRing * 2;
  const dPos = new Float32Array(dn * 3), dRnd = new Float32Array(dn), dDrift = new Float32Array(dn);
  for (let i = 0; i < dn; i++) {
    const r = Math.random(); dRnd[i] = r;
    if (i < nDust) {
      const rad = 0.4 + Math.random() * 0.7, th = Math.random() * Math.PI * 2;
      dPos.set([Math.cos(th) * rad, Math.random() * 2.1, Math.sin(th) * rad], i * 3); dDrift[i] = 1;
    } else {
      const ring = i < nDust + nRing ? 0.42 : 0.54, th = Math.random() * Math.PI * 2, j = (Math.random() - 0.5) * 0.006;
      dPos.set([Math.cos(th) * (ring + j), 0.003, Math.sin(th) * (ring + j)], i * 3);
    }
  }
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  g2.setAttribute('aRand', new THREE.BufferAttribute(dRnd, 1));
  g2.setAttribute('aDrift', new THREE.BufferAttribute(dDrift, 1));
  const m2 = new THREE.ShaderMaterial({ uniforms: common, vertexShader: DECO_VS, fragmentShader: DOT_FS, transparent: true, depthWrite: false });
  scene.add(new THREE.Points(g2, m2));
  disposables.push(g2, m2);

  // Uniformes compartidos de la figura (malla o respaldo de puntos)
  const FU = {
    uFocus: { value: new THREE.Vector3(0, 1, 0) }, uFocusAmt: { value: 0 }, uFocusR: { value: 0.3 },
    uAccent: { value: coral.clone().lerp(gold, 0.35) }, uRim: { value: new THREE.Color('#e9c27a') },
    uRimAmt: { value: 0.55 }, uReveal: { value: -0.05 }, uBreath: { value: new THREE.Vector2(0, 0) },
  };
  const uLook = { value: 0 };                                // tinte de cejas y pestañas
  zones.forEach((z) => { z.k = new THREE.Matrix4(); z.pn = z.normal; }); // k: reposo → figura posada y balanceada (en su ancla)
  let life = 0;                                              // 0 → 1: entrada gradual del movimiento
  let figure = null;   // { kind: 'mesh' | 'points', obj }
  let revealT0 = -1;   // instante (ms) en que empieza la aparición

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

  const sway = new THREE.Euler(), m4 = new THREE.Matrix4(), m4b = new THREE.Matrix4(), vn = new THREE.Vector3();
  /** Respiración, balanceo y pose de este fotograma; deja en cada zona la matriz de su ancla. */
  function animateFigure(dt, id) {
    life = Math.min(1, life + dt / LIFE.fadeIn);
    const amp = smooth(0, 1, life), ph = (time / LIFE.breathPeriod) * Math.PI * 2, rad = (amp * Math.PI) / 180;
    FU.uBreath.value.set(breathCurve(ph) * amp, breathCurve(ph - LIFE.bellyLag) * amp);
    figure.obj.rotation.set(Math.sin((time / LIFE.swayXPeriod) * Math.PI * 2) * LIFE.swayX * rad, 0, Math.sin((time / LIFE.swayZPeriod) * Math.PI * 2) * LIFE.swayZ * rad);
    if (figure.rig) {
      sway.copy(figure.obj.rotation); figure.obj.rotation.set(0, 0, 0);
      if (figure.rig.blend(dt, POSES[id] || '')) { // solo mientras cambia la pose: objetivo de cámara sin giro, vida ni balanceo
        for (const z of zones) { figure.anchorMatrix(z, m4, m4b); z.cam = (z.cam || new THREE.Vector3()).fromArray(z.anchor).applyMatrix4(z.k); }
      }
      figure.obj.rotation.copy(sway);
      figure.rig.live(dt, id || 'general', time, amp);
    }
    figure.obj.updateMatrixWorld(true);
    for (const z of zones) {
      figure.anchorMatrix(z, m4, m4b);
      vn.fromArray(z.normal).transformDirection(z.k); z.pn = [vn.x, vn.y, vn.z];
    }
  }
  /** Ancla posada, sin respiración ni balanceo (objetivo de cámara: así el movimiento se sigue viendo). */
  function camAnchor(s, out) {
    return s.cam ? out.copy(s.cam) : out.fromArray(s.anchor);
  }
  const ca = new THREE.Vector3(), cb = new THREE.Vector3();

  function frame(now) {
    raf = 0;
    if (!running) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now; time += dt;
    const s = progress() * (N - 1);
    const i0 = Math.min(Math.floor(s), N - 1), i1 = Math.min(i0 + 1, N - 1), f = s - i0, fe = smooth(0.2, 0.8, f);
    const A = steps[i0], B = steps[i1], act = f < 0.5 ? i0 : i1;
    if (act !== active) setActive(act);
    const z = steps[act];
    if (figure && figure.kind === 'mesh') animateFigure(dt, z.id);
    camAnchor(A, ca); camAnchor(B, cb);
    let az = lerp(A.az, B.az, fe), elv = lerp(A.el, B.el, fe);
    // Al orbitar mucho, la cámara se aleja a mitad de camino (no atraviesa la figura)
    const pull = Math.sin(Math.PI * fe) * Math.min(1, Math.abs(B.az - A.az) / 120) * 0.55;
    const ld = lerp(Math.log(D0 / A.zoom), Math.log(D0 / B.zoom), fe) + Math.log(1 + pull);
    const tx = lerp(ca.x, cb.x, fe), ty = lerp(ca.y, cb.y, fe), tz = lerp(ca.z, cb.z, fe);
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
    head.position.copy(camera.position).sub(tgt);

    focus.set(z.anchor[0], z.anchor[1], z.anchor[2]);
    const fk = cur.fa === 0 ? 1 : Math.min(1, dt * 6);
    FU.uFocus.value.lerp(focus, fk); // en reposo: el material también lo evalúa en reposo
    FU.uFocusR.value += (z.radius - FU.uFocusR.value) * fk;
    cur.fa += ((act > 0 ? 1 : 0) - cur.fa) * Math.min(1, dt * 3);
    FU.uFocusAmt.value = cur.fa;
    uLook.value += ((z.id === LOOK_ZONE ? LOOK_AMOUNT : 0) - uLook.value) * Math.min(1, dt * 3);
    common.uTime.value = time;
    if (revealT0 >= 0 && FU.uReveal.value < 1.9) {
      if (!revealT0) revealT0 = now;
      FU.uReveal.value = lerp(-0.05, 1.9, smooth(0, 1, (now - revealT0) / 1900));
      if (FU.uReveal.value >= 1.9 && figure && figure.kind === 'mesh' && shadows) figure.casters.forEach((o) => { o.castShadow = true; });
    }
    hint.classList.toggle('is-hidden', s > 0.35);

    renderer.render(scene, camera);
    placeHotspots();
    if (running && !raf) raf = requestAnimationFrame(frame);
  }

  function placeHotspots() {
    camera.updateMatrixWorld();
    const ready = !!figure;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i], h = hots[i];
      v3.set(z.anchor[0], z.anchor[1], z.anchor[2]);
      if (ready && figure.kind === 'mesh') breathe(z.anchor, FU.uBreath.value, v3).applyMatrix4(z.k); // el punto va pegado a la piel
      const cx = camera.position.x - v3.x, cy = camera.position.y - v3.y, cz = camera.position.z - v3.z;
      const cl = Math.hypot(cx, cy, cz) || 1;
      const facing = (z.pn[0] * cx + z.pn[1] * cy + z.pn[2] * cz) / cl;
      v3.project(camera);
      const x = (v3.x * 0.5 + 0.5) * M.w, y = (-v3.y * 0.5 + 0.5) * M.wh;
      const vis = ready && facing > (i + 1 === active ? -0.2 : 0.25) && v3.z < 1 && x > 16 && x < M.w - 16 && y > 16 && y < Math.min(M.wh, M.panelTop) - 16;
      if (vis !== h.vis) { h.vis = vis; h.b.hidden = !vis; }
      if (vis && (Math.abs(x - h.x) > 0.3 || Math.abs(y - h.y) > 0.3)) {
        h.x = x; h.y = y; h.b.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      }
    }
  }

  /* ---------- Bucle: solo con la escena en vista y la pestaña visible ---------- */
  let raf = 0, running = false, inView = false, dead = false;
  function update() {
    const should = inView && !document.hidden && !dead;
    if (should && !running) { running = true; last = 0; raf = requestAnimationFrame(frame); }
    else if (!should && running) { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  }
  const vio = new IntersectionObserver((es) => { inView = es[es.length - 1].isIntersecting; update(); }, { rootMargin: '0px' });
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
  const onLost = (e) => { e.preventDefault(); destroy(); sec.dispatchEvent(new Event('bm:lost')); };
  canvas.addEventListener('webglcontextlost', () => diag('WebGL: contexto perdido'));
  canvas.addEventListener('webglcontextlost', onLost);

  resize();
  setActive(0);

  /* ---------- Figura: modelo glTF (o respaldo procedural) ---------- */
  async function loadModel() {
    const mods = await modsP;
    if (!mods || !mods[0]) throw new Error('sin cargador');
    const [{ GLTFLoader }, mo, re] = mods;
    if (re && re.RoomEnvironment) { // reflejos suaves de estudio
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new re.RoomEnvironment(renderer);
      const env = pmrem.fromScene(envScene, 0.04).texture;
      scene.environment = env; disposables.push(env, pmrem);
      envScene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    }
    const gl = new GLTFLoader();
    if (mo && mo.MeshoptDecoder) gl.setMeshoptDecoder(mo.MeshoptDecoder);
    const gltf = await withTimeout(gl.loadAsync(ds.model), 20000);
    if (dead) throw new Error('destruida');
    const root = gltf.scene;
    // Sirve cualquier figura humana de pie (Y arriba, mirando a +Z), de una sola malla o con nodos
    // body, hair, brows, lashes y eyes. Lo no reconocido se trata como cuerpo. Se descartan dientes,
    // lengua y piezas transparentes sin textura de recorte (quedarían como placas opacas).
    const meshes = [], drop = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const om = Array.isArray(o.material) ? o.material[0] : o.material, kind = partOf(o, om);
      const see = !!om && (om.transparent || om.alphaTest > 0), known = kind === 'body' || kind === 'eyes';
      if (kind === 'drop' || (see && !known && !(PARTS[kind] && om.map))) drop.push(o);
      else meshes.push({ o, om, kind: PARTS[kind] ? kind : 'body' });
    });
    const bodies = meshes.filter((m) => m.kind === 'body');
    if (!bodies.length) throw new Error('modelo vacío');
    const mesh = bodies.reduce((m, p) => (p.o.geometry.attributes.position.count > m.geometry.attributes.position.count ? p.o : m), bodies[0].o); // la malla mayor = cuerpo
    drop.forEach((o) => { o.geometry.dispose(); while (o.children.length) o.parent.attach(o.children[0]); o.removeFromParent(); });
    // Normaliza: pies en y = 0, centrado en x/z, 1,74 de alto (coincide con las anclas de bodymap.json)
    root.updateMatrixWorld(true);
    // Solo cuenta el cuerpo: el volumen del pelo no debe cambiar la escala ni descentrar las anclas
    const box = new THREE.Box3();
    bodies.forEach(({ o }) => { o.geometry.computeBoundingBox(); box.union(new THREE.Box3().copy(o.geometry.boundingBox).applyMatrix4(restMatrix(THREE, o))); });
    const size = box.getSize(new THREE.Vector3());
    const s = 1.74 / (size.y || 1);
    const pivot = new THREE.Group();
    root.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    pivot.scale.setScalar(s); pivot.add(root);
    pivot.updateMatrixWorld(true);
    const skeletons = new Set();
    meshes.forEach(({ o, om, kind }) => { // un material por malla (comparten programa): cada una lleva su matriz de reposo
      const old = Array.isArray(o.material) ? o.material : [o.material];
      const rest = restMatrix(THREE, o);
      const U = Object.assign({}, FU, { uRestM: { value: rest }, uRestInv: { value: new THREE.Matrix3().setFromMatrix4(rest).invert() } });
      if (kind === 'body') o.material = figureMaterial(THREE, col, U, !mobile); // en móvil sin recálculo de normales
      else o.material = partMaterial(THREE, kind, om, Object.assign(U, { uFocusAmt: kind === 'brows' || kind === 'lashes' ? uLook : { value: 0 } }));
      if (kind === 'hair' && o.geometry.attributes.color) o.material.vertexColors = true; // AO horneado solo en el pelo: en el cuerpo apagaba la piel
      if (o.material.map) disposables.push(o.material.map);
      old.forEach((x) => x && x.dispose());
      disposables.push(o.geometry, o.material);
      if (o.isSkinnedMesh) { skeletons.add(o.skeleton); o.frustumCulled = false; } // la caja en reposo no cubre las poses
      o.castShadow = false; o.receiveShadow = false;
    });
    skeletons.forEach((k) => disposables.push(k));
    // Normal de la superficie más cercana a cada ancla (visibilidad de los puntos)
    const pa = mesh.geometry.attributes.position, na = mesh.geometry.attributes.normal;
    const w = new THREE.Vector3(), rest = restMatrix(THREE, mesh), nm = new THREE.Matrix3().getNormalMatrix(rest), nv = new THREE.Vector3();
    const best = zones.map(() => ({ d: 1e9, i: -1 }));
    for (let i = 0; i < pa.count; i++) {
      w.fromBufferAttribute(pa, i).applyMatrix4(rest);
      for (let j = 0; j < zones.length; j++) {
        const a = zones[j].anchor, d = (w.x - a[0]) ** 2 + (w.y - a[1]) ** 2 + (w.z - a[2]) ** 2;
        if (d < best[j].d) { best[j].d = d; best[j].i = i; }
      }
    }
    zones.forEach((z, j) => { if (na && best[j].i >= 0) { nv.fromBufferAttribute(na, best[j].i).applyMatrix3(nm).normalize(); z.normal = [nv.x, nv.y, nv.z]; } });
    // Huesos (y pesos) del vértice de cada ancla: el punto sigue a la piel posada
    const restInv = rest.clone().invert(), bind = [];
    if (mesh.isSkinnedMesh) {
      const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
      zones.forEach((z, j) => {
        const L = [], c = ['getX', 'getY', 'getZ', 'getW'];
        c.forEach((g) => { const wt = sw[g](best[j].i); if (wt > 0) L.push([si[g](best[j].i), wt]); });
        const sum = L.reduce((a, l) => a + l[1], 0) || 1;
        bind[j] = L.map(([i, wt]) => [mesh.skeleton.bones[i], mesh.skeleton.boneInverses[i], wt / sum]);
      });
    }
    function anchorMatrix(z, a, b) {
      const L = bind[zones.indexOf(z)], e = z.k.elements;
      if (!L || !L.length) { z.k.multiplyMatrices(mesh.matrixWorld, restInv); return; }
      e.fill(0);
      for (const [bone, inv, wt] of L) {
        a.multiplyMatrices(bone.matrixWorld, inv);
        for (let i = 0; i < 16; i++) e[i] += a.elements[i] * wt;
      }
      z.k.multiply(b.multiplyMatrices(mesh.bindMatrix, restInv));
    }
    scene.add(pivot);
    return { kind: 'mesh', obj: pivot, mesh, anchorMatrix, rig: skeletons.size ? makeRig(THREE, root, pivot, gltf.animations || [], mobile) : null,
      casters: meshes.filter((m) => m.kind === 'body' || m.kind === 'hair').map((m) => m.o) };
  }

  async function loadFallback() {
    const P = await samplePoints(mobile ? 15000 : 38000);
    if (dead) throw new Error('destruida');
    const g1 = new THREE.BufferGeometry();
    g1.setAttribute('position', new THREE.BufferAttribute(P.pos, 3));
    g1.setAttribute('normal', new THREE.BufferAttribute(P.nor, 3));
    g1.setAttribute('aLine', new THREE.BufferAttribute(P.line, 1));
    g1.setAttribute('aRand', new THREE.BufferAttribute(P.rnd, 1));
    const figU = Object.assign({}, common, {
      uFocus: FU.uFocus, uFocusAmt: FU.uFocusAmt,
      uDeep: { value: new THREE.Color(col('--c-gold-strong', '#7a6025')) },
      uAccent: { value: coral },
      uLight: { value: new THREE.Vector3(0.45, 0.75, 0.5).normalize() },
    });
    const m1 = new THREE.ShaderMaterial({ uniforms: figU, vertexShader: FIG_VS, fragmentShader: DOT_FS, transparent: true, depthWrite: false });
    const pts = new THREE.Points(g1, m1);
    pts.position.z = FIG_Z;
    scene.add(pts); disposables.push(g1, m1);
    zones.forEach((z) => { z.normal = z.pn = procNormal(z.anchor); });
    return { kind: 'points', obj: pts };
  }

  function ready(fig) {
    figure = fig;
    if (fig.kind === 'mesh') revealT0 = 0; else FU.uReveal.value = 9;
    stage.removeAttribute('aria-busy');
    loader.classList.add('is-done');
    setTimeout(() => loader.remove(), 900);
  }

  (async () => {
    let fig = null;
    try { fig = await loadModel(); diag('Modelo: cargado'); } catch (e) { fig = null; diag('Modelo: FALLO ' + e.message); }
    if (dead) return;
    if (!fig) { try { fig = await loadFallback(); } catch (e) { diag('Respaldo: FALLO ' + e.message); if (!dead) destroy(); return; } }
    if (!dead) ready(fig);
  })();

  function destroy() {
    if (dead) return;
    dead = true; running = false; if (raf) cancelAnimationFrame(raf);
    vio.disconnect(); if (ro) ro.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('load', measure);
    canvas.removeEventListener('webglcontextlost', onLost);
    disposables.forEach((d) => { try { d.dispose(); } catch (e) { /* ya liberado */ } });
    if (key.shadow && key.shadow.map) key.shadow.map.dispose();
    renderer.dispose();
    track.remove(); sec.classList.remove('bm--3d'); sec.style.removeProperty('--bm-top');
  }
  return { destroy };
}
