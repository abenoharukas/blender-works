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

// ------------------------------------------------------------------ 6. BOTANICAL BARK, HEDGES & ALPHA-CUTOUT FOLIAGE CLUSTERS

/**
 * Fissured Japanese Zelkova / Maple tree bark (樹皮) 256x256 PBR set.
 */
export function createBarkPBR() {
  const S = 256;
  const hField = new Float32Array(S * S);
  const rField = new Float32Array(S * S);
  const canvas = makeCanvas(S, S);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const data = img.data;

  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const warp = (hash2(x >> 2, y >> 3, 301) - 0.5) * 1.4;
      const furrow = Math.sin(u * Math.PI * 18 + warp + Math.sin(v * Math.PI * 4) * 0.7);
      const grain = (hash2(x, y >> 1, 307) - 0.5) * 0.24 + (hash2(x >> 1, y >> 2, 311) - 0.5) * 0.22;
      const ridge = Math.max(0, Math.min(1, 0.54 + furrow * 0.30 + grain));
      const lenticel = hash2(x >> 2, y >> 1, 313) > 0.965 ? 0.14 : 0;
      const moss = Math.max(0, (hash2(x >> 3, y >> 3, 317) - 0.62) * 1.4);

      const idx = y * S + x;
      hField[idx] = Math.max(0, Math.min(1, ridge - lenticel * 0.4));
      rField[idx] = Math.max(0.76, Math.min(0.98, 0.94 - ridge * 0.10));

      const baseR = 52 + ridge * 42 + lenticel * 34 - moss * 14;
      const baseG = 40 + ridge * 34 + lenticel * 28 + moss * 16;
      const baseB = 31 + ridge * 25 + lenticel * 20 - moss * 8;
      const p4 = idx * 4;
      data[p4] = Math.max(0, Math.min(255, Math.round(baseR)));
      data[p4 + 1] = Math.max(0, Math.min(255, Math.round(baseG)));
      data[p4 + 2] = Math.max(0, Math.min(255, Math.round(baseB)));
      data[p4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = finalizeTexture(canvas, { repeat: true, srgb: true });
  const { normalMap, roughnessMap } = buildNormalAndRoughnessMaps(S, S, hField, rField, { strength: 2.8, repeat: true });
  return { map, normalMap, roughnessMap };
}

/**
 * Dense clipped Japanese boxwood / camellia hedge (生垣: イヌツゲ・サザンカ) 512x512 seamless PBR set.
 */
export function createHedgePBR() {
  const S = 512;
  const hField = new Float32Array(S * S);
  const rField = new Float32Array(S * S);
  const canvas = makeCanvas(S, S);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const data = img.data;

  // Deep shaded interior foliage bed
  for (let i = 0; i < S * S; i++) {
    const n = (hash2(i & 511, i >> 9, 401) - 0.5) * 10;
    const p4 = i * 4;
    data[p4] = Math.max(8, Math.round(22 + n));
    data[p4 + 1] = Math.max(14, Math.round(38 + n * 1.2));
    data[p4 + 2] = Math.max(8, Math.round(20 + n * 0.8));
    data[p4 + 3] = 255;
    hField[i] = 0.06;
    rField[i] = 0.95;
  }

  // Stamp ~960 overlapping small waxy elliptic leaves seamlessly wrapping mod S
  const totalLeaves = 960;
  for (let k = 0; k < totalLeaves; k++) {
    const depthLayer = k / totalLeaves; // 0 = deep shaded, 1 = sunlit outer shoots
    const cx = hash2(k, 1, 419) * S;
    const cy = hash2(k, 2, 421) * S;
    const ang = (hash2(k, 3, 431) - 0.5) * Math.PI * 1.85;
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);
    const rx = 5.5 + hash2(k, 4, 433) * 4.5;
    const ry = 11.0 + hash2(k, 5, 439) * 8.0;
    const bound = Math.ceil(Math.max(rx, ry)) + 2;

    const freshShoot = depthLayer > 0.78 && hash2(k, 6, 443) > 0.45;
    const tone = 0.38 + depthLayer * 0.62 + (hash2(k, 7, 449) - 0.5) * 0.14;
    const lr = (freshShoot ? 96 : 64) * tone;
    const lg = (freshShoot ? 138 : 102) * tone;
    const lb = (freshShoot ? 54 : 46) * tone;

    for (let dy = -bound; dy <= bound; dy++) {
      for (let dx = -bound; dx <= bound; dx++) {
        const lx = (dx * cosA + dy * sinA) / rx;
        const ly = (-dx * sinA + dy * cosA) / ry; // -1..+1
        if (Math.abs(ly) > 1.0) continue;
        // Pointed elliptic boxwood leaf envelope
        const env = Math.cos(ly * Math.PI * 0.5) * (1.0 - 0.15 * ly);
        if (Math.abs(lx) > env) continue;

        const wx = (((Math.round(cx + dx) % S) + S) % S);
        const wy = (((Math.round(cy + dy) % S) + S) % S);
        const idx = wy * S + wx;

        const normX = lx / Math.max(env, 1e-4);
        const dome = Math.sqrt(Math.max(0, 1.0 - normX * normX * 0.75)) * (1.0 - Math.abs(ly) * 0.25);
        const midrib = Math.exp(-normX * normX * 42.0) * 0.12;
        const hVal = 0.14 + depthLayer * 0.68 + dome * 0.18 - midrib;

        const shade = 0.80 + dome * 0.24 + midrib * 0.35;
        const p4 = idx * 4;
        data[p4] = Math.max(0, Math.min(255, Math.round(lr * shade)));
        data[p4 + 1] = Math.max(0, Math.min(255, Math.round(lg * shade)));
        data[p4 + 2] = Math.max(0, Math.min(255, Math.round(lb * shade)));
        hField[idx] = Math.max(0, Math.min(1, hVal));
        rField[idx] = Math.max(0.38, Math.min(0.88, 0.68 - depthLayer * 0.20 - dome * 0.08));
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  const map = finalizeTexture(canvas, { repeat: true, srgb: true });
  const { normalMap, roughnessMap } = buildNormalAndRoughnessMaps(S, S, hField, rField, { strength: 3.1, repeat: true });
  return { map, normalMap, roughnessMap };
}

/**
 * Botanical RGBA alpha-cutout branchlet texture + leaf-vein normalMap (512x512, repeat: false).
 * Bleeds leaf RGB into alpha=0 background pixels so mipmaps NEVER produce dark/white fringes!
 * Variants: 'zelkova' (fresh green ケヤキ), 'maple' (autumn イロハモミジ), 'pine' (黒松 needle pads), 'shrub' (鉢植え低木)
 */
export function createFoliageClusterTextureSet(variant = 'zelkova') {
  const S = 512;
  const hField = new Float32Array(S * S);
  const canvas = makeCanvas(S, S);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const data = img.data;

  const bleedRGB = {
    zelkova: [74, 112, 50],
    maple: [176, 68, 36],
    pine: [44, 78, 46],
    shrub: [62, 102, 48],
  }[variant] ?? [74, 112, 50];

  for (let i = 0; i < S * S; i++) {
    const p4 = i * 4;
    data[p4] = bleedRGB[0];
    data[p4 + 1] = bleedRGB[1];
    data[p4 + 2] = bleedRGB[2];
    data[p4 + 3] = 0;
    hField[i] = 0.5;
  }

  const writePixel = (px, py, r, g, b, a, h) => {
    if (px < 2 || px >= S - 2 || py < 2 || py >= S - 2) return;
    const idx = py * S + px;
    const p4 = idx * 4;
    const curA = data[p4 + 3];
    if (a >= 250 || curA === 0) {
      data[p4] = Math.max(0, Math.min(255, Math.round(r)));
      data[p4 + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[p4 + 2] = Math.max(0, Math.min(255, Math.round(b)));
      data[p4 + 3] = Math.max(curA, Math.min(255, Math.round(a)));
      hField[idx] = h;
    } else if (a > 0) {
      const w = a / 255;
      data[p4] = Math.round(data[p4] * (1 - w) + r * w);
      data[p4 + 1] = Math.round(data[p4 + 1] * (1 - w) + g * w);
      data[p4 + 2] = Math.round(data[p4 + 2] * (1 - w) + b * w);
      data[p4 + 3] = Math.min(255, Math.max(curA, Math.round(curA + a * 0.85)));
      hField[idx] = hField[idx] * (1 - w) + h * w;
    }
  };

  // Helper: draw tapered woody twig segment from (x0,y0) to (x1,y1)
  const drawTwig = (x0, y0, x1, y1, r0, r1, curve = 0) => {
    const steps = Math.max(12, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    const nx = -(y1 - y0) / Math.max(1, Math.hypot(x1 - x0, y1 - y0));
    const ny = (x1 - x0) / Math.max(1, Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const bend = Math.sin(t * Math.PI) * curve;
      const cx = x0 + (x1 - x0) * t + nx * bend;
      const cy = y0 + (y1 - y0) * t + ny * bend;
      const rad = r0 + (r1 - r0) * t;
      const ir = Math.ceil(rad) + 1;
      for (let dy = -ir; dy <= ir; dy++) {
        for (let dx = -ir; dx <= ir; dx++) {
          const d = Math.hypot(dx, dy);
          if (d <= rad + 0.65) {
            const cov = d <= rad - 0.35 ? 255 : Math.max(0, (rad + 0.65 - d) * 255);
            const cyl = Math.sqrt(Math.max(0, 1 - Math.min(1, d / Math.max(rad, 0.5)) ** 2));
            writePixel(
              Math.round(cx + dx),
              Math.round(cy + dy),
              68 + cyl * 26,
              50 + cyl * 20,
              36 + cyl * 14,
              cov,
              0.42 + cyl * 0.22,
            );
          }
        }
      }
    }
  };

  // Helper: stamp serrated ovate leaf (Zelkova / Shrub) sprouting from (bx, by) along angle `ang`
  const drawOvateLeaf = (bx, by, ang, len, wid, rBase, gBase, bBase, serrate = 0.055, layerH = 0.6) => {
    const dirX = Math.cos(ang);
    const dirY = Math.sin(ang);
    const perpX = -dirY;
    const perpY = dirX;
    const minX = Math.floor(Math.min(bx, bx + dirX * len) - wid - 3);
    const maxX = Math.ceil(Math.max(bx, bx + dirX * len) + wid + 3);
    const minY = Math.floor(Math.min(by, by + dirY * len) - wid - 3);
    const maxY = Math.ceil(Math.max(by, by + dirY * len) + wid + 3);

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const rx = px - bx;
        const ry = py - by;
        const v = (rx * dirX + ry * dirY) / len;
        if (v < -0.02 || v > 1.02) continue;
        if (v < 0.05) {
          // Short petiole stem
          const uPet = Math.abs(rx * perpX + ry * perpY);
          if (uPet <= 1.35) writePixel(px, py, rBase * 0.75, gBase * 0.82, bBase * 0.65, 255, layerH);
          continue;
        }
        const lv = (v - 0.04) / 0.96;
        if (lv < 0 || lv > 1) continue;
        const baseEnv = Math.sin(Math.PI * Math.pow(lv, 0.74)) * (1.0 - 0.16 * lv);
        const teeth = serrate * Math.sin(lv * Math.PI * 16.0) * Math.sin(Math.PI * lv);
        const halfW = Math.max(0.5, wid * (baseEnv + teeth));
        const uAbs = Math.abs(rx * perpX + ry * perpY);
        if (uAbs > halfW + 0.8) continue;

        const alpha = uAbs <= halfW - 0.35 ? 255 : Math.max(0, (halfW + 0.8 - uAbs) / 1.15 * 255);
        const uNorm = uAbs / Math.max(halfW, 1.0);
        // Midrib & angled herring-bone lateral veins
        const midrib = Math.exp(-uAbs * uAbs * 0.35);
        const latVein = Math.pow(Math.max(0, Math.cos((lv * 9.0 - uNorm * 2.1) * Math.PI * 2)), 10) * (1.0 - uNorm * 0.4);
        const dome = Math.cos(uNorm * Math.PI * 0.46) * (1.0 - lv * 0.14);
        const shade = 0.82 + dome * 0.22 + lv * 0.12 + midrib * 0.10 + latVein * 0.07;

        writePixel(
          px, py,
          rBase * shade + midrib * 12,
          gBase * shade + midrib * 16,
          bBase * shade + midrib * 6,
          alpha,
          Math.max(0.1, Math.min(0.98, layerH + dome * 0.22 - midrib * 0.08 + latVein * 0.04)),
        );
      }
    }
  };

  // Helper: stamp 5-lobed Japanese Momiji maple leaf centered at (cx, cy)
  const drawMapleLeaf = (cx, cy, ang, radius, rBase, gBase, bBase, layerH = 0.65) => {
    const bound = Math.ceil(radius * 1.12) + 2;
    for (let dy = -bound; dy <= bound; dy++) {
      for (let dx = -bound; dx <= bound; dx++) {
        const dist = Math.hypot(dx, dy);
        if (dist > radius * 1.1) continue;
        let th = Math.atan2(dy, dx) - ang;
        while (th > Math.PI) th -= Math.PI * 2;
        while (th < -Math.PI) th += Math.PI * 2;
        const absTh = Math.abs(th);
        // Basal sinus cutout beyond ±138 deg
        if (absTh > 2.42) continue;

        // 5 pointed palmate lobes at 0, ±52 deg (0.91 rad), ±104 deg (1.82 rad)
        let lobeSum = 0;
        const lobeAngles = [0, 0.90, -0.90, 1.78, -1.78];
        const lobeScales = [1.0, 0.88, 0.88, 0.62, 0.62];
        for (let li = 0; li < 5; li++) {
          const dAng = Math.abs(th - lobeAngles[li]);
          if (dAng < 0.68) {
            const lProfile = Math.pow(Math.cos((dAng / 0.68) * Math.PI * 0.5), 1.55) * lobeScales[li];
            if (lProfile > lobeSum) lobeSum = lProfile;
          }
        }
        const webBase = 0.28 * (1.0 - (absTh / 2.45) * 0.45);
        const serration = 0.035 * Math.sin(absTh * 28.0);
        const maxR = radius * Math.max(webBase, lobeSum + serration);
        if (dist > maxR + 0.8) continue;

        const alpha = dist <= maxR - 0.35 ? 255 : Math.max(0, (maxR + 0.8 - dist) / 1.15 * 255);
        const rNorm = dist / Math.max(maxR, 1.0);
        const shade = 0.80 + (1.0 - rNorm * 0.25) * 0.24 + rNorm * 0.12;
        // Subtle golden-olive transition near leaf heart
        const heartMix = Math.max(0, 1.0 - rNorm * 2.2) * 0.28;
        writePixel(
          Math.round(cx + dx),
          Math.round(cy + dy),
          rBase * shade * (1 - heartMix) + 165 * heartMix,
          gBase * shade * (1 - heartMix) + 142 * heartMix,
          bBase * shade * (1 - heartMix) + 48 * heartMix,
          alpha,
          Math.max(0.15, Math.min(0.98, layerH + (1.0 - rNorm) * 0.18)),
        );
      }
    }
  };

  // Helper: stamp radiating Japanese Black Pine needle fan (黒松の葉束)
  const drawPineFan = (cx, cy, baseAng, needleLen, spread, count, layerH = 0.6) => {
    for (let ni = 0; ni < count; ni++) {
      const t = count === 1 ? 0.5 : ni / (count - 1);
      const nAng = baseAng + (t - 0.5) * spread + (hash2(ni, Math.round(cx), 509) - 0.5) * 0.08;
      const len = needleLen * (0.82 + 0.32 * Math.sin(t * Math.PI)) * (0.9 + hash2(ni, 7, 521) * 0.2);
      const dx = Math.cos(nAng);
      const dy = Math.sin(nAng);
      const tone = 0.82 + hash2(ni, 3, 523) * 0.36;
      const steps = Math.ceil(len * 1.2);
      for (let s = 0; s <= steps; s++) {
        const f = s / steps;
        const px = cx + dx * len * f;
        const py = cy + dy * len * f;
        const halfW = 1.65 * (1.0 - f * 0.55);
        for (let oy = -2; oy <= 2; oy++) {
          for (let ox = -2; ox <= 2; ox++) {
            const d = Math.hypot(px + ox - Math.round(px + ox), py + oy - Math.round(py + oy));
            const perp = Math.abs((ox) * (-dy) + (oy) * dx);
            if (perp <= halfW + 0.45 && d < 1.2) {
              const a = perp <= halfW - 0.2 ? 255 : Math.max(0, (halfW + 0.45 - perp) / 0.65 * 255);
              const tipBright = 0.85 + f * 0.32;
              writePixel(
                Math.round(px + ox),
                Math.round(py + oy),
                40 * tone * tipBright,
                76 * tone * tipBright,
                42 * tone * tipBright,
                a,
                layerH + (1.0 - perp / 2.2) * 0.18,
              );
            }
          }
        }
      }
    }
    // Warm brown pine fascicle sheath & candle bud (みどり芽) at fan base
    drawTwig(cx, cy + 4, cx + Math.cos(baseAng) * 14, cy + Math.sin(baseAng) * 14, 3.2, 1.8, 0);
  };

  if (variant === 'zelkova') {
    // Central woody branch rising from bottom center (256, 488) toward crown tip (256, 54)
    drawTwig(256, 492, 256, 68, 6.2, 2.0, -14);
    const branches = [
      [256, 420, 102, 310, 4.0, 1.5, -10],
      [256, 405, 412, 298, 4.0, 1.5, 10],
      [252, 326, 76, 198, 3.6, 1.4, -12],
      [254, 312, 434, 186, 3.6, 1.4, 12],
      [250, 224, 118, 104, 3.0, 1.2, -8],
      [254, 214, 396, 96, 3.0, 1.2, 8],
    ];
    for (const b of branches) drawTwig(...b);

    // Layer shaded inner leaves first, then sunlit outer leaves for rich botanical depth
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < branches.length; i++) {
        const [x0, y0, x1, y1] = branches[i];
        const bAng = Math.atan2(y1 - y0, x1 - x0);
        const bLen = Math.hypot(x1 - x0, y1 - y0);
        const leafCount = 5;
        for (let k = 0; k < leafCount; k++) {
          const t = 0.20 + (k / (leafCount - 1)) * 0.78;
          const bx = x0 + (x1 - x0) * t;
          const by = y0 + (y1 - y0) * t;
          const side = ((k + pass) % 2 === 0) ? 1 : -1;
          const lAng = bAng + side * (0.58 + hash2(i * 11 + k, pass, 601) * 0.35);
          const lLen = (68 + hash2(k, i, 607) * 26) * (1.05 - t * 0.22);
          const lWid = lLen * 0.36;
          const sun = pass === 0 ? 0.72 : (0.94 + t * 0.24);
          drawOvateLeaf(bx, by, lAng, lLen, lWid, 78 * sun, 120 * sun, 50 * sun, 0.055, pass === 0 ? 0.42 : 0.72);
        }
        // Terminal leaf at tip of each lateral twig
        if (pass === 1) {
          drawOvateLeaf(x1 - Math.cos(bAng) * 8, y1 - Math.sin(bAng) * 8, bAng, 72, 26, 104, 148, 62, 0.055, 0.82);
        }
      }
    }
    // Crown apex fan of fresh sunlit leaves
    for (const aOff of [-0.65, -0.22, 0.22, 0.65]) {
      drawOvateLeaf(256, 86, -Math.PI * 0.5 + aOff, 78, 28, 108, 152, 64, 0.055, 0.85);
    }
  } else if (variant === 'maple') {
    drawTwig(256, 492, 256, 78, 5.4, 1.8, 12);
    const branches = [
      [256, 416, 106, 308, 3.6, 1.3, 10],
      [256, 398, 408, 292, 3.6, 1.3, -10],
      [258, 314, 88, 188, 3.2, 1.2, 10],
      [258, 298, 424, 178, 3.2, 1.2, -10],
      [256, 206, 136, 98, 2.8, 1.1, 8],
      [256, 198, 382, 92, 2.8, 1.1, -8],
    ];
    for (const b of branches) drawTwig(...b);

    const palette = [
      [188, 48, 30],  // Deep Momiji crimson
      [216, 82, 36],  // Persimmon vermilion
      [226, 134, 42], // Autumn amber-gold
      [166, 38, 28],  // Shaded wine red
    ];
    for (let i = 0; i < 34; i++) {
      const layer = i / 34;
      const ringR = 38 + Math.sqrt(hash2(i, 1, 701)) * 172;
      const th = -Math.PI * 0.5 + (hash2(i, 2, 709) - 0.5) * Math.PI * 1.55;
      const cx = 256 + Math.sin(th + Math.PI * 0.5) * ringR * 1.04;
      const cy = 268 - Math.cos(th + Math.PI * 0.5) * ringR * 0.96;
      const col = palette[Math.floor(hash2(i, 3, 719) * palette.length)];
      const sun = 0.80 + layer * 0.34;
      const rad = 42 + hash2(i, 4, 727) * 22;
      const leafAng = Math.atan2(cy - 310, cx - 256) + (hash2(i, 5, 733) - 0.5) * 0.6;
      drawMapleLeaf(cx, cy, leafAng, rad, col[0] * sun, col[1] * sun, col[2] * sun, 0.35 + layer * 0.52);
    }
  } else if (variant === 'pine') {
    // Gnarled Japanese Black Pine branch (黒松の枝ぶり) + dense needle fascicle fans
    drawTwig(256, 486, 248, 148, 8.0, 3.6, -22);
    drawTwig(252, 376, 118, 268, 5.5, 2.8, -14);
    drawTwig(252, 356, 396, 256, 5.5, 2.8, 14);
    drawTwig(248, 252, 138, 154, 4.5, 2.4, -10);
    drawTwig(248, 242, 374, 148, 4.5, 2.4, 10);

    const hubs = [
      [118, 268, -2.25], [168, 312, -2.0], [396, 256, -0.88], [344, 304, -1.1],
      [138, 154, -2.05], [202, 198, -1.75], [374, 148, -1.08], [312, 192, -1.35],
      [248, 138, -1.57], [210, 128, -1.85], [292, 128, -1.28],
      [182, 254, -1.65], [326, 248, -1.45], [254, 224, -1.57],
    ];
    hubs.forEach(([hx, hy, ha], idx) => {
      drawPineFan(hx, hy, ha, 82 + (idx % 3) * 10, 1.95, 22, 0.42 + (idx / hubs.length) * 0.42);
    });
  } else {
    // 'shrub': Lush evergreen Japanese Nandina / Aralia rosette for storefront ceramic pots & hedge fringes
    drawTwig(256, 496, 256, 136, 4.6, 1.6, 6);
    drawTwig(256, 446, 126, 224, 3.6, 1.3, -12);
    drawTwig(256, 446, 386, 224, 3.6, 1.3, 12);
    for (let i = 0; i < 38; i++) {
      const layer = i / 38;
      const spreadA = -Math.PI * 0.5 + (hash2(i, 1, 809) - 0.5) * 2.35;
      const rDist = 28 + hash2(i, 2, 811) * 165;
      const bx = 256 + Math.cos(spreadA) * rDist * 0.85;
      const by = 432 + Math.sin(spreadA) * rDist * 0.88;
      const lLen = 64 + hash2(i, 3, 821) * 28;
      const sun = 0.76 + layer * 0.38;
      drawOvateLeaf(bx, by, spreadA, lLen, lLen * 0.30, 62 * sun, 108 * sun, 46 * sun, 0.03, 0.35 + layer * 0.52);
    }
    // Small festive red Nandina winter berry clusters (南天の赤い実)
    for (const [cx, cy] of [[256, 118], [154, 198], [362, 192]]) {
      for (let b = 0; b < 9; b++) {
        const ox = cx + (hash2(b, cx, 827) - 0.5) * 26;
        const oy = cy + (hash2(b, cy, 829) - 0.5) * 26;
        for (let dy = -5; dy <= 5; dy++) {
          for (let dx = -5; dx <= 5; dx++) {
            const d = Math.hypot(dx, dy);
            if (d <= 4.6) {
              const spec = Math.max(0, 1 - Math.hypot(dx + 1.5, dy + 1.5) / 3.5);
              writePixel(Math.round(ox + dx), Math.round(oy + dy), 205 + spec * 45, 38 + spec * 35, 30 + spec * 25, 255, 0.92);
            }
          }
        }
      }
    }
  }

  // 4-pass RGB color-bleeding into transparent (alpha === 0) border pixels so bilinear mipmaps have ZERO dark fringes!
  const tmpRGB = new Uint8ClampedArray(S * S * 3);
  const hasColor = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) {
    if (data[i * 4 + 3] >= 64) {
      hasColor[i] = 1;
      tmpRGB[i * 3] = data[i * 4];
      tmpRGB[i * 3 + 1] = data[i * 4 + 1];
      tmpRGB[i * 3 + 2] = data[i * 4 + 2];
    }
  }
  for (let pass = 0; pass < 5; pass++) {
    const nextHas = new Uint8Array(hasColor);
    for (let y = 1; y < S - 1; y++) {
      for (let x = 1; x < S - 1; x++) {
        const idx = y * S + x;
        if (hasColor[idx]) continue;
        let sr = 0, sg = 0, sb = 0, cnt = 0;
        for (const nIdx of [idx - 1, idx + 1, idx - S, idx + S]) {
          if (hasColor[nIdx]) {
            sr += tmpRGB[nIdx * 3];
            sg += tmpRGB[nIdx * 3 + 1];
            sb += tmpRGB[nIdx * 3 + 2];
            cnt++;
          }
        }
        if (cnt > 0) {
          tmpRGB[idx * 3] = Math.round(sr / cnt);
          tmpRGB[idx * 3 + 1] = Math.round(sg / cnt);
          tmpRGB[idx * 3 + 2] = Math.round(sb / cnt);
          data[idx * 4] = tmpRGB[idx * 3];
          data[idx * 4 + 1] = tmpRGB[idx * 3 + 1];
          data[idx * 4 + 2] = tmpRGB[idx * 3 + 2];
          nextHas[idx] = 1;
        }
      }
    }
    hasColor.set(nextHas);
  }

  ctx.putImageData(img, 0, 0);
  const map = finalizeTexture(canvas, { repeat: false, srgb: true });
  const { normalMap } = buildNormalAndRoughnessMaps(S, S, hField, null, { strength: 2.1, repeat: false });
  return { map, normalMap };
}

