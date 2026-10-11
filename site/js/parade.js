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

  // ---------- scenery ----------

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    bg = paintSky();
    hills = paintHills();
    if (!clouds.length) {
      for (let i = 0; i < 6; i++) clouds.push({ x: Math.random(), y: 0.05 + Math.random() * 0.5, s: 0.5 + Math.random() * 0.8, v: 0.004 + Math.random() * 0.006 });
    }
    for (const b of balloons) size(b);
    if (!running || reduced.matches) draw(0);
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

    const gorgeL = W * 0.36, gorgeR = W * 0.64;
    const near = (x) => {
      const h = 0.12 + 0.03 * Math.sin(x / W * 7 + 2);
      let dip = 0;
      if (x > gorgeL && x < gorgeR) dip = Math.sin(((x - gorgeL) / (gorgeR - gorgeL)) * Math.PI) * 0.09;
      return base - H * Math.max(0.02, h - dip);
    };
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
    g.quadraticCurveTo(W / 2, deckY + towerH * 0.6, gorgeR, deckY - towerH * 0.9);
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

  function cloud(x, y, s) {
    ctx.beginPath();
    ctx.ellipse(x, y, 70 * s, 22 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 28 * s, y - 14 * s, 32 * s, 28 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 18 * s, y - 20 * s, 38 * s, 34 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---------- balloons ----------

  function size(b) {
    const crowd = Math.max(0.5, Math.min(1, Math.sqrt(30 / Math.max(1, balloons.length))));
    const d = DEPTHS[b.depth];
    const target = Math.min(H * 0.3, W * 0.42) * d.scale * crowd;
    const ratio = b.img.naturalWidth / b.img.naturalHeight || 0.7;
    b.h = target;
    b.w = target * ratio;
    if (b.w > W * 0.4 * d.scale) { b.w = W * 0.4 * d.scale; b.h = b.w / ratio; }
  }

  function addBalloon(row, scatter) {
    if (known.has(row.id)) return;
    known.add(row.id);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const counts = [0, 0, 0];
      for (const b of balloons) counts[b.depth]++;
      // keep the depths roughly balanced, near layer slightly smaller
      const depth = counts[2] * 1.3 < Math.min(counts[0], counts[1]) ? 2 : counts[0] <= counts[1] ? 0 : 1;
      const b = {
        row, img, depth, art: hazed(img, DEPTHS[depth].haze),
        x: Math.random(),
        y: scatter ? Math.random() : 1.05 + Math.random() * 0.3,
        phase: Math.random() * Math.PI * 2,
        swayRate: 0.25 + Math.random() * 0.2,
        speedJitter: 0.85 + Math.random() * 0.3,
        sx: 0, sy: 0,
      };
      balloons.push(b);
      balloons.sort((a, c) => a.depth - c.depth);
      for (const x of balloons) size(x);
      if (reduced.matches) layoutStatic();
      if (!running) start();
    };
    img.src = ParadeApi.imageUrl(row.image_path);
  }

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
    for (const b of balloons) {
      const d = DEPTHS[b.depth];
      b.y -= d.speed * b.speedJitter * dt;
      if (b.y * H + b.h < -10) {
        b.y = 1 + (Math.random() * 0.25) + 10 / H;
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
      if (b.depth > 0 && !hillsDrawn) {
        drawHills();
        hillsDrawn = true;
      }
      drawBalloon(b, t);
    }
    if (!hillsDrawn) drawHills();
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

  function start() {
    running = true;
    $("waiting").hidden = true;
    $("parade-title").hidden = false;
    const hint = $("parade-hint");
    hint.hidden = false;
    setTimeout(() => hint.classList.add("gone"), 9000);
    setTimeout(() => $("parade-title").classList.add("faded"), 15000);
    last = performance.now();
    requestAnimationFrame(loop);
  }

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
    for (let i = balloons.length - 1; i >= 0; i--) {
      const b = balloons[i];
      if (Math.abs(x - b.sx) < b.w * 0.45 && Math.abs(y - b.sy) < b.h * 0.47) {
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
    const onScreen = balloons.filter((b) => b.sy > b.h * 0.6 && b.sy < H * 0.62);
    const pool = onScreen.filter((b) => b.row.note).length ? onScreen.filter((b) => b.row.note) : onScreen;
    if (!pool.length) return;
    const b = pool[Math.floor(Math.random() * pool.length)];
    idle.lastSpot = now;
    spot = { b, until: now + SPOT_FOR };
    showCard(b, true);
  }
  // ---------- data ----------

  async function refresh(first) {
    try {
      const rows = await ParadeApi.approvedBalloons();
      if (rows.length) {
        rows.forEach((r) => addBalloon(r, first || !running));
        return true;
      }
      if (!running) {
        $("waiting").hidden = false;
        $("parade-title").hidden = true;
        const n = await ParadeApi.balloonCount().catch(() => null);
        $("waiting-count").textContent =
          n === null ? "" : n === 0 ? "Be the first to make a balloon!" : n === 1 ? "1 balloon is waiting to take off" : n + " balloons are waiting to take off";
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
  reduced.addEventListener("change", () => (reduced.matches ? layoutStatic() : null));
  resize();
  refresh(true);
  // pick up newly approved balloons during the day
  setInterval(() => refresh(false), 45000);
})();
