"""Render the Playground street with ThreeRT (clear day / blue / night).

Mirrors `streets/native/render_cycles.py` in CLI flags, 50 mm full-frame camera
presets (`VIEWS`), and output naming (`threert-<tag>-<view>.png`). Decodes the
single canonical `model_viewer/assets/the_stack.optimized.glb` into a temporary
directory with physical ThreeRT emissive nits so no duplicate GLBs are left on
disk.

    python3 streets/native/render_threert.py --sky blue --view street
    python3 streets/native/render_threert.py --sky night --view shotengai --tag clear-night-ev72
"""

import argparse
import json
import math
import os
import struct
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(HERE, "out")
STREET_GLB = os.path.join(OUT, "playground_street_rt.glb")
TOWER_GLB = os.path.join(ROOT, "model_viewer", "assets", "the_stack.optimized.glb")
BUNDLE_JS = os.path.join(OUT, "playground-street.js")
THREERT_ROOT = os.environ.get("THREERT_ROOT", "/Users/raku/repos/others/ThreeRT")
THREERT_BIN = os.path.join(THREERT_ROOT, "renderer", "target", "release", "threert-render")
GLTF_TRANSFORM = os.path.join(ROOT, "node_modules", ".bin", "gltf-transform")

# Identical camera presets to `streets/native/render_cycles.py` (glTF Y-up metres).
VIEWS = {
    "street": {"pos": (4.9, 1.7, 560.0), "target": (0.0, 55.0, 90.0)},
    "stack_full": {"pos": (4.2, 1.7, 580.0), "target": (0.0, 146.0, 80.0)},
    "shotengai": {"pos": (3.8, 6.2, 398.0), "target": (-9.5, 7.2, 304.0)},
    "shotengai_walk": {"pos": (-3.5, 1.75, 416.5), "target": (4.5, 6.45, 350.0)},
    "ikkodate": {"pos": (36.0, 3.2, 380.0), "target": (106.0, 2.8, 379.2)},
}

SKY_HOURS = {
    "day": 12.5,
    "blue": 18.75,
    "night": 22.5,
}

# Physical ThreeRT luminance (nits) for the unified Stack GLB emissive materials.
STACK_EMISSIVE_NITS = {
    "Stack_Light_Warm_Web": 2800.0,
    "Stack_Light_Daylight_Web": 2400.0,
    "Stack_Mall_Glow_Web": 480.0,
    "Stack_Ceiling_Slab": 14.0,
}


def vfov_50mm_deg(width, height):
    """Vertical FOV (degrees) for a 50 mm lens on a 36 mm full-frame sensor
    (long edge = 36 mm, matching Blender `sensor_fit = AUTO`)."""
    sensor_h = 36.0 * (height / width) if width >= height else 36.0
    return math.degrees(2.0 * math.atan((sensor_h / 2.0) / 50.0))


# Per-sky occupancy fractions matching the 24h web skyscraper schedule:
# blue (18:45): ~63% offices, ~50% apartments, 100% mall
# night (22:30): ~36% overtime offices, ~44% apartments, 85% mall
STACK_OCCUPANCY = {
    "day": {"office": 0.0, "apartment": 0.0, "mall": 0.0, "garden": 0.0, "slab": 0.0},
    "blue": {"office": 0.63, "apartment": 0.50, "mall": 1.0, "garden": 1.0, "slab": 0.0},
    "night": {"office": 0.36, "apartment": 0.44, "mall": 0.85, "garden": 1.0, "slab": 0.0},
}


def _stack_circuit_group(name, prefix):
    if not name.startswith(prefix):
        return None
    tail = name[len(prefix):].split("_", 1)[0]
    return int(tail) if tail.isdigit() else None


def _stack_emissive_nits(name, sky):
    occ = STACK_OCCUPANCY.get(sky, STACK_OCCUPANCY["blue"])
    g_day = _stack_circuit_group(name, "Stack_Light_Daylight_G")
    if g_day is not None:
        rank = ((g_day * 19 + 7) % 32) / 32.0
        bright = 0.72 + 0.56 * (((g_day * 13 + 3) % 32) / 31.0)
        return STACK_EMISSIVE_NITS["Stack_Light_Daylight_Web"] * bright if rank < occ["office"] else 0.0
    g_warm = _stack_circuit_group(name, "Stack_Light_Warm_G")
    if g_warm is not None:
        rank = ((g_warm * 23 + 11) % 32) / 32.0
        bright = 0.70 + 0.60 * (((g_warm * 17 + 5) % 32) / 31.0)
        return STACK_EMISSIVE_NITS["Stack_Light_Warm_Web"] * bright if rank < occ["apartment"] else 0.0
    if name.startswith("Stack_Light_Warm"):
        return STACK_EMISSIVE_NITS["Stack_Light_Warm_Web"] * occ["garden"]
    if name.startswith("Stack_Light_Daylight"):
        return STACK_EMISSIVE_NITS["Stack_Light_Daylight_Web"] * occ["office"]
    if name.startswith("Stack_Mall_Glow"):
        return STACK_EMISSIVE_NITS["Stack_Mall_Glow_Web"] * occ["mall"]
    if name == "Stack_Ceiling_Slab":
        return STACK_EMISSIVE_NITS["Stack_Ceiling_Slab"] * occ["slab"]
    return None


