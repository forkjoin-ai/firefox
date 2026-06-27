const browserApi = globalThis.browser;
const form = document.getElementById("command-form");
const input = document.getElementById("command-input");
const output = document.getElementById("output");

function write(value) {
  output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function payloadFor(type) {
  if (type === "gnosis.frf.bench") {
    return { iterations: 2048, lanes: 8 };
  }
  if (type === "gnosis.scheduler.bench") {
    return { count: 1024 };
  }
  if (type === "gnosis.storage.bench") {
    return { count: 64, bytesPerWrite: 2048 };
  }
  if (type === "aeon3d.render.bench") {
    return { vertices: 8192 };
  }
  if (type === "aether.simd.bench") {
    return { elements: 16384 };
  }
  return {};
}

async function send(type, payload) {
  write(`running ${type}`);
  try {
    const result = await browserApi.runtime.sendMessage({ type, payload });
    write(result);
  } catch (error) {
    write(error instanceof Error ? error.message : String(error));
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  const command = input.value.trim();
  if (!command) {
    return;
  }
  send("gnosis.moonshine.exec", { command, timeoutMs: 30000 });
});

for (const button of document.querySelectorAll("[data-op]")) {
  button.addEventListener("click", () => {
    const type = button.getAttribute("data-op");
    send(type, payloadFor(type));
  });
}

send("gnosis.runtime.capabilities", {});
