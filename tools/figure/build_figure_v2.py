"""Genera static/src/assets/models/figure-v2.glb a partir de figure.glb y de datos CC0 de MakeHuman.

blender --background --factory-startup --python tools/figure/build_figure_v2.py -- <carpeta-datos> <salida.glb>
gltf-transform meshopt (4.1.1) comprime después la salida; ver CREDITS-v2.md.

<carpeta-datos> contiene (descargados de github.com/makehumancommunity/makehuman, CC0):
  base.obj, {caucasian,african,asian}-{female,male}-young.target,
  female-young-averagemuscle-averageweight-mincup-averagefirmness.target,
  eye-left-closure.target, eye-right-closure.target
Todo lo demás (pelo, cejas, hebras de pestañas) se modela aquí. Coordenadas glTF (Y arriba, +Z frente).
"""
import bpy, sys, os
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DATA, OUT = sys.argv[sys.argv.index('--') + 1:][:2]
SRC = os.path.join(ROOT, 'static', 'src', 'assets', 'models', 'figure.glb')
rng = np.random.default_rng(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
sstep = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0, 1))
norm = lambda v: v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-12)

# ---------------------------------------------------------------- malla MakeHuman
V, F, g = [], {}, ''
for l in open(os.path.join(DATA, 'base.obj')):
    t = l.split()
    if not t: continue
    if t[0] == 'v': V.append([float(x) for x in t[1:4]])
    elif t[0] == 'g': g = t[1]
    elif t[0] == 'f': F.setdefault(g, []).append([int(x.split('/')[0]) - 1 for x in t[1:]])
V = np.array(V)

def target(n):
    d = np.zeros_like(V)
    for l in open(os.path.join(DATA, n + '.target')):
        if l[0] != '#' and l.strip():
            t = l.split(); d[int(t[0])] = [float(x) for x in t[1:4]]
    return d

M = V.copy()
for r in ('caucasian', 'african', 'asian'):
    M += target(r + '-female-young') * (.75 / 3) + target(r + '-male-young') * (.25 / 3)
M += .75 * target('female-young-averagemuscle-averageweight-mincup-averagefirmness')
closure = target('eye-left-closure') + target('eye-right-closure')

def mesh(name, P, faces):
    m = bpy.data.meshes.new(name); m.from_pydata(np.asarray(P).tolist(), [], [list(map(int, f)) for f in faces])
    return m

def catmull(P, faces):
    """Un nivel Catmull-Clark; devuelve vértices y quads."""
    o = bpy.data.objects.new('t', mesh('t', P, faces)); bpy.context.scene.collection.objects.link(o)
    s = o.modifiers.new('s', 'SUBSURF'); s.levels = 1; s.use_limit_surface = False
    q = o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    a = np.empty(len(q.vertices) * 3, 'f'); q.vertices.foreach_get('co', a)
    f = np.empty(len(q.loops), 'i'); q.loops.foreach_get('vertex_index', f)
    bpy.data.objects.remove(o)
    return a.reshape(-1, 3).astype(float), f.reshape(-1, 4)

def edges(Q):
    e = np.concatenate([Q[:, [i, (i + 1) % 4]] for i in range(4)]); e = np.unique(np.sort(e, 1), axis=0)
    return np.concatenate([e, e[:, ::-1]])

def relax(X, E):
    s = np.zeros_like(X); np.add.at(s, E[:, 0], X[E[:, 1]])
    return s / np.maximum(np.bincount(E[:, 0], minlength=len(X)), 1)[:, None]

u = sorted({i for f in F['body'] for i in f}); ix = {k: i for i, k in enumerate(u)}
bf = [[ix[i] for i in f] for f in F['body']]
S, Q = catmull(M[u], bf)
Sc, _ = catmull((M + closure)[u], bf)
mn, mx = S.min(0), S.max(0); k = 1.74 / (mx[1] - mn[1])
off = np.array([-(mn[0] + mx[0]) / 2, -mn[1], -(mn[2] + mx[2]) / 2])
S, Sc, CAGE = (S + off) * k, (Sc + off) * k, (M + closure + off) * k

