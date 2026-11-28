"""Render the Playground street with Cycles (clear day / blue / night).

The street is the GLB exported from the Three.js scene for ThreeRT. The GLB
carries geometry, merged PBR materials and the canvas textures; the lighting
rig is rebuilt here from `playground-scene.json` (sun, exposure, street lamps).

    blender --background --factory-startup --python-exit-code 1 \
        --python streets/native/render_cycles.py -- --sky day
    blender --background --factory-startup --python-exit-code 1 \
        --python streets/native/render_cycles.py -- --model house --sky blue --view street

`--model` accepts `stack`, `abeno`, `pompidou`, `house`, or `office`; `highrise`
is an alias for `house`. The default remains `stack`. Add `--samples N` /
`--width N` for quick tests. Each model has its own cached imported scene under
`streets/native/out/`, so switching models never reuses the wrong tower.
"""

import json
import math
import os
import struct
import subprocess
import sys
import tempfile

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
from cycles_interiors import upgrade_cycles_interiors
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(HERE, "out")
ASSETS = "/Users/raku/repos/others/threert-assets"
LOCAL_STREET_GLB = os.path.join(OUT, "playground_street_rt.glb")
MODEL_ASSETS = {
    "stack": "the_stack.optimized.glb",
    "abeno": "abeno_harukas.optimized.glb",
    "pompidou": "centre_pompidou.optimized.glb",
    "house": "highrise_house.optimized.glb",
    "office": "office_tower.optimized.glb",
}
MODEL_ALIASES = {"highrise": "house"}
DEFAULT_MODEL = "stack"


def _resolve_glb(local_path, shared_name):
    shared_path = os.path.join(ASSETS, shared_name)
    try:
        if os.path.exists(local_path):
            if not os.path.exists(shared_path) or os.path.getmtime(local_path) >= os.path.getmtime(shared_path):
                return local_path
        if os.path.exists(shared_path):
            return shared_path
    except PermissionError:
        pass
    return local_path


STREET_GLB = _resolve_glb(LOCAL_STREET_GLB, "playground_street_rt.glb")
SCENE_JSON = os.path.join(HERE, "playground-scene.json")

VIEWS = {
    # Same eye-level street preset as the ThreeRT scene.
    "street": {"pos": (4.9, 1.7, 560.0), "target": (0.0, 55.0, 90.0), "fov": 52.0},
    # Full-height upward street view framing the entire 301.8 m Stack at 50 mm (portrait).
    "stack_full": {"pos": (4.2, 1.7, 580.0), "target": (0.0, 146.0, 80.0), "fov": 52.0},
    "shotengai": {"pos": (3.8, 6.2, 398.0), "target": (-9.5, 7.2, 304.0), "fov": 52.0},
    "shotengai_walk": {"pos": (-3.5, 1.75, 416.5), "target": (4.5, 6.45, 350.0), "fov": 52.0},
    "ikkodate": {"pos": (36.0, 3.2, 380.0), "target": (106.0, 2.8, 379.2), "fov": 52.0},
}


def normalize_model_id(model_id):
    model_id = MODEL_ALIASES.get(model_id, model_id)
    if model_id not in MODEL_ASSETS:
        choices = ", ".join(MODEL_ASSETS)
        raise ValueError(f"Unknown model '{model_id}'. Choose one of: {choices}")
    return model_id


def model_asset(model_id):
    return os.path.join(ROOT, "model_viewer", "assets", MODEL_ASSETS[model_id])


def model_root_name(model_id):
    # Keep the existing Stack cache/root name for backwards compatibility.
    return "the_stack" if model_id == DEFAULT_MODEL else f"building_{model_id}"


def base_blend_path(model_id):
    name = "cycles-street-base.blend" if model_id == DEFAULT_MODEL else f"cycles-street-{model_id}-base.blend"
    return os.path.join(OUT, name)


def argv():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"sky": "day", "view": "street", "model": DEFAULT_MODEL, "samples": None, "width": 1920,
            "height": 1080, "tag": None}
    i = 0
    while i < len(args):
        if args[i] == "--sky":
            opts["sky"] = args[i + 1]; i += 2
        elif args[i] == "--view":
            opts["view"] = args[i + 1]; i += 2
        elif args[i] == "--model":
            opts["model"] = args[i + 1]; i += 2
        elif args[i] == "--samples":
            opts["samples"] = int(args[i + 1]); i += 2
        elif args[i] == "--width":
            opts["width"] = int(args[i + 1]); i += 2
        elif args[i] == "--height":
            opts["height"] = int(args[i + 1]); i += 2
        elif args[i] == "--tag":
            opts["tag"] = args[i + 1]; i += 2
        else:
            i += 1
    return opts


