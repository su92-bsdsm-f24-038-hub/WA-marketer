"use strict";
(() => {
  // src/content/wa-presence-page.ts
  (function() {
    const ATTR = "data-smartdm-wa-presence";
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
    const widStr = payload.widStr || "";
    const action = payload.action;
    if (!widStr)
      return;
    const GKEY = "__smartdm_typ_" + widStr.replace(/[^0-9]/g, "_");
    const win = window;
    function getRequire() {
      return typeof win.require === "function" ? win.require : void 0;
    }
    function getRequireLazy() {
      if (typeof win.requireLazy === "function")
        return win.requireLazy;
      return void 0;
    }
    function loadPresenceModule(W2) {
      try {
        const raw = W2("WAWebPresenceChatAction");
        if (!raw || typeof raw !== "object")
          return null;
        const d = raw.default;
        if (d && typeof d === "object" && d !== null && ("markComposing" in d || "markPaused" in d)) {
          return d;
        }
        if ("markComposing" in raw || "markPaused" in raw)
          return raw;
      } catch {
      }
      return null;
    }
    function withPresence(W2, cb) {
      const sync = loadPresenceModule(W2);
      if (sync && (typeof sync.markComposing === "function" || typeof sync.markPaused === "function")) {
        cb(sync);
        return;
      }
      const lazy = getRequireLazy();
      if (typeof lazy !== "function") {
        console.warn("[Downlabs WA Presence] WAWebPresenceChatAction unavailable (no sync module, no requireLazy)");
        return;
      }
      lazy(["WAWebPresenceChatAction"], function(Presence) {
        const p = Presence;
        if (p && (typeof p.markComposing === "function" || typeof p.markPaused === "function"))
          cb(p);
      });
    }
    if (action === "stop") {
      const h = window[GKEY];
      if (h?.iv)
        clearInterval(h.iv);
      const savedChat = h?.chat;
      try {
        delete window[GKEY];
      } catch {
      }
      if (!savedChat)
        return;
      const W2 = getRequire();
      if (!W2)
        return;
      withPresence(W2, function(Presence) {
        try {
          if (typeof Presence.markPaused === "function")
            Presence.markPaused(savedChat);
        } catch {
        }
      });
      return;
    }
    if (action !== "start")
      return;
    const old = window[GKEY];
    if (old?.iv)
      clearInterval(old.iv);
    try {
      delete window[GKEY];
    } catch {
    }
    const W = getRequire();
    if (!W)
      return;
    const renewMs = 2500;
    function runWithChat(W2, c) {
      const chat = c;
      if (!chat || !chat.id) {
        console.warn("[Downlabs WA Presence] No chat model \u2014 open thread or wait for sync");
        return;
      }
      withPresence(W2, function(Presence) {
        if (typeof Presence.markComposing !== "function") {
          console.warn("[Downlabs WA Presence] markComposing missing on WAWebPresenceChatAction");
          return;
        }
        try {
          Presence.markComposing(chat);
        } catch {
        }
        const iv = setInterval(function() {
          try {
            Presence.markComposing(chat);
          } catch {
          }
        }, renewMs);
        window[GKEY] = { iv, chat };
      });
    }
    try {
      const wf = W("WAWebWidFactory");
      const Chat = W("WAWebCollections");
      const createWid = wf?.createWid;
      const chatGet = Chat?.Chat?.get;
      if (typeof createWid !== "function" || typeof chatGet !== "function")
        return;
      const wid = createWid(widStr);
      const existing = chatGet(wid);
      if (existing) {
        runWithChat(W, existing);
        return;
      }
      const F = W("WAWebFindChatAction");
      if (F && typeof F.findOrCreateLatestChat === "function") {
        void F.findOrCreateLatestChat(wid).then(function(res) {
          const chatObj = res;
          const chat = chatObj && (chatObj.chat ?? chatObj);
          runWithChat(W, chat);
        });
      }
    } catch {
    }
  })();
})();
