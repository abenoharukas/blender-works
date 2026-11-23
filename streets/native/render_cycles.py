"""Render the Playground street with Cycles (clear day / clear night).

The street is the GLB exported from the Three.js scene for ThreeRT. The GLB
carries geometry, merged PBR materials and the canvas textures; the lighting
rig is rebuilt here from `playground-scene.json` (sun, exposure, street lamps).

    blender --background --factory-startup --python-exit-code 1 \
        --python streets/native/render_cycles.py -- --sky day

Add `--samples N` / `--width N` for quick tests. The imported scene is cached in
`streets/native/out/cycles-street-base.blend`, so repeated renders skip import.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(HERE, "out")
ASSETS = "/Users/raku/repos/others/threert-assets"
STREET_GLB = os.path.join(ASSETS, "playground_street_rt.glb")
TOWER_GLB = os.path.join(ASSETS, "the_stack_final.glb")
SCENE_JSON = os.path.join(HERE, "playground-scene.json")
BASE_BLEND = os.path.join(OUT, "cycles-street-base.blend")

VIEWS = {
    # Same eye-level street preset as the ThreeRT scene.
    "street": {"pos": (4.9, 1.7, 560.0), "target": (0.0, 55.0, 90.0), "fov": 52.0},
    "shotengai": {"pos": (3.6, 8.8, 366.0), "target": (-12.0, 4.6, 308.0), "fov": 52.0},
}


def argv():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"sky": "day", "view": "street", "samples": None, "width": 1920,
            "height": 1080, "tag": None}
    i = 0
    while i < len(args):
        if args[i] == "--sky":
            opts["sky"] = args[i + 1]; i += 2
        elif args[i] == "--view":
            opts["view"] = args[i + 1]; i += 2
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


def import_base():
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=STREET_GLB)
    bpy.ops.import_scene.gltf(filepath=TOWER_GLB)
    with open(SCENE_JSON) as fh:
        data = json.load(fh)
    tower = bpy.data.objects.get("the_stack")
    if tower:
        tower.location = to_blender(data["tower"]["pos"])
        tower.rotation_euler[2] = -data["tower"]["yaw"]
    bpy.ops.wm.save_as_mainfile(filepath=BASE_BLEND)


def emission_materials():
    """Materials that carry glTF emissive strength (lit windows, signs, lamps)."""
    found = []
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED" and node.inputs["Emission Strength"].default_value > 0.001:
                found.append((node, node.inputs["Emission Strength"].default_value, mat.name.startswith("Stack_")))
                break
    return found


def apply_emission(emissions, street_scale, tower_scale):
    for node, base, is_tower in emissions:
        node.inputs["Emission Strength"].default_value = base * (tower_scale if is_tower else street_scale)


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
        (0.00, (0.46, 0.27, 0.41, 1.0)),
        (0.18, (0.34, 0.21, 0.37, 1.0)),
        (0.40, (0.16, 0.13, 0.28, 1.0)),
        (0.70, (0.05, 0.06, 0.16, 1.0)),
        (1.00, (0.02, 0.025, 0.07, 1.0)),
    ]
    els = ramp.color_ramp.elements
    while len(els) > 1:
        els.remove(els[-1])
    els[0].position, els[0].color = stops[0]
    for pos, color in stops[1:]:
        el = els.new(pos)
        el.color = color
    bg.inputs["Strength"].default_value = 2.2
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
    bg.inputs["Color"].default_value = (0.004, 0.006, 0.014, 1.0)
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


def add_street_lights(data, watt):
    for i, light in enumerate(data["points"]):
        lamp = bpy.data.lights.new(f"StreetLight_{i}", type="POINT")
        lamp.energy = watt
        lamp.color = tuple(int(light["color"][k:k + 2], 16) / 255.0 for k in (0, 2, 4))
        lamp.shadow_soft_size = 0.18
        obj = bpy.data.objects.new(f"StreetLight_{i}", lamp)
        obj.location = to_blender(light["pos"])
        bpy.context.collection.objects.link(obj)


def add_camera(view):
    cam = bpy.data.cameras.new("Camera")
    cam.lens = 50.0
    cam.sensor_fit = "HORIZONTAL"
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
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 3
    scene.cycles.transmission_bounces = 4
    scene.cycles.transparent_max_bounces = 4
    scene.cycles.sample_clamp_indirect = 8.0
    scene.cycles.blur_glossy = 1.0
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


def base_is_fresh():
    if not os.path.exists(BASE_BLEND):
        return False
    base_mtime = os.path.getmtime(BASE_BLEND)
    for src in (STREET_GLB, TOWER_GLB, SCENE_JSON):
        if os.path.exists(src) and os.path.getmtime(src) > base_mtime:
            return False
    return True


def main():
    opts = argv()
    os.makedirs(OUT, exist_ok=True)
    if base_is_fresh():
        bpy.ops.wm.open_mainfile(filepath=BASE_BLEND)
    else:
        import_base()

    with open(SCENE_JSON) as fh:
        data = json.load(fh)
    scene = bpy.context.scene

    # Remove rig leftovers when re-running on the cached file.
    for obj in list(bpy.data.objects):
        if obj.type in {"LIGHT", "CAMERA"} and obj.name != "camera":
            bpy.data.objects.remove(obj, do_unlink=True)

    add_camera(VIEWS[opts["view"]])
    emissions = emission_materials()

    if opts["sky"] == "day":
        set_world_day(0.10)
        add_sun((0.48, 0.42, -0.77), 6.5, (1.0, 0.92, 0.80))
        apply_emission(emissions, 0.0, 0.0)
        scene.view_settings.exposure = -1.0
        samples = opts["samples"] or 48
    elif opts["sky"] == "blue":
        set_world_blue()
        add_sun((-0.75, 0.30, -0.10), 0.10, (1.0, 0.62, 0.40), angle_deg=2.0)
        add_street_lights(data, watt=90.0)
        apply_emission(emissions, 0.0025, 0.0009)
        scene.view_settings.exposure = 2.0
        samples = opts["samples"] or 128
    else:
        set_world_night()
        add_sun((-0.25, 0.45, -0.85), 0.12, (0.55, 0.68, 1.0), angle_deg=2.0)
        add_street_lights(data, watt=80.0)
        apply_emission(emissions, 0.0025, 0.0009)
        scene.view_settings.exposure = 1.0
        samples = opts["samples"] or 96

    configure_render(samples, opts["width"], opts["height"])
    tag = opts["tag"] or f"clear-{opts['sky']}"
    scene.render.filepath = os.path.join(OUT, f"cycles-{tag}-{opts['view']}.png")
    print(f"[cycles] {tag} {opts['width']}x{opts['height']} {samples}spp -> {scene.render.filepath}")
    bpy.ops.render.render(write_still=True)


main()