// ------------------------------------------------------------------ 7. DUAL-LAYER CORRUGATED WASHI CHOCHIN (提灯)

/**
 * Traditional Japanese Washi Paper Lantern (和紙提灯) PBR + Vertically-Attenuated Emissive Set:
 * - 14 horizontal bamboo hoop pleats (竹骨・ひご) in diffuse, normalMap, and emissiveMap
 * - Bold sumi-ink vertical calligraphy on front (u=0.50) & sidewalk sides (u=0.23, u=0.77) + 三つ巴 crest on back
 * - Low-luminance outer Washi cavity glow (strictly #000000 on ink & collars) paired with a 3D central filament bulb!
 */
export function createChochinTextureSet({
  style = 'red', // 'red' (赤提灯) | 'warm' (白提灯)
  text = '居酒屋',
  sideText = '炭火焼',
} = {}) {
  const W = 512;
  const H = 512;
  const ribs = 14;
  const hField = new Float32Array(W * H);

  for (let y = 0; y < H; y++) {
    const v = 1.0 - y / H;
    const pleat = Math.abs(Math.sin(v * ribs * Math.PI));
    for (let x = 0; x < W; x++) {
      const fiber = (hash2(x >> 1, y, 911) - 0.5) * 0.08 + (hash2(x, y >> 2, 919) - 0.5) * 0.06;
      hField[y * W + x] = Math.max(0, Math.min(1, 0.34 + pleat * 0.54 + fiber));
    }
  }
  const { normalMap } = buildNormalAndRoughnessMaps(W, H, hField, null, { strength: 2.2, repeat: false });

  const drawVerticalBrushText = (g, str, cx, topY, botY, maxFont, fillStyle) => {
    const chars = [...str];
    const span = botY - topY;
    const fontSize = Math.min(maxFont, Math.floor(span / Math.max(chars.length * 1.04, 1)));
    const step = Math.min(fontSize * 1.08, span / Math.max(chars.length, 1));
    const startY = (topY + botY) * 0.5 - ((chars.length - 1) * step) * 0.5;
    g.fillStyle = fillStyle;
    g.font = `900 ${fontSize}px "Hiragino Mincho ProN", "YuMincho", "Hiragino Kaku Gothic ProN", serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    chars.forEach((ch, idx) => {
      g.fillText(ch, cx, startY + idx * step);
    });
  };

  const drawCrest = (g, cx, cy, r, color) => {
    g.strokeStyle = color;
    g.lineWidth = 5.5;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = color;
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3 - Math.PI * 0.5;
      g.beginPath();
      g.arc(cx + Math.cos(a) * (r * 0.44), cy + Math.sin(a) * (r * 0.44), r * 0.26, 0, Math.PI * 2);
      g.fill();
    }
  };

  const drawChochin = (g, w, h, isMask) => {
    const isRed = style === 'red';
    if (isMask) {
      g.fillStyle = '#000000';
      g.fillRect(0, 0, w, h);
      // Soft internal cavity glow (peaks gently at equator, drops to dark near top/bottom wooden rims!)
      const vGrad = g.createLinearGradient(0, 0, 0, h);
      if (isRed) {
        vGrad.addColorStop(0.00, '#000000');
        vGrad.addColorStop(0.10, '#360804');
        vGrad.addColorStop(0.32, '#9e2214');
        vGrad.addColorStop(0.50, '#cc321e');
        vGrad.addColorStop(0.68, '#9e2214');
        vGrad.addColorStop(0.90, '#360804');
        vGrad.addColorStop(1.00, '#000000');
      } else {
        vGrad.addColorStop(0.00, '#000000');
        vGrad.addColorStop(0.10, '#382510');
        vGrad.addColorStop(0.32, '#ad7839');
        vGrad.addColorStop(0.50, '#d99e52');
        vGrad.addColorStop(0.68, '#ad7839');
        vGrad.addColorStop(0.90, '#382510');
        vGrad.addColorStop(1.00, '#000000');
      }
      g.fillStyle = vGrad;
      g.fillRect(0, 14, w, h - 28);
    } else {
      // Dyed translucent Washi paper base (vermilion-orange dye passes warm incandescent bulb light!)
      const bgGrad = g.createLinearGradient(0, 0, 0, h);
      if (isRed) {
        bgGrad.addColorStop(0.00, '#781910');
        bgGrad.addColorStop(0.12, '#bd2f1e');
        bgGrad.addColorStop(0.50, '#e34c33');
        bgGrad.addColorStop(0.88, '#bd2f1e');
        bgGrad.addColorStop(1.00, '#781910');
      } else {
        bgGrad.addColorStop(0.00, '#a8906c');
        bgGrad.addColorStop(0.12, '#dec9a4');
        bgGrad.addColorStop(0.50, '#f5e6c8');
        bgGrad.addColorStop(0.88, '#dec9a4');
        bgGrad.addColorStop(1.00, '#a8906c');
      }
      g.fillStyle = bgGrad;
      g.fillRect(0, 0, w, h);

      // Subtle Washi kozo fiber flecks
      g.fillStyle = isRed ? 'rgba(255, 220, 185, 0.055)' : 'rgba(120, 92, 56, 0.05)';
      for (let fy = 16; fy < h - 16; fy += 7) {
        for (let fx = 0; fx < w; fx += 23) {
          const jx = (fx + Math.round(hash2(fx, fy, 929) * 17)) % w;
          g.fillRect(jx, fy, 11, 1.5);
        }
      }
    }

    // 14 horizontal bamboo rib hoops (竹骨)
    for (let r = 1; r < ribs; r++) {
      const ry = (r / ribs) * h;
      if (isMask) {
        g.fillStyle = 'rgba(0, 0, 0, 0.58)';
        g.fillRect(0, ry - 1.8, w, 3.6);
      } else {
        g.fillStyle = isRed ? 'rgba(48, 10, 6, 0.42)' : 'rgba(72, 50, 28, 0.36)';
        g.fillRect(0, ry - 1.5, w, 3.0);
        g.fillStyle = 'rgba(255, 240, 215, 0.10)';
        g.fillRect(0, ry + 1.5, w, 1.5);
      }
    }

    // Black lacquer neck collar shadow bands at top & bottom
    g.fillStyle = isMask ? '#000000' : '#181311';
    g.fillRect(0, 0, w, 16);
    g.fillRect(0, h - 16, w, 16);

    // Sumi-ink vertical brush calligraphy (front u=0.50 + sidewalk sides u=0.23, u=0.77 -> #000000 in mask!)
    const inkColor = isMask ? '#000000' : '#171311';
    drawVerticalBrushText(g, text, w * 0.50, 74, h - 74, 86, inkColor);
    if (sideText) {
      drawVerticalBrushText(g, sideText, w * 0.22, 104, h - 104, 62, inkColor);
      drawVerticalBrushText(g, sideText, w * 0.78, 104, h - 104, 62, inkColor);
    }

    // Traditional crest on back seam (u = 0.0 & u = 1.0) + small red seal stamp beside front calligraphy
    drawCrest(g, 0, h * 0.5, 42, inkColor);
    drawCrest(g, w, h * 0.5, 42, inkColor);
    if (!isMask) {
      g.strokeStyle = isRed ? '#fff0d8' : '#b8291e';
      g.lineWidth = 2.5;
      g.strokeRect(w * 0.50 + 42, h - 118, 22, 26);
    }
  };

  return {
    map: makeCanvasTexture(W, H, (g, w, h) => drawChochin(g, w, h, false), { repeat: false }),
    emissiveMap: makeCanvasTexture(W, H, (g, w, h, ) => drawChochin(g, w, h, true), { repeat: false }),
    normalMap,
  };
}

// ------------------------------------------------------------------ 8. OSAKA DOTONBORI FLAGSHIP PROMENADE PBR & SIGNAGE SETS

/**
 * Interlocking Herringbone Granite Block Paver (道頓堀インターロッキング石畳) 512x512 seamless PBR set.
 * Models honed charcoal-and-silver granite street pavers with crisp chamfered mortar joints.
 */
export function createPromenadePaverPBR() {
  const S = 512;
  const hField = new Float32Array(S * S);
  const rField = new Float32Array(S * S);
  const canvas = makeCanvas(S, S);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const data = img.data;

  // 45-degree rotated 2:1 granite brick herringbone lattice: period 64 px along rotated (u, v) axes
  const M = 32; // Brick width = 32 px, brick length = 64 px (2*M)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Integer unimodular lattice u = x + y, v = x - y (mod 4*M = 128 wraps seamlessly on 512x512!)
      const u = x + y;
      const v = x - y + 1024;
      const iu = Math.floor(u / M);
      const iv = Math.floor(v / M);
      const fu = u - iu * M;
      const fv = v - iv * M;

      // Standard 2:1 herringbone assignment: brick (k) spans either 2 cells in u or 2 cells in v
      const parity = ((iu + iv) & 1);
      let brickIdA, brickIdB, distEdge;
      if (parity === 0) {
        // Horizontal-in-uv brick spanning (iu, iv) + (iu + 1, iv) or (iu - 1, iv)
        const pairBase = iu - (iu & 1);
        brickIdA = pairBase * 131 + iv * 17;
        brickIdB = iv * 53 + pairBase;
        const localU = (u - pairBase * M); // 0..2M
        const dU = Math.min(localU, 2 * M - localU);
        const dV = Math.min(fv, M - fv);
        distEdge = Math.min(dU, dV);
      } else {
        // Vertical-in-uv brick spanning (iu, iv) + (iu, iv + 1) or (iu, iv - 1)
        const pairBase = iv - (iv & 1);
        brickIdA = iu * 97 + pairBase * 29;
        brickIdB = pairBase * 71 + iu;
        const localV = (v - pairBase * M); // 0..2M
        const dV = Math.min(localV, 2 * M - localV);
        const dU = Math.min(fu, M - fu);
        distEdge = Math.min(dU, dV);
      }

      const idx = y * S + x;
      const p4 = idx * 4;
      const isJoint = distEdge < 2.2;
      const chamfer = Math.min(1.0, Math.max(0.0, (distEdge - 1.4) / 3.2));
      const blockTone = (hash2(brickIdA, brickIdB, 1201) - 0.5) * 20;
      const warmTint = (hash2(brickIdB, brickIdA, 1213) - 0.5) * 6;
      const speckle = (hash2(x, y, 1223) - 0.5) * 9 + (hash2(x >> 1, y >> 1, 1229) - 0.5) * 6;

      if (isJoint) {
        data[p4] = 44;
        data[p4 + 1] = 43;
        data[p4 + 2] = 41;
        data[p4 + 3] = 255;
        hField[idx] = 0.14;
        rField[idx] = 0.94;
      } else {
        const base = 98 + blockTone + speckle;
        data[p4] = Math.max(48, Math.min(158, Math.round(base + warmTint)));
        data[p4 + 1] = Math.max(48, Math.min(156, Math.round(base + warmTint * 0.4)));
        data[p4 + 2] = Math.max(50, Math.min(160, Math.round(base - warmTint * 0.5 + 2)));
        data[p4 + 3] = 255;
        hField[idx] = 0.25 + chamfer * 0.65 + speckle * 0.006;
        rField[idx] = Math.max(0.36, Math.min(0.78, 0.54 - blockTone * 0.004 + (hash2(x >> 1, y >> 1, 1237) - 0.5) * 0.08));
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  const map = finalizeTexture(canvas, { repeat: true, srgb: true });
  const { normalMap, roughnessMap } = buildNormalAndRoughnessMaps(S, S, hField, rField, { strength: 2.5, repeat: true });
  return { map, normalMap, roughnessMap };
}

/**
 * Architectural warm LED cove wash texture behind 3D white vertical facade louvers (かに道楽スタイル).
 */
export function createCoveGlowTextureSet() {
  const W = 256;
  const H = 256;
  const draw = (g, w, h, isMask) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    if (isMask) {
      grad.addColorStop(0.00, '#fff4d4');
      grad.addColorStop(0.22, '#ffd384');
      grad.addColorStop(0.50, '#e39e46');
      grad.addColorStop(0.78, '#ffd384');
      grad.addColorStop(1.00, '#fff4d4');
    } else {
      grad.addColorStop(0.00, '#fbf3df');
      grad.addColorStop(0.25, '#eed29e');
      grad.addColorStop(0.50, '#d9b274');
      grad.addColorStop(0.75, '#eed29e');
      grad.addColorStop(1.00, '#fbf3df');
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  };
  return {
    map: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, false), { repeat: false }),
    emissiveMap: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, true), { repeat: false }),
  };
}

/**
 * Upscale Osaka Dotonbori Flagship Horizontal Fascia Signboard (768x192, clamped [0..1]):
 * Styles:
 *  - 'ivory_sumi': Warm backlit ivory panel with bold black sumi brush calligraphy & vermilion hanko seal (かに道楽 本店)
 *  - 'lacquer_gold': Deep urushi black/crimson panel with metallic gold relief calligraphy (鉄板神社 / 鮨・割烹)
 *  - 'chibo_neon': Sumi charcoal panel with emerald & vermilion neon-tube border + glowing channel kanji (千房)
 *  - 'crimson_gold': Vibrant Osaka vermilion-crimson & gold crest banner (本家 大たこ / 串かつ横綱 / 免税百貨)
 */
export function createDotonboriFasciaSet({
  style = 'ivory_sumi',
  text = 'かに道楽',
  badge = '',
  sub = 'KANI DORAKU · 活かに会席',
  seal = '道楽',
  accent = '#c9a354',
  bgHex = '#15181e',
}) {
  const W = 768;
  const H = 192;

  const draw = (g, w, h, isMask) => {
    // Strictly non-emissive outer bezel margin so box edges never bleed light
    g.fillStyle = isMask ? '#000000' : (style === 'ivory_sumi' || style === 'kabuki_theatre' ? '#3a322c' : '#1b1715');
    g.fillRect(0, 0, w, h);

    if (style === 'modern_minimal') {
      // Sleek Shinsaibashi / Midosuji luxury curtain-wall boutique or Sukiya fascia
      const isLight = bgHex.startsWith('#f') || bgHex.startsWith('#e');
      if (isMask) {
        g.fillStyle = isLight ? '#dcd6c8' : '#0a0c10';
        g.fillRect(12, 12, w - 24, h - 24);
      } else {
        g.fillStyle = bgHex;
        g.fillRect(10, 10, w - 20, h - 20);
      }
      g.strokeStyle = isMask ? accent : accent;
      g.lineWidth = 2.5;
      g.strokeRect(20, 20, w - 40, h - 40);

      g.fillStyle = isMask ? (isLight ? '#080808' : '#fffaf0') : (isLight ? '#181614' : '#f7f3ea');
      g.font = 'bold 64px "Hiragino Mincho ProN", "Hiragino Kaku Gothic ProN", serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w * 0.5, h * 0.44);

      g.fillStyle = isMask ? (isLight ? '#1a1815' : accent) : accent;
      g.font = 'bold 20px "Hiragino Kaku Gothic ProN", sans-serif';
      g.fillText(sub, w * 0.5, h * 0.80);
      return;
    }

    if (style === 'kabuki_theatre') {
      // Classical Osaka Shochikuza Neo-Renaissance theatre bronze-and-cream fascia plaque
      if (isMask) {
        const glow = g.createRadialGradient(w * 0.5, h * 0.5, 20, w * 0.5, h * 0.5, w * 0.5);
        glow.addColorStop(0, '#fff2d0');
        glow.addColorStop(1, '#78623c');
        g.fillStyle = glow;
        g.fillRect(14, 14, w - 28, h - 28);
      } else {
        g.fillStyle = '#f6efe0';
        g.fillRect(10, 10, w - 20, h - 20);
      }
      g.strokeStyle = isMask ? '#d9ab4e' : '#9c7832';
      g.lineWidth = 6;
      g.strokeRect(18, 18, w - 36, h - 36);
      g.lineWidth = 2;
      g.strokeRect(27, 27, w - 54, h - 54);

      g.fillStyle = isMask ? '#060504' : '#1c1510';
      g.font = '900 76px "Hiragino Mincho ProN", "YuMincho", serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w * 0.5, h * 0.45);

      g.fillStyle = isMask ? '#1f160e' : '#7a2018';
      g.font = 'bold 21px "Hiragino Mincho ProN", serif';
      g.fillText(sub, w * 0.5, h * 0.81);
      return;
    }

    if (style === 'ivory_sumi') {
      if (isMask) {
        const glow = g.createRadialGradient(w * 0.5, h * 0.5, 24, w * 0.5, h * 0.5, w * 0.52);
        glow.addColorStop(0, '#fff4de');
        glow.addColorStop(0.75, '#ebd2a9');
        glow.addColorStop(1, '#8c7656');
        g.fillStyle = glow;
        g.fillRect(12, 12, w - 24, h - 24);
      } else {
        const bg = g.createLinearGradient(0, 10, 0, h - 10);
        bg.addColorStop(0, '#fcf8ef');
        bg.addColorStop(1, '#ede4d2');
        g.fillStyle = bg;
        g.fillRect(10, 10, w - 20, h - 20);
        g.strokeStyle = '#b89b67';
        g.lineWidth = 3;
        g.strokeRect(18, 18, w - 36, h - 36);
      }

      g.fillStyle = isMask ? '#050404' : '#181412';
      g.font = '900 80px "Hiragino Mincho ProN", "YuMincho", "Hiragino Kaku Gothic ProN", serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, badge ? w * 0.44 : w * 0.52, h * 0.46);

      if (badge) {
        g.font = '900 42px "Hiragino Mincho ProN", "YuMincho", serif';
        g.fillText(badge, w * 0.80, h * 0.52);
      }
      g.fillStyle = isMask ? '#9e1c14' : '#c4261d';
      g.fillRect(38, 36, 44, 44);
      g.fillStyle = '#fff8ee';
      g.font = 'bold 20px "Hiragino Mincho ProN", serif';
      g.fillText(seal.slice(0, 2), 60, 58);

      g.fillStyle = isMask ? '#1a1612' : '#4a3d31';
      g.font = 'bold 20px "Hiragino Kaku Gothic ProN", sans-serif';
      g.fillText(sub, w * 0.5, h * 0.84);
      return;
    }

    if (style === 'chibo_neon') {
      if (!isMask) {
        g.fillStyle = '#141816';
        g.fillRect(10, 10, w - 20, h - 20);
        g.strokeStyle = 'rgba(80, 190, 120, 0.20)';
        g.lineWidth = 1.5;
        for (let x = 28; x < w - 28; x += 24) {
          g.beginPath(); g.moveTo(x, 18); g.lineTo(x, h - 18); g.stroke();
        }
      }
      g.strokeStyle = isMask ? '#36f582' : '#28c766';
      g.lineWidth = 5;
      g.strokeRect(18, 18, w - 36, h - 36);
      g.strokeStyle = isMask ? '#ff4638' : '#d93226';
      g.lineWidth = 3;
      g.strokeRect(27, 27, w - 54, h - 54);

      g.fillStyle = isMask ? '#fff8e8' : '#f7f2e4';
      g.font = '900 74px "Hiragino Kaku Gothic ProN", "Hiragino Mincho ProN", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w * 0.5, h * 0.45);

      g.fillStyle = isMask ? '#4dff98' : '#5ce892';
      g.font = 'bold 22px "Hiragino Kaku Gothic ProN", sans-serif';
      g.fillText(sub, w * 0.5, h * 0.81);
      return;
    }

    if (style === 'lacquer_gold') {
      if (!isMask) {
        const bg = g.createLinearGradient(0, 10, 0, h - 10);
        bg.addColorStop(0, '#241915');
        bg.addColorStop(0.5, '#16110f');
        bg.addColorStop(1, '#211612');
        g.fillStyle = bg;
        g.fillRect(10, 10, w - 20, h - 20);
      }
      g.strokeStyle = isMask ? '#e8bd64' : '#d4a84f';
      g.lineWidth = 4;
      g.strokeRect(18, 18, w - 36, h - 36);

      g.fillStyle = isMask ? '#d92b22' : '#b8221a';
      g.beginPath();
      g.arc(76, h * 0.5, 34, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff8eb';
      g.font = '900 28px "Hiragino Mincho ProN", serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(seal.slice(0, 2), 76, h * 0.51);

      g.fillStyle = isMask ? '#ffe59e' : '#f5d584';
      g.font = '900 72px "Hiragino Mincho ProN", "YuMincho", serif';
      g.fillText(text, w * 0.53, h * 0.45);

      g.fillStyle = isMask ? '#e8c982' : '#cfb06d';
      g.font = 'bold 21px "Hiragino Kaku Gothic ProN", sans-serif';
      g.fillText(sub, w * 0.53, h * 0.81);
      return;
    }

    // 'crimson_gold': High-energy Osaka crimson & gold flagship signboard
    if (isMask) {
      const bgGlow = g.createRadialGradient(w * 0.5, h * 0.5, 30, w * 0.5, h * 0.5, w * 0.55);
      bgGlow.addColorStop(0, '#cf291d');
      bgGlow.addColorStop(1, '#4a0d08');
      g.fillStyle = bgGlow;
      g.fillRect(14, 14, w - 28, h - 28);
    } else {
      const bg = g.createLinearGradient(0, 10, 0, h - 10);
      bg.addColorStop(0, '#c7261c');
      bg.addColorStop(0.55, '#9e1912');
      bg.addColorStop(1, '#75100b');
      g.fillStyle = bg;
      g.fillRect(10, 10, w - 20, h - 20);
    }

    g.strokeStyle = isMask ? '#ffe28a' : '#ebbf5b';
    g.lineWidth = 5;
    g.strokeRect(18, 18, w - 36, h - 36);

    if (!isMask) {
      g.fillStyle = 'rgba(20, 4, 2, 0.58)';
      g.font = '900 72px "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w * 0.5 + 4, h * 0.45 + 4);
    }
    g.fillStyle = isMask ? '#fffdf5' : '#fff8e6';
    g.font = '900 72px "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w * 0.5, h * 0.45);

    g.fillStyle = isMask ? '#ffe394' : '#f7d070';
    g.font = 'bold 22px "Hiragino Kaku Gothic ProN", sans-serif';
    g.fillText(sub, w * 0.5, h * 0.81);
  };

  return {
    map: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, false), { repeat: false }),
    emissiveMap: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, true), { repeat: false }),
  };
}

/**
 * Multi-Tier Stacked Projecting Vertical Sign Tower (道頓堀・新世界 多段突き出し縦看板, 256x768):
 * Renders 3 distinct stacked Osaka graphic sign compartments separated by dark steel mullions.
 * Each tier item: { bg, fg, accent, text, sub, horizontal }.
 */
export function createTowerSignTextureSet(tiers) {
  const W = 256;
  const H = 768;

  const draw = (g, w, h, isMask) => {
    g.fillStyle = isMask ? '#000000' : '#181b20';
    g.fillRect(0, 0, w, h);

    const count = tiers.length;
    const gap = 14;
    const padX = 14;
    const cellH = (h - gap * (count + 1)) / count;

    tiers.forEach((tier, idx) => {
      const y0 = gap + idx * (cellH + gap);
      const cw = w - padX * 2;
      const bg = tier.bg ?? '#b8261e';
      const fg = tier.fg ?? '#fff8eb';
      const accent = tier.accent ?? '#ebbf5b';

      if (isMask) {
        const tube = g.createLinearGradient(padX, 0, w - padX, 0);
        tube.addColorStop(0, '#222222');
        tube.addColorStop(0.2, bg);
        tube.addColorStop(0.5, '#ffffff');
        tube.addColorStop(0.8, bg);
        tube.addColorStop(1, '#222222');
        g.fillStyle = bg;
        g.globalAlpha = 0.68;
        g.fillRect(padX + 4, y0 + 4, cw - 8, cellH - 8);
        g.globalAlpha = 0.30;
        g.fillStyle = tube;
        g.fillRect(padX + 4, y0 + 4, cw - 8, cellH - 8);
        g.globalAlpha = 1.0;
      } else {
        g.fillStyle = bg;
        g.fillRect(padX, y0, cw, cellH);
      }

      g.strokeStyle = isMask ? accent : accent;
      g.lineWidth = 4;
      g.strokeRect(padX + 7, y0 + 7, cw - 14, cellH - 14);

      const isLightBg = bg.startsWith('#f') || bg.startsWith('#e') || bg.startsWith('#fff');
      const textFill = isMask ? (isLightBg ? '#080808' : '#fffdf5') : fg;

      if (tier.sub) {
        g.fillStyle = isMask ? (isLightBg ? '#111111' : accent) : accent;
        g.fillRect(padX + 12, y0 + 12, cw - 24, 32);
        g.fillStyle = isMask ? (isLightBg ? '#fff8eb' : '#121212') : (accent.startsWith('#f') || accent.startsWith('#e') ? '#181412' : '#ffffff');
        g.font = '900 20px "Hiragino Kaku Gothic ProN", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(tier.sub, w * 0.5, y0 + 28);
      }

      const bodyTop = y0 + (tier.sub ? 50 : 18);
      const bodyH = cellH - (tier.sub ? 64 : 36);

      if (tier.horizontal) {
        const lines = tier.text.split('\n');
        const fSize = lines.length >= 3 ? 38 : 48;
        g.fillStyle = textFill;
        g.font = `900 ${fSize}px "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const lStep = fSize * 1.18;
        const startY = bodyTop + bodyH * 0.5 - ((lines.length - 1) * lStep) * 0.5;
        lines.forEach((ln, li) => g.fillText(ln, w * 0.5, startY + li * lStep));
      } else {
        const chars = [...tier.text];
        const fSize = chars.length >= 6 ? 30 : (chars.length === 5 ? 35 : (chars.length === 4 ? 42 : 52));
        const step = Math.min(fSize * 1.06, bodyH / Math.max(chars.length, 1));
        const startY = bodyTop + bodyH * 0.5 - ((chars.length - 1) * step) * 0.5;
        g.fillStyle = textFill;
        g.font = `900 ${fSize}px "Hiragino Kaku Gothic ProN", "Hiragino Mincho ProN", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        chars.forEach((ch, ci) => g.fillText(ch, w * 0.5, startY + ci * step));
      }
    });
  };

  return {
    map: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, false), { repeat: false }),
    emissiveMap: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, true), { repeat: false }),
  };
}

/**
 * Rooftop Landmark Neon/LED Crown Billboard (道頓堀 屋上大型広告塔, 768x384):
 * Variants: 'taxfree', 'kanidoraku', 'chibo', 'ebisu', 'asahi_gold'.
 */
export function createRooftopBillboardSet(variant = 'taxfree') {
  const W = 768;
  const H = 384;

  const draw = (g, w, h, isMask) => {
    g.fillStyle = isMask ? '#000000' : '#1b1e24';
    g.fillRect(0, 0, w, h);

    if (variant === 'taxfree') {
      g.fillStyle = isMask ? '#e8291e' : '#cc1f16';
      g.fillRect(14, 14, w - 28, h * 0.64);
      g.fillStyle = isMask ? '#f5f2ec' : '#ffffff';
      g.fillRect(14, 14 + h * 0.64, w - 28, h - 28 - h * 0.64);

      g.fillStyle = '#ffffff';
      g.font = '900 112px "Hiragino Kaku Gothic ProN", sans-serif';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText('免 税', 46, h * 0.36);

      g.font = 'bold 58px "Hiragino Kaku Gothic ProN", sans-serif';
      g.fillText('Tax Free', 418, h * 0.39);

      g.fillStyle = isMask ? '#121212' : '#c41e16';
      g.beginPath();
      g.arc(w * 0.30, h * 0.81, 24, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = isMask ? '#080808' : '#1e2229';
      g.font = '900 34px "Hiragino Kaku Gothic ProN", sans-serif';
      g.textAlign = 'center';
      g.fillText('SUZURAN CENTRAL PLAZA', w * 0.56, h * 0.81);
      return;
    }

    if (variant === 'kanidoraku') {
      g.fillStyle = isMask ? '#fff6e8' : '#fcf8f0';
      g.fillRect(14, 14, w - 28, h - 28);
      g.strokeStyle = isMask ? '#ff3324' : '#d62318';
      g.lineWidth = 18;
      g.strokeRect(23, 23, w - 46, h - 46);
      g.strokeStyle = isMask ? 'rgba(220,40,25,0.45)' : 'rgba(210,38,24,0.35)';
      g.lineWidth = 4;
      for (let i = 1; i < 4; i++) {
        g.beginPath(); g.moveTo((w * i) / 4, 24); g.lineTo((w * i) / 4, h - 24); g.stroke();
      }
      g.beginPath(); g.moveTo(24, h * 0.5); g.lineTo(w - 24, h * 0.5); g.stroke();

      g.fillStyle = isMask ? '#ff2418' : '#cc1d14';
      g.font = '900 132px "Hiragino Mincho ProN", "YuMincho", serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('かに道楽', w * 0.5, h * 0.46);

      g.fillStyle = isMask ? '#111111' : '#241c18';
      g.font = '900 32px "Hiragino Kaku Gothic ProN", sans-serif';
      g.fillText('総 本 店 · KANI DORAKU', w * 0.5, h * 0.82);
      return;
    }

    if (variant === 'chibo') {
      g.fillStyle = isMask ? '#050806' : '#121714';
      g.fillRect(14, 14, w - 28, h - 28);
      g.strokeStyle = isMask ? '#24c968' : '#1e7844';
      g.lineWidth = 2;
      for (let x = 32; x < w - 24; x += 32) {
        g.beginPath(); g.moveTo(x, 20); g.lineTo(x, h - 20); g.stroke();
      }
      for (let y = 32; y < h - 24; y += 32) {
        g.beginPath(); g.moveTo(20, y); g.lineTo(w - 20, y); g.stroke();
      }
      g.strokeStyle = isMask ? '#ff3d2e' : '#d92b1e';
      g.lineWidth = 10;
      g.strokeRect(22, 22, w - 44, h - 44);

      g.fillStyle = isMask ? '#44ff8e' : '#4ce88b';
      g.font = '900 116px "Hiragino Mincho ProN", "Hiragino Kaku Gothic ProN", serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('千 房', w * 0.60, h * 0.44);

      g.fillStyle = isMask ? '#ff5242' : '#ff5e4d';
      g.font = '900 44px "Hiragino Kaku Gothic ProN", sans-serif';
      g.fillText('お好み焼', w * 0.24, h * 0.36);
      g.fillText('鉄 板 焼', w * 0.24, h * 0.56);

      g.fillStyle = '#fff8e8';
      g.font = 'bold 28px "Hiragino Kaku Gothic ProN", sans-serif';
      g.fillText('OKONOMIYAKI & TEPPANYAKI CHIBO', w * 0.5, h * 0.84);
      return;
    }

    if (variant === 'asahi_gold') {
      // Classic Amber-Gold & Silver Crisp Draft Neon Billboard
      const bg = g.createLinearGradient(0, 14, 0, h - 14);
      bg.addColorStop(0, isMask ? '#fff2b2' : '#fce895');
      bg.addColorStop(0.45, isMask ? '#f0a824' : '#e09819');
      bg.addColorStop(1, isMask ? '#b8680c' : '#9e5608');
      g.fillStyle = bg;
      g.fillRect(14, 14, w - 28, h - 28);
      g.fillStyle = isMask ? '#d9dadf' : '#eef1f5';
      g.fillRect(14, 14, w - 28, 72);

      g.fillStyle = '#141820';
      g.font = '900 42px "Hiragino Kaku Gothic ProN", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('PREMIUM DRAFT · 樽生', w * 0.5, 50);

      g.fillStyle = isMask ? '#080808' : '#181410';
      g.font = '900 108px "Hiragino Kaku Gothic ProN", sans-serif';
      g.fillText('辛口 生ビール', w * 0.5, h * 0.56);

      g.fillStyle = '#fffaf0';
      g.font = 'bold 28px "Hiragino Kaku Gothic ProN", sans-serif';
      g.fillText('SUZURAN BREWERY HALL', w * 0.5, h * 0.85);
      return;
    }

    // 'ebisu': Royal Gold & Indigo Grand Promenade Landmark Neon Billboard
    const bg = g.createLinearGradient(0, 14, w, h - 14);
    bg.addColorStop(0, isMask ? '#122854' : '#102247');
    bg.addColorStop(0.5, isMask ? '#1d3f7a' : '#183466');
    bg.addColorStop(1, isMask ? '#0f2042' : '#0d1b38');
    g.fillStyle = bg;
    g.fillRect(14, 14, w - 28, h - 28);

    g.strokeStyle = isMask ? '#ffdf78' : '#e6be53';
    g.lineWidth = 10;
    g.strokeRect(22, 22, w - 44, h - 44);
    g.lineWidth = 3;
    g.strokeRect(34, 34, w - 68, h - 68);

    g.fillStyle = isMask ? '#fff6d6' : '#ffefc2';
    g.font = '900 104px "Hiragino Mincho ProN", "Hiragino Kaku Gothic ProN", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('すずらん本町', w * 0.5, h * 0.43);

    g.fillStyle = isMask ? '#ffd262' : '#f2c45a';
    g.font = 'bold 30px "Hiragino Kaku Gothic ProN", sans-serif';
    g.fillText('SUZURAN GRAND PROMENADE · 歓迎', w * 0.5, h * 0.79);
  };

  return {
    map: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, false), { repeat: false }),
    emissiveMap: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, true), { repeat: false }),
  };
}

/**
 * Panoramic Podium LED / Media Wall / Shinsaibashi Neon Lightbox Showcase (512x288):
 * Variants: 'wagyu', 'crab_feast', 'gourmet_fest', 'glico_sprinter', 'neon_ring', 'cosme_luxury', 'kabuki_bill'.
 */
export function createPodiumPosterSet(variant = 'wagyu') {
  const W = 512;
  const H = 288;

  const draw = (g, w, h, isMask) => {
    g.fillStyle = isMask ? '#000000' : '#16181c';
    g.fillRect(0, 0, w, h);

    if (variant === 'glico_sprinter') {
      // Iconic Ebisubashi Cobalt-Blue Stadium Track, Crimson Sun & Triumphant Sprinter Neon Homage!
      const sky = g.createLinearGradient(0, 12, 0, h - 12);
      sky.addColorStop(0, isMask ? '#1270de' : '#0f5ec2');
      sky.addColorStop(0.6, isMask ? '#1d9bf0' : '#1986d4');
      sky.addColorStop(1, isMask ? '#0d3f8a' : '#0b3473');
      g.fillStyle = sky;
      g.fillRect(12, 12, w - 24, h - 24);

      // Perspective white stadium track lanes converging to center
      g.strokeStyle = 'rgba(255,255,255,0.68)';
      g.lineWidth = 3;
      for (const tx of [48, 128, 384, 464]) {
        g.beginPath();
        g.moveTo(w * 0.5 + (tx - w * 0.5) * 0.22, h * 0.52);
        g.lineTo(tx, h - 14);
        g.stroke();
      }
      // Giant crimson sun circle
      g.fillStyle = isMask ? '#ff2b1f' : '#e02218';
      g.beginPath();
      g.arc(w * 0.5, h * 0.46, 82, 0, Math.PI * 2);
      g.fill();

      // Triumphant white sprinter silhouette with raised V-arms!
      g.strokeStyle = '#ffffff';
      g.fillStyle = '#ffffff';
      g.lineWidth = 12;
      g.beginPath();
      g.arc(w * 0.5, h * 0.30, 16, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(w * 0.5 - 46, h * 0.14);
      g.lineTo(w * 0.5, h * 0.40);
      g.lineTo(w * 0.5 + 46, h * 0.14);
      g.moveTo(w * 0.5, h * 0.38);
      g.lineTo(w * 0.5, h * 0.62);
      g.lineTo(w * 0.5 - 24, h * 0.84);
      g.moveTo(w * 0.5, h * 0.60);
      g.lineTo(w * 0.5 + 28, h * 0.72);
      g.stroke();

      g.fillStyle = '#fff9eb';
      g.font = '900 30px "Hiragino Kaku Gothic ProN", sans-serif';
      g.textAlign = 'left';
      g.fillText('VICTORY', 28, 52);
      g.textAlign = 'right';
      g.fillText('300m', w - 28, 52);
      return;
    }

    if (variant === 'neon_ring') {
      // Fashion Flagship Neon Wireframe Globe
      const bg = g.createLinearGradient(12, 12, w - 12, h - 12);
      bg.addColorStop(0, isMask ? '#290826' : '#1f081d');
      bg.addColorStop(0.5, isMask ? '#4a0e3e' : '#360c2e');
      bg.addColorStop(1, isMask ? '#101836' : '#0e142b');
      g.fillStyle = bg;
      g.fillRect(12, 12, w - 24, h - 24);

      g.strokeStyle = isMask ? '#ff42b8' : '#e635a3';
      g.lineWidth = 5;
      g.strokeRect(20, 20, w - 40, h - 40);

      // Glowing white & cyan wireframe meridian rings
      g.strokeStyle = '#ffffff';
      g.lineWidth = 6;
      g.beginPath();
      g.arc(w * 0.5, h * 0.5, 96, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = isMask ? '#5cebff' : '#4ad6eb';
      g.lineWidth = 3.5;
      g.beginPath();
      g.arc(w * 0.5, h * 0.5, 64, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(w * 0.5 - 102, h * 0.5); g.lineTo(w * 0.5 + 102, h * 0.5);
      g.moveTo(w * 0.5, h * 0.5 - 102); g.lineTo(w * 0.5, h * 0.5 + 102);
      g.stroke();

      g.fillStyle = '#ffffff';
      g.font = '900 54px "Hiragino Kaku Gothic ProN", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('LUMIÈRE', w * 0.5, h * 0.46);
      g.fillStyle = '#ff6ec7';
      g.font = 'bold 22px "Hiragino Kaku Gothic ProN", sans-serif';
      g.fillText('SUZURAN MODE', w * 0.5, h * 0.66);
      return;
    }

    if (variant === 'cosme_luxury') {
      // Bright Shinsaibashi Cosmetics, Luxury Watches & Tax-Free Department Lightbox
      g.fillStyle = isMask ? '#f5f2ee' : '#ffffff';
      g.fillRect(12, 12, w - 24, h - 24);
      // Left crimson TAX FREE vertical ribbon
      g.fillStyle = isMask ? '#eb261c' : '#d41f15';
      g.fillRect(12, 12, 168, h - 24);
      // Right champagne-navy luxury panel
      g.fillStyle = isMask ? '#16284c' : '#122140';
      g.fillRect(344, 12, w - 356, h - 24);

      g.fillStyle = '#ffffff';
      g.font = '900 44px "Hiragino Kaku Gothic ProN", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('免 税', 96, 86);
      g.font = '900 28px "Hiragino Kaku Gothic ProN", sans-serif';
      g.fillText('TAX FREE', 96, 148);
      g.font = 'bold 22px "Hiragino Kaku Gothic ProN", sans-serif';
      g.fillText('化粧品・薬', 96, 214);

      // Center beauty & skincare clean typography
      g.fillStyle = isMask ? '#0a0a0c' : '#1a1c22';
      g.font = '900 34px "Hiragino Mincho ProN", serif';
      g.fillText('美肌コスメ', 262, 96);
      g.fillStyle = isMask ? '#9e1c48' : '#b82255';
      g.font = 'bold 24px "Hiragino Kaku Gothic ProN", sans-serif';
      g.fillText('COSME &', 262, 156);
      g.fillText('SKINCARE', 262, 192);

      // Right luxury watch dial emblem
      g.strokeStyle = '#ebc265';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(422, 112, 46, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(422, 112); g.lineTo(422, 82);
      g.moveTo(422, 112); g.lineTo(448, 122);
      g.stroke();
      g.fillStyle = '#ffe296';
      g.font = 'bold 22px "Hiragino Kaku Gothic ProN", sans-serif';
      g.fillText('WATCH & JEWEL', 422, 212);
      return;
    }

    if (variant === 'kabuki_bill') {
      // Traditional Osaka Shochikuza Kabuki Theatre Edo Billing Board (歌舞伎絵看板・まねき)
      g.fillStyle = isMask ? '#f2dfc0' : '#f7ead2';
      g.fillRect(12, 12, w - 24, h - 24);
      // Traditional Edo定式幕 (kuro-moegi-kaki: black, green, persimmon stripes) along top & bottom!
      const stripes = ['#1c1917', '#266b44', '#c95624', '#1c1917', '#266b44', '#c95624'];
      const sw = (w - 24) / stripes.length;
      stripes.forEach((col, i) => {
        g.fillStyle = col;
        g.fillRect(12 + i * sw, 12, sw + 1, 26);
        g.fillRect(12 + i * sw, h - 38, sw + 1, 26);
      });
      g.strokeStyle = '#5c3b1e';
      g.lineWidth = 6;
      g.strokeRect(12, 12, w - 24, h - 24);

      g.fillStyle = isMask ? '#8f1812' : '#b01e16';
      g.beginPath();
      g.arc(w * 0.78, h * 0.50, 56, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff8eb';
      g.font = '900 44px "Hiragino Mincho ProN", serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('壽', w * 0.78, h * 0.51);

      g.fillStyle = isMask ? '#080605' : '#18120e';
      g.font = '900 48px "Hiragino Mincho ProN", serif';
      g.textAlign = 'left';
      g.fillText('大歌舞伎公演', 34, 108);
      g.fillStyle = isMask ? '#1c1410' : '#5e2418';
      g.font = 'bold 28px "Hiragino Mincho ProN", serif';
      g.fillText('名代 すずらん松竹座', 36, 174);
      return;
    }

    if (variant === 'wagyu') {
      const grad = g.createLinearGradient(12, 12, w - 12, h - 12);
      grad.addColorStop(0, isMask ? '#3d100c' : '#2b0d0a');
      grad.addColorStop(0.6, isMask ? '#8f2218' : '#6e1912');
      grad.addColorStop(1, isMask ? '#24140e' : '#1c100c');
      g.fillStyle = grad;
      g.fillRect(12, 12, w - 24, h - 24);

      g.fillStyle = isMask ? '#ff9c45' : '#e88b38';
      g.beginPath();
      g.ellipse(w * 0.72, h * 0.56, 108, 68, -0.12, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = isMask ? '#ff4f3b' : '#d93b2b';
      g.beginPath();
      g.ellipse(w * 0.72, h * 0.54, 82, 46, -0.12, 0, Math.PI * 2);
      g.fill();

      g.strokeStyle = isMask ? '#ffd875' : '#d9b252';
      g.lineWidth = 4;
      g.strokeRect(18, 18, w - 36, h - 36);

      g.fillStyle = '#fff8eb';
      g.font = '900 46px "Hiragino Mincho ProN", serif';
      g.textAlign = 'left';
      g.fillText('黒毛和牛 A5', 36, 92);
      g.fillStyle = '#ffd875';
      g.font = 'bold 28px "Hiragino Kaku Gothic ProN", sans-serif';
      g.fillText('極上鉄板ステーキ', 36, 146);
      g.fillStyle = '#ffffff';
      g.font = 'bold 20px "Hiragino Kaku Gothic ProN", sans-serif';
      g.fillText('PREMIUM WAGYU TEPPAN STEAK', 36, 224);
      return;
    }

    if (variant === 'crab_feast') {
      const grad = g.createLinearGradient(12, 12, w - 12, h - 12);
      grad.addColorStop(0, isMask ? '#102c44' : '#0d253b');
      grad.addColorStop(1, isMask ? '#1d5478' : '#184766');
      g.fillStyle = grad;
      g.fillRect(12, 12, w - 24, h - 24);

      g.fillStyle = isMask ? '#ffd978' : '#ebc25e';
      g.beginPath();
      g.arc(w * 0.74, h * 0.50, 74, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = isMask ? '#ff3624' : '#d92818';
      g.beginPath();
      g.ellipse(w * 0.74, h * 0.52, 58, 38, 0, 0, Math.PI * 2);
      g.fill();

      g.strokeStyle = '#f2cf74';
      g.lineWidth = 4;
      g.strokeRect(18, 18, w - 36, h - 36);

      g.fillStyle = '#ffffff';
      g.font = '900 46px "Hiragino Mincho ProN", serif';
      g.textAlign = 'left';
      g.fillText('旬魚・天然本鮪', 36, 94);
      g.fillStyle = '#ffe28a';
      g.font = 'bold 28px "Hiragino Mincho ProN", serif';
      g.fillText('本格江戸前鮨・割烹', 36, 148);
      g.fillStyle = '#d8eefc';
      g.font = 'bold 20px "Hiragino Kaku Gothic ProN", sans-serif';
      g.fillText('SEASONAL OMAKASE KAISEKI', 36, 224);
      return;
    }

    // 'gourmet_fest': Vibrant Osaka Gourmet & Duty-Free LED Showcase
    const grad = g.createLinearGradient(12, 12, w - 12, h - 12);
    grad.addColorStop(0, isMask ? '#b82218' : '#9c1b12');
    grad.addColorStop(0.5, isMask ? '#d96b1c' : '#bd5915');
    grad.addColorStop(1, isMask ? '#243b6b' : '#1d3059');
    g.fillStyle = grad;
    g.fillRect(12, 12, w - 24, h - 24);
    g.strokeStyle = '#ffe484';
    g.lineWidth = 5;
    g.strokeRect(18, 18, w - 36, h - 36);

    g.fillStyle = '#fffdf5';
    g.font = '900 50px "Hiragino Kaku Gothic ProN", sans-serif';
    g.textAlign = 'center';
    g.fillText('名代 食い倒れ横丁', w * 0.5, 108);
    g.fillStyle = '#ffe885';
    g.font = 'bold 28px "Hiragino Kaku Gothic ProN", sans-serif';
    g.fillText('たこ焼 · 串かつ · お好み焼 · 寿司', w * 0.5, 168);
    g.fillStyle = '#ffffff';
    g.font = 'bold 20px "Hiragino Kaku Gothic ProN", sans-serif';
    g.fillText('SUZURAN GOURMET DINING HALL', w * 0.5, 226);
  };

  return {
    map: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, false), { repeat: false }),
    emissiveMap: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, true), { repeat: false }),
  };
}

/**
 * 4-Quarter Stacked Giant Calligraphy Lantern Atlas (`元` / `祖` / `王` / `将`, 256x1024)
 * for the signature 4-lantern steel tower rack in a single draw call!
 */
export function createOhshoLanternStackSet() {
  const W = 256;
  const H = 1024;
  const chars = ['元', '祖', '王', '将'];
  const cellH = H / 4;

  const draw = (g, w, h, isMask) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, w, h);

    chars.forEach((ch, idx) => {
      const y0 = idx * cellH;
      if (isMask) {
        const glow = g.createLinearGradient(0, y0, 0, y0 + cellH);
        glow.addColorStop(0.00, '#000000');
        glow.addColorStop(0.14, '#7a4a18');
        glow.addColorStop(0.50, '#ffd480');
        glow.addColorStop(0.86, '#7a4a18');
        glow.addColorStop(1.00, '#000000');
        g.fillStyle = glow;
        g.fillRect(0, y0 + 10, w, cellH - 20);
      } else {
        const bg = g.createLinearGradient(0, y0, 0, y0 + cellH);
        bg.addColorStop(0.00, '#9e7c52');
        bg.addColorStop(0.15, '#faebd0');
        bg.addColorStop(0.50, '#fff7e6');
        bg.addColorStop(0.85, '#faebd0');
        bg.addColorStop(1.00, '#9e7c52');
        g.fillStyle = bg;
        g.fillRect(0, y0, w, cellH);
        // Bold crimson Osaka Ohsho lantern brush strokes at top & bottom shoulders
        g.fillStyle = '#cf2419';
        g.fillRect(0, y0 + 18, w, 24);
        g.fillRect(0, y0 + cellH - 42, w, 24);
      }
      g.fillStyle = isMask ? '#000000' : '#181310';
      g.fillRect(0, y0, w, 12);
      g.fillRect(0, y0 + cellH - 12, w, 12);

      // Giant crimson-edged black calligraphy character on front (u=0.5) & sides (u=0.24, u=0.76)
      for (const ux of [0.24, 0.50, 0.76]) {
        if (!isMask) {
          g.fillStyle = '#cf2419';
          g.font = `900 ${ux === 0.50 ? 128 : 96}px "Hiragino Mincho ProN", "YuMincho", serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(ch, w * ux + 3, y0 + cellH * 0.52 + 3);
        }
        g.fillStyle = isMask ? '#000000' : '#171210';
        g.font = `900 ${ux === 0.50 ? 124 : 92}px "Hiragino Mincho ProN", "YuMincho", serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(ch, w * ux, y0 + cellH * 0.52);
      }
    });
  };

  return {
    map: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, false), { repeat: false }),
    emissiveMap: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, true), { repeat: false }),
  };
}

/**
 * Dotonbori Canal-Style Golden Festival Lantern (道頓堀献灯提灯, 256x384, Reference 2!):
 * Warm cream-gold Washi paper lantern with vermilion festival bands & vertical calligraphy.
 */
export function createFestivalLanternSet({
  text = 'すずらん',
  sub = '本町筋',
} = {}) {
  const W = 256;
  const H = 384;
  const ribs = 12;
  const hField = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const v = 1.0 - y / H;
    const pleat = Math.abs(Math.sin(v * ribs * Math.PI));
    for (let x = 0; x < W; x++) {
      hField[y * W + x] = 0.36 + pleat * 0.52;
    }
  }
  const { normalMap } = buildNormalAndRoughnessMaps(W, H, hField, null, { strength: 1.9, repeat: false });

  const draw = (g, w, h, isMask) => {
    if (isMask) {
      g.fillStyle = '#000000';
      g.fillRect(0, 0, w, h);
      const glow = g.createLinearGradient(0, 0, 0, h);
      glow.addColorStop(0.00, '#000000');
      glow.addColorStop(0.10, '#6e4214');
      glow.addColorStop(0.35, '#ebaa4b');
      glow.addColorStop(0.50, '#ffd078');
      glow.addColorStop(0.65, '#ebaa4b');
      glow.addColorStop(0.90, '#6e4214');
      glow.addColorStop(1.00, '#000000');
      g.fillStyle = glow;
      g.fillRect(0, 14, w, h - 28);
    } else {
      const bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0.00, '#9c7848');
      bg.addColorStop(0.12, '#f5dfb2');
      bg.addColorStop(0.50, '#fff2d4');
      bg.addColorStop(0.88, '#f5dfb2');
      bg.addColorStop(1.00, '#9c7848');
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#cc291e';
      g.fillRect(0, 22, w, 22);
      g.fillRect(0, h - 44, w, 22);
    }

    for (let r = 1; r < ribs; r++) {
      const ry = (r / ribs) * h;
      g.fillStyle = isMask ? 'rgba(0,0,0,0.42)' : 'rgba(90,58,28,0.28)';
      g.fillRect(0, ry - 1.2, w, 2.4);
    }

    g.fillStyle = isMask ? '#000000' : '#181310';
    g.fillRect(0, 0, w, 16);
    g.fillRect(0, h - 16, w, 16);

    const ink = isMask ? '#000000' : '#1a1411';
    const drawV = (str, cx, maxF) => {
      const chars = [...str];
      const span = h - 136;
      const fSize = Math.min(maxF, Math.floor(span / Math.max(chars.length * 1.05, 1)));
      const step = fSize * 1.08;
      const startY = h * 0.5 - ((chars.length - 1) * step) * 0.5;
      g.fillStyle = ink;
      g.font = `900 ${fSize}px "Hiragino Mincho ProN", "YuMincho", serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      chars.forEach((ch, idx) => g.fillText(ch, cx, startY + idx * step));
    };
    drawV(text, w * 0.50, 64);
    drawV(sub, w * 0.22, 46);
    drawV(sub, w * 0.78, 46);
  };

  return {
    map: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, false), { repeat: false }),
    emissiveMap: makeCanvasTexture(W, H, (g, w, h) => draw(g, w, h, true), { repeat: false }),
    normalMap,
  };
}
