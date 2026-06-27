/* Adapted from the Agent browser startup tab artifact for Kenoma's packaged about:kenoma page. */
"use strict";

function qs(selector, root = document) {
  return root.querySelector(selector);
}

function buildField() {
  const field = qs(".field");
  if (!field) {
    return;
  }

  const width = 860;
  const height = 780;
  const radius = 15;
  const sqrt3 = Math.sqrt(3);
  const eye = { x: width * 0.46, y: height * 0.4, r: 160 };
  let out = "";

  for (let q = -2; q < 42; q++) {
    for (let r = -6; r < 46; r++) {
      const cx = radius * 1.5 * q;
      const cy = radius * sqrt3 * (r + q / 2);
      if (cx < -25 || cx > width + 25 || cy < -25 || cy > height + 25) {
        continue;
      }
      const t = cx / width;
      const distance = Math.hypot(cx - eye.x, cy - eye.y);
      const eyeFactor = distance < eye.r ? Math.pow(1 - distance / eye.r, 1.6) : 0;
      const noise = Math.sin(cx * 0.018 + cy * 0.011) * 0.5 +
        Math.sin(cx * 0.006 - cy * 0.02 + 1.7) * 0.5;
      const coherence = Math.max(0, Math.min(1, Math.pow(t, 1.18) - eyeFactor * 1.25 + noise * 0.26));
      if (coherence < 0.17) {
        continue;
      }
      const size = radius * (0.3 + 0.64 * coherence) * 0.9;
      const points = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 180) * 60 * i;
        points.push(`${(cx + size * Math.cos(angle)).toFixed(1)},${(cy + size * Math.sin(angle)).toFixed(1)}`);
      }
      const opacity = (0.09 + 0.34 * coherence).toFixed(2);
      out += `<polygon points="${points.join(" ")}" fill="none" stroke="currentColor" stroke-width="1.1" stroke-opacity="${opacity}"/>`;
    }
  }

  field.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">${out}</svg>`;
}

function drawWiremark(time = 0) {
  const canvas = qs("#wiremark");
  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const size = 240;
  if (canvas.width !== size * dpr || canvas.height !== size * dpr) {
    canvas.width = size * dpr;
    canvas.height = size * dpr;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const pulse = 0.5 + Math.sin(time / 1100) * 0.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const gradient = ctx.createRadialGradient(cx, cy, 8, cx, cy, 112);
  gradient.addColorStop(0, "rgba(56,189,248,0.42)");
  gradient.addColorStop(0.5, "rgba(56,189,248,0.14)");
  gradient.addColorStop(1, "rgba(56,189,248,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, 112, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = `rgba(56,189,248,${0.28 + pulse * 0.12})`;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 11; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, 24 + i * 8, 0.18 * i + time / 9000, Math.PI * 1.55 + 0.18 * i + time / 9000);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(210,251,255,0.86)";
  ctx.lineWidth = 2.3;
  for (let i = 0; i < 4; i++) {
    const rotation = time / 3200 + (Math.PI / 2) * i;
    ctx.beginPath();
    for (let step = 0; step <= 180; step++) {
      const a = (step / 180) * Math.PI * 2;
      const r = 52 + Math.sin(a * 3 + rotation) * 17;
      const x = cx + Math.cos(a + rotation) * r;
      const y = cy + Math.sin(a + rotation) * r * 0.78;
      if (step === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,209,102,0.72)";
  for (let i = 0; i < 24; i++) {
    const a = i * 2.399963 + time / 2400;
    const r = 76 + (i % 5) * 5;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  requestAnimationFrame(drawWiremark);
}

function updateClock() {
  const clock = qs("#clock");
  if (!clock) {
    return;
  }
  const now = new Date();
  clock.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function wireInteractions() {
  const formInput = qs("#q");
  for (const chip of document.querySelectorAll("[data-query]")) {
    chip.addEventListener("click", () => {
      if (formInput instanceof HTMLInputElement) {
        formInput.value = chip.getAttribute("data-query") || "";
        formInput.focus();
      }
    });
  }

  const focusToggle = qs("#focus-toggle");
  const widgetBand = qs("#widget-band");
  if (focusToggle && widgetBand) {
    focusToggle.addEventListener("click", () => {
      widgetBand.classList.toggle("is-hidden");
      focusToggle.textContent = widgetBand.classList.contains("is-hidden") ? "Summon" : "Focus";
    });
  }
}

buildField();
wireInteractions();
updateClock();
setInterval(updateClock, 15000);
requestAnimationFrame(drawWiremark);
