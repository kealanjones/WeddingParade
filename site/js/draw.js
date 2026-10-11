// Draw-on-screen balloon canvas: brush, bucket fill, eraser, undo, clear,
// and faint guide shapes (drawn on a separate canvas, never exported).
(function () {
  const W = 750, H = 1000;
  const COLOURS = [
    "#23304a", "#ef4f6b", "#ff7a3d", "#ffc234", "#4fb873", "#2f97d6",
    "#8b5cf6", "#ff8fb8", "#8a5a2b", "#ffffff",
  ];
  const MAX_UNDO = 12;

  function init() {
    const canvas = document.getElementById("draw-canvas");
    const guide = document.getElementById("guide-canvas");
    canvas.width = guide.width = W;
    canvas.height = guide.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const state = { colour: COLOURS[1], size: 12, tool: "brush", undo: [], drawing: false, last: null, dirty: false };

    // palette
    const pal = document.getElementById("palette");
    COLOURS.forEach((c, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch" + (c === state.colour ? " on" : "");
      b.style.background = c;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", c === state.colour ? "true" : "false");
      b.setAttribute("aria-label", ["Navy", "Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Pink", "Brown", "White"][i]);
      b.addEventListener("click", () => {
        state.colour = c;
        pal.querySelectorAll(".swatch").forEach((s) => { s.classList.remove("on"); s.setAttribute("aria-checked", "false"); });
        b.classList.add("on");
        b.setAttribute("aria-checked", "true");
        if (state.tool === "eraser") setTool("brush");
      });
      pal.appendChild(b);
    });

    function setTool(t) {
      state.tool = t;
      document.querySelectorAll(".tool").forEach((b) => {
        const on = b.dataset.tool === t;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
    document.querySelectorAll(".tool").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
    document.querySelectorAll(".size").forEach((b) =>
      b.addEventListener("click", () => {
        state.size = Number(b.dataset.size);
        document.querySelectorAll(".size").forEach((s) => s.classList.toggle("on", s === b));
        if (state.tool === "fill") setTool("brush");
      })
    );

    function snapshot() {
      state.undo.push(ctx.getImageData(0, 0, W, H));
      if (state.undo.length > MAX_UNDO) state.undo.shift();
    }
    document.getElementById("undo").addEventListener("click", () => {
      const img = state.undo.pop();
      if (img) ctx.putImageData(img, 0, 0);
    });
    document.getElementById("clear").addEventListener("click", () => {
      snapshot();
      ctx.clearRect(0, 0, W, H);
    });

    // guide shapes
    const gsel = document.getElementById("guide");
    function drawGuide() {
      const g = guide.getContext("2d");
      g.clearRect(0, 0, W, H);
      const kind = gsel.value;
      if (kind === "none") return;
      g.save();
      g.strokeStyle = "rgba(47, 151, 214, 0.28)";
      g.lineWidth = 6;
      g.setLineDash([18, 14]);
      g.lineCap = "round";
      g.beginPath();
      const cx = W / 2;
      if (kind === "round") {
        g.moveTo(cx - 70, 700);
        g.bezierCurveTo(cx - 330, 520, cx - 300, 110, cx, 110);
        g.bezierCurveTo(cx + 300, 110, cx + 330, 520, cx + 70, 700);
        g.closePath();
      } else if (kind === "tall") {
        g.moveTo(cx - 55, 730);
        g.bezierCurveTo(cx - 250, 520, cx - 220, 80, cx, 80);
        g.bezierCurveTo(cx + 220, 80, cx + 250, 520, cx + 55, 730);
        g.closePath();
      } else if (kind === "heart") {
        g.moveTo(cx, 720);
        g.bezierCurveTo(cx - 120, 600, cx - 330, 460, cx - 300, 280);
        g.bezierCurveTo(cx - 270, 120, cx - 60, 110, cx, 250);
        g.bezierCurveTo(cx + 60, 110, cx + 270, 120, cx + 300, 280);
        g.bezierCurveTo(cx + 330, 460, cx + 120, 600, cx, 720);
      }
      g.stroke();
      // basket and ropes
      g.beginPath();
      g.moveTo(cx - 60, 735); g.lineTo(cx - 50, 830);
      g.moveTo(cx + 60, 735); g.lineTo(cx + 50, 830);
      g.stroke();
      g.strokeRect(cx - 65, 830, 130, 90);
      g.restore();
    }
    gsel.addEventListener("change", drawGuide);
    drawGuide();

    // pointer drawing
    function pos(e) {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
    }
    function scaleSize() {
      const r = canvas.getBoundingClientRect();
      return state.size * Math.max(1, W / Math.max(1, r.width)) * 0.9;
    }
    function strokeTo(p) {
      ctx.save();
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.lineWidth = scaleSize();
      if (state.tool === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.lineWidth *= 1.8;
        ctx.strokeStyle = "#000";
      } else ctx.strokeStyle = state.colour;
      ctx.beginPath();
      ctx.moveTo(state.last.x, state.last.y);
      ctx.lineTo(p.x + 0.01, p.y);
      ctx.stroke();
      ctx.restore();
      state.last = p;
    }
    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const p = pos(e);
      snapshot();
      state.dirty = true;
      if (state.tool === "fill") {
        bucket(ctx, Math.floor(p.x), Math.floor(p.y), state.colour);
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      state.drawing = true;
      state.last = p;
      strokeTo(p);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!state.drawing) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) strokeTo(pos(ev));
    });
    const end = () => { state.drawing = false; state.last = null; };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    return {
      canvas,
      hasDrawing() {
        const d = ctx.getImageData(0, 0, W, H).data;
        for (let i = 3; i < d.length; i += 16) if (d[i] > 20) return true;
        return false;
      },
    };
  }

  // Flood fill from (x, y) with colour, with tolerance, then soak the fill
  // under the anti-aliased edge pixels so no pale halo is left.
  function bucket(ctx, sx, sy, colour) {
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const fr = parseInt(colour.slice(1, 3), 16), fg = parseInt(colour.slice(3, 5), 16), fb = parseInt(colour.slice(5, 7), 16);
    const key = (i) => {
      const a = d[i + 3];
      return [(d[i] * a) / 255, (d[i + 1] * a) / 255, (d[i + 2] * a) / 255, a];
    };
    const seed = key((sy * W + sx) * 4);
    if (Math.abs(seed[0] - fr) + Math.abs(seed[1] - fg) + Math.abs(seed[2] - fb) < 8 && seed[3] > 250) return;
    const near = (p) => {
      const k = key(p * 4);
      return Math.abs(k[0] - seed[0]) + Math.abs(k[1] - seed[1]) + Math.abs(k[2] - seed[2]) + Math.abs(k[3] - seed[3]) < 90;
    };
    const region = new Uint8Array(W * H);
    const stack = [sy * W + sx];
    region[sy * W + sx] = 1;
    while (stack.length) {
      const p = stack.pop();
      const x = p % W;
      const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p >= W ? p - W : -1, p < W * (H - 1) ? p + W : -1];
      for (const q of nb) {
        if (q >= 0 && !region[q] && near(q)) { region[q] = 1; stack.push(q); }
      }
    }
    // 2px ring around the region
    const ring = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!region[y * W + x]) continue;
        for (let dy = -2; dy <= 2; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx;
            if (xx >= 0 && xx < W && !region[yy * W + xx]) ring[yy * W + xx] = 1;
          }
        }
      }
    }
    for (let p = 0; p < W * H; p++) {
      const i = p * 4;
      if (region[p]) {
        d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255;
      } else if (ring[p]) {
        const a = d[i + 3] / 255;
        d[i] = d[i] * a + fr * (1 - a);
        d[i + 1] = d[i + 1] * a + fg * (1 - a);
        d[i + 2] = d[i + 2] * a + fb * (1 - a);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  window.DrawPad = { init };
})();
