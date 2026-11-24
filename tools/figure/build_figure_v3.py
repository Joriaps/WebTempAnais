"""Genera static/src/assets/models/figure-v3.glb (con esqueleto y poses) a partir de figure.glb y de datos CC0 de MakeHuman.

blender --background --factory-startup --python tools/figure/build_figure_v3.py -- <carpeta-datos> <salida.glb>
gltf-transform meshopt (4.1.1) comprime después la salida; ver CREDITS-v3.md.

<carpeta-datos> contiene (descargados de github.com/makehumancommunity/makehuman, CC0):
  base.obj, {caucasian,african,asian}-{female,male}-young.target,
  female-young-averagemuscle-averageweight-mincup-averagefirmness.target,
  eye-left-closure.target, eye-right-closure.target, default.mhskel, default_weights.mhw
Todo lo demás (pelo, cejas, hebras de pestañas) se modela aquí. Coordenadas glTF (Y arriba, +Z frente).
"""
import bpy, sys, os, json
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

# ---------------------------------------------------------------- esqueleto y pesos MakeHuman (default.mhskel, CC0)
SK = json.load(open(os.path.join(DATA, 'default.mhskel'), encoding='utf8')); WG = json.load(open(os.path.join(DATA, 'default_weights.mhw'), encoding='utf8'))['weights']
def keep(b):
    p = b.split('.')[0]
    return p in ('root', 'spine01', 'neck01', 'neck03', 'head', 'clavicle',
                 'upperarm01', 'upperarm02', 'lowerarm01', 'lowerarm02', 'wrist', 'upperleg01', 'upperleg02', 'lowerleg01', 'lowerleg02', 'foot') or p.startswith('finger')
def owner(b):
    while not keep(b): b = SK['bones'][b]['parent']
    return b
BN = []                                                            # orden padre -> hijo
def visit(b):
    if keep(b): BN.append(b)
    for c_ in SK['bones']:
        if SK['bones'][c_]['parent'] == b: visit(c_)
visit('root'); BI = {b: i for i, b in enumerate(BN)}
PAR = {b: (owner(SK['bones'][b]['parent']) if SK['bones'][b]['parent'] else None) for b in BN}
joint = lambda n_: ((M[SK['joints'][n_]].mean(0)) + off) * k
HEAD = {b: joint(SK['bones'][b]['head']) for b in BN}; TAIL = {b: joint(SK['bones'][b]['tail']) for b in BN}
W0 = np.zeros((len(V), len(BN))); DIST = np.zeros(len(V)); TOE = np.zeros(len(V))
for b, lst in WG.items():
    for i, w_ in lst:
        W0[i, BI['spine01' if b.startswith(('spine', 'pelvis', 'root', 'breast')) else owner(b)]] += w_   # tronco rígido
        if b.split('.')[0].startswith('finger') and b.split('.')[0].endswith('-3'): DIST[i] += w_
        if b.startswith('toe') and b.split('.')[0][-1] in '23': TOE[i] += w_
W0 /= np.maximum(W0.sum(1, keepdims=True), 1e-9)
def catmullW(W_, faces):
    out = []
    for i in range(0, W_.shape[1], 3):
        X_ = np.zeros((len(W_), 3)); X_[:, :W_[:, i:i + 3].shape[1]] = W_[:, i:i + 3]
        out.append(catmull(X_, faces)[0])
    return np.concatenate(out, 1)[:, :W_.shape[1]]
WT = catmullW(np.c_[W0, DIST, TOE][u], bf); DIST, TOE = WT[:, -2], WT[:, -1]; W1 = WT[:, :-2]

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

# relleno suave de la concavidad del pubis: solo hacia fuera y solo en la cara frontal (silueta intacta)
def vnormals(X_):
    f_ = X_[Q]; n_ = np.cross(f_[:, 2] - f_[:, 0], f_[:, 3] - f_[:, 1]); N_ = np.zeros_like(X_)
    for j_ in range(4): np.add.at(N_, Q[:, j_], n_)
    return norm(N_)
N0 = vnormals(P)
wp = sstep(.775, .81, P[:, 1]) * (1 - sstep(.93, .99, P[:, 1])) * (1 - sstep(.07, .13, abs(P[:, 0]))) * sstep(.0, .35, N0[:, 2]) * sstep(-.55, -.2, N0[:, 1])
R_ = P.copy()
for _ in range(1200):
    d_ = np.maximum(((relax(R_, E) - R_) * N0).sum(1), 0); R_ = R_ + (.6 * wp * d_)[:, None] * N0
