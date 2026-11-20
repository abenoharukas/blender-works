// Procedural canvas textures tailored for a Japanese townscape:
// - Residential siding, shikkui plaster, ceramic tile & yakisugi/cedar wood
// - Commercial tile upper facades, 6 Japanese ground-floor shopfront types
// - Projecting sleeve signs (袖看板) & horizontal fascia signs (看板)
// - Clay kawara tiles (いぶし瓦 / 茶瓦), slate & standing-seam galvalume roofs
import * as THREE from 'three';

function makeCanvasTexture(width, height, draw, { repeat = true, anisotropy = 8 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
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

function rgbShift(hexInt, delta) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((hexInt >> 16) & 255) + delta);
  const g = clamp(((hexInt >> 8) & 255) + delta);
  const b = clamp((hexInt & 255) + delta);
  return `rgb(${r},${g},${b})`;
}

/**
 * Japanese residential exterior wall (1 bay = 3.2 m wide x 2.9 m storey).
 * Styles: 'plaster', 'siding', 'tile', 'wood_warm', 'yakisugi'
 * Window styles: 'sliding', 'slit', 'koshido'
 */
export function createHouseWallTexture({
  baseHex,
  style = 'siding',
  frameColor = '#2c3035',
  windowType = 'sliding',
  warmCurtain = true,
}) {
  return makeCanvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = rgbShift(baseHex, 0);
    g.fillRect(0, 0, w, h);

    if (style === 'siding') {
      // Fine horizontal Japanese ceramic siding boards (窯業系サイディング)
      for (let y = 0; y < h; y += 16) {
        g.fillStyle = rgbShift(baseHex, -10);
        g.fillRect(0, y, w, 2);
        g.fillStyle = rgbShift(baseHex, 6);
        g.fillRect(0, y + 2, w, 1);
      }
      // Subtle vertical caulking joint
      g.fillStyle = rgbShift(baseHex, -8);
      g.fillRect(w - 2, 0, 2, h);
    } else if (style === 'tile') {
      // Small horizontal ceramic tiles (二丁掛タイル)
      const tw = 32;
      const th = 12;
      g.fillStyle = rgbShift(baseHex, 14);
      g.fillRect(0, 0, w, h);
      for (let row = 0; row < Math.ceil(h / th); row++) {
        const offset = (row % 2) * (tw / 2);
        for (let col = -1; col < Math.ceil(w / tw) + 1; col++) {
          const jitter = ((row * 7 + col * 13) % 5) - 2;
          g.fillStyle = rgbShift(baseHex, jitter * 3);
          g.fillRect(col * tw + offset + 1, row * th + 1, tw - 2, th - 2);
        }
      }
    } else if (style === 'wood_warm' || style === 'yakisugi') {
      // Vertical Japanese cedar boards (杉板縦張り / 焼杉)
      const bw = 16;
      for (let x = 0; x < w; x += bw) {
        const tone = (((x / bw) * 17) % 7) - 3;
        g.fillStyle = rgbShift(baseHex, tone * 4);
        g.fillRect(x, 0, bw - 1, h);
        g.fillStyle = rgbShift(baseHex, -18);
        g.fillRect(x + bw - 2, 0, 2, h);
      }
    } else {
      // Smooth shikkui / plaster with subtle trowel modulation
      for (let i = 0; i < 12; i++) {
        g.fillStyle = rgbShift(baseHex, i % 2 === 0 ? 4 : -4);
        g.globalAlpha = 0.22;
        g.fillRect((i * 23) % w, 0, 28, h);
      }
      g.globalAlpha = 1;
      g.fillStyle = rgbShift(baseHex, -9);
      g.fillRect(0, h - 3, w, 3);
    }

    // Floor drip edge / band at bottom
    g.fillStyle = 'rgba(0,0,0,0.08)';
    g.fillRect(0, h - 6, w, 6);

    // Draw Japanese residential window
    if (windowType === 'none') return;

    const wx = windowType === 'slit' ? 38 : 48;
    const wy = windowType === 'slit' ? 58 : 54;
    const ww = windowType === 'slit' ? 180 : 160;
    const wh = windowType === 'slit' ? 54 : 118;

    // Outer aluminum / wood frame + slight drop shadow
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(wx - 4, wy + wh, ww + 8, 6);
    g.fillStyle = frameColor;
    g.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);

    // Glass backing with soft sky reflection + warm shoji/curtain interior
    const grad = g.createLinearGradient(0, wy, 0, wy + wh);
    if (warmCurtain) {
      grad.addColorStop(0, '#5a7688');
      grad.addColorStop(0.45, '#394954');
      grad.addColorStop(1, '#584c3c');
    } else {
      grad.addColorStop(0, '#6a899e');
      grad.addColorStop(0.55, '#33424c');
      grad.addColorStop(1, '#232c33');
    }
    g.fillStyle = grad;
    g.fillRect(wx, wy, ww, wh);

    // Lace curtain / shoji paper hint inside lower half
    if (warmCurtain && windowType !== 'slit') {
      g.fillStyle = 'rgba(244, 236, 218, 0.34)';
      g.fillRect(wx + 4, wy + 18, ww / 2 - 8, wh - 22);
      g.fillRect(wx + ww / 2 + 4, wy + 34, ww / 2 - 8, wh - 38);
    }

    // Diagonal sky glint
    g.fillStyle = 'rgba(220, 238, 250, 0.22)';
    g.beginPath();
    g.moveTo(wx + 8, wy);
    g.lineTo(wx + 46, wy);
    g.lineTo(wx + 14, wy + wh);
    g.lineTo(wx, wy + wh);
    g.closePath();
    g.fill();

    // Mullions (sliding sash center split or wooden koshido lattice)
    g.fillStyle = frameColor;
    g.fillRect(wx + ww / 2 - 3, wy, 6, wh);
    if (windowType === 'koshido') {
      // Traditional vertical wooden lattice bars (木格子)
      const step = 14;
      g.fillStyle = '#5c3c24';
      for (let x = wx + 8; x < wx + ww - 4; x += step) {
        g.fillRect(x, wy, 4, wh);
      }
      g.fillRect(wx, wy + wh * 0.5, ww, 4);
    } else if (windowType === 'sliding') {
      // Shutter box (シャッターボックス) above sliding window
      g.fillStyle = frameColor;
      g.fillRect(wx - 6, wy - 16, ww + 12, 10);
      g.fillStyle = 'rgba(255,255,255,0.14)';
      g.fillRect(wx - 4, wy - 14, ww + 8, 2);
    }
  });
}

