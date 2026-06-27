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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(from, to, t) {
  return from + (to - from) * t;
}

function drawKineticWiremark(ctx, width, height, state, time) {
  const cx = width / 2;
  const cy = height * 0.54;
  const hover = state.hover;
  const pulse = state.burst;
  const crank = state.wind;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const glow = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.min(width, height) * 0.52);
  glow.addColorStop(0, `rgba(56,189,248,${0.28 + pulse * 0.15})`);
  glow.addColorStop(0.48, "rgba(56,189,248,0.08)");
  glow.addColorStop(1, "rgba(56,189,248,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const layers = 11;
  const points = [];
  for (let layer = 0; layer < layers; layer++) {
    const progress = layer / (layers - 1);
    const centered = progress - 0.5;
    const twist = time * 0.00018 + layer * 0.18 + state.spin * (0.7 + progress);
    const radius = Math.min(width, height) * (0.16 + (1 - Math.abs(centered)) * 0.17);
    const ySkew = 0.58 + Math.abs(centered) * 0.45;
    const spread = Math.abs(crank) * 23 * (layer % 2 === 0 ? 1 : -1);
    const layerPoints = [];
    for (let corner = 0; corner < 4; corner++) {
      const angle = Math.PI / 4 + corner * Math.PI / 2 + twist;
      const ripple = Math.sin(time * 0.0011 + layer * 0.9 + corner * 1.7) * (3 + hover * 5);
      layerPoints.push({
        x: cx + Math.cos(angle) * (radius + ripple) + centered * state.pointerX * 34 + spread * centered,
        y: cy + Math.sin(angle) * (radius + ripple) * ySkew + centered * Math.min(width, height) * 0.56 + state.pointerY * 18,
      });
    }
    points.push(layerPoints);
  }

  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "rgba(214,251,255,0.28)";
  for (let i = 0; i < 150; i++) {
    const angle = i * 2.399963 + time * 0.00007;
    const radius = Math.min(width, height) * (0.18 + (i % 29) * 0.011);
    const x = cx + Math.cos(angle) * radius + Math.sin(time * 0.0003 + i) * 9 + state.pointerX * ((i % 7) - 3);
    const y = cy + Math.sin(angle) * radius * 0.72 + Math.cos(time * 0.00021 + i) * 13 + state.pointerY * ((i % 5) - 2);
    ctx.globalAlpha = 0.08 + (i % 11) * 0.008 + pulse * 0.08;
    ctx.beginPath();
    ctx.arc(x, y, 0.6 + (i % 3) * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  const strokeLine = (a, b, color, alpha, lineWidth) => {
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = lineWidth * 2.1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = Math.min(1, alpha * 0.22);
    ctx.lineWidth = lineWidth * 6.4;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };

  for (let layer = 0; layer < layers - 1; layer++) {
    for (let corner = 0; corner < 4; corner++) {
      strokeLine(points[layer][corner], points[layer + 1][corner], "#2f7fa3", 0.12 + pulse * 0.05, 0.7);
    }
    strokeLine(points[layer][0], points[layer + 1][1], "#2f7fa3", 0.08 + hover * 0.05, 0.55);
    strokeLine(points[layer][2], points[layer + 1][3], "#2f7fa3", 0.08 + hover * 0.05, 0.55);
  }
  for (let layer = 0; layer < layers; layer++) {
    const alpha = 0.3 + hover * 0.1 + (layer === 0 || layer === layers - 1 ? 0.13 : 0);
    for (let corner = 0; corner < 4; corner++) {
      strokeLine(points[layer][corner], points[layer][(corner + 1) % 4], "#74f6ff", alpha, 1.2);
    }
  }
  strokeLine(points[0][3], points[6][1], "#d2fbff", 0.12 + Math.abs(crank) * 0.16 + pulse * 0.14, 1.4);
  strokeLine(points[1][0], points[8][2], "#d2fbff", 0.12 + Math.abs(crank) * 0.16 + pulse * 0.14, 1.4);
  strokeLine(points[2][2], points[10][0], "#d2fbff", 0.12 + Math.abs(crank) * 0.16 + pulse * 0.14, 1.4);
  ctx.restore();
}

function mountKineticWiremark() {
  const canvas = qs("#wiremark");
  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const state = { pointerX: 0, pointerY: 0, smoothX: 0, smoothY: 0, hover: 0, burst: 0, wind: 0, spin: 0, pressed: false, lastAngle: null };
  let width = 1;
  let height = 1;
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const updatePointer = (event) => {
    const rect = canvas.getBoundingClientRect();
    state.pointerX = clamp(((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1, -1.7, 1.7);
    state.pointerY = clamp(((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1, -1.7, 1.7);
  };
  const moveCrank = (event) => {
    updatePointer(event);
    const rect = canvas.getBoundingClientRect();
    const angle = Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2));
    if (state.lastAngle !== null) {
      let delta = angle - state.lastAngle;
      while (delta > Math.PI) {
        delta -= Math.PI * 2;
      }
      while (delta < -Math.PI) {
        delta += Math.PI * 2;
      }
      state.wind = clamp(state.wind + delta * 1.1, -2.8, 2.8);
      state.spin += delta * (state.pressed ? 0.9 : 0.5);
      state.burst = Math.min(1, state.burst + Math.abs(delta) * 0.04);
    }
    state.lastAngle = angle;
  };
  const render = (time) => {
    state.smoothX = lerp(state.smoothX, state.pointerX, 0.08);
    state.smoothY = lerp(state.smoothY, state.pointerY, 0.08);
    state.hover = lerp(state.hover, canvas.matches(":hover") ? 1 : 0, 0.08);
    state.burst = lerp(state.burst, 0, 0.025);
    if (!state.pressed) {
      state.wind = lerp(state.wind, 0, 0.015);
      state.spin += state.wind * 0.005;
    }
    drawKineticWiremark(ctx, width, height, {
      pointerX: state.smoothX,
      pointerY: state.smoothY,
      hover: state.hover,
      burst: state.burst,
      wind: state.wind,
      spin: state.spin,
    }, time);
    requestAnimationFrame(render);
  };

  resize();
  window.addEventListener("resize", resize);
  canvas.addEventListener("pointerenter", () => {
    state.lastAngle = null;
  });
  canvas.addEventListener("pointermove", moveCrank);
  canvas.addEventListener("pointerdown", event => {
    state.pressed = true;
    state.lastAngle = null;
    canvas.setPointerCapture(event.pointerId);
    moveCrank(event);
  });
  canvas.addEventListener("pointerup", event => {
    state.pressed = false;
    state.lastAngle = null;
    state.burst = Math.min(1, state.burst + 0.45);
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  });
  canvas.addEventListener("pointerleave", () => {
    state.pointerX = 0;
    state.pointerY = 0;
    state.lastAngle = null;
  });
  requestAnimationFrame(render);
}

function updateClock() {
  const clock = qs("#clock");
  if (!clock) {
    return;
  }
  const now = new Date();
  clock.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function loadWidgetState() {
  try {
    return JSON.parse(localStorage.getItem("kenoma.operator.widgets.v1") || "{}") || {};
  } catch (_) {
    return {};
  }
}

function saveWidgetState(widgetBand) {
  const widgets = [...widgetBand.querySelectorAll("[data-widget]")];
  const collapsed = {};
  for (const widget of widgets) {
    collapsed[widget.getAttribute("data-widget") || ""] = widget.classList.contains("is-collapsed");
  }
  localStorage.setItem("kenoma.operator.widgets.v1", JSON.stringify({
    order: widgets.map(widget => widget.getAttribute("data-widget")).filter(Boolean),
    collapsed,
  }));
}

function wireWidgetControls() {
  const widgetBand = qs("#widget-band");
  if (!widgetBand) {
    return;
  }
  const saved = loadWidgetState();
  const widgets = [...widgetBand.querySelectorAll("[data-widget]")];
  const byId = new Map(widgets.map(widget => [widget.getAttribute("data-widget"), widget]));

  if (Array.isArray(saved.order)) {
    for (const id of saved.order) {
      const widget = byId.get(id);
      if (widget) {
        widgetBand.append(widget);
      }
    }
  }

  for (const widget of [...widgetBand.querySelectorAll("[data-widget]")]) {
    const id = widget.getAttribute("data-widget") || "";
    const button = widget.querySelector(".collapse-button");
    const initiallyCollapsed = Boolean(saved.collapsed && saved.collapsed[id]);
    widget.classList.toggle("is-collapsed", initiallyCollapsed);
    if (button) {
      button.setAttribute("aria-expanded", initiallyCollapsed ? "false" : "true");
      button.addEventListener("click", () => {
        const collapsed = widget.classList.toggle("is-collapsed");
        button.setAttribute("aria-expanded", collapsed ? "false" : "true");
        saveWidgetState(widgetBand);
      });
    }

    widget.addEventListener("dragstart", event => {
      widget.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
    });
    widget.addEventListener("dragover", event => {
      event.preventDefault();
      widget.classList.add("is-drop-target");
      event.dataTransfer.dropEffect = "move";
    });
    widget.addEventListener("dragleave", () => {
      widget.classList.remove("is-drop-target");
    });
    widget.addEventListener("drop", event => {
      event.preventDefault();
      const from = byId.get(event.dataTransfer.getData("text/plain"));
      widget.classList.remove("is-drop-target");
      if (!from || from === widget) {
        return;
      }
      widgetBand.insertBefore(from, widget);
      saveWidgetState(widgetBand);
    });
    widget.addEventListener("dragend", () => {
      for (const item of widgetBand.querySelectorAll("[data-widget]")) {
        item.classList.remove("is-dragging", "is-drop-target");
      }
    });
  }
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

  wireWidgetControls();
}

function kenomaEscape(text) {
  return String(text == null ? "" : text).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function kenomaDescribeAction(action) {
  if (!action || typeof action.action !== "string") {
    return "(no action)";
  }
  const detail = action.url || action.selector || action.answer || "";
  return detail ? `${action.action} ${detail}` : action.action;
}

function wireAgent() {
  const runBtn = qs("#agent-run");
  const stopBtn = qs("#agent-stop");
  const input = qs("#q");
  const list = qs(".in-flight .run-list");
  if (!runBtn || !stopBtn || !input) {
    return;
  }
  const log = (dotClass, title, sub, tag) => {
    if (!list) {
      return;
    }
    list.insertAdjacentHTML(
      "afterbegin",
      `<div class="run"><span class="run-dot ${dotClass}"></span><span><strong>${kenomaEscape(title)}</strong><small>${kenomaEscape(sub)}</small></span><em>${kenomaEscape(tag)}</em></div>`
    );
  };
  let running = false;
  const setRunning = on => {
    running = on;
    stopBtn.classList.toggle("is-hidden", !on);
    runBtn.disabled = on;
  };
  // window.KenomaAgent is injected by the KenomaAgent child actor. It may land
  // just after this deferred script runs, so wire on ready as well as now.
  const attach = () => {
    const api = window.KenomaAgent;
    if (!api || typeof api.run !== "function" || runBtn.dataset.kenomaWired) {
      return false;
    }
    runBtn.dataset.kenomaWired = "1";
    api.onEvent(event => {
      if (!event) {
        return;
      }
      if (event.kind === "observe") {
        log("cyan", `looking (${event.tabs} tabs)`, event.url || "", `STEP ${event.step}`);
      } else if (event.kind === "decide") {
        log("violet", kenomaDescribeAction(event.action), `step ${event.step}`, "ACT");
      } else if (event.kind === "error") {
        log("", "error", event.error, "ERR");
      } else if (event.kind === "stopped") {
        log("", "stopped", "", "STOP");
        setRunning(false);
      } else if (event.kind === "done") {
        log("lime", "done", event.answer != null ? event.answer : "(no answer)", "DONE");
        setRunning(false);
      }
    });
    runBtn.addEventListener("click", () => {
      const task = input.value.trim();
      if (!task || running) {
        return;
      }
      if (list) {
        list.innerHTML = "";
      }
      log("cyan", task, "agent task", "RUNNING");
      setRunning(true);
      Promise.resolve(api.run(task)).catch(error => {
        log("", "error", error && error.message ? error.message : String(error), "ERR");
        setRunning(false);
      });
    });
    stopBtn.addEventListener("click", () => {
      try {
        api.stop();
      } catch (e) {}
    });
    return true;
  };
  if (!attach()) {
    runBtn.disabled = true;
    runBtn.title = "Kenoma agent unavailable in this context";
    window.addEventListener("KenomaAgent:ready", () => {
      runBtn.disabled = false;
      runBtn.title = "Run as a Moonshine browser agent";
      attach();
    });
  }
}

buildField();
wireInteractions();
wireAgent();
updateClock();
setInterval(updateClock, 15000);
mountKineticWiremark();
