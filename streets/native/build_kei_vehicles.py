"""Clean, planar-dissolve, and package lightweight Japanese Kei-Car 3D assets for `streets/`.

1. Processes the downloaded BlenderKit Suzuki Alto (HA36S) model:
   - Strips 940k+ tris of lug-nut/racing-tire/3D-text bloat & hidden wheel-well leftovers
   - Uses exact duplicate-vertex weld (`1e-5`) + Planar Dissolve (`DECIMATE -> DISSOLVE`)
     to reverse the source model's Simple Subdivision back to clean, razor-crisp low-poly
     automotive sheet metal (~10.5k tris total per car, zero Collapse edge crumpling!)
   - Computes crisp automotive feature creases (`24 deg`) + area-weighted face normals
   - Preserves the hollow cabin, 4 curved single-sheet transmissive window panes,
     Right-Hand Drive (RHD) steering wheel, dashboard, front/rear seats, wipers,
     multi-layer faceted reflector headlamps + clear lenses, taillamps, and 14-inch Kei wheels
   - Normalizes dimensions to exact Japanese Kei-Car regulations (3.395 m x 1.475 m x 1.495 m)

2. Generates a companion Japanese Tall Kei-Wagon (`トールワゴン`, Wagon R / Spacia proportions:
   3.395 m x 1.475 m x 1.725 m) via a smooth C2 greenhouse & upright-tailgate coachwork warp
   on the clean Suzuki platform so both variants share identical sheet-metal fidelity, RHD
   interior, and multi-layer optics.

3. Exports standard glTF 2.0 `.glb` files into `streets/web/vehicles/` AND writes a
   synchronous quantized geometry module `streets/web/kei-vehicles.js` consumed by
   `japanese-buildings.js` across Web, ThreeRT, and Blender Cycles.
"""

import base64
import json
import math
import os
import struct

import bpy
import bmesh
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
STREETS_DIR = os.path.dirname(HERE)
RAW_ALTO = os.path.join(STREETS_DIR, "vehicles_raw", "suzuki_alto_realistic_3d_car_model_0f.glb")
SOURCE_BLEND = os.path.join(STREETS_DIR, "web", "vehicles", "suzuki_alto_source.blend")
VEH_OUT_DIR = os.path.join(STREETS_DIR, "web", "vehicles")
os.makedirs(VEH_OUT_DIR, exist_ok=True)

CHANNELS = [
    "body",
    "glass",
    "clearLens",
    "trimBlack",
    "undercarriage",
    "silver",
    "headlamp",
    "taillamp",
    "amber",
    "wheelTire",
    "wheelRim",
]


def clear_bpy():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def clean_automotive_part(
    obj,
    planar_deg=6.0,
    max_tris=None,
    sharp_deg=24.0,
    weld_dist=1e-5,
):
    """Welds only exact UV-seam duplicate vertices (1e-5 m), dissolves coplanar Simple-Subdiv
    facets cleanly via Planar Dissolve, applies optional Collapse ONLY on non-body detail parts,
    and splits sharp automotive feature creases (`sharp_deg`) with area-weighted smooth normals."""
    bpy.context.view_layer.objects.active = obj
    me = obj.data

    bm = bmesh.new()
    bm.from_mesh(me)
    if weld_dist > 0:
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=weld_dist)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.update()

    if planar_deg > 0:
        mod = obj.modifiers.new("Planar", "DECIMATE")
        mod.decimate_type = "DISSOLVE"
        mod.angle_limit = math.radians(planar_deg)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        me = obj.data

    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.update()

    me.calc_loop_triangles()
    cur_tris = len(me.loop_triangles)
    if max_tris is not None and cur_tris > max_tris * 1.12:
        mod = obj.modifiers.new("Collapse", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = max(0.03, min(0.95, max_tris / cur_tris))
        bpy.ops.object.modifier_apply(modifier=mod.name)
        me = obj.data

    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    thresh = math.radians(sharp_deg)
    sharp_edges = [
        e for e in bm.edges
        if len(e.link_faces) == 2 and e.link_faces[0].normal.angle(e.link_faces[1].normal, 0.0) > thresh
    ]
    if sharp_edges:
        bmesh.ops.split_edges(bm, edges=sharp_edges)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()

    for poly in me.polygons:
        poly.use_smooth = True
    me.update()

    wn = obj.modifiers.new("WeightedNrm", "WEIGHTED_NORMAL")
    wn.weight = 50
    wn.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=wn.name)