/**
 * Commercial upper-storey facade (1 bay = 3.0 m wide x 3.2 m storey).
 * Porcelain tile cladding with larger office/clinic/apartment windows.
 */
export function createCommercialUpperTexture({ baseHex, frameColor = '#282c30', accentHex = null }) {
  return makeCanvasTexture(256, 256, (g, w, h) => {
    // Grout background
    g.fillStyle = rgbShift(baseHex, -14);
    g.fillRect(0, 0, w, h);

    // Tile grid
    const tw = 32;
    const th = 16;
    for (let r = 0; r < h / th; r++) {
      for (let c = 0; c < w / tw; c++) {
        const v = (((r * 11 + c * 5) % 5) - 2) * 3;
        g.fillStyle = rgbShift(baseHex, v);
        g.fillRect(c * tw + 1, r * th + 1, tw - 2, th - 2);
      }
    }

    // Spandrel band
    if (accentHex !== null) {
      g.fillStyle = rgbShift(accentHex, 0);
      g.fillRect(0, 0, w, 22);
    }
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, h - 8, w, 8);

    // Wide commercial window
    const wx = 26;
    const wy = 44;
    const ww = 204;
    const wh = 142;

    g.fillStyle = frameColor;
    g.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);

    const glass = g.createLinearGradient(0, wy, 0, wy + wh);
    glass.addColorStop(0, '#607d90');
    glass.addColorStop(0.45, '#33424c');
    glass.addColorStop(1, '#3d352b');
    g.fillStyle = glass;
    g.fillRect(wx, wy, ww, wh);

    // Venetian blinds / lit room ceiling strip hint
    g.fillStyle = 'rgba(255, 232, 190, 0.28)';
    g.fillRect(wx + 10, wy + 12, ww - 20, 26);
    g.fillStyle = 'rgba(220, 235, 245, 0.22)';
    for (let y = wy + 6; y < wy + 58; y += 8) {
      g.fillRect(wx + 4, y, ww / 2 - 8, 3);
    }

    // 3-panel aluminum mullions + transom
    g.fillStyle = frameColor;
    g.fillRect(wx + Math.floor(ww / 3) - 2, wy, 4, wh);
    g.fillRect(wx + Math.floor((ww * 2) / 3) - 2, wy, 4, wh);
    g.fillRect(wx, wy + 42, ww, 4);

    // Sill
    g.fillStyle = 'rgba(240,240,236,0.55)';
    g.fillRect(wx - 7, wy + wh + 3, ww + 14, 6);
  });
}

