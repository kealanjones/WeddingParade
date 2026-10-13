// The parade.
//
// It opens inside Sop and Bop's room: every approved balloon is painted on
// the chest of drawers. The sash window slides open, the balloons peel off
// one by one and float out through it, then the camera pushes through the
// window into the wide sky over the bridge, where the parade drifts on.
//
// Two layers share one camera: the room (drawn into its own canvas with the
// window cut out) and the world outside (sky, clouds, balloons, hills). The
// room zooms a lot, the world outside only a little, which gives the push
// through the window its depth.
(function () {
  const cfg = window.PARADE_CONFIG;
  const $ = (id) => document.getElementById(id);
  const canvas = $("sky");
  const ctx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  // depth 0 = far, 2 = near
  const DEPTHS = [
    { scale: 0.42, speed: 0.012, haze: 0.35, sway: 10 },
    { scale: 0.68, speed: 0.019, haze: 0.12, sway: 16 },
    { scale: 1.0, speed: 0.028, haze: 0, sway: 22 },
  ];
  const IDLE_AFTER = 20000; // ms without interaction before spotlighting
  const SPOT_EVERY = 13000;
  const SPOT_FOR = 9000;

  // Intro timings, in seconds.
  const T = {
    establish: 1.8, // look at the room
    open: 1.4, // sash slides up
    peel: 0.8, // balloon lifts off the drawer
    room: 2.6, // floats across the room and out of the window
    out: 5, // drifts from the window to its place in the sky
    push: 3.8, // camera moves through the window
  };
  const OUT_SCALE = 0.5; // how small the world looks through the window

  let W = 0, H = 0, dpr = 1;
  let bg = null, hills = null;
  let room = null; // layout of the room, in screen pixels at zoom 1
  let roomLayer = null, rctx = null;
  let balloons = [];
  const known = new Set();
  let clouds = [];
  let last = performance.now();
  let lastInput = performance.now();
  let spot = null; // { b, until }
  let selected = null;

  // "loading" -> ("waiting") -> "intro" -> "parade"
  let phase = "loading";
  let intro = null; // timeline, set when the intro starts
  let waitingCount = 0;
  let loadingImages = 0;
  let introTimer = 0;

  // Sop and Bop, framed on top of the chest.
  const couple = new Image();
  couple.src = "img/couple.jpg";

  // ---------- small helpers ----------

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function roundRect(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function fit(img, size) {
    const r = img.naturalWidth / img.naturalHeight || 0.7;
    return r > 1 ? [size, size / r] : [size * r, size];
  }

  // ---------- the world outside ----------

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    bg = paintSky();
    hills = paintHills();
    room = layoutRoom();
    roomLayer = document.createElement("canvas");
    roomLayer.width = canvas.width;
    roomLayer.height = canvas.height;
    rctx = roomLayer.getContext("2d");
    if (!clouds.length) {
      for (let i = 0; i < 7; i++) clouds.push({ x: Math.random(), y: 0.05 + Math.random() * 0.5, s: 0.5 + Math.random() * 0.8, v: 0.004 + Math.random() * 0.006 });
    }
    for (const b of balloons) size(b);
    if (intro) intro.slots = computeSlots(intro.n);
    draw(performance.now());
  }

  function offscreen() {
    const c = document.createElement("canvas");
    c.width = canvas.width;
    c.height = canvas.height;
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    return [c, g];
  }

  function paintSky() {
    const [c, g] = offscreen();
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#7cc4ee");
    grad.addColorStop(0.45, "#bfe6fb");
    grad.addColorStop(0.78, "#ffe6c8");
    grad.addColorStop(1, "#ffc49a");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    const r = Math.max(W, H) * 0.35;
    const sun = g.createRadialGradient(W * 0.82, H * 0.8, 0, W * 0.82, H * 0.8, r);
    sun.addColorStop(0, "rgba(255,246,216,1)");
    sun.addColorStop(0.25, "rgba(255,224,138,0.8)");
    sun.addColorStop(1, "rgba(255,200,120,0)");
    g.fillStyle = sun;
    g.fillRect(0, 0, W, H);
    return c;
  }

  // Rolling hills either side of the Avon Gorge, with the suspension bridge.
  function paintHills() {
    const [c, g] = offscreen();
    const base = H;
    const far = (x) => base - H * (0.17 + 0.04 * Math.sin(x / W * 5 + 1) + 0.02 * Math.sin(x / W * 13));
    g.fillStyle = "#a8cfb4";
    g.beginPath();
    g.moveTo(0, base);
    for (let x = 0; x <= W; x += 8) g.lineTo(x, far(x));
    g.lineTo(W, base);
    g.fill();

    const gorgeL = W * (W > H ? 0.36 : 0.18), gorgeR = W * (W > H ? 0.64 : 0.82);
    const near = (x) => {
      const h = 0.12 + 0.03 * Math.sin(x / W * 7 + 2);
      let dip = 0;
      if (x > gorgeL && x < gorgeR) dip = Math.sin(((x - gorgeL) / (gorgeR - gorgeL)) * Math.PI) * 0.09;
      return base - H * Math.max(0.02, h - dip);
    };
    const deckY = near(gorgeL) - H * 0.005;
    const towerH = H * 0.06;
    const tw = Math.max(5, W * 0.008);
    g.strokeStyle = "#5f7d8c";
    g.fillStyle = "#5f7d8c";
    g.lineWidth = Math.max(2, H * 0.004);
    g.fillRect(gorgeL - tw, deckY - towerH, tw * 2, towerH + H * 0.03);
    g.fillRect(gorgeR - tw, deckY - towerH, tw * 2, towerH + H * 0.03);
    g.beginPath();
    g.moveTo(gorgeL, deckY);
    g.lineTo(gorgeR, deckY);
    g.stroke();
    g.lineWidth = Math.max(1.5, H * 0.0025);
    g.beginPath();
    g.moveTo(gorgeL - W * 0.06, deckY + H * 0.01);
    g.lineTo(gorgeL, deckY - towerH * 0.9);
    g.quadraticCurveTo((gorgeL + gorgeR) / 2, deckY + towerH * 0.6, gorgeR, deckY - towerH * 0.9);
    g.lineTo(gorgeR + W * 0.06, deckY + H * 0.01);
    g.stroke();
    g.lineWidth = 1;
    for (let x = gorgeL + (gorgeR - gorgeL) / 14; x < gorgeR - 2; x += (gorgeR - gorgeL) / 14) {
      const t = (x - gorgeL) / (gorgeR - gorgeL);
      const cy = (1 - t) * (1 - t) * (deckY - towerH * 0.9) + 2 * (1 - t) * t * (deckY + towerH * 0.6) + t * t * (deckY - towerH * 0.9);
      g.beginPath();
      g.moveTo(x, cy);
      g.lineTo(x, deckY);
      g.stroke();
    }
    g.fillStyle = "#7fb98f";
    g.beginPath();
    g.moveTo(0, base);
    for (let x = 0; x <= W; x += 6) g.lineTo(x, near(x));
    g.lineTo(W, base);
    g.fill();
    return c;
  }

  function cloud(g, x, y, s) {
    g.beginPath();
    g.ellipse(x, y, 70 * s, 22 * s, 0, 0, Math.PI * 2);
    g.ellipse(x - 28 * s, y - 14 * s, 32 * s, 28 * s, 0, 0, Math.PI * 2);
    g.ellipse(x + 18 * s, y - 20 * s, 38 * s, 34 * s, 0, 0, Math.PI * 2);
    g.fill();
  }

  // ---------- the room ----------

  // Everything in screen pixels at zoom 1. The window sits above the chest,
  // so the balloons rise straight up and out.
  function layoutRoom() {
    const portrait = H > W * 1.1;
    const floorY = H * (portrait ? 0.79 : 0.78);
    const winY = H * (portrait ? 0.13 : 0.12);
    const winH = H * (portrait ? 0.27 : 0.31);
    const winW = Math.min(W * (portrait ? 0.58 : 0.3), winH * 0.8);
    const win = { x: W / 2 - winW / 2, y: winY, w: winW, h: winH };
    const frame = winW * 0.075; // architrave
    const stile = winW * 0.04; // sash frame
    const bar = Math.max(1.5, winW * 0.012); // glazing bar
    const sashH = winH / 2 + stile / 2;
    const openBy = sashH - stile * 1.2; // how far the lower sash slides up
    // the gap left below the raised lower sash
    const open = { x: win.x + stile, w: win.w - stile * 2, y: win.y + sashH, h: winH - sashH };
    open.cx = open.x + open.w / 2;
    open.cy = open.y + open.h / 2;

    const sillY = win.y + win.h;
    const chestBottom = H * (portrait ? 0.9 : 0.93);
    const maxW = Math.min(W * (portrait ? 0.94 : 0.56), H * 0.8);
    const ch = Math.min(maxW * 0.72, chestBottom - (sillY + H * 0.05));
    const cw = Math.min(maxW, ch * 1.5);
    const chest = { x: W / 2 - cw / 2, y: chestBottom - ch, w: cw, h: ch };
    chest.top = ch * 0.075;
    chest.over = cw * 0.035;
    chest.feet = ch * 0.085;
    chest.plinth = ch * 0.06;
    chest.side = cw * 0.055;
    const inner = {
      x: chest.x + chest.side, w: cw - chest.side * 2,
      y: chest.y + chest.top + ch * 0.035,
    };
    inner.h = chestBottom - chest.feet - chest.plinth - ch * 0.03 - inner.y;
    const gap = ch * 0.03;
    const unit = (inner.h - gap * 3) / 3.75;
    const drawers = [];
    let y = inner.y;
    const smallW = (inner.w - gap) / 2;
    drawers.push({ x: inner.x, y, w: smallW, h: unit * 0.75, knobs: 1 });
    drawers.push({ x: inner.x + smallW + gap, y, w: smallW, h: unit * 0.75, knobs: 1 });
    y += unit * 0.75 + gap;
    for (let i = 0; i < 3; i++) {
      drawers.push({ x: inner.x, y, w: inner.w, h: unit, knobs: 2 });
      y += unit + gap;
    }
    chest.drawers = drawers;
    return { portrait, floorY, win, frame, stile, bar, sashH, openBy, open, sillY, chest };
  }

  // n painted-balloon spots spread over the drawer fronts, clear of the knobs.
  function computeSlots(n) {
    n = Math.max(1, n);
    const ds = room.chest.drawers;
    let area = 0;
    for (const d of ds) area += d.w * d.h;
    let c = Math.sqrt(area / n);
    let cells = [];
    for (let tries = 0; tries < 40; tries++) {
      cells = [];
      for (const d of ds) {
        const cols = Math.max(1, Math.floor((d.w * 0.94) / c));
        const rows = Math.max(1, Math.floor((d.h * 0.84) / c));
        const cw = (d.w * 0.94) / cols, rh = (d.h * 0.84) / rows;
        const kx = d.knobs === 1 ? [d.x + d.w / 2] : [d.x + d.w * 0.25, d.x + d.w * 0.75];
        for (let r = 0; r < rows; r++) {
          for (let k = 0; k < cols; k++) {
            const x = d.x + d.w * 0.03 + cw * (k + 0.5);
            const y = d.y + d.h * 0.08 + rh * (r + 0.5);
            const size = Math.min(cw * 0.9, rh * 1.05);
            if (kx.some((q) => Math.abs(q - x) < size * 0.55) && Math.abs(y - (d.y + d.h / 2)) < size * 0.6) continue;
            cells.push({ x, y, size });
          }
        }
      }
      if (cells.length >= n) break;
      c *= 0.9;
    }
    // spread evenly when there are more spots than balloons
    const out = [];
    for (let i = 0; i < n; i++) out.push(cells[Math.floor(((i + 0.5) * cells.length) / n)]);
    return out;
  }

  // Draw the room into roomLayer with the room camera, window cut out.
  function renderRoom(cam, t) {
    const g = rctx;
    const r = room;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, roomLayer.width, roomLayer.height);
    g.setTransform(dpr * cam.zr, 0, 0, dpr * cam.zr, dpr * (cam.S.x - r.open.cx * cam.zr), dpr * (cam.S.y - r.open.cy * cam.zr));
    const open = intro ? clamp01((t / 1000 - intro.t0 - T.establish) / T.open) : 0;

    paintWall(g);
    paintWindow(g, easeInOut(open));
    paintFloor(g);
    paintSunbeam(g);
    paintChest(g);
    paintStickers(g, t);
    paintChestTop(g);
  }

  function paintWall(g) {
    const r = room;
    // big enough to cover the screen at any zoom of 1 or more
    const x0 = -W, x1 = W * 2, y0 = -H, y1 = r.floorY;
    g.fillStyle = "#f3dfc8";
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    // wallpaper: soft stripes with a little sprig pattern
    const sw = Math.max(18, W / 34);
    g.fillStyle = "rgba(226, 190, 150, 0.22)";
    for (let x = Math.floor(x0 / sw) * sw; x < x1; x += sw * 2) g.fillRect(x, y0, sw, y1 - y0);
    g.fillStyle = "rgba(200, 120, 110, 0.16)";
    let col = 0;
    for (let x = Math.floor(x0 / sw) * sw + sw * 1.5; x < x1; x += sw * 2, col++) {
      for (let y = y0 + (col % 2) * sw * 1.1; y < y1; y += sw * 2.2) {
        g.beginPath();
        g.ellipse(x, y, sw * 0.12, sw * 0.2, 0.5, 0, Math.PI * 2);
        g.ellipse(x + sw * 0.16, y + sw * 0.1, sw * 0.1, sw * 0.16, -0.6, 0, Math.PI * 2);
        g.fill();
      }
    }
    // daylight on the wall around the window
    const w = r.win;
    const glow = g.createRadialGradient(w.x + w.w / 2, w.y + w.h * 0.6, w.w * 0.3, w.x + w.w / 2, w.y + w.h * 0.6, Math.max(W, H) * 0.7);
    glow.addColorStop(0, "rgba(255, 248, 225, 0.55)");
    glow.addColorStop(1, "rgba(255, 248, 225, 0)");
    g.fillStyle = glow;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    // shade towards the corners of the room
    const shade = g.createLinearGradient(0, 0, W, 0);
    shade.addColorStop(0, "rgba(120, 70, 40, 0.18)");
    shade.addColorStop(0.25, "rgba(120, 70, 40, 0)");
    shade.addColorStop(0.75, "rgba(120, 70, 40, 0)");
    shade.addColorStop(1, "rgba(120, 70, 40, 0.18)");
    g.fillStyle = shade;
    g.fillRect(0, y0, W, y1 - y0);
    g.fillStyle = "rgba(120, 70, 40, 0.18)";
    g.fillRect(x0, y0, -x0, y1 - y0);
    g.fillRect(W, y0, x1 - W, y1 - y0);
  }

  function paintWindow(g, open) {
    const r = room, w = r.win, f = r.frame, s = r.stile, bar = r.bar;
    const white = "#fffaf1", edge = "#e4d4bf";

    // shadow of the architrave on the wall
    g.fillStyle = "rgba(120, 70, 40, 0.18)";
    roundRect(g, w.x - f + f * 0.25, w.y - f + f * 0.35, w.w + f * 2, w.h + f * 2.1, f * 0.3);
    g.fill();
    // architrave
    g.fillStyle = white;
    roundRect(g, w.x - f, w.y - f, w.w + f * 2, w.h + f * 2, f * 0.25);
    g.fill();
    g.strokeStyle = edge;
    g.lineWidth = Math.max(1, f * 0.08);
    g.stroke();
    g.strokeStyle = "rgba(200, 180, 155, 0.6)";
    g.strokeRect(w.x - f * 0.55, w.y - f * 0.55, w.w + f * 1.1, w.h + f * 1.1);
    // reveal (the depth of the wall)
    g.fillStyle = "#efe4d4";
    g.fillRect(w.x - f * 0.12, w.y - f * 0.12, w.w + f * 0.24, w.h + f * 0.24);

    // cut the hole: the world outside shows through
    g.save();
    g.globalCompositeOperation = "destination-out";
    g.fillRect(w.x, w.y, w.w, w.h);
    g.restore();

    // glass and sashes (the lower one slides up in front of the upper)
    const upper = { x: w.x, y: w.y, w: w.w, h: r.sashH };
    const lower = { x: w.x, y: w.y + w.h - r.sashH - r.openBy * open, w: w.w, h: r.sashH };
    glass(upper);
    sash(upper);
    glass(lower);
    sash(lower);

    function glass(a) {
      g.save();
      g.beginPath();
      g.rect(a.x + s, a.y + s, a.w - s * 2, a.h - s * 2);
      g.clip();
      g.fillStyle = "rgba(225, 240, 250, 0.16)";
      g.fillRect(a.x, a.y, a.w, a.h);
      g.fillStyle = "rgba(255, 255, 255, 0.28)";
      g.beginPath();
      g.moveTo(a.x + a.w * 0.15, a.y + a.h);
      g.lineTo(a.x + a.w * 0.45, a.y);
      g.lineTo(a.x + a.w * 0.58, a.y);
      g.lineTo(a.x + a.w * 0.28, a.y + a.h);
      g.fill();
      g.restore();
    }
    function sash(a) {
      g.fillStyle = white;
      g.strokeStyle = edge;
      g.lineWidth = Math.max(1, s * 0.12);
      g.beginPath();
      g.rect(a.x, a.y, a.w, a.h);
      g.rect(a.x + s, a.y + s, a.w - s * 2, a.h - s * 2);
      g.fill("evenodd");
      g.strokeRect(a.x + s, a.y + s, a.w - s * 2, a.h - s * 2);
      // glazing bars: three panes across, two down
      const iw = a.w - s * 2, ih = a.h - s * 2;
      for (let k = 1; k < 3; k++) g.fillRect(a.x + s + (iw * k) / 3 - bar / 2, a.y + s, bar, ih);
      g.fillRect(a.x + s, a.y + s + ih / 2 - bar / 2, iw, bar);
    }

    // sill
    const sy = r.sillY;
    g.fillStyle = "rgba(120, 70, 40, 0.22)";
    g.fillRect(w.x - f * 1.2, sy + f * 0.9, w.w + f * 2.4, f * 0.5);
    g.fillStyle = white;
    roundRect(g, w.x - f * 1.4, sy, w.w + f * 2.8, f * 0.95, f * 0.2);
    g.fill();
    g.strokeStyle = edge;
    g.stroke();
    g.fillStyle = "#ffffff";
    g.fillRect(w.x - f * 1.3, sy + f * 0.08, w.w + f * 2.6, f * 0.18);

    curtain(g, -1);
    curtain(g, 1);

    // pole with finials
    const py = w.y - f - w.h * 0.06;
    const px0 = w.x - f - w.w * 0.42, px1 = w.x + w.w + f + w.w * 0.42;
    g.fillStyle = "#6b4426";
    g.fillRect(px0, py - f * 0.13, px1 - px0, f * 0.26);
    for (const x of [px0, px1]) {
      g.beginPath();
      g.arc(x, py, f * 0.32, 0, Math.PI * 2);
      g.fill();
    }
    // bunting along the pole
    const colours = ["#ef4f6b", "#ffc234", "#2f97d6", "#4fb873", "#8b5cf6", "#ff8fb8"];
    const n = 11, sag = w.h * 0.06, fw = (px1 - px0) / n;
    g.strokeStyle = "#8a6a50";
    g.lineWidth = Math.max(1, f * 0.05);
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, x = lerp(px0, px1, t), y = py + Math.sin(t * Math.PI) * sag;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    for (let i = 0; i < n; i++) {
      const t0 = (i + 0.12) / n, t1 = (i + 0.88) / n, tm = (i + 0.5) / n;
      g.fillStyle = colours[i % colours.length];
      g.beginPath();
      g.moveTo(lerp(px0, px1, t0), py + Math.sin(t0 * Math.PI) * sag);
      g.lineTo(lerp(px0, px1, t1), py + Math.sin(t1 * Math.PI) * sag);
      g.lineTo(lerp(px0, px1, tm), py + Math.sin(tm * Math.PI) * sag + fw * 0.85);
      g.closePath();
      g.fill();
    }
    // "JUST MARRIED", one letter per flag
    const word = "JUSTMARRIED";
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "700 " + Math.round(fw * 0.34) + "px Figtree, system-ui, sans-serif";
    for (let i = 0; i < n; i++) {
      const tm = (i + 0.5) / n;
      g.fillText(word[i], lerp(px0, px1, tm), py + Math.sin(tm * Math.PI) * sag + fw * 0.28);
    }
  }

  // Floor-length curtain beside the window, gathered with a tie-back.
  function curtain(g, side) {
    const r = room, w = r.win, f = r.frame;
    const top = w.y - f - w.h * 0.06;
    const bottom = r.floorY - H * 0.01;
    const width = w.w * 0.4;
    const inner = side < 0 ? w.x - f * 0.6 : w.x + w.w + f * 0.6; // edge nearest the window
    const outer = inner + side * width; // edge furthest from it
    const tieY = w.y + w.h * 0.62;
    const pinch = inner + side * width * 0.5;
    const grad = g.createLinearGradient(Math.min(inner, outer), 0, Math.max(inner, outer), 0);
    const folds = 6;
    for (let i = 0; i <= folds; i++) grad.addColorStop(i / folds, i % 2 ? "#c97b7b" : "#e3a3a0");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(outer, top);
    g.lineTo(inner - side * f * 0.4, top);
    // window-side edge swoops in to the tie-back, then flares out to the floor
    g.bezierCurveTo(inner, top + (tieY - top) * 0.45, pinch, tieY - (tieY - top) * 0.2, pinch, tieY);
    g.bezierCurveTo(pinch, tieY + (bottom - tieY) * 0.3, inner + side * width * 0.12, bottom - (bottom - tieY) * 0.35, inner + side * width * 0.06, bottom);
    g.lineTo(outer + side * width * 0.06, bottom);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(140, 70, 70, 0.35)";
    g.lineWidth = Math.max(1, f * 0.06);
    g.stroke();
    // tie-back
    g.fillStyle = "#f2d38a";
    g.beginPath();
    g.ellipse((outer + pinch) / 2, tieY, Math.abs(outer - pinch) / 2 + f * 0.2, f * 0.22, 0, 0, Math.PI * 2);
    g.fill();
  }

  function paintFloor(g) {
    const r = room;
    const y0 = r.floorY, y1 = H * 2;
    const grad = g.createLinearGradient(0, y0, 0, H);
    grad.addColorStop(0, "#b57a47");
    grad.addColorStop(1, "#9c6538");
    g.fillStyle = grad;
    g.fillRect(-W, y0, W * 3, y1 - y0);
    // boards converge towards a point above the window
    const vx = W / 2, vy = y0 - H * 0.9;
    g.strokeStyle = "rgba(70, 38, 18, 0.28)";
    g.lineWidth = Math.max(1, W / 900);
    const n = 22;
    const rand = rng(7);
    const at = (xb, y) => vx + (xb - vx) * ((y - vy) / (H - vy));
    for (let i = -n; i <= n * 2; i++) {
      const xb = (i / n) * W;
      g.beginPath();
      g.moveTo(at(xb, y0), y0);
      g.lineTo(at(xb, y1), y1);
      g.stroke();
      // a plank join somewhere along each board
      const yj = y0 + (H - y0) * (0.2 + rand() * 0.7);
      g.beginPath();
      g.moveTo(at(xb, yj), yj);
      g.lineTo(at(xb + W / n, yj), yj);
      g.stroke();
    }
    // skirting board
    const sk = H * 0.028;
    g.fillStyle = "#fbf3e6";
    g.fillRect(-W, y0 - sk, W * 3, sk);
    g.fillStyle = "rgba(120, 80, 50, 0.25)";
    g.fillRect(-W, y0 - sk, W * 3, Math.max(1, sk * 0.12));
    g.fillStyle = "rgba(60, 30, 10, 0.25)";
    g.fillRect(-W, y0, W * 3, Math.max(1, sk * 0.25));
  }

  // Warm daylight falling through the window onto the floor.
  function paintSunbeam(g) {
    const w = room.win;
    g.save();
    g.globalCompositeOperation = "lighter";
    const grad = g.createLinearGradient(0, w.y, 0, H);
    grad.addColorStop(0, "rgba(255, 236, 190, 0.10)");
    grad.addColorStop(1, "rgba(255, 236, 190, 0.02)");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(w.x, w.y + w.h * 0.05);
    g.lineTo(w.x + w.w, w.y + w.h * 0.05);
    g.lineTo(w.x + w.w + W * 0.12, H * 1.05);
    g.lineTo(w.x + W * 0.02, H * 1.05);
    g.closePath();
    g.fill();
    g.restore();
  }

  function paintChest(g) {
    const c = room.chest;
    const { x, y, w, h } = c;
    const bottom = y + h;
    const lw = Math.max(1.5, w * 0.006);
    const line = "#4f5b64"; // painted slate chest (#8996a0), darker edges

    // shadows: on the wall behind and on the floor beneath
    g.fillStyle = "rgba(90, 50, 25, 0.16)";
    roundRect(g, x + w * 0.02, y - h * 0.02, w, Math.min(room.floorY, bottom) - y + h * 0.02, w * 0.02);
    g.fill();
    const fs = g.createRadialGradient(x + w / 2, bottom, w * 0.1, x + w / 2, bottom, w * 0.75);
    fs.addColorStop(0, "rgba(50, 25, 10, 0.4)");
    fs.addColorStop(1, "rgba(50, 25, 10, 0)");
    g.save();
    g.translate(x + w / 2, bottom);
    g.scale(1, 0.12);
    g.translate(-(x + w / 2), -bottom);
    g.fillStyle = fs;
    g.fillRect(x - w * 0.3, bottom - w * 0.75, w * 1.6, w * 1.5);
    g.restore();

    g.lineJoin = "round";
    g.lineWidth = lw;
    g.strokeStyle = line;

    // bracket feet
    const fh = c.feet, fw = w * 0.11;
    for (const left of [true, false]) {
      const fx = left ? x + w * 0.015 : x + w - fw - w * 0.015;
      g.fillStyle = "#6f7c86";
      g.beginPath();
      g.moveTo(fx, bottom - fh);
      g.lineTo(fx + fw, bottom - fh);
      if (left) {
        g.lineTo(fx + fw, bottom - fh * 0.55);
        g.quadraticCurveTo(fx + fw * 0.35, bottom - fh * 0.45, fx + fw * 0.25, bottom);
        g.lineTo(fx, bottom);
      } else {
        g.lineTo(fx + fw, bottom);
        g.lineTo(fx + fw * 0.75, bottom);
        g.quadraticCurveTo(fx + fw * 0.65, bottom - fh * 0.45, fx, bottom - fh * 0.55);
      }
      g.closePath();
      g.fill();
      g.stroke();
    }
    // plinth
    const py = bottom - fh - c.plinth;
    g.fillStyle = "#77848e";
    g.fillRect(x, py, w, c.plinth);
    g.strokeRect(x, py, w, c.plinth);
    g.fillStyle = "rgba(255, 255, 255, 0.18)";
    g.fillRect(x, py, w, c.plinth * 0.25);

    // carcass
    const cy = y + c.top;
    const body = g.createLinearGradient(x, 0, x + w, 0);
    body.addColorStop(0, "#7f8c96");
    body.addColorStop(0.5, "#8b98a2");
    body.addColorStop(1, "#7c8993");
    g.fillStyle = body;
    g.fillRect(x + w * 0.012, cy, w * 0.976, py - cy);
    g.strokeRect(x + w * 0.012, cy, w * 0.976, py - cy);
    // reeded side pilasters
    g.strokeStyle = "rgba(60, 72, 82, 0.35)";
    g.lineWidth = lw * 0.6;
    for (const sx of [x + w * 0.012, x + w - c.side]) {
      for (let k = 1; k <= 2; k++) {
        const lx = sx + ((c.side - w * 0.012) * k) / 3;
        g.beginPath();
        g.moveTo(lx, cy + h * 0.03);
        g.lineTo(lx, py - h * 0.02);
        g.stroke();
      }
    }

    for (let i = 0; i < c.drawers.length; i++) drawer(g, c.drawers[i], i, lw);

    // top: overhanging board with a moulded front edge
    const tx = x - c.over, tw = w + c.over * 2;
    g.lineWidth = lw;
    g.strokeStyle = line;
    g.fillStyle = "#a3aeb7";
    roundRect(g, tx, y - c.top * 0.35, tw, c.top * 0.55, c.top * 0.2);
    g.fill();
    g.stroke();
    const edge = g.createLinearGradient(0, y, 0, y + c.top);
    edge.addColorStop(0, "#8794a0");
    edge.addColorStop(0.5, "#76838d");
    edge.addColorStop(1, "#65727c");
    g.fillStyle = edge;
    roundRect(g, tx, y + c.top * 0.15, tw, c.top * 0.85, c.top * 0.3);
    g.fill();
    g.stroke();
    g.strokeStyle = "rgba(255, 255, 255, 0.35)";
    g.lineWidth = lw * 0.7;
    g.beginPath();
    g.moveTo(tx + c.top * 0.3, y + c.top * 0.38);
    g.lineTo(tx + tw - c.top * 0.3, y + c.top * 0.38);
    g.stroke();
  }

  function drawer(g, d, i, lw) {
    const rand = rng(101 + i * 17);
    // dark gap around the drawer
    g.fillStyle = "#47525b";
    roundRect(g, d.x - lw, d.y - lw, d.w + lw * 2, d.h + lw * 2, lw * 2);
    g.fill();
    // face
    const face = g.createLinearGradient(d.x, d.y, d.x, d.y + d.h);
    face.addColorStop(0, "#98a5af");
    face.addColorStop(1, "#8a97a1");
    g.fillStyle = face;
    roundRect(g, d.x, d.y, d.w, d.h, lw * 1.5);
    g.fill();
    // wood grain, faint under the paint
    g.save();
    g.beginPath();
    g.rect(d.x, d.y, d.w, d.h);
    g.clip();
    g.strokeStyle = "rgba(55, 66, 76, 0.1)";
    g.lineWidth = Math.max(0.8, lw * 0.5);
    const lines = 6, segs = 4;
    for (let k = 0; k < lines; k++) {
      const yy = d.y + (d.h * (k + 0.5)) / lines + (rand() - 0.5) * d.h * 0.08;
      g.beginPath();
      g.moveTo(d.x, yy);
      for (let s = 1; s <= segs; s++) {
        const xx = d.x + (d.w * s) / segs;
        g.quadraticCurveTo(xx - d.w / segs / 2, yy + (rand() - 0.5) * d.h * 0.16, xx, yy + (rand() - 0.5) * d.h * 0.05);
      }
      g.stroke();
    }
    g.beginPath();
    g.ellipse(d.x + d.w * (0.2 + rand() * 0.6), d.y + d.h * (0.3 + rand() * 0.4), d.w * 0.03, d.h * 0.08, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    // bevel: light top/left, shadow bottom/right
    g.lineWidth = Math.max(1, lw * 0.9);
    g.strokeStyle = "rgba(255, 255, 255, 0.45)";
    g.beginPath();
    g.moveTo(d.x + lw, d.y + d.h - lw);
    g.lineTo(d.x + lw, d.y + lw);
    g.lineTo(d.x + d.w - lw, d.y + lw);
    g.stroke();
    g.strokeStyle = "rgba(45, 55, 65, 0.4)";
    g.beginPath();
    g.moveTo(d.x + d.w - lw, d.y + lw);
    g.lineTo(d.x + d.w - lw, d.y + d.h - lw);
    g.lineTo(d.x + lw, d.y + d.h - lw);
    g.stroke();
    // moulded inner panel
    g.strokeStyle = "rgba(55, 66, 76, 0.28)";
    g.lineWidth = Math.max(0.8, lw * 0.5);
    roundRect(g, d.x + d.w * 0.025, d.y + d.h * 0.12, d.w * 0.95, d.h * 0.76, lw * 2);
    g.stroke();
  }

  // Brass knobs, drawn after the painted balloons so they sit on top.
  function knobs(g) {
    const c = room.chest;
    const kr = Math.max(3, c.h * 0.03);
    for (const d of c.drawers) {
      const ky = d.y + d.h / 2;
      const kxs = d.knobs === 1 ? [d.x + d.w / 2] : [d.x + d.w * 0.25, d.x + d.w * 0.75];
      for (const kx of kxs) {
        g.fillStyle = "rgba(60, 30, 10, 0.35)";
        g.beginPath();
        g.ellipse(kx + kr * 0.25, ky + kr * 0.4, kr * 1.05, kr * 0.95, 0, 0, Math.PI * 2);
        g.fill();
        const br = g.createRadialGradient(kx - kr * 0.35, ky - kr * 0.35, kr * 0.1, kx, ky, kr);
        br.addColorStop(0, "#fff1b8");
        br.addColorStop(0.45, "#e2b04c");
        br.addColorStop(1, "#946326");
        g.fillStyle = br;
        g.beginPath();
        g.arc(kx, ky, kr, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  // A framed photo and a pot plant on top of the chest.
  function paintChestTop(g) {
    const c = room.chest;
    const topY = c.y - c.top * 0.3;
    const u = c.h;
    // frame
    // Sop and Bop's photo in a brass frame, kept to the end of the chest so
    // the window stays clear
    const fw = u * 0.3, fh = u * 0.38;
    const fx = c.x + c.w * 0.03, fy = topY - fh;
    g.save();
    g.translate(fx + fw / 2, topY);
    g.rotate(-0.04);
    g.translate(-(fx + fw / 2), -topY);
    g.fillStyle = "rgba(40, 30, 20, 0.25)";
    g.fillRect(fx + fw * 0.07, fy + fh * 0.05, fw, fh);
    const brass = g.createLinearGradient(fx, fy, fx + fw, fy + fh);
    brass.addColorStop(0, "#e2c06a");
    brass.addColorStop(0.5, "#c49a3c");
    brass.addColorStop(1, "#a37d2c");
    g.fillStyle = brass;
    g.fillRect(fx, fy, fw, fh);
    g.strokeStyle = "rgba(90, 60, 15, 0.5)";
    g.lineWidth = Math.max(1, fw * 0.015);
    g.strokeRect(fx + fw * 0.06, fy + fh * 0.05, fw * 0.88, fh * 0.9);
    g.fillStyle = "#fffaf0";
    g.fillRect(fx + fw * 0.08, fy + fh * 0.065, fw * 0.84, fh * 0.87);
    const px0 = fx + fw * 0.13, py0 = fy + fh * 0.1, pw0 = fw * 0.74, ph0 = fh * 0.8;
    if (couple.complete && couple.naturalWidth) {
      // cover-fit the photo into the mount
      const k = Math.max(pw0 / couple.naturalWidth, ph0 / couple.naturalHeight);
      const sw = pw0 / k, sh = ph0 / k;
      g.drawImage(couple, (couple.naturalWidth - sw) / 2, (couple.naturalHeight - sh) * 0.3, sw, sh, px0, py0, pw0, ph0);
    } else {
      g.fillStyle = "#cfe6f3";
      g.fillRect(px0, py0, pw0, ph0);
    }
    // a little glare on the glass
    g.fillStyle = "rgba(255, 255, 255, 0.16)";
    g.beginPath();
    g.moveTo(px0, py0 + ph0 * 0.55);
    g.lineTo(px0 + pw0 * 0.55, py0);
    g.lineTo(px0 + pw0 * 0.8, py0);
    g.lineTo(px0, py0 + ph0 * 0.85);
    g.closePath();
    g.fill();
    g.restore();

    // pot plant
    const px = c.x + c.w * 0.89, ph = u * 0.15, pw = u * 0.15;
    const leaves = rng(42);
    for (let i = 0; i < 9; i++) {
      const a = (i - 4) * 0.32 + (leaves() - 0.5) * 0.2;
      const len = u * (0.15 + leaves() * 0.1);
      g.save();
      g.translate(px, topY - ph * 0.9);
      g.rotate(a);
      g.fillStyle = i % 2 ? "#4f9a5c" : "#68b46f";
      g.beginPath();
      g.ellipse(0, -len / 2, len * 0.16, len / 2, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.fillStyle = "#c8693f";
    g.beginPath();
    g.moveTo(px - pw / 2, topY - ph);
    g.lineTo(px + pw / 2, topY - ph);
    g.lineTo(px + pw * 0.38, topY);
    g.lineTo(px - pw * 0.38, topY);
    g.closePath();
    g.fill();
    g.fillStyle = "#b25a33";
    g.fillRect(px - pw * 0.55, topY - ph, pw * 1.1, ph * 0.22);
  }

  // Balloons painted on the drawers (and the faint marks they leave behind).
  function paintStickers(g, t) {
    if (phase === "waiting") paintPlaceholders(g);
    if (intro) {
      const now = t / 1000;
      for (const b of balloons) {
        if (b.slot == null) continue;
        const s = intro.slots[b.slot];
        if (!s) continue;
        const [w, h] = fit(b.img, s.size);
        g.save();
        g.translate(s.x, s.y);
        g.rotate(b.tilt || 0);
        // still painted on, or a ghost of the painting once it has flown
        g.globalAlpha = now < b.launchAt ? 0.97 : 0.22;
        g.drawImage(b.img, -w / 2, -h / 2, w, h);
        g.restore();
      }
    }
    knobs(g);
  }

  // Before launch: simple painted balloons, one per guest so far.
  function paintPlaceholders(g) {
    const n = Math.min(waitingCount, 40);
    if (!n) return;
    const slots = computeSlots(n);
    const colours = ["#ef4f6b", "#ffc234", "#2f97d6", "#4fb873", "#8b5cf6", "#ff8fb8", "#ff7a3d"];
    g.save();
    for (let i = 0; i < n; i++) {
      const s = slots[i];
      const rr = s.size * 0.3;
      g.fillStyle = colours[i % colours.length];
      g.strokeStyle = "#3a2a1e";
      g.lineWidth = Math.max(1, rr * 0.1);
      g.beginPath();
      g.ellipse(s.x, s.y - rr * 0.35, rr * 0.82, rr, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(s.x - rr * 0.35, s.y + rr * 0.55);
      g.lineTo(s.x - rr * 0.22, s.y + rr * 0.95);
      g.moveTo(s.x + rr * 0.35, s.y + rr * 0.55);
      g.lineTo(s.x + rr * 0.22, s.y + rr * 0.95);
      g.stroke();
      g.fillStyle = "#8a5a2b";
      g.fillRect(s.x - rr * 0.27, s.y + rr * 0.95, rr * 0.54, rr * 0.4);
    }
    g.restore();
  }

  // ---------- camera ----------

  // Room: screen = S + (p - open centre) * zr.  World: screen = S + (p - A) * ze.
  function camera(t) {
    const r = room;
    const centre = { x: W / 2, y: H / 2 };
    if (phase === "parade") return { room: false, zr: 1, S: centre, ze: 1, A: centre, p: 1 };
    const at = { x: r.open.cx, y: r.open.cy };
    // Through the window you see a small, wide view of the landscape.
    const A0 = { x: W / 2, y: H * 0.7 };
    let p = 0;
    if (intro && t / 1000 > intro.pushStart) p = clamp01((t / 1000 - intro.pushStart) / T.push);
    const e = easeInOut(p);
    const zEnd = Math.max(W / r.open.w, H / r.open.h) * 1.35;
    return {
      room: true,
      p: e,
      // the room rushes past; its zoom lags a touch so the world stays ahead
      zr: Math.exp(Math.log(zEnd) * Math.pow(e, 1.5)),
      S: { x: lerp(at.x, centre.x, e), y: lerp(at.y, centre.y, e) },
      ze: lerp(OUT_SCALE, 1, e),
      A: { x: lerp(A0.x, centre.x, e), y: lerp(A0.y, centre.y, e) },
    };
  }
  const toWorld = (cam, x, y) => ({ x: cam.A.x + (x - cam.S.x) / cam.ze, y: cam.A.y + (y - cam.S.y) / cam.ze });

  // ---------- balloons ----------

  function size(b) {
    const crowd = Math.max(0.5, Math.min(1, Math.sqrt(30 / Math.max(1, balloons.length)))) * (W < 600 ? 0.72 : 1);
    const d = DEPTHS[b.depth];
    const target = Math.min(H * 0.3, W * 0.42) * d.scale * crowd;
    const ratio = b.img.naturalWidth / b.img.naturalHeight || 0.7;
    b.h = target;
    b.w = target * ratio;
    if (b.w > W * 0.4 * d.scale) { b.w = W * 0.4 * d.scale; b.h = b.w / ratio; }
  }

  function addBalloon(row) {
    if (known.has(row.id)) return;
    known.add(row.id);
    loadingImages++;
    const img = new Image();
    img.decoding = "async";
    const done = () => {
      loadingImages--;
      maybeStartIntro();
    };
    img.onerror = done;
    img.onload = () => {
      const counts = [0, 0, 0];
      for (const b of balloons) counts[b.depth]++;
      const depth = counts[2] * 1.3 < Math.min(counts[0], counts[1]) ? 2 : counts[0] <= counts[1] ? 0 : 1;
      const b = {
        row, img, depth, art: hazed(img, DEPTHS[depth].haze),
        x: Math.random(), y: 1.05 + Math.random() * 0.4,
        phase: Math.random() * Math.PI * 2,
        swayRate: 0.25 + Math.random() * 0.2,
        speedJitter: 0.85 + Math.random() * 0.3,
        sx: -1e4, sy: -1e4, dw: 0, dh: 0,
        // balloons approved once the parade is on rise up from below
        state: phase === "parade" ? "fly" : "wait",
      };
      balloons.push(b);
      balloons.sort((a, c) => a.depth - c.depth);
      for (const x of balloons) size(x);
      if (phase === "parade" && reduced.matches) layoutStatic();
      done();
    };
    img.src = ParadeApi.imageUrl(row.image_path);
  }

  // Start once every image has loaded (or after a few seconds regardless).
  function maybeStartIntro() {
    if (phase === "intro" || phase === "parade") return;
    if (!balloons.length) return;
    if (loadingImages > 0) {
      if (!introTimer) introTimer = setTimeout(() => { introTimer = 0; loadingImages = 0; maybeStartIntro(); }, 6000);
      return;
    }
    clearTimeout(introTimer);
    introTimer = 0;
    if (reduced.matches) goParade(true);
    else startIntro();
  }

  function startIntro() {
    phase = "intro";
    showChrome();
    const list = balloons.slice().sort(() => Math.random() - 0.5);
    const n = list.length;
    const t0 = performance.now() / 1000 + 0.3;
    const launch0 = t0 + T.establish + T.open + 0.2;
    const stagger = Math.max(0.12, Math.min(0.5, 4.5 / n));
    intro = { t0, n, slots: computeSlots(n) };
    intro.lastArrive = launch0 + (n - 1) * stagger + T.peel + T.room;
    intro.pushStart = intro.lastArrive + 0.3;
    intro.end = intro.pushStart + T.push;
    const r = room.open;
    list.forEach((b, i) => {
      b.state = "stuck";
      b.slot = i;
      b.tilt = (Math.random() - 0.5) * 0.35;
      b.launchAt = launch0 + i * stagger;
      // where it leaves through the open sash (room coordinates)
      b.exit = { x: r.x + r.w * (0.22 + Math.random() * 0.56), y: r.y + r.h * (0.35 + Math.random() * 0.3) };
      b.bend = (Math.random() - 0.5) * room.chest.w * 0.5;
      // spread out across the middle of the sky, so they are all in view (with
      // room to rise) when the camera arrives at the wide landscape
      b.target = {
        x: W * (0.1 + ((i * 0.618034 + Math.random() * 0.15) % 1) * 0.8),
        y: H * (0.3 + ((i * 0.381966 + Math.random() * 0.15) % 1) * 0.42),
      };
    });
  }

  function goParade(instant) {
    phase = "parade";
    intro = null;
    for (const b of balloons) {
      if (b.state !== "fly" && b.state !== "out") {
        b.state = "fly";
        b.x = Math.random();
        b.y = instant ? Math.random() * 0.8 : 1.05 + Math.random() * 0.4;
      }
      b.slot = null;
    }
    if (reduced.matches) layoutStatic();
    showChrome();
  }

  // Reduced motion: lay balloons out in a calm, fixed arrangement.
  function layoutStatic() {
    balloons.forEach((b, i) => {
      b.state = "fly";
      b.x = ((i * 0.618034) % 1) * 0.9 + 0.05;
      b.y = 0.1 + ((i * 0.381966 + b.depth * 0.13) % 1) * 0.65;
    });
  }

  function step(dt, t) {
    const now = t / 1000;
    if (phase === "intro" && now >= intro.end) goParade(false);
    for (const b of balloons) {
      if (b.state === "stuck" && now >= b.launchAt) b.state = "peel";
      if (b.state === "peel" && now >= b.launchAt + T.peel) b.state = "room";
      if (b.state === "room" && now >= b.launchAt + T.peel + T.room) toOutside(b, t);
      if (b.state === "out" && now >= b.outAt + T.out) {
        // hand over to the normal drift exactly where it is
        b.state = "fly";
        b.x = (b.target.x - b.w / 2) / Math.max(1, W - b.w);
        b.y = (b.target.y - b.h / 2) / H;
      }
      if (b.state !== "fly") continue;
      const d = DEPTHS[b.depth];
      b.y -= d.speed * b.speedJitter * dt;
      if (b.y * H + b.h < -10) {
        // come straight back in from the bottom
        b.y = 1 + Math.random() * 0.08 + 10 / H;
        b.x = Math.random();
      }
    }
  }

  // The balloon has gone through the window: from now on it lives outside.
  function toOutside(b, t) {
    const cam = camera(t);
    const p = toWorld(cam, b.sx, b.sy);
    b.state = "out";
    b.outAt = t / 1000;
    b.from = { x: p.x, y: p.y, w: b.dw / cam.ze, h: b.dh / cam.ze };
  }

  // ---------- drawing ----------

  function draw(t) {
    if (!room) return;
    const cam = camera(t);

    // the world outside
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(cam.S.x, cam.S.y);
    ctx.scale(cam.ze, cam.ze);
    ctx.translate(-cam.A.x, -cam.A.y);
    if (cam.room) {
      // fill around the world while it is smaller than the screen
      ctx.fillStyle = "#7cc4ee";
      ctx.fillRect(-W * 2, -H * 2, W * 5, H * 2.5);
      ctx.fillStyle = "#7fb98f";
      ctx.fillRect(-W * 2, H * 0.8, W * 5, H * 2.2);
    }
    ctx.drawImage(bg, 0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (const c of clouds) {
      if (!reduced.matches) c.x += c.v * 0.016;
      if (c.x > 1.2) c.x = -0.2;
      cloud(ctx, c.x * W, c.y * H, c.s * Math.max(0.7, W / 1400));
    }
    let hillsDrawn = false;
    for (const b of balloons) {
      if (b.state !== "fly" && b.state !== "out") continue;
      if (b.depth > 0 && !hillsDrawn) {
        ctx.drawImage(hills, 0, 0, W, H);
        hillsDrawn = true;
      }
      if (b.state === "fly") drawFlying(b, t, cam);
      else drawOut(b, t, cam);
    }
    if (!hillsDrawn) ctx.drawImage(hills, 0, 0, W, H);

    // the room, and balloons floating across it
    if (cam.room) {
      renderRoom(cam, t);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(roomLayer, 0, 0);
      ctx.setTransform(dpr * cam.zr, 0, 0, dpr * cam.zr, dpr * (cam.S.x - room.open.cx * cam.zr), dpr * (cam.S.y - room.open.cy * cam.zr));
      for (const b of balloons) if (b.state === "peel" || b.state === "room") drawInRoom(b, t, cam);
      // soft vignette, fading as we go through the window
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      v.addColorStop(0, "rgba(60, 30, 10, 0)");
      v.addColorStop(1, "rgba(60, 30, 10, " + (0.28 * (1 - cam.p)).toFixed(3) + ")");
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // Screen position bookkeeping for tapping, given world coordinates.
  function track(b, cam, x, y, w, h) {
    b.sx = cam.S.x + (x - cam.A.x) * cam.ze;
    b.sy = cam.S.y + (y - cam.A.y) * cam.ze;
    b.dw = w * cam.ze;
    b.dh = h * cam.ze;
  }

  function drawFlying(b, t, cam) {
    const d = DEPTHS[b.depth];
    const still = reduced.matches;
    const sway = still ? 0 : Math.sin(t / 1000 * b.swayRate + b.phase) * d.sway;
    const tilt = still ? 0 : Math.cos(t / 1000 * b.swayRate + b.phase) * 0.035;
    const cx = b.x * (W - b.w) + b.w / 2 + sway;
    const cy = b.y * H + b.h / 2;
    track(b, cam, cx, cy, b.w, b.h);
    const lit = (spot && spot.b === b) || selected === b;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    if (lit) {
      const r = Math.max(b.w, b.h) * 0.75;
      const glow = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
      glow.addColorStop(0, "rgba(255,250,210,0.9)");
      glow.addColorStop(1, "rgba(255,250,210,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.scale(1.08, 1.08);
    }
    ctx.drawImage(b.art, -b.w / 2, -b.h / 2, b.w, b.h);
    ctx.restore();
  }

  // From the window out to its place in the sky, growing as it comes.
  function drawOut(b, t, cam) {
    const p = easeOut(clamp01((t / 1000 - b.outAt) / T.out));
    const f = b.from, to = b.target;
    const cx = lerp(f.x, to.x, 0.25), cy = Math.min(f.y, to.y) - H * 0.12;
    const x = (1 - p) * (1 - p) * f.x + 2 * (1 - p) * p * cx + p * p * to.x;
    const y = (1 - p) * (1 - p) * f.y + 2 * (1 - p) * p * cy + p * p * to.y;
    const w = lerp(f.w, b.w, p), h = lerp(f.h, b.h, p);
    const d = DEPTHS[b.depth];
    const sx = x + Math.sin(t / 1000 * b.swayRate + b.phase) * d.sway * p;
    track(b, cam, sx, y, w, h);
    ctx.save();
    ctx.translate(sx, y);
    ctx.rotate(Math.cos(t / 1000 * b.swayRate + b.phase) * 0.035 * p);
    ctx.drawImage(p > 0.5 ? b.art : b.img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  // Peel off the drawer, then float up and out through the open sash.
  function drawInRoom(b, t, cam) {
    const now = t / 1000, age = now - b.launchAt;
    const s = intro.slots[b.slot];
    const [sw, sh] = fit(b.img, s.size);
    let x, y, w, h, rot, squash = 1;
    if (age < T.peel) {
      const p = clamp01(age / T.peel);
      const lift = Math.sin((p * Math.PI) / 2);
      x = s.x;
      y = s.y - lift * s.size * 0.5;
      w = sw * (1 + 0.35 * lift);
      h = sh * (1 + 0.35 * lift);
      rot = b.tilt * (1 - p) + Math.sin(p * Math.PI * 3) * 0.12;
      squash = 0.5 + 0.5 * Math.abs(Math.cos(p * Math.PI)); // peeling away from the wood
    } else {
      const p = easeInOut(clamp01((age - T.peel) / T.room));
      const x0 = s.x, y0 = s.y - s.size * 0.5;
      const x1 = b.exit.x, y1 = b.exit.y;
      const cx = lerp(x0, x1, 0.5) + b.bend, cy = lerp(y0, y1, 0.55);
      x = (1 - p) * (1 - p) * x0 + 2 * (1 - p) * p * cx + p * p * x1;
      y = (1 - p) * (1 - p) * y0 + 2 * (1 - p) * p * cy + p * p * y1;
      // grows as it floats towards us, then shrinks into the distance
      const end = Math.min(room.open.h * 0.42, s.size * 0.9) / s.size;
      const big = 1.6;
      const k = p < 0.4 ? lerp(1.35, big, p / 0.4) : lerp(big, end, (p - 0.4) / 0.6);
      w = sw * k;
      h = sh * k;
      rot = Math.sin(p * Math.PI * 2 + b.phase) * 0.08;
    }
    b.sx = cam.S.x + (x - room.open.cx) * cam.zr;
    b.sy = cam.S.y + (y - room.open.cy) * cam.zr;
    b.dw = w * cam.zr;
    b.dh = h * cam.zr;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(squash, 1);
    ctx.shadowColor = "rgba(60, 30, 10, 0.25)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 6;
    ctx.drawImage(b.img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  // Far balloons get a wash of sky colour, like distance haze.
  function hazed(img, haze) {
    if (!haze) return img;
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = "rgba(190, 228, 250, " + haze + ")";
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!reduced.matches) step(dt, now);
    draw(now);
    idle(now);
    requestAnimationFrame(loop);
  }

  // ---------- page chrome ----------

  let chromeShown = false;
  function showChrome() {
    $("waiting").hidden = true;
    // the title waits until we are outside, clear of the window and bunting
    $("parade-title").hidden = phase !== "parade";
    $("fullscreen").hidden = !document.fullscreenEnabled;
    $("replay").hidden = phase !== "parade" || reduced.matches;
    if (chromeShown || phase !== "parade") return;
    chromeShown = true;
    const hint = $("parade-hint");
    hint.hidden = false;
    setTimeout(() => hint.classList.add("gone"), 12000);
    setTimeout(() => $("parade-title").classList.add("faded"), 20000);
    keepAwake();
  }

  // Keep a TV or laptop screen from sleeping during the reception.
  let wakeLock = null;
  async function keepAwake() {
    try {
      if ("wakeLock" in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => (wakeLock = null));
      }
    } catch (e) {}
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && phase === "parade") keepAwake();
  });
  $("fullscreen").addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (err) {}
  });
  document.addEventListener("fullscreenchange", () => {
    $("fullscreen").textContent = document.fullscreenElement ? "Exit full screen" : "Full screen";
  });
  $("replay").addEventListener("click", (e) => {
    e.stopPropagation();
    hideCard();
    spot = null;
    $("replay").hidden = true;
    startIntro();
  });

  // ---------- notes ----------

  function showCard(b, asSpotlight) {
    const card = $("note-card");
    $("note-img").src = b.img.src;
    $("note-img").alt = "Balloon by " + b.row.name;
    $("note-name").textContent = b.row.name;
    $("note-text").textContent = b.row.note || "";
    $("note-text").hidden = !b.row.note;
    card.classList.toggle("spotlight", !!asSpotlight);
    card.hidden = false;
    card.style.animation = "none";
    void card.offsetWidth;
    card.style.animation = "";
  }
  function hideCard() {
    $("note-card").hidden = true;
    selected = null;
  }
  $("note-close").addEventListener("click", (e) => {
    e.stopPropagation();
    hideCard();
    lastInput = performance.now();
  });

  canvas.addEventListener("click", (e) => {
    lastInput = performance.now();
    spot = null;
    const x = e.clientX, y = e.clientY;
    // nearest-first hit test on the balloon's box (slightly inset)
    const order = balloons.filter((b) => b.state === "fly" || b.state === "out" || b.state === "room");
    for (let i = order.length - 1; i >= 0; i--) {
      const b = order[i];
      if (!b.dw) continue;
      if (Math.abs(x - b.sx) < b.dw * 0.45 && Math.abs(y - b.sy) < b.dh * 0.47) {
        selected = b;
        showCard(b, false);
        return;
      }
    }
    hideCard();
  });

  function idle(now) {
    if (spot && now > spot.until) {
      spot = null;
      if (!selected) $("note-card").hidden = true;
    }
    if (phase !== "parade" || selected || spot || !balloons.length) return;
    if (now - lastInput < IDLE_AFTER) return;
    if (now - (idle.lastSpot || 0) < SPOT_EVERY) return;
    // prefer balloons with notes that are comfortably on screen
    const onScreen = balloons.filter((b) => b.state === "fly" && b.sy > b.dh * 0.6 && b.sy < H * 0.62);
    const pool = onScreen.filter((b) => b.row.note).length ? onScreen.filter((b) => b.row.note) : onScreen;
    if (!pool.length) return;
    const b = pool[Math.floor(Math.random() * pool.length)];
    idle.lastSpot = now;
    spot = { b, until: now + SPOT_FOR };
    showCard(b, true);
  }

  // ---------- data ----------

  async function refresh() {
    try {
      const rows = await ParadeApi.approvedBalloons();
      if (rows.length) {
        rows.filter((r) => !known.has(r.id)).forEach(addBalloon);
        const n = rows.length;
        $("parade-count").textContent = n === 1 ? "1 balloon" : n + " balloons";
        return;
      }
      if (phase === "loading" || phase === "waiting") {
        phase = "waiting";
        $("waiting").hidden = false;
        $("parade-title").hidden = true;
        const n = await ParadeApi.balloonCount().catch(() => null);
        waitingCount = n || 0;
        $("waiting-count").textContent =
          n === null ? "" : n === 0 ? "Be the first to make a balloon!" : n === 1 ? "1 balloon is waiting on the drawers" : n + " balloons are waiting on the drawers";
      }
    } catch (err) {
      console.error(err);
      if (phase === "loading") {
        phase = "waiting";
        $("waiting").hidden = false;
        $("parade-title").hidden = true;
      }
    }
  }

  $("launch-date").textContent = cfg.launchDateText;
  addEventListener("resize", resize);
  reduced.addEventListener("change", () => {
    if (reduced.matches && phase === "intro") goParade(true);
    else if (reduced.matches) layoutStatic();
  });
  resize();
  requestAnimationFrame(loop);
  refresh();
  // pick up newly approved balloons during the day
  setInterval(refresh, 30000);
})();
