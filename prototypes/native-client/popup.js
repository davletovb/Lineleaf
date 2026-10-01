const result = document.querySelector("#result");
const connect = document.querySelector("#connect");
const disconnect = document.querySelector("#disconnect");
let port, request, timer, ready = false, events = 0;
const show = value => { result.textContent = value; };
function close() {
  clearTimeout(timer);
  const previous = port;
  port = null;
  previous?.disconnect();
  connect.disabled = false;
  disconnect.disabled = true;
}
disconnect.addEventListener("click", () => { close(); show("Disconnected."); });
connect.addEventListener("click", () => {
  close(); ready = false; events = 0;
  connect.disabled = true;
  disconnect.disabled = false;
  show("Connecting to com.seatline.host…");
  try {
    const current = chrome.runtime.connectNative("com.seatline.host");
    port = current;
    timer = setTimeout(() => { close(); show("Connection timed out. Check Seatline installation and authorization."); }, 10000);
    current.onDisconnect.addListener(() => {
      // Read lastError to suppress Chrome diagnostics; never display its raw native output.
      const failed = Boolean(chrome.runtime.lastError);
      if (port !== current) return;
      close();
      show(failed ? "Connection unavailable. Install the shared Seatline companion and authorize this extension ID."
        : "Companion disconnected.");
    });
    current.onMessage.addListener(message => {
      if (port !== current) return;
      if (++events > 32 || !message || typeof message !== "object" || Array.isArray(message)) {
        close(); show("Invalid companion response."); return;
      }
      if (!ready) {
        if (message.type !== "ready" || message.version !== 1 || Object.keys(message).length !== 2) {
          close(); show("Unsupported companion protocol."); return;
        }
        ready = true;
        request = crypto.randomUUID();
        current.postMessage({id: request, provider: "codex", method: "status", params: null});
        return;
      }
      if (message.id !== request || !message.event || typeof message.event !== "object") {
        close(); show("Unexpected companion event."); return;
      }
      const event = message.event;
      if (event.type === "status") {
        const status = event.status;
        const fields = ["availability", "authentication", "sign_in"];
        const allowed = new Set(["available", "unavailable", "missing", "unknown", "authenticated", "unauthenticated",
          "subscription", "api_key", "cloud"]);
        const safe = Object.fromEntries(fields.map(field => [field, allowed.has(status?.[field]) ? status[field] : "unknown"]));
        safe.tool_isolation = status?.capabilities?.tool_isolation === true;
        show(JSON.stringify({protocol: 1, provider: "codex", ...safe}, null, 2));
      } else if (event.type === "completed") {
        clearTimeout(timer);
      } else if (event.type === "failed") {
        close(); show("Status request refused. Check the Lineleaf provider grant.");
      } else {
        close(); show("Unexpected status response.");
      }
    });
  } catch {
    close(); show("Native messaging could not start.");
  }
});
