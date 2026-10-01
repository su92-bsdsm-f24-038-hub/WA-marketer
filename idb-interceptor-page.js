"use strict";
(() => {
  // src/content/idb-interceptor-page.ts
  (function() {
    if (window.__smartdm_idb_interceptor)
      return;
    window.__smartdm_idb_interceptor = true;
    const MESSAGE_STORE = "message";
    const CONTACT_STORE = "contact";
    const pendingChatMessages = /* @__PURE__ */ new Map();
    const BODY_POLL_MS = 40;
    const BODY_WAIT_MS = 2e3;
    const emittedIds = /* @__PURE__ */ new Set();
    const MAX_EMITTED_IDS = 500;
    function parseMessageId(id) {
      if (!id)
        return { isIncoming: false, contactId: "" };
      const firstUnderscore = id.indexOf("_");
      if (firstUnderscore === -1)
        return { isIncoming: false, contactId: "" };
      const fromMeStr = id.substring(0, firstUnderscore);
      const rest = id.substring(firstUnderscore + 1);
      const isIncoming = fromMeStr === "false";
      let contactId = "";
      const atIndex = rest.indexOf("@");
      if (atIndex !== -1) {
        contactId = rest.substring(0, atIndex);
      }
      return { isIncoming, contactId };
    }
    function getMessageTextFromModel(m) {
      if (!m || typeof m !== "object")
        return "";
      const parts = [m.body, m.text, m.content, m.message, m.caption];
      for (let i = 0; i < parts.length; i++) {
        const s = parts[i];
        if (typeof s === "string" && s.length > 0)
          return s;
      }
      return "";
    }
    function findMessageModelBySerialized(serializedId) {
      const win = window;
      const req = win.require;
      if (typeof req !== "function")
        return null;
      try {
        const collections = req("WAWebCollections");
        const Chat = collections?.Chat;
        if (!Chat || typeof Chat.getModelsArray !== "function")
          return null;
        const chats = Chat.getModelsArray();
        for (let i = 0; i < chats.length; i++) {
          const chat = chats[i];
          const msgs = chat.msgs;
          if (!msgs || typeof msgs.getModelsArray !== "function")
            continue;
          const arr = msgs.getModelsArray();
          for (let j = 0; j < arr.length; j++) {
            const m = arr[j];
            if (m?.id?._serialized === serializedId)
              return arr[j];
          }
        }
      } catch (_e) {
        return null;
      }
      return null;
    }
    function tryResolveTextFromWAStore(messageId) {
      const m = findMessageModelBySerialized(messageId);
      return getMessageTextFromModel(m);
    }
    function mediaKeyToBase64(mediaKey) {
      if (!mediaKey)
        return null;
      if (typeof mediaKey === "string")
        return mediaKey;
      try {
        const bytes = new Uint8Array(mediaKey.buffer || mediaKey);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
      } catch {
        return null;
      }
    }
    function emitMessage(payload) {
      const id = payload.messageId;
      if (emittedIds.has(id))
        return;
      emittedIds.add(id);
      if (emittedIds.size > MAX_EMITTED_IDS) {
        const iter = emittedIds.values();
        for (let i = 0; i < 100; i++)
          iter.next();
        const arr = Array.from(emittedIds);
        emittedIds.clear();
        for (let i = arr.length - 400; i < arr.length; i++) {
          if (i >= 0)
            emittedIds.add(arr[i]);
        }
      }
      window.postMessage({
        type: "SMARTDM_IDB_MESSAGE",
        payload
      }, "*");
    }
    function handleMessageWrite(value) {
      if (!value || !value.id)
        return;
      const { isIncoming, contactId } = parseMessageId(value.id);
      const type = value.type || "";
      if (type !== "chat" && type !== "ptt" && type !== "image")
        return;
      const messageId = value.id;
      const timestamp = (value.t || 0) * 1e3;
      let bodyText = value.body || value.text || value.content || value.message || value.caption || "";
      if (!bodyText && (type === "chat" || type === "image")) {
        const fromStore = tryResolveTextFromWAStore(messageId);
        if (fromStore)
          bodyText = fromStore;
      }
      const payload = {
        messageId,
        type,
        timestamp,
        isIncoming,
        contactId,
        body: bodyText
      };
      if (type === "ptt" || type === "image") {
        payload.directPath = value.directPath || null;
        payload.mediaKey = mediaKeyToBase64(value.mediaKey);
        payload.mimetype = value.mimetype || (type === "ptt" ? "audio/ogg; codecs=opus" : "image/jpeg");
        if (type === "image") {
          const cap = value.caption || "";
          payload.caption = cap || (typeof bodyText === "string" ? bodyText : "") || "";
        }
      }
      if (emittedIds.has(messageId)) {
        return;
      }
      if (type === "chat") {
        const pending = pendingChatMessages.get(messageId);
        if (bodyText) {
          if (pending) {
            clearInterval(pending.intervalId);
            pendingChatMessages.delete(messageId);
          }
          emitMessage(payload);
        } else {
          if (!pending) {
            const started = Date.now();
            const intervalId = setInterval(() => {
              const late = tryResolveTextFromWAStore(messageId);
              if (late) {
                clearInterval(intervalId);
                pendingChatMessages.delete(messageId);
                if (!emittedIds.has(messageId)) {
                  payload.body = late;
                  emitMessage(payload);
                }
                return;
              }
              if (Date.now() - started >= BODY_WAIT_MS) {
                clearInterval(intervalId);
                pendingChatMessages.delete(messageId);
                if (!emittedIds.has(messageId))
                  emitMessage(payload);
              }
            }, BODY_POLL_MS);
            pendingChatMessages.set(messageId, { payload, intervalId });
          }
        }
      } else {
        emitMessage(payload);
      }
    }
    const SMARTDM_DB_NAME = "SmartDMDatabase";
    const WHATSAPP_CONTACTS_STORE = "whatsappContacts";
    const PAGE_DB_VERSION = 1;
    function handleContactWrite(value) {
      if (!value || !value.id)
        return;
      const phone = value.phoneNumber || "";
      const phoneSuffix = phone.replace(/\D/g, "").slice(-9);
      const request = indexedDB.open(SMARTDM_DB_NAME, PAGE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(WHATSAPP_CONTACTS_STORE)) {
          const store = db.createObjectStore(WHATSAPP_CONTACTS_STORE, { keyPath: "id" });
          store.createIndex("phoneSuffix", "phoneSuffix", { unique: false });
          store.createIndex("nameLower", "nameLower", { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        try {
          if (db.objectStoreNames.contains(WHATSAPP_CONTACTS_STORE)) {
            const tx = db.transaction(WHATSAPP_CONTACTS_STORE, "readwrite");
            tx.objectStore(WHATSAPP_CONTACTS_STORE).put({
              id: value.id,
              phoneNumber: phone,
              phoneSuffix: phoneSuffix.length === 9 ? phoneSuffix : "",
              name: value.name || "",
              nameLower: (value.name || "").toLowerCase(),
              pushname: value.pushname || "",
              isAddressBookContact: value.isAddressBookContact ?? 0,
              isContactSyncCompleted: value.isContactSyncCompleted ?? 0,
              updatedAt: Date.now()
            });
          }
        } catch (_e) {
        }
        db.close();
      };
      const id = value.id || "";
      const atIndex = id.indexOf("@");
      const contactId = atIndex !== -1 ? id.substring(0, atIndex) : id;
      if (contactId) {
        window.postMessage({
          type: "SMARTDM_IDB_CONTACT",
          payload: {
            contactId,
            phoneNumber: phone,
            pushname: value.pushname || "",
            name: value.name || ""
          }
        }, "*");
      }
    }
    function handleContactDelete(key) {
      const request = indexedDB.open(SMARTDM_DB_NAME);
      request.onsuccess = () => {
        const db = request.result;
        try {
          if (db.objectStoreNames.contains(WHATSAPP_CONTACTS_STORE)) {
            const tx = db.transaction(WHATSAPP_CONTACTS_STORE, "readwrite");
            tx.objectStore(WHATSAPP_CONTACTS_STORE).delete(key);
          }
        } catch (_e) {
        }
        db.close();
      };
    }
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      try {
        const storeName = this.name;
        if (storeName === MESSAGE_STORE) {
          handleMessageWrite(value);
        } else if (storeName === CONTACT_STORE) {
          handleContactWrite(value);
        }
      } catch (e) {
      }
      return originalPut.call(this, value, key);
    };
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function(value, key) {
      try {
        const storeName = this.name;
        if (storeName === MESSAGE_STORE) {
          handleMessageWrite(value);
        } else if (storeName === CONTACT_STORE) {
          handleContactWrite(value);
        }
      } catch (e) {
      }
      return originalAdd.call(this, value, key);
    };
    const originalDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function(key) {
      try {
        if (this.name === CONTACT_STORE) {
          handleContactDelete(key);
        }
      } catch (e) {
      }
      return originalDelete.call(this, key);
    };
  })();
})();
