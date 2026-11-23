"""Export the generated The Stack scene as a web-ready binary glTF asset."""

import argparse
import json
import os
import sys

import bpy


ROOT = os.path.dirname(os.path.abspath(__file__))
# Opacity of clear web glass: low enough to read the lit rooms behind the
# facade, high enough that the tint and sky reflection still show.
WEB_GLASS_ALPHA = 0.25
# Modelled lamp panels that stand in for lit rooms. They are geometry and stay;
# only their render-time emissive strength (2 to 360 across the works) is scaled
# down, because those values tone-map to a flat white in a PBR viewer.
WEB_FIXTURE_EMISSIVE = 2.0


def _input_value(bsdf, name, fallback):
    if bsdf is None:
        return fallback
    socket = bsdf.inputs.get(name)
    return socket.default_value if socket else fallback


def _is_glass_like(material):
    """Detect glass from shader structure, not a project-specific name."""
    if not material.use_nodes:
        return False
    nodes = material.node_tree.nodes
    node_types = {node.type for node in nodes}
    if "BSDF_GLASS" in node_types:
        return True
    has_transparent = "BSDF_TRANSPARENT" in node_types
    has_reflection = bool(node_types & {"BSDF_GLOSSY", "BSDF_ANISOTROPIC"})
    if has_transparent and (has_reflection or "MIX_SHADER" in node_types):
        return True

    principled = nodes.get("Principled BSDF")
    transmission = float(_input_value(principled, "Transmission Weight", 0.0))
    alpha = float(_input_value(principled, "Alpha", 1.0))
    roughness = float(_input_value(principled, "Roughness", 0.5))
    ior = float(_input_value(principled, "IOR", 1.5))
    return (
        transmission > 0.05
        and 1.25 <= ior <= 2.0
        and roughness < 0.35
    ) or (alpha < 0.98 and 1.25 <= ior <= 2.0 and roughness < 0.35)


def _make_web_glass(material, transmissive=False):
    source_bsdf = material.node_tree.nodes.get("Principled BSDF")
    source_alpha = float(_input_value(source_bsdf, "Alpha", 1.0))
    source_transmission = float(
        _input_value(source_bsdf, "Transmission Weight", 0.0)
    )
    frosted = source_alpha < 0.98 and source_transmission < 0.1
    # Frosted panes are meant to hide what is behind them, so they stay on the
    # alpha-blended path even when the clear glass is exported physically.
    physical = transmissive and not frosted
    web_material = bpy.data.materials.new(f"{material.name}_Web")
    web_material.use_nodes = True
    nodes = web_material.node_tree.nodes
    links = web_material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs[0], output.inputs[0])

    base_color = _input_value(
        source_bsdf, "Base Color", tuple(material.diffuse_color)
    )
    bsdf.inputs["Base Color"].default_value = base_color
    bsdf.inputs["Metallic"].default_value = 0.0
    source_roughness = float(_input_value(source_bsdf, "Roughness", 0.03))
    bsdf.inputs["Roughness"].default_value = (
        source_roughness if frosted else min(source_roughness, 0.05)
    )
    bsdf.inputs["IOR"].default_value = float(
        _input_value(source_bsdf, "IOR", 1.52)
    )
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.5
    if physical:
        # Physically transmissive pane: KHR_materials_transmission plus the
        # KHR_materials_ior the exporter writes alongside it. Alpha has to stay
        # 1.0, since glTF does not define blending and transmission together.
        if "Transmission Weight" in bsdf.inputs:
            bsdf.inputs["Transmission Weight"].default_value = 1.0
        if "Alpha" in bsdf.inputs:
            bsdf.inputs["Alpha"].default_value = 1.0
    else:
        # Real-time viewers (three.js, Filament, Bevy) support KHR_materials_
        # transmission unevenly: some draw it opaque, three.js turns it into a
        # mirror at grazing angles. Plain alpha blending (glTF alphaMode BLEND)
        # renders the same everywhere, so this copy expresses glass that way
        # and mirrors the EEVEE preview's transparent/reflection mix.
        if "Transmission Weight" in bsdf.inputs:
            bsdf.inputs["Transmission Weight"].default_value = 0.0
        if "Alpha" in bsdf.inputs:
            bsdf.inputs["Alpha"].default_value = (
                source_alpha if frosted else WEB_GLASS_ALPHA
            )

    alpha = bsdf.inputs["Alpha"].default_value
    web_material.diffuse_color = (*base_color[:3], alpha)
    if hasattr(web_material, "surface_render_method"):
        web_material.surface_render_method = "DITHERED" if physical else "BLENDED"
    web_material.use_backface_culling = False
    return web_material


