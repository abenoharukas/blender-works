// WGSL MaterialFunctions for 3D Parallax Interior Mapping in ThreeRT's hardware ray tracer:
//   1. `windowInterior(variant)` — upper-storey & residential (一戸建て) windows reading per-window
//      integer `cellX` seed and `cellY` aspect ratio packed into glTF UV0 by `windowPaneBox()`.
//   2. `shopInterior(variant)` — ground-floor (1F) commercial storefronts using glTF `base.emissive`
//      as a pixel-exact glass mask so mullions, wainscoting, and wooden koushi lattices stay crisp
//      opaque matte while ONLY glass panes show deep 3D parallax shop interiors + raytraced glass reflections!
import { MaterialFunction, type ShaderBinding } from "@threert/scene";

const COMMON_WGSL_HELPERS = /* wgsl */ `
fn im_hash12(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn im_hash31(p: f32) -> vec3<f32> {
    var p3 = fract(vec3<f32>(p) * vec3<f32>(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xxy + p3.yzz) * p3.zyx);
}

fn im_box(p: vec2<f32>, lo: vec2<f32>, hi: vec2<f32>) -> f32 {
    let s = step(lo, p) * step(p, hi);
    return s.x * s.y;
}

fn im_shelf_goods(q: vec2<f32>, seed: f32, is_books: f32) -> vec3<f32> {
    let cols = select(14.0, 26.0, is_books > 0.5);
    let rows = select(4.0, 6.0, is_books > 0.5);
    let sc = vec2<f32>(q.x * cols, q.y * rows);
    let cell = floor(sc);
    let f = fract(sc);
    let plank = step(f.y, 0.14);
    let item_h = 0.58 + 0.34 * im_hash12(cell + vec2<f32>(seed, 3.1));
    let gap = step(0.09, f.x) * step(f.x, 0.91) * step(0.14, f.y) * step(f.y, item_h);
    let rnd = im_hash31(cell.x * 13.7 + cell.y * 57.3 + seed * 19.1);
    var col = vec3<f32>(0.75, 0.72, 0.65);
    if (is_books > 0.5) {
        if (rnd.x < 0.22) { col = vec3<f32>(0.42, 0.10, 0.08); }
        else if (rnd.x < 0.44) { col = vec3<f32>(0.10, 0.18, 0.34); }
        else if (rnd.x < 0.66) { col = vec3<f32>(0.52, 0.36, 0.14); }
        else if (rnd.x < 0.84) { col = vec3<f32>(0.12, 0.28, 0.18); }
        else { col = vec3<f32>(0.68, 0.62, 0.50); }
    } else {
        if (rnd.x < 0.20) { col = vec3<f32>(0.78, 0.16, 0.12); }
        else if (rnd.x < 0.40) { col = vec3<f32>(0.85, 0.62, 0.14); }
        else if (rnd.x < 0.60) { col = vec3<f32>(0.14, 0.54, 0.28); }
        else if (rnd.x < 0.80) { col = vec3<f32>(0.16, 0.40, 0.76); }
        else { col = vec3<f32>(0.82, 0.80, 0.76); }
    }
    let back_d = select(vec3<f32>(0.18, 0.20, 0.22), vec3<f32>(0.08, 0.05, 0.03), is_books > 0.5);
    let plank_c = select(vec3<f32>(0.45, 0.48, 0.52), vec3<f32>(0.22, 0.13, 0.06), is_books > 0.5);
    return mix(mix(back_d, col, gap), plank_c, plank);
}
`;