# ---------------------------------------------------------------- superficie actual (pecho/entrepierna lisos)
bpy.ops.import_scene.gltf(filepath=SRC)
src = next(o for o in bpy.data.objects if o.type == 'MESH' and len(o.data.vertices) > 1000)
bpy.context.view_layer.update()
G = np.array([src.matrix_world @ v.co for v in src.data.vertices]); G = np.stack([G[:, 0], G[:, 2], -G[:, 1]], 1)
lo, hi = G.min(0), G.max(0)
kd = KDTree(len(G)); [kd.insert(p, i) for i, p in enumerate(G)]; kd.balance()
hit = [kd.find(p) for p in S]
dist = np.array([h[2] for h in hit]); near = G[[h[1] for h in hit]]
E = edges(Q)
P = S.copy(); ok = dist < 4e-4; P[ok] = near[ok]
print('vertices rehechos sobre la superficie lisa:', (~ok).sum())
tree = BVHTree.FromPolygons([Vector(p) for p in G], [list(p.vertices) for p in src.data.polygons])
for _ in range(400): P[~ok] = relax(P, E)[~ok]
P[~ok] = [tree.find_nearest(Vector(p))[0] for p in P[~ok]]
P += Sc - S                                                        # párpados cerrados

# realce local (máscara de enfoque) en cara, manos y pies; nunca en el torso
B = P.copy()
for _ in range(8): B = B + .5 * (relax(B, E) - B)
wface = sstep(1.525, 1.545, P[:, 1]) * sstep(-.035, -.01, P[:, 2]) * (1 - sstep(1.655, 1.675, P[:, 1]))
weye = sstep(1.606, 1.612, P[:, 1]) * (1 - sstep(1.642, 1.650, P[:, 1])) * sstep(.012, .016, abs(P[:, 0]))
whand = sstep(.455, .475, abs(P[:, 0])); wfoot = 1 - sstep(.07, .10, P[:, 1])
wt = np.clip(.35 * wface * (1 - weye) + .5 * whand + .5 * wfoot, 0, .6)
D = P - B; D = norm(D) * np.minimum(np.linalg.norm(D, axis=1, keepdims=True), .0008)
P = P + wt[:, None] * D

# segundo nivel solo donde hace falta (cara, orejas, manos, pies)
P2, Q2 = catmull(P, Q)
c = P[Q].mean(1)
sel = ((c[:, 1] > 1.535) & (c[:, 1] < 1.66) & (c[:, 2] > -.125) & ~((c[:, 2] < -.06) & (abs(c[:, 0]) < .055))) | (abs(c[:, 0]) > .462) | (c[:, 1] < .055)
el = np.linalg.norm(P[Q] - P[np.roll(Q, -1, 1)], axis=2).max(1)    # las caras ya densas no se subdividen más
sel &= el > np.where(c[:, 1] > 1.5, .0019, .0027)
sel &= ~((c[:, 1] < .1) & (c[:, 2] < .05))
n, nq = len(P), len(Q)
kids = Q2.reshape(nq, 4, 4)                                        # 4 hijos por quad
mid = {}
for fi in np.flatnonzero(sel):
    q = list(Q[fi])
    for ch in kids[fi]:
        ch = list(ch); co = next(v for v in ch if v < n); j = ch.index(co); p = q.index(co)
        mid[frozenset((co, q[(p + 1) % 4]))] = ch[(j + 1) % 4]; mid[frozenset((co, q[p - 1]))] = ch[j - 1]
faces = []
for fi in range(nq):
    if sel[fi]:
        faces += [list(ch) for ch in kids[fi]]; continue
    q = Q[fi]; f = []
    for j in range(4):
        f.append(q[j]); m = mid.get(frozenset((q[j], q[(j + 1) % 4])))
        if m is not None: f.append(m)
    faces.append(f)
body = P2
used = np.unique(np.concatenate([np.array(f) for f in faces])); rem = -np.ones(len(body), int); rem[used] = np.arange(len(used))
body = body[used]; faces = [[rem[i] for i in f] for f in faces]
a, b = body.min(0), body.max(0); body = lo + (body - a) * ((hi - lo) / (b - a))   # mismos límites que figure.glb
bvh = BVHTree.FromPolygons([Vector(p) for p in body], faces)
# interior de la boca: caras que ningún rayo exterior alcanza (no se ven nunca)
m_ = mesh('cull', body, faces); dead = set()
for pl in m_.polygons:
    cc = np.array(pl.center)
    if not (1.50 < cc[1] < 1.60 and abs(cc[0]) < .035 and -.08 < cc[2] < .03): continue
    if bvh.ray_cast(Vector(cc + np.array(pl.normal) * 2e-4), pl.normal, .05)[0] is None: continue
    i = np.arange(200) + .5; z_ = 1 - 2 * i / 200; th = np.pi * (1 + 5 ** .5) * i; q_ = np.sqrt(1 - z_ ** 2)
    dd = np.stack([q_ * np.cos(th), q_ * np.sin(th), z_], 1); dd = dd[dd @ np.array(pl.normal) > .02]
    o_ = Vector(cc + np.array(pl.normal) * 2e-4)
    if all(bvh.ray_cast(o_, Vector(d), .3)[0] is not None for d in dd): dead.add(pl.index)