fill = np.clip(((R_ - P) * N0).sum(1), 0, .009); print('relleno pubis max mm', fill.max() * 1000)
P = P + fill[:, None] * N0

# realce local (máscara de enfoque) en cara, manos y pies; nunca en el torso
B = P.copy()
for _ in range(8): B = B + .5 * (relax(B, E) - B)
wface = sstep(1.525, 1.545, P[:, 1]) * sstep(-.035, -.01, P[:, 2]) * (1 - sstep(1.655, 1.675, P[:, 1]))
weye = sstep(1.606, 1.612, P[:, 1]) * (1 - sstep(1.642, 1.650, P[:, 1])) * sstep(.012, .016, abs(P[:, 0]))
whand = sstep(.455, .475, abs(P[:, 0])); wfoot = 1 - sstep(.07, .10, P[:, 1])
wt = .5 * np.clip(DIST + TOE, 0, 1) + np.clip(.35 * wface * (1 - weye) + .5 * whand + .5 * wfoot, 0, .6)
D = P - B; D = norm(D) * np.minimum(np.linalg.norm(D, axis=1, keepdims=True), .0008 + .0006 * np.clip(DIST + TOE, 0, 1)[:, None])
P = P + wt[:, None] * D

# segundo nivel solo donde hace falta (cara, orejas, manos, pies)
P2, Q2 = catmull(P, Q); W2 = catmullW(W1, Q)
c = P[Q].mean(1)
sel = ((c[:, 1] > 1.535) & (c[:, 1] < 1.66) & (c[:, 2] > -.125) & ~((c[:, 2] < -.06) & (abs(c[:, 0]) < .055))) | (abs(c[:, 0]) > .462) | (c[:, 1] < .055)
el = np.linalg.norm(P[Q] - P[np.roll(Q, -1, 1)], axis=2).max(1)    # las caras ya densas no se subdividen más
sel &= el > np.where(c[:, 1] > 1.5, .0029, .0036)
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
body = body[used]; W2 = W2[used]; faces = [[rem[i] for i in f] for f in faces]
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

W2 = W2[used]
# sello de labios: superficie de piel justo detrás de la línea de la boca (cierre morfológico de la profundidad)
bvh = BVHTree.FromPolygons([Vector(p) for p in body], faces)
mxs, mys = np.linspace(-.027, .027, 61), np.linspace(1.552, 1.574, 93)
dz = np.array([[bvh.ray_cast(Vector((x, y, .3)), Vector((0, 0, -1)))[0].z for y in mys] for x in mxs])
pad = np.pad(dz, ((0, 0), (5, 5)), mode='edge'); dil = np.stack([pad[:, i:i + 93] for i in range(11)]).max(0)
pad = np.pad(dil, ((0, 0), (5, 5)), mode='edge'); clo = np.stack([pad[:, i:i + 93] for i in range(11)]).min(0)
for _ in range(3): clo[:, 1:-1] = .5 * clo[:, 1:-1] + .25 * (clo[:, :-2] + clo[:, 2:])
gap = clo - dz; print('hueco boca max mm', gap.max() * 1000)
zz = np.where(gap > .003, clo - .0009, np.minimum(dz, clo) - .0016)
pad = np.pad(zz, 1, mode='edge'); zz = np.minimum(clo - .0007, (pad[:-2, 1:-1] + pad[2:, 1:-1] + pad[1:-1, :-2] + pad[1:-1, 2:] + 2 * zz) / 6)
o0 = len(body); touch = gap > .003
for _ in range(3): touch[1:-1, 1:-1] |= touch[:-2, 1:-1] | touch[2:, 1:-1] | touch[1:-1, :-2] | touch[1:-1, 2:]
touch &= (clo - zz) > .0004; idm = -np.ones(gap.shape, int); pts_ = []
for i_, j_ in np.argwhere(touch): idm[i_, j_] = o0 + len(pts_); pts_.append((mxs[i_], mys[j_], zz[i_, j_]))
for i_ in range(60):
    for j_ in range(92):
        q_ = [idm[i_, j_], idm[i_ + 1, j_], idm[i_ + 1, j_ + 1], idm[i_, j_ + 1]]
        if min(q_) >= 0: faces.append(q_)
if pts_: body = np.r_[body, np.array(pts_)]; W2 = np.r_[W2, np.eye(len(BN))[[BI['head']] * len(pts_)]]
bvh = BVHTree.FromPolygons([Vector(p) for p in body], faces)

