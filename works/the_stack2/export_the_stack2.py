"""Export Stack 2 (the_stack2.blend) as a GLB for the ThreeRT renderer.

Unlike the browser export in ../the_stack/export_the_stack.py, this keeps the
Principled glass as glTF transmission + IOR (KHR_materials_transmission /
KHR_materials_ior), which is what ThreeRT's path tracer shades as real glass.
Static mesh objects that share one material are merged into one node per
material (4709 objects -> ~16), which is what the renderer wants: one draw
per material, and the emissive room-light sets stay distinct by material.

  blender --background --factory-startup --python-exit-code 1 \
    --python the_stack2/export_the_stack2.py -- \
    --output /path/to/threert-assets/the_stack2.glb
"""

import argparse
import json
import os
import sys

import bpy

ROOT = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SOURCE = os.path.join(ROOT, "out", "the_stack2.blend")


def merge_by_material():
    """One mesh node per material; the source .blend on disk is never saved."""
    groups = {}
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH" or len(obj.data.materials) != 1:
            continue
        material = obj.data.materials[0]
        if material is None:
            continue
        groups.setdefault(material.name, []).append(obj)

    before = sum(len(v) for v in groups.values())
    for name, objects in groups.items():
        if len(objects) < 2:
            objects[0].name = f"Web_{name}"
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        objects[0].name = f"Web_{name}"
    after = len([o for o in bpy.context.scene.objects if o.type == "MESH"])
    print(f"Merged meshes by material: {before} -> {after}")
    return before, after


def rewire_preview_shaders():
    """Point every material's output at its Principled BSDF.

    materials.make_glass (EEVEE branch) connects a Transparent/Glossy mix to the
    output for the viewport preview and leaves a Principled BSDF (transmission 1,
    IOR 1.52) unwired beside it. glTF cannot describe that mix, so the exporter
    writes an empty material for it. Rewiring on the export copy only is a one-
    line equivalent in glTF's model: transmission + IOR.
    """
    rewired = []
    for material in bpy.data.materials:
        if not material.use_nodes or material.node_tree is None:
            continue
        nodes = material.node_tree.nodes
        output = next((n for n in nodes if n.type == "OUTPUT_MATERIAL"), None)
        principled = nodes.get("Principled BSDF") or next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if output is None or principled is None:
            continue
        surface = output.inputs.get("Surface")
        if surface is None or (surface.is_linked and surface.links[0].from_node == principled):
            continue
        material.node_tree.links.new(principled.outputs[0], surface)
        rewired.append(material.name)
    if rewired:
        print(f"Rewired the Principled BSDF to the output: {', '.join(rewired)}")
    return rewired


def gltf_options():
    return {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}


def report(path):
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    tris = sum(sum(max(0, len(p.vertices) - 2) for p in o.data.polygons) for o in meshes)
    mats = sorted({m.name for o in meshes for m in o.data.materials if m})
    return {
        "output": path,
        "file_bytes": os.path.getsize(path) if os.path.exists(path) else 0,
        "mesh_nodes": len(meshes),
        "triangles": tris,
        "materials": mats,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--output", default=os.path.join(ROOT, "out", "the_stack2.glb"))
    parser.add_argument("--no-merge-materials", action="store_true")
    parser.add_argument("--report", nargs="?", const="-")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])

    source = os.path.abspath(args.source)
    output = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(output), exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=source)

    rewire_preview_shaders()
    if not args.no_merge_materials:
        merge_by_material()

    options = {
        "filepath": output,
        "export_format": "GLB",
        "export_apply": True,
        "export_materials": "EXPORT",
        "export_cameras": False,
        "export_lights": False,
        "export_extras": False,
    }
    supported = gltf_options()
    bpy.ops.export_scene.gltf(**{k: v for k, v in options.items() if k in supported or k == "filepath"})

    data = report(output)
    print(f"Exported {output}: {data['mesh_nodes']} nodes, {data['triangles']} tris, {len(data['materials'])} materials, {data['file_bytes'] / 1048576:.2f} MB")
    if args.report:
        payload = json.dumps(data, indent=2)
        if args.report == "-":
            print(payload)
        else:
            with open(os.path.abspath(args.report), "w", encoding="utf-8") as f:
                f.write(payload + "\n")


if __name__ == "__main__":
    main()
