"use strict";
(() => {
  // src/content/wa-message-body-page.ts
  (function() {
    const ATTR = "data-smartdm-wa-msg-body";
    const RESULT = "SMARTDM_WA_MSG_BODY_RESULT";
    const enc = document.documentElement.getAttribute(ATTR);
    if (!enc)
      return;
    document.documentElement.removeAttribute(ATTR);
    let payload;
    try {
      payload = JSON.parse(decodeURIComponent(escape(atob(enc))));
    } catch {
      return;
    }
    const requestId = payload.requestId || "";
    const messageId = payload.messageId || "";
    if (!requestId || !messageId)
      return;
    function reply(text) {
      window.postMessage({ type: RESULT, requestId, text: text ?? "" }, "*");
    }
    const win = window;
    if (typeof win.require !== "function") {
      reply(null);
      return;
    }
    try {
      const collections = win.require("WAWebCollections");
      const Chat = collections?.Chat;
      if (!Chat || typeof Chat.getModelsArray !== "function") {
        reply(null);
        return;
      }
      const chats = Chat.getModelsArray();
      for (let i = 0; i < chats.length; i++) {
        const chat = chats[i];
        const msgs = chat.msgs;
        if (!msgs || typeof msgs.getModelsArray !== "function")
          continue;
        const arr = msgs.getModelsArray();
        for (let j = 0; j < arr.length; j++) {
          const m = arr[j];
          if (m?.id?._serialized !== messageId)
            continue;
          const parts = [m.body, m.text, m.content, m.message, m.caption];
          let found = "";
          for (let k = 0; k < parts.length; k++) {
            const s = parts[k];
            if (typeof s === "string" && s.length > 0) {
              found = s;
              break;
            }
          }
          reply(found || null);
          return;
        }
      }
    } catch {
      reply(null);
      return;
    }
    reply(null);
  })();
})();
