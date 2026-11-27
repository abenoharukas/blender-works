"""Render a Cycles blue-hour upward architectural hero view of The Stack.

Usage:
    blender --background --factory-startup --python-exit-code 1 \
        --python works/the_stack/render_blue_hour_cycles.py
    blender --background --factory-startup --python-exit-code 1 \
        --python works/the_stack/render_blue_hour_cycles.py -- --samples 192
"""

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_BLEND = os.path.join(HERE, "out", "the_stack.blend")
DEFAULT_OUT = os.path.join(HERE, "out", "the_stack_blue_hour_cycles.png")


def build_blue_hour_world():
    """Civil-twilight blue-hour sky: deep sapphire zenith fading to luminous
    cobalt and a subtle warm dusk horizon glow on the southwest horizon."""
    world = bpy.data.worlds.new("Stack_BlueHour_Sky")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")

    # Vertical sky elevation gradient (Z in [0, 1] above horizon).
    z_map = nt.nodes.new("ShaderNodeMapRange")
    z_map.clamp = True
    z_map.inputs["From Min"].default_value = -0.05
    z_map.inputs["From Max"].default_value = 0.85
    z_map.inputs["To Min"].default_value = 0.0
    z_map.inputs["To Max"].default_value = 1.0

    ramp = nt.nodes.new("ShaderNodeValToRGB")
    stops = [
        (0.00, (0.20, 0.15, 0.34, 1.0)),   # deep twilight violet-amber horizon
        (0.10, (0.11, 0.16, 0.40, 1.0)),   # rich dusk indigo
        (0.26, (0.046, 0.100, 0.30, 1.0)), # deep blue-hour cobalt
        (0.55, (0.018, 0.046, 0.18, 1.0)), # twilight sapphire
        (0.84, (0.008, 0.022, 0.10, 1.0)), # deep sapphire
        (1.00, (0.005, 0.013, 0.065, 1.0)),# zenith midnight blue
    ]
    els = ramp.color_ramp.elements
    while len(els) > 1:
        els.remove(els[-1])
    els[0].position, els[0].color = stops[0]
    for pos, col in stops[1:]:
        el = els.new(pos)
        el.color = col

    # Subtle warm dusk afterglow hugging the WSW horizon (facing camera reflections).
    glow_dot = nt.nodes.new("ShaderNodeVectorMath")
    glow_dot.operation = "DOT_PRODUCT"
    sun_dir = Vector((-0.78, -0.60, 0.08)).normalized()
    glow_dot.inputs[1].default_value = (sun_dir.x, sun_dir.y, sun_dir.z)

    glow_az = nt.nodes.new("ShaderNodeMapRange")
    glow_az.clamp = True
    glow_az.inputs["From Min"].default_value = 0.25
    glow_az.inputs["From Max"].default_value = 1.0
    glow_az.inputs["To Min"].default_value = 0.0
    glow_az.inputs["To Max"].default_value = 1.0

    horizon_band = nt.nodes.new("ShaderNodeMapRange")
    horizon_band.clamp = True
    horizon_band.inputs["From Min"].default_value = 0.0
    horizon_band.inputs["From Max"].default_value = 0.24
    horizon_band.inputs["To Min"].default_value = 1.0
    horizon_band.inputs["To Max"].default_value = 0.0

    glow_fac = nt.nodes.new("ShaderNodeMath")
    glow_fac.operation = "MULTIPLY"

    glow_scale = nt.nodes.new("ShaderNodeMath")
    glow_scale.operation = "MULTIPLY"
    glow_scale.inputs[1].default_value = 0.48

    sky_mix = nt.nodes.new("ShaderNodeMix")
    sky_mix.data_type = "RGBA"
    sky_mix.blend_type = "MIX"
    sky_mix.inputs["B"].default_value = (0.58, 0.27, 0.24, 1.0)

    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], z_map.inputs["Value"])
    nt.links.new(z_map.outputs["Result"], ramp.inputs["Fac"])

    nt.links.new(tc.outputs["Generated"], glow_dot.inputs[0])
    nt.links.new(glow_dot.outputs["Value"], glow_az.inputs["Value"])
    nt.links.new(sep.outputs["Z"], horizon_band.inputs["Value"])
    nt.links.new(glow_az.outputs["Result"], glow_fac.inputs[0])
    nt.links.new(horizon_band.outputs["Result"], glow_fac.inputs[1])
    nt.links.new(glow_fac.outputs["Value"], glow_scale.inputs[0])

    nt.links.new(glow_scale.outputs["Value"], sky_mix.inputs["Factor"])
    nt.links.new(ramp.outputs["Color"], sky_mix.inputs["A"])
    nt.links.new(sky_mix.outputs["Result"], bg.inputs["Color"])

    bg.inputs["Strength"].default_value = 1.35
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])


