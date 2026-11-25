"""Hybrid offline Cycles interiors for Playground streets (Apple Metal GPU compatible, zero OSL):

1. Ground-floor (1F) commercial storefronts (`shop_kissaten`, `shop_bookstore`, `shop_izakaya`,
   `shop_ramen`, `shop_pharmacy`, `shop_konbini_bay`):
   - Hollow bays (clear >= 2.5 m behind the storefront) are upgraded to TRUE 3D FURNISHED ROOMS
     built cleanly via `bmesh` (real walls, beamed/grid ceiling, glowing 3D pendant globes / LED
     strips / chochin, wooden counters, bookshelves, product gondolas, tables & stools), while the
     storefront's existing `emissiveMap` masks the glass panes into physical reflective transparent
     glass (shadow-ray transparent so interior lamps cast real light & wooden-lattice shadows onto
     the sidewalk!) and keeps all mullions, wainscoting, and koushi lattices crisp opaque matte.
   - Solid-backed storefront bays (where a structural 1F wall box sits < 2.5 m behind) fall back to
     a masked Cycles GPU Interior Mapping shader so no shop ever goes dark or clips.

2. Upper-storey & residential (一戸建て) windows (`window_lit_*`, `window_unlit*`):
   - Upgraded with a 100% native Cycles Metal GPU Shader Node Group (`Cycles_Interior_Mapping`)
     performing exact 3-plane analytic ray-box intersection in Blender Z-up space, reading the
     per-window integer `cellX` seed and `cellY` aspect ratio encoded in UV0 by `windowPaneBox()`,
     complete with flush Japanese LED ceiling light, shaded side walls, corner AO, mid-plane
     furniture silhouette card, pleated side curtains / Venetian blinds, and glossy clearcoat glass.
"""

import math
import random

import bmesh
import bpy
from mathutils import Vector

SHOP_TYPES = {
    "shop_kissaten": "kissaten",
    "shop_bookstore": "bookstore",
    "shop_konbini_bay": "konbini",
    "shop_pharmacy": "pharmacy",
    "shop_izakaya": "izakaya",
    "shop_ramen": "ramen",
}

WINDOW_CONFIGS = {
    "window_lit_warm": {
        "is_lit": True,
        "is_office": False,
        "is_shoji": False,
        "back_col": (0.64, 0.46, 0.28, 1.0),
        "side_col": (0.33, 0.22, 0.12, 1.0),
        "ceil_col": (0.42, 0.36, 0.30, 1.0),
        "floor_col": (0.16, 0.09, 0.04, 1.0),
        "light_col": (1.00, 0.64, 0.26, 1.0),
        "drape_col": (0.24, 0.19, 0.15, 1.0),
    },
    "window_lit_modern": {
        "is_lit": True,
        "is_office": False,
        "is_shoji": False,
        "back_col": (0.58, 0.56, 0.52, 1.0),
        "side_col": (0.30, 0.30, 0.31, 1.0),
        "ceil_col": (0.42, 0.42, 0.44, 1.0),
        "floor_col": (0.18, 0.13, 0.08, 1.0),
        "light_col": (1.00, 0.86, 0.66, 1.0),
        "drape_col": (0.20, 0.22, 0.25, 1.0),
    },
    "window_lit_office": {
        "is_lit": True,
        "is_office": True,
        "is_shoji": False,
        "back_col": (0.54, 0.60, 0.68, 1.0),
        "side_col": (0.28, 0.33, 0.40, 1.0),
        "ceil_col": (0.38, 0.42, 0.48, 1.0),
        "floor_col": (0.11, 0.13, 0.16, 1.0),
        "light_col": (0.74, 0.88, 1.00, 1.0),
        "drape_col": (0.28, 0.31, 0.35, 1.0),
    },
    "window_lit_amber": {
        "is_lit": True,
        "is_office": False,
        "is_shoji": True,
        "back_col": (0.95, 0.54, 0.18, 1.0),
        "side_col": (0.72, 0.38, 0.12, 1.0),
        "ceil_col": (0.85, 0.48, 0.16, 1.0),
        "floor_col": (0.48, 0.24, 0.08, 1.0),
        "light_col": (1.00, 0.58, 0.20, 1.0),
        "drape_col": (0.06, 0.03, 0.015, 1.0),
    },
    "window_unlit": {
        "is_lit": False,
        "is_office": False,
        "is_shoji": False,
        "back_col": (0.05, 0.065, 0.085, 1.0),
        "side_col": (0.03, 0.04, 0.055, 1.0),
        "ceil_col": (0.06, 0.075, 0.095, 1.0),
        "floor_col": (0.025, 0.022, 0.02, 1.0),
        "light_col": (0.0, 0.0, 0.0, 1.0),
        "drape_col": (0.14, 0.16, 0.18, 1.0),
    },
    "window_unlit_blinds": {
        "is_lit": False,
        "is_office": True,
        "is_shoji": False,
        "back_col": (0.045, 0.06, 0.08, 1.0),
        "side_col": (0.03, 0.04, 0.055, 1.0),
        "ceil_col": (0.06, 0.075, 0.095, 1.0),
        "floor_col": (0.025, 0.025, 0.03, 1.0),
        "light_col": (0.0, 0.0, 0.0, 1.0),
        "drape_col": (0.15, 0.17, 0.20, 1.0),
    },
}


# ------------------------------------------------------------------ NODE-BUILDING HELPERS

def _math(nt, op, a=None, b=None, c=None, clamp=False):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    if a is not None:
        if isinstance(a, (int, float)):
            n.inputs[0].default_value = float(a)
        else:
            nt.links.new(a, n.inputs[0])
    if b is not None:
        if isinstance(b, (int, float)):
            n.inputs[1].default_value = float(b)
        else:
            nt.links.new(b, n.inputs[1])
    if c is not None and len(n.inputs) > 2:
        if isinstance(c, (int, float)):
            n.inputs[2].default_value = float(c)
        else:
            nt.links.new(c, n.inputs[2])
    return n.outputs[0]


def _vmath(nt, op, a=None, b=None, scale=None):
    n = nt.nodes.new("ShaderNodeVectorMath")
    n.operation = op
    if a is not None:
        if isinstance(a, tuple):
            n.inputs[0].default_value = a
        else:
            nt.links.new(a, n.inputs[0])
    if b is not None:
        if isinstance(b, tuple):
            n.inputs[1].default_value = b
        else:
            nt.links.new(b, n.inputs[1])
    if scale is not None:
        if isinstance(scale, (int, float)):
            n.inputs["Scale"].default_value = float(scale)
        else:
            nt.links.new(scale, n.inputs["Scale"])
    return n.outputs["Value"] if op in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else n.outputs["Vector"]


def _mix_float(nt, fac, a, b, clamp=True):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "FLOAT"
    n.clamp_factor = clamp
    if isinstance(fac, (int, float)):
        n.inputs[0].default_value = float(fac)
    else:
        nt.links.new(fac, n.inputs[0])
    if isinstance(a, (int, float)):
        n.inputs[2].default_value = float(a)
    else:
        nt.links.new(a, n.inputs[2])
    if isinstance(b, (int, float)):
        n.inputs[3].default_value = float(b)
    else:
        nt.links.new(b, n.inputs[3])
    return n.outputs[0]


def _mix_color(nt, fac, a, b, blend="MIX", clamp=True):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    n.blend_type = blend
    n.clamp_factor = clamp
    if isinstance(fac, (int, float)):
        n.inputs[0].default_value = float(fac)
    else:
        nt.links.new(fac, n.inputs[0])
    if isinstance(a, tuple):
        n.inputs[6].default_value = a
    else:
        nt.links.new(a, n.inputs[6])
    if isinstance(b, tuple):
        n.inputs[7].default_value = b
    else:
        nt.links.new(b, n.inputs[7])
    return n.outputs[2]


def _smoothstep(nt, edge0, edge1, x):
    n = nt.nodes.new("ShaderNodeMapRange")
    n.interpolation_type = "SMOOTHSTEP"
    n.clamp = True
    if isinstance(edge0, (int, float)):
        n.inputs["From Min"].default_value = float(edge0)
    else:
        nt.links.new(edge0, n.inputs["From Min"])
    if isinstance(edge1, (int, float)):
        n.inputs["From Max"].default_value = float(edge1)
    else:
        nt.links.new(edge1, n.inputs["From Max"])
    n.inputs["To Min"].default_value = 0.0
    n.inputs["To Max"].default_value = 1.0
    nt.links.new(x, n.inputs["Value"])
    return n.outputs["Result"]


