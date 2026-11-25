// Procedural PBR canvas textures tailored for a photorealistic Japanese townscape:
// - 512x512 heightfield-derived normalMap + roughnessMap + baseColor map for pure architectural
//   claddings (ceramic siding, two-cho porcelain tile, shikkui plaster, cedar/yakisugi wood,
//   concrete block wall) and roofs (kawara clay wave tiles, standing-seam galvalume, slate, solar).
// - Dedicated 3D recessed window interior/glass textures (unlit reflective + 4 lit room types).
// - Masked storefront & fascia signboard textures so walls, frames, and mullions never self-emit.
// - Non-emissive curved utility pole plaques, woven Shotengai street flags, 18 shop sleeve signs,
//   and layered Shotengai archway plaques.
import * as THREE from 'three';

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function finalizeTexture(canvas, { repeat = true, srgb = true, anisotropy = 8 } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  } else {
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
  }
  texture.anisotropy = anisotropy;
  return texture;
}

function makeCanvasTexture(width, height, draw, opts = {}) {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  return finalizeTexture(canvas, opts);
}

function rgbShift(hexInt, delta, rBias = 0, gBias = 0, bBias = 0) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((hexInt >> 16) & 255) + delta + rBias);
  const g = clamp(((hexInt >> 8) & 255) + delta + gBias);
  const b = clamp((hexInt & 255) + delta + bBias);
  return `rgb(${r},${g},${b})`;
}

function hash2(x, y, seed = 1) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Converts a scalar heightfield Float32Array [0..1] into a tangent-space normalMap CanvasTexture,
 * and an optional roughness Float32Array [0..1] into a linear roughnessMap CanvasTexture.
 */
function buildNormalAndRoughnessMaps(width, height, heightField, roughField, {
  strength = 2.4,
  repeat = true,
} = {}) {
  const nCanvas = makeCanvas(width, height);
  const nCtx = nCanvas.getContext('2d');
  const nImg = nCtx.createImageData(width, height);
  const nData = nImg.data;

  const rCanvas = roughField ? makeCanvas(width, height) : null;
  const rCtx = rCanvas ? rCanvas.getContext('2d') : null;
  const rImg = rCtx ? rCtx.createImageData(width, height) : null;
  const rData = rImg ? rImg.data : null;

  const sampleH = (x, y) => {
    const wx = repeat ? ((x % width) + width) % width : Math.max(0, Math.min(width - 1, x));
    const wy = repeat ? ((y % height) + height) % height : Math.max(0, Math.min(height - 1, y));
    return heightField[wy * width + wx];
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const tl = sampleH(x - 1, y - 1);
      const tc = sampleH(x, y - 1);
      const tr = sampleH(x + 1, y - 1);
      const ml = sampleH(x - 1, y);
      const mr = sampleH(x + 1, y);
      const bl = sampleH(x - 1, y + 1);
      const bc = sampleH(x, y + 1);
      const br = sampleH(x + 1, y + 1);

      const dx = ((tr + 2 * mr + br) - (tl + 2 * ml + bl)) * strength;
      // Canvas Y points down while OpenGL tangent +Y points up
      const dy = ((tl + 2 * tc + tr) - (bl + 2 * bc + br)) * strength;
      const invLen = 1.0 / Math.hypot(dx, dy, 1.0);

      const p4 = idx * 4;
      nData[p4] = Math.round((-dx * invLen * 0.5 + 0.5) * 255);
      nData[p4 + 1] = Math.round((dy * invLen * 0.5 + 0.5) * 255);
      nData[p4 + 2] = Math.round((invLen * 0.5 + 0.5) * 255);
      nData[p4 + 3] = 255;

      if (rData) {
        const rv = Math.max(0, Math.min(255, Math.round(roughField[idx] * 255)));
        rData[p4] = rv;
        rData[p4 + 1] = rv;
        rData[p4 + 2] = rv;
        rData[p4 + 3] = 255;
      }
    }
  }

  nCtx.putImageData(nImg, 0, 0);
  const normalMap = finalizeTexture(nCanvas, { repeat, srgb: false });
  let roughnessMap = null;
  if (rCtx && rImg) {
    rCtx.putImageData(rImg, 0, 0);
    roughnessMap = finalizeTexture(rCanvas, { repeat, srgb: false });
  }
  return { normalMap, roughnessMap };
}

// ------------------------------------------------------------------ 1. PURE ARCHITECTURAL CLADDINGS (512x512 PBR)

/**
 * Pure exterior wall cladding PBR texture set (no 2D fake windows; windows are real 3D geometry).
 * Styles: 'siding', 'tile', 'comm_tile', 'plaster', 'wood_warm', 'yakisugi'
 */