print('caras interiores retiradas:', len(dead))
faces = [f for i, f in enumerate(faces) if i not in dead]
used = np.unique(np.concatenate([np.array(f) for f in faces])); rem = -np.ones(len(body), int); rem[used] = np.arange(len(used))
body = body[used]; faces = [[rem[i] for i in f] for f in faces]

# ---------------------------------------------------------------- pelo: casquete peinado hacia atrás + moño
C = np.array([0, 1.655, -.07]); AX = norm(np.array([0, .40, -.92]))
H = [(0, 1.699, .016), (.022, 1.6965, .012), (.041, 1.688, -.001), (.056, 1.671, -.018), (.0655, 1.649, -.036), (.0715, 1.643, -.053),
     (.0755, 1.646, -.076), (.0735, 1.638, -.098), (.066, 1.605, -.112), (.058, 1.575, -.114), (.044, 1.556, -.121), (.022, 1.549, -.131), (0, 1.547, -.133)]
H = np.array(H + [(-x, y, z) for x, y, z in H[-2:0:-1]])
def closed_spline(K, m):
    nK = len(K); t = np.arange(m) / m * nK; i = t.astype(int); f = (t - i)[:, None]
    p0, p1, p2, p3 = (K[(i + d) % nK] for d in (-1, 0, 1, 2))
    return .5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f ** 2 + (3 * p1 - p0 - 3 * p2 + p3) * f ** 3)
NS, NT = 300, 56
L = closed_spline(H, 3000); seg = np.linalg.norm(np.roll(L, -1, 0) - L, axis=1); s = np.r_[0, np.cumsum(seg)]
L = np.stack([np.interp(np.arange(NS) / NS * s[-1], s, np.r_[L, L[:1]][:, j]) for j in range(3)], 1)
dirs = norm(L - C); ang = np.arccos(np.clip(dirs @ AX, -1, 1))
tt = (np.arange(NT) / (NT - 1)) ** .85
R = np.empty((NS, NT)); DD = np.empty((NS, NT, 3))
for i in range(NS):
    for j, t in enumerate(tt):
        d = (np.sin((1 - t) * ang[i]) * AX + np.sin(t * ang[i]) * dirs[i]) / np.sin(ang[i]); DD[i, j] = d
        h = bvh.ray_cast(Vector(C), Vector(d)); R[i, j] = h[3] if h[0] else .09
for _ in range(6):  # suaviza en el interior sin mover la línea de nacimiento
    R[:, 1:-1] = .5 * R[:, 1:-1] + .125 * (R[:, :-2] + R[:, 2:] + np.roll(R, 1, 0)[:, 1:-1] + np.roll(R, -1, 0)[:, 1:-1])
phi = np.arange(NS) / NS * 2 * np.pi
strand = np.zeros((NS, NT))
for f, amp in ((31, .40), (47, .35), (74, .25), (13, .25)):
    strand += amp * np.sin(f * phi[:, None] + rng.uniform(0, 6.28) + rng.uniform(-1.2, 1.2) * tt[None])
edge = KDTree(len(L)); [edge.insert(L[i], i) for i in range(len(L))]; edge.balance()
dE = np.array([edge.find(p)[2] for p in (C + DD * R[..., None]).reshape(-1, 3)]).reshape(NS, NT)
e_ = np.clip(dE / .038, 0, 1); e_ = (1 - (1 - e_) ** 2) ** .72; e_[:, -1] = 0
thick = -.0026 + .0104 * e_
strand = strand * .0009 * sstep(0, .25, tt)[None] * sstep(.12, .9, e_)
X = C + DD * (R + thick + strand)[..., None]
hv = X.reshape(-1, 3).tolist(); hf = []
for i in range(NS):
    for j in range(NT - 1):
        i2 = (i + 1) % NS; hf.append((i * NT + j + 1, i2 * NT + j + 1, i2 * NT + j, i * NT + j))