def _box_mask(nt, x, y, x0, y0, x1, y1):
    m1 = _math(nt, "GREATER_THAN", x, x0)
    m2 = _math(nt, "LESS_THAN", x, x1)
    m3 = _math(nt, "GREATER_THAN", y, y0)
    m4 = _math(nt, "LESS_THAN", y, y1)
    return _math(nt, "MULTIPLY", _math(nt, "MULTIPLY", m1, m2), _math(nt, "MULTIPLY", m3, m4))


# ------------------------------------------------------------------ PART 2: CYCLES GPU INTERIOR MAPPING NODE GROUP

def get_or_create_interior_nodegroup():
    """Creates a Metal-GPU-native Cycles Shader Node Group for 3D parallax Interior Mapping."""
    name = "Cycles_Interior_Mapping_v1"
    if name in bpy.data.node_groups:
        return bpy.data.node_groups[name]

    ng = bpy.data.node_groups.new(name, "ShaderNodeTree")
    iface = ng.interface

    def add_in(sname, stype, default=None):
        s = iface.new_socket(name=sname, in_out="INPUT", socket_type=stype)
        if default is not None:
            s.default_value = default
        return s

    add_in("Back Color", "NodeSocketColor", (0.64, 0.46, 0.28, 1.0))
    add_in("Side Color", "NodeSocketColor", (0.33, 0.22, 0.12, 1.0))
    add_in("Ceil Color", "NodeSocketColor", (0.42, 0.36, 0.30, 1.0))
    add_in("Floor Color", "NodeSocketColor", (0.16, 0.09, 0.04, 1.0))
    add_in("Light Color", "NodeSocketColor", (1.00, 0.64, 0.26, 1.0))
    add_in("Drape Color", "NodeSocketColor", (0.24, 0.19, 0.15, 1.0))
    add_in("Is Lit", "NodeSocketFloat", 1.0)
    add_in("Is Office", "NodeSocketFloat", 0.0)
    add_in("Is Shoji", "NodeSocketFloat", 0.0)

    iface.new_socket(name="Albedo", in_out="OUTPUT", socket_type="NodeSocketColor")
    iface.new_socket(name="Emission", in_out="OUTPUT", socket_type="NodeSocketColor")

    gi = ng.nodes.new("NodeGroupInput")
    go = ng.nodes.new("NodeGroupOutput")

    # 1. Decode per-window cell seed & aspect ratio from glTF-imported UV0:
    #    u in [cellX + 0.002 .. cellX + 0.998], v in [-cellY + 0.002 .. -cellY + 0.998] (inverted vertical)
    uv_node = ng.nodes.new("ShaderNodeUVMap")
    sep_uv = ng.nodes.new("ShaderNodeSeparateXYZ")
    ng.links.new(uv_node.outputs["UV"], sep_uv.inputs["Vector"])

    cell_x = _math(ng, "FLOOR", sep_uv.outputs["X"])
    cell_y_raw = _math(ng, "ABSOLUTE", _math(ng, "FLOOR", sep_uv.outputs["Y"]))
    u_loc = _math(ng, "FRACT", sep_uv.outputs["X"])
    v_up = _math(ng, "SUBTRACT", 1.0, _math(ng, "FRACT", sep_uv.outputs["Y"]))

    # Aspect ratio from cellY (if cellY >= 2 -> cellY * 0.1, else default 1.2)
    has_aspect = _math(ng, "GREATER_THAN", cell_y_raw, 1.5)
    aspect_raw = _math(ng, "MULTIPLY", cell_y_raw, 0.1)
    aspect_clamped = _math(ng, "MINIMUM", _math(ng, "MAXIMUM", aspect_raw, 0.45), 3.4)
    aspect = _mix_float(ng, has_aspect, 1.2, aspect_clamped)

    # Per-window deterministic random numbers via GPU-native 2D White Noise
    comb_seed1 = ng.nodes.new("ShaderNodeCombineXYZ")
    ng.links.new(cell_x, comb_seed1.inputs["X"])
    ng.links.new(cell_y_raw, comb_seed1.inputs["Y"])
    wn1 = ng.nodes.new("ShaderNodeTexWhiteNoise")
    wn1.noise_dimensions = "2D"
    ng.links.new(comb_seed1.outputs["Vector"], wn1.inputs["Vector"])
    sep_r1 = ng.nodes.new("ShaderNodeSeparateColor")
    ng.links.new(wn1.outputs["Color"], sep_r1.inputs["Color"])
    r1x, r1y, r1z = sep_r1.outputs["Red"], sep_r1.outputs["Green"], sep_r1.outputs["Blue"]

    comb_seed2 = ng.nodes.new("ShaderNodeCombineXYZ")
    ng.links.new(_math(ng, "ADD", cell_x, 37.3), comb_seed2.inputs["X"])
    ng.links.new(_math(ng, "ADD", cell_y_raw, 91.7), comb_seed2.inputs["Y"])
    wn2 = ng.nodes.new("ShaderNodeTexWhiteNoise")
    wn2.noise_dimensions = "2D"
    ng.links.new(comb_seed2.outputs["Vector"], wn2.inputs["Vector"])
    sep_r2 = ng.nodes.new("ShaderNodeSeparateColor")
    ng.links.new(wn2.outputs["Color"], sep_r2.inputs["Color"])
    r2x, r2y, r2z = sep_r2.outputs["Red"], sep_r2.outputs["Green"], sep_r2.outputs["Blue"]

    # 2. Construct Blender Z-up window tangent frame (B = (0,0,1), T = normalize(cross(B, N)))
    geom = ng.nodes.new("ShaderNodeNewGeometry")
    nrm = geom.outputs["Normal"]
    # Ray pointing FROM camera INTO room = -Incoming
    ray_world = _vmath(ng, "SCALE", geom.outputs["Incoming"], scale=-1.0)
    t_vec = _vmath(ng, "NORMALIZE", _vmath(ng, "CROSS_PRODUCT", (0.0, 0.0, 1.0), nrm))

    dx = _vmath(ng, "DOT_PRODUCT", ray_world, t_vec)
    dy = _vmath(ng, "DOT_PRODUCT", ray_world, (0.0, 0.0, 1.0))
    dz_raw = _vmath(ng, "DOT_PRODUCT", ray_world, nrm)
    dz = _math(ng, "MINIMUM", dz_raw, -0.002)

    # Fresnel attenuation at grazing angles
    ndotv = _math(ng, "MAXIMUM", _math(ng, "MULTIPLY", dz_raw, -1.0), 0.0)
    fresnel = _math(ng, "POWER", _math(ng, "SUBTRACT", 1.0, ndotv, clamp=True), 4.0)
    glass_transmit = _math(ng, "SUBTRACT", 1.0, _math(ng, "MULTIPLY", fresnel, 0.45), clamp=True)

    # 3. Tight room box around window aperture (matching Web v2 proportions!)
    hw = _math(ng, "MULTIPLY", aspect, 0.5)
    rx = _math(ng, "MULTIPLY", hw, _math(ng, "ADD", 1.05, _math(ng, "MULTIPLY", r1x, 0.16)))
    ry = _math(ng, "ADD", 0.54, _math(ng, "MULTIPLY", r1y, 0.08))
    rz = _math(ng, "ADD", 1.05, _math(ng, "MULTIPLY", r1z, 0.65))

    px = _math(ng, "MULTIPLY", _math(ng, "SUBTRACT", u_loc, 0.5), aspect)
    py = _math(ng, "ADD", _math(ng, "SUBTRACT", v_up, 0.5), 0.03)

    # Analytic 3-plane ray-box intersection
    # tx = ((dx > 0 ? rx : -rx) - px) / dx
    dx_pos = _math(ng, "GREATER_THAN", dx, 0.0)
    target_x = _mix_float(ng, dx_pos, _math(ng, "MULTIPLY", rx, -1.0), rx)
    dx_safe = _math(ng, "GREATER_THAN", _math(ng, "ABSOLUTE", dx), 1e-4)
    tx_val = _math(ng, "DIVIDE", _math(ng, "SUBTRACT", target_x, px), _mix_float(ng, dx_safe, 1.0, dx))
    tx = _mix_float(ng, dx_safe, 1e5, tx_val)

    # ty = ((dy > 0 ? ry : -ry) - py) / dy
    dy_pos = _math(ng, "GREATER_THAN", dy, 0.0)
    target_y = _mix_float(ng, dy_pos, _math(ng, "MULTIPLY", ry, -1.0), ry)
    dy_safe = _math(ng, "GREATER_THAN", _math(ng, "ABSOLUTE", dy), 1e-4)
    ty_val = _math(ng, "DIVIDE", _math(ng, "SUBTRACT", target_y, py), _mix_float(ng, dy_safe, 1.0, dy))
    ty = _mix_float(ng, dy_safe, 1e5, ty_val)

    # tz = -rz / dz
    tz = _math(ng, "DIVIDE", _math(ng, "MULTIPLY", rz, -1.0), dz)

    t_xy = _math(ng, "MINIMUM", tx, ty)
    t_hit = _math(ng, "MINIMUM", tz, t_xy)

    hit_x = _math(ng, "ADD", px, _math(ng, "MULTIPLY", dx, t_hit))
    hit_y = _math(ng, "ADD", py, _math(ng, "MULTIPLY", dy, t_hit))
    hit_z = _math(ng, "MULTIPLY", dz, t_hit)

    # Face identification masks
    is_side = _math(ng, "LESS_THAN", tx, _math(ng, "MINIMUM", ty, tz))
    is_y_face = _math(ng, "LESS_THAN", ty, _math(ng, "MINIMUM", tx, tz))
    is_ceil = _math(ng, "MULTIPLY", is_y_face, dy_pos)
    is_floor = _math(ng, "MULTIPLY", is_y_face, _math(ng, "SUBTRACT", 1.0, dy_pos))

    # Normalized hit coordinates in [0..1]
    u_back = _math(ng, "ADD", _math(ng, "MULTIPLY", _math(ng, "DIVIDE", hit_x, rx), 0.5), 0.5, clamp=True)
    v_vert = _math(ng, "ADD", _math(ng, "MULTIPLY", _math(ng, "DIVIDE", hit_y, ry), 0.5), 0.5, clamp=True)
    u_depth = _math(ng, "DIVIDE", _math(ng, "MULTIPLY", hit_z, -1.0), rz, clamp=True)

    # Corner AO across the 5 box creases
    ao_x = _smoothstep(ng, 0.0, 0.14, _math(ng, "SUBTRACT", 1.0, _math(ng, "DIVIDE", _math(ng, "ABSOLUTE", hit_x), rx)))
    ao_y = _smoothstep(ng, 0.0, 0.14, _math(ng, "SUBTRACT", 1.0, _math(ng, "DIVIDE", _math(ng, "ABSOLUTE", hit_y), ry)))
    ao_z = _smoothstep(ng, 0.0, 0.16, _math(ng, "SUBTRACT", 1.0, u_depth))
    ao_base = _mix_float(ng, is_side, _math(ng, "MULTIPLY", ao_x, ao_y), _math(ng, "MULTIPLY", ao_y, ao_z))
    ao_base = _mix_float(ng, is_y_face, ao_base, _math(ng, "MULTIPLY", ao_x, ao_z))
    corner_ao = _math(ng, "ADD", 0.30, _math(ng, "MULTIPLY", ao_base, 0.70))

    # Baseboard & back-wall architectural artwork / shelf accents
    baseboard = _math(ng, "LESS_THAN", v_vert, 0.10)
    back_col = _mix_color(ng, baseboard, gi.outputs["Back Color"], gi.outputs["Floor Color"])
    # Optional framed wall art or cabinet on back wall
    art_x = _math(ng, "ADD", 0.32, _math(ng, "MULTIPLY", r2x, 0.36))
    art_frame = _box_mask(
        ng, u_back, v_vert,
        _math(ng, "SUBTRACT", art_x, 0.14), 0.52,
        _math(ng, "ADD", art_x, 0.14), 0.80,
    )
    back_col = _mix_color(ng, _math(ng, "MULTIPLY", art_frame, 0.75), back_col, (0.14, 0.11, 0.08, 1.0))

    side_col = _mix_color(ng, baseboard, gi.outputs["Side Color"], gi.outputs["Floor Color"])
    # Subtle depth darkening on side walls
    side_col = _mix_color(ng, _math(ng, "MULTIPLY", u_depth, 0.35), side_col, (0.04, 0.03, 0.03, 1.0))

    # Ceiling + iconic bright flush circular Japanese ceiling light (or office fluorescent strips)
    cd_x = _math(ng, "MULTIPLY", _math(ng, "SUBTRACT", u_back, 0.5), _math(ng, "MAXIMUM", aspect, 0.85))
    cd_z = _math(ng, "MULTIPLY", _math(ng, "SUBTRACT", u_depth, 0.42), 1.15)
    rad = _math(ng, "SQRT", _math(ng, "ADD", _math(ng, "MULTIPLY", cd_x, cd_x), _math(ng, "MULTIPLY", cd_z, cd_z)))
    res_disc = _math(ng, "SUBTRACT", 1.0, _smoothstep(ng, 0.15, 0.20, rad))
    res_halo = _math(ng, "SUBTRACT", 1.0, _smoothstep(ng, 0.18, 0.52, rad))
    res_fix = _math(ng, "ADD", _math(ng, "MULTIPLY", res_disc, 3.0), _math(ng, "MULTIPLY", res_halo, 0.35))

    off_s1 = _box_mask(ng, u_back, u_depth, 0.18, 0.18, 0.36, 0.78)
    off_s2 = _box_mask(ng, u_back, u_depth, 0.64, 0.18, 0.82, 0.78)
    off_fix = _math(ng, "MULTIPLY", _math(ng, "MAXIMUM", off_s1, off_s2), 2.8)
    ceil_fix = _math(ng, "MULTIPLY", is_ceil, _mix_float(ng, gi.outputs["Is Office"], res_fix, off_fix))

    # Select surface color across the 4 face types
    surf = _mix_color(ng, is_side, back_col, side_col)
    surf = _mix_color(ng, is_ceil, surf, gi.outputs["Ceil Color"])
    surf = _mix_color(ng, is_floor, surf, gi.outputs["Floor Color"])

    # Lighting falloff & face brightness separation
    face_gain = _mix_float(ng, is_side, 0.68, 0.52)
    face_gain = _mix_float(ng, is_ceil, face_gain, 0.36)
    face_gain = _mix_float(ng, is_floor, face_gain, 0.38)
    depth_fade = _mix_float(ng, u_depth, 1.08, 0.62)
    room_gain = _math(ng, "MULTIPLY", _math(ng, "MULTIPLY", face_gain, corner_ao), depth_fade)

    # Daytime interior albedo (dim recessed depth) + nighttime lit emission
    day_bounce = _math(ng, "MULTIPLY", _mix_float(ng, u_depth, 0.28, 0.06), corner_ao)
    room_alb = _mix_color(ng, day_bounce, (0.0, 0.0, 0.0, 1.0), surf)

    lit_surf = _mix_color(ng, 1.0, surf, gi.outputs["Light Color"], blend="MULTIPLY")
    room_emit = _mix_color(ng, _math(ng, "MULTIPLY", room_gain, gi.outputs["Is Lit"]), (0.0, 0.0, 0.0, 1.0), lit_surf)
    fix_col = _mix_color(ng, 1.0, gi.outputs["Light Color"], (1.0, 1.0, 1.0, 1.0))
    fix_scaled = _vmath(ng, "SCALE", fix_col, scale=_math(ng, "MULTIPLY", ceil_fix, gi.outputs["Is Lit"]))
    room_emit = _vmath(ng, "ADD", room_emit, fix_scaled)

    # 4. Mid-plane furniture silhouette card (3-layer parallax!)
    z_mid = _math(ng, "MULTIPLY", rz, _math(ng, "MULTIPLY", _math(ng, "ADD", 0.36, _math(ng, "MULTIPLY", r2y, 0.20)), -1.0))
    t_mid = _math(ng, "DIVIDE", z_mid, dz)
    mid_in_front = _math(ng, "MULTIPLY", _math(ng, "GREATER_THAN", t_mid, 0.0), _math(ng, "LESS_THAN", t_mid, t_hit))
    mid_x = _math(ng, "ADD", px, _math(ng, "MULTIPLY", dx, t_mid))
    mid_y = _math(ng, "ADD", py, _math(ng, "MULTIPLY", dy, t_mid))
    mx = _math(ng, "ADD", _math(ng, "MULTIPLY", _math(ng, "DIVIDE", mid_x, rx), 0.5), 0.5)
    my = _math(ng, "ADD", _math(ng, "MULTIPLY", _math(ng, "DIVIDE", mid_y, ry), 0.5), 0.5)
    in_bounds = _box_mask(ng, mx, my, 0.0, 0.0, 1.0, 1.0)

    # Layout A: table + sofa + floor lamp; Layout B: TV credenza + bookcase
    table_a = _box_mask(ng, mx, my, 0.16, 0.0, 0.72, 0.27)
    sofa_a = _box_mask(ng, mx, my, 0.24, 0.24, 0.64, 0.42)
    lamp_stem = _box_mask(ng, mx, my, 0.78, 0.0, 0.805, 0.56)
    lamp_shade = _box_mask(ng, mx, my, 0.72, 0.54, 0.86, 0.67)
    sil_a = _math(ng, "MAXIMUM", _math(ng, "MAXIMUM", table_a, sofa_a), _math(ng, "MAXIMUM", lamp_stem, lamp_shade))

    stand_b = _box_mask(ng, mx, my, 0.24, 0.0, 0.78, 0.26)
    tv_b = _box_mask(ng, mx, my, 0.32, 0.26, 0.70, 0.50)
    shelf_b = _box_mask(ng, mx, my, 0.04, 0.0, 0.20, 0.72)
    sil_b = _math(ng, "MAXIMUM", _math(ng, "MAXIMUM", stand_b, tv_b), shelf_b)

    pick_b = _math(ng, "GREATER_THAN", r2z, 0.5)
    furn_sil = _mix_float(ng, pick_b, sil_a, sil_b)
    furn_mask = _math(ng, "MULTIPLY", _math(ng, "MULTIPLY", mid_in_front, in_bounds), furn_sil)

    room_alb = _mix_color(ng, _math(ng, "MULTIPLY", furn_mask, 0.90), room_alb, (0.02, 0.018, 0.015, 1.0))
    room_emit = _mix_color(ng, _math(ng, "MULTIPLY", furn_mask, 0.92), room_emit, (0.03, 0.022, 0.016, 1.0))

    # Glowing floor lamp shade on layout A
    lamp_glow_m = _math(ng, "MULTIPLY", _math(ng, "MULTIPLY", mid_in_front, in_bounds), _math(ng, "MULTIPLY", lamp_shade, _math(ng, "SUBTRACT", 1.0, pick_b)))
    lamp_glow_v = _vmath(ng, "SCALE", gi.outputs["Light Color"], scale=_math(ng, "MULTIPLY", lamp_glow_m, _math(ng, "MULTIPLY", gi.outputs["Is Lit"], 1.35)))
    room_emit = _vmath(ng, "ADD", room_emit, lamp_glow_v)

    # 5. Window-plane foreground: parted pleated curtains (residential) or upper Venetian blinds (office)
    pleat = _math(ng, "ADD", 0.72, _math(ng, "MULTIPLY", _math(ng, "SINE", _math(ng, "MULTIPLY", u_loc, 64.0)), 0.28))
    drape_l = _math(ng, "ADD", 0.11, _math(ng, "MULTIPLY", r2x, 0.13))
    drape_r = _math(ng, "ADD", 0.11, _math(ng, "MULTIPLY", r2y, 0.13))
    in_open = _math(
        ng, "MULTIPLY",
        _smoothstep(ng, _math(ng, "SUBTRACT", drape_l, 0.015), _math(ng, "ADD", drape_l, 0.01), u_loc),
        _smoothstep(ng, _math(ng, "SUBTRACT", drape_r, 0.015), _math(ng, "ADD", drape_r, 0.01), _math(ng, "SUBTRACT", 1.0, u_loc)),
    )
    drape_mask = _math(ng, "MULTIPLY", _math(ng, "SUBTRACT", 1.0, in_open), 0.84)

    blind_drop = _math(ng, "SUBTRACT", 1.0, _math(ng, "ADD", 0.22, _math(ng, "MULTIPLY", r2x, 0.34)))
    in_blinds = _math(ng, "GREATER_THAN", v_up, blind_drop)
    slat = _math(ng, "ADD", 0.68, _math(ng, "MULTIPLY", _math(ng, "SINE", _math(ng, "MULTIPLY", v_up, 140.0)), 0.32))
    blind_mask = _math(ng, "MULTIPLY", in_blinds, 0.84)

    fg_mask = _mix_float(ng, gi.outputs["Is Office"], drape_mask, blind_mask)
    fg_pat = _mix_float(ng, gi.outputs["Is Office"], pleat, slat)
    fg_alb = _mix_color(ng, fg_pat, (0.04, 0.04, 0.04, 1.0), gi.outputs["Drape Color"])
    fg_emit = _vmath(ng, "SCALE", gi.outputs["Light Color"], scale=_math(ng, "MULTIPLY", _math(ng, "MULTIPLY", fg_pat, 0.22), gi.outputs["Is Lit"]))

    final_alb = _mix_color(ng, fg_mask, room_alb, fg_alb)
    final_emit = _mix_color(ng, fg_mask, room_emit, fg_emit)

    # Shoji override for traditional Machiya windows (wooden kumiko grid + warm diffused parallax glow)
    gx = _math(ng, "ABSOLUTE", _math(ng, "SUBTRACT", _math(ng, "FRACT", _math(ng, "MULTIPLY", u_loc, 4.0)), 0.5))
    gy = _math(ng, "ABSOLUTE", _math(ng, "SUBTRACT", _math(ng, "FRACT", _math(ng, "MULTIPLY", v_up, 5.0)), 0.5))
    shoji_wood = _math(ng, "MAXIMUM", _math(ng, "GREATER_THAN", gx, 0.445), _math(ng, "GREATER_THAN", gy, 0.445))
    shoji_alb = _mix_color(ng, shoji_wood, (0.48, 0.41, 0.32, 1.0), (0.04, 0.02, 0.01, 1.0))
    shoji_glow = _math(ng, "ADD", 0.32, _math(ng, "MULTIPLY", v_up, 0.45))
    shoji_emit = _mix_color(ng, shoji_wood, _vmath(ng, "SCALE", gi.outputs["Light Color"], scale=shoji_glow), (0.02, 0.01, 0.005, 1.0))

    final_alb = _mix_color(ng, gi.outputs["Is Shoji"], final_alb, shoji_alb)
    final_emit = _mix_color(ng, gi.outputs["Is Shoji"], final_emit, shoji_emit)

    # Outer jamb vignette + Fresnel transmission + per-window brightness diversity
    edge_d = _math(ng, "MINIMUM", _math(ng, "MINIMUM", u_loc, _math(ng, "SUBTRACT", 1.0, u_loc)),
                   _math(ng, "MINIMUM", v_up, _math(ng, "SUBTRACT", 1.0, v_up)))
    jamb_vig = _math(ng, "ADD", 0.58, _math(ng, "MULTIPLY", _smoothstep(ng, 0.0, 0.06, edge_d), 0.42))
    bright_var = _math(ng, "ADD", 0.72, _math(ng, "MULTIPLY", r1z, 0.48))
    scale_alb = _math(ng, "MULTIPLY", jamb_vig, glass_transmit)
    scale_emit = _math(ng, "MULTIPLY", scale_alb, bright_var)

    ng.links.new(_vmath(ng, "SCALE", final_alb, scale=scale_alb), go.inputs["Albedo"])
    ng.links.new(_vmath(ng, "SCALE", final_emit, scale=scale_emit), go.inputs["Emission"])
    return ng