/**
 * Ground-floor Japanese storefront textures (1 bay = 3.2 m wide x 3.8 m tall, non-repeating Y).
 * Variants: 'izakaya', 'ramen', 'kissaten', 'konbini_lawson', 'konbini_famima', 'pharmacy', 'bookstore'
 */
export function createShopfrontTexture(variant) {
  return makeCanvasTexture(256, 300, (g, w, h) => {
    if (variant === 'konbini_lawson' || variant === 'konbini_famima') {
      // Crisp Japanese convenience store fascia + bright glass front
      g.fillStyle = '#f2f0ea';
      g.fillRect(0, 0, w, h);

      // Iconic multi-stripe konbini header (top 68 px)
      if (variant === 'konbini_lawson') {
        g.fillStyle = '#1f6fb8';
        g.fillRect(0, 8, w, 46);
        g.fillStyle = '#ffffff';
        g.fillRect(0, 46, w, 8);
        g.fillStyle = '#d95b72';
        g.fillRect(0, 54, w, 6);
      } else {
        g.fillStyle = '#1b9e4b';
        g.fillRect(0, 8, w, 24);
        g.fillStyle = '#ffffff';
        g.fillRect(0, 32, w, 10);
        g.fillStyle = '#1574bd';
        g.fillRect(0, 42, w, 20);
      }

      // Bright glazed storefront
      const glassY = 74;
      const glassH = h - glassY - 12;
      const grad = g.createLinearGradient(0, glassY, 0, h);
      grad.addColorStop(0, '#8fb2c4');
      grad.addColorStop(0.35, '#a8c3c8');
      grad.addColorStop(1, '#d8cfb8');
      g.fillStyle = grad;
      g.fillRect(10, glassY, w - 20, glassH);

      // Colorful interior shelves visible behind glass
      const shelfColors = ['#e05a47', '#f0b849', '#4ca66b', '#4d88c4'];
      for (let sy = glassY + 46; sy < h - 30; sy += 28) {
        g.fillStyle = 'rgba(50,55,60,0.45)';
        g.fillRect(22, sy + 14, w - 44, 4);
        for (let sx = 26; sx < w - 34; sx += 18) {
          g.fillStyle = shelfColors[(sx + sy) % shelfColors.length];
          g.globalAlpha = 0.48;
          g.fillRect(sx, sy, 13, 13);
        }
        g.globalAlpha = 1;
      }

      // Silver aluminum mullions & kickplate
      g.fillStyle = '#aeb4ba';
      g.fillRect(8, glassY, 6, glassH + 8);
      g.fillRect(w - 14, glassY, 6, glassH + 8);
      g.fillRect(w / 2 - 3, glassY, 6, glassH + 8);
      g.fillRect(8, glassY, w - 16, 6);
      g.fillStyle = '#555b61';
      g.fillRect(0, h - 12, w, 12);
      return;
    }

    if (variant === 'izakaya' || variant === 'ramen') {
      // Warm timber + plaster Japanese eatery
      const wood = variant === 'izakaya' ? '#4a3221' : '#5e341e';
      const wall = variant === 'izakaya' ? '#dfd5c3' : '#2b2420';
      g.fillStyle = wall;
      g.fillRect(0, 0, w, h);

      // Upper wooden sign fascia
      g.fillStyle = variant === 'izakaya' ? '#2c2018' : '#9e2a22';
      g.fillRect(8, 10, w - 16, 54);
      g.strokeStyle = '#c9a978';
      g.lineWidth = 2;
      g.strokeRect(14, 16, w - 28, 42);

      //Stylized Japanese kanji blocks on sign
      g.fillStyle = variant === 'izakaya' ? '#f4ead5' : '#fff5e0';
      g.font = 'bold 28px "Hiragino Mincho ProN", "Yu Mincho", serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(variant === 'izakaya' ? '居 酒 屋' : '中 華 そ ば', w / 2, 38);

      // Wooden sliding hikido & warm shoji glow
      g.fillStyle = wood;
      g.fillRect(14, 78, w - 28, h - 86);

      // Warm lit interior shoji / glass panes
      const warm = g.createLinearGradient(0, 90, 0, h - 20);
      warm.addColorStop(0, '#f7cf8b');
      warm.addColorStop(0.6, '#d99a4e');
      warm.addColorStop(1, '#7a4d25');
      g.fillStyle = warm;
      g.fillRect(26, 92, 92, h - 120);
      g.fillRect(134, 92, 96, 118);

      // Lattice bars (格子)
      g.fillStyle = wood;
      for (let x = 26; x <= 118; x += 15) g.fillRect(x, 92, 4, h - 120);
      for (let y = 92; y < h - 28; y += 26) g.fillRect(26, y, 92, 4);
      for (let x = 134; x <= 230; x += 19) g.fillRect(x, 92, 4, 118);

      // Stone threshold at bottom
      g.fillStyle = '#5c5953';
      g.fillRect(0, h - 14, w, 14);
      return;
    }

    // Kissaten / Bookstore / Pharmacy
    const palette = {
      kissaten: { bg: '#233b32', trim: '#c8a96e', title: '珈琲 琥珀', glassTop: '#4e6770', glassBot: '#8f653b' },
      bookstore: { bg: '#273244', trim: '#e5dcc8', title: '古書・文具', glassTop: '#566d7e', glassBot: '#7a6345' },
      pharmacy: { bg: '#eceae2', trim: '#1e7858', title: 'くすり・処方箋', glassTop: '#7ea4b5', glassBot: '#c9d4cf' },
    }[variant] ?? { bg: '#2c353d', trim: '#dfd7c5', title: '青果・雑貨', glassTop: '#587180', glassBot: '#7d6648' };

    g.fillStyle = palette.bg;
    g.fillRect(0, 0, w, h);

    // Header signboard
    g.fillStyle = variant === 'pharmacy' ? '#1e7858' : palette.bg;
    g.fillRect(10, 10, w - 20, 52);
    g.fillStyle = variant === 'pharmacy' ? '#ffffff' : palette.trim;
    g.font = 'bold 25px "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(palette.title, w / 2, 36);

    // Display window + door
    const gl = g.createLinearGradient(0, 76, 0, h - 16);
    gl.addColorStop(0, palette.glassTop);
    gl.addColorStop(1, palette.glassBot);
    g.fillStyle = gl;
    g.fillRect(18, 76, 138, h - 108);
    g.fillRect(168, 76, 70, h - 90);

    // Warm pendant lamps inside kissaten/bookstore
    g.fillStyle = 'rgba(255, 224, 160, 0.65)';
    g.beginPath();
    g.arc(58, 122, 8, 0, Math.PI * 2);
    g.arc(116, 122, 8, 0, Math.PI * 2);
    g.fill();

    // Window frames & wainscoting
    g.strokeStyle = palette.trim;
    g.lineWidth = 4;
    g.strokeRect(18, 76, 138, h - 108);
    g.strokeRect(168, 76, 70, h - 90);
    g.fillStyle = '#3c3a36';
    g.fillRect(0, h - 14, w, 14);
  });
}