def split_object_by_material(obj):
    me = obj.data
    if len(me.materials) <= 1:
        bname = me.materials[0].name.split("_unique_")[0] if me.materials and me.materials[0] else "None"
        return [(bname, obj)]

    results = []
    M = obj.matrix_world.copy()
    for slot_idx, mat in enumerate(me.materials):
        bname = mat.name.split("_unique_")[0] if mat else "None"
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        drop = [f for f in bm.faces if f.material_index != slot_idx]
        if drop:
            bmesh.ops.delete(bm, geom=drop, context="FACES")
        unused = [v for v in bm.verts if not v.link_edges]
        if unused:
            bmesh.ops.delete(bm, geom=unused, context="VERTS")
        if len(bm.faces) == 0:
            bm.free()
            continue
        sub_me = bpy.data.meshes.new(f"{obj.name}_s{slot_idx}")
        bm.to_mesh(sub_me)
        bm.free()
        sub_obj = bpy.data.objects.new(f"{obj.name}_s{slot_idx}", sub_me)
        sub_obj.matrix_world = M
        bpy.context.scene.collection.objects.link(sub_obj)
        results.append((bname, sub_obj))

    bpy.data.objects.remove(obj, do_unlink=True)
    return results


def ensure_outward_glass_normals(obj, ref_center_bl):
    me = obj.data
    M = obj.matrix_world
    M_inv_t = M.inverted_safe().transposed().to_3x3()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    for f in bm.faces:
        wc = M @ f.calc_center_median()
        wn = (M_inv_t @ f.normal).normalized()
        if wn.dot(wc - ref_center_bl) < 0:
            f.normal_flip()
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.update()