def to_blender(p):
    """glTF Y-up metres -> Blender Z-up metres."""
    return Vector((p[0], -p[2], p[1]))


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def _uses_meshopt(filepath):
    with open(filepath, "rb") as fh:
        header = fh.read(20)
        if len(header) < 20 or header[:4] != b"glTF":
            return False
        chunk_len = struct.unpack_from("<I", header, 12)[0]
        meta = json.loads(fh.read(chunk_len))
    return "EXT_meshopt_compression" in meta.get("extensionsUsed", [])


def import_gltf_safe(filepath):
    """Import a GLB, transparently decoding EXT_meshopt_compression into a
    temporary file when Blender's built-in glTF addon lacks meshopt support."""
    if not _uses_meshopt(filepath):
        bpy.ops.import_scene.gltf(filepath=filepath)
        return
    cli = os.path.join(ROOT, "node_modules", ".bin", "gltf-transform")
    with tempfile.TemporaryDirectory(prefix="cycles_glb_") as tmpdir:
        decoded = os.path.join(tmpdir, "decoded.glb")
        subprocess.run([cli, "copy", filepath, decoded], cwd=ROOT, check=True)
        bpy.ops.import_scene.gltf(filepath=decoded)


def import_base(model_id):
    clear_scene()
    import_gltf_safe(STREET_GLB)
    before = set(bpy.data.objects)
    import_gltf_safe(model_asset(model_id))
    with open(SCENE_JSON) as fh:
        data = json.load(fh)
    root_name = model_root_name(model_id)
    tower = bpy.data.objects.get(root_name)
    if not tower:
        new_roots = [o for o in bpy.data.objects if o not in before and o.parent is None]
        tower = bpy.data.objects.new(root_name, None)
        bpy.context.collection.objects.link(tower)
        for o in new_roots:
            o.parent = tower
    tower.location = to_blender(data["tower"]["pos"])
    tower.rotation_euler[2] = -data["tower"]["yaw"]
    bpy.ops.wm.save_as_mainfile(filepath=base_blend_path(model_id))


def tower_material_names(model_id):
    tower = bpy.data.objects.get(model_root_name(model_id))
    if not tower:
        return set()
    names = set()
    for obj in tower.children_recursive:
        for slot in obj.material_slots:
            if slot.material:
                names.add(slot.material.name)
    return names


def emission_materials():
    """Materials that carry glTF emissive strength (lit windows, signs, lamps)."""
    found = []
    for mat in bpy.data.materials:
        if not mat.use_nodes or mat.name.startswith("Shop3D_"):
            continue
        for node in mat.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED" and node.inputs["Emission Strength"].default_value > 0.001:
                found.append((node, node.inputs["Emission Strength"].default_value, mat.name))
                break
    return found


STACK_OCCUPANCY = {
    "day": {"office": 0.0, "apartment": 0.0, "mall": 0.0, "garden": 0.0},
    "blue": {"office": 0.63, "apartment": 0.50, "mall": 1.0, "garden": 1.0},
    "night": {"office": 0.36, "apartment": 0.44, "mall": 0.85, "garden": 1.0},
}


def _stack_circuit_factor(mat_name, sky):
    occ = STACK_OCCUPANCY.get(sky, STACK_OCCUPANCY["blue"])
    for prefix, key, a, b, c, d in (
        ("Stack_Light_Daylight_G", "office", 19, 7, 13, 3),
        ("Stack_Light_Warm_G", "apartment", 23, 11, 17, 5),
    ):
        if mat_name.startswith(prefix):
            tail = mat_name[len(prefix):].split("_", 1)[0]
            if tail.isdigit():
                g = int(tail)
                rank = ((g * a + b) % 32) / 32.0
                if rank >= occ[key]:
                    return 0.0
                lo, span = (0.72, 0.56) if key == "office" else (0.70, 0.60)
                return lo + span * (((g * c + d) % 32) / 31.0)
    if "Mall_Glow" in mat_name:
        return occ["mall"]
    if mat_name.startswith("Stack_Light_Warm"):
        return occ["garden"]
    return 1.0


def _house_circuit_factor(mat_name, sky):
    occ = STACK_OCCUPANCY.get(sky, STACK_OCCUPANCY["blue"])
    for prefix, a, b, c, d in (
        ("CeilingLight_Daylight_G", 19, 7, 13, 3),
        ("CeilingLight_Warm_G", 23, 11, 17, 5),
    ):
        if mat_name.startswith(prefix):
            tail = mat_name[len(prefix):].split("_", 1)[0]
            if tail.isdigit():
                g = int(tail)
                rank = ((g * a + b) % 32) / 32.0
                if rank >= occ["apartment"]:
                    return 0.0
                return 0.70 + 0.60 * (((g * c + d) % 32) / 31.0)
    if mat_name.startswith("PodiumCeilingLight_"):
        return occ["mall"]
    return 1.0