/**
 * Vertical projecting sleeve sign (袖看板) texture, clamped.
 */
export function createSleeveSignTexture({ bg, fg, text, border = '#2b2d30' }) {
  return makeCanvasTexture(96, 256, (g, w, h) => {
    g.fillStyle = border;
    g.fillRect(0, 0, w, h);
    g.fillStyle = bg;
    g.fillRect(6, 6, w - 12, h - 12);

    g.fillStyle = fg;
    g.font = 'bold 34px "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const chars = [...text];
    const step = Math.min(46, (h - 44) / Math.max(chars.length, 1));
    const startY = h / 2 - ((chars.length - 1) * step) / 2;
    chars.forEach((ch, idx) => {
      g.fillText(ch, w / 2, startY + idx * step);
    });
  }, { repeat: false });
}

/**
 * Traditional Noren curtain (暖簾) texture with slits.
 */
export function createNorenTexture({ bg, fg, crestText }) {
  return makeCanvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    // Fabric weave vertical texture
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let x = 0; x < w; x += 6) g.fillRect(x, 0, 2, h);
    // Panel slits at bottom
    const panels = 4;
    const pw = w / panels;
    g.fillStyle = '#1a1512';
    for (let i = 1; i < panels; i++) {
      g.fillRect(i * pw - 2, h * 0.35, 4, h * 0.65);
    }
    // White crest circles / text
    g.strokeStyle = fg;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(pw * 0.5, h * 0.46, 22, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = fg;
    g.font = 'bold 24px "Hiragino Mincho ProN", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const chars = [...crestText];
    chars.forEach((c, idx) => {
      g.fillText(c, pw * (idx + 0.5), h * 0.48);
    });
  }, { repeat: false });
}