export function createWallCladdingPBR({
  baseHex,
  style = 'siding',
  accentHex = null,
  seed = 17,
}) {
  const S = 512;
  const hField = new Float32Array(S * S);
  const rField = new Float32Array(S * S);

  const map = makeCanvasTexture(S, S, (g, w, h) => {
    g.fillStyle = rgbShift(baseHex, 0);
    g.fillRect(0, 0, w, h);

    if (style === 'siding') {
      // Japanese窯業系サイディング (16 horizontal boards per 2.9m storey + vertical caulking joint)
      const pitch = 32;
      for (let row = 0; row < h / pitch; row++) {
        const y0 = row * pitch;
        const boardJitter = ((hash2(row, 3, seed) - 0.5) * 6);
        g.fillStyle = rgbShift(baseHex, boardJitter);
        g.fillRect(0, y0 + 3, w, pitch - 4);
        // Subtle lap shadow & highlight
        g.fillStyle = rgbShift(baseHex, -18);
        g.fillRect(0, y0, w, 3);
        g.fillStyle = rgbShift(baseHex, 9);
        g.fillRect(0, y0 + 3, w, 2);
      }
      // Vertical caulking joint (コーキング目地) at x = 254..258 & 508..512
      for (const jx of [255, 509]) {
        g.fillStyle = rgbShift(baseHex, -14);
        g.fillRect(jx, 0, 3, h);
      }

      for (let y = 0; y < h; y++) {
        const ry = y % pitch;
        const lapH = ry < 3 ? 0.18 : (ry < 5 ? 0.92 : 0.78 - (ry / pitch) * 0.12);
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          const inCaulk = (x >= 255 && x <= 257) || x >= 509;
          const stucco = (hash2(x >> 1, y >> 1, seed) - 0.5) * 0.08;
          hField[idx] = inCaulk ? 0.25 : lapH + stucco;
          rField[idx] = inCaulk ? 0.92 : (0.72 + (hash2(x, y, seed + 5) - 0.5) * 0.08);
        }
      }
    } else if (style === 'tile' || style === 'comm_tile') {
      // Japanese 二丁掛磁器質タイル (staggered for residential, stacked/staggered for commercial)
      const tw = style === 'comm_tile' ? 64 : 64;
      const th = style === 'comm_tile' ? 24 : 20;
      const staggered = style === 'tile';
      // Mortar grout base
      g.fillStyle = rgbShift(baseHex, -26);
      g.fillRect(0, 0, w, h);

      const rows = Math.ceil(h / th);
      const cols = Math.ceil(w / tw) + 1;
      for (let r = 0; r < rows; r++) {
        const off = staggered ? (r % 2) * (tw / 2) : 0;
        for (let c = -1; c < cols; c++) {
          const tx = c * tw + off;
          const ty = r * th;
          const jitter = (hash2(c + 10, r, seed) - 0.5) * 16;
          const warmShift = (hash2(c + 33, r + 7, seed) - 0.5) * 6;
          g.fillStyle = rgbShift(baseHex, jitter, warmShift, 0, -warmShift * 0.5);
          g.fillRect(tx + 2, ty + 2, tw - 3, th - 3);
          // Glaze top bevel highlight
          g.fillStyle = 'rgba(255,255,255,0.08)';
          g.fillRect(tx + 2, ty + 2, tw - 3, 2);
        }
      }

      if (style === 'comm_tile' && accentHex !== null) {
        // Horizontal spandrel band at floor line
        g.fillStyle = rgbShift(accentHex, -6);
        g.fillRect(0, 0, w, 28);
        g.fillStyle = 'rgba(0,0,0,0.16)';
        g.fillRect(0, 28, w, 4);
      }

      for (let y = 0; y < h; y++) {
        const r = Math.floor(y / th);
        const ly = y - r * th;
        const off = staggered ? (r % 2) * (tw / 2) : 0;
        const inBand = style === 'comm_tile' && accentHex !== null && y < 28;
        for (let x = 0; x < w; x++) {
          const lx = ((x - off) % tw + tw) % tw;
          const isGrout = !inBand && (lx < 2 || lx >= tw - 1 || ly < 2 || ly >= th - 1);
          const idx = y * w + x;
          const pillow = isGrout ? 0.12 : 0.85 + Math.sin((lx / tw) * Math.PI) * 0.08;
          hField[idx] = inBand ? 0.92 : pillow + (hash2(x, y, seed) - 0.5) * 0.03;
          rField[idx] = isGrout ? 0.94 : (style === 'comm_tile' ? 0.46 : 0.54) + (hash2(x >> 2, y >> 2, seed + 9) - 0.5) * 0.1;
        }
      }
    } else if (style === 'wood_warm' || style === 'yakisugi') {
      // Vertical Japanese cedar boards (杉板縦張り / 焼杉)
      const bw = 32;
      for (let col = 0; col < w / bw; col++) {
        const x0 = col * bw;
        const plankDelta = (hash2(col, 1, seed) - 0.5) * 18;
        g.fillStyle = rgbShift(baseHex, plankDelta);
        g.fillRect(x0, 0, bw - 3, h);
        // Wood grain streaks
        for (let sx = 2; sx < bw - 4; sx += 3) {
          const grain = (hash2(col * 13 + sx, 5, seed) - 0.5) * 14;
          g.fillStyle = rgbShift(baseHex, plankDelta + grain);
          g.fillRect(x0 + sx, 0, 2, h);
        }
        // Deep board seam
        g.fillStyle = rgbShift(baseHex, -32);
        g.fillRect(x0 + bw - 3, 0, 3, h);
      }

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const lx = x % bw;
          const inGroove = lx >= bw - 3;
          const grain = (hash2(x, y >> 3, seed) - 0.5) * 0.12;
          const idx = y * w + x;
          hField[idx] = inGroove ? 0.15 : 0.82 + grain;
          rField[idx] = inGroove ? 0.95 : (style === 'yakisugi' ? 0.68 : 0.76) - grain * 0.25;
        }
      }
    } else {
      // Troweled Shikkui / architectural stucco plaster (漆喰・モルタル左官仕上げ)
      for (let py = 0; py < h; py += 8) {
        for (let px = 0; px < w; px += 8) {
          const n = (hash2(px >> 3, py >> 3, seed) - 0.5) * 8 + (hash2(px >> 5, py >> 5, seed + 3) - 0.5) * 8;
          g.fillStyle = rgbShift(baseHex, n);
          g.fillRect(px, py, 8, 8);
        }
      }
      // Subtle floor drip joint at bottom
      g.fillStyle = 'rgba(0,0,0,0.09)';
      g.fillRect(0, h - 5, w, 5);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          const trowel = (hash2(x >> 2, y >> 2, seed) - 0.5) * 0.16 + (hash2(x, y, seed + 11) - 0.5) * 0.08;
          hField[idx] = y >= h - 4 ? 0.35 : 0.7 + trowel;
          rField[idx] = 0.84 + (hash2(x >> 1, y >> 1, seed + 19) - 0.5) * 0.1;
        }
      }
    }

    // Subtle rainwater / ambient weathering gradient near bottom of storey
    const weatherGrad = g.createLinearGradient(0, h - 36, 0, h);
    weatherGrad.addColorStop(0, 'rgba(0,0,0,0)');
    weatherGrad.addColorStop(1, 'rgba(20,18,15,0.07)');
    g.fillStyle = weatherGrad;
    g.fillRect(0, h - 36, w, 36);
  });

  const strength = style === 'plaster' ? 1.3 : (style === 'siding' ? 2.6 : 2.9);
  const { normalMap, roughnessMap } = buildNormalAndRoughnessMaps(S, S, hField, rField, { strength, repeat: true });
  return { map, normalMap, roughnessMap };
}

/**
 * Concrete block wall (ブロック塀) 256x256 PBR set for residential lot boundaries.
 */
