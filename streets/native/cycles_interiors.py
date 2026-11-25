"""Offline Cycles interior & glazing upgrades for Playground streets (Apple Metal GPU, zero OSL):

1. Ground-floor (1F) commercial storefronts:
   - True 3D furnished shop interiors and 3D mullions/koushi lattices are authored directly in the
     shared street generator (`streets/web/japanese-buildings.js`) and exported in `playground_street_rt.glb`,
     so Web, ThreeRT, and Cycles all render the exact same 3D geometry.
   - Here we only upgrade the shared `shop_glass` storefront glazing to Cycles architectural thin glass
     (clear Transparent + crisp 10% Fresnel Glossy + shadow-ray transparent so interior 3D lamps cast
     real light and wooden-lattice shadows onto the sidewalk!).

2. Upper-storey & residential (一戸建て) windows (`window_lit_*`, `window_unlit*`):
   - Windows WITHOUT 3D interior geometry are upgraded with a 100% native Cycles Metal GPU Shader Node
     Group (`Cycles_Interior_Mapping_v1`) performing exact 3-plane analytic ray-box intersection.
"""

import bpy

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



# ------------------------------------------------------------------ PART 1: SHARED 1F STOREFRONT GLAZING

def upgrade_shop_glass():
    """Upgrades shared `shop_glass` material to Cycles thin architectural glass (clear + subtle
    Fresnel reflection + shadow-ray transparent so 3D shop interior lamps cast crisp lattice shadows)."""
    mat = bpy.data.materials.get("shop_glass")
    if not mat:
        return 0
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")

    transp = nt.nodes.new("ShaderNodeBsdfTransparent")
    transp.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    glossy = nt.nodes.new("ShaderNodeBsdfGlossy")
    glossy.inputs["Color"].default_value = (0.95, 0.97, 1.0, 1.0)
    glossy.inputs["Roughness"].default_value = 0.015
    fresnel = nt.nodes.new("ShaderNodeFresnel")
    fresnel.inputs["IOR"].default_value = 1.45
    refl_fac = _math(nt, "MULTIPLY", fresnel.outputs["Fac"], 0.10, clamp=True)

    glass_vis = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(refl_fac, glass_vis.inputs["Fac"])
    nt.links.new(transp.outputs["BSDF"], glass_vis.inputs[1])
    nt.links.new(glossy.outputs["BSDF"], glass_vis.inputs[2])

    lp = nt.nodes.new("ShaderNodeLightPath")
    glass_final = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Shadow Ray"], glass_final.inputs["Fac"])
    nt.links.new(glass_vis.outputs["Shader"], glass_final.inputs[1])
    nt.links.new(transp.outputs["BSDF"], glass_final.inputs[2])
    nt.links.new(glass_final.outputs["Shader"], out.inputs["Surface"])
    return 1


def upgrade_cycles_interiors(sky_mode):
    """Entry point called from render_cycles.py after opening the base scene."""
    n_win = upgrade_window_materials()
    n_glass = upgrade_shop_glass()
    print(f"[cycles_interiors] upgraded {n_win} non-3D window shaders (Metal GPU), upgraded {n_glass} shared 1F shop_glass shader")
