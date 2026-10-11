// Turns a photo of a paper drawing into a transparent cut-out, all on canvas.
//
// Pipeline (see process()):
//   1. estimate the paper colour across the image and divide it out
//   2. mark "ink": pixels clearly darker or more colourful than paper
//   3. close small outline gaps, flood-fill the outside from the crop edge;
//      everything not reached is balloon (so uncoloured insides stay white)
//   4. drop specks, keeping thin bits (ropes) that hang off the drawing
//   5. feather the edge, boost colour, trim, scale, export PNG
(function () {
  const MAX_INPUT = 1600; // longest side after loading the photo
  const MAX_WORK = 1000; // longest side while cleaning up
  const MAX_OUTPUT = 800; // longest side of the exported PNG

  // ---------- loading ----------

  function isHeic(file) {
    return /hei[cf]/i.test(file.type || "") || /\.hei[cf]$/i.test(file.name || "");
  }

  function loadImg(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("decode failed"));
      };
      img.src = url;
    });
  }

  let heicLib = null;
  function loadHeicLib() {
    if (!heicLib) {
      heicLib = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "vendor/heic2any.min.js";
        s.onload = () => resolve(window.heic2any);
        s.onerror = () => reject(new Error("Could not load the HEIC converter"));
        document.head.appendChild(s);
      });
    }
    return heicLib;
  }

  // Browsers apply EXIF orientation to <img> (image-orientation: from-image),
  // and drawImage keeps it, so the canvas comes out the right way up.
  async function loadPhoto(file) {
    let loaded;
    try {
      loaded = await loadImg(file);
    } catch (e) {
      if (!isHeic(file)) throw new Error("Sorry, we couldn't open that picture. Please try a JPEG or PNG photo.");
      const heic2any = await loadHeicLib();
      const jpeg = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
      loaded = await loadImg(Array.isArray(jpeg) ? jpeg[0] : jpeg);
    }
    const { img, url } = loaded;
    const scale = Math.min(1, MAX_INPUT / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    return c;
  }

  // ---------- small image helpers ----------

  function readPixels(canvas, crop, maxSide) {
    const scale = Math.min(1, maxSide / Math.max(crop.w, crop.h));
    const W = Math.max(1, Math.round(crop.w * scale));
    const H = Math.max(1, Math.round(crop.h * scale));
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);
    return { W, H, data: ctx.getImageData(0, 0, W, H).data, scale };
  }

  // Square max filter (dilation) or min filter (erosion), separable.
  function morph(mask, W, H, r, dilate) {
    if (r <= 0) return mask.slice();
    const tmp = new Uint8Array(W * H);
    const out = new Uint8Array(W * H);
    const hit = dilate ? 1 : 0;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let count = 0; // pixels equal to `hit` in window
      for (let x = -r; x <= r; x++) if (x >= 0 && x < W && mask[row + x] === hit) count++;
      for (let x = 0; x < W; x++) {
        // out-of-bounds counts as 0, which is a "hit" for erosion
        const outOfBounds = (x - r < 0 ? r - x : 0) + (x + r >= W ? x + r - W + 1 : 0);
        const any = count > 0 || (!dilate && outOfBounds > 0);
        tmp[row + x] = dilate ? (any ? 1 : 0) : any ? 0 : 1;
        const xo = x - r, xi = x + r + 1;
        if (xo >= 0 && mask[row + xo] === hit) count--;
        if (xi < W && mask[row + xi] === hit) count++;
      }
    }
    for (let x = 0; x < W; x++) {
      let count = 0;
      for (let y = -r; y <= r; y++) if (y >= 0 && y < H && tmp[y * W + x] === hit) count++;
      for (let y = 0; y < H; y++) {
        const outOfBounds = (y - r < 0 ? r - y : 0) + (y + r >= H ? y + r - H + 1 : 0);
        const any = count > 0 || (!dilate && outOfBounds > 0);
        out[y * W + x] = dilate ? (any ? 1 : 0) : any ? 0 : 1;
        const yo = y - r, yi = y + r + 1;
        if (yo >= 0 && tmp[yo * W + x] === hit) count--;
        if (yi < H && tmp[yi * W + x] === hit) count++;
      }
    }
    return out;
  }

  // 4-connected labelling of pixels where mask === 1.
  function label(mask, W, H) {
    const labels = new Int32Array(W * H);
    const comps = [null];
    const stack = new Int32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (!mask[i] || labels[i]) continue;
      const id = comps.length;
      const c = { id, area: 0, x0: W, y0: H, x1: -1, y1: -1, border: false };
      let sp = 0;
      stack[sp++] = i;
      labels[i] = id;
      while (sp) {
        const p = stack[--sp];
        const x = p % W, y = (p - x) / W;
        c.area++;
        if (x < c.x0) c.x0 = x;
        if (x > c.x1) c.x1 = x;
        if (y < c.y0) c.y0 = y;
        if (y > c.y1) c.y1 = y;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) c.border = true;
        if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = id; stack[sp++] = p - 1; }
        if (x < W - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = id; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - W] && !labels[p - W]) { labels[p - W] = id; stack[sp++] = p - W; }
        if (y < H - 1 && mask[p + W] && !labels[p + W]) { labels[p + W] = id; stack[sp++] = p + W; }
      }
      comps.push(c);
    }
    return { labels, comps };
  }

  // Pixels reachable from the image border without crossing `wall`.
  function floodOutside(wall, W, H) {
    const out = new Uint8Array(W * H);
    const stack = new Int32Array(W * H);
    let sp = 0;
    const seed = (p) => {
      if (!wall[p] && !out[p]) { out[p] = 1; stack[sp++] = p; }
    };
    for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
    while (sp) {
      const p = stack[--sp];
      const x = p % W;
      if (x > 0) seed(p - 1);
      if (x < W - 1) seed(p + 1);
      if (p >= W) seed(p - W);
      if (p < W * (H - 1)) seed(p + W);
    }
    return out;
  }

  // ---------- 1. paper estimate & flattening ----------

  // Least-squares fit of a + bu + cv + du² + euv + fv² to trusted cells,
  // per colour channel. Returns [[6 coeffs] x 3].
  function fitQuadratic(cellRGB, ok, gw, gh) {
    const A = Array.from({ length: 6 }, () => new Float64Array(6));
    const B = Array.from({ length: 3 }, () => new Float64Array(6));
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const c = gy * gw + gx;
        if (!ok[c]) continue;
        const u = gx / gw - 0.5, v = gy / gh - 0.5;
        const t = [1, u, v, u * u, u * v, v * v];
        for (let i = 0; i < 6; i++) {
          for (let j = 0; j < 6; j++) A[i][j] += t[i] * t[j];
          for (let k = 0; k < 3; k++) B[k][i] += t[i] * cellRGB[c * 3 + k];
        }
      }
    }
    for (let i = 0; i < 6; i++) A[i][i] += 1e-6;
    return B.map((b) => solve(A.map((row) => Array.from(row)), Array.from(b)));
  }

  // Gaussian elimination with partial pivoting.
  function solve(A, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let piv = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
      [A[i], A[piv]] = [A[piv], A[i]];
      [b[i], b[piv]] = [b[piv], b[i]];
      if (Math.abs(A[i][i]) < 1e-12) continue;
      for (let r = i + 1; r < n; r++) {
        const f = A[r][i] / A[i][i];
        for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
        b[r] -= f * b[i];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
      x[i] = Math.abs(A[i][i]) < 1e-12 ? 0 : s / A[i][i];
    }
    return x;
  }

  // Returns Float32Array(W*H*3): pixel / local paper colour, clamped to 0..1.
  function flatten(data, W, H) {
    const cs = Math.max(8, Math.round(Math.max(W, H) / 24));
    const gw = Math.ceil(W / cs), gh = Math.ceil(H / cs), n = gw * gh;
    const cellRGB = new Float32Array(n * 3);
    const cellLum = new Float32Array(n);
    const hist = new Uint32Array(256);
    const sums = new Float64Array(256 * 3);

    // Bright-percentile colour of each cell: the paper, if any shows there.
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        hist.fill(0);
        sums.fill(0);
        let count = 0;
        const x1 = Math.min(W, (gx + 1) * cs), y1 = Math.min(H, (gy + 1) * cs);
        for (let y = gy * cs; y < y1; y++) {
          for (let x = gx * cs; x < x1; x++) {
            const i = (y * W + x) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const l = (r * 77 + g * 150 + b * 29) >> 8;
            hist[l]++;
            sums[l * 3] += r; sums[l * 3 + 1] += g; sums[l * 3 + 2] += b;
            count++;
          }
        }
        const want = Math.max(1, Math.round(count * 0.08));
        let got = 0, r = 0, g = 0, b = 0;
        for (let l = 255; l >= 0 && got < want; l--) {
          if (!hist[l]) continue;
          got += hist[l];
          r += sums[l * 3]; g += sums[l * 3 + 1]; b += sums[l * 3 + 2];
        }
        const c = gy * gw + gx;
        cellRGB[c * 3] = r / got; cellRGB[c * 3 + 1] = g / got; cellRGB[c * 3 + 2] = b / got;
        cellLum[c] = (0.3 * r + 0.59 * g + 0.11 * b) / got;
      }
    }

    // Reference paper: the brighter cells' typical brightness and tint.
    const sorted = Array.from(cellLum).sort((a, b) => a - b);
    const refLum = sorted[Math.floor((sorted.length - 1) * 0.8)] || 255;
    let tr = 0, tg = 0, tb = 0, tn = 0;
    for (let c = 0; c < n; c++) {
      if (cellLum[c] >= refLum * 0.9) {
        const s = cellRGB[c * 3] + cellRGB[c * 3 + 1] + cellRGB[c * 3 + 2] + 1e-6;
        tr += cellRGB[c * 3] / s; tg += cellRGB[c * 3 + 1] / s; tb += cellRGB[c * 3 + 2] / s; tn++;
      }
    }
    tr /= tn; tg /= tn; tb /= tn;

    // A cell is trusted as paper if it is paper-tinted, not too dark overall,
    // and not much darker than its brightest neighbours (shadows are gradual,
    // big coloured or dark fills are not).
    const ok = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
      const s = cellRGB[c * 3] + cellRGB[c * 3 + 1] + cellRGB[c * 3 + 2] + 1e-6;
      const dr = cellRGB[c * 3] / s - tr, dg = cellRGB[c * 3 + 1] / s - tg, db = cellRGB[c * 3 + 2] / s - tb;
      ok[c] = cellLum[c] >= refLum * 0.4 && Math.sqrt(dr * dr + dg * dg + db * db) < 0.07 ? 1 : 0;
    }
    const ok2 = ok.slice();
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const c = gy * gw + gx;
        if (!ok[c]) continue;
        let best = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const x = gx + dx, y = gy + dy;
            if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
            const d = y * gw + x;
            if (ok[d] && cellLum[d] > best) best = cellLum[d];
          }
        }
        if (cellLum[c] < best * 0.72) ok2[c] = 0;
      }
    }

    // Untrusted cells (covered by drawing) get a smooth quadratic lighting
    // surface fitted to the trusted ones, so big fills don't glow or smear.
    let have = 0;
    for (let c = 0; c < n; c++) have += ok2[c];
    if (have < 6) {
      for (let c = 0; c < n; c++) {
        cellRGB[c * 3] = refLum * tr * 3; cellRGB[c * 3 + 1] = refLum * tg * 3; cellRGB[c * 3 + 2] = refLum * tb * 3;
      }
    } else if (have < n) {
      const fit = fitQuadratic(cellRGB, ok2, gw, gh);
      for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
          const c = gy * gw + gx;
          if (ok2[c]) continue;
          const u = gx / gw - 0.5, v = gy / gh - 0.5;
          const terms = [1, u, v, u * u, u * v, v * v];
          for (let k = 0; k < 3; k++) {
            let val = 0;
            for (let t = 0; t < 6; t++) val += fit[k][t] * terms[t];
            cellRGB[c * 3 + k] = Math.max(refLum * 0.25, Math.min(255, val));
          }
        }
      }
    }

    // Smooth the paper map a little so cell edges don't show.
    let grid = cellRGB;
    for (let pass = 0; pass < 2; pass++) {
      const next = new Float32Array(n * 3);
      for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
          let r = 0, g = 0, b = 0, k = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const x = Math.min(gw - 1, Math.max(0, gx + dx));
              const y = Math.min(gh - 1, Math.max(0, gy + dy));
              const d = y * gw + x;
              r += grid[d * 3]; g += grid[d * 3 + 1]; b += grid[d * 3 + 2]; k++;
            }
          }
          const c = gy * gw + gx;
          next[c * 3] = r / k; next[c * 3 + 1] = g / k; next[c * 3 + 2] = b / k;
        }
      }
      grid = next;
    }

    // Divide each pixel by the bilinearly sampled paper colour.
    const flat = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) {
      const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / cs - 0.5));
      const y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < W; x++) {
        const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cs - 0.5));
        const x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
        const a = (y0 * gw + x0) * 3, b = (y0 * gw + x1) * 3, c = (y1 * gw + x0) * 3, d = (y1 * gw + x1) * 3;
        const i = (y * W + x) * 4, o = (y * W + x) * 3;
        for (let k = 0; k < 3; k++) {
          const top = grid[a + k] + (grid[b + k] - grid[a + k]) * tx;
          const bot = grid[c + k] + (grid[d + k] - grid[c + k]) * tx;
          const paper = Math.max(1, top + (bot - top) * ty);
          flat[o + k] = Math.min(1, data[i + k] / paper);
        }
      }
    }
    return flat;
  }

  // ---------- 2. ink ----------

  function inkMask(flat, W, H, strength) {
    // strength 0..1: higher = stricter (fainter marks count as paper)
    const tDark = 0.1 + 0.22 * strength;
    const tChroma = 0.08 + 0.16 * strength;
    const lum = new Float32Array(W * H);
    const chroma = new Float32Array(W * H);
    for (let p = 0; p < W * H; p++) {
      const r = flat[p * 3], g = flat[p * 3 + 1], b = flat[p * 3 + 2];
      lum[p] = 0.3 * r + 0.59 * g + 0.11 * b;
      chroma[p] = Math.max(r, g, b) - Math.min(r, g, b);
    }
    // 3x3 average first, to ignore sensor noise and paper grain.
    const ink = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let l = 0, c = 0, k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            l += lum[yy * W + xx]; c += chroma[yy * W + xx]; k++;
          }
        }
        ink[y * W + x] = 1 - l / k > tDark || c / k > tChroma ? 1 : 0;
      }
    }
    return ink;
  }

  // ---------- 4. specks ----------

  function keepMain(mask, W, H, strength) {
    const { labels, comps } = label(mask, W, H);
    if (comps.length <= 1) return mask;
    let main = comps[1];
    for (let i = 2; i < comps.length; i++) if (comps[i].area > main.area) main = comps[i];
    const minArea = main.area * (0.004 + 0.03 * strength);
    const size = Math.max(W, H);
    const near = size * 0.04;
    const keep = new Uint8Array(comps.length);
    for (let i = 1; i < comps.length; i++) {
      const c = comps[i];
      if (c.area >= minArea) { keep[i] = 1; continue; }
      // Thin strokes near the drawing (e.g. a rope with a gap) survive.
      const len = Math.max(c.x1 - c.x0, c.y1 - c.y0) + 1;
      const thin = c.area / len < 6;
      const close = c.x1 >= main.x0 - near && c.x0 <= main.x1 + near && c.y1 >= main.y0 - near && c.y0 <= main.y1 + near;
      if (thin && close && len >= size * 0.03) keep[i] = 1;
    }
    const out = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) if (labels[p] && keep[labels[p]]) out[p] = 1;
    return out;
  }

  // ---------- auto crop ----------

  function guessCrop(canvas) {
    const full = { x: 0, y: 0, w: canvas.width, h: canvas.height };
    const { W, H, data, scale } = readPixels(canvas, full, 400);
    const flat = flatten(data, W, H);
    const ink = morph(inkMask(flat, W, H, 0.5), W, H, 3, true);
    const { comps } = label(ink, W, H);
    const cands = comps.filter((c) => c && !c.border && c.area > W * H * 0.002);
    const fallback = {
      x: Math.round(canvas.width * 0.08), y: Math.round(canvas.height * 0.08),
      w: Math.round(canvas.width * 0.84), h: Math.round(canvas.height * 0.84),
    };
    if (!cands.length) return fallback;
    cands.sort((a, b) => b.area - a.area);
    const main = cands[0];
    let { x0, y0, x1, y1 } = main;
    const reach = Math.max(W, H) * 0.12;
    for (const c of cands.slice(1)) {
      if (c.area < main.area * 0.02) continue;
      if (c.x1 >= x0 - reach && c.x0 <= x1 + reach && c.y1 >= y0 - reach && c.y0 <= y1 + reach) {
        x0 = Math.min(x0, c.x0); y0 = Math.min(y0, c.y0);
        x1 = Math.max(x1, c.x1); y1 = Math.max(y1, c.y1);
      }
    }
    const pad = Math.max(W, H) * 0.05;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
    if ((x1 - x0) * (y1 - y0) < W * H * 0.02) return fallback;
    return {
      x: Math.round(x0 / scale), y: Math.round(y0 / scale),
      w: Math.min(canvas.width, Math.round((x1 - x0 + 1) / scale)),
      h: Math.min(canvas.height, Math.round((y1 - y0 + 1) / scale)),
    };
  }

  // ---------- 5. colour, feather, trim ----------

  function boost(v, white, black) {
    return Math.min(1, Math.max(0, (v - black) / (white - black)));
  }

  function render(state) {
    const { W, H, flat, finalMask, holeLabels, clearHoles, ink, r } = state;

    // Holes the guest tapped become see-through (their true paper area).
    let mask = finalMask;
    if (clearHoles.size) {
      const hole = new Uint8Array(W * H);
      for (let p = 0; p < W * H; p++) if (clearHoles.has(holeLabels[p])) hole[p] = 1;
      const grown = morph(hole, W, H, r + 1, true);
      mask = finalMask.slice();
      for (let p = 0; p < W * H; p++) if (grown[p] && !ink[p]) mask[p] = 0;
    }

    // Feathered alpha: 3x3 average of the hard mask.
    const alpha = new Float32Array(W * H);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0, k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) { k += 3; continue; }
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            k++;
            if (xx >= 0 && xx < W) s += mask[yy * W + xx];
          }
        }
        const a = mask[y * W + x] ? (0.5 + s / k) / 1.5 : s / k / 3;
        alpha[y * W + x] = a;
        if (a > 0.02) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;

    const pad = 3;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
    const tw = x1 - x0 + 1, th = y1 - y0 + 1;
    const work = document.createElement("canvas");
    work.width = tw;
    work.height = th;
    const wctx = work.getContext("2d");
    const img = wctx.createImageData(tw, th);
    const out = img.data;
    const sat = 1.3;
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const p = (y + y0) * W + (x + x0), o = (y * tw + x) * 4;
        let r = boost(flat[p * 3], 0.9, 0.04);
        let g = boost(flat[p * 3 + 1], 0.9, 0.04);
        let b = boost(flat[p * 3 + 2], 0.9, 0.04);
        const l = 0.3 * r + 0.59 * g + 0.11 * b;
        r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
        out[o] = Math.max(0, Math.min(255, r * 255));
        out[o + 1] = Math.max(0, Math.min(255, g * 255));
        out[o + 2] = Math.max(0, Math.min(255, b * 255));
        out[o + 3] = Math.round(alpha[p] * 255);
      }
    }
    wctx.putImageData(img, 0, 0);

    const s = Math.min(1, MAX_OUTPUT / Math.max(tw, th));
    const outCanvas = document.createElement("canvas");
    outCanvas.width = Math.max(1, Math.round(tw * s));
    outCanvas.height = Math.max(1, Math.round(th * s));
    const octx = outCanvas.getContext("2d");
    octx.imageSmoothingQuality = "high";
    octx.drawImage(work, 0, 0, outCanvas.width, outCanvas.height);
    state.view = { x0, y0, s };
    return outCanvas;
  }

  // Guess which enclosed holes are the gap between the ropes: in the lower
  // half, taller than wide, and where the drawing is narrow (not a stripe
  // across the balloon or a window in it). These start see-through.
  function ropeGaps(mask, holes, W, H) {
    const rowL = new Int32Array(H).fill(W), rowR = new Int32Array(H).fill(-1);
    let top = H, bottom = -1, area = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!mask[y * W + x]) continue;
        area++;
        if (x < rowL[y]) rowL[y] = x;
        if (x > rowR[y]) rowR[y] = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    let widest = 0;
    for (let y = 0; y < H; y++) widest = Math.max(widest, rowR[y] - rowL[y] + 1);
    const gaps = new Set();
    if (bottom < 0) return gaps;
    const mid = (top + bottom) / 2;
    for (const c of holes.comps) {
      if (!c) continue;
      const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
      if (c.area > area * 0.15 || h < w * 0.9 || (c.y0 + c.y1) / 2 < mid) continue;
      let span = 0;
      for (let y = c.y0; y <= c.y1; y++) span = Math.max(span, rowR[y] - rowL[y] + 1);
      if (span < widest * 0.6) gaps.add(c.id);
    }
    return gaps;
  }

  // ---------- main entry ----------

  // canvas: loaded photo; crop: {x,y,w,h}; strength: 0..1.
  // Returns { canvas, toggleAt(x, y) } or null if nothing was found.
  function process(canvas, crop, strength) {
    const { W, H, data } = readPixels(canvas, crop, MAX_WORK);
    const flat = flatten(data, W, H);
    const ink = inkMask(flat, W, H, strength);
    const r = Math.max(2, Math.round(Math.max(W, H) * 0.008));
    const wall = morph(ink, W, H, r, true);
    const outside = floodOutside(wall, W, H);
    const filled = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) filled[p] = outside[p] ? 0 : 1;
    const finalMask = keepMain(morph(filled, W, H, r, false), W, H, strength);

    // Enclosed paper regions, which the guest may tap to make see-through.
    const holeMask = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) holeMask[p] = filled[p] && !wall[p] ? 1 : 0;
    const holes = label(holeMask, W, H);
    const holeLabels = holes.labels;

    const state = { W, H, flat, ink, r, finalMask, holeLabels, clearHoles: ropeGaps(finalMask, holes, W, H) };
    const out = render(state);
    if (!out) return null;
    let kept = 0;
    for (let p = 0; p < W * H; p++) kept += finalMask[p];
    return {
      canvas: out,
      // share of the crop box kept as balloon (near 1 = background leaked in)
      coverage: kept / (W * H),
      // x, y in output-canvas pixels. Returns true if something changed.
      toggleAt(x, y) {
        const v = state.view;
        const px = Math.round(v.x0 + x / v.s), py = Math.round(v.y0 + y / v.s);
        // Search a small radius so taps near a line still find the hole.
        let id = 0;
        for (let rad = 0; rad <= r + 3 && !id; rad++) {
          for (let dy = -rad; dy <= rad && !id; dy++) {
            for (let dx = -rad; dx <= rad && !id; dx++) {
              const xx = px + dx, yy = py + dy;
              if (xx >= 0 && yy >= 0 && xx < W && yy < H) id = holeLabels[yy * W + xx];
            }
          }
        }
        if (!id) return false;
        if (state.clearHoles.has(id)) state.clearHoles.delete(id);
        else state.clearHoles.add(id);
        const next = render(state);
        if (!next) {
          state.clearHoles.delete(id);
          return false;
        }
        this.canvas = next;
        return true;
      },
    };
  }

  // Shared with the drawing route: make the inside of a drawn shape solid
  // white, keeping strokes on top, then trim. Input: transparent canvas.
  function solidifyDrawing(canvas) {
    const W = canvas.width, H = canvas.height;
    const src = canvas.getContext("2d").getImageData(0, 0, W, H).data;
    const ink = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) ink[p] = src[p * 4 + 3] > 40 ? 1 : 0;
    const r = Math.max(2, Math.round(Math.max(W, H) * 0.006));
    const wall = morph(ink, W, H, r, true);
    const outside = floodOutside(wall, W, H);
    const filled = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) filled[p] = outside[p] ? 0 : 1;
    const inside = morph(filled, W, H, r, false);
    // Leave the gap between the ropes see-through, as for photos.
    const holeMask = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) holeMask[p] = filled[p] && !wall[p] ? 1 : 0;
    const holes = label(holeMask, W, H);
    const gaps = ropeGaps(inside, holes, W, H);
    if (gaps.size) {
      const gap = new Uint8Array(W * H);
      for (let p = 0; p < W * H; p++) if (gaps.has(holes.labels[p])) gap[p] = 1;
      const grown = morph(gap, W, H, r + 1, true);
      for (let p = 0; p < W * H; p++) if (grown[p] && !ink[p]) inside[p] = 0;
    }

    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (inside[p] || src[p * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    const pad = 4;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
    const tw = x1 - x0 + 1, th = y1 - y0 + 1;

    const work = document.createElement("canvas");
    work.width = tw;
    work.height = th;
    const wctx = work.getContext("2d");
    const fill = wctx.createImageData(tw, th);
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        if (!inside[(y + y0) * W + (x + x0)]) continue;
        const o = (y * tw + x) * 4;
        fill.data[o] = fill.data[o + 1] = fill.data[o + 2] = fill.data[o + 3] = 255;
      }
    }
    wctx.putImageData(fill, 0, 0);
    wctx.drawImage(canvas, x0, y0, tw, th, 0, 0, tw, th);

    const s = Math.min(1, MAX_OUTPUT / Math.max(tw, th));
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(tw * s));
    out.height = Math.max(1, Math.round(th * s));
    const octx = out.getContext("2d");
    octx.imageSmoothingQuality = "high";
    octx.drawImage(work, 0, 0, out.width, out.height);
    return out;
  }

  function toPngBlob(canvas) {
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create the image"))), "image/png")
    );
  }

  window.Cleanup = { loadPhoto, guessCrop, process, solidifyDrawing, toPngBlob };
})();