# moño enrollado
bx = np.array([1., 0, 0]); by = np.cross(AX, bx)
ext = C + AX * (R[:, 0].mean() + .020)
MU, MV = 152, 72; o0 = len(hv)
for i in range(MU):
    for j in range(MV):
        u_, v_ = i / MU, j / (MV - 1); th = v_ * np.pi
        rho = np.sin(th) if th < np.pi / 2 else 1.0 + (th - np.pi / 2) / np.pi * .8
        turn = rho * 2.4 + u_
        coil = np.cos(2 * np.pi * turn); fine = np.cos(2 * np.pi * turn * 5 + 1.3)
        fade = sstep(.02, .25, rho) if th < np.pi / 2 else 1 - sstep(2.2, 3., th)
        r = 1 + fade * (.055 * np.sign(coil) * abs(coil) ** .8 + .010 * fine)
        a_ = 2 * np.pi * u_
        hv.append((ext + r * (.044 * np.sin(th) * (np.cos(a_) * bx + np.sin(a_) * by) + .032 * np.cos(th) * AX)).tolist())
for i in range(MU):
    for j in range(MV - 1):
        i2 = (i + 1) % MU; hf.append(tuple(o0 + x for x in (i * MV + j, i * MV + j + 1, i2 * MV + j + 1, i2 * MV + j)))
hv = np.array(hv)

# ---------------------------------------------------------------- cejas y pestañas
def face_pt(x, y):
    h = bvh.ray_cast(Vector((x, y, .3)), Vector((0, 0, -1))); return np.array(h[0]), np.array(h[1])
brv, brf, lav, laf = [], [], [], []
kx, ky = np.array([.0135, .022, .032, .041, .048, .0545]), np.array([1.6472, 1.6488, 1.6505, 1.6512, 1.6496, 1.6464])
co = np.polyfit(kx, ky, 4)
NB, NW = 72, 9
for sd in (1, -1):
    o0 = len(brv)
    for i in range(NB):
        t = i / (NB - 1); x = .0135 + t * .041; y = np.polyval(co, x)
        wd = .0028 * min(1, .62 + t * 2.2) * (1 - .88 * sstep(.35, 1, t))
        for j in range(NW):
            w = j / (NW - 1) * 2 - 1
            p, nn = face_pt(sd * (x + w * .0007), y + w * wd)
            hgt = .0013 * max(0, 1 - w * w) ** .5 * (1 - .6 * t) * sstep(0, .05, t) * (1 + .12 * np.sin(i * 1.25 - w * 2.2))
            brv.append(p + nn * (hgt - .0004))
    for i in range(NB - 1):
        for j in range(NW - 1):
            f = (o0 + i * NW + j, o0 + (i + 1) * NW + j, o0 + (i + 1) * NW + j + 1, o0 + i * NW + j + 1)
            brf.append(f if sd > 0 else f[::-1])

def tube(pts, r0, r1):
    o0 = len(lav); nP = len(pts)
    for i, p in enumerate(pts):
        d = norm(pts[min(i + 1, nP - 1)] - pts[max(i - 1, 0)]); s1 = norm(np.cross(d, [0, 0, 1.]) + 1e-6); s2 = np.cross(d, s1)
        r = r0 + (r1 - r0) * i / (nP - 1)
        for a_ in (0, 2.094, 4.189): lav.append(p + r * (np.cos(a_) * s1 + np.sin(a_) * s2))
    for i in range(nP - 1):
        for j in range(3):
            j2 = (j + 1) % 3; laf.append((o0 + i * 3 + j, o0 + (i + 1) * 3 + j, o0 + (i + 1) * 3 + j2, o0 + i * 3 + j2)[::-1])
