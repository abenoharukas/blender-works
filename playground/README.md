# Playground

The street scene from ThreeRT's `the-stack2-day` study, rebuilt with plain
three.js, with any of the repository's models standing in it. Models keep their
real scale and stay in the scene together: nine plots, three rows of three.

## Run

Serve the repository root (or this folder) and open `/playground/`:

```bash
python3 -m http.server 8123
# http://localhost:8123/playground/
```

`assets` is a symlink to `../web/assets`, where the optimized browser GLBs
live, so the page works from either the repository root or this directory.

## Use

| | |
|---|---|
| Palette | click a model (or press `1`–`5`) to place it on the next free plot |
| In scene | click a row to frame that model; `●`/`○` hides it, `×` removes it |
| Street / Overview | the signature street view and the district from above (`S` / `O`) |
| Clear scene | removes every placed model |

The street, its shops, the district and the power lines are generated once from
a fixed seed, so every visit is the same scene.

## Notes

- Loading uses `GLTFLoader` + the meshopt decoder, because the assets are the
  optimized copies.
- Blender's transmission glass is turned into dark reflective panes: in an
  outdoor scene a low-opacity pane stacks into white haze at street distance.
  Interior fills (`emissiveIntensity` in the hundreds, in nits) are capped for
  the same reason.
- Models are placed on their own origin, which is the ground plane in every
  study, 2 cm above the plaza slab so base plates do not z-fight with it.
  Grounding on the bounding box instead is wrong: `Box3.setFromObject` uses
  each geometry's axis-aligned box, and the models' merged meshes keep rotated
  transforms, so the box reaches far below the origin and lifts the building
  into the air.