# ---------------------------------------------------------------- pelo: casquete peinado hacia atrás + moño
C = np.array([0, 1.655, -.07]); AX = norm(np.array([0, .76, -.65]))
H = [(0, 1.6935, .0185), (.009, 1.6965, .0165), (.022, 1.6985, .012), (.041, 1.688, -.001), (.056, 1.671, -.018), (.0655, 1.649, -.036), (.0715, 1.643, -.053),
     (.0755, 1.646, -.076), (.0735, 1.638, -.098), (.066, 1.605, -.112), (.058, 1.575, -.114), (.044, 1.556, -.121), (.022, 1.549, -.131), (0, 1.547, -.133)]
H = np.array(H + [(-x, y, z) for x, y, z in H[-2:0:-1]])
def closed_spline(K, m):
    nK = len(K); t = np.arange(m) / m * nK; i = t.astype(int); f = (t - i)[:, None]
    p0, p1, p2, p3 = (K[(i + d) % nK] for d in (-1, 0, 1, 2))
    return .5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f ** 2 + (3 * p1 - p0 - 3 * p2 + p3) * f ** 3)
NS, NT = 264, 46
L = closed_spline(H, 3000); seg = np.linalg.norm(np.roll(L, -1, 0) - L, axis=1); s = np.r_[0, np.cumsum(seg)]
L = np.stack([np.interp(np.arange(NS) / NS * s[-1], s, np.r_[L, L[:1]][:, j]) for j in range(3)], 1)
sN = np.arange(NS) / NS * 2 * np.pi                                  # nacimiento irregular: ruido periódico a lo largo del borde
nz = sum(a_ * np.sin(f_ * sN + p_) for f_, a_, p_ in ((7, .4, 1.), (19, .5, 2.2), (34, .5, .4), (53, .35, 4.)))
L = L + norm(np.cross(np.roll(L, -1, 0) - np.roll(L, 1, 0), L - C)) * (nz * .0010)[:, None]
dirs = norm(L - C); ang = np.arccos(np.clip(dirs @ AX, -1, 1))
tt = (np.arange(NT) / (NT - 1)) ** .85
R = np.empty((NS, NT)); DD = np.empty((NS, NT, 3))
for i in range(NS):
    for j, t in enumerate(tt):
        d = (np.sin((1 - t) * ang[i]) * AX + np.sin(t * ang[i]) * dirs[i]) / np.sin(ang[i]); DD[i, j] = d
        h = bvh.ray_cast(Vector(C), Vector(d)); R[i, j] = h[3] if h[0] else .09
for _ in range(6):  # suaviza en el interior sin mover la línea de nacimiento
    R[:, 1:-1] = .5 * R[:, 1:-1] + .125 * (R[:, :-2] + R[:, 2:] + np.roll(R, 1, 0)[:, 1:-1] + np.roll(R, -1, 0)[:, 1:-1])
for _ in range(5): R[:, -3:] = .5 * R[:, -3:] + .25 * (np.roll(R, 1, 0) + np.roll(R, -1, 0))[:, -3:]
phi = np.arange(NS) / NS * 2 * np.pi
strand = np.zeros((NS, NT))
for f, amp in ((31, .40), (47, .35), (74, .25), (13, .25)):
    strand += amp * np.sin(f * phi[:, None] + rng.uniform(0, 6.28) + rng.uniform(-1.2, 1.2) * tt[None])
edge = KDTree(len(L)); [edge.insert(L[i], i) for i in range(len(L))]; edge.balance()
dE = np.array([edge.find(p)[2] for p in (C + DD * R[..., None]).reshape(-1, 3)]).reshape(NS, NT)
front = sstep(-.06, .0, (C + DD * R[..., None])[..., 2])            # degradado más largo en la frente
e_ = np.clip(dE / (.040 + .030 * front), 0, 1); e_ = (1 - (1 - e_) ** 2) ** (.78 + .12 * front); e_[:, -1] = 0
thick = -.0026 + .0104 * e_
strand = strand * .0009 * sstep(0, .25, tt)[None] * sstep(.12, .9, e_)
raya = np.exp(-((np.arange(NS) - NS * .035) / 1.7) ** 2)[:, None] * sstep(.45, .75, tt)[None] * e_    # raya lateral suave
X = C + DD * (R + thick + strand - .0028 * raya)[..., None]
hv = X.reshape(-1, 3).tolist(); hf = []
for i in range(NS):
    for j in range(NT - 1):
        i2 = (i + 1) % NS; hf.append((i * NT + j + 1, i2 * NT + j + 1, i2 * NT + j, i * NT + j))