const WINDOW_INTERIOR_FN = new MaterialFunction("im_window_interior", {
  params: {
    Mode: 0,      // 0: living_warm, 1: modern_led, 2: office_cool, 3: amber_shoji, 4: unlit_curtain, 5: unlit_blinds
    EmitNits: 105,
  },
  helpers: COMMON_WGSL_HELPERS,
  code: /* wgsl */ `
    let mode = i32(round($Mode));
    let n = i.ng;
    if (abs(n.y) > 0.92) {
        o.base = vec3<f32>(0.025);
        o.emissive = vec3<f32>(0.0);
        o.roughness = 0.25;
        return o;
    }

    let is_lit = mode <= 3;
    let is_office = (mode == 2 || mode == 5);

    // Cheap diffuse-bounce path: keep path-traced GI fast while preserving average room emission
    if (!i.near) {
        o.base = vec3<f32>(0.04);
        if (is_lit) {
            var avg_c = vec3<f32>(1.0, 0.66, 0.30);
            if (mode == 1) { avg_c = vec3<f32>(1.0, 0.86, 0.64); }
            else if (mode == 2) { avg_c = vec3<f32>(0.76, 0.88, 1.0); }
            else if (mode == 3) { avg_c = vec3<f32>(1.0, 0.54, 0.18); }
            o.emissive = avg_c * ($EmitNits * 0.45) * i.power;
        } else {
            o.emissive = vec3<f32>(0.0);
        }
        return o;
    }

    // Decode per-window cell seed & aspect ratio from glTF UV0 (image convention: v down)
    let cell_x = floor(i.uv.x);
    let cell_y = abs(floor(i.uv.y));
    let uv = vec2<f32>(fract(i.uv.x), 1.0 - fract(i.uv.y));
    let seed = cell_x + cell_y * 0.37 + im_hash12(vec2<f32>(cell_x, cell_y) + vec2<f32>(17.3, 41.7)) * 97.0;
    let aspect = select(1.2, clamp(cell_y * 0.1, 0.45, 3.5), cell_y >= 2.0);

    let r1 = im_hash31(seed + 1.13);
    let r2 = im_hash31(seed + 19.71);
    let r3 = im_hash31(seed + 53.29);

    let b_vec = vec3<f32>(0.0, 1.0, 0.0);
    let t_vec = normalize(cross(b_vec, n));
    let ray_w = -i.view;
    let ndotv = clamp(dot(n, i.view), 0.0, 1.0);
    let fresnel = pow(1.0 - ndotv, 4.0);
    let d = vec3<f32>(dot(ray_w, t_vec), dot(ray_w, b_vec), min(dot(ray_w, n), -0.002));

    // Mode 3: Traditional Machiya Shoji (障子)
    if (mode == 3) {
        let p_s = vec2<f32>((uv.x - 0.5) * aspect, uv.y - 0.5);
        let inner_off = p_s + d.xy * (-0.55 / d.z);
        let ld = (inner_off - vec2<f32>((r1.x - 0.5) * 0.35, 0.32)) * vec2<f32>(1.5, 1.9);
        let lamp_glow = exp(-dot(ld, ld));
        let low_sh = smoothstep(-0.52, 0.0, inner_off.y);
        let gx = abs(fract(uv.x * max(3.0, floor(aspect * 3.5 + 0.5))) - 0.5);
        let gy = abs(fract(uv.y * 5.0) - 0.5);
        let wood_grid = clamp(1.0 - (step(0.445, gx) + step(0.445, gy)), 0.0, 1.0);
        let paper = mix(vec3<f32>(0.94, 0.46, 0.14), vec3<f32>(1.0, 0.60, 0.22), r1.z);
        let wood_c = vec3<f32>(0.04, 0.02, 0.01);
        let jamb = smoothstep(0.0, 0.07, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
        let warm_lv = 0.24 + 0.52 * lamp_glow + 0.16 * low_sh;
        o.base = mix(wood_c, vec3<f32>(0.42, 0.35, 0.26), wood_grid) * (0.72 + 0.28 * jamb);
        o.emissive = mix(wood_c * 0.2, paper * warm_lv, wood_grid) * (0.72 + 0.28 * jamb) * (0.78 + 0.38 * r2.x) * $EmitNits * i.power;
        o.roughness = 0.38;
        o.specular = 0.35;
        return o;
    }

    // Tight room box proportioned around the window aperture
    let hw = aspect * 0.5;
    let rx = hw * (1.05 + r1.x * 0.16);
    let ry = 0.54 + r1.y * 0.08;
    let rz = 1.05 + r1.z * 0.65;
    let p = vec3<f32>((uv.x - 0.5) * aspect, (uv.y - 0.5) + 0.03, 0.0);

    var tx = 1e6;
    if (abs(d.x) > 1e-4) { tx = (select(-rx, rx, d.x > 0.0) - p.x) / d.x; }
    var ty = 1e6;
    if (abs(d.y) > 1e-4) { ty = (select(-ry, ry, d.y > 0.0) - p.y) / d.y; }
    let tz = (-rz - p.z) / d.z;
    let t = min(tz, min(tx, ty));
    let hit = p + d * t;

    var face = 0u;
    if (t == tx) { face = 1u; }
    else if (t == ty) { face = select(3u, 2u, d.y > 0.0); }

    let u_back = clamp(hit.x / rx * 0.5 + 0.5, 0.0, 1.0);
    let v_vert = clamp(hit.y / ry * 0.5 + 0.5, 0.0, 1.0);
    let u_depth = clamp(-hit.z / rz, 0.0, 1.0);

    var back_c = vec3<f32>(0.64, 0.46, 0.28);
    var side_c = vec3<f32>(0.33, 0.22, 0.12);
    var ceil_c = vec3<f32>(0.42, 0.36, 0.30);
    var floor_c = vec3<f32>(0.16, 0.09, 0.04);
    var light_c = vec3<f32>(1.00, 0.62, 0.24);

    if (mode == 0) {
        back_c = mix(vec3<f32>(0.64, 0.46, 0.28), vec3<f32>(0.74, 0.56, 0.36), r2.x);
        side_c = back_c * vec3<f32>(0.52, 0.48, 0.44);
        ceil_c = vec3<f32>(0.42, 0.36, 0.30);
        floor_c = mix(vec3<f32>(0.15, 0.08, 0.035), vec3<f32>(0.24, 0.14, 0.06), r2.y);
        light_c = mix(vec3<f32>(1.00, 0.62, 0.24), vec3<f32>(1.00, 0.74, 0.38), r2.z);
    } else if (mode == 1) {
        back_c = mix(vec3<f32>(0.56, 0.54, 0.50), vec3<f32>(0.70, 0.65, 0.58), r2.x);
        side_c = back_c * vec3<f32>(0.50, 0.51, 0.54);
        ceil_c = vec3<f32>(0.40, 0.40, 0.42);
        floor_c = mix(vec3<f32>(0.18, 0.12, 0.07), vec3<f32>(0.13, 0.12, 0.11), r2.y);
        light_c = mix(vec3<f32>(1.00, 0.84, 0.62), vec3<f32>(0.94, 0.92, 0.86), r2.z);
    } else if (mode == 2) {
        back_c = mix(vec3<f32>(0.52, 0.58, 0.66), vec3<f32>(0.66, 0.70, 0.74), r2.x);
        side_c = back_c * vec3<f32>(0.50, 0.54, 0.60);
        ceil_c = vec3<f32>(0.36, 0.40, 0.45);
        floor_c = vec3<f32>(0.10, 0.12, 0.15);
        light_c = mix(vec3<f32>(0.70, 0.86, 1.00), vec3<f32>(0.85, 0.94, 1.00), r2.z);
    } else {
        back_c = mix(vec3<f32>(0.05, 0.065, 0.085), vec3<f32>(0.08, 0.075, 0.07), r2.x);
        side_c = back_c * 0.58;
        ceil_c = vec3<f32>(0.06, 0.075, 0.095);
        floor_c = vec3<f32>(0.025, 0.022, 0.02);
        light_c = vec3<f32>(0.0);
    }

    let ao_x = smoothstep(0.0, 0.14, 1.0 - abs(hit.x) / rx);
    let ao_y = smoothstep(0.0, 0.14, 1.0 - abs(hit.y) / ry);
    let ao_z = smoothstep(0.0, 0.16, 1.0 - u_depth);
    var ao_p = ao_x * ao_y;
    if (face == 1u) { ao_p = ao_y * ao_z; }
    else if (face >= 2u) { ao_p = ao_x * ao_z; }
    let corner_ao = 0.28 + 0.72 * ao_p;

    let lamp_pos = vec3<f32>(0.0, ry * 0.98, -rz * 0.42);
    let lamp_dist = length((hit - lamp_pos) / vec3<f32>(rx * 1.1, ry * 1.2, rz * 0.85));
    let lamp_fall = 1.0 / (0.65 + lamp_dist * lamp_dist * 1.45);

    var surf = back_c;
    var fix_boost = 0.0;
    if (face == 0u) {
        let base_b = step(v_vert, 0.10);
        surf = mix(back_c, floor_c * 0.55, base_b);
        if (!is_office) {
            if (r3.x < 0.48) {
                let ax = 0.30 + r3.y * 0.40;
                let fr = im_box(vec2<f32>(u_back, v_vert), vec2<f32>(ax - 0.14, 0.52), vec2<f32>(ax + 0.14, 0.80));
                let inn = im_box(vec2<f32>(u_back, v_vert), vec2<f32>(ax - 0.11, 0.55), vec2<f32>(ax + 0.11, 0.77));
                surf = mix(surf, mix(vec3<f32>(0.06, 0.04, 0.03), vec3<f32>(0.36, 0.30, 0.22), inn), fr);
            } else {
                let side = select(0.60, 0.06, r3.y < 0.5);
                let cab = im_box(vec2<f32>(u_back, v_vert), vec2<f32>(side, 0.10), vec2<f32>(side + 0.34, 0.86));
                let sl = step(0.80, fract(v_vert * 6.5));
                surf = mix(surf, mix(vec3<f32>(0.12, 0.07, 0.04), vec3<f32>(0.34, 0.24, 0.16), sl), cab);
            }
        } else {
            let brd = im_box(vec2<f32>(u_back, v_vert), vec2<f32>(0.18, 0.48), vec2<f32>(0.82, 0.82));
            surf = mix(surf, vec3<f32>(0.86, 0.90, 0.94), brd * 0.85);
        }
    } else if (face == 1u) {
        let base_b = step(v_vert, 0.10);
        let ss = select(1.08, 0.92, hit.x > 0.0);
        surf = mix(side_c * ss * (1.08 - 0.32 * u_depth), floor_c * 0.45, base_b);
    } else if (face == 2u) {
        surf = ceil_c * (0.82 - 0.25 * u_depth);
        if (is_office) {
            let s1 = im_box(vec2<f32>(u_back, u_depth), vec2<f32>(0.18, 0.18), vec2<f32>(0.36, 0.78));
            let s2 = im_box(vec2<f32>(u_back, u_depth), vec2<f32>(0.64, 0.18), vec2<f32>(0.82, 0.78));
            fix_boost = max(s1, s2) * 2.6;
        } else {
            let cd = vec2<f32>((u_back - 0.5) * max(aspect, 0.85), (u_depth - 0.42) * 1.15);
            let rad = length(cd);
            let disc = 1.0 - smoothstep(0.15, 0.19, rad);
            let halo = 1.0 - smoothstep(0.18, 0.52, rad);
            fix_boost = disc * 2.8 + halo * 0.30;
        }
    } else {
        let plank = 0.85 + 0.15 * sin(u_back * 34.0);
        surf = floor_c * plank;
    }

    let day_b = mix(0.28, 0.06, pow(u_depth, 0.85)) * (0.62 + 0.38 * v_vert) * corner_ao;
    var room_alb = surf * day_b;
    var room_emit = vec3<f32>(0.0);
    if (is_lit) {
        var fg = 0.64;
        if (face == 1u) { fg = 0.52; }
        else if (face == 2u) { fg = 0.36; }
        else if (face == 3u) { fg = 0.38; }
        room_emit = surf * light_c * (fg * lamp_fall * corner_ao) + light_c * fix_boost;
    }

    // Mid-plane furniture silhouette card (3-layer depth parallax)
    let z_mid = -rz * (0.34 + r3.y * 0.22);
    let t_mid = (z_mid - p.z) / d.z;
    if (t_mid > 0.0 && t_mid < t) {
        let mp = p.xy + d.xy * t_mid;
        if (abs(mp.x) < rx && abs(mp.y) < ry) {
            let mx = mp.x / rx * 0.5 + 0.5;
            let my = mp.y / ry * 0.5 + 0.5;
            var fm = 0.0;
            var fe = vec3<f32>(0.0);
            if (is_office) {
                let dsk = im_box(vec2<f32>(mx, my), vec2<f32>(0.10, 0.0), vec2<f32>(0.90, 0.32));
                let m1 = im_box(vec2<f32>(mx, my), vec2<f32>(0.20, 0.32), vec2<f32>(0.44, 0.52));
                let m2 = im_box(vec2<f32>(mx, my), vec2<f32>(0.56, 0.32), vec2<f32>(0.78, 0.50));
                fm = max(dsk, max(m1, m2));
                if (is_lit && r3.x > 0.40) {
                    fe = vec3<f32>(0.22, 0.48, 0.82) * im_box(vec2<f32>(mx, my), vec2<f32>(0.22, 0.34), vec2<f32>(0.42, 0.50)) * 0.65;
                }
            } else {
                let fl = fract(r1.x * 3.17 + r2.y * 2.41);
                if (fl < 0.36) {
                    let tbl = im_box(vec2<f32>(mx, my), vec2<f32>(0.16, 0.0), vec2<f32>(0.70, 0.27));
                    let sf = im_box(vec2<f32>(mx, my), vec2<f32>(0.22, 0.24), vec2<f32>(0.64, 0.42));
                    let st = im_box(vec2<f32>(mx, my), vec2<f32>(0.785, 0.0), vec2<f32>(0.805, 0.56));
                    let sh = im_box(vec2<f32>(mx, my), vec2<f32>(0.73, 0.54), vec2<f32>(0.86, 0.67));
                    fm = max(max(tbl, sf), max(st, sh));
                    if (is_lit) { fe = light_c * sh * 1.15; }
                } else if (fl < 0.72) {
                    let std_b = im_box(vec2<f32>(mx, my), vec2<f32>(0.24, 0.0), vec2<f32>(0.78, 0.26));
                    let tv = im_box(vec2<f32>(mx, my), vec2<f32>(0.32, 0.26), vec2<f32>(0.70, 0.52));
                    let shf = im_box(vec2<f32>(mx, my), vec2<f32>(0.04, 0.0), vec2<f32>(0.20, 0.72));
                    fm = max(max(std_b, tv), shf);
                    if (is_lit && r3.z < 0.62) {
                        fe = vec3<f32>(0.22, 0.48, 0.86) * im_box(vec2<f32>(mx, my), vec2<f32>(0.34, 0.28), vec2<f32>(0.68, 0.50)) * 0.50;
                    }
                } else {
                    let crd = im_box(vec2<f32>(mx, my), vec2<f32>(0.49, 0.70), vec2<f32>(0.51, 1.0));
                    let shd = im_box(vec2<f32>(mx, my), vec2<f32>(0.39, 0.60), vec2<f32>(0.61, 0.71));
                    let tbl = im_box(vec2<f32>(mx, my), vec2<f32>(0.22, 0.0), vec2<f32>(0.78, 0.30));
                    fm = max(max(crd, shd), tbl);
                    if (is_lit) { fe = light_c * im_box(vec2<f32>(mx, my), vec2<f32>(0.42, 0.59), vec2<f32>(0.58, 0.65)) * 1.65; }
                }
            }
            if (fm > 0.01) {
                room_alb = mix(room_alb, vec3<f32>(0.02, 0.018, 0.015), fm * 0.92);
                if (is_lit) { room_emit = mix(room_emit, vec3<f32>(0.025, 0.02, 0.015) * light_c * 0.35 + fe, fm * 0.95); }
            }
        }
    }

    // Window-plane curtains / Venetian blinds
    var fg_a = 0.0;
    var fg_alb = vec3<f32>(0.22, 0.20, 0.18);
    var fg_emit = vec3<f32>(0.0);
    if (is_office) {
        let drop_f = 0.22 + r2.x * 0.34;
        if (uv.y > 1.0 - drop_f) {
            let slat = 0.65 + 0.35 * sin(uv.y * 150.0);
            fg_a = 0.84;
            fg_alb = vec3<f32>(0.26, 0.29, 0.33) * slat;
            fg_emit = light_c * 0.22 * slat;
        }
    } else {
        let pleat = 0.70 + 0.30 * sin(uv.x * 68.0 + r1.y * 6.28);
        let dl = 0.11 + r2.x * 0.14;
        let dr = 0.11 + r2.y * 0.14;
        let edge_m = 1.0 - smoothstep(dl - 0.015, dl + 0.01, uv.x) * smoothstep(dr - 0.015, dr + 0.01, 1.0 - uv.x);
        if (edge_m > 0.01) {
            fg_a = edge_m * (0.78 + 0.16 * r3.x);
            fg_alb = mix(vec3<f32>(0.24, 0.20, 0.16), vec3<f32>(0.15, 0.18, 0.22), r3.z) * pleat;
            fg_emit = light_c * mix(vec3<f32>(0.14, 0.11, 0.08), vec3<f32>(0.26, 0.22, 0.18), r3.y) * pleat;
        } else if (!is_lit && r3.y > 0.30) {
            fg_a = 0.24;
            fg_alb = vec3<f32>(0.18, 0.20, 0.22) * (0.82 + 0.18 * sin(uv.x * 84.0));
        }
    }
    room_alb = mix(room_alb, fg_alb, fg_a);
    if (is_lit) { room_emit = mix(room_emit, fg_emit, fg_a * 0.88); }

    let jamb_v = smoothstep(0.0, 0.055, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
    let vig = 0.58 + 0.42 * jamb_v;
    let trans = 1.0 - 0.46 * fresnel;
    let bright = 0.74 + 0.44 * r1.z;

    o.base = room_alb * vig * trans;
    o.emissive = room_emit * vig * trans * bright * $EmitNits * i.power;
    o.roughness = 0.05;
    o.metallic = 0.0;
    o.specular = 0.75;`,
});

