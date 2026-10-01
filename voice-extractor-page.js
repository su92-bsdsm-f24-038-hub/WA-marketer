"use strict";
(() => {
  // src/content/voice-extractor-page.ts
  (function() {
    window.addEventListener("smartdm-extract-voice", function(e) {
      const detail = e.detail;
      const extractId = detail.extractId;
      const element = document.querySelector('[data-smartdm-extract-id="' + extractId + '"]');
      if (!element) {
        window.dispatchEvent(new CustomEvent("smartdm-voice-data", {
          detail: { extractId, error: "Element not found" }
        }));
        return;
      }
      function findFiber(el) {
        const keys = Object.keys(el);
        for (let i = 0; i < keys.length; i++) {
          if (keys[i].startsWith("__reactFiber$") || keys[i].startsWith("__reactInternalInstance$")) {
            return el[keys[i]];
          }
        }
        return null;
      }
      let fiber = null;
      let current = element;
      for (let depth = 0; depth < 30; depth++) {
        fiber = findFiber(current);
        if (fiber)
          break;
        current = current.parentElement;
        if (!current)
          break;
      }
      if (!fiber) {
        window.dispatchEvent(new CustomEvent("smartdm-voice-data", {
          detail: { extractId, error: "React fiber not found" }
        }));
        return;
      }
      let msg = null;
      let node = fiber;
      const visited = /* @__PURE__ */ new Set();
      for (let attempt = 0; attempt < 60 && node; attempt++) {
        if (visited.has(node))
          break;
        visited.add(node);
        const props = node.memoizedProps || node.pendingProps;
        if (props && props.msg) {
          msg = props.msg;
          break;
        }
        node = node.return;
      }
      if (!msg) {
        window.dispatchEvent(new CustomEvent("smartdm-voice-data", {
          detail: { extractId, error: "Message data not found in fiber tree" }
        }));
        return;
      }
      let mediaKeyB64 = null;
      if (msg.mediaKey) {
        if (typeof msg.mediaKey === "string") {
          mediaKeyB64 = msg.mediaKey;
        } else if (msg.mediaKey.buffer || msg.mediaKey instanceof Uint8Array) {
          const bytes = new Uint8Array(msg.mediaKey.buffer || msg.mediaKey);
          let binary = "";
          for (let k = 0; k < bytes.length; k++) {
            binary += String.fromCharCode(bytes[k]);
          }
          mediaKeyB64 = btoa(binary);
        }
      }
      const result = {
        extractId,
        directPath: msg.directPath || null,
        mediaKey: mediaKeyB64,
        mimetype: msg.mimetype || "audio/ogg; codecs=opus",
        type: msg.type || null,
        id: msg.id ? msg.id.id || msg.id._serialized || String(msg.id) : null,
        isFromMe: msg.id ? !!msg.id.fromMe : null,
        duration: msg.duration || null
      };
      window.dispatchEvent(new CustomEvent("smartdm-voice-data", { detail: result }));
    });
  })();
})();