# moño enrollado
bx = np.array([1., 0, 0]); by = np.cross(AX, bx)
ext = C + AX * (R[:, 0].mean() + .022)
MU, MV = 104, 50; o0 = len(hv)
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
        wd = .0028 * (.30 + .70 * sstep(0, .30, t)) * (1 - .88 * sstep(.35, 1, t))
        for j in range(NW):
            w = j / (NW - 1) * 2 - 1
            p, nn = face_pt(sd * (x + w * .0007), y + w * wd)
            hgt = .0013 * max(0, 1 - w * w) ** .5 * (1 - .6 * t) * sstep(-.02, .28, t) * (1 + .07 * np.sin(i * 1.25 - w * 2.2))
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
AOh = ao(hv, hf, occ, .03)

# ---------------------------------------------------------------- pesos finales
W2 = np.clip(W2, 0, None); W2 /= W2.sum(1, keepdims=True)
def graph(nv, f_):
    e = np.array([(f[i], f[(i + 1) % len(f)]) for f in f_ for i in range(len(f))]); e = np.unique(np.sort(e, 1), axis=0)
    return np.concatenate([e, e[:, ::-1]])
EB = graph(len(body), faces)
# suaviza los pesos en hombro/axila para que no se formen pliegues duros
wsm = np.zeros(len(body))
for sd in 'LR':
    wsm = np.maximum(wsm, 1 - sstep(.10, .21, np.linalg.norm(body - (.6 * HEAD['upperarm01.' + sd] + .4 * HEAD['clavicle.' + sd]), axis=1)))
wsm *= 1 - sstep(1.46, 1.52, body[:, 1])
nbs = [[] for _ in range(len(body))]
for a_, b_ in EB: nbs[a_].append(b_)
rg = np.flatnonzero(wsm > 0); mxn = max(len(nbs[v]) for v in rg)
NBI = np.array([nbs[v] + [v] * (mxn - len(nbs[v])) for v in rg]); NBM = np.array([[1.] * len(nbs[v]) + [0.] * (mxn - len(nbs[v])) for v in rg]); NBM /= NBM.sum(1, keepdims=True)
cols = np.flatnonzero(W2[np.unique(np.r_[rg, NBI.ravel()])].max(0) > 1e-5); Wc = W2[:, cols].copy()
for _ in range(450): Wc[rg] += (.6 * wsm[rg])[:, None] * (np.einsum('ij,ijk->ik', NBM, Wc[NBI]) - Wc[rg])
W2[:, cols] = Wc
def top4(W_):
    idx = np.argsort(-W_, 1)[:, :4]; v5 = np.sort(W_, 1)[:, -5:-4]; v_ = np.take_along_axis(W_, idx, 1) - v5; v_ = v_ / v_.sum(1, keepdims=True); return idx, v_
EYE = np.eye(len(BN))
kb = KDTree(len(body)); [kb.insert(p, i) for i, p in enumerate(body)]; kb.balance()
low = 1 - sstep(1.56, 1.60, hv[:, 1])                              # la nuca acompaña al cuello; el resto, rígido con la cabeza
WH = np.array([EYE[BI['head']] if l_ <= 0 else (1 - l_) * EYE[BI['head']] + l_ * W2[kb.find(p)[1]] for p, l_ in zip(hv, low)])
gl = lambda p: Vector((p[0], -p[2], p[1]))
safe = lambda b: b.replace('.', '_')                               # three.js elimina los puntos de los nombres

for o in list(bpy.data.objects): bpy.data.objects.remove(o)
arm = bpy.data.armatures.new('rig'); rig = bpy.data.objects.new('rig', arm); bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
for b in BN:
    e = arm.edit_bones.new(safe(b)); e.head, e.tail = gl(HEAD[b]), gl(TAIL[b])
    if PAR[b]: e.parent = arm.edit_bones[safe(PAR[b])]
bpy.ops.object.mode_set(mode='OBJECT')
def add(name, P_, f_, color, rgh, W_, shade=None):
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
    idx, val = top4(W_); vg = [o.vertex_groups.new(name=safe(b)) for b in BN]
    for c_ in range(4):
        for v in range(len(P_)):
            if val[v, c_] > .004: vg[idx[v, c_]].add([v], float(val[v, c_]), 'ADD')
    o.parent = rig; md = o.modifiers.new('rig', 'ARMATURE'); md.object = rig