const SHOP_INTERIOR_FN = new MaterialFunction("im_shop_interior", {
  params: {
    ShopMode: 0,  // 0: kissaten, 1: bookstore, 2: konbini, 3: pharmacy, 4: izakaya, 5: ramen
    EmitNits: 110,
  },
  helpers: COMMON_WGSL_HELPERS,
  code: /* wgsl */ `
    let mode = i32(round($ShopMode));
    let n = i.ng;
    // Pixel-exact glass mask from glTF baked emissiveMap (0 on frames/mullions/wainscot/koushi, >0 on glass!)
    let em_max = max(base.emissive.r, max(base.emissive.g, base.emissive.b));
    let glass_mask = smoothstep(3.0, 12.0, em_max);
    if (glass_mask < 0.005 || abs(n.y) > 0.92) {
        o.base = base.base;
        o.emissive = vec3<f32>(0.0);
        o.roughness = base.roughness;
        return o;
    }

    if (!i.near) {
        o.base = base.base;
        o.emissive = base.emissive * i.power;
        return o;
    }

    let bay_uv = vec2<f32>(fract(i.uv.x), 1.0 - fract(i.uv.y));
    let b_vec = vec3<f32>(0.0, 1.0, 0.0);
    let t_vec = normalize(cross(b_vec, n));
    let bay_center = i.wp.xz - t_vec.xz * (bay_uv.x - 0.5) * 3.1;
    let shop_cell = floor(bay_center * 0.42 + 0.5);
    let seed = im_hash12(shop_cell + vec2<f32>(7.1, 29.3)) * 91.0;
    let r1 = im_hash31(seed + 2.3);
    let r2 = im_hash31(seed + 17.9);
    let r3 = im_hash31(seed + 43.7);

    let ray_w = -i.view;
    let ndotv = clamp(dot(n, i.view), 0.0, 1.0);
    let fresnel = pow(1.0 - ndotv, 4.0);
    let d = vec3<f32>(dot(ray_w, t_vec), dot(ray_w, b_vec), min(dot(ray_w, n), -0.002));

    let aspect = 1.12;
    let rx = 0.82 + r1.x * 0.10;
    let ry = 0.54;
    let rz = select(1.45 + r1.z * 0.45, 1.85 + r1.z * 0.45, mode == 2 || mode == 3);
    let p = vec3<f32>((bay_uv.x - 0.5) * aspect, bay_uv.y - 0.5, 0.0);

    var tx = 1e6;
    if (abs(d.x) > 1e-4) { tx = (select(-rx, rx, d.x > 0.0) - p.x) / d.x; }
    var ty = 1e6;
    if (abs(d.y) > 1e-4) { ty = (select(-ry, ry, d.y > 0.0) - p.y) / d.y; }
    let tz = (-rz - p.z) / d.z;
    let t = min(tz, min(tx, ty));
    let hit = p + d * t;

    var face = 0u;
    if (t == tx) { face = 1u; }
    else if (t == ty) { face = select(3u, 2u, d.y > 0.0); }

    let u_back = clamp(hit.x / rx * 0.5 + 0.5, 0.0, 1.0);
    let v_vert = clamp(hit.y / ry * 0.5 + 0.5, 0.0, 1.0);
    let u_depth = clamp(-hit.z / rz, 0.0, 1.0);

    let ao_x = smoothstep(0.0, 0.14, 1.0 - abs(hit.x) / rx);
    let ao_y = smoothstep(0.0, 0.14, 1.0 - abs(hit.y) / ry);
    let ao_z = smoothstep(0.0, 0.15, 1.0 - u_depth);
    var ao_p = ao_x * ao_y;
    if (face == 1u) { ao_p = ao_y * ao_z; }
    else if (face >= 2u) { ao_p = ao_x * ao_z; }
    let corner_ao = 0.30 + 0.70 * ao_p;
    let depth_sh = mix(1.05, 0.52, u_depth * 0.85);

    var surf = vec3<f32>(0.5);
    var light_c = vec3<f32>(1.0, 0.70, 0.34);
    var fix_boost = 0.0;
    var extra_glow = vec3<f32>(0.0);

    if (mode == 0) {
        // Kissaten (純喫茶)
        light_c = mix(vec3<f32>(1.0, 0.62, 0.24), vec3<f32>(1.0, 0.72, 0.36), r2.x);
        if (face == 0u) {
            let cnt = step(v_vert, 0.36);
            let top = im_box(vec2<f32>(u_back, v_vert), vec2<f32>(0.0, 0.35), vec2<f32>(1.0, 0.39));
            let shf = im_box(vec2<f32>(u_back, v_vert), vec2<f32>(0.12, 0.44), vec2<f32>(0.88, 0.84));
            surf = mix(vec3<f32>(0.64, 0.46, 0.26), vec3<f32>(0.15, 0.08, 0.035), cnt);
            surf = mix(surf, vec3<f32>(0.38, 0.22, 0.10), top);
            if (shf > 0.5) {
                surf = mix(surf, im_shelf_goods(vec2<f32>((u_back - 0.12) / 0.76, (v_vert - 0.44) / 0.40), seed + 5.0, 1.0) * 1.15, 0.92);
                extra_glow += vec3<f32>(0.45, 0.26, 0.09) * 0.35;
            }
        } else if (face == 1u) {
            // Side wall: dark walnut wainscoting + cream plaster + framed vintage shelves/art + brass wall sconce!
            let wns = step(v_vert, 0.36);
            let rail = im_box(vec2<f32>(u_depth, v_vert), vec2<f32>(0.0, 0.35), vec2<f32>(1.0, 0.39));
            surf = mix(vec3<f32>(0.42, 0.31, 0.19), vec3<f32>(0.10, 0.055, 0.025), wns);
            surf = mix(surf, vec3<f32>(0.28, 0.16, 0.08), rail);
            let shf = im_box(vec2<f32>(u_depth, v_vert), vec2<f32>(0.18, 0.44), vec2<f32>(0.82, 0.82));
            if (shf > 0.5) {
                let s_g = im_shelf_goods(vec2<f32>((u_depth - 0.18) / 0.64, (v_vert - 0.44) / 0.38), seed + 13.0, 1.0);
                surf = mix(surf, s_g * 0.95, 0.85);
            }
            let sc = vec2<f32>((u_depth - 0.50) * 1.6, v_vert - 0.86);
            fix_boost += (1.0 - smoothstep(0.03, 0.12, length(sc))) * 1.1;
        } else if (face == 2u) {
            let bm = step(0.86, fract(u_depth * 4.0));
            surf = mix(vec3<f32>(0.24, 0.16, 0.09), vec3<f32>(0.10, 0.06, 0.03), bm);
            let g1 = 1.0 - smoothstep(0.06, 0.24, length(vec2<f32>((u_back - 0.34) * 1.2, u_depth - 0.38)));
            let g2 = 1.0 - smoothstep(0.06, 0.24, length(vec2<f32>((u_back - 0.66) * 1.2, u_depth - 0.38)));
            fix_boost = max(g1, g2) * 0.85;
        } else {
            let chk = floor(u_back * 8.0) + floor(u_depth * 10.0);
            surf = mix(vec3<f32>(0.12, 0.07, 0.04), vec3<f32>(0.24, 0.16, 0.10), chk - 2.0 * floor(chk * 0.5));
        }
    } else if (mode == 1) {
        // Bookstore (書店)
        light_c = mix(vec3<f32>(1.0, 0.78, 0.46), vec3<f32>(1.0, 0.86, 0.62), r2.x);
        if (face <= 1u) {
            let uw = select(u_depth, u_back, face == 0u);
            let sr = step(0.08, v_vert) * step(v_vert, 0.90);
            surf = mix(vec3<f32>(0.18, 0.11, 0.06), im_shelf_goods(vec2<f32>(uw, (v_vert - 0.08) / 0.82), seed + f32(face) * 11.0, 1.0), sr);
            if (face == 1u) { surf *= 0.72; }
        } else if (face == 2u) {
            surf = vec3<f32>(0.42, 0.38, 0.32);
            fix_boost = max(im_box(vec2<f32>(u_back, u_depth), vec2<f32>(0.20, 0.14), vec2<f32>(0.32, 0.86)),
                            im_box(vec2<f32>(u_back, u_depth), vec2<f32>(0.68, 0.14), vec2<f32>(0.80, 0.86))) * 2.2;
        } else {
            surf = vec3<f32>(0.24, 0.15, 0.08) * (0.86 + 0.14 * sin(u_back * 32.0));
        }
    } else if (mode == 2) {
        // Konbini (コンビニ)
        light_c = vec3<f32>(0.95, 0.98, 1.0);
        if (face == 0u) {
            let clr = im_box(vec2<f32>(u_back, v_vert), vec2<f32>(0.06, 0.10), vec2<f32>(0.94, 0.84));
            let df = step(0.92, fract(u_back * 5.0));
            let drk = im_shelf_goods(vec2<f32>((u_back - 0.06) / 0.88, (v_vert - 0.10) / 0.74), seed + 3.0, 0.0);
            surf = mix(vec3<f32>(0.72, 0.76, 0.80), mix(drk, vec3<f32>(0.16, 0.20, 0.24), df), clr);
            extra_glow += vec3<f32>(0.32, 0.56, 0.78) * clr * (1.0 - df) * 0.65;
        } else if (face == 1u) {
            let sh = im_box(vec2<f32>(u_depth, v_vert), vec2<f32>(0.08, 0.08), vec2<f32>(0.92, 0.76));
            surf = mix(vec3<f32>(0.56, 0.58, 0.60), im_shelf_goods(vec2<f32>(u_depth, v_vert / 0.76), seed + 19.0, 0.0) * 0.78, sh);
        } else if (face == 2u) {
            surf = vec3<f32>(0.54, 0.58, 0.62);
            let s1 = im_box(vec2<f32>(u_back, u_depth), vec2<f32>(0.16, 0.06), vec2<f32>(0.26, 0.92));
            let s2 = im_box(vec2<f32>(u_back, u_depth), vec2<f32>(0.45, 0.06), vec2<f32>(0.55, 0.92));
            let s3 = im_box(vec2<f32>(u_back, u_depth), vec2<f32>(0.74, 0.06), vec2<f32>(0.84, 0.92));
            fix_boost = max(s1, max(s2, s3)) * 2.5;
        } else {
            surf = vec3<f32>(0.46, 0.45, 0.42);
        }
    } else if (mode == 3) {
        // Pharmacy (薬局)
        light_c = vec3<f32>(0.86, 0.96, 1.0);
        if (face == 0u) {
            let hdr = im_box(vec2<f32>(u_back, v_vert), vec2<f32>(0.0, 0.82), vec2<f32>(1.0, 0.92));
            let sh = im_box(vec2<f32>(u_back, v_vert), vec2<f32>(0.08, 0.38), vec2<f32>(0.92, 0.80));
            surf = mix(vec3<f32>(0.68, 0.74, 0.74), im_shelf_goods(vec2<f32>(u_back, (v_vert - 0.38) / 0.42), seed + 9.0, 0.0), sh * 0.65);
            surf = mix(surf, vec3<f32>(0.10, 0.46, 0.34), hdr);
        } else if (face == 1u) {
            surf = vec3<f32>(0.48, 0.54, 0.56);
        } else if (face == 2u) {
            surf = vec3<f32>(0.50, 0.56, 0.58);
            fix_boost = max(im_box(vec2<f32>(u_back, u_depth), vec2<f32>(0.22, 0.18), vec2<f32>(0.78, 0.36)),
                            im_box(vec2<f32>(u_back, u_depth), vec2<f32>(0.22, 0.56), vec2<f32>(0.78, 0.74))) * 2.3;
        } else {
            surf = vec3<f32>(0.40, 0.44, 0.45);
        }
    } else {
        // Izakaya / Ramen (居酒屋・中華そば)
        light_c = select(vec3<f32>(1.0, 0.66, 0.26), vec3<f32>(1.0, 0.58, 0.20), mode == 4);
        if (face == 0u) {
            let cnt = step(v_vert, 0.38);
            let plq = im_box(vec2<f32>(u_back, v_vert), vec2<f32>(0.08, 0.66), vec2<f32>(0.92, 0.88)) * step(0.16, fract(u_back * 12.0));
            surf = mix(vec3<f32>(0.56, 0.40, 0.22), vec3<f32>(0.22, 0.11, 0.045), cnt);
            surf = mix(surf, vec3<f32>(0.86, 0.74, 0.52), plq);
        } else if (face == 1u) {
            surf = mix(vec3<f32>(0.40, 0.28, 0.16), vec3<f32>(0.16, 0.08, 0.035), step(v_vert, 0.45));
        } else if (face == 2u) {
            let bm = step(0.82, fract(u_depth * 4.5));
            surf = mix(vec3<f32>(0.20, 0.12, 0.06), vec3<f32>(0.08, 0.04, 0.02), bm);
            let g1 = 1.0 - smoothstep(0.06, 0.18, length(vec2<f32>((u_back - 0.35) * 1.2, u_depth - 0.35)));
            let g2 = 1.0 - smoothstep(0.06, 0.18, length(vec2<f32>((u_back - 0.65) * 1.2, u_depth - 0.65)));
            fix_boost = max(g1, g2) * 2.1;
        } else {
            surf = vec3<f32>(0.12, 0.08, 0.05);
        }
    }

    let day_b = mix(0.30, 0.07, pow(u_depth, 0.85)) * (0.65 + 0.35 * v_vert) * corner_ao;
    var shop_alb = surf * day_b;
    var fg = 0.74;
    if (face == 1u) { fg = 0.56; }
    else if (face >= 2u) { fg = 0.42; }
    var shop_emit = surf * light_c * (fg * depth_sh * corner_ao) + light_c * fix_boost + extra_glow;

    // Mid-plane interior props placed closer (0.22..0.30 * rz) so hanging globe pendants,
    // booths, and gondolas stay prominently visible even at 45-55 deg oblique 50mm street angles!
    let z_mid = -rz * (0.22 + r3.y * 0.08);
    let t_mid = (z_mid - p.z) / d.z;
    if (t_mid > 0.0 && t_mid < t) {
        let mp = p.xy + d.xy * t_mid;
        if (abs(mp.x) < rx && abs(mp.y) < ry) {
            let mx = mp.x / rx * 0.5 + 0.5;
            let my = mp.y / ry * 0.5 + 0.5;
            var pm = 0.0;
            var pc = vec3<f32>(0.03, 0.022, 0.018);
            var pe = vec3<f32>(0.0);
            if (mode == 0) {
                // Hanging vintage glass globe pendants (clearly below exterior awnings!) + dark booth silhouettes
                let c_l = im_box(vec2<f32>(mx, my), vec2<f32>(0.31, 0.66), vec2<f32>(0.328, 1.0));
                let c_r = im_box(vec2<f32>(mx, my), vec2<f32>(0.672, 0.66), vec2<f32>(0.69, 1.0));
                let g_l = 1.0 - smoothstep(0.048, 0.064, length(vec2<f32>(mx - 0.32, (my - 0.63) * 0.88)));
                let g_r = 1.0 - smoothstep(0.048, 0.064, length(vec2<f32>(mx - 0.68, (my - 0.63) * 0.88)));
                let t1 = im_box(vec2<f32>(mx, my), vec2<f32>(0.14, 0.0), vec2<f32>(0.46, 0.34));
                let t2 = im_box(vec2<f32>(mx, my), vec2<f32>(0.54, 0.0), vec2<f32>(0.86, 0.34));
                let b1 = im_box(vec2<f32>(mx, my), vec2<f32>(0.08, 0.0), vec2<f32>(0.18, 0.48));
                let b2 = im_box(vec2<f32>(mx, my), vec2<f32>(0.44, 0.0), vec2<f32>(0.54, 0.48));
                pm = max(max(max(c_l, c_r), max(g_l, g_r)), max(max(t1, t2), max(b1, b2)));
                pe = vec3<f32>(1.0, 0.84, 0.48) * max(g_l, g_r) * 3.0;
            } else if (mode == 1) {
                let tbl = im_box(vec2<f32>(mx, my), vec2<f32>(0.18, 0.0), vec2<f32>(0.82, 0.34));
                let crd = im_box(vec2<f32>(mx, my), vec2<f32>(0.493, 0.74), vec2<f32>(0.507, 1.0));
                let shd = im_box(vec2<f32>(mx, my), vec2<f32>(0.41, 0.67), vec2<f32>(0.59, 0.75));
                pm = max(tbl, max(crd, shd));
                pe = light_c * im_box(vec2<f32>(mx, my), vec2<f32>(0.43, 0.65), vec2<f32>(0.57, 0.69)) * 1.8;
            } else if (mode == 2 || mode == 3) {
                pm = max(im_box(vec2<f32>(mx, my), vec2<f32>(0.08, 0.0), vec2<f32>(0.44, 0.46)),
                         im_box(vec2<f32>(mx, my), vec2<f32>(0.56, 0.0), vec2<f32>(0.92, 0.46)));
                if (pm > 0.5) {
                    let gds = im_shelf_goods(vec2<f32>(mx * 1.4, my / 0.46), seed + 31.0, 0.0);
                    pc = gds * 0.32;
                    pe = gds * light_c * 0.45;
                }
            } else {
                let st = im_box(vec2<f32>(mx, my), vec2<f32>(0.16, 0.0), vec2<f32>(0.26, 0.32)) +
                         im_box(vec2<f32>(mx, my), vec2<f32>(0.44, 0.0), vec2<f32>(0.54, 0.32)) +
                         im_box(vec2<f32>(mx, my), vec2<f32>(0.72, 0.0), vec2<f32>(0.82, 0.32));
                let ll = im_box(vec2<f32>(mx, my), vec2<f32>(0.29, 0.62), vec2<f32>(0.39, 0.77));
                let lr = im_box(vec2<f32>(mx, my), vec2<f32>(0.61, 0.62), vec2<f32>(0.71, 0.77));
                pm = clamp(max(st, max(ll, lr)), 0.0, 1.0);
                pe = vec3<f32>(1.0, 0.56, 0.18) * max(ll, lr) * 1.95;
            }
            if (pm > 0.01) {
                shop_alb = mix(shop_alb, pc, pm * 0.92);
                shop_emit = mix(shop_emit, pc * light_c * 0.35 + pe, pm * 0.94);
            }
        }
    }

    let trans = 1.0 - 0.42 * fresnel;
    let bright = 0.84 + 0.28 * r1.y;
    o.base = mix(base.base, shop_alb * trans, glass_mask);
    o.emissive = shop_emit * trans * bright * $EmitNits * glass_mask * i.power;
    o.roughness = mix(base.roughness, 0.05, glass_mask);
    o.specular = mix(base.specular, 0.75, glass_mask);`,
});

