// The parade: approved balloons drift up a canvas sky at three depths.
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

  let W = 0, H = 0, dpr = 1;
  let bg = null, hills = null;
  let balloons = [];
  const known = new Set();
  let clouds = [];
  let last = performance.now();
  let lastInput = performance.now();
  let spot = null; // { b, until }
  let selected = null;
  let running = false;
  let started = false; // animation loop running
  let nearHill = null; // x -> y of the front hill line
  let chest = null; // geometry of the chest of drawers
  let waitingCount = 0; // shown as painted balloons on the waiting screen
  // Sticker slots on the drawers; balloons peel off them and fly away.
  const slots = { capacity: 0, free: [] };
  let introStart = 0, introIndex = 0;
  const STAGGER_MAX = 0.55; // seconds between launches
  const PEEL = 0.9, RISE = 5.5; // seconds

  // ---------- scenery ----------

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    bg = paintSky();
    hills = paintHills();
    chest = layoutChest();
    paintChest(hills.getContext("2d"));
    if (!clouds.length) {
      for (let i = 0; i < 6; i++) clouds.push({ x: Math.random(), y: 0.05 + Math.random() * 0.5, s: 0.5 + Math.random() * 0.8, v: 0.004 + Math.random() * 0.006 });
    }
    for (const b of balloons) size(b);
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

    // portrait screens: gorge to the left, leaving room for the chest
    const gorgeL = W * (W > H ? 0.36 : 0.06), gorgeR = W * (W > H ? 0.64 : 0.5);
    const near = (x) => {
      const h = 0.12 + 0.03 * Math.sin(x / W * 7 + 2);
      let dip = 0;
      if (x > gorgeL && x < gorgeR) dip = Math.sin(((x - gorgeL) / (gorgeR - gorgeL)) * Math.PI) * 0.09;
      return base - H * Math.max(0.02, h - dip);
    };
    nearHill = near;
    // bridge
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

  // The chest of drawers that every visitor paints a balloon on, standing
  // on the hill. Balloons start as little paintings on its drawers.
  function layoutChest() {
    const wide = W > H;
    const w = Math.min(W * (wide ? 0.25 : 0.42), H * 0.36);
    const h = w * 0.82;
    const cx = W * (wide ? 0.82 : 0.76);
    const bottom = nearHill(cx) + H * 0.02;
    const x = cx - w / 2, y = bottom - h;
    const top = h * 0.1, legs = h * 0.08;
    const drawers = [];
    const inner = { x: x + w * 0.07, y: y + top + h * 0.05, w: w * 0.86, h: h - top - legs - h * 0.09 };
    const gap = inner.h * 0.05, dh = (inner.h - gap * 2) / 3;
    for (let i = 0; i < 3; i++) drawers.push({ x: inner.x, y: inner.y + i * (dh + gap), w: inner.w, h: dh });
    return { x, y, w, h, top, legs, drawers };
  }

  function paintChest(g) {
    const { x, y, w, h, top, legs, drawers } = chest;
    const lw = Math.max(2, w * 0.018);
    g.save();
    g.lineWidth = lw;
    g.lineJoin = "round";
    g.strokeStyle = "#7a4a22";
    // shadow on the grass
    g.fillStyle = "rgba(40, 80, 50, 0.25)";
    g.beginPath();
    g.ellipse(x + w / 2, y + h, w * 0.6, h * 0.06, 0, 0, Math.PI * 2);
    g.fill();
    // legs
    g.fillStyle = "#7a4a22";
    g.fillRect(x + w * 0.08, y + h - legs, w * 0.08, legs);
    g.fillRect(x + w * 0.84, y + h - legs, w * 0.08, legs);
    // body and top
    g.fillStyle = "#e9b97a";
    roundRect(g, x + w * 0.03, y + top * 0.6, w * 0.94, h - legs - top * 0.6, w * 0.03);
    g.fill();
    g.stroke();
    g.fillStyle = "#d79e5b";
    roundRect(g, x - w * 0.02, y, w * 1.04, top, w * 0.025);
    g.fill();
    g.stroke();
    // drawers and knobs
    for (const d of drawers) {
      g.fillStyle = "#f6dcb2";
      roundRect(g, d.x, d.y, d.w, d.h, w * 0.02);
      g.fill();
      g.lineWidth = lw * 0.8;
      g.stroke();
      g.fillStyle = "#7a4a22";
      g.beginPath();
      g.arc(d.x + d.w / 2, d.y + d.h * 0.86, Math.max(2, w * 0.016), 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // Where sticker slot i sits on the drawers, and how big it can be.
  function slotBox(i) {
    const per = Math.ceil(slots.capacity / 3);
    const d = chest.drawers[Math.min(2, Math.floor(i / per))];
    const col = i % per;
    const cell = (d.w * 0.92) / per;
    return {
      x: d.x + d.w * 0.04 + cell * (col + 0.5),
      y: d.y + d.h * 0.42,
      size: Math.min(cell * 0.9, d.h * 0.7),
    };
  }

  // Make room on the drawers for n more balloons. The grid is only resized
  // while nothing is stuck to it, so stickers never jump about.
  function reserveSlots(n) {
    if (slots.free.length >= n) return;
    const busy = balloons.some((b) => b.state !== "fly");
    const cap = busy ? slots.capacity + n : Math.max(9, Math.ceil(n / 3) * 3);
    const used = new Set(balloons.filter((b) => b.state !== "fly").map((b) => b.slot));
    slots.capacity = cap;
    slots.free = [];
    for (let i = cap - 1; i >= 0; i--) if (!used.has(i)) slots.free.push(i);
  }

  function takeSlot() {
    if (!slots.free.length) reserveSlots(1);
    slots.free.sort((a, b) => b - a);
    return slots.free.pop();
  }

  // Simple painted balloons for the waiting screen, one per guest so far.
  function drawWaitingStickers() {
    if (!waitingCount || running) return;
    const colours = ["#ef4f6b", "#ffc234", "#2f97d6", "#4fb873", "#8b5cf6", "#ff8fb8", "#ff7a3d"];
    const n = Math.min(waitingCount, 36);
    const saveCap = slots.capacity;
    slots.capacity = Math.max(9, Math.ceil(n / 3) * 3);
    for (let i = 0; i < n; i++) {
      const s = slotBox(i);
      const r = s.size * 0.32;
      ctx.fillStyle = colours[i % colours.length];
      ctx.strokeStyle = "#3a2a1e";
      ctx.lineWidth = Math.max(1, r * 0.12);
      ctx.beginPath();
      ctx.ellipse(s.x, s.y - r * 0.3, r * 0.85, r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#8a5a2b";
      ctx.fillRect(s.x - r * 0.25, s.y + r * 0.85, r * 0.5, r * 0.4);
    }
    slots.capacity = saveCap;
  }

  function cloud(x, y, s) {
    ctx.beginPath();
    ctx.ellipse(x, y, 70 * s, 22 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 28 * s, y - 14 * s, 32 * s, 28 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 18 * s, y - 20 * s, 38 * s, 34 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---------- balloons ----------

  function size(b) {
    // fewer, bigger balloons look best; shrink a little for crowds and phones
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
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const counts = [0, 0, 0];
      for (const b of balloons) counts[b.depth]++;
      // keep the depths roughly balanced, near layer slightly smaller
      const depth = counts[2] * 1.3 < Math.min(counts[0], counts[1]) ? 2 : counts[0] <= counts[1] ? 0 : 1;
      const now = performance.now() / 1000;
      const b = {
        row, img, depth, art: hazed(img, DEPTHS[depth].haze),
        x: Math.random(), y: Math.random(),
        phase: Math.random() * Math.PI * 2,
        swayRate: 0.25 + Math.random() * 0.2,
        speedJitter: 0.85 + Math.random() * 0.3,
        sx: 0, sy: 0, dw: 0, dh: 0,
        state: "fly",
      };
      if (!reduced.matches) {
        // Stuck on a drawer until its turn, then peel off and rise.
        b.state = "stuck";
        b.slot = takeSlot();
        b.tilt = (Math.random() - 0.5) * 0.3;
        if (!introStart || now > introStart + 30) { introStart = now + 1.2; introIndex = 0; }
        const stagger = Math.min(STAGGER_MAX, 9 / Math.max(1, pendingRows));
        b.launchAt = Math.max(now + 0.3, introStart + introIndex++ * stagger);
        b.target = {
          x: W * (0.15 + Math.random() * 0.7),
          y: H * (0.08 + Math.random() * 0.6),
        };
      }
      balloons.push(b);
      balloons.sort((a, c) => a.depth - c.depth);
      for (const x of balloons) size(x);
      if (reduced.matches) layoutStatic();
      if (!running) start();
    };
    img.src = ParadeApi.imageUrl(row.image_path);
  }
  let pendingRows = 1;

  // Reduced motion: lay balloons out in a calm, fixed arrangement.
  function layoutStatic() {
    const n = balloons.length;
    balloons.forEach((b, i) => {
      b.x = ((i * 0.618034) % 1) * 0.9 + 0.05;
      b.y = 0.1 + ((i * 0.381966 + b.depth * 0.13) % 1) * 0.65;
    });
    if (n) draw(0);
  }

  function step(dt, t) {
    const now = t / 1000;
    for (const b of balloons) {
      if (b.state === "stuck" && now >= b.launchAt) b.state = "launch";
      if (b.state === "launch" && now >= b.launchAt + PEEL + RISE) {
        // hand over to the normal drift exactly where the rise ended
        b.state = "fly";
        slots.free.push(b.slot);
        b.x = (b.target.x - b.w / 2) / Math.max(1, W - b.w);
        b.y = (b.target.y - b.h / 2) / H;
      }
      if (b.state !== "fly") continue;
      const d = DEPTHS[b.depth];
      b.y -= d.speed * b.speedJitter * dt;
      if (b.y * H + b.h < -10) {
        b.y = 1 + Math.random() * 0.5 + 10 / H;
        b.x = Math.random();
      }
    }
  }

  function draw(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // clouds
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (const c of clouds) {
      if (!reduced.matches) c.x += c.v * 0.016;
      if (c.x > 1.2) c.x = -0.2;
      cloud(c.x * W, c.y * H, c.s * Math.max(0.7, W / 1400));
    }

    let hillsDrawn = false;
    for (const b of balloons) {
      if (b.state !== "fly") continue;
      if (b.depth > 0 && !hillsDrawn) {
        drawHills();
        hillsDrawn = true;
      }
      drawBalloon(b, t);
    }
    if (!hillsDrawn) drawHills();
    drawWaitingStickers();
    for (const b of balloons) if (b.state === "stuck") drawSticker(b);
    for (const b of balloons) if (b.state === "launch") drawLaunch(b, t);
  }

  function fit(b, size) {
    const r = b.img.naturalWidth / b.img.naturalHeight || 0.7;
    return r > 1 ? [size, size / r] : [size * r, size];
  }

  function drawSticker(b) {
    const s = slotBox(b.slot);
    const [w, h] = fit(b, s.size);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(b.tilt);
    ctx.drawImage(b.img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

  // Peel off the drawer (a little lift and flutter), then rise along a curve
  // into the sky, growing to the balloon's parade size.
  function drawLaunch(b, t) {
    const now = t / 1000, age = now - b.launchAt;
    const s = slotBox(b.slot);
    const [sw, sh] = fit(b, s.size);
    let x, y, w, h, rot, flip = 1;
    if (age < PEEL) {
      const p = age / PEEL;
      const lift = Math.sin(p * Math.PI / 2);
      x = s.x;
      y = s.y - lift * s.size * 0.6;
      w = sw * (1 + 0.4 * lift);
      h = sh * (1 + 0.4 * lift);
      rot = b.tilt * (1 - p) + Math.sin(p * Math.PI * 3) * 0.12;
      flip = 0.55 + 0.45 * Math.abs(Math.cos(p * Math.PI)); // peeling squash
    } else {
      const p = ease(Math.min(1, (age - PEEL) / RISE));
      const x0 = s.x, y0 = s.y - s.size * 0.6;
      const x1 = b.target.x, y1 = b.target.y;
      const cx = x0 + (x1 - x0) * 0.15, cy = Math.min(y0, y1) - H * 0.08;
      x = (1 - p) * (1 - p) * x0 + 2 * (1 - p) * p * cx + p * p * x1;
      y = (1 - p) * (1 - p) * y0 + 2 * (1 - p) * p * cy + p * p * y1;
      w = sw * 1.4 + (b.w - sw * 1.4) * p;
      h = sh * 1.4 + (b.h - sh * 1.4) * p;
      // blend in the drift sway so the hand-over is seamless
      const d = DEPTHS[b.depth];
      x += Math.sin(t / 1000 * b.swayRate + b.phase) * d.sway * p;
      rot = Math.cos(t / 1000 * b.swayRate + b.phase) * 0.035 * p + Math.sin(p * Math.PI) * 0.08;
    }
    b.sx = x; b.sy = y; b.dw = w; b.dh = h;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(flip, 1);
    ctx.drawImage(b.img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  function drawHills() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(hills, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawBalloon(b, t) {
    const d = DEPTHS[b.depth];
    const still = reduced.matches;
    const sway = still ? 0 : Math.sin(t / 1000 * b.swayRate + b.phase) * d.sway;
    const tilt = still ? 0 : Math.cos(t / 1000 * b.swayRate + b.phase) * 0.035;
    const cx = b.x * (W - b.w) + b.w / 2 + sway;
    const cy = b.y * H + b.h / 2;
    b.sx = cx;
    b.sy = cy;
    b.dw = b.w;
    b.dh = b.h;
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

  function startLoop() {
    if (started) return;
    started = true;
    last = performance.now();
    requestAnimationFrame(loop);
  }

  function start() {
    running = true;
    $("waiting").hidden = true;
    $("parade-title").hidden = false;
    $("fullscreen").hidden = !document.fullscreenEnabled;
    const hint = $("parade-hint");
    hint.hidden = false;
    setTimeout(() => hint.classList.add("gone"), 12000);
    setTimeout(() => $("parade-title").classList.add("faded"), 20000);
    keepAwake();
    startLoop();
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
    if (document.visibilityState === "visible" && running) keepAwake();
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
    // nearest-first hit test on the balloon's box (slightly inset);
    // launching balloons are drawn on top, so they come first
    const order = [...balloons.filter((b) => b.state === "fly"), ...balloons.filter((b) => b.state === "launch")];
    for (let i = order.length - 1; i >= 0; i--) {
      const b = order[i];
      if (!b.dw) continue;
      if (Math.abs(x - b.sx) < b.dw * 0.45 && Math.abs(y - b.sy) < b.dh * 0.47) {
        selected = b;
        showCard(b, false);
        if (reduced.matches) draw(0);
        return;
      }
    }
    hideCard();
    if (reduced.matches) draw(0);
  });

  function idle(now) {
    if (spot && now > spot.until) {
      spot = null;
      if (!selected) $("note-card").hidden = true;
    }
    if (selected || spot || !balloons.length) return;
    if (now - lastInput < IDLE_AFTER) return;
    if (now - (idle.lastSpot || 0) < SPOT_EVERY) return;
    // prefer balloons with notes that are comfortably on screen
    const onScreen = balloons.filter((b) => b.state === "fly" && b.sy > b.h * 0.6 && b.sy < H * 0.62);
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
        const fresh = rows.filter((r) => !known.has(r.id));
        pendingRows = Math.max(1, fresh.length);
        if (!reduced.matches && fresh.length) reserveSlots(fresh.length);
        fresh.forEach((r) => addBalloon(r));
        const n = rows.length;
        $("parade-count").textContent = n === 1 ? "1 balloon" : n + " balloons";
        return true;
      }
      if (!running) {
        $("waiting").hidden = false;
        $("parade-title").hidden = true;
        const n = await ParadeApi.balloonCount().catch(() => null);
        waitingCount = n || 0;
        $("waiting-count").textContent =
          n === null ? "" : n === 0 ? "Be the first to make a balloon!" : n === 1 ? "1 balloon is waiting on the drawers" : n + " balloons are waiting on the drawers";
      }
    } catch (err) {
      console.error(err);
      if (!running) {
        $("waiting").hidden = false;
        $("parade-title").hidden = true;
      }
    }
    return false;
  }

  $("launch-date").textContent = cfg.launchDateText;
  addEventListener("resize", resize);
  reduced.addEventListener("change", () => {
    if (!reduced.matches) return;
    for (const b of balloons) if (b.state !== "fly") { b.state = "fly"; slots.free.push(b.slot); }
    layoutStatic();
  });
  resize();
  startLoop();
  refresh();
  // pick up newly approved balloons during the day
  setInterval(refresh, 30000);
})();