def apply_emission(emissions, street_scale, tower_scale, sky="blue", tower_materials=None):
    tower_materials = tower_materials or set()
    for node, base, mat_name in emissions:
        if mat_name.startswith("Stack_"):
            if base > 20.0:
                node.inputs["Emission Strength"].default_value = base * tower_scale
            elif sky == "day":
                node.inputs["Emission Strength"].default_value = 0.0
            elif "Ceiling_Slab" in mat_name:
                # Let Cycles real indirect lighting illuminate only lit suites;
                # unlit suites and open refuge ceilings stay naturally shaded.
                node.inputs["Emission Strength"].default_value = 0.0
            elif "Mall_Glow" in mat_name:
                factor = _stack_circuit_factor(mat_name, sky)
                node.inputs["Emission Strength"].default_value = base * (0.75 if sky == "blue" else 0.90) * factor
            else:
                factor = _stack_circuit_factor(mat_name, sky)
                node.inputs["Emission Strength"].default_value = base * (1.65 if sky == "blue" else 1.80) * factor
        elif mat_name in tower_materials:
            if sky == "day":
                node.inputs["Emission Strength"].default_value = 0.0
            elif base <= 5.0:
                # Non-Stack GLBs clamp interior fixture emission to ~2.0 for Web viewers,
                # whereas Cycles needs physical strength (~50-150) to light floor slabs,
                # columns, and soffits via real path-traced GI.
                factor = _house_circuit_factor(mat_name, sky)
                podium_boost = 2.0 if "Podium" in mat_name else 1.0
                node.inputs["Emission Strength"].default_value = base * tower_scale * podium_boost * factor
            else:
                node.inputs["Emission Strength"].default_value = base
        else:
            node.inputs["Emission Strength"].default_value = base * street_scale


def upgrade_tower_glass_for_cycles(tower_materials):
    """Make transmissive architectural glass on non-Stack buildings shadow-ray transparent in Cycles."""
    for mat_name in tower_materials:
        mat = bpy.data.materials.get(mat_name)
        if not mat or not mat.use_nodes or mat.name.startswith("Stack_Glass_"):
            continue
        nt = mat.node_tree
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not out or not bsdf or not out.inputs["Surface"].links:
            continue
        trans_sock = bsdf.inputs.get("Transmission Weight")
        if not trans_sock or trans_sock.default_value < 0.5:
            continue
        if any(n.label == "Tower Cycles Glass Shadow" for n in nt.nodes):
            continue
        prev = out.inputs["Surface"].links[0].from_socket
        lp = nt.nodes.new("ShaderNodeLightPath")
        trans = nt.nodes.new("ShaderNodeBsdfTransparent")
        trans.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        mix_shadow = nt.nodes.new("ShaderNodeMixShader")
        mix_shadow.label = "Tower Cycles Glass Shadow"
        nt.links.new(lp.outputs["Is Shadow Ray"], mix_shadow.inputs[0])
        nt.links.new(prev, mix_shadow.inputs[1])
        nt.links.new(trans.outputs[0], mix_shadow.inputs[2])
        nt.links.new(mix_shadow.outputs[0], out.inputs["Surface"])


def upgrade_stack_glass_for_cycles():
    """Ensure imported one-way coated Stack glazing is backfacing- and shadow-transparent in Cycles."""
    for mat in bpy.data.materials:
        if not mat or not mat.use_nodes or not mat.name.startswith("Stack_Glass_"):
            continue
        nt = mat.node_tree
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if not out or not out.inputs["Surface"].links:
            continue
        if "Inner" in mat.name:
            trans = nt.nodes.new("ShaderNodeBsdfTransparent")
            trans.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
            nt.links.new(trans.outputs[0], out.inputs["Surface"])
            continue
        if any(n.label == "Stack Cycles One-Way Shadow" for n in nt.nodes):
            continue
        prev = out.inputs["Surface"].links[0].from_socket
        geom = nt.nodes.new("ShaderNodeNewGeometry")
        lp = nt.nodes.new("ShaderNodeLightPath")
        trans = nt.nodes.new("ShaderNodeBsdfTransparent")
        trans.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        mix_back = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(geom.outputs["Backfacing"], mix_back.inputs[0])
        nt.links.new(prev, mix_back.inputs[1])
        nt.links.new(trans.outputs[0], mix_back.inputs[2])
        mix_shadow = nt.nodes.new("ShaderNodeMixShader")
        mix_shadow.label = "Stack Cycles One-Way Shadow"
        nt.links.new(lp.outputs["Is Shadow Ray"], mix_shadow.inputs[0])
        nt.links.new(mix_back.outputs[0], mix_shadow.inputs[1])
        nt.links.new(trans.outputs[0], mix_shadow.inputs[2])
        nt.links.new(mix_shadow.outputs[0], out.inputs["Surface"])