def setup_dusk_lights():
    """Remove daytime sun lamps and add a soft low-angle twilight rim sun plus
    subtle warm uplights inside the four open sky-garden decks."""
    for obj in list(bpy.data.objects):
        if obj.type == "LIGHT":
            bpy.data.objects.remove(obj, do_unlink=True)

    # Gentle WSW afterglow rim light to sculpt the white fins and diagrid.
    rim_data = bpy.data.lights.new("BlueHour_RimSun", type="SUN")
    rim_data.energy = 0.38
    rim_data.color = (0.76, 0.83, 1.0)
    rim_data.angle = math.radians(14.0)
    rim = bpy.data.objects.new("BlueHour_RimSun", rim_data)
    bpy.context.scene.collection.objects.link(rim)
    rim_dir = Vector((0.68, 0.65, -0.34)).normalized()
    rim.rotation_euler = rim_dir.to_track_quat("-Z", "Y").to_euler()

    # Soft warm twilight garden uplights along the four refuge garden decks.
    for idx, z_deck in enumerate((40.0, 110.0, 160.0, 223.0)):
        for side_idx, x_pos in enumerate((-38.0, 0.0, 38.0)):
            light_data = bpy.data.lights.new(
                f"BlueHour_Garden_{idx}_{side_idx}", type="POINT"
            )
            light_data.energy = 6500.0
            light_data.color = (1.0, 0.76, 0.46)
            light_data.shadow_soft_size = 2.5
            light_obj = bpy.data.objects.new(
                f"BlueHour_Garden_{idx}_{side_idx}", light_data
            )
            bpy.context.scene.collection.objects.link(light_obj)
            light_obj.location = Vector((x_pos, -14.0, z_deck + 3.2))
            light_obj.visible_camera = False
            light_obj.visible_glossy = False
            light_obj.visible_transmission = False


def upgrade_materials_for_blue_hour_cycles():
    """Keep coated glazing razor-sharp and shadow-transparent in Cycles, and
    tune interior lamps + plaza ground for rich blue-hour contrast."""
    for mat in bpy.data.materials:
        if not mat or not mat.use_nodes:
            continue
        nt = mat.node_tree

        # Let shadow rays pass cleanly through exterior coated glass so sky and
        # twilight fill illuminate the interior slabs, trees, and atrium.
        if mat.get("web_glass_mode") == "oneway_frosted_outer":
            out_cycles = next(
                (
                    n for n in nt.nodes
                    if n.type == "OUTPUT_MATERIAL" and n.target == "CYCLES"
                ),
                None,
            )
            if out_cycles and out_cycles.inputs["Surface"].links:
                prev_sock = out_cycles.inputs["Surface"].links[0].from_socket
                lp = nt.nodes.new("ShaderNodeLightPath")
                shadow_trans = nt.nodes.new("ShaderNodeBsdfTransparent")
                shadow_trans.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
                shadow_mix = nt.nodes.new("ShaderNodeMixShader")
                shadow_mix.label = "Cycles Shadow Transparent"
                nt.links.new(lp.outputs["Is Shadow Ray"], shadow_mix.inputs[0])
                nt.links.new(prev_sock, shadow_mix.inputs[1])
                nt.links.new(shadow_trans.outputs[0], shadow_mix.inputs[2])
                nt.links.new(shadow_mix.outputs[0], out_cycles.inputs["Surface"])

        bsdf = nt.nodes.get("Principled BSDF")
        if not bsdf:
            continue

        # Balanced dusk glow so Tier 1 retail escalators stay crisp while upper
        # office and apartment ceilings sparkle like jewel boxes under AgX.
        if mat.name == "Stack_Light_Warm":
            bsdf.inputs["Emission Strength"].default_value = 13.0
        elif mat.name == "Stack_Light_Daylight":
            bsdf.inputs["Emission Strength"].default_value = 10.0
        elif mat.name == "Stack_Mall_Glow":
            bsdf.inputs["Emission Color"].default_value = (1.0, 0.68, 0.34, 1.0)
            bsdf.inputs["Emission Strength"].default_value = 4.6
        elif mat.name == "Stack_Ceiling_Slab":
            # Soft warm cream bounce inside the lit storeys at blue hour.
            bsdf.inputs["Emission Strength"].default_value = 0.36
        elif mat.name == "Stack_Ground":
            # Procedural damp dark architectural stone paving so the foreground
            # reads as a real urban twilight plaza rather than smooth water.
            tc = nt.nodes.new("ShaderNodeTexCoord")
            brick = nt.nodes.new("ShaderNodeTexBrick")
            brick.offset = 0.5
            brick.inputs["Scale"].default_value = 0.25
            brick.inputs["Mortar Size"].default_value = 0.012
            brick.inputs["Mortar Smooth"].default_value = 0.2
            brick.inputs["Color1"].default_value = (0.022, 0.026, 0.034, 1.0)
            brick.inputs["Color2"].default_value = (0.034, 0.039, 0.048, 1.0)
            brick.inputs["Mortar"].default_value = (0.010, 0.012, 0.016, 1.0)

            noise = nt.nodes.new("ShaderNodeTexNoise")
            noise.inputs["Scale"].default_value = 0.06
            noise.inputs["Detail"].default_value = 6.0
            noise.inputs["Roughness"].default_value = 0.6

            rough_map = nt.nodes.new("ShaderNodeMapRange")
            rough_map.clamp = True
            rough_map.inputs["From Min"].default_value = 0.25
            rough_map.inputs["From Max"].default_value = 0.75
            rough_map.inputs["To Min"].default_value = 0.34
            rough_map.inputs["To Max"].default_value = 0.58

            nt.links.new(tc.outputs["Object"], brick.inputs["Vector"])
            nt.links.new(brick.outputs["Color"], bsdf.inputs["Base Color"])
            nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
            nt.links.new(noise.outputs["Fac"], rough_map.inputs["Value"])
            nt.links.new(rough_map.outputs["Result"], bsdf.inputs["Roughness"])
            if "Specular IOR Level" in bsdf.inputs:
                bsdf.inputs["Specular IOR Level"].default_value = 0.42