def upgrade_window_materials():
    """Replaces window_lit_* and window_unlit* materials with Cycles Metal GPU Interior Mapping."""
    ng = get_or_create_interior_nodegroup()
    upgraded = 0
    for mat_name, cfg in WINDOW_CONFIGS.items():
        mat = bpy.data.materials.get(mat_name)
        if not mat or not mat.use_nodes:
            continue
        nt = mat.node_tree
        # Preserve original glTF Emission Strength (from offline_emissive.json) so render_cycles.py scales it!
        orig_emit_strength = 0.0
        for node in nt.nodes:
            if node.type == "BSDF_PRINCIPLED":
                orig_emit_strength = node.inputs["Emission Strength"].default_value
                break

        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        grp = nt.nodes.new("ShaderNodeGroup")
        grp.node_tree = ng

        grp.inputs["Back Color"].default_value = cfg["back_col"]
        grp.inputs["Side Color"].default_value = cfg["side_col"]
        grp.inputs["Ceil Color"].default_value = cfg["ceil_col"]
        grp.inputs["Floor Color"].default_value = cfg["floor_col"]
        grp.inputs["Light Color"].default_value = cfg["light_col"]
        grp.inputs["Drape Color"].default_value = cfg["drape_col"]
        grp.inputs["Is Lit"].default_value = 1.0 if cfg["is_lit"] else 0.0
        grp.inputs["Is Office"].default_value = 1.0 if cfg["is_office"] else 0.0
        grp.inputs["Is Shoji"].default_value = 1.0 if cfg["is_shoji"] else 0.0

        bsdf.inputs["Roughness"].default_value = 0.06 if not cfg["is_shoji"] else 0.38
        if "IOR" in bsdf.inputs:
            bsdf.inputs["IOR"].default_value = 1.50
        if "Coat Weight" in bsdf.inputs and not cfg["is_shoji"]:
            bsdf.inputs["Coat Weight"].default_value = 1.0
            bsdf.inputs["Coat Roughness"].default_value = 0.02
            bsdf.inputs["Coat IOR"].default_value = 1.52
        # Give lit windows a balanced base strength (scaled by render_cycles.py's 0.0025 night factor -> ~0.82)
        bsdf.inputs["Emission Strength"].default_value = orig_emit_strength * 3.2 if cfg["is_lit"] else 0.0

        nt.links.new(grp.outputs["Albedo"], bsdf.inputs["Base Color"])
        nt.links.new(grp.outputs["Emission"], bsdf.inputs["Emission Color"])
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
        upgraded += 1
    return upgraded


