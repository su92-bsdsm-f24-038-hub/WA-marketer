/*
 * Downlabs bulk sender — campaign runner (content script on web.whatsapp.com).
 *
 * Campaigns live in chrome.storage (see DownlabsBulk). This script sends one message at a
 * time through wa-bulk-page.js, picking whichever running campaign is due next, applying the
 * pacing and safety rules, and survives reloads: after a restart it continues where it
 * stopped. The background worker pings it every 30 s so long delays keep working in a
 * background tab.
 */
(function () {
  "use strict";
  if (window.__downlabsBulkRunner) return;
  window.__downlabsBulkRunner = true;

  const B = globalThis.DownlabsBulk;
  const K = B.KEYS;
  const OWNER = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const SKIP_CODES = new Set(["not_on_whatsapp", "opted_out"]);
  const LEASE_MS = 5 * 60 * 1000;
  const ACTIVE = new Set(["running", "saving"]); // "saving" = save contacts only, no messages
  const CONTACT_CHUNK = 20;

  const get = (keys) => chrome.storage.local.get(keys);
  const set = (values) => chrome.storage.local.set(values);

  /** Read-modify-write on the freshest copy, so Pause/Stop/Edit from the page are never overwritten. */
  async function updateCampaign(id, mutate) {
    let kept = null;
    await B.patchCampaign(id, (c) => {
      const userStatus = c.status;
      mutate(c);
      if (userStatus !== "running" && c.status === "running") c.status = userStatus;
      kept = c;
    });
    return kept;
  }

  // ─── page bridge ──────────────────────────────────────────────────────────

  const CHANNEL = `dl-bulk-${OWNER}`;
  const pending = new Map();
  let pageLoaded = null;

  function injectPage() {
    if (pageLoaded) return pageLoaded;
    pageLoaded = new Promise((resolve) => {
      const onLoaded = (e) => {
        if (e.source === window && e.data && e.data.channel === CHANNEL && e.data.event === "loaded") {
          window.removeEventListener("message", onLoaded);
          resolve(true);
        }
      };
      window.addEventListener("message", onLoaded);
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL("wa-bulk-page.js");
      s.dataset.channel = CHANNEL;
      s.onload = () => s.remove();
      (document.head || document.documentElement).appendChild(s);
      setTimeout(() => resolve(false), 15000);
    });
    return pageLoaded;
  }

  function callPage(action, payload, timeoutMs = 180000) {
    return injectPage().then(() => new Promise((resolve) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, code: "timeout", error: "WhatsApp did not respond in time" });
      }, timeoutMs);
      pending.set(id, (result) => { clearTimeout(timer); resolve(result || { ok: false, error: "No response" }); });
      window.postMessage({ channel: CHANNEL, dir: "req", id, action, payload }, "*");
    }));
  }

  window.addEventListener("message", (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.channel !== CHANNEL) return;
    if (d.dir === "res" && pending.has(d.id)) {
      pending.get(d.id)(d.result);
      pending.delete(d.id);
    } else if (d.dir === "event" && d.event === "incoming") {
      onIncoming(d.data).catch(() => {});
    }
  });

  // ─── media ────────────────────────────────────────────────────────────────

  let mediaCache = { key: null, media: null };

  function dataUrlToBuffer(dataUrl) {
    const bin = atob(String(dataUrl).split(",")[1] || "");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  async function loadMedia(campaign) {
    const metadata = Array.isArray(campaign.attachments) && campaign.attachments.length ? campaign.attachments : (campaign.attachment ? [campaign.attachment] : []);
    if (!metadata.length) return null;
    const key = `${campaign.id}:${metadata.map((a) => a.version || 0).join(",")}`;
    if (mediaCache.key === key) return mediaCache.media;
    const stored = await B.getAttachments(campaign.id);
    if (!stored.length || stored.some((a) => !a || !a.dataUrl)) throw new Error("Attachment file is missing — edit the campaign and attach it again.");
    mediaCache = { key, media: stored.map((a) => {
      const item = { buffer: dataUrlToBuffer(a.dataUrl), type: a.type, name: a.name };
      if (a.caption) item.caption = a.caption;
      return item;
    }) };
    return mediaCache.media;
  }

  // ─── opt-outs & replies ───────────────────────────────────────────────────

  async function loadOptOut() {
    const o = (await get([K.optOut]))[K.optOut] || {};
    return { phones: Array.isArray(o.phones) ? o.phones : [], ids: Array.isArray(o.ids) ? o.ids : [] };
  }

  async function onIncoming({ chatId, phone, body }) {
    const campaigns = await B.listCampaigns();
    const settings = B.normalizeSettings((campaigns[0] && campaigns[0].settings) || {});
    const digits = B.digitsOnly(phone);
    if (settings.respectOptOut && B.optOutMatcher(settings)(body)) {
      const o = await loadOptOut();
      if (digits && !o.phones.includes(digits)) o.phones.push(digits);
      if (chatId && !o.ids.includes(chatId)) o.ids.push(chatId);
      await set({ [K.optOut]: { phones: o.phones.slice(-20000), ids: o.ids.slice(-20000) } });
    }
    // Credit the reply to the most recent campaign that messaged this contact.
    for (const c of campaigns) {
      const idx = c.recipients.findIndex((r, i) => {
        const res = c.results[i];
        return res && res.status === "sent" && !res.replied && (r.phone === digits || (chatId && res.chatId === chatId));
      });
      if (idx < 0) continue;
      await B.patchCampaign(c.id, (x) => {
        if (x.results[idx] && !x.results[idx].replied) {
          x.results[idx].replied = true;
          x.counts.replied = (x.counts.replied || 0) + 1;
        }
      });
      return;
    }
  }

  // ─── sending ──────────────────────────────────────────────────────────────

  function typingMsFor(text, settings) {
    if (!settings.typingSimulation) return 0;
    const base = 1500 + Math.min(String(text).length, 400) * 35;
    return Math.round(Math.min(9000, base) * (0.8 + Math.random() * 0.4));
  }

  async function sendOne(recipient, template, settings, media, optOut) {
    const text = B.withFooter(B.renderMessage(template, recipient), settings);
    if (!text && !(Array.isArray(media) ? media.length : media)) return { ok: false, code: "empty", error: "Message is empty" };
    const res = await callPage("send", {
      phone: recipient.phone,
      text,
      media,
      typingMs: typingMsFor(text, settings),
      optOutIds: settings.respectOptOut ? optOut.ids : []
    });
    return { ...res, text };
  }

  async function bumpDaily() {
    const today = B.todayKey();
    const d = (await get([K.daily]))[K.daily];
    await set({ [K.daily]: { date: today, count: d && d.date === today ? d.count + 1 : 1 } });
  }

  async function sentToday() {
    const d = (await get([K.daily]))[K.daily];
    return d && d.date === B.todayKey() ? d.count : 0;
  }

  function notify(title, message) {
    chrome.runtime.sendMessage({
      type: "SMARTDM_CREATE_BASIC_NOTIFICATION",
      payload: { notificationId: `dl-bulk-${Date.now()}`, title, message, clearAfterMs: 15000 }
    }).catch(() => {});
  }

  function timeLabel(d) {
    return d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  }

  // ─── plan quota (kept by the background worker, see license.js) ──────────

  /** Reserves one outgoing message on the free plan's daily quota (always granted on trial/Pro). */
  async function reserveQuota(source) {
    try {
      const q = await chrome.runtime.sendMessage({ type: "WAM_QUOTA_CONSUME", count: 1, source });
      if (q && typeof q.allowed === "boolean") return q;
    } catch {}
    return { allowed: false, unavailable: true, message: "Waiting for the extension to respond — retrying in 1 min" };
  }

  function releaseQuota(source) {
    chrome.runtime.sendMessage({ type: "WAM_QUOTA_REFUND", count: 1, source }).catch(() => {});
  }

  /** When to try again after a refusal: a minute after midnight, or in a minute if the worker was busy. */
  function quotaRetryAt(q) {
    return q.unavailable ? Date.now() + 60000 : (q.resetsAt || Date.now() + 3600000) + 60000;
  }

  async function quotaNote(q) {
    if (q.unavailable) return q.message;
    const at = new Date(quotaRetryAt(q));
    const today = B.todayKey();
    const seen = (await get(["wamQuotaNotice"])).wamQuotaNotice;
    if (seen !== today) {
      await set({ wamQuotaNotice: today });
      notify("Free plan daily limit reached", `${q.dailyLimit} of ${q.dailyLimit} messages sent today. Sending resumes ${timeLabel(at)} — upgrade to Pro for unlimited messages.`);
    }
    return `Free plan limit of ${q.dailyLimit} messages/day reached — resumes ${timeLabel(at)}. Upgrade to Pro for unlimited sending.`;
  }

  async function acquireLease() {
    const lease = (await get([K.lease]))[K.lease];
    if (lease && lease.owner !== OWNER && lease.until > Date.now()) return false;
    await set({ [K.lease]: { owner: OWNER, until: Date.now() + LEASE_MS } });
    const check = (await get([K.lease]))[K.lease];
    return !!check && check.owner === OWNER;
  }

  async function releaseLease() {
    const lease = (await get([K.lease]))[K.lease];
    if (lease && lease.owner === OWNER) await set({ [K.lease]: null });
  }

  async function dueCampaign() {
    const running = (await B.listCampaigns()).filter((c) => ACTIVE.has(c.status));
    const now = Date.now();
    return running.filter((c) => (c.nextSendAt || 0) <= now).sort((a, b) => (a.nextSendAt || 0) - (b.nextSendAt || 0))[0] || null;
  }

  function contactSummary(k) {
    const parts = [`${k.saved || 0} saved`];
    if (k.exists) parts.push(`${k.exists} already in contacts`);
    if (k.not_on_whatsapp) parts.push(`${k.not_on_whatsapp} not on WhatsApp`);
    if (k.failed) parts.push(`${k.failed} failed`);
    return parts.join(", ");
  }

  async function saveContactsStep(c, settings, pending) {
    const id = c.id;
    const finish = (x) => {
      if (x.status === "saving") {
        x.status = x.statusBeforeSaving || "draft";
        x.statusBeforeSaving = null;
        x.note = `Contacts saved — ${contactSummary(x.contactCounts || {})}.`;
        notify(`“${x.name}” contacts saved`, contactSummary(x.contactCounts || {}));
      } else {
        x.note = `Contacts saved — ${contactSummary(x.contactCounts || {})}. Starting to send…`;
      }
      x.nextSendAt = Date.now() + 3000;
    };
    if (!pending) {
      await updateCampaign(id, finish);
      return;
    }
    const ready = await callPage("ready", {}, 20000);
    if (!ready.ok || !ready.ready) {
      await updateCampaign(id, (x) => { x.nextSendAt = Date.now() + 60000; x.note = "Waiting for WhatsApp Web to connect…"; });
      return;
    }
    const start = c.contactCursor || 0;
    const chunk = c.recipients.slice(start, start + CONTACT_CHUNK);
    const names = B.contactNames(c.recipients, settings, c.name);
    const res = await callPage("saveContacts", {
      items: chunk.map((r, k) => ({ phone: r.phone, firstName: names[start + k].firstName, lastName: names[start + k].lastName })),
      syncToAddressbook: settings.contactSyncToPhone
    }, 300000);
    if (!res.ok && (res.code === "not_connected" || res.code === "timeout")) {
      await updateCampaign(id, (x) => { x.nextSendAt = Date.now() + 60000; x.note = `${res.error} — retrying contact saving in 1 min`; });
      return;
    }
    const byPhone = new Map(((res.ok && res.results) || []).map((r) => [r.phone, r]));
    await updateCampaign(id, (x) => {
      if ((x.contactCursor || 0) !== start) return; // list changed meanwhile
      x.contactResults = x.contactResults || [];
      x.contactCounts = x.contactCounts || {};
      chunk.forEach((r, k) => {
        const out = byPhone.get(r.phone) || { status: "failed", error: res.error || "No result" };
        x.contactResults[start + k] = { status: out.status, name: out.name || "", error: out.error || "", at: Date.now() };
        x.contactCounts[out.status] = (x.contactCounts[out.status] || 0) + 1;
      });
      x.contactCursor = start + chunk.length;
      if (x.contactCursor >= x.recipients.length) finish(x);
      else {
        x.note = `Saving contacts ${x.contactCursor}/${x.recipients.length} — ${contactSummary(x.contactCounts)}`;
        x.nextSendAt = Date.now() + 4000 + Math.random() * 5000;
      }
    });
  }

  async function dueFollowup() {
    const flows = (await B.listFollowupFlows()).filter((f) => f.status === "active");
    if (!flows.length) return null;
    const campaigns = await B.listCampaigns();
    const now = Date.now();
    for (const flow of flows) {
      if ((flow.nextRunAt || 0) > now) continue;
      const campaign = campaigns.find((c) => c.id === flow.campaignId);
      if (!campaign) continue;
      const sent = flow.sent || {};
      for (let index = 0; index < campaign.recipients.length; index++) {
        const result = campaign.results && campaign.results[index];
        if (!result || result.status !== "sent" || result.replied || !result.at) continue;
        for (const step of (flow.steps || []).slice().sort((a, b) => a.days - b.days)) {
          const key = campaign.id + ":" + index + ":" + step.days;
          if (sent[key]) continue;
          const dueAt = result.at + Number(step.days || 0) * 86400000;
          if (dueAt <= now) return { flow, campaign, index, step, key };
        }
      }
    }
    return null;
  }

  async function runFollowupStep() {
    const due = await dueFollowup();
    if (!due) return;
    const { flow, campaign, index, step, key } = due;
    const settings = B.normalizeSettings(campaign.settings);
    const recipient = campaign.recipients[index];
    const optOut = await loadOptOut();
    let result;
    if (settings.respectOptOut && optOut.phones.includes(recipient.phone)) {
      result = { ok: false, code: "opted_out", error: "Contact opted out" };
    } else {
      const quota = await reserveQuota("followup");
      if (!quota.allowed) {
        const note = await quotaNote(quota);
        await B.patchFollowupFlow(flow.id, (f) => { f.nextRunAt = quotaRetryAt(quota); f.quotaBlocked = !quota.unavailable; f.note = note; });
        return;
      }
      try {
        result = await sendOne(recipient, step.message, settings, null, optOut);
      } catch (err) {
        result = { ok: false, code: "error", error: (err && err.message) || String(err) };
      }
      if (!result.ok) releaseQuota("followup");
    }
    await B.patchFollowupFlow(flow.id, (f) => {
      f.sent = f.sent || {};
      f.quotaBlocked = false;
      f.note = "";
      if (result.ok || SKIP_CODES.has(result.code)) {
        f.sent[key] = { status: result.ok ? "sent" : "skipped", at: Date.now(), error: result.ok ? "" : result.error };
        // Same human-like pacing as the campaign itself; skipped numbers move on quickly.
        f.nextRunAt = Date.now() + (result.ok ? B.nextDelayMs(settings) : 5000);
      } else {
        f.nextRunAt = Date.now() + 60000;
      }
    });
    if (result.ok) {
      chrome.runtime.sendMessage({
        type: "LOG_MESSAGE",
        payload: {
          phoneNumber: "+" + recipient.phone,
          contactName: recipient.name,
          direction: "outgoing",
          type: "followup",
          content: result.text,
          campaignId: campaign.id,
          status: "sent",
          timestamp: new Date().toISOString(),
          metadata: { source: "marketing-followup", flowId: flow.id, stepDays: step.days }
        }
      }).catch(() => {});
    }
  }

  let busy = false;
  let timer = null;

  async function step() {
    if (busy) return;
    busy = true;
    let leased = false;
    try {
      let c = await dueCampaign();
      if (!c) {
        if (!(leased = await acquireLease())) return;
        await runFollowupStep();
        return;
      }
      if (!(leased = await acquireLease())) return; // another WhatsApp tab is sending
      c = await B.getCampaign(c.id);
      if (!c || !ACTIVE.has(c.status)) return;
      const id = c.id;
      const settings = B.normalizeSettings(c.settings);

      // Phase 1: save recipients as WhatsApp contacts before the first message.
      const contactsPending = settings.saveContacts && (c.contactCursor || 0) < c.recipients.length;
      if (c.status === "saving" || contactsPending) {
        await saveContactsStep(c, settings, contactsPending);
        return;
      }

      if (c.cursor >= c.recipients.length) {
        await updateCampaign(id, (x) => { x.status = "completed"; x.completedAt = Date.now(); x.note = "Campaign finished"; });
        notify(`“${c.name}” finished`, `${c.counts.sent} sent, ${c.counts.failed} failed, ${c.counts.skipped} skipped.`);
        return;
      }

      const windowStart = B.nextWindowStart(settings);
      if (windowStart) {
        await updateCampaign(id, (x) => { x.nextSendAt = windowStart.getTime(); x.note = `Outside sending hours — resumes ${timeLabel(windowStart)}`; });
        return;
      }

      if ((await sentToday()) >= settings.dailyLimit) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(settings.hoursEnabled ? settings.startHour : 0, 1, 0, 0);
        await updateCampaign(id, (x) => { x.nextSendAt = tomorrow.getTime(); x.note = `Daily limit of ${settings.dailyLimit} reached — resumes ${timeLabel(tomorrow)}`; });
        return;
      }

      const ready = await callPage("ready", {}, 20000);
      if (!ready.ok || !ready.ready) {
        await updateCampaign(id, (x) => { x.nextSendAt = Date.now() + 60000; x.note = "Waiting for WhatsApp Web to connect…"; });
        return;
      }

      const index = c.cursor;
      const recipient = c.recipients[index];
      const optOut = await loadOptOut();
      let res;
      const knownMissing = (c.contactResults || [])[index] && c.contactResults[index].status === "not_on_whatsapp";
      if (settings.respectOptOut && optOut.phones.includes(recipient.phone)) {
        res = { ok: false, code: "opted_out", error: "Contact opted out" };
      } else if (knownMissing) {
        res = { ok: false, code: "not_on_whatsapp", error: "Number is not on WhatsApp" };
      } else {
        const quota = await reserveQuota("campaign");
        if (!quota.allowed) {
          const note = await quotaNote(quota);
          await updateCampaign(id, (x) => { x.nextSendAt = quotaRetryAt(quota); x.quotaBlocked = !quota.unavailable; x.note = note; });
          return;
        }
        try {
          res = await sendOne(recipient, c.message, settings, await loadMedia(c), optOut);
        } catch (err) {
          res = { ok: false, code: "error", error: (err && err.message) || String(err) };
        }
        if (!res.ok) releaseQuota("campaign");
      }

      if (!res.ok && (res.code === "not_connected" || res.code === "timeout")) {
        // Not the contact's fault: retry the same recipient later.
        await updateCampaign(id, (x) => { x.nextSendAt = Date.now() + 60000; x.note = `${res.error} — retrying in 1 min`; });
        return;
      }

      if (res.ok) {
        await bumpDaily();
        chrome.runtime.sendMessage({
          type: "LOG_MESSAGE",
          payload: {
            phoneNumber: "+" + recipient.phone,
            contactName: recipient.name,
            direction: "outgoing",
            type: "campaign",
            content: res.text,
            campaignId: id,
            status: "sent",
            timestamp: new Date().toISOString(),
            metadata: { source: "bulk-sender", campaign: c.name, attachments: (Array.isArray(c.attachments) && c.attachments.length ? c.attachments : (c.attachment ? [c.attachment] : [])).map((a) => a.name) }
          }
        }).catch(() => {});
      }

      const status = res.ok ? "sent" : SKIP_CODES.has(res.code) ? "skipped" : "failed";
      await updateCampaign(id, (x) => {
        if (x.cursor !== index) return; // list was changed meanwhile
        x.results[index] = { status, error: res.ok ? "" : res.error || res.code, at: Date.now(), chatId: res.chatId || null };
        x.quotaBlocked = false;
        x.counts[status] = (x.counts[status] || 0) + 1;
        x.cursor = index + 1;
        x.consecutiveFailures = status === "failed" ? (x.consecutiveFailures || 0) + 1 : 0;

        let delay = status === "skipped" ? 5000 + Math.random() * 10000 : B.nextDelayMs(settings);
        x.note = res.ok ? `Sent to +${recipient.phone}` : `${status === "skipped" ? "Skipped" : "Failed"} +${recipient.phone}: ${res.error || res.code}`;
        if (res.ok) {
          x.sentInBatch = (x.sentInBatch || 0) + 1;
          if (settings.batchSize > 0 && x.sentInBatch >= settings.batchSize && settings.batchPauseMin > 0) {
            delay += settings.batchPauseMin * 60000;
            x.sentInBatch = 0;
            x.note = `Batch of ${settings.batchSize} sent — taking a ${settings.batchPauseMin} min break`;
          }
        }
        x.nextSendAt = Date.now() + delay;

        if (x.consecutiveFailures >= settings.maxConsecutiveFailures) {
          x.status = "paused";
          x.note = `Auto-paused after ${x.consecutiveFailures} failures in a row (last: ${res.error || res.code}). Check WhatsApp, then Resume.`;
          notify(`“${x.name}” paused`, x.note);
        } else if (x.cursor >= x.recipients.length) {
          x.status = "completed";
          x.completedAt = Date.now();
          x.note = "Campaign finished";
          notify(`“${x.name}” finished`, `${x.counts.sent} sent, ${x.counts.failed} failed, ${x.counts.skipped} skipped.`);
        }
      });
    } catch (err) {
      console.warn("[Downlabs Bulk] step failed", err);
    } finally {
      if (leased) await releaseLease().catch(() => {});
      busy = false;
      schedule();
    }
  }

  async function schedule() {
    clearTimeout(timer);
    const running = (await B.listCampaigns()).filter((c) => ACTIVE.has(c.status));
    const flows = (await B.listFollowupFlows()).filter((f) => f.status === "active");
    if (!running.length && !flows.length) return;
    const next = Math.min(...running.map((c) => c.nextSendAt || 0), ...flows.map((f) => f.nextRunAt || (Date.now() + 60000)));
    // Re-check at least every minute; background ticks also call step().
    timer = setTimeout(step, Math.min(Math.max(0, next - Date.now()), 60000) + 250);
  }

  // ─── test send (from the Bulk Sender page) ────────────────────────────────

  async function testSend({ phone, message, attachment, attachments, recipient, settings }) {
    const s = B.normalizeSettings(settings);
    const number = B.normalizePhone(phone, s.defaultCountryCode);
    if (!number) return { ok: false, error: "Enter a valid phone number with country code" };
    const ready = await callPage("ready", {}, 20000);
    if (!ready.ok || !ready.ready) return { ok: false, error: "WhatsApp Web is not connected yet" };
    const files = Array.isArray(attachments) ? attachments : (attachment ? [attachment] : []);
    const media = files.filter((a) => a && a.dataUrl).map((a) => {
      const item = { buffer: dataUrlToBuffer(a.dataUrl), type: a.type, name: a.name };
      if (a.caption) item.caption = a.caption;
      return item;
    });
    const sample = { ...(recipient || {}), phone: number, vars: { ...((recipient && recipient.vars) || {}), phone: "+" + number } };
    const quota = await reserveQuota("test");
    if (!quota.allowed) return { ok: false, error: quota.message };
    const res = await sendOne(sample, message, { ...s, typingSimulation: false }, media, { phones: [], ids: [] });
    if (!res.ok) releaseQuota("test");
    return res.ok ? { ok: true } : { ok: false, error: res.error || res.code };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== "string") return false;
    if (msg.type === "DL_BULK_TICK" || msg.type === "DL_BULK_KICK") {
      step();
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === "DL_BULK_TEST") {
      testSend(msg.payload || {}).then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
      return true;
    }
    if (msg.type === "DL_BULK_PING") {
      callPage("ready", {}, 15000).then((r) => sendResponse({ ok: true, ready: !!r.ready }));
      return true;
    }
    return false;
  });

  /** Upgrading to Pro lifts the daily limit, so anything waiting for tomorrow can go now. */
  async function resumeQuotaBlocked() {
    for (const c of await B.listCampaigns()) {
      if (c.quotaBlocked && ACTIVE.has(c.status)) await updateCampaign(c.id, (x) => { x.quotaBlocked = false; x.nextSendAt = Date.now(); x.note = "Pro activated — resuming"; });
    }
    for (const f of await B.listFollowupFlows()) {
      if (f.quotaBlocked) await B.patchFollowupFlow(f.id, (x) => { x.quotaBlocked = false; x.nextRunAt = Date.now(); x.note = ""; });
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.wamLicense) {
      const lic = changes.wamLicense.newValue && changes.wamLicense.newValue.license;
      if (lic && lic.status === "active") resumeQuotaBlocked().catch(() => {});
    }
    if (Object.keys(changes).some((k) => k === K.index || k === K.followupIndex || k.startsWith(K.campaignPrefix) || k.startsWith(K.followupPrefix))) schedule();
  });

  B.migrateLegacy().catch(() => {}).then(() => {
    injectPage();
    schedule();
  });
})();