export function createBlockWallPBR(baseHex = 0x9b9890) {
  const S = 256;
  const hField = new Float32Array(S * S);
  const rField = new Float32Array(S * S);
  const bw = 64;
  const bh = 32;

  const map = makeCanvasTexture(S, S, (g, w, h) => {
    g.fillStyle = rgbShift(baseHex, -22);
    g.fillRect(0, 0, w, h);
    for (let r = 0; r < h / bh; r++) {
      const off = (r % 2) * (bw / 2);
      for (let c = -1; c < w / bw + 1; c++) {
        const jitter = (hash2(c + 5, r, 41) - 0.5) * 14;
        g.fillStyle = rgbShift(baseHex, jitter);
        g.fillRect(c * bw + off + 2, r * bh + 2, bw - 4, bh - 4);
      }
    }
    // Base dampness & moss weathering
    const grad = g.createLinearGradient(0, h - 56, 0, h);
    grad.addColorStop(0, 'rgba(52,62,45,0)');
    grad.addColorStop(1, 'rgba(42,54,36,0.34)');
    g.fillStyle = grad;
    g.fillRect(0, h - 56, w, 56);
  });

  for (let y = 0; y < S; y++) {
    const r = Math.floor(y / bh);
    const ly = y - r * bh;
    const off = (r % 2) * (bw / 2);
    for (let x = 0; x < S; x++) {
      const lx = ((x - off) % bw + bw) % bw;
      const joint = lx < 2 || lx >= bw - 2 || ly < 2 || ly >= bh - 2;
      const grit = (hash2(x, y, 77) - 0.5) * 0.18;
      const idx = y * S + x;
      hField[idx] = (joint ? 0.18 : 0.82) + grit;
      rField[idx] = joint ? 0.96 : 0.88 + grit * 0.2;
    }
  }

  const { normalMap, roughnessMap } = buildNormalAndRoughnessMaps(S, S, hField, rField, { strength: 3.0, repeat: true });
  return { map, normalMap, roughnessMap };
}

// ------------------------------------------------------------------ 2. ROOF PBR TEXTURES (512x512)

export function createRoofPBR({ baseHex, style = 'kawara' }) {
  const S = 512;
  const hField = new Float32Array(S * S);
  const rField = new Float32Array(S * S);

  const map = makeCanvasTexture(S, S, (g, w, h) => {
    g.fillStyle = rgbShift(baseHex, 0);
    g.fillRect(0, 0, w, h);

    if (style === 'kawara') {
      // Japanese S-profile clay wave tiles (和瓦・桟瓦)
      const cols = 8;
      const rows = 8;
      const cw = w / cols;
      const rh = h / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * cw;
          const y = r * rh;
          const tileTone = (hash2(c, r, 91) - 0.5) * 8;
          const grad = g.createLinearGradient(x, y, x + cw, y);
          grad.addColorStop(0, rgbShift(baseHex, -22 + tileTone));
          grad.addColorStop(0.36, rgbShift(baseHex, 20 + tileTone));
          grad.addColorStop(0.74, rgbShift(baseHex, -8 + tileTone));
          grad.addColorStop(1, rgbShift(baseHex, -28 + tileTone));
          g.fillStyle = grad;
          g.fillRect(x, y, cw, rh - 3);
          g.fillStyle = 'rgba(0,0,0,0.38)';
          g.fillRect(x, y + rh - 4, cw, 4);
        }
      }

      for (let y = 0; y < h; y++) {
        const ly = (y % rh) / rh;
        const stepDrop = ly > 0.9 ? 0.15 : 0.45 + (1 - ly) * 0.22;
        for (let x = 0; x < w; x++) {
          const lx = (x % cw) / cw;
          const wave = Math.sin(lx * Math.PI * 2 - 0.5) * 0.28;
          const idx = y * w + x;
          hField[idx] = Math.max(0, Math.min(1, stepDrop + wave));
          rField[idx] = ly > 0.88 ? 0.85 : (0.42 - wave * 0.18);
        }
      }
    } else if (style === 'galvalume') {
      // Standing-seam metal roof (ガルバリウム鋼板縦ハゼ葺き)
      const seam = 32;
      for (let x = 0; x < w; x += seam) {
        const panShift = (hash2(x / seam, 2, 63) - 0.5) * 5;
        g.fillStyle = rgbShift(baseHex, 3 + panShift);
        g.fillRect(x, 0, seam - 5, h);
        g.fillStyle = rgbShift(baseHex, 22);
        g.fillRect(x + seam - 5, 0, 2, h);
        g.fillStyle = rgbShift(baseHex, -26);
        g.fillRect(x + seam - 3, 0, 3, h);
      }

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const lx = x % seam;
          const rib = lx >= seam - 5 ? (lx >= seam - 2 ? 0.2 : 0.98) : 0.42 + Math.sin((y / h) * Math.PI * 4) * 0.02;
          const idx = y * w + x;
          hField[idx] = rib;
          rField[idx] = lx >= seam - 5 ? 0.34 : 0.44;
        }
      }
    } else if (style === 'solar') {
      g.fillStyle = '#111e33';
      g.fillRect(0, 0, w, h);
      // Cell grid
      g.strokeStyle = 'rgba(175, 208, 240, 0.38)';
      g.lineWidth = 2;
      for (let x = 64; x < w; x += 64) {
        g.beginPath(); g.moveTo(x, 8); g.lineTo(x, h - 8); g.stroke();
      }
      for (let y = 64; y < h; y += 64) {
        g.beginPath(); g.moveTo(8, y); g.lineTo(w - 8, y); g.stroke();
      }
      // Anodized perimeter frame
      g.strokeStyle = '#9aa8b6';
      g.lineWidth = 10;
      g.strokeRect(5, 5, w - 10, h - 10);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const onFrame = x < 10 || x >= w - 10 || y < 10 || y >= h - 10;
          const onGrid = (x % 64) < 2 || (y % 64) < 2;
          const idx = y * w + x;
          hField[idx] = onFrame ? 0.98 : (onGrid ? 0.46 : 0.52);
          rField[idx] = onFrame ? 0.46 : 0.14;
        }
      }
    } else {
      // Slate / Colonial shingles (化粧スレート)
      const rh = 32;
      const cw = 128;
      for (let r = 0; r < h / rh; r++) {
        const off = (r % 2) * 64;
        for (let c = -1; c < 5; c++) {
          const tone = (hash2(c + 4, r, 105) - 0.5) * 14;
          g.fillStyle = rgbShift(baseHex, tone);
          g.fillRect(c * cw + off + 1, r * rh + 1, cw - 3, rh - 4);
        }
        g.fillStyle = 'rgba(0,0,0,0.32)';
        g.fillRect(0, (r + 1) * rh - 4, w, 4);
      }

      for (let y = 0; y < h; y++) {
        const r = Math.floor(y / rh);
        const ly = y - r * rh;
        const off = (r % 2) * 64;
        for (let x = 0; x < w; x++) {
          const lx = ((x - off) % cw + cw) % cw;
          const seam = lx < 2 || ly >= rh - 4;
          const idx = y * w + x;
          hField[idx] = seam ? 0.18 : 0.72 + (1 - ly / rh) * 0.16 + (hash2(x, y, 53) - 0.5) * 0.05;
          rField[idx] = seam ? 0.92 : 0.74;
        }
      }
    }
  });

  const strength = style === 'kawara' ? 3.4 : (style === 'solar' ? 1.5 : 2.6);
  const { normalMap, roughnessMap } = buildNormalAndRoughnessMaps(S, S, hField, rField, { strength, repeat: true });
  return { map, normalMap, roughnessMap };
}