# ------------------------------------------------------------------ PART 1: TRUE 3D 1F STOREFRONT INTERIORS

def _make_simple_mat(name, color, roughness=0.75, metallic=0.0, emission=None, emission_strength=0.0):
    if name in bpy.data.materials:
        mat = bpy.data.materials[name]
    else:
        mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None and emission_strength > 0.0:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def _create_3d_shop_palette(lit_scale):
    """Creates shared Cycles materials for the true 3D ground-floor storefront rooms.
    Calibrated with moody Showa wood/plaster contrast so dark furniture, colorful bottles/books,
    and glowing 3D pendant lamps read crisply through the reflective glass without washing out."""
    return {
        "plaster_warm": _make_simple_mat("Shop3D_PlasterWarm", (0.34, 0.22, 0.13), roughness=0.84),
        "plaster_cream": _make_simple_mat("Shop3D_PlasterCream", (0.48, 0.42, 0.34), roughness=0.82),
        "plaster_cool": _make_simple_mat("Shop3D_PlasterCool", (0.58, 0.62, 0.66), roughness=0.76),
        "wood_dark": _make_simple_mat("Shop3D_WoodDark", (0.06, 0.032, 0.015), roughness=0.52),
        "wood_warm": _make_simple_mat("Shop3D_WoodWarm", (0.20, 0.10, 0.045), roughness=0.56),
        "floor_tile_dark": _make_simple_mat("Shop3D_FloorDark", (0.08, 0.055, 0.035), roughness=0.32),
        "floor_tile_light": _make_simple_mat("Shop3D_FloorLight", (0.46, 0.45, 0.42), roughness=0.20),
        "ceil_wood": _make_simple_mat("Shop3D_CeilWood", (0.11, 0.065, 0.03), roughness=0.78),
        "ceil_white": _make_simple_mat("Shop3D_CeilWhite", (0.64, 0.66, 0.68), roughness=0.75),
        "metal_dark": _make_simple_mat("Shop3D_MetalDark", (0.03, 0.03, 0.035), roughness=0.30, metallic=0.85),
        "shelf_red": _make_simple_mat("Shop3D_GoodsRed", (0.58, 0.09, 0.07), roughness=0.48),
        "shelf_blue": _make_simple_mat("Shop3D_GoodsBlue", (0.10, 0.26, 0.58), roughness=0.48),
        "shelf_ochre": _make_simple_mat("Shop3D_GoodsOchre", (0.66, 0.40, 0.09), roughness=0.48),
        "shelf_green": _make_simple_mat("Shop3D_GoodsGreen", (0.09, 0.38, 0.18), roughness=0.48),
        "menu_plaque": _make_simple_mat("Shop3D_MenuPlaque", (0.82, 0.70, 0.48), roughness=0.82),
        # Physical interior emitters — scaled by lit_scale (0 in day, crisp warm/cool in blue & night)
        "lamp_warm": _make_simple_mat(
            "Shop3D_LampWarm", (1.0, 0.90, 0.74), roughness=0.15,
            emission=(1.0, 0.68, 0.28), emission_strength=14.0 * lit_scale,
        ),
        "lamp_amber": _make_simple_mat(
            "Shop3D_LampAmber", (1.0, 0.80, 0.50), roughness=0.25,
            emission=(1.0, 0.52, 0.14), emission_strength=13.0 * lit_scale,
        ),
        "lamp_cool": _make_simple_mat(
            "Shop3D_LampCool", (0.94, 0.98, 1.0), roughness=0.2,
            emission=(0.86, 0.94, 1.0), emission_strength=18.0 * lit_scale,
        ),
        "cooler_glow": _make_simple_mat(
            "Shop3D_CoolerGlow", (0.68, 0.86, 1.0), roughness=0.25,
            emission=(0.52, 0.80, 1.0), emission_strength=7.5 * lit_scale,
        ),
    }


