# Playground

A procedural Japanese townscape built with plain Three.js, hosting any of the
repository's architectural models at real 1:1 scale across nine civic plots
(three rows of three).

The district pairs a station-front *Shotengai* and neighborhood commercial
sub-centers (convenience stores, timber *machiya* izakayas and ramen shops with
*noren* curtains and *chochin* lanterns, corner *kissaten* cafes, pharmacies,
bookstores, and local supermarkets with projecting *sode-kanban* sleeve signs)
with subdivided residential blocks of six *ikkodate* detached-house archetypes
(*kirizuma* clay-tile roofs, *katanagare* galvalume monoslopes with rooftop PV,
two-tone *yosemune* hipped roofs, 3-storey urban *kyosho-jutaku*, traditional
timber-and-plaster houses, and L-shaped courtyard homes with carports, hedges,
gateposts, and kei-cars).

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
| Views | `Street` (`S`), `Shotengai` (`M`), `Ikkodate` (`H`), `Overview` (`O`) |
| Clear scene | removes every placed model |

The street network, commercial hubs, residential lots, and overhead utility
lines are generated deterministically from a fixed seed, merged per material to
keep draw calls low.

## Notes

- Loading uses `GLTFLoader` + the meshopt decoder for the optimized web GLBs.
- Blender's transmission glass is converted into dark reflective panes so
  stacked glazing does not wash out into white haze outdoors; high-nit interior
  emissives are clamped for daylight balance.
- Models are grounded on their authored origin (`+0.02 m` above the plaza
  surface) rather than `Box3.setFromObject`, avoiding rotated merged-mesh AABB
  offsets.