// ------------------------------------------------------------------ 3. 3D RECESSED WINDOW PANE TEXTURES

/**
 * Unlit reflective residential/commercial window glass with subtle sheer curtains / blinds behind it.
 */
export function createUnlitWindowTexture({ style = 'curtain' } = {}) {
  return makeCanvasTexture(256, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#2a3c4a');
    grad.addColorStop(0.5, '#1a252e');
    grad.addColorStop(1, '#141a20');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    if (style === 'blinds') {
      // Upper half Venetian blinds behind office glass
      g.fillStyle = 'rgba(185, 198, 208, 0.20)';
      for (let y = 10; y < h * 0.52; y += 10) {
        g.fillRect(8, y, w - 16, 5);
      }
    } else {
      // Soft Japanese sheer lace curtains (レースカーテン) parted slightly in middle
      g.fillStyle = 'rgba(218, 222, 224, 0.17)';
      g.fillRect(8, 12, w * 0.43, h - 20);
      g.fillRect(w * 0.53, 18, w * 0.39, h - 26);
      for (let x = 14; x < w - 14; x += 14) {
        g.fillStyle = 'rgba(0,0,0,0.08)';
        g.fillRect(x, 12, 3, h - 20);
      }
    }
  }, { repeat: true });
}

/**
 * Lit interior room window texture + matching emissiveMap for 3D recessed windows.
 * Variants: 'living_warm', 'amber_shoji', 'office_cool', 'modern_led'
 */
export function createLitWindowTextureSet(variant = 'living_warm') {
  const cfg = {
    living_warm: { top: '#fff1d0', mid: '#f5cb86', bot: '#9e6b3b', blind: 'curtain' },
    amber_shoji: { top: '#ffe4ad', mid: '#ebb065', bot: '#8c5326', blind: 'shoji' },
    office_cool: { top: '#eef6ff', mid: '#c6dff5', bot: '#6e8ba6', blind: 'blinds' },
    modern_led:  { top: '#fff7e6', mid: '#f5dcab', bot: '#8f7551', blind: 'curtain' },
  }[variant] ?? { top: '#fff1d0', mid: '#f5cb86', bot: '#9e6b3b', blind: 'curtain' };

  const drawRoom = (g, w, h, isEmissive) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, cfg.top);
    grad.addColorStop(0.55, cfg.mid);
    grad.addColorStop(1, cfg.bot);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    // Ceiling fixture hotspot near top center
    const lamp = g.createRadialGradient(w * 0.5, h * 0.16, 4, w * 0.5, h * 0.16, w * 0.48);
    lamp.addColorStop(0, 'rgba(255,255,250,0.65)');
    lamp.addColorStop(1, 'rgba(255,255,250,0)');
    g.fillStyle = lamp;
    g.fillRect(0, 0, w, h);

    if (cfg.blind === 'blinds') {
      // Venetian blinds on upper 42% + dark desk/monitor silhouette at bottom
      g.fillStyle = isEmissive ? 'rgba(35, 45, 58, 0.35)' : 'rgba(60, 72, 85, 0.32)';
      for (let y = 8; y < h * 0.42; y += 11) {
        g.fillRect(0, y, w, 4);
      }
      g.fillStyle = isEmissive ? '#101418' : '#232830';
      g.fillRect(w * 0.14, h * 0.78, w * 0.48, h * 0.22);
    } else if (cfg.blind === 'shoji') {
      // Fine shoji paper grid (障子桟)
      g.fillStyle = isEmissive ? 'rgba(55, 34, 18, 0.55)' : '#543820';
      for (let x = 32; x < w; x += 32) g.fillRect(x - 1, 0, 3, h);
      for (let y = 42; y < h; y += 42) g.fillRect(0, y - 1, w, 3);
    } else {
      // Gathered side curtains framing the lit room + subtle indoor plant/shelf silhouette
      g.fillStyle = isEmissive ? 'rgba(58, 42, 28, 0.48)' : 'rgba(92, 74, 58, 0.45)';
      g.fillRect(0, 0, w * 0.18, h);
      g.fillRect(w * 0.82, 0, w * 0.18, h);
      g.fillStyle = isEmissive ? 'rgba(24, 18, 14, 0.65)' : '#332922';
      g.fillRect(w * 0.62, h * 0.72, w * 0.2, h * 0.28);
    }

    // Vignette around edges from recessed window jambs
    g.strokeStyle = isEmissive ? '#000000' : 'rgba(0,0,0,0.45)';
    g.lineWidth = 10;
    g.strokeRect(0, 0, w, h);
  };

  return {
    map: makeCanvasTexture(256, 256, (g, w, h) => drawRoom(g, w, h, false), { repeat: true }),
    emissiveMap: makeCanvasTexture(256, 256, (g, w, h) => drawRoom(g, w, h, true), { repeat: true }),
  };
}

// ------------------------------------------------------------------ 4. STOREFRONT BAYS & 3D FASCIA SIGNS (MASKED EMISSIVE!)

/**
 * Ground-floor recessed storefront bay texture + STRICT emissiveMap mask:
 * ONLY glass/shoji interior panes glow; plaster walls, wood wainscoting, frames, and lattice stay #000000!
 * Variants: 'izakaya', 'ramen', 'kissaten', 'pharmacy', 'bookstore', 'konbini'
 */