def extend_plaza_ground():
    """Add a broad dark plaza ground plane slightly below the site plinth so
    low-angle upward shots meet the twilight horizon cleanly."""
    mesh = bpy.data.meshes.new("BlueHour_Plaza")
    s = 2500.0
    z = -0.08
    mesh.from_pydata([(-s, -s, z), (s, -s, z), (s, s, z), (-s, s, z)], [], [(0, 1, 2, 3)])
    mesh.update()
    plaza_mat = bpy.data.materials.get("Stack_Ground")
    if plaza_mat:
        mesh.materials.append(plaza_mat)
    obj = bpy.data.objects.new("BlueHour_Plaza", mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def setup_upward_hero_camera():
    """Low-angle upward portrait camera framing the entire 301.8 m tower from
    plaza ground to crown with dramatic vertical convergence."""
    cam_data = bpy.data.cameras.new("Stack_BlueHour_Upward")
    cam_data.lens = 32.0
    cam_data.sensor_fit = "VERTICAL"
    cam_data.sensor_height = 36.0
    cam_data.sensor_width = 24.0
    cam_data.clip_start = 1.0
    cam_data.clip_end = 10000.0

    cam_obj = bpy.data.objects.new("Stack_BlueHour_Upward", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    cam_obj.location = Vector((148.0, -268.0, 2.2))
    target = Vector((0.0, 0.0, 148.0))
    cam_obj.rotation_euler = (target - cam_obj.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam_obj
    return cam_obj


def configure_cycles(samples, width, height, output_path):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.015
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.cycles.max_bounces = 8
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 4
    scene.cycles.transmission_bounces = 6
    scene.cycles.transparent_max_bounces = 16
    scene.cycles.sample_clamp_indirect = 10.0
    # Keep glossy/refractive reflections razor-sharp (never frost the glass).
    scene.cycles.blur_glossy = 0.0

    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = output_path

    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.view_settings.exposure = 0.25

    prefs = bpy.context.preferences.addons.get("cycles")
    if prefs:
        try:
            prefs.preferences.compute_device_type = "METAL"
            prefs.preferences.get_devices()
            for dev in prefs.preferences.devices:
                dev.use = True
        except Exception as exc:  # noqa: BLE001
            print(f"[cycles] GPU setup skipped: {exc}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--blend", default=DEFAULT_BLEND)
    parser.add_argument("--output", default=DEFAULT_OUT)
    parser.add_argument("--samples", type=int, default=128)
    parser.add_argument("--width", type=int, default=1200)
    parser.add_argument("--height", type=int, default=1800)
    args = parser.parse_args(
        sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    )

    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(args.blend))
    build_blue_hour_world()
    setup_dusk_lights()
    upgrade_materials_for_blue_hour_cycles()
    extend_plaza_ground()
    setup_upward_hero_camera()
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    configure_cycles(args.samples, args.width, args.height, os.path.abspath(args.output))

    print(
        f"[cycles] Rendering blue-hour upward Stack {args.width}x{args.height} "
        f"@ {args.samples} spp -> {os.path.abspath(args.output)}",
        flush=True,
    )
    bpy.ops.render.render(write_still=True)
    print(f"[cycles] Saved: {os.path.abspath(args.output)}", flush=True)


if __name__ == "__main__":
    main()
