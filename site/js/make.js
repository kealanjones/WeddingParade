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
    pendingId: null, // keeps the same id across retries, so no duplicates
    lastBlob: null, // the PNG last sent (for "Save a copy")
  };
  let pad = null;

  const stepNumber = { choose: 1, crop: 1, draw: 1, preview: 2, thanks: 4 };
  function show(step) {
    for (const s of steps) $("step-" + s).hidden = s !== step;
    const n = stepNumber[step];
    document.querySelectorAll("#stepper li").forEach((li) => {
      const k = Number(li.dataset.n);
      li.classList.toggle("on", k === n);
      li.classList.toggle("done", k < n);
      if (k === n) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
    if (step !== "preview") setCompare(false);
    const el = $("step-" + step);
    el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    if (step === "crop") requestAnimationFrame(layoutCrop);
  }

  function busy(text) {
    $("busy-text").textContent = text || "";
    $("busy").hidden = !text;
  }
  let noticeTimer = 0;
  function notice(msg) {
    $("notice-text").textContent = msg;
    $("notice").hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => ($("notice").hidden = true), 9000);
  }
  $("notice-close").addEventListener("click", () => ($("notice").hidden = true));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));

  document.querySelectorAll("[data-go]").forEach((b) =>
    b.addEventListener("click", () => show(b.dataset.go))
  );

  // ---------- never lose a balloon ----------
  // Balloons are saved on this device before sending and removed only once
  // Supabase has them. Anything left over is re-sent next time.
  // A photo balloon also carries the original photo; once the balloon itself
  // is in, it stays saved (marked sent) until the original is in too.
  async function resendSaved() {
    const saved = await Outbox.all();
    if (!saved.length || cfg.supabaseUrl.includes("YOUR-PROJECT")) return;
    let sent = 0;
    for (const b of saved) {
      try {
        if (!b.sent) {
          await ParadeApi.submitBalloon(b);
          sent++;
          if (b.original) await Outbox.put({ ...b, sent: true });
        }
        if (b.original) await ParadeApi.uploadOriginal(b.id, b.original);
        await Outbox.remove(b.id);
      } catch (e) {}
    }
    const note = $("outbox-note");
    if (sent) {
      note.textContent = sent === 1 ? "Good news: the balloon you made earlier has now been sent to Sop and Bop." : "Good news: the " + sent + " balloons you made earlier have now been sent to Sop and Bop.";
      note.hidden = false;
    }
  }
  resendSaved();
  addEventListener("online", resendSaved);

  // The balloon is in: now the original photo, in the background. The guest
  // never waits for this or sees it fail; if it can't go now it stays saved
  // on the device and goes next visit.
  function sendOriginalLater(balloon) {
    Promise.resolve()
      .then(() => ParadeApi.uploadOriginal(balloon.id, balloon.original))
      .then(() => Outbox.remove(balloon.id))
      .catch((e) => console.warn("Original photo not sent yet, kept for next visit:", e.message));
  }

  function photoAsJpeg(canvas) {
    return new Promise((resolve) => {
      try {
        canvas.toBlob((b) => resolve(b || null), "image/jpeg", 0.92);
      } catch (e) {
        resolve(null);
      }
    });
  }

  function saveCopy(blob, name) {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "balloon-for-sop-and-bop" + (name ? "-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "") + ".png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  $("save-copy").addEventListener("click", () => saveCopy(state.lastBlob, $("thanks-name").textContent));
  $("save-copy-failed").addEventListener("click", () => saveCopy(state.lastBlob, $("name").value.trim()));
  $("retry").addEventListener("click", () => $("details").requestSubmit());

  // The balloon itself changed: a saved-but-unsent older version is dropped
  // so it isn't sent as well.
  function balloonChanged() {
    if (state.pendingId) Outbox.remove(state.pendingId);
    state.pendingId = null;
  }

  // Remember the guest's name for a second balloon (this browser only).
  try { $("name").value = localStorage.getItem("parade-name") || ""; } catch (e) {}

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
  async function onPhoto(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    busy("Opening your photo…");
    await nextFrame();
    try {
      setPhoto(await Cleanup.loadPhoto(file));
      state.dark = brightness(state.photo) < 0.33;
      busy(null);
      show("crop");
    } catch (err) {
      busy(null);
      notice(err.message + " If it keeps happening, send the photo to us on WhatsApp (details at the bottom of the page).");
    }
  }
  // Phones and tablets get a "Take a photo now" button that opens the camera.
  if (navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches) document.body.classList.add("has-camera");
  $("photo-input").addEventListener("change", onPhoto);
  $("camera-input").addEventListener("change", onPhoto);

  function setPhoto(photo) {
    state.photo = photo;
    state.crop = Cleanup.guessCrop(photo);
    const c = $("crop-canvas");
    c.width = photo.width;
    c.height = photo.height;
    c.getContext("2d").drawImage(photo, 0, 0);
  }

  // Average brightness 0..1, from a small copy of the photo.
  function brightness(photo) {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(photo, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    return sum / (64 * 64 * 255);
  }

  $("rotate").addEventListener("click", () => {
    const src = state.photo, c = document.createElement("canvas");
    c.width = src.height;
    c.height = src.width;
    const g = c.getContext("2d");
    g.translate(c.width, 0);
    g.rotate(Math.PI / 2);
    g.drawImage(src, 0, 0);
    setPhoto(c);
    requestAnimationFrame(layoutCrop);
  });
  $("whole").addEventListener("click", () => {
    state.crop = { x: 0, y: 0, w: state.photo.width, h: state.photo.height };
    layoutCrop();
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
      notice("We couldn't find a drawing in that box. Try moving the corners closer to your balloon.");
      return false;
    }
    balloonChanged();
    setCompare(false);
    paintPreview(state.result.canvas);
    const cov = state.result.coverage;
    qualityHint(
      cov > 0.85 ? "Some of the paper or background may have been kept. Try moving the box closer to your drawing, or tidying up more (under \u201cNot quite right?\u201d below)."
      : cov < 0.03 ? "We only found a small part of your drawing. Try keeping more of it (under \u201cNot quite right?\u201d below), or a photo with a darker outline."
      : state.dark ? "Your photo is quite dark. If the balloon looks patchy, try another photo in brighter light, near a window."
      : null
    );
    return true;
  }

  function qualityHint(msg) {
    $("quality-hint").textContent = msg || "";
    $("quality-hint").hidden = !msg;
  }

  // Before/after: swap the preview between the cut-out and the original photo.
  let comparing = false;
  function setCompare(on) {
    comparing = on;
    const btn = $("compare");
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = on ? "Show my balloon" : "Show my photo";
    if (!state.result) return;
    if (!on) return paintPreview(state.result.canvas);
    const { x, y, w, h } = state.crop;
    const k = Math.min(1, 800 / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    c.getContext("2d").drawImage(state.photo, x, y, w, h, 0, 0, c.width, c.height);
    paintPreview(c);
  }
  $("compare").addEventListener("click", () => setCompare(!comparing));

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
    if (state.source !== "photo" || !state.result || comparing) return;
    const c = $("preview-canvas"), r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * c.width;
    const y = ((e.clientY - r.top) / r.height) * c.height;
    if (state.result.toggleAt(x, y)) {
      balloonChanged();
      paintPreview(state.result.canvas);
    }
  });

  // ---------- draw route ----------
  $("start-draw").addEventListener("click", () => {
    if (!pad) pad = DrawPad.init();
    show("draw");
  });
  $("draw-done").addEventListener("click", () => {
    if (!pad.hasDrawing()) {
      notice("Draw your balloon first. Any shape you like!");
      return;
    }
    balloonChanged();
    state.drawn = Cleanup.solidifyDrawing(pad.canvas);
    if (!state.drawn) return;
    state.source = "drawn";
    qualityHint(null);
    paintPreview(state.drawn);
    $("photo-controls").hidden = true;
    $("draw-controls").hidden = false;
    show("preview");
  });

  // ---------- details & submit ----------
  $("note").addEventListener("input", () => ($("note-count").textContent = $("note").value.length));

  function formError(msg, detail) {
    const el = $("form-error");
    el.textContent = msg || "";
    if (detail) {
      // Small print so the couple can tell us what actually went wrong.
      const small = document.createElement("small");
      small.className = "error-detail";
      small.textContent = "Details: " + detail;
      el.appendChild(small);
    }
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
    if (!note) {
      formError("Please write a little note to go with your balloon. Sop and Bop will read every one!");
      $("note").focus();
      return;
    }
    if (name.length > 60 || note.length > 280) {
      formError("That's a little too long. Names can be up to 60 characters and notes up to 280.");
      return;
    }
    formError(null);
    $("failed-actions").hidden = true;
    const canvas = state.source === "photo" ? state.result.canvas : state.drawn;
    $("submit").disabled = true;
    busy("Sending your balloon…");
    let balloon = null;
    try {
      if (cfg.supabaseUrl.includes("YOUR-PROJECT")) throw new Error("The site isn't connected to its database yet.");
      const blob = await Cleanup.toPngBlob(canvas);
      state.lastBlob = blob;
      state.pendingId = state.pendingId || ParadeApi.newId();
      // the photo before the cut-out, as a backup (photo balloons only)
      const original = state.source === "photo" && state.photo ? await photoAsJpeg(state.photo) : null;
      balloon = { id: state.pendingId, blob, name, note, source: state.source, original };
      await Outbox.put(balloon);
      await ParadeApi.submitBalloon(balloon);
      if (original) {
        await Outbox.put({ ...balloon, sent: true });
        sendOriginalLater(balloon);
      } else {
        await Outbox.remove(balloon.id);
      }
      state.pendingId = null;
      $("thanks-name").textContent = name;
      $("thanks-img").src = URL.createObjectURL(blob);
      show("thanks");
    } catch (err) {
      console.error(err);
      const kept = balloon && (await Outbox.all()).some((b) => b.id === balloon.id);
      formError(
        kept
          ? "We couldn't send your balloon just now, but it's safely saved on this device and we'll send it automatically next time you open this page. You can also try again now, or save a copy and send it to us on WhatsApp (details below)."
          : "Sorry, we couldn't send your balloon. Please check your internet connection and try again, or save a copy and send it to us on WhatsApp (details below).",
        err.message
      );
      $("failed-actions").hidden = false;
    } finally {
      busy(null);
      $("submit").disabled = false;
    }
  });

  $("another").addEventListener("click", () => {
    state.photo = state.result = state.drawn = null;
    state.pendingId = null;
    $("failed-actions").hidden = true;
    formError(null);
    $("note").value = "";
    $("note-count").textContent = "0";
    $("strength").value = 50;
    $("fix").open = false;
    show("choose");
  });
})();