export function createShopfrontBayTextureSet(variant) {
  const W = 512;
  const H = 512;

  const drawBay = (g, isMask) => {
    g.scale(2, 2);
    const w = 256;
    const h = 256;

    if (isMask) {
      g.fillStyle = '#000000';
      g.fillRect(0, 0, w, h);
    }

    if (variant === 'konbini') {
      if (!isMask) {
        g.fillStyle = '#d8dce0';
        g.fillRect(0, 0, w, h);
      }
      const gx = 10;
      const gy = 14;
      const gw = w - 20;
      const gh = h - 30;

      // Bright lit convenience store interior visible through plate glass
      const grad = g.createLinearGradient(0, gy, 0, gy + gh);
      grad.addColorStop(0, isMask ? '#eef7ff' : '#d8eaf5');
      grad.addColorStop(0.35, isMask ? '#fff9eb' : '#efeada');
      grad.addColorStop(1, isMask ? '#c8bfa8' : '#bfb59e');
      g.fillStyle = grad;
      g.fillRect(gx, gy, gw, gh);

      // Interior fluorescent ceiling strips
      g.fillStyle = '#ffffff';
      g.fillRect(gx + 16, gy + 10, gw - 32, 6);
      g.fillRect(gx + 26, gy + 24, gw - 52, 4);

      // Colorful product shelves inside
      const shelfColors = ['#d94f3d', '#ebad3b', '#3fa162', '#3f7cb8', '#ebe6dc'];
      for (let sy = gy + 56; sy < gy + gh - 24; sy += 32) {
        g.fillStyle = isMask ? '#2c3036' : '#4a4f55';
        g.fillRect(gx + 18, sy + 15, gw - 36, 5);
        for (let sx = gx + 22; sx < gx + gw - 28; sx += 17) {
          g.fillStyle = shelfColors[(sx + sy) % shelfColors.length];
          g.globalAlpha = isMask ? 0.65 : 0.82;
          g.fillRect(sx, sy, 13, 14);
        }
        g.globalAlpha = 1;
      }

      // Non-emissive aluminum mullions, poster貼紙 & stainless kickplate!
      g.fillStyle = isMask ? '#000000' : '#9ca3ab';
      g.fillRect(0, 0, w, gy);
      g.fillRect(0, 0, gx, h);
      g.fillRect(w - gx, 0, gx, h);
      g.fillRect(w / 2 - 4, gy, 8, gh);
      g.fillRect(gx, gy + 44, gw, 5);
      // Kickplate at bottom
      g.fillStyle = isMask ? '#000000' : '#4b5057';
      g.fillRect(0, h - 18, w, 18);
      return;
    }

    if (variant === 'izakaya' || variant === 'ramen') {
      const wood = variant === 'izakaya' ? '#3d2819' : '#4c2917';
      const wall = variant === 'izakaya' ? '#ddd2bf' : '#29221e';
      if (!isMask) {
        g.fillStyle = wall;
        g.fillRect(0, 0, w, h);
        // Timber post & lintel framing
        g.fillStyle = wood;
        g.fillRect(10, 12, w - 20, h - 22);
        // Cedar腰壁 (wainscoting planks) on right window bottom
        g.fillStyle = '#332114';
        g.fillRect(132, 162, 102, h - 174);
      }

      // Warm shoji / frosted glass panes (ONLY these glow in mask!)
      const warm = g.createLinearGradient(0, 26, 0, h - 26);
      warm.addColorStop(0, '#ffe2a3');
      warm.addColorStop(0.55, '#e09d4c');
      warm.addColorStop(1, isMask ? '#6e4219' : '#805127');
      g.fillStyle = warm;
      // Left sliding hikido door glass
      g.fillRect(22, 26, 96, h - 46);
      // Right counter window
      g.fillRect(134, 26, 98, 132);

      // Opaque wooden lattice bars (木格子) mask out the glow cleanly!
      g.fillStyle = isMask ? '#000000' : wood;
      for (let x = 22; x <= 118; x += 16) g.fillRect(x, 26, 4, h - 46);
      for (let y = 26; y <= h - 22; y += 26) g.fillRect(22, y, 96, 4);
      for (let x = 134; x <= 232; x += 19) g.fillRect(x, 26, 4, 132);
      g.fillRect(134, 90, 98, 4);

      if (!isMask) {
        // Granite threshold base
        g.fillStyle = '#57544e';
        g.fillRect(0, h - 14, w, 14);
      } else {
        g.fillRect(0, h - 20, w, 20);
      }
      return;
    }

    // Kissaten / Bookstore / Pharmacy architectural shopfronts
    const pal = {
      kissaten:  { wall: '#21362e', wood: '#4a311e', trim: '#c7a66b', gTop: '#ffe8b8', gBot: '#b57c42', dayTop: '#4c6168', dayBot: '#8f6439' },
      bookstore: { wall: '#263040', wood: '#3b2b1e', trim: '#dfd5c0', gTop: '#fff0cc', gBot: '#b88c54', dayTop: '#516675', dayBot: '#7d6344' },
      pharmacy:  { wall: '#e8e5dc', wood: '#cfd5d2', trim: '#1d7556', gTop: '#eef9ff', gBot: '#bad6e3', dayTop: '#8db2c2', dayBot: '#d2ddd9' },
    }[variant] ?? { wall: '#2c353d', wood: '#3d352e', trim: '#dfd7c5', gTop: '#ffebc2', gBot: '#b3834c', dayTop: '#587180', dayBot: '#7d6648' };

    if (!isMask) {
      g.fillStyle = pal.wall;
      g.fillRect(0, 0, w, h);
      // Lower wood/tile wainscoting under display window
      g.fillStyle = pal.wood;
      g.fillRect(14, h - 66, 144, 52);
    }

    const gl = g.createLinearGradient(0, 22, 0, h - 22);
    gl.addColorStop(0, isMask ? pal.gTop : pal.dayTop);
    gl.addColorStop(1, isMask ? pal.gBot : pal.dayBot);
    g.fillStyle = gl;
    // Left display window (stops above wainscoting!)
    g.fillRect(18, 22, 136, h - 92);
    // Right glazed entrance door
    g.fillRect(170, 22, 68, h - 42);

    // Interior warm pendant globes / pharmacy shelves
    if (variant === 'pharmacy') {
      for (let sy = 56; sy < h - 96; sy += 28) {
        g.fillStyle = isMask ? 'rgba(30,50,55,0.45)' : 'rgba(60,80,85,0.45)';
        g.fillRect(26, sy + 12, 120, 4);
      }
    } else {
      g.fillStyle = isMask ? '#ffffff' : 'rgba(255, 232, 178, 0.85)';
      g.beginPath();
      g.arc(58, 64, 9, 0, Math.PI * 2);
      g.arc(114, 64, 9, 0, Math.PI * 2);
      g.fill();
      // Interior bookspines / coffee counter silhouette
      g.fillStyle = isMask ? 'rgba(32,20,12,0.55)' : 'rgba(45,30,18,0.55)';
      g.fillRect(24, h - 108, 124, 38);
    }

    // Opaque mullions & frames mask out glow!
    g.strokeStyle = isMask ? '#000000' : pal.trim;
    g.lineWidth = 6;
    g.strokeRect(18, 22, 136, h - 92);
    g.strokeRect(170, 22, 68, h - 42);
    g.fillStyle = isMask ? '#000000' : pal.trim;
    g.fillRect(84, 22, 4, h - 92);
    g.fillRect(170, 124, 68, 5);

    if (!isMask) {
      g.fillStyle = '#3a3834';
      g.fillRect(0, h - 14, w, 14);
    } else {
      g.fillStyle = '#000000';
      g.fillRect(0, h - 20, w, 20);
    }
  };

  return {
    map: makeCanvasTexture(W, H, (g) => drawBay(g, false), { repeat: true }),
    emissiveMap: makeCanvasTexture(W, H, (g) => drawBay(g, true), { repeat: true }),
  };
}

/**
 * Clamped [0..1] 3D shop fascia signboard texture + masked emissiveMap (never slices mid-character!).
 */
