"""Vistas de control del maniquí. Uso:
blender --background --factory-startup --python render_figure.py -- <modelo.glb> <carpeta> [vista,vista...]"""
import bpy, sys, os
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
src, out = a[0], a[1]
VIEWS = {  # (cámara, objetivo, alto visible) en ejes glTF (Y arriba, +Z al frente)
    'frente': ((0, .9, 6), (0, .87, 0), 1.9), 'perfil': ((6, .9, 0), (0, .87, 0), 1.9),
    'espalda': ((0, .9, -6), (0, .87, 0), 1.9), 'cara': ((.55, 1.68, 3), (0, 1.62, 0), .34),
    'cara-frente': ((0, 1.62, 3), (0, 1.62, 0), .32), 'moño': ((-2, 2.1, -2.4), (0, 1.65, -.03), .36),
    'manos': ((1.6, 1.25, 2.6), (.5, .98, .06), .30), 'pubis': ((0, .9, 4), (0, .86, 0), .5), 'nuca': ((-1.6, 1.4, -2.6), (0, 1.62, -.06), .36),
    'pose_reposo': ((0, .9, 6), (0, .9, 0), 1.9), 'pose_reposo-lado': ((6, .9, 0), (0, .9, 0), 1.9), 'pose_reposo-34': ((3.5, 1.0, 5), (0, .9, 0), 1.9),
    'pose_reposo-espalda': ((0, .9, -6), (0, .9, 0), 1.9), 'pose_reposo-torso': ((1.2, 1.2, 4), (0, 1.1, 0), 1.0), 'mano': ((2.6, .95, 1.6), (.27, .80, .05), .35),
    'cabeza-34': ((2.4, 1.85, 2.2), (0, 1.66, -.06), .36),
    'pose_brazos': ((2, 1.5, 3.6), (.1, 1.35, 0), 1.15), 'pose_manos': ((2.6, 1.4, 2.6), (.15, 1.25, .1), 1.1),
    'pose_rostro': ((.8, 1.65, 3), (0, 1.60, 0), .5), 'pose_espalda': ((-.9, 1.5, -4), (0, 1.25, 0), 1.2),
    'pose_piernas': ((-2.6, .9, 3.4), (0, .87, 0), 1.9), 'pies': ((.9, .9, 2.6), (.1, .05, 0), .40),
}
want = a[2].split(',') if len(a) > 2 else list(VIEWS)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
COL = {'hair': (.10, .055, .035), 'brows': (.10, .055, .035), 'lashes': (.03, .02, .015)}
for o in bpy.data.objects:
    if o.type != 'MESH': continue
    m = bpy.data.materials.new(o.name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    c = COL.get(o.name, (.72, .51, .40)); b.inputs['Base Color'].default_value = (*c, 1)
    b.inputs['Roughness'].default_value = .46
    if o.data.color_attributes:  # AO por vértice
        n = m.node_tree.nodes.new('ShaderNodeVertexColor'); n.layer_name = o.data.color_attributes[0].name
        x = m.node_tree.nodes.new('ShaderNodeMix'); x.data_type = 'RGBA'; x.blend_type = 'MULTIPLY'
        x.inputs[0].default_value = 1; x.inputs[6].default_value = (*c, 1)
        m.node_tree.links.new(n.outputs['Color'], x.inputs[7]); m.node_tree.links.new(x.outputs[2], b.inputs['Base Color'])
    o.data.materials.clear(); o.data.materials.append(m)
S = bpy.context.scene
S.render.engine = 'CYCLES'; S.cycles.samples = 48; S.cycles.use_denoising = True
S.view_settings.view_transform = 'Standard'
w = bpy.data.worlds.new('w'); S.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (.9, .87, .84, 1); w.node_tree.nodes['Background'].inputs[1].default_value = .42
g = lambda v: Vector((v[0], -v[2], v[1]))
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); S.collection.objects.link(cam); S.camera = cam
cam.data.type = 'ORTHO'
key = bpy.data.objects.new('k', bpy.data.lights.new('k', 'SUN')); S.collection.objects.link(key)
key.data.energy = 2.6; key.data.angle = .25
RIG = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
if RIG and RIG.animation_data:  # reposo salvo que la vista pida un clip
    for t in list(RIG.animation_data.nla_tracks): RIG.animation_data.nla_tracks.remove(t)
for v in want:
    if RIG:
        RIG.animation_data.action = None
        for pb in RIG.pose.bones: pb.matrix_basis.identity()
        act = next((x for x in bpy.data.actions if x.name.startswith(v.split('-')[0] if v != 'mano' else 'pose_reposo')), None)
        if act:
            RIG.animation_data.action = act
            if act.slots: RIG.animation_data.action_slot = act.slots[0]
        S.frame_set(1); bpy.context.view_layer.update()
    c, t, h = VIEWS[v]; c, t = g(c), g(t)
    q = (t - c).to_track_quat('-Z', 'Y'); cam.location = c; cam.rotation_euler = q.to_euler(); cam.data.ortho_scale = h
    key.rotation_euler = (q @ Vector((.55, -.75, -1)).to_track_quat('-Z', 'Y')).to_euler()
    full = h == 1.9
    S.render.resolution_x, S.render.resolution_y = (440, 700) if full else (700, 700)
    S.render.filepath = os.path.join(out, v.replace('ñ', 'n') + '.png'); bpy.ops.render.render(write_still=True)