def _add_box_local(bm, origin, t_vec, b_vec, n_vec, u0, u1, v0, v1, d0, d1, mat_idx, inward=False):
    """Adds an axis-aligned box in local (T, B, -N) shop coordinates (d > 0 goes INTO the shop)."""
    def pt(u, v, d):
        return origin + t_vec * u + b_vec * v - n_vec * d

    verts = [
        bm.verts.new(pt(u0, v0, d0)),  # 0
        bm.verts.new(pt(u1, v0, d0)),  # 1
        bm.verts.new(pt(u1, v1, d0)),  # 2
        bm.verts.new(pt(u0, v1, d0)),  # 3
        bm.verts.new(pt(u0, v0, d1)),  # 4
        bm.verts.new(pt(u1, v0, d1)),  # 5
        bm.verts.new(pt(u1, v1, d1)),  # 6
        bm.verts.new(pt(u0, v1, d1)),  # 7
    ]
    # Outward-facing winding (when T x B = N, -N goes into depth d):
    faces = [
        (0, 1, 2, 3),  # front (d0)
        (5, 4, 7, 6),  # back (d1)
        (4, 0, 3, 7),  # left (u0)
        (1, 5, 6, 2),  # right (u1)
        (3, 2, 6, 7),  # top (v1)
        (4, 5, 1, 0),  # bottom (v0)
    ]
    for f in faces:
        verts_f = [verts[i] for i in (reversed(f) if inward else f)]
        try:
            face = bm.faces.new(verts_f)
            face.material_index = mat_idx
        except ValueError:
            pass


def _add_quad_local(bm, origin, t_vec, b_vec, n_vec, p0, p1, p2, p3, mat_idx):
    def pt(c):
        return origin + t_vec * c[0] + b_vec * c[1] - n_vec * c[2]
    try:
        f = bm.faces.new([bm.verts.new(pt(p0)), bm.verts.new(pt(p1)), bm.verts.new(pt(p2)), bm.verts.new(pt(p3))])
        f.material_index = mat_idx
    except ValueError:
        pass


def _add_globe_local(bm, origin, t_vec, b_vec, n_vec, u, v, d, radius, mat_idx, segs=8, rings=5):
    """Adds a low-poly 3D spherical glass pendant globe in local shop coordinates."""
    center = origin + t_vec * u + b_vec * v - n_vec * d
    ring_verts = []
    top_v = bm.verts.new(center + b_vec * radius)
    bot_v = bm.verts.new(center - b_vec * radius)
    for r in range(1, rings):
        phi = math.pi * r / rings
        sp, cp = math.sin(phi), math.cos(phi)
        row = []
        for s in range(segs):
            th = 2.0 * math.pi * s / segs
            p = center + (t_vec * math.cos(th) - n_vec * math.sin(th)) * (radius * sp) + b_vec * (radius * cp)
            row.append(bm.verts.new(p))
        ring_verts.append(row)
    for s in range(segs):
        s2 = (s + 1) % segs
        try:
            f = bm.faces.new([top_v, ring_verts[0][s], ring_verts[0][s2]])
            f.material_index = mat_idx
        except ValueError:
            pass
        try:
            f = bm.faces.new([bot_v, ring_verts[-1][s2], ring_verts[-1][s]])
            f.material_index = mat_idx
        except ValueError:
            pass
    for r in range(len(ring_verts) - 1):
        for s in range(segs):
            s2 = (s + 1) % segs
            try:
                f = bm.faces.new([ring_verts[r][s], ring_verts[r + 1][s], ring_verts[r + 1][s2], ring_verts[r][s2]])
                f.material_index = mat_idx
            except ValueError:
                pass