export type WindowInteriorVariant =
  | "living_warm"
  | "modern_led"
  | "office_cool"
  | "amber_shoji"
  | "unlit_curtain"
  | "unlit_blinds";

export type ShopInteriorVariant =
  | "kissaten"
  | "bookstore"
  | "konbini"
  | "pharmacy"
  | "izakaya"
  | "ramen";

const WIN_MODE: Record<WindowInteriorVariant, [number, number]> = {
  living_warm: [0, 115],
  modern_led: [1, 108],
  office_cool: [2, 120],
  amber_shoji: [3, 98],
  unlit_curtain: [4, 0],
  unlit_blinds: [5, 0],
};

const SHOP_MODE: Record<ShopInteriorVariant, [number, number]> = {
  kissaten: [0, 115],
  bookstore: [1, 105],
  konbini: [2, 220],
  pharmacy: [3, 125],
  izakaya: [4, 120],
  ramen: [5, 120],
};

export function windowInterior(variant: WindowInteriorVariant): ShaderBinding {
  const [Mode, EmitNits] = WIN_MODE[variant];
  return WINDOW_INTERIOR_FN.with({ Mode, EmitNits });
}

export function shopInterior(variant: ShopInteriorVariant): ShaderBinding {
  const [ShopMode, EmitNits] = SHOP_MODE[variant];
  return SHOP_INTERIOR_FN.with({ ShopMode, EmitNits });
}