def patch_stack_emissives_to_nits(glb_path, sky):
    """Apply physical ThreeRT nit strengths and grouped occupancy to the decoded GLB."""
    with open(glb_path, "rb") as fh:
        data = fh.read()
    j_len = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + j_len].decode("utf-8"))
    bin_chunk = data[20 + j_len + 8:]

    for mat in gltf.get("materials", []):
        name = mat.get("name", "")
        nits = _stack_emissive_nits(name, sky)
        if nits is not None:
            exts = dict(mat.get("extensions") or {})
            exts["KHR_materials_emissive_strength"] = {"emissiveStrength": nits}
            mat["extensions"] = exts
            if nits <= 0.0:
                mat["emissiveFactor"] = [0.0, 0.0, 0.0]

    j_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    pad = (4 - (len(j_bytes) % 4)) % 4
    if pad:
        j_bytes += b" " * pad
    total = 12 + 8 + len(j_bytes) + 8 + len(bin_chunk)
    out = (
        struct.pack("<III", 0x46546C67, 2, total)
        + struct.pack("<II", len(j_bytes), 0x4E4F534A)
        + j_bytes
        + struct.pack("<II", len(bin_chunk), 0x004E4942)
        + bin_chunk
    )
    with open(glb_path, "wb") as fh:
        fh.write(out)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sky", choices=("day", "blue", "night"), default="blue")
    parser.add_argument("--view", choices=tuple(VIEWS.keys()), default="street")
    parser.add_argument("--samples", "--spp", dest="samples", type=int, default=128)
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--tag", default=None)
    parser.add_argument("--no-bundle", action="store_true")
    args = parser.parse_args()

    os.makedirs(OUT, exist_ok=True)
    if not args.no_bundle:
        subprocess.run(["npm", "run", "rt:bundle"], cwd=ROOT, check=True)

    tag = args.tag or f"clear-{args.sky}"
    out_png = os.path.join(OUT, f"threert-{tag}-{args.view}.png")
    out_json = os.path.join(OUT, f"threert-{tag}-{args.view}.json")
    view = VIEWS[args.view]
    camera = {
        "position": list(view["pos"]),
        "target": list(view["target"]),
        "fov": round(vfov_50mm_deg(args.width, args.height), 4),
    }
    state = {
        "hour": SKY_HOURS[args.sky],
        "hourSeq": 1,
        "playing": False,
        "speed": 1,
        "weather": "clear",
        "view": args.view if args.view in ("street", "shotengai", "ikkodate", "overview") else "street",
        "viewSeq": 0,
    }

    with tempfile.TemporaryDirectory(prefix="threert_stage_") as tmpdir:
        assets_dir = os.path.join(tmpdir, "assets")
        os.makedirs(assets_dir, exist_ok=True)
        os.symlink(STREET_GLB, os.path.join(assets_dir, "playground_street_rt.glb"))
        staged_tower = os.path.join(assets_dir, "the_stack_final.glb")
        subprocess.run(
            [GLTF_TRANSFORM, "dequantize", TOWER_GLB, staged_tower],
            cwd=ROOT,
            check=True,
        )
        patch_stack_emissives_to_nits(staged_tower, args.sky)

        state_path = os.path.join(tmpdir, "state.json")
        with open(state_path, "w", encoding="utf-8") as fh:
            json.dump(state, fh)

        cmd = [
            THREERT_BIN,
            "render",
            BUNDLE_JS,
            "-o",
            out_png,
            "--assets",
            tmpdir,
            "--state",
            state_path,
            "--camera",
            json.dumps(camera),
            "--width",
            str(args.width),
            "--height",
            str(args.height),
            "--spp",
            str(args.samples),
            "--stats",
            out_json,
        ]
        print(
            f"[threert] {tag} {args.width}x{args.height} {args.samples}spp "
            f"fov={camera['fov']} -> {out_png}",
            flush=True,
        )
        subprocess.run(cmd, cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