export function createShopFasciaSignSet({ bg, fg, text, sub = '', border = '#2c2824', backlit = true }) {
  const W = 640;
  const H = 144;
  const draw = (g, w, h, isMask) => {
    if (isMask && !backlit) {
      // Wood-carved traditional sign: externally lit by streetlamps/lanterns, minimal self-glow
      g.fillStyle = '#000000';
      g.fillRect(0, 0, w, h);
      return;
    }
    // Outer frame stays strictly non-emissive (#000000) in mask
    g.fillStyle = isMask ? '#000000' : border;
    g.fillRect(0, 0, w, h);

    if (isMask) {
      // Subtle internal fluorescent tube falloff on background + crisp glowing text
      const bgGrad = g.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w * 0.55);
      bgGrad.addColorStop(0, bg);
      bgGrad.addColorStop(1, '#121212');
      g.fillStyle = bgGrad;
      g.globalAlpha = 0.35;
      g.fillRect(12, 12, w - 24, h - 24);
      g.globalAlpha = 1;
    } else {
      g.fillStyle = bg;
      g.fillRect(10, 10, w - 20, h - 20);
      g.strokeStyle = 'rgba(255,255,255,0.22)';
      g.lineWidth = 2;
      g.strokeRect(16, 16, w - 32, h - 32);
    }

    g.fillStyle = isMask ? '#fffaf0' : fg;
    g.font = 'bold 58px "Hiragino Mincho ProN", "Hiragino Kaku Gothic ProN", "Yu Gothic", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, sub ? h * 0.44 : h * 0.52);

    if (sub) {
      g.font = 'bold 20px "Hiragino Kaku Gothic ProN", sans-serif';
      g.fillStyle = isMask ? '#d8d2c5' : fg;
      g.fillText(sub, w / 2, h * 0.8);
    }
  };

  return {
    map: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, false), { repeat: false }),
    emissiveMap: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, true), { repeat: false }),
  };
}

/**
 * Konbini multi-stripe fascia & roadside pylon sign sets (replaces blank glowing cyan block!).
 */
export function createKonbiniFasciaSet(variant = 'lawson') {
  const W = 512;
  const H = 128;
  const draw = (g, w, h, isMask) => {
    g.fillStyle = isMask ? '#000000' : '#dcdad2';
    g.fillRect(0, 0, w, h);

    if (variant === 'lawson') {
      g.fillStyle = isMask ? '#2c82d6' : '#1d6ab5';
      g.fillRect(0, 10, w, 74);
      g.fillStyle = '#ffffff';
      g.fillRect(0, 84, w, 14);
      g.fillStyle = isMask ? '#e3647c' : '#d4536b';
      g.fillRect(0, 98, w, 14);
    } else {
      g.fillStyle = isMask ? '#22ad55' : '#199647';
      g.fillRect(0, 10, w, 40);
      g.fillStyle = '#ffffff';
      g.fillRect(0, 50, w, 20);
      g.fillStyle = isMask ? '#1c82d4' : '#156fb8';
      g.fillRect(0, 70, w, 42);
    }
    // Subtle vertical acrylic panel seams
    g.fillStyle = isMask ? '#000000' : 'rgba(0,0,0,0.18)';
    g.fillRect(w / 2 - 1, 10, 2, 102);
  };
  return {
    map: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, false), { repeat: true }),
    emissiveMap: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, true), { repeat: true }),
  };
}

export function createKonbiniPylonSet(variant = 'lawson') {
  const W = 256;
  const H = 320;
  const draw = (g, w, h, isMask) => {
    // Aluminum outer bezel never glows
    g.fillStyle = isMask ? '#000000' : '#8b929a';
    g.fillRect(0, 0, w, h);

    const primary = variant === 'lawson' ? '#1c68b3' : '#199446';
    const secondary = variant === 'lawson' ? '#d4536b' : '#156fb8';

    g.fillStyle = isMask ? primary : primary;
    g.fillRect(14, 14, w - 28, h - 28);

    g.fillStyle = '#ffffff';
    g.fillRect(24, 30, w - 48, 170);
    g.fillStyle = primary;
    g.fillRect(32, 38, w - 64, 114);

    g.fillStyle = '#ffffff';
    g.font = 'bold 34px "Hiragino Kaku Gothic ProN", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(variant === 'lawson' ? 'STATION' : 'FRESH', w / 2, 76);
    g.font = 'bold 30px "Hiragino Kaku Gothic ProN", sans-serif';
    g.fillText('MART', w / 2, 118);

    g.fillStyle = primary;
    g.font = 'bold 28px "Hiragino Kaku Gothic ProN", sans-serif';
    g.fillText('24H 営業', w / 2, 178);

    g.fillStyle = secondary;
    g.fillRect(14, 224, w - 28, 22);
    g.fillStyle = '#ffffff';
    g.font = 'bold 24px "Hiragino Kaku Gothic ProN", sans-serif';
    g.fillText('酒・たばこ・ATM', w / 2, 276);
  };

  return {
    map: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, false), { repeat: false }),
    emissiveMap: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, true), { repeat: false }),
  };
}

// ------------------------------------------------------------------ 5. UTILITY POLE PLAQUES, STREET FLAGS, SLEEVE SIGNS & ARCH BANNER

/**
 * Fix #1: Non-emissive enameled metal Japanese chome/address plaque wrapped around concrete utility poles.
 */
export function createPolePlaqueTexture({ ward = 'すずらん一丁目', num = '12', sub = '本町地区' } = {}) {
  return makeCanvasTexture(128, 512, (g, w, h) => {
    // Enameled Prussian blue sheet metal (ホーロー街区表示板)
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#133459');
    grad.addColorStop(0.45, '#1d4c80');
    grad.addColorStop(1, '#112e4f');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    // Thin white enamel inset border
    g.strokeStyle = '#e8eef5';
    g.lineWidth = 3;
    g.strokeRect(8, 10, w - 16, h - 20);

    // Top small ward header
    g.fillStyle = '#f2f6fa';
    g.font = 'bold 18px "Hiragino Kaku Gothic ProN", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(sub, w / 2, 34);

    g.fillRect(16, 52, w - 32, 2);

    // Vertical street/chome kanji
    g.font = 'bold 36px "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
    const chars = [...ward];
    const step = Math.min(44, 290 / Math.max(chars.length, 1));
    chars.forEach((ch, i) => {
      g.fillText(ch, w / 2, 86 + i * step);
    });

    // Bottom block number box
    g.fillStyle = '#f2f6fa';
    g.fillRect(16, h - 108, w - 32, 82);
    g.fillStyle = '#153a63';
    g.font = 'bold 44px "Hiragino Kaku Gothic ProN", sans-serif';
    g.fillText(num, w / 2, h - 66);

    // Subtle weathering / pole strap shadow at top & bottom
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(0, 0, w, 7);
    g.fillRect(0, h - 7, w, 7);
  }, { repeat: false });
}