def set_world_day(strength):
    world = bpy.data.worlds.new("CyclesSky")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_elevation = math.radians(52.0)
    sky.sun_rotation = math.radians(200.0)
    sky.sun_disc = False
    for attr, value in (("altitude", 40.0), ("air_density", 1.0),
                        ("dust_density", 1.4), ("aerosol_density", 1.4)):
        if hasattr(sky, attr):
            setattr(sky, attr, value)
    bg.inputs["Strength"].default_value = strength
    nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])


def set_world_blue():
    """Civil-twilight sky: sun 3.2 degrees below the horizon, purple horizon haze."""
    world = bpy.data.worlds.new("BlueHourSky")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    span = nt.nodes.new("ShaderNodeMapRange")
    span.inputs["From Min"].default_value = -1.0
    span.inputs["From Max"].default_value = 1.0
    span.inputs["To Min"].default_value = 0.0
    span.inputs["To Max"].default_value = 1.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    stops = [
        (0.00, (0.20, 0.27, 0.56, 1.0)),
        (0.16, (0.12, 0.21, 0.48, 1.0)),
        (0.40, (0.045, 0.11, 0.34, 1.0)),
        (0.72, (0.018, 0.055, 0.22, 1.0)),
        (1.00, (0.010, 0.032, 0.15, 1.0)),
    ]
    els = ramp.color_ramp.elements
    while len(els) > 1:
        els.remove(els[-1])
    els[0].position, els[0].color = stops[0]
    for pos, color in stops[1:]:
        el = els.new(pos)
        el.color = color
    bg.inputs["Strength"].default_value = 1.55
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], span.inputs["Value"])
    nt.links.new(span.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])


def set_world_night():
    world = bpy.data.worlds.new("NightSky")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (0.011, 0.016, 0.034, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])


def add_sun(direction, strength, color, angle_deg=0.6):
    sun = bpy.data.lights.new("Sun", type="SUN")
    sun.energy = strength
    sun.color = color
    sun.angle = math.radians(angle_deg)
    obj = bpy.data.objects.new("Sun", sun)
    bpy.context.collection.objects.link(obj)
    obj.rotation_euler = Vector(direction).normalized().to_track_quat("-Z", "Y").to_euler()
    return obj


def add_street_lights(data, watt, cam_pos=None):
    for i, light in enumerate(data["points"]):
        lamp = bpy.data.lights.new(f"StreetLight_{i}", type="POINT")
        lamp.energy = watt
        lamp.color = tuple(int(light["color"][k:k + 2], 16) / 255.0 for k in (0, 2, 4))
        lamp.shadow_soft_size = 0.18
        obj = bpy.data.objects.new(f"StreetLight_{i}", lamp)
        obj.location = to_blender(light["pos"])
        bpy.context.collection.objects.link(obj)

    # Also spawn warm Cycles lights under nearby residential lane streetlamps (`warm_lamp` mesh)
    # so Ikkodate lanes cast authentic warm night pools onto the asphalt, hedges, and houses!
    warm_obj = bpy.data.objects.get("warm_lamp")
    if warm_obj and warm_obj.type == "MESH" and cam_pos is not None:
        me = warm_obj.data
        M = warm_obj.matrix_world
        existing = [to_blender(l["pos"]) for l in data["points"]]
        placed = []
        for poly in me.polygons:
            c = M @ poly.center
            if c.z < 3.0 or c.z > 6.5:
                continue
            if (c - cam_pos).length > 110.0:
                continue
            if any((c - e).length < 4.0 for e in existing) or any((c - p).length < 4.0 for p in placed):
                continue
            placed.append(c)
            lamp = bpy.data.lights.new(f"LaneLamp_{len(placed)}", type="POINT")
            lamp.energy = watt * 1.4
            lamp.color = (1.0, 0.78, 0.48)
            lamp.shadow_soft_size = 0.22
            obj = bpy.data.objects.new(f"LaneLamp_{len(placed)}", lamp)
            obj.location = Vector((c.x, c.y, c.z - 0.22))
            bpy.context.collection.objects.link(obj)