def translate_glass_materials(transmissive=False):
    """Translate unsupported Blender glass nodes on the export copy only."""
    cache = {}
    translated = 0
    for obj in bpy.context.scene.objects:
        if obj.type not in ("MESH", "CURVE"):
            continue
        materials = obj.data.materials
        for index, material in enumerate(materials):
            if not material or not _is_glass_like(material):
                continue
            if material.name not in cache:
                cache[material.name] = _make_web_glass(material, transmissive)
                translated += 1
            materials[index] = cache[material.name]
    print(f"Translated Blender glass materials for glTF: {translated}")
    return translated


def fake_light_objects():
    """The render-time light rig: the AREA lamps and the empties grouping them.

    Fixture panels are modelled geometry and stay in the export; only the lamps
    go, because they exist to approximate interior lighting for a Blender
    render.
    """
    scene_objects = bpy.context.scene.objects
    lamps = [obj for obj in scene_objects if obj.type == "LIGHT"]
    rigs = [obj for obj in scene_objects
            if obj.type == "EMPTY" and obj.children
            and all(child.type in {"LIGHT", "EMPTY"} for child in obj.children)]
    return lamps + rigs


def _is_lit_fixture(material):
    """A modelled lamp panel: a Principled material with emission switched on."""
    if not material.use_nodes:
        return False
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    return float(_input_value(bsdf, "Emission Strength", 0.0)) > 0.0


def _make_fixture_panel(material):
    """Export the modelled lamp panel as a lit fixture.

    The works drive these materials at emissive strength 2 to 360, which does
    not light anything in a PBR viewer — it bakes a blown-out white that
    transmission smears across the facade. Colour is kept in both base and
    emission; only the strength is scaled down.
    """
    source_bsdf = material.node_tree.nodes.get("Principled BSDF")
    color = _input_value(source_bsdf, "Base Color", (0.8, 0.8, 0.78, 1.0))
    glow = _input_value(source_bsdf, "Emission Color", color)
    panel = bpy.data.materials.new(f"{material.name}_Web")
    panel.use_nodes = True
    nodes = panel.node_tree.nodes
    links = panel.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs[0], output.inputs[0])
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.45
    bsdf.inputs["Emission Color"].default_value = glow
    bsdf.inputs["Emission Strength"].default_value = WEB_FIXTURE_EMISSIVE
    panel.diffuse_color = color
    return panel


def fixture_panel_materials():
    """Swap lamp panel materials for export copies on the export scene only."""
    cache = {}
    for obj in bpy.context.scene.objects:
        if obj.type not in ("MESH", "CURVE"):
            continue
        materials = obj.data.materials
        for index, material in enumerate(materials):
            if not material or not _is_lit_fixture(material):
                continue
            if material.name not in cache:
                cache[material.name] = _make_fixture_panel(material)
            materials[index] = cache[material.name]
    print(f"Fixture panels exported lit: {len(cache)} material(s)")
    return cache


def detach_fake_lights():
    """Unlink the light rig for the export; returns what to relink afterwards."""
    removed = []
    for obj in fake_light_objects():
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
            removed.append((collection, obj))
    if removed:
        print(f"Left out {len(removed)} fake light object(s)")
    return removed


def gltf_export_options():
    """Properties this Blender's bundled glTF exporter actually exposes.

    Compression support moves between Blender releases: the meshopt properties
    simply do not exist in every build, and passing them aborts the export with
    an unrecognised-keyword error. Ask the operator instead of assuming.
    """
    return {prop.identifier
            for prop in bpy.ops.export_scene.gltf.get_rna_type().properties}


def scene_report(profile, compression, output, translated_glass, merged):
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    vertices = sum(len(obj.data.vertices) for obj in mesh_objects)
    polygons = sum(len(obj.data.polygons) for obj in mesh_objects)
    triangles = sum(
        sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons)
        for obj in mesh_objects
    )
    materials = sorted({
        material.name
        for obj in mesh_objects
        for material in obj.data.materials
        if material
    })
    return {
        "profile": profile,
        "compression": compression,
        "output": output,
        "file_bytes": os.path.getsize(output) if os.path.exists(output) else 0,
        "mesh_objects": len(mesh_objects),
        "vertices": vertices,
        "polygons": polygons,
        "triangles": triangles,
        "materials": len(materials),
        "translated_glass_materials": translated_glass,
        "merged_meshes": merged,
    }