/**
 * Non-emissive yellow/black reflective safety band + pole ID tag on lower utility poles.
 */
export function createPoleReflectorTexture() {
  return makeCanvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#d4a01c';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1e2022';
    for (let i = -h; i < w + h; i += 36) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 18, 0);
      g.lineTo(i - h * 0.55 + 18, h);
      g.lineTo(i - h * 0.55, h);
      g.closePath();
      g.fill();
    }
    // Aluminum utility pole ID plate at top
    g.fillStyle = '#cfd4d9';
    g.fillRect(42, 18, w - 84, 52);
    g.strokeStyle = '#33383d';
    g.lineWidth = 2;
    g.strokeRect(46, 22, w - 92, 44);
    g.fillStyle = '#1f2328';
    g.font = 'bold 20px "Hiragino Kaku Gothic ProN", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('幹 24-東108', w / 2, 44);
  }, { repeat: false });
}

/**
 * Fix #2: Non-emissive woven Shotengai streetlamp flags (商店街フラッグ) with lily-of-the-valley motif.
 */
export function createStreetFlagTexture({ bg, accent, fg, title, subtitle }) {
  return makeCanvasTexture(256, 576, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);

    // Subtle woven canvas fabric grain
    g.fillStyle = 'rgba(255,255,255,0.04)';
    for (let x = 0; x < w; x += 6) g.fillRect(x, 0, 2, h);
    for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 2);

    // Decorative top & bottom color bands
    g.fillStyle = accent;
    g.fillRect(0, 0, w, 78);
    g.fillRect(0, h - 86, w, 86);

    // Side border lines
    g.strokeStyle = accent;
    g.lineWidth = 6;
    g.strokeRect(14, 14, w - 28, h - 28);

    // Lily-of-the-valley (すずらん) bell emblem in top header
    g.fillStyle = '#fffdf7';
    for (const dx of [-32, 0, 32]) {
      g.beginPath();
      g.arc(w / 2 + dx, 40 + Math.abs(dx) * 0.15, 11, Math.PI, 0);
      g.lineTo(w / 2 + dx + 13, 50 + Math.abs(dx) * 0.15);
      g.lineTo(w / 2 + dx - 13, 50 + Math.abs(dx) * 0.15);
      g.closePath();
      g.fill();
    }

    // Vertical Shotengai association text
    g.fillStyle = fg;
    g.font = 'bold 52px "Hiragino Mincho ProN", "Hiragino Kaku Gothic ProN", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const chars = [...title];
    const availH = h - 216;
    const step = Math.min(64, availH / Math.max(chars.length, 1));
    const startY = h / 2 - ((chars.length - 1) * step) / 2 - 4;
    chars.forEach((ch, idx) => {
      g.fillText(ch, w / 2, startY + idx * step);
    });

    // Bottom Roman / association subtitle
    g.fillStyle = '#fffaf0';
    g.font = 'bold 22px "Hiragino Kaku Gothic ProN", sans-serif';
    g.fillText(subtitle, w / 2, h - 42);
  }, { repeat: false });
}

/**
 * Projecting shop sleeve sign (袖看板) texture + masked emissiveMap with realistic internal tube falloff.
 */