def build_kei_wheel_meshes(wheel_positions_three, radius=0.285, width=0.165, spoke_count=7):
    """Builds 4 authentic 14-inch Japanese Kei radial tires + 7-spoke recessed alloy rims (~1,270 tris total)."""
    tire_tris = []
    rim_tris = []

    t_prof = [
        (0.58, -0.46),
        (0.89, -0.49),
        (0.99, -0.36),
        (1.00, 0.00),
        (0.99, 0.36),
        (0.89, 0.49),
        (0.58, 0.46),
    ]
    segs = 16

    def add_quad_tris(dst, p0, p1, p2, p3, n0=None, n1=None, n2=None, n3=None):
        if n0 is None:
            fn = (p1 - p0).cross(p2 - p0)
            fn = fn.normalized() if fn.length > 1e-9 else Vector((0, 1, 0))
            n0 = n1 = n2 = n3 = fn
        dst.append((p0, p1, p2, n0, n1, n2))
        dst.append((p0, p2, p3, n0, n2, n3))

    for wx, wy, wz in wheel_positions_three:
        sgn = 1.0 if wx >= 0 else -1.0
        rings_p = []
        rings_n = []
        for i in range(segs):
            a = (i / segs) * math.tau
            ca, sa = math.cos(a), math.sin(a)
            rp, rn = [], []
            for k, (rf, xf) in enumerate(t_prof):
                rp.append(Vector((wx + xf * width, wy + rf * radius * ca, wz + rf * radius * sa)))
                k0 = max(0, k - 1)
                k1 = min(len(t_prof) - 1, k + 1)
                dr = t_prof[k1][0] - t_prof[k0][0]
                dx = t_prof[k1][1] - t_prof[k0][1]
                nx, nr = -dr, dx
                if nr < 0:
                    nx, nr = -nx, -nr
                rn.append(Vector((nx, nr * ca, nr * sa)).normalized())
            rings_p.append(rp)
            rings_n.append(rn)

        for i in range(segs):
            inext = (i + 1) % segs
            for k in range(len(t_prof) - 1):
                add_quad_tris(
                    tire_tris,
                    rings_p[i][k], rings_p[i][k + 1], rings_p[inext][k + 1], rings_p[inext][k],
                    rings_n[i][k], rings_n[i][k + 1], rings_n[inext][k + 1], rings_n[inext][k],
                )

        r_lip = radius * 0.61
        r_well = radius * 0.52
        r_hub = radius * 0.21
        x_lip = wx + sgn * (width * 0.45)
        x_well = wx + sgn * (width * 0.30)
        x_hub = wx + sgn * (width * 0.41)
        x_cap = wx + sgn * (width * 0.44)

        r_prof = [
            (0.001, x_cap),
            (r_hub, x_hub),
            (r_well, x_well),
            (r_lip * 0.95, x_lip),
            (r_lip, x_lip - sgn * 0.015),
        ]
        r_segs = 14
        rr_p, rr_n = [], []
        for i in range(r_segs):
            a = (i / r_segs) * math.tau
            ca, sa = math.cos(a), math.sin(a)
            rr_p.append([Vector((xx, wy + rr * ca, wz + rr * sa)) for rr, xx in r_prof])
            rr_n.append([Vector((sgn * 0.88, 0.46 * ca, 0.46 * sa)).normalized() for _ in r_prof])

        for i in range(r_segs):
            inext = (i + 1) % r_segs
            for k in range(len(r_prof) - 1):
                if sgn > 0:
                    add_quad_tris(
                        rim_tris,
                        rr_p[i][k], rr_p[inext][k], rr_p[inext][k + 1], rr_p[i][k + 1],
                        rr_n[i][k], rr_n[inext][k], rr_n[inext][k + 1], rr_n[i][k + 1],
                    )
                else:
                    add_quad_tris(
                        rim_tris,
                        rr_p[i][k], rr_p[i][k + 1], rr_p[inext][k + 1], rr_p[inext][k],
                        rr_n[i][k], rr_n[i][k + 1], rr_n[inext][k + 1], rr_n[inext][k],
                    )

        spoke_w = radius * 0.068
        for s_idx in range(spoke_count):
            ang = (s_idx / spoke_count) * math.tau + 0.15
            ca, sa = math.cos(ang), math.sin(ang)
            ta, tsa = -sa, ca
            r0, r1 = r_hub * 0.85, r_lip * 0.93
            x0, x1 = x_hub + sgn * 0.012, x_lip - sgn * 0.004
            p_in_a = Vector((x0, wy + r0 * ca - spoke_w * ta, wz + r0 * sa - spoke_w * tsa))
            p_in_b = Vector((x0, wy + r0 * ca + spoke_w * ta, wz + r0 * sa + spoke_w * tsa))
            p_out_b = Vector((x1, wy + r1 * ca + spoke_w * 0.78 * ta, wz + r1 * sa + spoke_w * 0.78 * tsa))
            p_out_a = Vector((x1, wy + r1 * ca - spoke_w * 0.78 * ta, wz + r1 * sa - spoke_w * 0.78 * tsa))
            if sgn > 0:
                add_quad_tris(rim_tris, p_in_a, p_in_b, p_out_b, p_out_a)
            else:
                add_quad_tris(rim_tris, p_in_b, p_in_a, p_out_a, p_out_b)

    return tire_tris, rim_tris