def _populate_3d_shop_room(bm, mat_idx_map, shop_kind, origin, t_vec, b_vec, n_vec, w, h, rng):
    """Builds a true 3D recessed room + ceiling lights + counters/shelves/furniture behind a 1F storefront."""
    depth = rng.uniform(3.4, 4.4) if shop_kind in ("konbini", "pharmacy") else rng.uniform(2.9, 3.8)
    hw = w * 0.5 + 0.14  # Slightly wider than storefront opening so corners tuck behind pilasters
    hh = h * 0.5
    d_start = 0.04

    if shop_kind == "kissaten":
        wall_m = mat_idx_map["plaster_warm"]
        ceil_m = mat_idx_map["ceil_wood"]
        floor_m = mat_idx_map["floor_tile_dark"]
        lamp_m = mat_idx_map["lamp_warm"]
        wood_m = mat_idx_map["wood_dark"]
        accent_m = mat_idx_map["wood_warm"]
    elif shop_kind == "bookstore":
        wall_m = mat_idx_map["plaster_cream"]
        ceil_m = mat_idx_map["ceil_white"]
        floor_m = mat_idx_map["wood_warm"]
        lamp_m = mat_idx_map["lamp_warm"]
        wood_m = mat_idx_map["wood_dark"]
        accent_m = mat_idx_map["wood_warm"]
    elif shop_kind in ("konbini", "pharmacy"):
        wall_m = mat_idx_map["plaster_cool"]
        ceil_m = mat_idx_map["ceil_white"]
        floor_m = mat_idx_map["floor_tile_light"]
        lamp_m = mat_idx_map["lamp_cool"]
        wood_m = mat_idx_map["plaster_cool"]
        accent_m = mat_idx_map["cooler_glow"]
    else:  # izakaya / ramen
        wall_m = mat_idx_map["plaster_warm"]
        ceil_m = mat_idx_map["ceil_wood"]
        floor_m = mat_idx_map["floor_tile_dark"]
        lamp_m = mat_idx_map["lamp_amber"]
        wood_m = mat_idx_map["wood_dark"]
        accent_m = mat_idx_map["wood_warm"]

    # 1. Room shell (5 inward-facing planes: back, left, right, ceiling, floor)
    _add_quad_local(bm, origin, t_vec, b_vec, n_vec, (-hw, -hh, depth), (hw, -hh, depth), (hw, hh, depth), (-hw, hh, depth), wall_m)
    _add_quad_local(bm, origin, t_vec, b_vec, n_vec, (-hw, -hh, d_start), (-hw, -hh, depth), (-hw, hh, depth), (-hw, hh, d_start), wall_m)
    _add_quad_local(bm, origin, t_vec, b_vec, n_vec, (hw, -hh, depth), (hw, -hh, d_start), (hw, hh, d_start), (hw, hh, depth), wall_m)
    _add_quad_local(bm, origin, t_vec, b_vec, n_vec, (-hw, hh, depth), (hw, hh, depth), (hw, hh, d_start), (-hw, hh, d_start), ceil_m)
    _add_quad_local(bm, origin, t_vec, b_vec, n_vec, (-hw, -hh, d_start), (hw, -hh, d_start), (hw, -hh, depth), (-hw, -hh, depth), floor_m)

    goods_mats = [mat_idx_map["shelf_red"], mat_idx_map["shelf_blue"], mat_idx_map["shelf_ochre"], mat_idx_map["shelf_green"]]

    # 2. Architectural interior props & real 3D physical light fixtures per shop type!
    # Keep pendants at ~1.95..2.25 m (below exterior awnings at 2.63 m!) and tall booths/shelves > 1.0 m (above wainscot!)
    n_bays = max(1, int(round(w / 2.5)))
    if shop_kind == "kissaten":
        # Dark walnut wainscoting along side walls + back bar counter + espresso machine + tall bottle shelves
        _add_box_local(bm, origin, t_vec, b_vec, n_vec, -hw + 0.02, hw - 0.02, -hh, -hh + 1.08, depth - 0.75, depth - 0.04, wood_m)
        _add_box_local(bm, origin, t_vec, b_vec, n_vec, -hw + 0.02, hw - 0.02, -hh + 1.08, -hh + 1.15, depth - 0.82, depth - 0.04, accent_m)
        # Side-wall dark walnut wainscoting panels up to 1.25 m
        _add_box_local(bm, origin, t_vec, b_vec, n_vec, -hw, -hw + 0.08, -hh, -hh + 1.25, d_start, depth, wood_m)
        _add_box_local(bm, origin, t_vec, b_vec, n_vec, hw - 0.08, hw, -hh, -hh + 1.25, d_start, depth, wood_m)
        # Backbar wooden shelving packed with bold contrasting bottles/cups + warm backbar light strip
        _add_box_local(bm, origin, t_vec, b_vec, n_vec, -hw * 0.78, hw * 0.78, -hh + 2.38, -hh + 2.46, depth - 0.28, depth - 0.14, lamp_m)
        for sy in (1.30, 1.68, 2.04):
            if -hh + sy < hh - 0.25:
                _add_box_local(bm, origin, t_vec, b_vec, n_vec, -hw * 0.82, hw * 0.82, -hh + sy, -hh + sy + 0.05, depth - 0.34, depth - 0.04, wood_m)
                for gx in range(7):
                    u_g = -hw * 0.74 + (hw * 1.48) * (gx + 0.5) / 7.0
                    gm = goods_mats[(gx + int(sy * 10)) % len(goods_mats)]
                    _add_box_local(bm, origin, t_vec, b_vec, n_vec, u_g - 0.12, u_g + 0.12, -hh + sy + 0.05, -hh + sy + 0.30, depth - 0.28, depth - 0.08, gm)
        # Hanging 3D round vintage glass globe pendant lamps clearly visible BELOW exterior awnings!
        for i in range(n_bays):
            ux = -w * 0.5 + (i + 0.5) * (w / n_bays)
            for ld in (0.92, depth * 0.62):
                _add_box_local(bm, origin, t_vec, b_vec, n_vec, ux - 0.022, ux + 0.022, hh - 1.12, hh, ld - 0.022, ld + 0.022, mat_idx_map["metal_dark"])
                _add_globe_local(bm, origin, t_vec, b_vec, n_vec, ux, hh - 1.24, ld, 0.145, lamp_m)
            # Tall dark café booth backs (1.35 m tall -> visible above window wainscot!) + table + small table lamp
            _add_box_local(bm, origin, t_vec, b_vec, n_vec, ux - 0.48, ux + 0.48, -hh + 0.78, -hh + 0.85, 0.78, 1.55, accent_m)
            _add_box_local(bm, origin, t_vec, b_vec, n_vec, ux - 0.08, ux + 0.08, -hh, -hh + 0.78, 1.08, 1.24, mat_idx_map["metal_dark"])
            _add_box_local(bm, origin, t_vec, b_vec, n_vec, ux - 0.72, ux - 0.52, -hh, -hh + 1.36, 0.82, 1.50, wood_m)
            _add_box_local(bm, origin, t_vec, b_vec, n_vec, ux + 0.52, ux + 0.72, -hh, -hh + 1.36, 0.82, 1.50, wood_m)

    elif shop_kind == "bookstore":
        for sy in (0.45, 0.90, 1.35, 1.80, 2.25):
            if -hh + sy < hh - 0.25:
                _add_box_local(bm, origin, t_vec, b_vec, n_vec, -hw + 0.06, hw - 0.06, -hh + sy, -hh + sy + 0.04, depth - 0.36, depth - 0.04, wood_m)
                for gx in range(7):
                    u_g = -hw * 0.82 + (hw * 1.64) * (gx + 0.5) / 7.0
                    gm = goods_mats[(gx + int(sy * 7)) % len(goods_mats)]
                    _add_box_local(bm, origin, t_vec, b_vec, n_vec, u_g - 0.18, u_g + 0.18, -hh + sy + 0.04, -hh + sy + 0.36, depth - 0.30, depth - 0.06, gm)
        # Tall central wooden flat-display book island (1.15 m tall -> visible above wainscot!) + pendant strips
        _add_box_local(bm, origin, t_vec, b_vec, n_vec, -w * 0.36, w * 0.36, -hh, -hh + 1.05, 0.92, 1.85, accent_m)
        _add_box_local(bm, origin, t_vec, b_vec, n_vec, -w * 0.32, w * 0.32, -hh + 1.05, -hh + 1.24, 0.98, 1.78, mat_idx_map["menu_plaque"])
        for i in range(n_bays):
            ux = -w * 0.5 + (i + 0.5) * (w / n_bays)
            _add_box_local(bm, origin, t_vec, b_vec, n_vec, ux - 0.14, ux + 0.14, hh - 0.95, hh - 0.85, 0.65, depth - 0.45, lamp_m)

    elif shop_kind in ("konbini", "pharmacy"):
        n_strips = max(2, n_bays + 1)
        for i in range(n_strips):
            ux = -w * 0.44 + (w * 0.88) * i / max(1, n_strips - 1)
            _add_box_local(bm, origin, t_vec, b_vec, n_vec, ux - 0.12, ux + 0.12, hh - 0.08, hh - 0.01, 0.35, depth - 0.35, lamp_m)
        _add_box_local(bm, origin, t_vec, b_vec, n_vec, -hw * 0.86, hw * 0.86, -hh + 0.25, hh - 0.38, depth - 0.28, depth - 0.05, accent_m)
        for i in range(n_bays):
            ux = -w * 0.5 + (i + 0.5) * (w / n_bays)
            _add_box_local(bm, origin, t_vec, b_vec, n_vec, ux - 0.48, ux + 0.48, -hh, -hh + 1.52, 0.95, 1.65, wood_m)
            for s_idx, sy in enumerate((0.55, 0.98, 1.40)):
                gm = goods_mats[(i + s_idx) % len(goods_mats)]
                _add_box_local(bm, origin, t_vec, b_vec, n_vec, ux - 0.44, ux + 0.44, -hh + sy, -hh + sy + 0.28, 0.88, 1.72, gm)

    else:
        # Izakaya / Ramen: warm wooden counter + tall bar stools + hanging amber lanterns + tanzaku plaques!
        _add_box_local(bm, origin, t_vec, b_vec, n_vec, -hw + 0.06, hw - 0.06, -hh, -hh + 1.10, depth - 1.18, depth - 0.55, accent_m)
        n_plq = max(5, int(w * 2.4))
        for k in range(n_plq):
            ux = -hw * 0.84 + (hw * 1.68) * (k + 0.5) / n_plq
            _add_box_local(bm, origin, t_vec, b_vec, n_vec, ux - 0.075, ux + 0.075, hh - 1.25, hh - 0.58, depth - 0.09, depth - 0.04, mat_idx_map["menu_plaque"])
        for i in range(max(2, n_bays * 2)):
            ux = -w * 0.42 + (w * 0.84) * (i + 0.5) / max(2, n_bays * 2)
            _add_box_local(bm, origin, t_vec, b_vec, n_vec, ux - 0.16, ux + 0.16, -hh, -hh + 0.88, depth - 1.68, depth - 1.36, wood_m)
        for i in range(n_bays):
            ux = -w * 0.5 + (i + 0.5) * (w / n_bays)
            for ld in (0.85, depth - 0.95):
                _add_box_local(bm, origin, t_vec, b_vec, n_vec, ux - 0.016, ux + 0.016, hh - 1.02, hh, ld - 0.016, ld + 0.016, mat_idx_map["metal_dark"])
                _add_box_local(bm, origin, t_vec, b_vec, n_vec, ux - 0.13, ux + 0.13, hh - 1.32, hh - 1.00, ld - 0.13, ld + 0.13, lamp_m)


