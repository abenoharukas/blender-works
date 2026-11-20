"""Headless build, verify, export and meshopt-optimize pipeline for web GLBs.

Runs with the repository's standalone bpy virtual environment (.venv) without
requiring Blender.app:

    .venv/bin/python shared/rebuild_web_assets.py
    .venv/bin/python shared/rebuild_web_assets.py the_stack abeno_harukas
"""

import argparse
import os
import shutil
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPORTER = os.path.join(REPO_ROOT, "the_stack", "export_the_stack.py")
WEB_ASSETS = os.path.join(REPO_ROOT, "web", "assets")

TARGETS = {
    "the_stack": {
        "build": ["the_stack/build_the_stack.py", "--", "--no-render"],
        "blend": "the_stack/out/the_stack.blend",
        "verifiers": [
            ["the_stack/verify_the_stack.py", "--", "the_stack/out/the_stack.blend"],
            ["shared/check_stack_zfight.py", "--", "the_stack/out/the_stack.blend"],
        ],
    },
    "abeno_harukas": {
        "build": ["abeno_harukas/build_abeno_harukas.py", "--", "--no-render"],
        "blend": "abeno_harukas/out/abeno_harukas.blend",
        "verifiers": [
            ["abeno_harukas/verify_abeno_harukas.py", "--", "abeno_harukas/out/abeno_harukas.blend"],
        ],
    },
    "centre_pompidou": {
        "build": ["centre_pompidou/build_pompidou.py", "--", "--no-render"],
        "blend": "centre_pompidou/out/centre_pompidou.blend",
        "verifiers": [
            ["centre_pompidou/verify_pompidou.py", "--", "centre_pompidou/out/centre_pompidou.blend"],
        ],
    },
    "highrise_house": {
        "build": ["highrise_house/build_house.py", "--", "--no-render", "--no-glb"],
        "blend": "highrise_house/out/highrise_house.blend",
        "verifiers": [],
    },
    "office_tower": {
        "build": ["office_tower/build_office.py", "--no-render"],
        "blend": "office_tower/out/office_tower.blend",
        "verifiers": [],
    },
}


def run_step(cmd, label):
    print(f"\n>>> [{label}] {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, cwd=REPO_ROOT, check=True)


def resolve_gltf_transform():
    local_bin = os.path.join(REPO_ROOT, "node_modules", ".bin", "gltf-transform")
    if os.path.exists(local_bin):
        return [local_bin]
    npx = shutil.which("npx")
    if npx:
        return [npx, "gltf-transform"]
    raise RuntimeError("gltf-transform CLI not found; run `npm install` first.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "models",
        nargs="*",
        help="Subset of models to rebuild (defaults to all five).",
    )
    parser.add_argument(
        "--skip-verify",
        action="store_true",
        help="Skip scene verification scripts.",
    )
    args = parser.parse_args()
    selected = args.models or list(TARGETS.keys())
    unknown = [m for m in selected if m not in TARGETS]
    if unknown:
        parser.error(f"Unknown model(s): {', '.join(unknown)}. Choose from: {', '.join(TARGETS)}")

    python_exe = sys.executable
    gltf_transform = resolve_gltf_transform()
    os.makedirs(WEB_ASSETS, exist_ok=True)

    for name in selected:
        spec = TARGETS[name]
        run_step([python_exe, *spec["build"]], f"build:{name}")

        if not args.skip_verify:
            for verifier in spec["verifiers"]:
                run_step([python_exe, *verifier], f"verify:{name}")

        raw_glb = os.path.join(WEB_ASSETS, f"{name}.glb")
        opt_glb = os.path.join(WEB_ASSETS, f"{name}.optimized.glb")

        run_step(
            [
                python_exe,
                EXPORTER,
                "--",
                "--source",
                spec["blend"],
                "--output",
                raw_glb,
            ],
            f"export:{name}",
        )
        run_step(
            [
                *gltf_transform,
                "optimize",
                raw_glb,
                opt_glb,
                "--compress",
                "meshopt",
            ],
            f"optimize:{name}",
        )

    print("\nAll requested web GLB assets rebuilt and meshopt-optimized.")


if __name__ == "__main__":
    main()