add('body', body, faces, (.85, .68, .56), .46, W2)
add('hair', hv, hf, (.10, .055, .035), .5, WH, 1 - .8 * (1 - AOh))
add('brows', brv, brf, (.10, .055, .035), .6, EYE[[BI['head']] * len(brv)])
add('lashes', lav, laf, (.03, .02, .015), .6, EYE[[BI['head']] * len(lav)])
ntri = 0
for o in bpy.data.objects:
    if o.type != 'MESH': continue
    a_ = np.array([v.co for v in o.data.vertices]); t_ = sum(len(p.vertices) - 2 for p in o.data.polygons); ntri += t_
    print('MALLA', o.name, len(a_), 'v', t_, 't', a_.min(0), a_.max(0))
print('MALLA total', ntri)

# ---------------------------------------------------------------- poses: rotación de mundo por hueso (ejes glTF)
def rot(axis, deg):
    x = norm(np.array(axis, float)); t = np.radians(deg); K_ = np.array([[0, -x[2], x[1]], [x[2], 0, -x[0]], [-x[1], x[0], 0]])
    return np.eye(3) + np.sin(t) * K_ + (1 - np.cos(t)) * K_ @ K_
def swing(a_, b_, f=1.):
    a_, b_ = norm(np.array(a_, float)), norm(np.array(b_, float)); ax = np.cross(a_, b_)
    return rot(ax, f * np.degrees(np.arctan2(np.linalg.norm(ax), a_ @ b_)))
def arm_pose(w, sd, up, fore, hand, f=(.2, .85), ftw=0., curl=1.):
    """up/fore/hand: direcciones de mundo de brazo, antebrazo y mano."""
    r0 = HEAD['lowerarm01.' + sd] - HEAD['upperarm01.' + sd]; r1 = HEAD['wrist.' + sd] - HEAD['lowerarm01.' + sd]
    r2 = HEAD['finger3-1.' + sd] - HEAD['wrist.' + sd]
    for b, f_ in zip(('clavicle', 'upperarm01'), f): w[b + '.' + sd] = swing(r0, up, f_)
    A = swing(r0, up); w['upperarm02.' + sd] = A
    Fm = swing(A @ r1, fore) @ A; w['lowerarm01.' + sd] = rot(fore, ftw * .35) @ Fm; Fm = rot(fore, ftw) @ Fm; w['lowerarm02.' + sd] = Fm
    Hm = swing(Fm @ r2, hand) @ Fm; w['wrist.' + sd] = Hm
    axis = norm(HEAD['finger2-1.' + sd] - HEAD['finger5-1.' + sd]); sg = 1 if sd == 'L' else -1
    for n_ in range(2, 6):
        for j_ in range(1, 4): w['finger%d-%d.%s' % (n_, j_, sd)] = Hm @ rot(axis, sg * curl * j_ * (3 + n_))
def headw(w, axes):  # suma de giros repartidos en cuello y cabeza
    for i, b in enumerate(('neck01', 'neck03', 'head')):
        X_ = np.eye(3)
        for ax, dg in axes: X_ = rot(ax, dg * (.3, .65, 1.)[i]) @ X_
        w[b] = X_