/**
 * Roof textures:
 * - 'kawara': Japanese clay tiles (いぶし銀瓦 / 茶瓦)
 * - 'galvalume': Modern standing-seam metal roof (ガルバリウム縦ハゼ葺き)
 * - 'slate': Flat residential slate shingles (化粧スレート)
 * - 'solar': Rooftop photovoltaic panel grid
 */
export function createRoofTexture({ baseHex, style = 'kawara' }) {
  return makeCanvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = rgbShift(baseHex, 0);
    g.fillRect(0, 0, w, h);

    if (style === 'kawara') {
      const cols = 8;
      const rows = 8;
      const cw = w / cols;
      const rh = h / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * cw;
          const y = r * rh;
          const grad = g.createLinearGradient(x, y, x + cw, y);
          grad.addColorStop(0, rgbShift(baseHex, -18));
          grad.addColorStop(0.38, rgbShift(baseHex, 16));
          grad.addColorStop(0.78, rgbShift(baseHex, -6));
          grad.addColorStop(1, rgbShift(baseHex, -24));
          g.fillStyle = grad;
          g.fillRect(x, y, cw, rh - 2);
          // Horizontal overlap lip shadow
          g.fillStyle = 'rgba(0,0,0,0.32)';
          g.fillRect(x, y + rh - 3, cw, 3);
        }
      }
    } else if (style === 'galvalume') {
      const seam = 16;
      for (let x = 0; x < w; x += seam) {
        g.fillStyle = rgbShift(baseHex, 4);
        g.fillRect(x, 0, seam - 3, h);
        g.fillStyle = rgbShift(baseHex, 18);
        g.fillRect(x + seam - 3, 0, 1, h);
        g.fillStyle = rgbShift(baseHex, -22);
        g.fillRect(x + seam - 2, 0, 2, h);
      }
    } else if (style === 'solar') {
      g.fillStyle = '#142238';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#7b93ad';
      g.lineWidth = 4;
      g.strokeRect(2, 2, w - 4, h - 4);
      g.strokeStyle = 'rgba(160, 195, 230, 0.35)';
      g.lineWidth = 1.5;
      for (let x = 32; x < w; x += 32) {
        g.beginPath();
        g.moveTo(x, 4);
        g.lineTo(x, h - 4);
        g.stroke();
      }
      for (let y = 32; y < h; y += 32) {
        g.beginPath();
        g.moveTo(4, y);
        g.lineTo(w - 4, y);
        g.stroke();
      }
    } else {
      // Slate shingles
      const rh = 20;
      const cw = 64;
      for (let r = 0; r < Math.ceil(h / rh); r++) {
        const off = (r % 2) * 32;
        for (let c = -1; c < 5; c++) {
          const tone = (((r * 7 + c * 3) % 5) - 2) * 4;
          g.fillStyle = rgbShift(baseHex, tone);
          g.fillRect(c * cw + off + 1, r * rh + 1, cw - 2, rh - 3);
        }
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(0, (r + 1) * rh - 2, w, 2);
      }
    }
  });
}

/**
 * Concrete block wall (ブロック塀) texture for residential lot boundaries.
 */
export function createBlockWallTexture(baseHex = 0x9b9890) {
  return makeCanvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = rgbShift(baseHex, -12);
    g.fillRect(0, 0, w, h);
    const bw = 32;
    const bh = 16;
    for (let r = 0; r < h / bh; r++) {
      const off = (r % 2) * 16;
      for (let c = -1; c < w / bw + 1; c++) {
        const jitter = (((r * 5 + c * 9) % 5) - 2) * 3;
        g.fillStyle = rgbShift(baseHex, jitter);
        g.fillRect(c * bw + off + 1, r * bh + 1, bw - 2, bh - 2);
      }
    }
    // Slight moss/weathering at base
    const grad = g.createLinearGradient(0, h - 28, 0, h);
    grad.addColorStop(0, 'rgba(55,65,48,0)');
    grad.addColorStop(1, 'rgba(48,58,42,0.28)');
    g.fillStyle = grad;
    g.fillRect(0, h - 28, w, 28);
  });
}
