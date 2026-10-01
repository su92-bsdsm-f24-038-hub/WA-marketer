"use strict";
(() => {
  // src/content/wa-reaction-page.ts
  (function() {
    const ATTR = "data-smartdm-wa-reaction";
    const EVT = "smartdm-wa-reaction-result";
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
    const messageId = (payload.messageId || "").trim();
    const emoji = payload.emoji ?? "";
    function done(success, error) {
      window.dispatchEvent(
        new CustomEvent(EVT, {
          detail: { requestId, success, error: error || void 0 }
        })
      );
    }
    if (!messageId) {
      done(false, "Missing messageId");
      return;
    }
    void async function() {
      try {
        const req = window.require;
        if (typeof req !== "function") {
          done(false, "window.require is not available");
          return;
        }
        const Collections = req("WAWebCollections");
        const reactionAction = req("WAWebSendReactionMsgAction");
        const sendReactionToMsg = reactionAction?.sendReactionToMsg;
        if (typeof sendReactionToMsg !== "function") {
          done(false, "WAWebSendReactionMsgAction.sendReactionToMsg missing");
          return;
        }
        let msg = typeof Collections?.Msg?.get === "function" ? Collections.Msg.get(messageId) : null;
        if (!msg && typeof Collections?.Msg?.getMessagesById === "function") {
          try {
            const loaded = await Collections.Msg.getMessagesById([messageId]);
            const pack = loaded;
            msg = pack?.messages?.[0] ?? null;
          } catch {
            msg = null;
          }
        }
        if (!msg) {
          done(false, "Message not found in client memory");
          return;
        }
        await sendReactionToMsg(msg, emoji);
        done(true);
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        done(false, err || "Reaction failed");
      }
    }();
  })();
})();
