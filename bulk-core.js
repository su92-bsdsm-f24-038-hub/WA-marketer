/*
 * WAMarketer — bulk sender core.
 * Shared by the Bulk Sender page (bulk.html) and the WhatsApp Web runner (bulk-runner.js):
 * recipient parsing, phone normalisation, message personalisation and pacing rules.
 * Exposed as globalThis.DownlabsBulk.
 */
(function (global) {
  "use strict";

  const KEYS = {
    index: "downlabsBulkIndex", // [campaign ids]
    campaignPrefix: "downlabsBulkCampaign:",
    attachmentPrefix: "downlabsBulkAttachment:",
    lease: "downlabsBulkLease", // which WhatsApp tab is sending right now
    daily: "downlabsBulkDaily",
    optOut: "downlabsBulkOptOut",
    draft: "downlabsBulkDraft",
    draftAttachment: "downlabsBulkDraftAttachment",
    legacyJob: "downlabsBulkJob", // single-campaign format from the first version
    legacyAttachment: "downlabsBulkAttachment",
    followupIndex: "downlabsBulkFollowupIndex",
    followupPrefix: "downlabsBulkFollowup:"
  };
  const campaignKey = (id) => KEYS.campaignPrefix + id;
  const attachmentKey = (id) => KEYS.attachmentPrefix + id;
  const followupKey = (id) => KEYS.followupPrefix + id;

  const MAX_RECIPIENTS = 5000;
  const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;
  const MAX_ATTACHMENTS = 10;
  const ATTACHMENT_TYPES = [
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "video/mp4", "video/webm", "video/3gpp", "video/quicktime", "video/mpeg", "video/ogg",
    "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/ogg", "audio/webm",
    "application/pdf"
  ];

  const DEFAULT_SETTINGS = {
    delayMode: "random", // "random" | "fixed"
    fixedDelaySec: 90,
    minDelaySec: 60,
    maxDelaySec: 600,
    dailyLimit: 150,
    batchSize: 25,
    batchPauseMin: 15,
    hoursEnabled: true,
    startHour: 9,
    endHour: 21,
    typingSimulation: true,
    respectOptOut: true,
    optOutKeywords: "stop, unsubscribe, stop all, opt out, optout, стоп, отписаться, dayan",
    appendOptOutFooter: true,
    optOutFooter: "Reply STOP to unsubscribe.",
    maxConsecutiveFailures: 5,
    defaultCountryCode: "",
    // Save every recipient as a WhatsApp contact before messaging them.
    saveContacts: true,
    contactPrefix: "Client", // used when a recipient has no name: "Client 1", "Client 2", …
    contactStart: 1,
    contactAppendCampaign: false, // "Ali Khan (Sept promo)"
    contactSyncToPhone: false // also add to the phone's address book
  };

  // ─── phone numbers ────────────────────────────────────────────────────────

  function digitsOnly(value) {
    return String(value ?? "").replace(/\D/g, "");
  }

  /**
   * Undoes the two conventions spreadsheets use to keep a number as literal text:
   * a leading apostrophe (Excel's manual-entry marker, e.g. '923001234567), and the
   * ="…" formula wrapper some exports use so phone numbers keep their + sign. Both
   * are safe to strip — the wrapper itself never carries real data.
   */
  function unwrapSpreadsheetText(raw) {
    let v = String(raw ?? "").trim();
    const formula = /^="([\s\S]*)"$/.exec(v);
    if (formula) return formula[1].trim();
    if (v.startsWith("'")) return v.slice(1).trim();
    return v;
  }

  // A number Excel/Sheets has already mangled into scientific notation (e.g. a phone column
  // left in "General" format): the tail digits are gone for good, so this must be rejected
  // rather than "normalized" into a shorter, wrong number.
  const SCIENTIFIC_NOTATION_RE = /^[+-]?\d(\.\d+)?e[+-]?\d+$/i;

  /** Returns E.164 digits (no "+") or null. Local numbers starting with 0 get defaultCountryCode. */
  function normalizePhone(raw, defaultCountryCode) {
    const text = unwrapSpreadsheetText(raw);
    if (!text) return null;
    if (SCIENTIFIC_NOTATION_RE.test(text.replace(/,/g, ""))) return null;
    const cc = digitsOnly(defaultCountryCode);
    let d = digitsOnly(text);
    if (!d) return null;
    if (text.startsWith("+")) {
      // already international
    } else if (d.startsWith("00")) {
      d = d.slice(2);
    } else if (d.startsWith("0") && cc) {
      d = cc + d.replace(/^0+/, "");
    } else if (cc && d.length <= 10 && !d.startsWith(cc)) {
      d = cc + d;
    }
    if (d.length < 8 || d.length > 15 || d.startsWith("0")) return null;
    return d;
  }

  function looksLikePhone(value) {
    const s = unwrapSpreadsheetText(value);
    if (SCIENTIFIC_NOTATION_RE.test(s.replace(/,/g, ""))) return true; // still "phone-shaped" for column detection, just invalid
    return /^[+\d][\d\s().\-]{6,}$/.test(s) && digitsOnly(s).length >= 7;
  }

  // ─── CSV / pasted lists ───────────────────────────────────────────────────

  function detectDelimiter(firstLine) {
    const counts = { ",": 0, ";": 0, "\t": 0 };
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch in counts) counts[ch]++;
    }
    const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return count > 0 ? best : ",";
  }

  /** RFC 4180-style parser (quoted fields, escaped quotes, CRLF). */
  function parseCSV(text) {
    const src = String(text ?? "").replace(/^﻿/, "");
    const delimiter = detectDelimiter(src.split(/\r?\n/, 1)[0] || "");
    const rows = [];
    // A quote only opens CSV-level quoting when it is the very first character of a field —
    // a stray quote later in an unquoted field (e.g. a spreadsheet's ="+92..." text-safety
    // wrapper) is kept as a literal character so unwrapSpreadsheetText can still see it below.
    let row = [], field = "", quoted = false, atFieldStart = true;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
        } else field += ch;
      } else if (ch === '"' && atFieldStart) {
        quoted = true;
        atFieldStart = false;
      } else if (ch === delimiter) {
        row.push(field);
        field = "";
        atFieldStart = true;
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && src[i + 1] === "\n") i++;
        row.push(field);
        field = "";
        if (row.some((c) => c.trim() !== "")) rows.push(row);
        row = [];
        atFieldStart = true;
      } else {
        field += ch;
        atFieldStart = false;
      }
    }
    row.push(field);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    return rows.map((r) => r.map((c) => unwrapSpreadsheetText(c)));
  }

  function keyFor(header) {
    return String(header).trim().toLowerCase().replace(/[^a-z0-9а-яёəğıöşüç]+/gi, "_").replace(/^_+|_+$/g, "") || "column";
  }

  function firstName(name) {
    return String(name || "").trim().split(/[\s,]+/)[0] || "";
  }

  /**
   * Builds recipients from CSV rows. Detects a header row, the phone column and a name column;
   * every column becomes a {{variable}}.
   */
  function recipientsFromRows(rows, defaultCountryCode) {
    const report = { recipients: [], invalid: [], duplicates: 0, columns: [], total: 0, truncated: false };
    if (!rows.length) return report;

    const first = rows[0];
    // A header row has labels but no phone numbers, and phone numbers appear below it.
    const hasHeader = !first.some(looksLikePhone) && first.some((c) => c) && rows.slice(1).some((r) => r.some(looksLikePhone));
    const headers = hasHeader ? first.map(keyFor) : first.map((_, i) => (i === 0 ? "phone" : i === 1 ? "name" : `column_${i + 1}`));
    const body = hasHeader ? rows.slice(1) : rows;

    let phoneIdx = headers.findIndex((h) => /phone|mobile|number|whatsapp|cell|tel|msisdn|contact|nomre|номер|телефон/.test(h));
    if (phoneIdx < 0) {
      phoneIdx = headers.findIndex((_, i) => body.filter((r) => looksLikePhone(r[i])).length >= Math.max(1, body.length * 0.6));
    }
    if (phoneIdx < 0) phoneIdx = 0;
    let nameIdx = headers.findIndex((h, i) => i !== phoneIdx && /^(full_?)?name$|first_?name|customer|client|ad$|имя/.test(h));
    if (nameIdx < 0 && !hasHeader && headers.length > 1) nameIdx = phoneIdx === 0 ? 1 : 0;

    report.columns = headers;
    const seen = new Set();
    for (const r of body) {
      report.total++;
      const phone = normalizePhone(r[phoneIdx], defaultCountryCode);
      if (!phone) {
        report.invalid.push(r[phoneIdx] || "(empty)");
        continue;
      }
      if (seen.has(phone)) { report.duplicates++; continue; }
      if (report.recipients.length >= MAX_RECIPIENTS) { report.truncated = true; continue; }
      seen.add(phone);
      const vars = {};
      headers.forEach((h, i) => { if (r[i] !== undefined && r[i] !== "") vars[h] = r[i]; });
      const name = nameIdx >= 0 ? (r[nameIdx] || "") : "";
      vars.name = vars.name || name;
      vars.first_name = vars.first_name || firstName(name);
      vars.phone = "+" + phone;
      report.recipients.push({ phone, name, vars });
    }
    return report;
  }

  /** Pasted text: "923001234567, 923009876543" or one "number, name" per line. */
  function recipientsFromText(text, defaultCountryCode) {
    const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const rows = [];
    for (const line of lines) {
      const tokens = line.split(/[,;\t]/).map((t) => t.trim()).filter(Boolean);
      if (tokens.length && tokens.every(looksLikePhone)) {
        for (const t of tokens) rows.push([t, ""]);
      } else if (tokens.length) {
        const phone = tokens.find(looksLikePhone) || tokens[0];
        const name = tokens.find((t) => t !== phone && !looksLikePhone(t)) || "";
        rows.push([phone, name]);
      }
    }
    return recipientsFromRows(rows, defaultCountryCode);
  }

  // ─── personalisation ──────────────────────────────────────────────────────

  /** {{variable}} / {{variable|fallback}} then spintax {a|b|c} (nested allowed). */
  function renderMessage(template, recipient, random = Math.random) {
    const vars = (recipient && recipient.vars) || {};
    let out = String(template ?? "").replace(/\{\{\s*([^{}|]+?)\s*(?:\|([^{}]*))?\}\}/g, (_, key, fallback) => {
      const v = vars[keyFor(key)];
      if (v !== undefined && String(v).trim() !== "") return String(v);
      return fallback !== undefined && fallback.trim() !== "" ? fallback.trim() : "\u0000";
    });
    // An empty variable without fallback disappears together with the space before it ("Hi {{name}}," -> "Hi,").
    out = out.replace(/[ \t]*\u0000(?=[,.!?;:)])/g, "").replace(/[ \t]*\u0000/g, "");
    for (let guard = 0; guard < 20 && /\{[^{}]*\|[^{}]*\}/.test(out); guard++) {
      out = out.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, options) => {
        const parts = options.split("|");
        return parts[Math.floor(random() * parts.length)];
      });
    }
    return out.replace(/[ \t]+\n/g, "\n").trim();
  }

  /** Variables used without a fallback, with how many recipients have no value for each. */
  function missingVariables(template, recipients) {
    const used = new Set();
    String(template ?? "").replace(/\{\{\s*([^{}|]+?)\s*(\|[^{}]*)?\}\}/g, (_, key, fb) => { if (fb === undefined) used.add(keyFor(key)); return ""; });
    const out = [];
    for (const key of used) {
      const missing = (recipients || []).filter((r) => !String((r.vars || {})[key] ?? "").trim()).length;
      if (missing) out.push({ key, missing });
    }
    return out;
  }

  function withFooter(text, settings) {
    if (!settings.appendOptOutFooter || !settings.optOutFooter.trim()) return text;
    return text ? `${text}\n\n${settings.optOutFooter.trim()}` : settings.optOutFooter.trim();
  }

  /**
   * Name each recipient will be saved under in WhatsApp. Recipients with a name keep it;
   * the others are numbered in list order: "Client 1", "Client 2", …
   * Returns [{ firstName, lastName, fullName }] aligned with recipients.
   */
  function contactNames(recipients, settings, campaignName) {
    const s = normalizeSettings(settings);
    const suffix = s.contactAppendCampaign && String(campaignName || "").trim() ? `(${String(campaignName).trim().slice(0, 40)})` : "";
    let n = s.contactStart;
    return (recipients || []).map((r) => {
      const own = String((r && r.name) || "").replace(/\s+/g, " ").trim().slice(0, 60);
      const firstName = own || `${s.contactPrefix} ${n++}`;
      return { firstName, lastName: suffix, fullName: suffix ? `${firstName} ${suffix}` : firstName };
    });
  }

  function templateVariables(columns) {
    return [...new Set(["name", "first_name", "phone", ...(columns || [])])];
  }

  // ─── pacing & safety ──────────────────────────────────────────────────────

  function normalizeSettings(input) {
    const s = { ...DEFAULT_SETTINGS, ...(input || {}) };
    const clamp = (v, min, max, def) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
    };
    s.fixedDelaySec = clamp(s.fixedDelaySec, 20, 3600, DEFAULT_SETTINGS.fixedDelaySec);
    s.minDelaySec = clamp(s.minDelaySec, 20, 3600, DEFAULT_SETTINGS.minDelaySec);
    s.maxDelaySec = clamp(s.maxDelaySec, s.minDelaySec, 7200, Math.max(s.minDelaySec, DEFAULT_SETTINGS.maxDelaySec));
    s.dailyLimit = clamp(s.dailyLimit, 1, 1000, DEFAULT_SETTINGS.dailyLimit);
    s.batchSize = clamp(s.batchSize, 0, 1000, DEFAULT_SETTINGS.batchSize);
    s.batchPauseMin = clamp(s.batchPauseMin, 0, 720, DEFAULT_SETTINGS.batchPauseMin);
    s.startHour = clamp(s.startHour, 0, 23, DEFAULT_SETTINGS.startHour);
    s.endHour = clamp(s.endHour, 1, 24, DEFAULT_SETTINGS.endHour);
    s.maxConsecutiveFailures = clamp(s.maxConsecutiveFailures, 1, 50, DEFAULT_SETTINGS.maxConsecutiveFailures);
    s.contactStart = Math.round(clamp(s.contactStart, 0, 1000000, DEFAULT_SETTINGS.contactStart));
    s.contactPrefix = String(s.contactPrefix ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || DEFAULT_SETTINGS.contactPrefix;
    s.saveContacts = s.saveContacts !== false;
    s.contactAppendCampaign = !!s.contactAppendCampaign;
    s.contactSyncToPhone = !!s.contactSyncToPhone;
    return s;
  }

  function nextDelayMs(settings, random = Math.random) {
    const s = normalizeSettings(settings);
    const sec = s.delayMode === "fixed" ? s.fixedDelaySec : s.minDelaySec + random() * (s.maxDelaySec - s.minDelaySec);
    return Math.round(sec * 1000);
  }

  /** If `now` is outside the sending window, returns the next window start; otherwise null. */
  function nextWindowStart(settings, now = new Date()) {
    const s = normalizeSettings(settings);
    if (!s.hoursEnabled || (s.startHour === 0 && s.endHour === 24)) return null;
    const h = now.getHours() + now.getMinutes() / 60;
    if (h >= s.startHour && h < s.endHour) return null;
    const start = new Date(now);
    start.setHours(s.startHour, 0, 0, 0);
    if (h >= s.endHour) start.setDate(start.getDate() + 1);
    return start;
  }

  function todayKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function optOutMatcher(settings) {
    const words = String(settings.optOutKeywords || "")
      .split(",")
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    return (body) => {
      const text = String(body || "").trim().toLowerCase().replace(/[.!?]+$/, "");
      return !!text && words.includes(text);
    };
  }

  /** Rough duration estimate in ms for the remaining recipients. */
  function estimateDurationMs(count, settings) {
    const s = normalizeSettings(settings);
    if (count <= 0) return 0;
    const avgDelay = s.delayMode === "fixed" ? s.fixedDelaySec : (s.minDelaySec + s.maxDelaySec) / 2;
    const batches = s.batchSize > 0 ? Math.floor((count - 1) / s.batchSize) : 0;
    return Math.round(((count - 1) * avgDelay + batches * s.batchPauseMin * 60) * 1000);
  }

  function formatDuration(ms) {
    const m = Math.round(ms / 60000);
    if (m < 1) return "under 1 min";
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ${m % 60} min`;
    return `${Math.floor(h / 24)} d ${h % 24} h`;
  }

  function reportCSV(job) {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["phone", "name", "status", "detail", "replied", "time"].join(",")];
    (job.recipients || []).forEach((r, i) => {
      const res = (job.results || [])[i] || {};
      lines.push([esc("+" + r.phone), esc(r.name), esc(res.status || "pending"), esc(res.error || ""), esc(res.replied ? "yes" : ""), esc(res.at ? new Date(res.at).toISOString() : "")].join(","));
    });
    return lines.join("\n");
  }

  // ─── campaign storage (chrome.storage.local) ──────────────────────────────

  const store = () => chrome.storage.local;

  async function listCampaigns() {
    const ids = (await store().get([KEYS.index]))[KEYS.index] || [];
    if (!ids.length) return [];
    const data = await store().get(ids.map(campaignKey));
    return ids.map((id) => data[campaignKey(id)]).filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async function getCampaign(id) {
    return (await store().get([campaignKey(id)]))[campaignKey(id)] || null;
  }

  async function putCampaign(campaign) {
    const ids = (await store().get([KEYS.index]))[KEYS.index] || [];
    campaign.updatedAt = Date.now();
    const values = { [campaignKey(campaign.id)]: campaign };
    if (!ids.includes(campaign.id)) values[KEYS.index] = [...ids, campaign.id];
    await store().set(values);
    return campaign;
  }

  async function patchCampaign(id, mutate) {
    const c = await getCampaign(id);
    if (!c) return null;
    mutate(c);
    c.updatedAt = Date.now();
    await store().set({ [campaignKey(id)]: c });
    return c;
  }

  async function deleteCampaign(id) {
    const ids = (await store().get([KEYS.index]))[KEYS.index] || [];
    await store().remove([campaignKey(id), attachmentKey(id)]);
    await store().set({ [KEYS.index]: ids.filter((x) => x !== id) });
  }

  async function getAttachment(id) {
    return (await store().get([attachmentKey(id)]))[attachmentKey(id)] || null;
  }

  async function getAttachments(id) {
    const stored = await getAttachment(id);
    if (Array.isArray(stored)) return stored;
    return stored ? [stored] : [];
  }

  async function listFollowupFlows() {
    const ids = (await store().get([KEYS.followupIndex]))[KEYS.followupIndex] || [];
    if (!ids.length) return [];
    const data = await store().get(ids.map(followupKey));
    const flows = ids.map((id) => data[followupKey(id)]).filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const seenCampaigns = new Set();
    const unique = flows.filter((flow) => {
      if (!flow.campaignId || seenCampaigns.has(flow.campaignId)) return !flow.campaignId;
      seenCampaigns.add(flow.campaignId);
      return true;
    });
    if (unique.length !== flows.length) await store().set({ [KEYS.followupIndex]: unique.map((flow) => flow.id) });
    return unique;
  }

  async function getFollowupFlow(id) {
    return (await store().get([followupKey(id)]))[followupKey(id)] || null;
  }

  async function putFollowupFlow(flow) {
    const ids = (await store().get([KEYS.followupIndex]))[KEYS.followupIndex] || [];
    flow.updatedAt = Date.now();
    const values = { [followupKey(flow.id)]: flow };
    if (!ids.includes(flow.id)) values[KEYS.followupIndex] = [...ids, flow.id];
    await store().set(values);
    return flow;
  }

  async function patchFollowupFlow(id, mutate) {
    const flow = await getFollowupFlow(id);
    if (!flow) return null;
    mutate(flow);
    flow.updatedAt = Date.now();
    await store().set({ [followupKey(id)]: flow });
    return flow;
  }

  async function deleteFollowupFlow(id) {
    const ids = (await store().get([KEYS.followupIndex]))[KEYS.followupIndex] || [];
    await store().remove(followupKey(id));
    await store().set({ [KEYS.followupIndex]: ids.filter((x) => x !== id) });
  }

  function newFollowupFlow(fields = {}) {
    return {
      id: fields.id || (fields.campaignId ? `followup-${fields.campaignId}` : `followup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`),
      name: "Campaign follow-up",
      campaignId: "",
      status: "active",
      steps: [
        { days: 3, message: "Hi {{first_name|there}}, just following up on my previous message." },
        { days: 7, message: "Hi {{first_name|there}}, do you have any questions I can help with?" },
        { days: 14, message: "Hi {{first_name|there}}, this is my final follow-up. Reply whenever you are ready." }
      ],
      sent: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...fields
    };
  }

  function newCampaign(fields) {
    return {
      id: `bulk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: "",
      status: "draft",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      message: "",
      attachments: [],
      attachment: null, // legacy single-attachment field
      settings: normalizeSettings({}),
      recipients: [],
      source: {},
      results: [],
      cursor: 0,
      counts: { sent: 0, failed: 0, skipped: 0, replied: 0 },
      contactCursor: 0,
      contactResults: [],
      contactCounts: {},
      consecutiveFailures: 0,
      sentInBatch: 0,
      nextSendAt: 0,
      note: "",
      ...fields
    };
  }

  /** Moves the single-campaign format of the first release into the campaign list. Idempotent. */
  async function migrateLegacy() {
    const s = await store().get([KEYS.legacyJob, KEYS.legacyAttachment]);
    const job = s[KEYS.legacyJob];
    const att = s[KEYS.legacyAttachment];
    if (!job && !att) return;
    if (job && job.id) {
      await putCampaign({ ...newCampaign({}), ...job });
      if (att && att.jobId === job.id) await store().set({ [attachmentKey(job.id)]: { name: att.name, type: att.type, size: att.size, dataUrl: att.dataUrl } });
    }
    if (att && att.jobId === "draft") await store().set({ [KEYS.draftAttachment]: { name: att.name, type: att.type, size: att.size, dataUrl: att.dataUrl } });
    await store().remove([KEYS.legacyJob, KEYS.legacyAttachment]);
  }

  global.DownlabsBulk = {
    KEYS,
    campaignKey,
    attachmentKey,
    followupKey,
    listCampaigns,
    getCampaign,
    putCampaign,
    patchCampaign,
    deleteCampaign,
    getAttachment,
    getAttachments,
    listFollowupFlows,
    getFollowupFlow,
    putFollowupFlow,
    patchFollowupFlow,
    deleteFollowupFlow,
    newFollowupFlow,
    newCampaign,
    migrateLegacy,
    missingVariables,
    MAX_RECIPIENTS,
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENTS,
    ATTACHMENT_TYPES,
    DEFAULT_SETTINGS,
    digitsOnly,
    unwrapSpreadsheetText,
    normalizePhone,
    parseCSV,
    recipientsFromRows,
    recipientsFromText,
    renderMessage,
    withFooter,
    templateVariables,
    contactNames,
    normalizeSettings,
    nextDelayMs,
    nextWindowStart,
    todayKey,
    optOutMatcher,
    estimateDurationMs,
    formatDuration,
    reportCSV
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