POSES = {}
w = {}; arm_pose(w, 'L', (.87, .49, .02), (-.62, .78, -.05), (-.80, .58, .05), f=(.20, .85), ftw=-55, curl=1.9); headw(w, [((0, 0, 1), 4), ((0, 1, 0), -6)]); POSES['pose_brazos'] = (w, np.zeros(3))
w = {}; arm_pose(w, 'L', (.42, -.88, .10), (.22, -.10, .95), (.16, -.30, .93), f=(.12, .8), curl=1.6); headw(w, [((1, 0, 0), 4), ((0, 1, 0), 8)]); POSES['pose_manos'] = (w, np.zeros(3))
w = {}; headw(w, [((0, 0, 1), -7), ((1, 0, 0), 3), ((0, 1, 0), 6)]); POSES['pose_rostro'] = (w, np.zeros(3))
w = {}; headw(w, [((1, 0, 0), 13), ((0, 0, 1), -2)])
for sd, sg in (('L', 1), ('R', -1)): arm_pose(w, sd, (sg * .46, -.88, .0), (sg * .34, -.90, .24), (sg * .24, -.92, .30), f=(.15, .8))
POSES['pose_espalda'] = (w, np.zeros(3))
drop = .006; w = {}
for sd, dz_ in (('L', .085), ('R', -.035)):
    hp, kn, an = (HEAD[x + '.' + sd] for x in ('upperleg01', 'lowerleg01', 'foot'))
    tg = an + np.array([0, drop, dz_]); x_ = np.radians(np.array([-14., 4.]))
    f_ = lambda q_: (hp + rot((1, 0, 0), np.degrees(q_[0])) @ (kn - hp) + rot((1, 0, 0), np.degrees(q_[1])) @ (an - kn) - tg)[1:]
    for _ in range(60):
        J = np.stack([(f_(x_ + d_) - f_(x_ - d_)) / 2e-5 for d_ in np.eye(2) * 1e-5], 1); x_ = x_ - np.clip(np.linalg.lstsq(J, f_(x_), rcond=None)[0], -.1, .1)
    print('POSE pierna', sd, np.degrees(x_), 'err', f_(x_))
    for b in ('upperleg01', 'upperleg02'): w[b + '.' + sd] = rot((1, 0, 0), np.degrees(x_[0]))
    for b in ('lowerleg01', 'lowerleg02'): w[b + '.' + sd] = rot((1, 0, 0), np.degrees(x_[1]))
    w['foot.' + sd] = np.eye(3)
POSES['pose_piernas'] = (w, np.array([0, -drop, 0]))

CV = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)           # glTF -> Blender
from mathutils import Matrix
rig.animation_data_create()
anchors = {'pose_brazos': {'ancla brazos-axilas': (.26, 1.27, -.05), 'hueco axila': (.168, 1.315, -.045)}, 'pose_manos': {'ancla manos': (.48, 1.03, .15)},
           'pose_piernas': {'ancla piernas': (.13, .53, 0)}, 'pose_rostro': {'ancla rostro': (0, 1.605, .05)}, 'pose_espalda': {'ancla espalda': (0, 1.28, -.17)}}
for name, (w, tr) in POSES.items():
    act = bpy.data.actions.new(name); rig.animation_data.action = act
    Rw, Tw = {}, {}
    for b in BN:
        p = PAR[b]; Rp = Rw[p] if p else np.eye(3); Tp = Tw[p] if p else tr
        Rw[b] = w.get(b, Rp); Tw[b] = Rp @ HEAD[b] + Tp - Rw[b] @ HEAD[b]
        pb = rig.pose.bones[safe(b)]; B3 = arm.bones[safe(b)].matrix_local.to_3x3()
        Ll = Matrix((CV @ (Rp.T @ Rw[b]) @ CV.T).tolist()); pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (B3.inverted() @ Ll @ B3).to_quaternion()
        pb.location = B3.inverted() @ gl(tr) if b == 'root' else (0, 0, 0)
        for fr in (1, 2):
            pb.keyframe_insert('rotation_quaternion', frame=fr)
            if b == 'root': pb.keyframe_insert('location', frame=fr)
    for fc in act.layers[0].strips[0].channelbags[0].fcurves:
        for kp in fc.keyframe_points: kp.interpolation = 'LINEAR'
    idx, val = top4(W2); RA = np.array([Rw[b] for b in BN]); TA = np.array([Tw[b] for b in BN])
    X_ = sum(val[:, c_, None] * (np.einsum('nij,nj->ni', RA[idx[:, c_]], body) + TA[idx[:, c_]]) for c_ in range(4))
    print('POSE', name, 'ymin izq/der', X_[X_[:, 0] > 0][:, 1].min().round(5), X_[X_[:, 0] < 0][:, 1].min().round(5), 'caja', X_.min(0).round(3), X_.max(0).round(3))
    for n_, a_ in anchors[name].items(): i = kb.find(Vector(a_))[1]; print('ANCLA', name, n_, 'reposo', body[i].round(4), '-> pose', X_[i].round(4))
rig.animation_data.action = None
for pb in rig.pose.bones: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
print('HUESOS', ' '.join(safe(b) for b in BN))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=False,
    export_optimize_animation_size=False, export_skins=True, export_influence_nb=4, export_rest_position_armature=True, export_morph=False, export_def_bones=False,
    export_texcoords=False, export_tangents=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_reset_pose_bones=True,
    export_active_vertex_color_when_no_material=True, export_meshopt_compression_enable=False,
    export_copyright='CC0 1.0 - MakeHuman base mesh and rig (Data Collection AB, Joel Palmius, Jonas Hauquier)')
print('PESO', os.path.getsize(OUT))