def _convert_shop_mat_to_masked_glass(mat):
    """Converts a 1F shop material so emissiveMap==0 stays opaque matte frames/mullions/wood lattice,
    while emissiveMap>0 becomes real transparent reflective Cycles glass (transparent to shadow rays!)."""
    nt = mat.node_tree
    # Find existing diffuse Image Texture & emissive Image Texture imported from glTF
    diff_img = None
    emit_img = None
    for node in nt.nodes:
        if node.type == "BSDF_PRINCIPLED":
            if node.inputs["Base Color"].is_linked:
                src = node.inputs["Base Color"].links[0].from_node
                if src.type == "TEX_IMAGE":
                    diff_img = src.image
            if node.inputs["Emission Color"].is_linked:
                src = node.inputs["Emission Color"].links[0].from_node
                if src.type == "TEX_IMAGE":
                    emit_img = src.image
            break
    if not diff_img or not emit_img:
        return

    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tex_diff = nt.nodes.new("ShaderNodeTexImage")
    tex_diff.image = diff_img
    tex_emit = nt.nodes.new("ShaderNodeTexImage")
    tex_emit.image = emit_img

    # Binary glass mask from emissiveMap: 0 = opaque frame/mullion/wainscot/lattice, 1 = glass pane
    sep_e = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tex_emit.outputs["Color"], sep_e.inputs["Color"])
    max_e = _math(nt, "MAXIMUM", sep_e.outputs["Red"], _math(nt, "MAXIMUM", sep_e.outputs["Green"], sep_e.outputs["Blue"]))
    glass_mask = _smoothstep(nt, 0.04, 0.12, max_e)

    # Opaque frame/mullion/wainscoting shader
    frame_bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    frame_bsdf.inputs["Roughness"].default_value = 0.62
    nt.links.new(tex_diff.outputs["Color"], frame_bsdf.inputs["Base Color"])

    # Physical architectural thin glass shader (pure clear transmission + subtle crisp Fresnel reflection!)
    transp = nt.nodes.new("ShaderNodeBsdfTransparent")
    transp.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    glossy = nt.nodes.new("ShaderNodeBsdfGlossy")
    glossy.inputs["Color"].default_value = (0.95, 0.97, 1.0, 1.0)
    glossy.inputs["Roughness"].default_value = 0.015
    fresnel = nt.nodes.new("ShaderNodeFresnel")
    fresnel.inputs["IOR"].default_value = 1.45
    # Subtle 10% Fresnel reflection keeps glass crisp and sparkling while revealing 3D interiors with zero milky veil
    refl_fac = _math(nt, "MULTIPLY", fresnel.outputs["Fac"], 0.10, clamp=True)
    glass_vis = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(refl_fac, glass_vis.inputs["Fac"])
    nt.links.new(transp.outputs["BSDF"], glass_vis.inputs[1])
    nt.links.new(glossy.outputs["BSDF"], glass_vis.inputs[2])

    # Shadow rays pass straight through glass panes so interior 3D lights cast real shadows through mullions & koushi!
    lp = nt.nodes.new("ShaderNodeLightPath")
    glass_final = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Shadow Ray"], glass_final.inputs["Fac"])
    nt.links.new(glass_vis.outputs["Shader"], glass_final.inputs[1])
    nt.links.new(transp.outputs["BSDF"], glass_final.inputs[2])

    # Blend opaque frame vs transparent reflective glass via exact emissiveMap glass mask
    mix_all = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(glass_mask, mix_all.inputs["Fac"])
    nt.links.new(frame_bsdf.outputs["BSDF"], mix_all.inputs[1])
    nt.links.new(glass_final.outputs["Shader"], mix_all.inputs[2])
    nt.links.new(mix_all.outputs["Shader"], out.inputs["Surface"])


