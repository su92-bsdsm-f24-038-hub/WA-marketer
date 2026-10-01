"use strict";
(() => {
  // src/content/wa-store-send-page.ts
  (function() {
    const ATTR = "data-smartdm-wa-send";
    const EVT = "smartdm-wa-store-send-result";
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
    const widStr = payload.widStr || "";
    const msg = payload.message ?? "";
    const quotedMsgId = typeof payload.quotedMsgId === "string" ? payload.quotedMsgId.trim() : "";
    function done(success, error) {
      window.dispatchEvent(
        new CustomEvent(EVT, {
          detail: { requestId, success, error: error || void 0 }
        })
      );
    }
    if (!widStr || typeof msg !== "string") {
      done(false, "Invalid payload");
      return;
    }
    void async function() {
      try {
        const req = window.require;
        if (typeof req !== "function") {
          done(false, "window.require is not available");
          return;
        }
        const widFactory = req("WAWebWidFactory");
        const Collections = req("WAWebCollections");
        const findChat = req("WAWebFindChatAction");
        const createWid = widFactory?.createWid;
        const findOrCreateLatestChat = findChat?.findOrCreateLatestChat;
        if (typeof createWid !== "function" || typeof findOrCreateLatestChat !== "function") {
          done(false, "WA store modules missing expected exports");
          return;
        }
        const wid = createWid(widStr);
        try {
          const ApiContact = req("WAWebApiContact");
          const QueryExists = req("WAWebQueryExistsJob");
          const wAny = wid;
          const isLidServer = wAny && wAny.server === "lid";
          if (!isLidServer && typeof ApiContact?.getCurrentLid === "function" && typeof QueryExists?.queryWidExists === "function" && !ApiContact.getCurrentLid(wid)) {
            await QueryExists.queryWidExists(wid);
          }
        } catch {
        }
        let chat = typeof Collections?.Chat?.get === "function" ? Collections.Chat.get(wid) : null;
        if (!chat) {
          const chatObj = await findOrCreateLatestChat(wid);
          chat = chatObj && (chatObj.chat ?? chatObj);
        }
        if (!chat) {
          done(false, "Chat not found");
          return;
        }
        let quotedMsgOptions = {};
        if (quotedMsgId) {
          let quotedMessage = typeof Collections?.Msg?.get === "function" ? Collections.Msg.get(quotedMsgId) : null;
          if (!quotedMessage && typeof Collections?.Msg?.getMessagesById === "function") {
            try {
              const loaded = await Collections.Msg.getMessagesById([quotedMsgId]);
              const pack = loaded;
              quotedMessage = pack?.messages?.[0] ?? null;
            } catch {
              quotedMessage = null;
            }
          }
          if (!quotedMessage) {
            done(false, "Quoted message not found");
            return;
          }
          const ReplyUtils = req("WAWebMsgReply");
          let canReply = false;
          try {
            if (ReplyUtils && typeof ReplyUtils.canReplyMsg === "function") {
              const unsafe = quotedMessage && typeof quotedMessage.unsafe === "function" ? quotedMessage.unsafe() : quotedMessage;
              canReply = !!ReplyUtils.canReplyMsg(unsafe);
            } else if (quotedMessage && typeof quotedMessage.canReply === "function") {
              canReply = !!quotedMessage.canReply();
            }
          } catch {
            canReply = false;
          }
          if (!canReply) {
            done(false, "Cannot reply to this message type");
            return;
          }
          try {
            if (typeof quotedMessage.msgContextInfo === "function") {
              quotedMsgOptions = quotedMessage.msgContextInfo(chat);
            }
          } catch {
            quotedMsgOptions = {};
          }
        }
        const userPrefs = req("WAWebUserPrefsMeUser");
        const MsgKeyRaw = req("WAWebMsgKey");
        const lidUser = typeof userPrefs?.getMaybeMeLidUser === "function" ? userPrefs.getMaybeMeLidUser() : null;
        const meUser = typeof userPrefs?.getMaybeMePnUser === "function" ? userPrefs.getMaybeMePnUser() : null;
        const chatAny = chat;
        const MsgKeyCtor = typeof MsgKeyRaw === "function" ? MsgKeyRaw : MsgKeyRaw.default;
        const newIdFn = MsgKeyRaw.newId;
        if (typeof newIdFn !== "function" || typeof MsgKeyCtor !== "function") {
          done(false, "WAWebMsgKey API missing");
          return;
        }
        const newId = await newIdFn.call(MsgKeyRaw);
        let from = chatAny.id && typeof chatAny.id.isLid === "function" && chatAny.id.isLid() ? lidUser : meUser;
        let participant;
        if (chatAny.id && typeof chatAny.id.isGroup === "function" && chatAny.id.isGroup()) {
          from = chatAny.groupMetadata && chatAny.groupMetadata.isLidAddressingMode ? lidUser : meUser;
          if (typeof widFactory.asUserWidOrThrow === "function") {
            participant = widFactory.asUserWidOrThrow(from);
          }
        }
        if (chatAny.id && typeof chatAny.id.isStatus === "function" && chatAny.id.isStatus()) {
          if (typeof widFactory.asUserWidOrThrow === "function") {
            participant = widFactory.asUserWidOrThrow(from);
          }
        }
        const newMsgKey = new MsgKeyCtor({
          from,
          to: chatAny.id,
          id: newId,
          participant,
          selfDir: "out"
        });
        const ephemeralMod = req("WAWebGetEphemeralFieldsMsgActionsUtils");
        const ephemeralFields = typeof ephemeralMod?.getEphemeralFields === "function" ? ephemeralMod.getEphemeralFields(chat) : {};
        const messageObj = {
          id: newMsgKey,
          ack: 0,
          body: msg,
          from,
          to: chatAny.id,
          local: true,
          self: "out",
          t: Math.floor(Date.now() / 1e3),
          isNewMsg: true,
          type: "chat",
          ...ephemeralFields,
          ...quotedMsgOptions
        };
        const sendChatAction = req("WAWebSendMsgChatAction");
        if (!sendChatAction || typeof sendChatAction.addAndSendMsgToChat !== "function") {
          done(false, "WAWebSendMsgChatAction.addAndSendMsgToChat missing");
          return;
        }
        const ret = sendChatAction.addAndSendMsgToChat(chat, messageObj);
        const msgPromise = Array.isArray(ret) ? ret[0] : ret;
        if (msgPromise && typeof msgPromise.then === "function") {
          await msgPromise;
        }
        done(true);
      } catch (err) {
        const e = err;
        done(false, e?.message || e?.stack || String(err));
      }
    }();
  })();
})();