# línea del párpado cerrado: raíz de las pestañas superiores de la malla base (CC0)
for side in ('l', 'r'):
    ids = sorted({i for f in F['helper-%s-eyelashes-2' % side] for i in f}); pts = CAGE[ids]
    sg = 1 if pts[:, 0].mean() > 0 else -1
    xs = np.abs(pts[:, 0]); order = np.argsort(xs)
    cols = np.array_split(order, max(6, len(order) // 4))
    root = np.array([pts[cc][np.argmin(pts[cc][:, 2])] for cc in cols]); rx = np.abs(root[:, 0])
    fy = np.polyfit(rx, root[:, 1], 3); x0, x1 = rx.min() + .0008, rx.max() - .0003
    line = []
    for x in np.linspace(x0, x1, 30):
        p, nn = face_pt(sg * x, np.polyval(fy, x)); line.append(p + nn * .0001)
    tube(line, .00045, .00035)
    for q in np.linspace(.04, 1, 30):
        x = x0 + (x1 - x0) * q; p, nn = face_pt(sg * x, np.polyval(fy, x))
        ln = (.0048 + .0042 * np.sin(np.pi * min(1, q * .75))) * rng.uniform(.9, 1.08)
        out = norm(np.array([sg * (-.25 + 1.0 * q), 0, 0]) + np.array([0, -.75, .75]))
        curl = np.array([0, 1., .25])
        tube([p - nn * .0003 + out * ln * s_ + curl * ln * .42 * s_ ** 2.2 for s_ in np.linspace(0, 1, 6)], .00033, .00005)

# ---------------------------------------------------------------- AO por vértice (COLOR_0 lineal, gris)
def ao(P_, f_, occ, dist_, rays=72):
    m = mesh('ao', P_, f_); N = np.array([v.normal for v in m.vertices]); res = np.empty(len(P_))
    i = np.arange(rays) + .5; r = np.sqrt(i / rays); th = np.pi * (1 + 5 ** .5) * i
    loc = np.stack([r * np.cos(th), r * np.sin(th), np.sqrt(1 - i / rays)], 1)
    for q in range(len(P_)):
        n_ = N[q]; t1 = norm(np.cross(n_, [1., 0, 0] if abs(n_[0]) < .8 else [0, 1., 0])); t2 = np.cross(n_, t1)
        o_ = Vector(P_[q] + n_ * 4e-4); w_ = loc @ np.array([t1, t2, n_]); acc = 0.
        for d in w_:
            h = occ.ray_cast(o_, Vector(d), dist_)
            acc += 1. if h[0] is None else (h[3] / dist_) ** .6
        res[q] = acc / rays
    return res
occ = BVHTree.FromPolygons([Vector(p) for p in np.r_[body, hv]], list(faces) + [tuple(len(body) + i for i in f) for f in hf])
AOb = ao(body, faces, occ, .07); AOh = ao(hv, hf, occ, .03)

def add(name, P_, f_, color, rgh, shade=None):
    P_ = np.asarray(P_, float)
    if name == 'body': P_ = np.clip(P_, lo, hi)
    m = mesh(name, np.stack([P_[:, 0], -P_[:, 2], P_[:, 1]], 1), f_); m.polygons.foreach_set('use_smooth', [True] * len(m.polygons))
    if shade is not None:
        at = m.color_attributes.new('AO', 'FLOAT_COLOR', 'POINT'); s_ = np.round(np.clip(shade, 0, 1) * 63) / 63
        at.data.foreach_set('color', np.c_[s_, s_, s_, np.ones(len(s_))].astype('f').ravel())
    mt = bpy.data.materials.new(name); mt.use_nodes = True
    bs = next(x for x in mt.node_tree.nodes if x.type == 'BSDF_PRINCIPLED')
    bs.inputs['Base Color'].default_value = (*color, 1); bs.inputs['Roughness'].default_value = rgh
    m.materials.append(mt); o = bpy.data.objects.new(name, m); bpy.context.scene.collection.objects.link(o)
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
mix = lambda A, k_: 1 - k_ * (1 - A)
add('body', body, faces, (.85, .68, .56), .46, mix(AOb, .75))
add('hair', hv, hf, (.10, .055, .035), .5, mix(AOh, .8))
add('brows', brv, brf, (.10, .055, .035), .6)
add('lashes', lav, laf, (.03, .02, .015), .6)
for o in bpy.data.objects:
    o.data.validate(); a_ = np.array([v.co for v in o.data.vertices])
    print('MALLA', o.name, len(a_), 'v', sum(len(p.vertices) - 2 for p in o.data.polygons), 't', a_.min(0), a_.max(0))
print('AO', np.percentile(AOb, [1, 10, 50, 90]), np.percentile(AOh, [1, 10, 50, 90]))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_animations=False, export_skins=False, export_morph=False,
    export_texcoords=False, export_tangents=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False,
    export_active_vertex_color_when_no_material=True, export_meshopt_compression_enable=False,
    export_copyright='CC0 1.0 - MakeHuman base mesh (Data Collection AB, Joel Palmius, Jonas Hauquier)')
print('PESO', os.path.getsize(OUT))