def _make_parallax_fallback_shop_mat(base_mat, shop_kind, orig_emit_strength):
    """Creates a GPU Interior-Mapping fallback material for solid-backed 1F storefronts."""
    fb = base_mat.copy()
    fb.name = f"{base_mat.name}_parallax"
    nt = fb.node_tree

    diff_img = None
    emit_img = None
    for node in nt.nodes:
        if node.type == "BSDF_PRINCIPLED":
            if node.inputs["Base Color"].is_linked and node.inputs["Base Color"].links[0].from_node.type == "TEX_IMAGE":
                diff_img = node.inputs["Base Color"].links[0].from_node.image
            if node.inputs["Emission Color"].is_linked and node.inputs["Emission Color"].links[0].from_node.type == "TEX_IMAGE":
                emit_img = node.inputs["Emission Color"].links[0].from_node.image
            break
    if not diff_img or not emit_img:
        return fb

    ng = get_or_create_interior_nodegroup()
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex_diff = nt.nodes.new("ShaderNodeTexImage")
    tex_diff.image = diff_img
    tex_emit = nt.nodes.new("ShaderNodeTexImage")
    tex_emit.image = emit_img

    sep_e = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tex_emit.outputs["Color"], sep_e.inputs["Color"])
    max_e = _math(nt, "MAXIMUM", sep_e.outputs["Red"], _math(nt, "MAXIMUM", sep_e.outputs["Green"], sep_e.outputs["Blue"]))
    glass_mask = _smoothstep(nt, 0.04, 0.12, max_e)

    grp = nt.nodes.new("ShaderNodeGroup")
    grp.node_tree = ng
    cfg = WINDOW_CONFIGS["window_lit_office"] if shop_kind in ("konbini", "pharmacy") else WINDOW_CONFIGS["window_lit_warm"]
    grp.inputs["Back Color"].default_value = cfg["back_col"]
    grp.inputs["Side Color"].default_value = cfg["side_col"]
    grp.inputs["Ceil Color"].default_value = cfg["ceil_col"]
    grp.inputs["Floor Color"].default_value = cfg["floor_col"]
    grp.inputs["Light Color"].default_value = cfg["light_col"]
    grp.inputs["Drape Color"].default_value = cfg["drape_col"]
    grp.inputs["Is Lit"].default_value = 1.0
    grp.inputs["Is Office"].default_value = 1.0 if shop_kind in ("konbini", "pharmacy") else 0.0
    grp.inputs["Is Shoji"].default_value = 0.0

    base_col = _mix_color(nt, glass_mask, tex_diff.outputs["Color"], grp.outputs["Albedo"])
    emit_col = _mix_color(nt, glass_mask, (0.0, 0.0, 0.0, 1.0), grp.outputs["Emission"])
    rough = _mix_float(nt, glass_mask, 0.62, 0.06)

    bsdf.inputs["Emission Strength"].default_value = orig_emit_strength * 2.0
    nt.links.new(base_col, bsdf.inputs["Base Color"])
    nt.links.new(emit_col, bsdf.inputs["Emission Color"])
    nt.links.new(rough, bsdf.inputs["Roughness"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return fb


def build_3d_shop_interiors(lit_scale):
    """Upgrades hollow 1F commercial storefronts to real 3D furnished rooms behind transparent glass."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    palette = _create_3d_shop_palette(lit_scale)
    mat_names = list(palette.keys())
    mat_idx_map = {k: i for i, k in enumerate(mat_names)}

    bm_rooms = bmesh.new()
    rng = random.Random(202604)
    built_rooms = 0
    fallback_faces = 0

    for obj_name, shop_kind in SHOP_TYPES.items():
        obj = bpy.data.objects.get(obj_name)
        if not obj or obj.type != "MESH" or not obj.data.materials:
            continue
        base_mat = obj.data.materials[0]
        if not base_mat or not base_mat.use_nodes:
            continue

        orig_emit_strength = 100.0
        for node in base_mat.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                orig_emit_strength = node.inputs["Emission Strength"].default_value
                break

        fb_mat = _make_parallax_fallback_shop_mat(base_mat, shop_kind, orig_emit_strength)
        if len(obj.data.materials) < 2:
            obj.data.materials.append(fb_mat)
        else:
            obj.data.materials[1] = fb_mat

        me = obj.data
        M = obj.matrix_world
        M_inv = M.inverted()
        R3 = M.to_3x3()

        # Each BoxGeometry face in glTF has split vertices, so each connected island is a single
        # 2-triangle quad face (front, back, or 0.14 m rim).
        bm_src = bmesh.new()
        bm_src.from_mesh(me)
        bm_src.faces.ensure_lookup_table()
        bm_src.verts.ensure_lookup_table()

        visited = set()
        islands = []
        for f in bm_src.faces:
            if f.index in visited:
                continue
            stack = [f]
            isl = []
            visited.add(f.index)
            while stack:
                cur = stack.pop()
                isl.append(cur)
                for e in cur.edges:
                    for nf in e.link_faces:
                        if nf.index not in visited:
                            visited.add(nf.index)
                            stack.append(nf)
            islands.append(isl)

        up_vec = Vector((0.0, 0.0, 1.0))

        def _is_inside_building(center, side_n):
            probe = center + side_n * 1.8
            probe.z = max(center.z + 0.8, 2.2)
            hit_up, loc_up, _, _, hit_obj, _ = bpy.context.scene.ray_cast(
                depsgraph, probe, up_vec, distance=22.0,
            )
            if not hit_up or not hit_obj:
                return False
            return (loc_up.z - probe.z) >= 0.6 and not hit_obj.name.startswith(("awning_", "overhead_wire", "sleeve_sign"))

        # Pass 1: Identify true street-facing hollow storefront front quads & build 3D interiors behind them
        hollow_fronts = []  # list of (origin, t_vec, b_vec, out_n, w, h)
        front_island_ids = set()
        for isl_idx, isl in enumerate(islands):
            area = sum(f.calc_area() for f in isl)
            wn = (R3 @ isl[0].normal).normalized()
            if abs(wn.z) >= 0.15 or area < 1.2:
                continue

            pts = [M @ v.co for f in isl for v in f.verts]
            center = sum(pts, Vector((0.0, 0.0, 0.0))) / len(pts)

            # True street-facing front quad: open sky on +wn side, building roof/2F slab on -wn side!
            if _is_inside_building(center, wn) or not _is_inside_building(center, -wn):
                continue

            b_vec = Vector((0.0, 0.0, 1.0))
            t_vec = b_vec.cross(wn).normalized()
            u_vals = [p.dot(t_vec) for p in pts]
            v_vals = [p.dot(b_vec) for p in pts]
            n_vals = [p.dot(wn) for p in pts]
            w = max(u_vals) - min(u_vals)
            h = max(v_vals) - min(v_vals)
            if w < 1.4 or h < 1.6:
                continue
            origin = t_vec * (0.5 * (min(u_vals) + max(u_vals))) + b_vec * (0.5 * (min(v_vals) + max(v_vals))) + wn * max(n_vals)

            # Verify street side clear and building interior hollow >= 2.4 m (starting past the 0.14 m back quad!)
            hit_street, _, _, _, _, _ = bpy.context.scene.ray_cast(depsgraph, origin + wn * 0.08, wn, distance=1.6)
            hit_in, loc_in, _, _, _, _ = bpy.context.scene.ray_cast(depsgraph, origin - wn * 0.25, -wn, distance=3.2)
            is_hollow = (not hit_street) and ((not hit_in) or ((loc_in - origin).length >= 2.4))

            if is_hollow:
                for f in isl:
                    f.material_index = 0
                front_island_ids.add(isl_idx)
                hollow_fronts.append((origin, t_vec, b_vec, wn, w, h))
                _populate_3d_shop_room(bm_rooms, mat_idx_map, shop_kind, origin, t_vec, b_vec, wn, w, h, rng)
                built_rooms += 1

        # Pass 2: Delete back (-N) quads sitting 14 cm behind every hollow front quad; assign rest to fallback slot 1
        to_delete = []
        for isl_idx, isl in enumerate(islands):
            if isl_idx in front_island_ids:
                continue
            pts = [M @ v.co for f in isl for v in f.verts]
            center = sum(pts, Vector((0.0, 0.0, 0.0))) / len(pts)
            wn = (R3 @ isl[0].normal).normalized()
            is_occluding_back = False
            for h_origin, h_t, h_b, h_n, h_w, h_h in hollow_fronts:
                delta = center - h_origin
                depth_behind = delta.dot(-h_n)
                if -0.02 <= depth_behind <= 0.26:
                    if abs(delta.dot(h_t)) <= h_w * 0.52 and abs(delta.dot(h_b)) <= h_h * 0.52:
                        # Back face or rim of a hollow storefront box -> delete so view into 3D room is 100% open!
                        if wn.dot(h_n) < -0.5 or abs(wn.z) > 0.5 or abs(wn.dot(h_t)) > 0.5:
                            is_occluding_back = True
                            break
            if is_occluding_back:
                to_delete.extend(isl)
            else:
                for f in isl:
                    f.material_index = 1
                fallback_faces += len(isl)

        if to_delete:
            bmesh.ops.delete(bm_src, geom=to_delete, context="FACES")
        bm_src.to_mesh(me)
        bm_src.free()
        me.update()

        # Upgrade slot 0 material to masked transparent reflective glass + crisp opaque frames/lattices
        _convert_shop_mat_to_masked_glass(base_mat)

    # Create single merged Blender object for all true 3D 1F shop interiors
    if len(bm_rooms.faces) > 0:
        me_rooms = bpy.data.meshes.new("Cycles_3D_Shop_Interiors")
        bm_rooms.normal_update()
        bm_rooms.to_mesh(me_rooms)
        for k in mat_names:
            me_rooms.materials.append(palette[k])
        obj_rooms = bpy.data.objects.new("Cycles_3D_Shop_Interiors", me_rooms)
        bpy.context.collection.objects.link(obj_rooms)
    bm_rooms.free()

    return built_rooms, fallback_faces


def upgrade_cycles_interiors(sky_mode):
    """Entry point called from render_cycles.py after opening the base scene."""
    lit_scale = 0.0 if sky_mode == "day" else (1.15 if sky_mode == "blue" else 1.0)
    n_win = upgrade_window_materials()
    n_rooms, n_fb = build_3d_shop_interiors(lit_scale)
    print(f"[cycles_interiors] upgraded {n_win} window shaders (Metal GPU), built {n_rooms} true 3D 1F shop rooms ({n_fb} solid-backed fallback faces)")