export function createSleeveSignTextureSet({ bg, fg, text, sub = '', border = '#25282c' }) {
  const W = 192;
  const H = 512;
  const draw = (g, w, h, isMask) => {
    // Metal outer frame never glows
    g.fillStyle = isMask ? '#000000' : border;
    g.fillRect(0, 0, w, h);

    if (isMask) {
      // Soft fluorescent tube center glow + edge vignette so acrylic lightbox looks physical
      const tube = g.createLinearGradient(0, 0, w, 0);
      tube.addColorStop(0, '#2b2b2b');
      tube.addColorStop(0.22, bg);
      tube.addColorStop(0.5, '#ffffff');
      tube.addColorStop(0.78, bg);
      tube.addColorStop(1, '#2b2b2b');
      g.fillStyle = bg;
      g.globalAlpha = 0.58;
      g.fillRect(14, 14, w - 28, h - 28);
      g.globalAlpha = 0.28;
      g.fillStyle = tube;
      g.fillRect(14, 14, w - 28, h - 28);
      g.globalAlpha = 1;
    } else {
      g.fillStyle = bg;
      g.fillRect(12, 12, w - 24, h - 24);
      g.strokeStyle = 'rgba(0,0,0,0.16)';
      g.lineWidth = 3;
      g.strokeRect(18, 18, w - 36, h - 36);
    }

    if (sub) {
      g.fillStyle = isMask ? fg : fg;
      g.font = 'bold 22px "Hiragino Kaku Gothic ProN", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(sub, w / 2, 46);
    }

    g.fillStyle = isMask && fg === '#ffffff' ? '#ffffff' : fg;
    const chars = [...text];
    const fontSize = chars.length >= 5 ? 52 : (chars.length === 4 ? 58 : 66);
    g.font = `bold ${fontSize}px "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const topPad = sub ? 78 : 48;
    const availH = h - topPad - 48;
    const step = Math.min(fontSize * 1.24, availH / Math.max(chars.length, 1));
    const startY = topPad + availH / 2 - ((chars.length - 1) * step) / 2;
    chars.forEach((ch, idx) => {
      g.fillText(ch, w / 2, startY + idx * step);
    });
  };

  return {
    map: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, false), { repeat: false }),
    emissiveMap: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, true), { repeat: false }),
  };
}

/**
 * Fix #3: Shotengai Entrance Arch Plaque PBR + Emissive Set (商店街アーチ看板).
 * Deep vermilion ribbed lacquer panel + non-emissive gold trim + softly glowing relief lettering & emblems.
 */
export function createArchSignTextureSet({
  bg = '#8c1d18',
  fg = '#fff8e8',
  text = 'すずらん通り',
  sub = 'SUZURAN SHOPPING STREET',
  accent = '#d4af5a',
}) {
  const W = 1024;
  const H = 224;
  const hField = new Float32Array(W * H);
  const rField = new Float32Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inTrim = x < 16 || x >= W - 16 || y < 16 || y >= H - 16;
      const rib = Math.sin((x / 12) * Math.PI * 2) * 0.14;
      const idx = y * W + x;
      hField[idx] = inTrim ? 0.95 : 0.48 + rib;
      rField[idx] = inTrim ? 0.32 : 0.46;
    }
  }
  const { normalMap, roughnessMap } = buildNormalAndRoughnessMaps(W, H, hField, rField, { strength: 1.8, repeat: false });

  const draw = (g, w, h, isMask) => {
    if (isMask) {
      g.fillStyle = '#000000';
      g.fillRect(0, 0, w, h);
      // Soft downward floodlight pools from the 5 overhead gooseneck lamps
      for (const lx of [0.16, 0.33, 0.5, 0.67, 0.84]) {
        const spot = g.createRadialGradient(w * lx, 18, 8, w * lx, 42, 145);
        spot.addColorStop(0, 'rgba(180, 62, 42, 0.42)');
        spot.addColorStop(1, 'rgba(0, 0, 0, 0)');
        g.fillStyle = spot;
        g.fillRect(18, 18, w - 36, h - 36);
      }
    } else {
      // Rich deep vermilion-crimson baked enamel with subtle vertical fluting
      const bgGrad = g.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#9e241e');
      bgGrad.addColorStop(0.55, bg);
      bgGrad.addColorStop(1, '#661310');
      g.fillStyle = bgGrad;
      g.fillRect(0, 0, w, h);

      g.fillStyle = 'rgba(0,0,0,0.10)';
      for (let x = 18; x < w - 18; x += 12) {
        g.fillRect(x, 18, 3, h - 36);
      }

      // Inner ornamental gold pinstripe & corner rosettes
      g.strokeStyle = accent;
      g.lineWidth = 4;
      g.strokeRect(20, 20, w - 40, h - 40);
      g.strokeStyle = 'rgba(255, 246, 220, 0.42)';
      g.lineWidth = 1.5;
      g.strokeRect(27, 27, w - 54, h - 54);
    }

    // Flanking lily-of-the-valley bell crests on left & right
    const drawBellCrest = (cx, cy) => {
      g.strokeStyle = isMask ? '#ffefc8' : accent;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, cy, 42, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = isMask ? '#fff8e6' : fg;
      for (const [dx, dy] of [[-14, -8], [4, -16], [16, 4]]) {
        g.beginPath();
        g.arc(cx + dx, cy + dy, 9, Math.PI, 0);
        g.lineTo(cx + dx + 11, cy + dy + 10);
        g.lineTo(cx + dx - 11, cy + dy + 10);
        g.closePath();
        g.fill();
      }
    };
    drawBellCrest(92, h / 2);
    drawBellCrest(w - 92, h / 2);

    // Main kanji/kana title with subtle drop shadow (in diffuse) & clean backlit channel-letter glow (in mask)
    const chars = [...text];
    const availW = w - 340;
    const fontSize = Math.min(96, Math.floor(availW / Math.max(chars.length * 1.05, 1)));
    const step = Math.min(fontSize * 1.28, availW / Math.max(chars.length, 1));
    const startX = w / 2 - ((chars.length - 1) * step) / 2;

    if (!isMask) {
      g.fillStyle = 'rgba(25, 4, 2, 0.55)';
      g.font = `bold ${fontSize}px "Hiragino Maru Gothic ProN", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      chars.forEach((ch, idx) => {
        g.fillText(ch, startX + idx * step + 3, h * 0.46 + 4);
      });
    }

    g.fillStyle = isMask ? '#fff7e2' : fg;
    g.font = `bold ${fontSize}px "Hiragino Maru Gothic ProN", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    chars.forEach((ch, idx) => {
      g.fillText(ch, startX + idx * step, h * 0.45);
    });

    g.fillStyle = isMask ? '#e8cfa0' : accent;
    g.font = 'bold 20px "Hiragino Kaku Gothic ProN", sans-serif';
    g.fillText(sub, w / 2, h * 0.82);
  };

  return {
    map: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, false), { repeat: false }),
    emissiveMap: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, true), { repeat: false }),
    normalMap,
    roughnessMap,
  };
}

/**
 * Single Noren panel (暖簾 1巾) texture so 4 individual panels can hang at slightly varied angles.
 */
export function createNorenPanelTexture({ bg, fg, kanji, isFirst = false }) {
  return makeCanvasTexture(160, 224, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    // Linen weave texture
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let x = 0; x < w; x += 6) g.fillRect(x, 0, 2, h);
    for (let y = 0; y < h; y += 8) g.fillRect(0, y, w, 2);

    // Top rod sleeve shadow
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(0, 0, w, 14);

    if (isFirst) {
      g.strokeStyle = fg;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(w / 2, h * 0.52, 52, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = fg;
    g.font = 'bold 68px "Hiragino Mincho ProN", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(kanji, w / 2, h * 0.53);
  }, { repeat: false });
}

/**
 * AC Outdoor Unit (エアコン室外機) front panel texture with dark circular fan grille & side louvers.
 */
export function createAcUnitTexture() {
  return makeCanvasTexture(256, 192, (g, w, h) => {
    // Ivory sheet-metal body (solid border at [0,0] so signBox edges stay clean ivory!)
    g.fillStyle = '#dad6cc';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#b5b0a4';
    g.lineWidth = 4;
    g.strokeRect(6, 6, w - 12, h - 12);

    // Vertical seam separating compressor bay on right
    g.fillStyle = '#a8a398';
    g.fillRect(172, 8, 3, h - 16);

    // Dark recessed circular fan cavity on left
    const cx = 92;
    const cy = h / 2 + 4;
    const r = 64;
    const fanGrad = g.createRadialGradient(cx, cy, 8, cx, cy, r);
    fanGrad.addColorStop(0, '#181a1d');
    fanGrad.addColorStop(0.75, '#262a2e');
    fanGrad.addColorStop(1, '#484c52');
    g.fillStyle = fanGrad;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();

    // Protective wire/plastic horizontal louver grille across fan
    g.strokeStyle = '#c8c4ba';
    g.lineWidth = 2.5;
    for (let y = cy - r + 8; y <= cy + r - 8; y += 9) {
      const halfSpan = Math.sqrt(Math.max(0, r * r - (y - cy) * (y - cy)));
      g.beginPath();
      g.moveTo(cx - halfSpan, y);
      g.lineTo(cx + halfSpan, y);
      g.stroke();
    }
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();

    // Small manufacturer badge on right panel
    g.fillStyle = '#555b62';
    g.fillRect(194, 28, 40, 12);
  }, { repeat: false });
}

/**
 * Cast-iron storm drain grate (側溝グレーチング) texture for roadside curb gutters.
 */
export function createDrainGrateTexture() {
  return makeCanvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#5c5f63';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#181a1d';
    for (let y = 10; y < h - 8; y += 16) {
      g.fillRect(10, y, w - 20, 9);
    }
    g.fillStyle = '#6c7075';
    g.fillRect(w / 2 - 4, 0, 8, h);
  }, { repeat: true });
}
