/*
 * Downlabs bulk sender — runs in WhatsApp Web's page context (injected by bulk-runner.js).
 * Uses WhatsApp Web's own modules so messages and media go through the normal
 * encrypt → upload → send pipeline. Talks to the content script with window.postMessage
 * on a per-injection channel id.
 */
(function () {
  "use strict";

  const script = document.currentScript;
  const CHANNEL = script && script.dataset.channel;
  if (!CHANNEL || window.__downlabsBulkPage === CHANNEL) return;
  window.__downlabsBulkPage = CHANNEL;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const req = (name) => {
    if (typeof window.require !== "function") throw new Error("WhatsApp is still loading");
    return window.require(name);
  };
  const reply = (id, result) => window.postMessage({ channel: CHANNEL, dir: "res", id, result }, "*");
  const emit = (event, data) => window.postMessage({ channel: CHANNEL, dir: "event", event, data }, "*");

  function serialize(wid) {
    return wid ? String(wid._serialized || (typeof wid.toString === "function" ? wid.toString() : wid)) : "";
  }

  function isReady() {
    try {
      const socket = req("WAWebSocketModel").Socket;
      const stream = req("WAWebStreamModel").Stream;
      return socket && socket.state === "CONNECTED" && (!stream || !stream.mode || stream.mode === "MAIN");
    } catch {
      return false;
    }
  }

  function phoneOf(wid) {
    try {
      if (wid && wid.server === "lid") {
        const pn = req("WAWebApiContact").getPhoneNumber(wid);
        return pn ? String(pn.user || serialize(pn).split("@")[0]) : "";
      }
      return wid ? String(wid.user || serialize(wid).split("@")[0]) : "";
    } catch {
      return "";
    }
  }

  async function resolveChat(phone) {
    const WidFactory = req("WAWebWidFactory");
    const wid = WidFactory.createWid(`${phone}@c.us`);
    const exists = await req("WAWebQueryExistsJob").queryWidExists(wid);
    if (!exists || !exists.wid) return { error: "not_on_whatsapp" };
    const Chat = req("WAWebCollections").Chat;
    let chat = Chat.get(exists.wid) || Chat.get(wid);
    if (!chat) {
      const found = await req("WAWebFindChatAction").findOrCreateLatestChat(wid);
      chat = found && (found.chat || found);
    }
    if (!chat) return { error: "chat_not_found" };
    return { chat, ids: [serialize(exists.wid), serialize(wid)] };
  }

  async function simulateTyping(chat, ms) {
    let presence = null;
    try {
      const mod = req("WAWebPresenceChatAction");
      presence = mod && (mod.markComposing ? mod : mod.default);
    } catch {}
    if (!presence || typeof presence.markComposing !== "function") return;
    const until = Date.now() + ms;
    while (Date.now() < until) {
      try { presence.markComposing(chat); } catch {}
      await sleep(Math.min(2500, until - Date.now()));
    }
    try { presence.markPaused(chat); } catch {}
  }

  // Same message construction the extension's existing text sender uses.
  async function sendText(chat, body) {
    const WidFactory = req("WAWebWidFactory");
    const userPrefs = req("WAWebUserPrefsMeUser");
    const MsgKeyRaw = req("WAWebMsgKey");
    const MsgKey = typeof MsgKeyRaw === "function" ? MsgKeyRaw : MsgKeyRaw.default;
    const lidUser = userPrefs.getMaybeMeLidUser ? userPrefs.getMaybeMeLidUser() : null;
    const meUser = userPrefs.getMaybeMePnUser ? userPrefs.getMaybeMePnUser() : null;
    const from = chat.id && typeof chat.id.isLid === "function" && chat.id.isLid() ? lidUser : meUser;
    const id = await MsgKeyRaw.newId();
    const key = new MsgKey({ from, to: chat.id, id, participant: undefined, selfDir: "out" });
    let ephemeral = {};
    try {
      const eph = req("WAWebGetEphemeralFieldsMsgActionsUtils");
      if (eph && typeof eph.getEphemeralFields === "function") ephemeral = eph.getEphemeralFields(chat);
    } catch {}
    const msg = {
      id: key,
      ack: 0,
      body,
      from,
      to: chat.id,
      local: true,
      self: "out",
      t: Math.floor(Date.now() / 1000),
      isNewMsg: true,
      type: "chat",
      ...ephemeral
    };
    const ret = req("WAWebSendMsgChatAction").addAndSendMsgToChat(chat, msg);
    const [added, sent] = Array.isArray(ret) ? ret : [ret, null];
    if (added && typeof added.then === "function") await added;
    const result = sent && typeof sent.then === "function" ? await sent : null;
    const status = result && (result.messageSendResult || result.status);
    if (status && status !== "OK") throw new Error(`WhatsApp returned ${status}`);
  }

  async function sendMedia(chat, media, caption) {
    const file = new File([media.buffer], media.name || "file", { type: media.type });
    const opaque = await req("WAWebMediaOpaqueData").createFromData(file, file.type);
    // Images and videos should use WhatsApp's native media viewers. PDFs stay
    // documents; treating a video as a document makes it arrive as a download
    // instead of a playable video in the recipient's chat. Current WhatsApp
    // builds select the VIDEO outward type through the asGif option.
    const asDocument = file.type === "application/pdf";
    const isAudio = /^audio\//.test(file.type);
    const prep = req("WAWebPrepRawMedia").prepRawMedia(opaque, { asDocument, asGif: false, isAudio });
    await prep.waitForPrep();
    // Documents only display a caption when the message is flagged isCaptionByUser (otherwise
    // WhatsApp treats it as file metadata). sendMediaMsgToChat merges productMsgOptions into the
    // outgoing message last, which is the one way to set that flag through this API.
    const options = caption ? { caption, productMsgOptions: { isCaptionByUser: true } } : {};
    const result = await prep.sendToChat({ chat, options });
    const status = result && (result.messageSendResult || result.status);
    if (status && status !== "OK") throw new Error(`WhatsApp returned ${status}`);
  }

  async function send({ phone, text, media, typingMs, optOutIds }) {
    if (!isReady()) return { ok: false, code: "not_connected", error: "WhatsApp is not connected" };
    const resolved = await resolveChat(phone);
    if (resolved.error) return { ok: false, code: resolved.error, error: resolved.error === "not_on_whatsapp" ? "Number is not on WhatsApp" : "Could not open chat" };
    if (Array.isArray(optOutIds) && resolved.ids.some((id) => optOutIds.includes(id))) {
      return { ok: false, code: "opted_out", error: "Contact opted out" };
    }
    if (typingMs > 0) await simulateTyping(resolved.chat, typingMs);
    const mediaItems = Array.isArray(media) ? media : (media && media.buffer ? [media] : []);
    if (mediaItems.length) {
      for (let i = 0; i < mediaItems.length; i++) {
        const item = mediaItems[i];
        const hasCaption = Object.prototype.hasOwnProperty.call(item, "caption");
        const caption = hasCaption ? String(item.caption || "") : (i === mediaItems.length - 1 ? text : "");
        await sendMedia(resolved.chat, item, caption);
      }
    }
    else await sendText(resolved.chat, text);
    return { ok: true, chatId: resolved.ids[0] };
  }

  // Saves recipients as WhatsApp contacts. Existing contacts are never renamed and numbers
  // that are not on WhatsApp are skipped. Never passes prevPhoneNumber: when it differs from
  // phoneNumber, WhatsApp deletes that other contact.
  async function saveContacts({ items, syncToAddressbook }) {
    if (!isReady()) return { ok: false, code: "not_connected", error: "WhatsApp is not connected" };
    const Save = req("WAWebSaveContactAction");
    if (!Save || typeof Save.saveContactBatchAction !== "function") return { ok: false, code: "unsupported", error: "This WhatsApp version cannot save contacts" };
    const WidFactory = req("WAWebWidFactory");
    const Contact = req("WAWebCollections").Contact;
    const results = [];
    const toSave = [];
    for (const item of items || []) {
      const phone = String(item.phone || "").replace(/\D/g, "");
      try {
        const wid = WidFactory.createWid(`${phone}@c.us`);
        const exists = await req("WAWebQueryExistsJob").queryWidExists(wid);
        if (!exists || !exists.wid) { results.push({ phone, status: "not_on_whatsapp" }); continue; }
        const existing = Contact.get(exists.wid) || Contact.get(wid);
        if (existing && (existing.isAddressBookContact || existing.name)) { results.push({ phone, status: "exists", name: existing.name || "" }); continue; }
        toSave.push({ phone, firstName: String(item.firstName || "").trim(), lastName: String(item.lastName || "").trim() });
      } catch (err) {
        results.push({ phone, status: "failed", error: (err && err.message) || String(err) });
      }
    }
    const entry = (i) => ({ firstName: i.firstName, lastName: i.lastName, phoneNumber: i.phone, syncToAddressbook: !!syncToAddressbook });
    if (toSave.length) {
      try {
        await Save.saveContactBatchAction(toSave.map(entry));
        for (const i of toSave) results.push({ phone: i.phone, status: "saved", name: [i.firstName, i.lastName].filter(Boolean).join(" ") });
      } catch {
        // Fall back to one at a time so a single bad entry does not fail the whole chunk.
        for (const i of toSave) {
          try {
            await Save.saveContactAction(entry(i));
            results.push({ phone: i.phone, status: "saved", name: [i.firstName, i.lastName].filter(Boolean).join(" ") });
          } catch (err) {
            results.push({ phone: i.phone, status: "failed", error: (err && err.message) || String(err) });
          }
          await sleep(400);
        }
      }
    }
    return { ok: true, results };
  }

  // Incoming messages → content script (opt-outs and reply tracking).
  function watchIncoming() {
    try {
      const Msg = req("WAWebCollections").Msg;
      Msg.on("add", (m) => {
        try {
          if (!m || !m.isNewMsg || !m.id || m.id.fromMe) return;
          const chatWid = m.id.remote;
          if (!chatWid || (typeof chatWid.isGroup === "function" && chatWid.isGroup())) return;
          emit("incoming", { chatId: serialize(chatWid), phone: phoneOf(chatWid), body: typeof m.body === "string" && m.type === "chat" ? m.body.slice(0, 200) : "" });
        } catch {}
      });
      return true;
    } catch {
      return false;
    }
  }

  (async function waitForStore() {
    for (let i = 0; i < 240 && !watchIncoming(); i++) await sleep(1000);
  })();

  window.addEventListener("message", async (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.channel !== CHANNEL || d.dir !== "req") return;
    try {
      if (d.action === "ready") reply(d.id, { ok: true, ready: isReady() });
      else if (d.action === "send") reply(d.id, await send(d.payload || {}));
      else if (d.action === "saveContacts") reply(d.id, await saveContacts(d.payload || {}));
      else reply(d.id, { ok: false, error: "Unknown action" });
    } catch (err) {
      reply(d.id, { ok: false, code: "error", error: (err && err.message) || String(err) });
    }
  });

  emit("loaded", { ready: isReady() });
})();