def add_camera(view):
    cam = bpy.data.cameras.new("Camera")
    cam.lens = 50.0
    cam.sensor_fit = "AUTO"
    cam.sensor_width = 36.0
    cam.clip_start = 0.1
    cam.clip_end = 30000.0
    obj = bpy.data.objects.new("Camera", cam)
    bpy.context.collection.objects.link(obj)
    obj.location = to_blender(view["pos"])
    target = to_blender(view["target"])
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = obj
    return obj


def configure_render(samples, width, height):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.cycles.max_bounces = 10
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 4
    scene.cycles.transmission_bounces = 10
    scene.cycles.transparent_max_bounces = 16
    scene.cycles.sample_clamp_indirect = 30.0
    scene.cycles.blur_glossy = 0.15
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Khronos PBR Neutral"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass

    # Metal GPU when available; otherwise Cycles falls back to CPU.
    prefs = bpy.context.preferences.addons.get("cycles")
    if prefs:
        try:
            prefs.preferences.compute_device_type = "METAL"
            prefs.preferences.get_devices()
            for dev in prefs.preferences.devices:
                dev.use = True
        except Exception as exc:  # noqa: BLE001 - optional backend
            print(f"[cycles] GPU setup skipped: {exc}")


def base_is_fresh(model_id):
    base_blend = base_blend_path(model_id)
    if not os.path.exists(base_blend):
        return False
    base_mtime = os.path.getmtime(base_blend)
    for src in (STREET_GLB, model_asset(model_id), SCENE_JSON):
        if os.path.exists(src) and os.path.getmtime(src) > base_mtime:
            return False
    return True


def main():
    opts = argv()
    model_id = normalize_model_id(opts["model"])
    opts["model"] = model_id
    os.makedirs(OUT, exist_ok=True)
    if base_is_fresh(model_id):
        bpy.ops.wm.open_mainfile(filepath=base_blend_path(model_id))
    else:
        import_base(model_id)

    with open(SCENE_JSON) as fh:
        data = json.load(fh)
    scene = bpy.context.scene

    # Remove rig leftovers when re-running on the cached file.
    for obj in list(bpy.data.objects):
        if obj.type in {"LIGHT", "CAMERA"} and obj.name != "camera":
            bpy.data.objects.remove(obj, do_unlink=True)

    # Upgrade 1F hollow storefronts to true 3D furnished rooms & upper/residential windows to GPU Interior Mapping
    upgrade_cycles_interiors(opts["sky"])
    tower_materials = tower_material_names(model_id)
    if model_id == "stack":
        upgrade_stack_glass_for_cycles()
    else:
        upgrade_tower_glass_for_cycles(tower_materials)

    cam_obj = add_camera(VIEWS[opts["view"]])
    emissions = emission_materials()

    if opts["sky"] == "day":
        set_world_day(0.10)
        add_sun((0.48, 0.42, -0.77), 6.5, (1.0, 0.92, 0.80))
        apply_emission(emissions, 0.0, 0.0, sky="day", tower_materials=tower_materials)
        scene.view_settings.exposure = -1.0
        samples = opts["samples"] or 48
    elif opts["sky"] == "blue":
        set_world_blue()
        add_sun((-0.75, 0.30, -0.35), 0.24, (0.58, 0.74, 1.0), angle_deg=8.0)
        add_street_lights(data, watt=110.0, cam_pos=cam_obj.location)
        tower_scale = 0.0010 if model_id == "stack" else 4.0
        apply_emission(emissions, 0.0032, tower_scale, sky="blue", tower_materials=tower_materials)
        scene.view_settings.exposure = 1.45
        samples = opts["samples"] or 128
    else:
        set_world_night()
        add_sun((-0.25, 0.45, -0.85), 0.12, (0.55, 0.68, 1.0), angle_deg=2.0)
        add_street_lights(data, watt=95.0, cam_pos=cam_obj.location)
        tower_scale = 0.0009 if model_id == "stack" else 3.5
        apply_emission(emissions, 0.0028, tower_scale, sky="night", tower_materials=tower_materials)
        scene.view_settings.exposure = 1.05
        samples = opts["samples"] or 96

    configure_render(samples, opts["width"], opts["height"])
    tag = opts["tag"] or f"clear-{opts['sky']}"
    if opts["tag"] is None and model_id != DEFAULT_MODEL:
        tag += f"-{model_id}"
    scene.render.filepath = os.path.join(OUT, f"cycles-{tag}-{opts['view']}.png")
    print(f"[cycles] model={model_id} {tag} {opts['width']}x{opts['height']} {samples}spp -> {scene.render.filepath}")
    bpy.ops.render.render(write_still=True)


main()
