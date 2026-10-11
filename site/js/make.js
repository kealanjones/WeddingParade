// "Make your balloon" page: photo -> crop -> cleanup preview -> details -> thanks,
// or draw on screen -> preview -> details -> thanks.
(function () {
  const cfg = window.PARADE_CONFIG;
  const $ = (id) => document.getElementById(id);
  const steps = ["choose", "crop", "draw", "preview", "thanks"];

  const state = {
    photo: null, // loaded photo canvas
    crop: null, // {x,y,w,h} in photo pixels
    result: null, // cleanup result {canvas, toggleAt}
    drawn: null, // drawn balloon canvas
    source: null, // "photo" | "drawn"
  };
  let pad = null;

  function show(step) {
    for (const s of steps) $("step-" + s).hidden = s !== step;
    const el = $("step-" + step);
    el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    if (step === "crop") requestAnimationFrame(layoutCrop);
  }

  function busy(text) {
    $("busy-text").textContent = text || "";
    $("busy").hidden = !text;
  }
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));

  document.querySelectorAll("[data-go]").forEach((b) =>
    b.addEventListener("click", () => show(b.dataset.go))
  );

  // ---------- WhatsApp plan B ----------
  $("wa-number").textContent = cfg.whatsappDisplay;
  $("wa-intl").textContent = cfg.whatsappInternational;
  $("wa-link").href = cfg.whatsappLink;
  $("copy-number").addEventListener("click", async () => {
    const btn = $("copy-number");
    try {
      await navigator.clipboard.writeText(cfg.whatsappDisplay.replace(/\s/g, ""));
      btn.textContent = "Copied ✓";
    } catch (e) {
      const r = document.createRange();
      r.selectNodeContents($("wa-number"));
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      btn.textContent = "Selected, now copy";
    }
    setTimeout(() => (btn.textContent = "Copy number"), 2500);
  });

  // ---------- photo route ----------
  $("photo-input").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    busy("Opening your photo…");
    await nextFrame();
    try {
      state.photo = await Cleanup.loadPhoto(file);
      state.crop = Cleanup.guessCrop(state.photo);
      const c = $("crop-canvas");
      c.width = state.photo.width;
      c.height = state.photo.height;
      c.getContext("2d").drawImage(state.photo, 0, 0);
      busy(null);
      show("crop");
    } catch (err) {
      busy(null);
      alert(err.message + "\n\nIf it keeps happening, send the photo to us on WhatsApp (details at the bottom of the page).");
    }
  });

  // crop box, kept in photo pixel coordinates
  function layoutCrop() {
    const c = $("crop-canvas"), box = $("crop-box");
    if (!state.photo) return;
    const k = c.clientWidth / state.photo.width;
    box.style.left = state.crop.x * k + "px";
    box.style.top = state.crop.y * k + "px";
    box.style.width = state.crop.w * k + "px";
    box.style.height = state.crop.h * k + "px";
  }
  addEventListener("resize", () => { if (!$("step-crop").hidden) layoutCrop(); });

  (function cropDrag() {
    const box = $("crop-box");
    let drag = null;
    box.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const k = $("crop-canvas").clientWidth / state.photo.width;
      drag = { mode: e.target.dataset.h || "move", x: e.clientX, y: e.clientY, start: { ...state.crop }, k, id: e.pointerId };
      box.setPointerCapture(e.pointerId);
    });
    box.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = (e.clientX - drag.x) / drag.k, dy = (e.clientY - drag.y) / drag.k;
      const s = drag.start, PW = state.photo.width, PH = state.photo.height;
      const min = Math.max(40, Math.min(PW, PH) * 0.08);
      let { x, y, w, h } = s;
      if (drag.mode === "move") {
        x = Math.min(PW - w, Math.max(0, s.x + dx));
        y = Math.min(PH - h, Math.max(0, s.y + dy));
      } else {
        let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
        if (drag.mode.includes("w")) x0 = Math.min(x1 - min, Math.max(0, s.x + dx));
        if (drag.mode.includes("e")) x1 = Math.max(x0 + min, Math.min(PW, s.x + s.w + dx));
        if (drag.mode.includes("n")) y0 = Math.min(y1 - min, Math.max(0, s.y + dy));
        if (drag.mode.includes("s")) y1 = Math.max(y0 + min, Math.min(PH, s.y + s.h + dy));
        x = x0; y = y0; w = x1 - x0; h = y1 - y0;
      }
      state.crop = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
      layoutCrop();
    });
    const end = () => (drag = null);
    box.addEventListener("pointerup", end);
    box.addEventListener("pointercancel", end);
  })();

  async function runCleanup() {
    const strength = Number($("strength").value) / 100;
    state.result = Cleanup.process(state.photo, state.crop, strength);
    if (!state.result) {
      alert("We couldn't find a drawing in that box. Try moving the corners, or lowering the cleanup strength.");
      return false;
    }
    paintPreview(state.result.canvas);
    return true;
  }

  $("crop-done").addEventListener("click", async () => {
    busy("Cutting out your balloon…");
    await nextFrame();
    try {
      state.source = "photo";
      $("photo-controls").hidden = false;
      $("draw-controls").hidden = true;
      if (await runCleanup()) show("preview");
    } finally {
      busy(null);
    }
  });

  let strengthTimer = 0;
  $("strength").addEventListener("input", () => {
    clearTimeout(strengthTimer);
    strengthTimer = setTimeout(() => {
      if (state.source === "photo" && state.photo) runCleanup();
    }, 180);
  });

  function paintPreview(src) {
    const c = $("preview-canvas");
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0);
  }

  $("preview-canvas").addEventListener("click", (e) => {
    if (state.source !== "photo" || !state.result) return;
    const c = $("preview-canvas"), r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * c.width;
    const y = ((e.clientY - r.top) / r.height) * c.height;
    if (state.result.toggleAt(x, y)) paintPreview(state.result.canvas);
  });

  // ---------- draw route ----------
  $("start-draw").addEventListener("click", () => {
    if (!pad) pad = DrawPad.init();
    show("draw");
  });
  $("draw-done").addEventListener("click", () => {
    if (!pad.hasDrawing()) {
      alert("Draw your balloon first. Any shape you like!");
      return;
    }
    state.drawn = Cleanup.solidifyDrawing(pad.canvas);
    if (!state.drawn) return;
    state.source = "drawn";
    paintPreview(state.drawn);
    $("photo-controls").hidden = true;
    $("draw-controls").hidden = false;
    show("preview");
  });

  // ---------- details & submit ----------
  $("note").addEventListener("input", () => ($("note-count").textContent = $("note").value.length));

  function formError(msg) {
    const el = $("form-error");
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  $("details").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("name").value.trim();
    const note = $("note").value.trim();
    if (!name) {
      formError("Please add your name so Sop and Bop know who made this balloon.");
      $("name").focus();
      return;
    }
    if (name.length > 60 || note.length > 280) {
      formError("That's a little too long. Names can be up to 60 characters and notes up to 280.");
      return;
    }
    formError(null);
    const canvas = state.source === "photo" ? state.result.canvas : state.drawn;
    $("submit").disabled = true;
    busy("Sending your balloon…");
    try {
      if (cfg.supabaseUrl.includes("YOUR-PROJECT")) throw new Error("The site isn't connected to its database yet.");
      const blob = await Cleanup.toPngBlob(canvas);
      await ParadeApi.submitBalloon({ blob, name, note, source: state.source });
      $("thanks-name").textContent = name;
      $("thanks-img").src = URL.createObjectURL(blob);
      show("thanks");
    } catch (err) {
      console.error(err);
      formError("Sorry, something went wrong sending your balloon. Please check your internet connection and try again. If it still won't send, use the WhatsApp option below.");
    } finally {
      busy(null);
      $("submit").disabled = false;
    }
  });

  $("another").addEventListener("click", () => {
    state.photo = state.result = state.drawn = null;
    $("note").value = "";
    $("note-count").textContent = "0";
    $("strength").value = 50;
    show("choose");
  });
})();