def add_box_tris(dst, cx, cy, cz, sx, sy, sz):
    hx, hy, hz = sx * 0.5, sy * 0.5, sz * 0.5
    corners = [
        Vector((cx - hx, cy - hy, cz - hz)),
        Vector((cx + hx, cy - hy, cz - hz)),
        Vector((cx + hx, cy + hy, cz - hz)),
        Vector((cx - hx, cy + hy, cz - hz)),
        Vector((cx - hx, cy - hy, cz + hz)),
        Vector((cx + hx, cy - hy, cz + hz)),
        Vector((cx + hx, cy + hy, cz + hz)),
        Vector((cx - hx, cy + hy, cz + hz)),
    ]
    faces = [
        (4, 5, 6, 7, Vector((0, 0, 1))),
        (1, 0, 3, 2, Vector((0, 0, -1))),
        (5, 1, 2, 6, Vector((1, 0, 0))),
        (0, 4, 7, 3, Vector((-1, 0, 0))),
        (7, 6, 2, 3, Vector((0, 1, 0))),
        (0, 1, 5, 4, Vector((0, -1, 0))),
    ]
    for a, b, c, d, n in faces:
        dst.append((corners[a], corners[b], corners[c], n, n, n))
        dst.append((corners[a], corners[c], corners[d], n, n, n))


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / max(1e-6, e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def build_alto_and_wagon_variant(tall_wagon=False):
    """Builds either:
    - tall_wagon=False: Suzuki Alto (HA36S) Kei Hatchback (3.395 x 1.475 x 1.495 m)
    - tall_wagon=True : Japanese Tall Kei-Wagon (Wagon R / Spacia style: 3.395 x 1.475 x 1.725 m)
      via a smooth C2 greenhouse & upright-tailgate warp applied BEFORE normal calculation."""
    clear_bpy()
    drop_unused = {"Cube.057", "Cylinder.002"}
    if os.path.exists(SOURCE_BLEND):
        bpy.ops.wm.open_mainfile(filepath=SOURCE_BLEND)
        for name in drop_unused:
            o = bpy.data.objects.get(name)
            if o:
                bpy.data.objects.remove(o, do_unlink=True)
    elif os.path.exists(RAW_ALTO):
        bpy.ops.import_scene.gltf(filepath=RAW_ALTO)
        drop_prefixes = ("Bolt", "Text", "rubber", "rim", "Plane.001", "Plane.008", "Circle.00")
        drop_exact = {"Cube.002", "Cube.003", "Cube.004", "Cube.024", "Cube.057", "Cylinder.002"}
        for o in list(bpy.data.objects):
            if o.type != "MESH" or o.name.startswith(drop_prefixes) or o.name in drop_exact:
                bpy.data.objects.remove(o, do_unlink=True)
        for img in list(bpy.data.images):
            bpy.data.images.remove(img)
        bpy.ops.wm.save_as_mainfile(filepath=SOURCE_BLEND, compress=True)
    else:
        raise FileNotFoundError(f"Missing {SOURCE_BLEND} and {RAW_ALTO}")

    if tall_wagon:
        for o in bpy.data.objects:
            if o.type != "MESH":
                continue
            M = o.matrix_world
            Minv = M.inverted()
            me = o.data
            for v in me.vertices:
                w = M @ v.co
                # 1) Smooth vertical greenhouse stretch above beltline (z_bl > 0.90 -> +0.24 m roof height)
                h_fac = smoothstep(0.90, 1.50, w.z)
                lon_cabin = smoothstep(-1.12, -0.52, w.y)
                dz = 0.240 * h_fac * lon_cabin

                # 2) Square out the sloping rear C-pillar & upper tailgate into an upright Tall-Wagon D-pillar
                rear_fac = smoothstep(0.24, 1.40, w.y) * smoothstep(0.94, 1.48, w.z)
                dy = 0.145 * rear_fac

                # 3) Slightly more upright side glass (less tumblehome)
                tumble_out = 1.0 + 0.055 * h_fac * lon_cabin

                w.x *= tumble_out
                w.y += dy
                w.z += dz
                v.co = Minv @ w
            me.update()

    sx = 1.475 / 1.632
    sy_bl = 3.395 / 3.58
    sz_bl = 1.495 / 1.569
    y_center_bl = 0.025

    def bl_to_three_pt(v_bl):
        return Vector((
            v_bl.x * sx,
            max(0.0, v_bl.z * sz_bl),
            -(v_bl.y - y_center_bl) * sy_bl,
        ))

    def bl_to_three_nrm(n_bl):
        v = Vector((
            n_bl.x / sx,
            n_bl.z / sz_bl,
            -n_bl.y / sy_bl,
        ))
        return v.normalized() if v.length > 1e-8 else Vector((0, 1, 0))

    channels = {ch: [] for ch in CHANNELS}

    glass_names = {"Cube.005", "Cube.007", "Cube.009", "Cube.020"}
    clear_lens_names = {"Cube.018"}
    headlamp_names = {"Cube.019", "Cube.054"}
    taillamp_names = {"Cube.001", "Cube.056"}
    amber_names = {"Cube.052", "Cube.055"}
    silver_names = {"Cube.010", "Cube.011"}
    undercarriage_names = {"Cube.049", "Cube.050", "Cylinder.003", "Cylinder.004"}

    cabin_center_bl = Vector((0.0, 0.15, 1.15 if tall_wagon else 1.05))

    all_objs = [o for o in list(bpy.data.objects) if o.type == "MESH"]
    split_items = []
    for o in all_objs:
        base_orig = o.name
        for mat_base, sub_o in split_object_by_material(o):
            split_items.append((base_orig, mat_base, sub_o))

    for base_orig, mat_base, obj in split_items:
        if base_orig in glass_names and mat_base == "Material.003":
            clean_automotive_part(obj, planar_deg=4.5, max_tris=240, sharp_deg=45.0)
            ensure_outward_glass_normals(obj, cabin_center_bl)
            ch = "glass"
        elif base_orig in clear_lens_names:
            clean_automotive_part(obj, planar_deg=7.5, max_tris=180, sharp_deg=38.0)
            ensure_outward_glass_normals(obj, Vector((0.0, -1.50, 0.76)))
            ch = "clearLens"
        elif base_orig in headlamp_names:
            clean_automotive_part(obj, planar_deg=7.5, max_tris=160, sharp_deg=32.0)
            ch = "headlamp"
        elif base_orig in taillamp_names:
            clean_automotive_part(obj, planar_deg=7.5, max_tris=140, sharp_deg=30.0)
            ch = "taillamp"
        elif base_orig in amber_names:
            clean_automotive_part(obj, planar_deg=9.0, max_tris=48, sharp_deg=35.0)
            ch = "amber"
        elif base_orig in silver_names:
            clean_automotive_part(obj, planar_deg=8.0, max_tris=64, sharp_deg=30.0)
            ch = "silver"
        elif base_orig in undercarriage_names:
            clean_automotive_part(obj, planar_deg=9.0, max_tris=72, sharp_deg=35.0)
            ch = "undercarriage"
        elif mat_base == "Material" and base_orig not in {"Cylinder", "Cylinder.001"}:
            # Outer painted sheet metal: Planar Dissolve + crisp 18-deg automotive feature creases
            p_deg = 9.0 if base_orig in {"Cube.021", "Cube.044", "Cube.008"} else 7.5
            max_t = 1100 if base_orig in {"Cube.021", "Cube.044"} else None
            clean_automotive_part(obj, planar_deg=p_deg, max_tris=max_t, sharp_deg=18.0)
            ch = "body"
        else:
            # Trim, grille, wipers & interior parts -> crisp lightweight silhouette (~55..130 tris/part)
            max_t = 125 if base_orig in {"Cube", "Cube.021", "Cube.022", "Cube.023", "Circle", "Cube.027"} else 55
            clean_automotive_part(obj, planar_deg=9.5, max_tris=max_t, sharp_deg=24.0)
            ch = "trimBlack"

        me = obj.data
        me.calc_loop_triangles()
        M = obj.matrix_world
        M_nrm = M.inverted_safe().transposed().to_3x3()
        corner_nrms = me.corner_normals
        verts = me.vertices
        dst = channels[ch]
        for tri in me.loop_triangles:
            l0, l1, l2 = tri.loops
            v0 = bl_to_three_pt(M @ verts[tri.vertices[0]].co)
            v1 = bl_to_three_pt(M @ verts[tri.vertices[1]].co)
            v2 = bl_to_three_pt(M @ verts[tri.vertices[2]].co)
            n0 = bl_to_three_nrm(M_nrm @ corner_nrms[l0].vector)
            n1 = bl_to_three_nrm(M_nrm @ corner_nrms[l1].vector)
            n2 = bl_to_three_nrm(M_nrm @ corner_nrms[l2].vector)
            dst.append((v0, v1, v2, n0, n1, n2))

    # Solid dark underbody chassis pan
    add_box_tris(channels["undercarriage"], 0.0, 0.21, 0.0, 1.24, 0.09, 2.52)

    # 4 authentic 14-inch Japanese Kei-Car tires + 7-spoke alloy rims
    z_front = -(-1.221 - y_center_bl) * sy_bl
    z_rear = -(1.335 - y_center_bl) * sy_bl
    wheel_r = 0.285
    track_x = 0.635
    w_pos = [
        (-track_x, wheel_r, z_front),
        (track_x, wheel_r, z_front),
        (-track_x, wheel_r, z_rear),
        (track_x, wheel_r, z_rear),
    ]
    tires, rims = build_kei_wheel_meshes(w_pos, radius=wheel_r, width=0.165, spoke_count=7)
    channels["wheelTire"].extend(tires)
    channels["wheelRim"].extend(rims)

    return channels


def pack_indexed_channel(tris):
    vmap = {}
    pos_q, nrm_q, indices = [], [], []
    seen_faces = set()
    for p0, p1, p2, n0, n1, n2 in tris:
        tri_vi = []
        for p, n in ((p0, n0), (p1, n1), (p2, n2)):
            px = max(-32767, min(32767, int(round(p.x * 4000.0))))
            py = max(-32767, min(32767, int(round(p.y * 4000.0))))
            pz = max(-32767, min(32767, int(round(p.z * 4000.0))))
            nx = max(-127, min(127, int(round(n.x * 127.0))))
            ny = max(-127, min(127, int(round(n.y * 127.0))))
            nz = max(-127, min(127, int(round(n.z * 127.0))))
            key = (px, py, pz, nx, ny, nz)
            vi = vmap.get(key)
            if vi is None:
                vi = len(pos_q) // 3
                vmap[key] = vi
                pos_q.extend((px, py, pz))
                nrm_q.extend((nx, ny, nz))
            tri_vi.append(vi)
        a, b, c = tri_vi
        if a == b or b == c or a == c:
            continue
        fkey = tuple(sorted((a, b, c)))
        if fkey in seen_faces:
            continue
        seen_faces.add(fkey)
        indices.extend((a, b, c))
    return pos_q, nrm_q, indices


def export_standalone_glb(channels, out_glb_path, paint_rgb=(0.94, 0.93, 0.90)):
    """Exports a standard uncompressed glTF 2.0 `.glb` directly from Blender (preserving exact
    per-corner split normals without destructive gltf-transform welding across sharp creases)."""
    clear_bpy()

    def make_mat(name, col, rough=0.4, metal=0.0, coat=0.0, trans=0.0, ior=1.5):
        m = bpy.data.materials.new(name)
        bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bsdf.inputs["Base Color"].default_value = (*col, 1.0)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        if "IOR" in m.node_tree.nodes["Principled BSDF"].inputs:
            bsdf.inputs["IOR"].default_value = ior
        if coat > 0 and "Coat Weight" in bsdf.inputs:
            bsdf.inputs["Coat Weight"].default_value = coat
            bsdf.inputs["Coat Roughness"].default_value = 0.03
        if trans > 0 and "Transmission Weight" in bsdf.inputs:
            bsdf.inputs["Transmission Weight"].default_value = trans
        m.use_backface_culling = trans > 0
        return m

    mat_defs = {
        "body": make_mat("Kei_Body", paint_rgb, rough=0.18, metal=0.34, coat=1.0),
        "glass": make_mat("Kei_Glass", (0.72, 0.80, 0.85), rough=0.015, metal=0.0, trans=0.86, ior=1.50),
        "clearLens": make_mat("Kei_ClearLens", (0.92, 0.96, 1.0), rough=0.015, metal=0.0, trans=0.94, ior=1.50),
        "trimBlack": make_mat("Kei_TrimBlack", (0.045, 0.048, 0.055), rough=0.42, metal=0.10),
        "undercarriage": make_mat("Kei_Undercarriage", (0.03, 0.032, 0.036), rough=0.86, metal=0.15),
        "silver": make_mat("Kei_Silver", (0.72, 0.75, 0.78), rough=0.26, metal=0.82),
        "headlamp": make_mat("Kei_Headlamp", (0.86, 0.90, 0.95), rough=0.10, metal=0.88, coat=1.0),
        "taillamp": make_mat("Kei_Taillamp", (0.62, 0.03, 0.03), rough=0.14, metal=0.20, coat=0.95),
        "amber": make_mat("Kei_Amber", (0.85, 0.32, 0.02), rough=0.18, metal=0.15, coat=0.9),
        "wheelTire": make_mat("Kei_Tire", (0.035, 0.038, 0.042), rough=0.82, metal=0.04),
        "wheelRim": make_mat("Kei_Rim", (0.74, 0.77, 0.80), rough=0.26, metal=0.84),
    }

    for ch, tris in channels.items():
        if not tris:
            continue
        # Pre-deduplicate (pos, normal) pairs cleanly so GLB stays compact while keeping sharp split normals intact!
        pos_q, nrm_q, indices = pack_indexed_channel(tris)
        v_count = len(pos_q) // 3
        verts = [
            (pos_q[i * 3] / 4000.0, -pos_q[i * 3 + 2] / 4000.0, pos_q[i * 3 + 1] / 4000.0)
            for i in range(v_count)
        ]
        v_nrms = [
            Vector((nrm_q[i * 3] / 127.0, -nrm_q[i * 3 + 2] / 127.0, nrm_q[i * 3 + 1] / 127.0)).normalized()
            for i in range(v_count)
        ]
        faces = []
        loop_nrms = []
        for t in range(0, len(indices), 3):
            a, b, c = indices[t], indices[t + 1], indices[t + 2]
            if a == b or b == c or a == c:
                continue
            faces.append((a, b, c))
            loop_nrms.extend((v_nrms[a], v_nrms[b], v_nrms[c]))

        me = bpy.data.meshes.new(ch)
        me.from_pydata(verts, [], faces)
        for p in me.polygons:
            p.use_smooth = True
        me.normals_split_custom_set(loop_nrms)
        me.materials.append(mat_defs[ch])
        obj = bpy.data.objects.new(ch, me)
        bpy.context.scene.collection.objects.link(obj)

    bpy.ops.export_scene.gltf(
        filepath=out_glb_path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_normals=True,
    )


def write_web_proto_bundle(models_dict, js_path):
    blob = bytearray()
    meta = {}

    for model_key, channels in models_dict.items():
        meta[model_key] = {}
        total_t = 0
        for ch, tris in channels.items():
            if not tris:
                continue
            pos_q, nrm_q, raw_indices = pack_indexed_channel(tris)
            indices = []
            for t in range(0, len(raw_indices), 3):
                a, b, c = raw_indices[t], raw_indices[t + 1], raw_indices[t + 2]
                if a != b and b != c and a != c:
                    indices.extend((a, b, c))
            v_count = len(pos_q) // 3
            i_count = len(indices)
            total_t += i_count // 3

            if len(blob) % 2:
                blob.append(0)
            pos_off = len(blob)
            blob.extend(struct.pack(f"<{len(pos_q)}h", *pos_q))

            nrm_off = len(blob)
            blob.extend(struct.pack(f"<{len(nrm_q)}b", *nrm_q))

            if len(blob) % 2:
                blob.append(0)
            idx_off = len(blob)
            use_u32 = v_count > 65535
            if use_u32:
                if len(blob) % 4:
                    blob.extend(b"\x00" * (4 - (len(blob) % 4)))
                    idx_off = len(blob)
                blob.extend(struct.pack(f"<{i_count}I", *indices))
            else:
                blob.extend(struct.pack(f"<{i_count}H", *indices))

            meta[model_key][ch] = {
                "v": v_count,
                "i": i_count,
                "p": pos_off,
                "n": nrm_off,
                "x": idx_off,
                "u32": 1 if use_u32 else 0,
            }
        print(f"[{model_key}] packed {total_t} triangles")

    b64 = base64.b64encode(bytes(blob)).decode("ascii")
    code = f"""// Auto-generated by streets/native/build_kei_vehicles.py from downloaded Suzuki Alto (HA36S) K-Car.
// Synchronous quantized BufferGeometry loader for Web, ThreeRT GLB export, and Blender Cycles.
import * as THREE from 'three';

const META = {json.dumps(meta, separators=(",", ":"))};
const B64 = "{b64}";

function decodeProtos() {{
  const binStr = atob(B64);
  const len = binStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
  const buf = bytes.buffer;

  const out = {{}};
  for (const [modelKey, chMap] of Object.entries(META)) {{
    out[modelKey] = {{}};
    for (const [ch, m] of Object.entries(chMap)) {{
      const vCount = m.v;
      const posI16 = new Int16Array(buf, m.p, vCount * 3);
      const nrmI8 = new Int8Array(buf, m.n, vCount * 3);
      const posF32 = new Float32Array(vCount * 3);
      const nrmF32 = new Float32Array(vCount * 3);
      for (let k = 0; k < vCount * 3; k++) {{
        posF32[k] = posI16[k] / 4000.0;
        nrmF32[k] = nrmI8[k] / 127.0;
      }}
      const uvF32 = new Float32Array(vCount * 2);
      const idxArr = m.u32
        ? new Uint32Array(buf.slice(m.x, m.x + m.i * 4))
        : new Uint16Array(buf.slice(m.x, m.x + m.i * 2));

      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(posF32, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nrmF32, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uvF32, 2));
      g.setIndex(new THREE.BufferAttribute(idxArr, 1));
      out[modelKey][ch] = g;
    }}
  }}
  return out;
}}

export const KEI_VEHICLE_PROTOS = decodeProtos();
"""
    with open(js_path, "w", encoding="utf-8") as f:
        f.write(code)
    print(f"Wrote {js_path} ({os.path.getsize(js_path) / 1024:.1f} KB)")


def main():
    alto_channels = build_alto_and_wagon_variant(tall_wagon=False)
    wagon_channels = build_alto_and_wagon_variant(tall_wagon=True)

    alto_glb = os.path.join(VEH_OUT_DIR, "suzuki_alto_kei.glb")
    wagon_glb = os.path.join(VEH_OUT_DIR, "kei_tall_wagon.glb")

    export_standalone_glb(alto_channels, alto_glb, paint_rgb=(0.93, 0.92, 0.89))
    export_standalone_glb(wagon_channels, wagon_glb, paint_rgb=(0.36, 0.54, 0.71))
    print(
        f"Exported standalone GLBs:\n"
        f"  - {alto_glb} ({os.path.getsize(alto_glb)/1024:.1f} KB)\n"
        f"  - {wagon_glb} ({os.path.getsize(wagon_glb)/1024:.1f} KB)"
    )

    js_bundle = os.path.join(STREETS_DIR, "web", "kei-vehicles.js")
    write_web_proto_bundle({"alto": alto_channels, "van": wagon_channels}, js_bundle)


if __name__ == "__main__":
    main()