def merge_meshes_by_material():
    """Merge web-export meshes without changing the source .blend on disk."""
    groups = {}
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or len(obj.data.materials) != 1:
            continue
        material = obj.data.materials[0]
        groups.setdefault(material.name, []).append(obj)

    before = sum(len(objects) for objects in groups.values())
    for material_name, objects in groups.items():
        if len(objects) < 2:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        objects[0].name = f"Web_{material_name}"

    after = len([obj for obj in bpy.context.scene.objects if obj.type == "MESH"])
    print(f"Merged web meshes by material: {before} -> {after}")
    return {"before": before, "after": after}

DEFAULT_SOURCE = os.path.join(ROOT, "out", "the_stack.blend")
DEFAULT_OUTPUT = os.path.join(ROOT, "out", "the_stack.glb")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--profile",
        choices=("static", "animated", "architectural"),
        default="architectural",
        help="Export policy for the source scene.",
    )
    parser.add_argument(
        "--no-merge-materials",
        action="store_true",
        help="Keep individual Blender mesh objects in the web export.",
    )
    parser.add_argument(
        "--compression",
        choices=("meshopt", "draco", "none"),
        default="none",
        help="Geometry compression used by the browser asset; uncompressed "
             "by default so general-purpose importers can read the file.",
    )
    parser.add_argument(
        "--preserve-materials",
        action="store_true",
        help="Do not translate unsupported Blender glass node graphs.",
    )
    parser.add_argument(
        "--transmissive-glass",
        action="store_true",
        help="Export clear glass with KHR_materials_transmission and "
             "KHR_materials_ior instead of alpha blending, for physically "
             "based viewers.",
    )
    parser.add_argument(
        "--no-fake-lights",
        action="store_true",
        help="Leave Blender's AREA lamp objects and their rig empties out of the "
             "GLB and scale the modelled lamp panels' emission down to a "
             "viewable strength. The lamps approximate interior lighting for a "
             "Blender render; the panels themselves stay.",
    )
    parser.add_argument(
        "--report",
        nargs="?",
        const="-",
        help="Print the export report or write it to a JSON path.",
    )
    args = parser.parse_args(
        sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    )

    source = os.path.abspath(args.source)
    output = os.path.abspath(args.output)
    if not os.path.exists(source):
        raise FileNotFoundError(f"Blender scene not found: {source}")

    os.makedirs(os.path.dirname(output), exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=source)
    translated_glass = 0
    if not args.preserve_materials:
        translated_glass = translate_glass_materials(args.transmissive_glass)
    merged = {"before": len([obj for obj in bpy.context.scene.objects if obj.type == "MESH"]),
              "after": len([obj for obj in bpy.context.scene.objects if obj.type == "MESH"])}
    if args.profile != "animated" and not args.no_merge_materials:
        merged = merge_meshes_by_material()
    detached_lights = []
    if args.no_fake_lights:
        fixture_panel_materials()
        detached_lights = detach_fake_lights()

    export_options = {
        "filepath": output,
        "export_format": "GLB",
        "export_apply": True,
        "export_materials": "EXPORT",
        "export_cameras": False,
        "export_lights": False,
    }
    supported = gltf_export_options()
    compression = args.compression
    compression_options = {
        "meshopt": {
            "export_meshopt_compression_enable": True,
            "export_meshopt_extension": "EXT_meshopt_compression",
        },
        "draco": {
            "export_draco_mesh_compression_enable": True,
            "export_draco_mesh_compression_level": 6,
        },
    }
    if compression in compression_options:
        options = compression_options[compression]
        missing = [key for key in options if key not in supported]
        if missing:
            print(f"warning: this Blender's glTF exporter has no {compression} "
                  f"support ({', '.join(missing)} is not available); exporting "
                  "uncompressed instead")
            compression = "none"
        else:
            export_options.update(options)
    bpy.ops.export_scene.gltf(**export_options)
    for collection, obj in detached_lights:
        collection.objects.link(obj)
    report = scene_report(
        args.profile, compression, output, translated_glass, merged
    )
    if args.report:
        payload = json.dumps(report, indent=2, sort_keys=True)
        if args.report == "-":
            print(payload)
        else:
            with open(os.path.abspath(args.report), "w", encoding="utf-8") as file:
                file.write(payload + "\n")
            print(f"Wrote export report: {os.path.abspath(args.report)}")
    print(f"Exported web asset: {output}")


if __name__ == "__main__":
    main()
