/*
 * WAMarketer — local backend.
 *
 * The extension was originally written against a hosted REST API (accounts,
 * plans, usage limits, AI proxy, knowledge base, CRM assistant). This module
 * serves the same routes inside the browser so every screen keeps working
 * with no server, no account and no limits:
 *
 *   - a permanent local profile (user + workspace on an "Unlimited" plan)
 *   - usage counters kept only for display
 *   - AI routes forwarded to the user's own provider via DownlabsAI
 *   - everything persisted in chrome.storage.local on this device
 *
 * Requests to API_BASE (and the legacy hosted URL) are answered by a fetch
 * wrapper installed below, so they never leave the browser.
 *
 * Requires ai-providers.js to be loaded first. Exposed as globalThis.DownlabsLocal.
 */
(function (global) {
  "use strict";

  const API_BASE = "https://local.downlabs.invalid/api";
  const LEGACY_API_BASES = ["https://birthday.agent0s.dev/public/api", "https://api.smartdm.io/api", "https://api.smartdm.io"];
  const MESSAGE_LOGS_KEY = "smartdm_message_logs"; // written by background.js LOG_MESSAGE
  const USAGE_KEY = "downlabsUsage";
  const REPLY_STATUS_KEY = "downlabsReplyStatus";
  const KNOWLEDGE_KEY = "downlabsKnowledge";
  const SMARTY_CHAT_KEY = "downlabsSmartyChat";
  const SMARTY_PENDING_KEY = "downlabsSmartyPending";
  const ACTIVITY_HISTORY_KEY = "downlabsActivityHistory";
  const LOCAL_WORKSPACE_ID_KEY = "downlabsLocalWorkspaceId";
  const PRODUCT_NAME = "WAMarketer";

  const UNLIMITED_PLAN = Object.freeze({
    id: "local-unlimited",
    code: "unlimited",
    name: "Unlimited",
    description: "Standalone local edition — no limits.",
    priceMonthly: 0,
    messagesPerDay: -1,
    aiRepliesPerDay: -1,
    contactsLimit: -1,
    campaignsPerMonth: -1,
    isActive: true,
    isDefault: true
  });

  const LOCAL_USER = Object.freeze({ id: "local-user", email: "offline@local", name: "Downlabs User", role: "owner" });

  // ─── storage helpers ──────────────────────────────────────────────────────

  function get(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, (r) => resolve(r || {})));
  }
  function set(values) {
    return new Promise((resolve) => chrome.storage.local.set(values, () => resolve()));
  }
  function uuid() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  function nowIso() {
    return new Date().toISOString();
  }
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function b64json(obj) {
    // Standard base64 (not base64url) so existing atob()-based JWT parsing keeps working.
    return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  }
  function digits(phone) {
    return String(phone || "").replace(/\D/g, "");
  }
  function samePhone(a, b) {
    const x = digits(a), y = digits(b);
    if (!x || !y) return false;
    return x === y || x.slice(-9) === y.slice(-9);
  }

  // ─── local profile ────────────────────────────────────────────────────────

  function makeToken(sub, workspaceId, kind) {
    // Never expires (year 2100) and is never sent anywhere; it only satisfies "signed in" checks.
    const header = b64json({ alg: "none", typ: "JWT" });
    const payload = b64json({ sub, workspaceId, type: kind, local: true, iat: 1700000000, exp: 4102444800 });
    return `${header}.${payload}.local`;
  }

  let profilePromise = null;
  async function ensureLocalProfile() {
    if (profilePromise) return profilePromise;
    profilePromise = (async () => {
      const s = await get(["accessToken", "refreshToken", "user", "workspace", "currentWhatsappPhone", LOCAL_WORKSPACE_ID_KEY]);
      // Keep an existing workspace id so CRM data scoped to it stays visible after the switch.
      const workspaceId = s.workspace?.id ? String(s.workspace.id) : s[LOCAL_WORKSPACE_ID_KEY] || uuid();
      const workspace = {
        ...(s.workspace && typeof s.workspace === "object" ? s.workspace : {}),
        id: workspaceId,
        name: s.workspace?.name || "My Workspace",
        whatsappPhone: s.workspace?.whatsappPhone || s.currentWhatsappPhone || null,
        extensionInstallWhatsappSentAt: s.workspace?.extensionInstallWhatsappSentAt || nowIso(),
        role: "owner",
        plan: { ...UNLIMITED_PLAN }
      };
      const user = { ...LOCAL_USER, ...(s.user && typeof s.user === "object" ? s.user : {}) };
      const isLocalToken = (t) => typeof t === "string" && t.endsWith(".local");
      const accessToken = isLocalToken(s.accessToken) ? s.accessToken : makeToken(user.id, workspaceId, "access");
      const refreshToken = isLocalToken(s.refreshToken) ? s.refreshToken : makeToken(user.id, workspaceId, "refresh");
      const patch = {};
      if (s.accessToken !== accessToken) patch.accessToken = accessToken;
      if (s.refreshToken !== refreshToken) patch.refreshToken = refreshToken;
      if (JSON.stringify(s.workspace) !== JSON.stringify(workspace)) patch.workspace = workspace;
      if (JSON.stringify(s.user) !== JSON.stringify(user)) patch.user = user;
      if (s[LOCAL_WORKSPACE_ID_KEY] !== workspaceId) patch[LOCAL_WORKSPACE_ID_KEY] = workspaceId;
      if (Object.keys(patch).length) await set(patch);
      return { accessToken, refreshToken, user, workspace };
    })();
    try {
      return await profilePromise;
    } finally {
      profilePromise = null;
    }
  }

  // If anything clears the profile (an old "sign out" path, storage wipe), put it back.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      const cleared = ["accessToken", "user", "workspace"].some((k) => k in changes && !changes[k].newValue);
      const planChanged = changes.workspace?.newValue && changes.workspace.newValue.plan?.code !== "unlimited";
      if (cleared || planChanged) ensureLocalProfile().catch(() => {});
    });
  } catch {}

  async function linkWhatsappPhone(phone) {
    const { workspace } = await ensureLocalProfile();
    if (workspace.whatsappPhone === phone) return workspace;
    const next = { ...workspace, whatsappPhone: phone };
    await set({ workspace: next });
    return next;
  }

  async function updateWorkspace(patch) {
    const { workspace } = await ensureLocalProfile();
    const next = { ...workspace };
    if (typeof patch.name === "string" && patch.name.trim()) next.name = patch.name.trim();
    if (patch.whatsappPhone !== undefined) next.whatsappPhone = patch.whatsappPhone || null;
    await set({ workspace: next });
    return next;
  }

  // ─── usage (display only, never enforced) ─────────────────────────────────

  async function readUsage() {
    const r = await get([USAGE_KEY]);
    const u = r[USAGE_KEY];
    if (u && u.date === todayKey()) return u;
    return { date: todayKey(), messagesSent: 0, aiReplies: 0 };
  }

  async function refreshRealtimeUsage(usage) {
    const u = usage || (await readUsage());
    await set({
      realtimeUsage: {
        messagesSent: u.messagesSent,
        aiReplies: u.aiReplies,
        campaignsCreated: 0,
        date: u.date,
        messagesLimit: -1,
        aiRepliesLimit: -1,
        timestamp: Date.now()
      }
    });
  }

  let usageQueue = Promise.resolve();
  function bumpUsage(field) {
    usageQueue = usageQueue.then(async () => {
      const u = await readUsage();
      u[field] = (u[field] || 0) + 1;
      await set({ [USAGE_KEY]: u });
      await refreshRealtimeUsage(u);
      return u[field];
    }).catch(() => 0);
    return usageQueue;
  }

  function isInbound(direction) {
    return /^in/i.test(String(direction || ""));
  }

  async function recordMessage(entry) {
    if (entry && !isInbound(entry.direction)) await bumpUsage("messagesSent");
  }

  function trackAiReply() {
    return bumpUsage("aiReplies");
  }

  async function countContacts() {
    const r = await get(["crmContacts"]);
    return Array.isArray(r.crmContacts) ? r.crmContacts.length : 0;
  }

  async function usageToday() {
    const [u, contactsUsed, { workspace }] = await Promise.all([readUsage(), countContacts(), ensureLocalProfile()]);
    return {
      date: u.date,
      messagesSent: u.messagesSent,
      aiReplies: u.aiReplies,
      dailyLimit: -1,
      aiRepliesLimit: -1,
      contactsUsed,
      contactsLimit: -1,
      campaignsUsedThisMonth: 0,
      campaignsPerMonth: -1,
      planName: UNLIMITED_PLAN.name,
      remaining: { messages: -1, aiReplies: -1, contacts: -1, campaigns: -1 },
      plan: workspace.plan
    };
  }

  // ─── message logs → stats ─────────────────────────────────────────────────

  async function readLogs() {
    const r = await get([MESSAGE_LOGS_KEY]);
    return Array.isArray(r[MESSAGE_LOGS_KEY]) ? r[MESSAGE_LOGS_KEY] : [];
  }

  function activityCategory(type) {
    const value = String(type || "").toLowerCase();
    if (/contact/.test(value)) return "contacts";
    if (/campaign|message|flow/.test(value)) return "messaging";
    if (/sync|system/.test(value)) return "system";
    return "other";
  }
  async function createActivity(body) {
    const r = await get([ACTIVITY_HISTORY_KEY]);
    const activities = Array.isArray(r[ACTIVITY_HISTORY_KEY]) ? r[ACTIVITY_HISTORY_KEY] : [];
    const type = String(body?.type || "activity");
    const description = String(body?.description || body?.message || type).trim();
    const activity = {
      id: body?.id || uuid(),
      type,
      description,
      metadata: body?.metadata || {},
      category: body?.category || activityCategory(type),
      createdAt: body?.createdAt || nowIso()
    };
    await set({ [ACTIVITY_HISTORY_KEY]: [...activities, activity].slice(-200) });
    return activity;
  }
  async function notificationHistory(query) {
    const [stored, feedResult] = await Promise.all([get([ACTIVITY_HISTORY_KEY]), get(["appNotificationFeed"])]);
    const storedActivities = Array.isArray(stored[ACTIVITY_HISTORY_KEY]) ? stored[ACTIVITY_HISTORY_KEY] : [];
    const feed = Array.isArray(feedResult.appNotificationFeed) ? feedResult.appNotificationFeed : [];
    const feedActivities = feed.map((item) => ({
      id: `feed-${item.id}`,
      type: item.type || "notification",
      description: String(item.message || item.title || item.type || "Notification"),
      metadata: item.metadata || {},
      category: activityCategory(item.type),
      createdAt: new Date(item.timestamp || Date.now()).toISOString()
    }));
    const byId = new Map();
    [...storedActivities, ...feedActivities].forEach((item) => byId.set(String(item.id), item));
    const q = String(query?.q || "").trim().toLowerCase();
    const category = String(query?.category || "all");
    const period = String(query?.period || "all");
    const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 0;
    const since = days ? Date.now() - days * 864e5 : 0;
    const all = [...byId.values()].filter((item) => {
      const timestamp = Date.parse(item.createdAt);
      return (!since || timestamp >= since) && (category === "all" || item.category === category) && (!q || `${item.type} ${item.description}`.toLowerCase().includes(q));
    }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const pageSize = Math.max(1, Math.min(100, Number(query?.pageSize) || 40));
    const page = Math.max(1, Number(query?.page) || 1);
    return { success: true, activities: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize, totalPages: Math.max(1, Math.ceil(all.length / pageSize)) };
  }

  function periodStart(period) {
    const now = new Date();
    switch (String(period || "").toLowerCase()) {
      case "today": return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      case "7days": return new Date(now.getTime() - 7 * 864e5);
      case "30days": return new Date(now.getTime() - 30 * 864e5);
      case "90days": return new Date(now.getTime() - 90 * 864e5);
      default: return null;
    }
  }

  async function dashboardStats(query) {
    const period = String(query.period || "7days").toLowerCase();
    const start = periodStart(period);
    const rows = (await readLogs())
      .filter((l) => !start || new Date(l.timestamp) >= start)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    let outgoing = 0, incoming = 0, aiReplies = 0, aiTime = 0, aiTimed = 0;
    const recipients = new Set();
    const activity = {};
    const sources = { direct: 0, campaigns: 0, scheduled: 0, flows: 0 };
    for (const row of rows) {
      const inbound = isInbound(row.direction);
      inbound ? incoming++ : outgoing++;
      if (row.phoneNumber) recipients.add(digits(row.phoneNumber));
      if (row.isAIGenerated) {
        aiReplies++;
        if (row.aiGenerationTimeMs > 0) { aiTime += row.aiGenerationTimeMs; aiTimed++; }
      }
      const day = new Date(row.timestamp);
      if (!isNaN(day)) {
        const key = day.toISOString().slice(0, 10);
        activity[key] = activity[key] || { date: key, outgoing: 0, incoming: 0 };
        activity[key][inbound ? "incoming" : "outgoing"]++;
      }
      if (row.flowId) sources.flows++;
      else if (row.campaignId) sources.campaigns++;
      else if (String(row.type || "").toLowerCase() === "scheduled") sources.scheduled++;
      else sources.direct++;
    }
    const kb = await get(["knowledgeBaseData"]);
    const history = await notificationHistory({ page: 1, pageSize: 20, category: "all", period: "7d" });
    const recentActivity = [
      ...history.activities.map((item) => ({ id: item.id, timestamp: item.createdAt, type: item.type, description: item.description })),
      ...rows.slice(0, 20).map((row, i) => ({
        id: row.id || `log-${i}`,
        timestamp: row.timestamp,
        type: row.type || "message",
        direction: row.direction || "outbound",
        phoneNumber: row.phoneNumber || null,
        status: row.status || null,
        content: row.content || null,
        description: row.content || null
      }))
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 20);
    return {
      success: true,
      period,
      stats: {
        outgoingMessages: outgoing,
        incomingMessages: incoming,
        uniqueRecipients: recipients.size,
        responseRate: outgoing > 0 ? Math.round((incoming / outgoing) * 1000) / 10 : 0,
        aiReplies,
        avgAIResponse: aiTimed ? Math.round(aiTime / aiTimed) : 0,
        activeFlows: 0,
        knowledgeBase: Array.isArray(kb.knowledgeBaseData) ? kb.knowledgeBaseData.length : 0
      },
      messageActivity: Object.values(activity).sort((a, b) => a.date.localeCompare(b.date)),
      messageSources: sources,
      campaignsOverview: { total: 0, draft: 0, scheduled: 0, active: 0, completed: 0, running: 0, paused: 0, failed: 0 },
      recentActivity
    };
  }

  async function contactMessages(phone, query) {
    const limit = Math.max(1, Math.min(200, Number(query.limit) || 30));
    const offset = Math.max(0, Number(query.offset) || 0);
    const rows = (await readLogs())
      .filter((l) => samePhone(l.phoneNumber, phone))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return {
      success: true,
      total: rows.length,
      limit,
      offset,
      messages: rows.slice(offset, offset + limit).map((row, i) => ({
        id: row.id || `log-${offset + i}`,
        content: row.content || "",
        direction: row.direction,
        type: row.type || "message",
        status: row.status || null,
        is_ai_generated: !!row.isAIGenerated,
        message_timestamp: row.timestamp,
        created_at: row.timestamp,
        campaign_id: row.campaignId || null,
        flow_id: row.flowId || null
      }))
    };
  }

  // ─── message reply status (dedupe for auto-replies) ───────────────────────

  async function checkReplyStatus(query) {
    const id = String(query.messageId || "");
    if (!id) return { __http: true, status: 400, body: { error: "messageId is required." } };
    const r = await get([REPLY_STATUS_KEY]);
    const row = (r[REPLY_STATUS_KEY] || {})[id];
    return row ? { handled: true, status: row.status } : { handled: false };
  }

  async function recordReplyStatus(body) {
    const entries = Array.isArray(body.entries) ? body.entries : [{ messageId: body.messageId, status: body.status }];
    const valid = entries.filter((e) => e && e.messageId && (e.status === "replied" || e.status === "skipped"));
    if (!valid.length) return { __http: true, status: 400, body: { error: "No valid message reply status entries provided." } };
    const r = await get([REPLY_STATUS_KEY]);
    const map = r[REPLY_STATUS_KEY] || {};
    for (const e of valid) map[String(e.messageId)] = { status: e.status, at: Date.now() };
    const ids = Object.keys(map);
    if (ids.length > 5000) {
      ids.sort((a, b) => map[a].at - map[b].at).slice(0, ids.length - 5000).forEach((id) => delete map[id]);
    }
    await set({ [REPLY_STATUS_KEY]: map });
    return { ok: true, count: valid.length };
  }

  // ─── knowledge base sources ───────────────────────────────────────────────

  async function readKnowledge() {
    const r = await get([KNOWLEDGE_KEY]);
    return Array.isArray(r[KNOWLEDGE_KEY]) ? r[KNOWLEDGE_KEY] : [];
  }

  async function upsertKnowledge(input) {
    const entry = {
      id: input.id || uuid(),
      title: input.title || "Knowledge entry",
      type: input.type || "text",
      sourceUrl: input.sourceUrl || input.type || "manual",
      extractedData: input.extractedData || {},
      createdAt: nowIso()
    };
    const list = await readKnowledge();
    const i = list.findIndex((e) => e.id === entry.id);
    if (i >= 0) list[i] = { ...list[i], ...entry, createdAt: list[i].createdAt };
    else list.push(entry);
    await set({ [KNOWLEDGE_KEY]: list });
    return entry;
  }

  function htmlToText(html) {
    try {
      if (typeof DOMParser !== "undefined") {
        const doc = new DOMParser().parseFromString(html, "text/html");
        doc.querySelectorAll("script,style,noscript,svg,iframe,nav,footer").forEach((n) => n.remove());
        return (doc.body?.innerText || doc.body?.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
      }
    } catch {}
    return String(html)
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function extractUrl(body) {
    const url = String(body.url || "").trim();
    let parsed;
    try { parsed = new URL(url); } catch { return { __http: true, status: 400, body: { error: "Invalid URL." } }; }
    let text = "";
    try {
      const res = await fetch(url, { headers: { Accept: "text/html,application/xhtml+xml,text/plain" } });
      if (res.ok) text = htmlToText(await res.text());
      else text = "";
    } catch (e) {
      return {
        status: 502,
        body: {
          error: `Could not read ${parsed.host}. Enable "Allow reading websites" in extension Settings (needed to import pages into the Knowledge Base), then try again.`
        }
      };
    }
    if (!text) text = `Imported source URL: ${url}`;
    const entry = await upsertKnowledge({
      title: parsed.host,
      type: "url",
      sourceUrl: url,
      extractedData: { company_name: parsed.host, description: text.slice(0, 1200), raw_text: text.slice(0, 16000), source_url: url }
    });
    return { success: true, knowledgeBase: entry };
  }

  // Extract text from normal text-based PDFs without ever treating the PDF
  // container itself as user-facing text. This intentionally supports the
  // common PDF filters used by browser-generated and office-exported files.
  async function inflate(bytes) {
    if (typeof DecompressionStream === "undefined") return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      return null;
    }
  }
  function latin1(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return s;
  }
  function decodePdfHex(value) {
    const hex = String(value || "").replace(/\s/g, "");
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2).padEnd(2, "0"), 16));
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      let out = "";
      for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
      return out;
    }
    return String.fromCharCode(...bytes);
  }
  function pdfStringsFromContent(content) {
    const out = [];
    const unescape = (s) => s.replace(/\\(?:\r\n|\r|\n)|\\([nrtbf()\\]|[0-7]{1,3})/g, (m, c) => {
      if (!c) return "";
      const map = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
      return map[c] ?? String.fromCharCode(parseInt(c, 8));
    });
    const re = /\[((?:[^\]\\]|\\.)*)\]\s*TJ|<([0-9a-f\s]+)>\s*(?:Tj|'|")|\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|'|")|(T\*|TD|Td|ET)/gi;
    let m;
    while ((m = re.exec(content))) {
      if (m[4]) { out.push("\n"); continue; }
      if (m[1] !== undefined) {
        const parts = m[1].match(/\(((?:[^()\\]|\\.)*)\)|<([0-9a-f\s]+)>/gi) || [];
        out.push(parts.map((p) => p[0] === "<" ? decodePdfHex(p.slice(1, -1)) : unescape(p.slice(1, -1))).join(""));
      } else if (m[2] !== undefined) {
        out.push(decodePdfHex(m[2]));
      } else {
        out.push(unescape(m[3]));
      }
    }
    return out.join(" ").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/[ \t]+\n/g, "\n").replace(/\s{3,}/g, "\n").trim();
  }
  function decodeAsciiHex(bytes) {
    const s = latin1(bytes).replace(/[\s>]/g, "");
    const out = new Uint8Array(Math.ceil(s.length / 2));
    for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.slice(i, i + 2).padEnd(2, "0"), 16);
    return out;
  }
  function decodeAscii85(bytes) {
    const s = latin1(bytes).replace(/<~|~>/g, "").replace(/\s/g, "");
    const out = [];
    for (let i = 0; i < s.length;) {
      if (s[i] === "z") { out.push(0, 0, 0, 0); i++; continue; }
      const group = s.slice(i, i + 5); i += 5;
      if (group.length < 2) break;
      const padded = group.padEnd(5, "u");
      let value = 0;
      for (const ch of padded) value = value * 85 + (ch.charCodeAt(0) - 33);
      const bytes4 = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
      out.push(...bytes4.slice(0, group.length - 1));
    }
    return new Uint8Array(out);
  }
  function pdfFilters(dict) {
    const match = /\/Filter\s*(\[[^\]]+\]|\/\w+)/i.exec(dict || "");
    if (!match) return [];
    return (match[1].match(/\/([A-Za-z0-9]+)/g) || []).map((v) => v.slice(1));
  }
  async function extractPdfText(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const raw = latin1(bytes);
    if (bytes.length < 5 || !/^%PDF-\d(?:\.\d)?/.test(raw.slice(0, 16))) throw new Error("Invalid PDF file.");
    const chunks = [];
    const re = /stream\r?\n/g;
    let m;
    while ((m = re.exec(raw))) {
      const start = m.index + m[0].length;
      const end = raw.indexOf("endstream", start);
      if (end < 0) break;
      const dict = raw.slice(Math.max(0, m.index - 4096), m.index);
      let data = bytes.subarray(start, end);
      while (data.length && (data[data.length - 1] === 10 || data[data.length - 1] === 13)) data = data.subarray(0, data.length - 1);
      for (const filter of pdfFilters(dict)) {
        if (!data) break;
        if (filter === "ASCIIHexDecode") data = decodeAsciiHex(data);
        else if (filter === "ASCII85Decode") data = decodeAscii85(data);
        else if (filter === "FlateDecode") data = await inflate(data);
        else { data = null; break; }
      }
      if (data && data.length) {
        const text = pdfStringsFromContent(latin1(data));
        if (text) chunks.push(text);
      }
      re.lastIndex = end;
    }
    const text = chunks.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    const readableChars = text.replace(/[^\p{L}\p{N}]/gu, "").length;
    if (readableChars < 3) throw new Error("PDF contains no readable text.");
    return text;
  }

  async function addPdf(form) {
    const file = form?.get?.("file");
    if (!file || typeof file.arrayBuffer !== "function") return { __http: true, status: 400, body: { error: "PDF file is required." } };
    const name = file.name || "document.pdf";
    let text = "";
    try { text = await extractPdfText(file); } catch (error) {
      return { __http: true, status: 422, body: { error: error?.message || "Could not extract readable text from this PDF." } };
    }
    const entry = await upsertKnowledge({
      title: name,
      type: "pdf",
      sourceUrl: name,
      extractedData: {
        description: text.slice(0, 1200),
        raw_text: text.slice(0, 16000),
        source_type: "pdf"
      }
    });
    return { success: true, knowledgeBase: entry };
  }

  // ─── AI routes ────────────────────────────────────────────────────────────

  function aiResult(result) {
    if (result.ok) return { __http: true, status: result.httpStatus || 200, body: result.data };
    return { __http: true, status: result.httpStatus || 500, body: { error: { message: result.error }, message: result.error } };
  }

  async function aiDefaults() {
    const [{ aiConfig }, provider] = await Promise.all([get(["aiConfig"]), global.DownlabsAI.describe()]);
    const c = aiConfig || {};
    return {
      model: provider.model,
      replyDelay: c.replyDelay ?? 2000,
      debounceTime: c.debounceTime ?? 10000,
      maxTokens: c.maxTokens ?? 500,
      temperature: c.temperature ?? 0.7
    };
  }

  async function legacyAiReply(body) {
    const text = String(body.message || "").trim();
    if (!text) return { __http: true, status: 400, body: { error: "message is required." } };
    const messages = [{
      role: "system",
      content: `You are a helpful business assistant replying on WhatsApp. Reply in the same language as the customer. Keep answers concise and practical. Campaign goal: ${body.campaignGoal || "Provide helpful business support."}`
    }];
    for (const m of Array.isArray(body.conversationHistory) ? body.conversationHistory : []) {
      const content = String(m?.content || "").trim();
      if (content) messages.push({ role: ["user", "assistant"].includes(m.role) ? m.role : "user", content });
    }
    messages.push({ role: "user", content: text });
    const result = await global.DownlabsAI.chatCompletion({ messages, temperature: 0.7, max_completion_tokens: 500 });
    if (!result.ok) return aiResult(result);
    const reply = result.data?.choices?.[0]?.message?.content || "";
    if (!reply) return { __http: true, status: 502, body: { error: "AI returned an empty reply." } };
    const usage = result.data.usage || {};
    return { reply, usage, tokens: { prompt: usage.prompt_tokens || 0, completion: usage.completion_tokens || 0, total: usage.total_tokens || 0 } };
  }

  // ─── CRM assistant ("Smarty") ─────────────────────────────────────────────
  // The CRM page executes tool calls itself; this side runs the model and keeps history.

  const SMARTY_TOOLS = [{"type":"function","function":{"name":"crm_list_contacts","description":"List CRM contacts. Supports search, status filter, tag filter and limit.","parameters":{"type":"object","properties":{"search":{"type":"string","description":"Search by name, phone or notes (optional)."},"status":{"type":"string","description":"Filter by status: new_lead, contacted, qualified, won, lost (optional)."},"tag":{"type":"string","description":"Filter contacts that have this tag (optional)."},"limit":{"type":"number","description":"Max number of contacts to return (default: no limit)."}},"required":[]}}},{"type":"function","function":{"name":"crm_get_contact","description":"Get full info about a specific CRM contact including messages, campaigns and flow executions.","parameters":{"type":"object","properties":{"phone":{"type":"string","description":"Phone number of the contact (optional if using name or id)."},"name":{"type":"string","description":"Name of the contact (optional if using phone or id)."},"id":{"type":"number","description":"CRM id of the contact (optional if using phone or name)."}},"required":[]}}},{"type":"function","function":{"name":"crm_create_contact","description":"Create a new CRM contact.","parameters":{"type":"object","properties":{"phone":{"type":"string","description":"Phone number (E.164 format, e.g. +994501234567)."},"name":{"type":"string","description":"Full name of the contact."}},"required":["phone","name"]}}},{"type":"function","function":{"name":"crm_update_contact","description":"Update status, tags, notes or custom data fields of a CRM contact by phone. Use customFields to set contact data field values: keys are field ids (from crm_list_data_fields), values depend on type. Date format: DD-MM-YYYY; datetime: DD-MM-YYYY HH:mm (24-hour).","parameters":{"type":"object","properties":{"phone":{"type":"string","description":"Phone number of the contact."},"status":{"type":"string","description":"New status: new_lead, contacted, qualified, won, lost (optional)."},"tags":{"type":"array","items":{"type":"string"},"description":"Replace tags array (optional)."},"notes":{"type":"string","description":"Replace notes (optional)."},"customFields":{"type":"object","description":"Object of field id to value. Dates: DD-MM-YYYY; datetimes: DD-MM-YYYY HH:mm (24-hour); select: single value; multiselect: array of strings.","additionalProperties":true}},"required":["phone"]}}},{"type":"function","function":{"name":"crm_list_data_fields","description":"List all contact data fields (custom fields) configured in CRM. Returns field id, name, label, type (string, number, date, datetime, boolean, select, multiselect), options for select/multiselect. Use field id when setting values in crm_update_contact customFields.","parameters":{"type":"object","properties":{},"required":[]}}},{"type":"function","function":{"name":"crm_add_data_field","description":"Add a new contact data field. Types: string, number, date, datetime, boolean, select, multiselect. For select/multiselect provide options array. Standard format: date DD-MM-YYYY, datetime DD-MM-YYYY HH:mm (24-hour).","parameters":{"type":"object","properties":{"name":{"type":"string","description":"Internal name (e.g. last_order_date). Auto-generated from label if omitted."},"label":{"type":"string","description":"Display label (e.g. Last order date)."},"type":{"type":"string","enum":["string","number","date","datetime","boolean","select","multiselect"],"description":"Field type."},"required":{"type":"boolean","description":"Whether the field is required (optional)."},"options":{"type":"array","items":{"type":"string"},"description":"For select/multiselect: list of allowed values."}},"required":["label"]}}},{"type":"function","function":{"name":"crm_list_custom_tables","description":"List custom tables (schemas) in CRM. Each table has id, name, label and fields. Use schema id when adding records with crm_add_custom_record.","parameters":{"type":"object","properties":{},"required":[]}}},{"type":"function","function":{"name":"crm_create_custom_table","description":"Create a new custom table. Provide name/label and fields array: each field has name, label, type (string, number, date, datetime, boolean, select, multiselect), optional options for select/multiselect.","parameters":{"type":"object","properties":{"name":{"type":"string","description":"Table internal name (e.g. orders)."},"label":{"type":"string","description":"Display label (e.g. Orders)."},"fields":{"type":"array","description":"Column definitions.","items":{"type":"object","properties":{"name":{"type":"string"},"label":{"type":"string"},"type":{"type":"string","enum":["string","number","date","datetime","boolean","select","multiselect"]},"options":{"type":"array","items":{"type":"string"}}}}}},"required":["label"]}}},{"type":"function","function":{"name":"crm_add_custom_record","description":"Add a row to a custom table for a contact. Provide phone or contactId, schemaId (from crm_list_custom_tables), and data object. Date format: DD-MM-YYYY; datetime: DD-MM-YYYY HH:mm (24-hour).","parameters":{"type":"object","properties":{"phone":{"type":"string","description":"Contact phone (optional if contactId provided)."},"contactId":{"type":"number","description":"Contact CRM id (optional if phone provided)."},"schemaId":{"type":"string","description":"Custom table id from crm_list_custom_tables."},"data":{"type":"object","description":"Record data: keys = field names from schema. Dates: DD-MM-YYYY; datetime: DD-MM-YYYY HH:mm (24-hour).","additionalProperties":true}},"required":["schemaId"]}}},{"type":"function","function":{"name":"crm_get_contact_messages","description":"Get message history for a specific CRM contact.","parameters":{"type":"object","properties":{"phone":{"type":"string","description":"Phone number of the contact."},"limit":{"type":"number","description":"Max messages to return (default: 30)."}},"required":["phone"]}}},{"type":"function","function":{"name":"crm_list_campaigns","description":"List CRM campaigns with stats.","parameters":{"type":"object","properties":{"status":{"type":"string","description":"Filter by status: draft, scheduled, running, active, paused, completed, failed. Use \"active\" to get currently running campaigns (includes both active and running)."},"limit":{"type":"number","description":"Max campaigns to return (optional)."}},"required":[]}}},{"type":"function","function":{"name":"crm_get_campaign","description":"Get full details of a specific campaign by id.","parameters":{"type":"object","properties":{"id":{"type":"string","description":"Campaign id."}},"required":["id"]}}},{"type":"function","function":{"name":"crm_create_campaign","description":"Create a new campaign. Only call this AFTER you have sent a detailed summary of the campaign (name, message, recipients) and the user has confirmed (yes, bəli, confirm, etc.). Do not call before confirmation. Recipients: recipientPhones and/or recipientNames; use \"myself\" for account owner. Campaign is created as draft; user can start it from CRM.","parameters":{"type":"object","properties":{"name":{"type":"string","description":"Campaign name."},"messageTemplate":{"type":"string","description":"First message text. Use [name] for contact name placeholder."},"campaignGoal":{"type":"string","description":"Optional goal/context for the campaign (e.g. discount offer)."},"recipientPhones":{"type":"array","items":{"type":"string"},"description":"Optional list of phone numbers to send to."},"recipientNames":{"type":"array","items":{"type":"string"},"description":"Optional list of contact names or \"myself\" for account owner."},"startNow":{"type":"boolean","description":"If true, create as draft; user should start from CRM."}},"required":["name","messageTemplate"]}}},{"type":"function","function":{"name":"crm_start_campaign","description":"Start (activate) an existing campaign. Use this when the user asks to start, activate, or launch a campaign — do NOT create a new campaign with crm_create_campaign. Provide either campaign id (from crm_list_campaigns) or campaign name to find a draft campaign.","parameters":{"type":"object","properties":{"id":{"type":"number","description":"Campaign id (from crm_list_campaigns or crm_get_campaign)."},"name":{"type":"string","description":"Campaign name (e.g. \"Novruz Bayramı\") to find a draft campaign if id not provided."}},"required":[]}}},{"type":"function","function":{"name":"crm_list_flows","description":"List all CRM automation flows.","parameters":{"type":"object","properties":{},"required":[]}}},{"type":"function","function":{"name":"crm_create_flow","description":"Create a flow: optional Wait step + one Send Message. Triggers: event (contact_added, tag_added, message_received) OR module_event (moduleId + moduleEventId). For \"after sale\" use module_event, inventory-management, inventory_sale_paid; add waitBeforeMessage for delay. Only call AFTER user confirmed. Use [name] in messageTemplate for contact name.","parameters":{"type":"object","properties":{"name":{"type":"string","description":"Flow name."},"messageTemplate":{"type":"string","description":"Message to send. Use [name] for contact name."},"description":{"type":"string","description":"Optional description."},"goal":{"type":"string","description":"Optional goal."},"triggerType":{"type":"string","enum":["event","module_event"],"description":"event = CRM event. module_event = from module (inventory, leasing)."},"triggerEventType":{"type":"string","enum":["contact_added","tag_added","custom_record_added","message_received"],"description":"When triggerType=event only."},"moduleId":{"type":"string","description":"When triggerType=module_event: inventory-management or leasing-core."},"moduleEventId":{"type":"string","description":"When triggerType=module_event. inventory-management: inventory_new_sale, inventory_first_purchase, inventory_sale_paid, inventory_low_stock, inventory_product_sold_out, inventory_contact_added, loyalty_status_changed, loyalty_bonus_earned, loyalty_welcome_bonus, loyalty_free_product_earned, loyalty_promo_code_used. leasing-core: leasing_contract_activated, leasing_payment_due, leasing_payment_received, leasing_installment_overdue, leasing_contract_closed."},"waitBeforeMessage":{"type":"object","description":"Optional. Wait before sending message. E.g. { \"duration\": 1, \"unit\": \"days\" } for \"1 day after trigger\".","properties":{"duration":{"type":"number","description":"Number of units (e.g. 1 for 1 day)."},"unit":{"type":"string","enum":["minutes","hours","days"],"description":"Unit of wait."}},"required":["duration","unit"]},"isActive":{"type":"boolean","description":"If true (default), flow is active."}},"required":["name","messageTemplate"]}}},{"type":"function","function":{"name":"crm_get_flow","description":"Get full details of a specific flow by id.","parameters":{"type":"object","properties":{"id":{"type":"string","description":"Flow id."}},"required":["id"]}}},{"type":"function","function":{"name":"crm_get_flow_executions","description":"Get flow execution history. Can filter by flow, contact or status.","parameters":{"type":"object","properties":{"flowId":{"type":"string","description":"Filter by flow id (optional)."},"contactId":{"type":"number","description":"Filter by contact id (optional)."},"status":{"type":"string","description":"Filter by status: pending, running, waiting, completed, failed, paused (optional)."},"limit":{"type":"number","description":"Max executions to return (optional)."}},"required":[]}}},{"type":"function","function":{"name":"crm_start_flow","description":"Start a CRM automation flow for a specific contact by phone number.","parameters":{"type":"object","properties":{"flowId":{"type":"string","description":"Id of the flow to start."},"phone":{"type":"string","description":"Phone number of the contact."},"contactName":{"type":"string","description":"Contact name (optional, for logging)."}},"required":["flowId","phone"]}}},{"type":"function","function":{"name":"crm_list_templates","description":"List all saved message templates.","parameters":{"type":"object","properties":{},"required":[]}}},{"type":"function","function":{"name":"crm_create_template","description":"Create a new message template.","parameters":{"type":"object","properties":{"title":{"type":"string","description":"Template title."},"content":{"type":"string","description":"Template message text."},"category":{"type":"string","description":"Category (optional)."},"shortcut":{"type":"string","description":"Shortcut keyword (optional)."}},"required":["title","content"]}}},{"type":"function","function":{"name":"crm_get_stats","description":"Get CRM summary statistics: total contacts, campaigns, flows, messages, etc.","parameters":{"type":"object","properties":{},"required":[]}}},{"type":"function","function":{"name":"crm_list_scheduled_messages","description":"List scheduled (queued) messages. Can filter by contact phone or status.","parameters":{"type":"object","properties":{"phone":{"type":"string","description":"Filter by contact phone (optional)."},"status":{"type":"string","description":"Filter by status: pending, sent, failed (optional)."},"limit":{"type":"number","description":"Max messages to return (optional)."}},"required":[]}}},{"type":"function","function":{"name":"crm_list_knowledge_base","description":"List entries in the CRM knowledge base.","parameters":{"type":"object","properties":{},"required":[]}}},{"type":"function","function":{"name":"check_stock","description":"Check product availability and stock levels. Search by product name, SKU, or barcode. Returns current quantity, price, and availability status.","parameters":{"type":"object","properties":{"query":{"type":"string","description":"Product name, SKU, barcode, or search query to find products"}},"required":["query"]}}},{"type":"function","function":{"name":"get_product_price","description":"Get detailed pricing information for a specific product.","parameters":{"type":"object","properties":{"product_name":{"type":"string","description":"Exact product name or search query"}},"required":["product_name"]}}},{"type":"function","function":{"name":"search_products_by_category","description":"Search and list products by category.","parameters":{"type":"object","properties":{"category":{"type":"string","description":"Category name to filter products"},"in_stock_only":{"type":"boolean","description":"Only show products that are in stock (default: true)"}},"required":["category"]}}},{"type":"function","function":{"name":"get_customer_purchases","description":"Get purchase history: dates, totals, invoices, and line items (products × qty). Use for \"what did I buy\", \"order history\", \"three days ago I purchased\". Pass customer_phone as the current chat contact. Answer only from tool data — never invent items.","parameters":{"type":"object","properties":{"customer_phone":{"type":"string","description":"WhatsApp phone of the person in this chat"},"customer_name":{"type":"string","description":"Optional name filter"}},"required":[]}}},{"type":"function","function":{"name":"get_products_summary","description":"Get summary of the product catalog: total number of products, how many in stock. Use when user asks \"how many products\", \"neçə məhsul\", \"сколько товаров\", \"products in database\".","parameters":{"type":"object","properties":{},"required":[]}}},{"type":"function","function":{"name":"get_crm_contact_phone","description":"Look up a CRM contact by name to get their phone number. Use this when the user says to create a sale or send an invoice for a contact identified by NAME (e.g. \"Kamal\", \"Kamal adlı CRM kontaktına\") — then use the returned phone in create_sale and send_invoice. Do NOT use the current chat's phone for a different contact. Call this first when the customer is specified by name, then use the returned phone.","parameters":{"type":"object","properties":{"contact_name":{"type":"string","description":"Exact or partial CRM contact name (e.g. Kamal)"}},"required":["contact_name"]}}},{"type":"function","function":{"name":"add_product","description":"Add a new product to the catalog. ONLY call after user has explicitly confirmed (e.g. \"Да\", \"Добавьте\", \"Подтверждаю\").","parameters":{"type":"object","properties":{"name":{"type":"string","description":"Product name"},"selling_price":{"type":"number","description":"Selling price per unit"},"cost_price":{"type":"number","description":"Cost price per unit (optional)"},"quantity":{"type":"number","description":"Initial stock quantity (optional)"},"unit":{"type":"string","description":"Unit: шт, кг, etc. (optional)"},"category":{"type":"string","description":"Category name (optional)"},"barcode":{"type":"string","description":"Barcode (optional)"},"description":{"type":"string","description":"Product description (optional)"}},"required":["name","selling_price"]}}},{"type":"function","function":{"name":"update_stock","description":"Change product stock quantity (increase or decrease). ONLY call after user has explicitly confirmed.","parameters":{"type":"object","properties":{"product_name":{"type":"string","description":"Product name or search query"},"quantity_change":{"type":"number","description":"Quantity to add (positive) or subtract (negative)"},"reason":{"type":"string","description":"Reason for the change (optional)"}},"required":["product_name","quantity_change"]}}},{"type":"function","function":{"name":"update_product","description":"Update product details: cost price (maya dəyəri, себестоимость), selling price, name, category, unit, description, barcode, min stock level. Use when user says \"set cost to X\", \"change price\", \"maya dəyəri 4 azn\". ONLY call after user has explicitly confirmed.","parameters":{"type":"object","properties":{"product_name":{"type":"string","description":"Product name or search query to find the product"},"cost_price":{"type":"number","description":"New cost price per unit (optional)"},"selling_price":{"type":"number","description":"New selling price per unit (optional)"},"name":{"type":"string","description":"New product name (optional)"},"category":{"type":"string","description":"New category (optional)"},"unit":{"type":"string","description":"New unit: шт, кг, etc. (optional)"},"description":{"type":"string","description":"New description (optional)"},"barcode":{"type":"string","description":"New barcode (optional)"},"min_stock_level":{"type":"number","description":"New minimum stock level for alerts (optional)"}},"required":["product_name"]}}},{"type":"function","function":{"name":"create_sale","description":"Create a new sale for the customer. ONLY call after user has explicitly confirmed. When the customer was promised a PERCENTAGE discount (e.g. 10% endirim), use discount_percent (e.g. 10), NOT discount amount — otherwise the system will apply the number as fixed amount. When the customer is identified by CRM contact NAME, first call get_crm_contact_phone(contact_name), then use that phone here.","parameters":{"type":"object","properties":{"customer_name":{"type":"string","description":"Customer full name"},"customer_phone":{"type":"string","description":"Customer phone (WhatsApp)"},"items":{"type":"array","items":{"type":"object","properties":{"product_name":{"type":"string"},"quantity":{"type":"number"}},"required":["product_name","quantity"]},"description":"Items to sell"},"payment_method":{"type":"string","enum":["cash","card","transfer","other"],"description":"Payment method (optional)"},"discount":{"type":"number","description":"Fixed discount in currency (e.g. 5.50). Use only for fixed sum; for % use discount_percent."},"discount_percent":{"type":"number","description":"Discount as % of subtotal (e.g. 10 for 10%). Use when you promised the customer a percentage discount."},"notes":{"type":"string","description":"Notes (optional)"}},"required":["customer_name","customer_phone","items"]}}},{"type":"function","function":{"name":"send_invoice","description":"Generate and send PDF invoice to customer via WhatsApp. ONLY call after user has explicitly confirmed. Requires invoice_number and customer_phone. When the customer is identified by CRM contact NAME, use the phone from get_crm_contact_phone — never use the current chat's phone for a different contact.","parameters":{"type":"object","properties":{"invoice_number":{"type":"string","description":"Invoice number (e.g. INV-0001)"},"customer_phone":{"type":"string","description":"Customer phone to send invoice to"}},"required":["invoice_number","customer_phone"]}}}];

  function smartySystemPrompt() {
    return [
      `You are Smarty, the built-in assistant of ${PRODUCT_NAME}, a WhatsApp CRM and marketing tool that runs entirely in the user's browser.`,
      "Help the user manage contacts, campaigns, automation flows, templates, scheduled messages, the knowledge base, products and sales.",
      "Use the provided tools to look up or change CRM data instead of guessing. Before creating campaigns or flows, or starting them, confirm the details with the user.",
      "Answer in the user's language. Be concise and practical. You may link to CRM pages with markdown links like [Contacts](#/contacts).",
      `Today is ${new Date().toDateString()}.`
    ].join("\n");
  }

  async function readChat() {
    const r = await get([SMARTY_CHAT_KEY]);
    return Array.isArray(r[SMARTY_CHAT_KEY]) ? r[SMARTY_CHAT_KEY] : [];
  }
  async function writeChat(list) {
    await set({ [SMARTY_CHAT_KEY]: list.slice(-300) });
  }

  function chatToModelMessages(history) {
    return history.slice(-30).filter((m) => m.content).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }));
  }

  async function smartyReply(userText, attachment) {
    const history = await readChat();
    const userMsg = { id: uuid(), role: "user", content: userText, createdAt: nowIso() };
    if (attachment) {
      userMsg.fileName = attachment.name;
      userMsg.fileType = attachment.type;
    }
    const messages = [{ role: "system", content: smartySystemPrompt() }, ...chatToModelMessages(history)];
    messages.push({ role: "user", content: attachment?.content || userText });
    history.push(userMsg);

    const result = await global.DownlabsAI.chatCompletion({ messages, tools: SMARTY_TOOLS, tool_choice: "auto", temperature: 0.4, max_completion_tokens: 1500 });
    if (!result.ok) {
      await writeChat(history);
      return { __http: true, status: result.httpStatus || 500, body: { error: result.error } };
    }
    const choice = result.data?.choices?.[0]?.message || {};
    const assistant = { id: uuid(), role: "assistant", content: choice.content || "", createdAt: nowIso() };
    history.push(assistant);
    await writeChat(history);

    const toolCalls = (choice.tool_calls || []).map((tc) => ({ id: tc.id, name: tc.function?.name, arguments: parseArgs(tc.function?.arguments) }));
    if (!toolCalls.length) return { message: assistant };
    await set({ [SMARTY_PENDING_KEY]: { assistantId: assistant.id, messages: [...messages, choice] } });
    return { message: assistant, toolCalls };
  }

  function parseArgs(raw) {
    if (raw && typeof raw === "object") return raw;
    try { return JSON.parse(raw || "{}"); } catch { return {}; }
  }

  async function smartyToolResults(body) {
    const r = await get([SMARTY_PENDING_KEY]);
    const pending = r[SMARTY_PENDING_KEY];
    if (!pending) return { __http: true, status: 400, body: { error: "No pending tool calls." } };
    const messages = [...pending.messages];
    for (const tr of Array.isArray(body.toolResults) ? body.toolResults : []) {
      const content = typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result ?? {});
      messages.push({ role: "tool", tool_call_id: tr.id, content: content.slice(0, 12000) });
    }
    // The CRM runs one round of tools per turn, so ask for the final answer without further tool use.
    const result = await global.DownlabsAI.chatCompletion({ messages, tools: SMARTY_TOOLS, tool_choice: "none", temperature: 0.4, max_completion_tokens: 1500 });
    await set({ [SMARTY_PENDING_KEY]: null });
    const content = result.ok ? result.data?.choices?.[0]?.message?.content || "Done." : `⚠️ ${result.error}`;
    const history = await readChat();
    const msg = history.find((m) => m.id === pending.assistantId);
    if (msg) msg.content = [msg.content, content].filter(Boolean).join("\n\n");
    await writeChat(history);
    return { message: msg || { id: pending.assistantId, role: "assistant", content, createdAt: nowIso() } };
  }

  async function smartyMessages(query) {
    const history = await readChat();
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 50));
    const before = query.before ? Date.parse(query.before) : null;
    const pool = before ? history.filter((m) => Date.parse(m.createdAt) < before) : history;
    return { messages: pool.slice(-limit), hasMore: pool.length > limit };
  }

  async function smartySendWithFile(form) {
    const file = form?.get?.("file");
    const text = String(form?.get?.("message") || "");
    if (!file) return { __http: true, status: 400, body: { error: "File is required." } };
    let fileText = "";
    try {
      if (/pdf/i.test(file.type) || /\.pdf$/i.test(file.name)) fileText = await extractPdfText(file);
      else if (/^text\/|json|csv|xml/i.test(file.type) || /\.(txt|csv|md|json|xml|html?)$/i.test(file.name)) fileText = await file.text();
    } catch {}
    const content = fileText
      ? `${text || "Please analyze this file."}\n\n--- ${file.name} ---\n${fileText.slice(0, 20000)}`
      : `${text || "Please analyze this file."}\n\n(Attached file "${file.name}" (${file.type || "unknown type"}) could not be read as text.)`;
    return smartyReply(text || `Analyzing: ${file.name}`, { name: file.name, type: file.type, content });
  }

  const PAGE_HINTS = {
    en: "Need help? Ask Smarty!",
    ru: "Нужна помощь? Напишите мне!",
    az: "Kömək lazımdır? Yazın!"
  };

  // ─── router ───────────────────────────────────────────────────────────────

  // Route results carry __http so they are never confused with data that has a "status" field.
  function ok(body, status = 200) {
    return { __http: true, status, body };
  }

  async function profilePayload() {
    const p = await ensureLocalProfile();
    return { tokens: { accessToken: p.accessToken, refreshToken: p.refreshToken }, accessToken: p.accessToken, refreshToken: p.refreshToken, user: p.user, workspace: p.workspace };
  }

  async function route(method, path, query, body) {
    const p = path.replace(/\/+$/, "") || "/";
    const M = method.toUpperCase();
    let m;

    // health / meta
    if (p === "/health") return ok({ ok: true, service: "downlabs-local", timestamp: nowIso() });
    if (p === "/extension/latest-version") return ok({ version: chrome.runtime.getManifest().version });

    // auth — always "signed in" locally
    // The CRM clears its local database after a successful login/invite, so those always fail here.
    if (M === "POST" && ["/auth/login", "/auth/register", "/teams/invite/accept"].includes(p)) {
      return { __http: true, status: 400, body: { error: "Sign-in is not needed — this edition runs locally with no account." } };
    }
    if (p.startsWith("/teams/invite/validate")) return ok({ valid: false, error: "Team invites are not available in the standalone edition." });
    if (M === "POST" && p === "/auth/refresh") return ok(await profilePayload());
    if (p === "/auth/me") { const x = await profilePayload(); return ok({ user: x.user, workspace: x.workspace }); }
    if (p === "/billing/plans") return ok({ success: true, plans: [UNLIMITED_PLAN] });
    if (p === "/account" || p === "/account/subscription" || p === "/account/subscription/upgrade") {
      const x = await profilePayload();
      return ok({ success: true, user: x.user, workspace: x.workspace, currentPlan: x.workspace.plan, usage: await usageToday(), plans: [UNLIMITED_PLAN] });
    }

    // workspace
    if (M === "GET" && p === "/workspace/me") return ok((await ensureLocalProfile()).workspace);
    if (M === "POST" && p === "/workspace") return ok({ workspace: await updateWorkspace(body || {}) });
    if (M === "POST" && p === "/workspace/switch") { const x = await profilePayload(); return ok({ accessToken: x.accessToken, workspace: x.workspace }); }
    if (M === "POST" && p === "/workspace/me/extension-install-whatsapp-ping") return ok({ extensionInstallWhatsappSentAt: (await ensureLocalProfile()).workspace.extensionInstallWhatsappSentAt });
    if (M === "GET" && (m = /^\/workspace\/by-phone\/(.+)$/.exec(p))) return ok({ workspace: await linkWhatsappPhone(decodeURIComponent(m[1])) });
    if (M === "PATCH" && /^\/workspace\/[^/]+$/.test(p)) return ok({ workspace: await updateWorkspace(body || {}) });

    // AI
    if (p === "/config/ai-defaults") return ok(await aiDefaults());
    if (M === "POST" && p === "/ai/openai-chat") return aiResult(await global.DownlabsAI.chatCompletion(body || {}));
    if (M === "POST" && p === "/ai/openai-transcriptions") return aiResult(await global.DownlabsAI.transcribe(body));
    if (M === "POST" && p === "/ai/reply") { const r = await legacyAiReply(body || {}); return r.__http ? r : ok(r); }

    // usage (display only)
    if (M === "POST" && p === "/usage/track-ai-reply") {
      const used = await trackAiReply();
      return ok({ limitExceeded: false, used, limit: -1, remainingAiReplies: -1, planName: UNLIMITED_PLAN.name });
    }
    if (p === "/usage/today" || p === "/ai/usage/today") return ok(await usageToday());
    if (M === "POST" && (p === "/usage/log-message" || p === "/usage/track-message")) {
      await recordMessage(body || {});
      return ok({ success: true, limitExceeded: false, used: (await readUsage()).messagesSent, limit: -1 });
    }
    if (p === "/usage/dashboard-stats") return ok(await dashboardStats(query));

    // contacts & message status
    if (M === "GET" && (m = /^\/contacts\/(.+)\/messages$/.exec(p))) return ok(await contactMessages(decodeURIComponent(m[1]), query));
    if (p === "/message-reply-status/check") { const r = await checkReplyStatus(query); return r.__http ? r : ok(r); }
    if (M === "POST" && p === "/message-reply-status/record") { const r = await recordReplyStatus(body || {}); return r.__http ? r : ok(r); }

    // knowledge base
    if (M === "POST" && p === "/knowledge/text") {
      const content = String(body?.content || "").trim();
      if (!content) return { __http: true, status: 400, body: { error: "content is required." } };
      return ok({ success: true, knowledgeBase: await upsertKnowledge({ title: String(body.title || "").trim() || "Text entry", type: "text", sourceUrl: "manual", extractedData: { description: content.slice(0, 1200), raw_text: content.slice(0, 12000), source_type: "text" } }) });
    }
    if (M === "POST" && p === "/knowledge/direct") {
      return ok({ success: true, knowledgeBase: await upsertKnowledge({ id: body?.id, title: body?.title || "Knowledge entry", type: body?.type || "direct", sourceUrl: body?.source || "direct", extractedData: body?.extractedData || {} }) });
    }
    if (M === "POST" && p === "/knowledge/extract") { const r = await extractUrl(body || {}); return r.__http ? r : ok(r); }
    if (M === "POST" && p === "/knowledge/pdf") { const r = await addPdf(body); return r.__http ? r : ok(r); }
    if (M === "GET" && /^\/knowledge\/[^/]+$/.test(p)) {
      const list = (await readKnowledge()).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return ok({ success: true, knowledgeBases: list });
    }
    if (M === "DELETE" && (m = /^\/knowledge\/([^/]+)$/.exec(p))) {
      const id = decodeURIComponent(m[1]);
      await set({ [KNOWLEDGE_KEY]: (await readKnowledge()).filter((e) => e.id !== id) });
      return ok({ success: true, id });
    }

    // CRM assistant
    if (p === "/chat/init") return ok({ success: true });
    if (p === "/chat/messages" && M === "GET") return ok(await smartyMessages(query));
    if (p === "/chat/messages" && M === "DELETE") { await set({ [SMARTY_CHAT_KEY]: [], [SMARTY_PENDING_KEY]: null }); return ok({ success: true }); }
    if (p === "/chat/page-hint") return ok({ hint: PAGE_HINTS[query.lang] || PAGE_HINTS.en });
    if (M === "POST" && p === "/chat/append-assistant") {
      const history = await readChat();
      const message = { id: uuid(), role: "assistant", content: String(body?.content || ""), createdAt: nowIso() };
      history.push(message);
      await writeChat(history);
      return ok({ message });
    }
    if (M === "POST" && p === "/chat/send") {
      const text = String(body?.message || "").trim();
      if (!text) return { __http: true, status: 400, body: { error: "message is required." } };
      const r = await smartyReply(text);
      return r.__http ? r : ok(r);
    }
    if (M === "POST" && p === "/chat/send-with-file") { const r = await smartySendWithFile(body); return r.__http ? r : ok(r); }
    if (M === "POST" && p === "/chat/send-tool-results") { const r = await smartyToolResults(body || {}); return r.__http ? r : ok(r); }

    // Cloud backup / multi-device sync. Data already lives in this browser, so reads return
    // nothing (which the CRM treats as "no remote changes") and writes are acknowledged.
    if (p === "/workspace-backup") return M === "GET" ? { __http: true, status: 404, body: { error: "No cloud backup in the standalone edition." } } : ok({ success: true });
    if (p === "/workspace-sync/events") return M === "GET" ? ok({ events: [], hasMore: false, serverMaxSeq: null }) : ok({});
    if (M === "GET" && (p === "/contacts" || p === "/campaigns" || p === "/flows")) return ok({ [p.slice(1)]: [] });
    if (M === "POST" && (m = /^\/(contacts|campaigns|flows)\/sync(-bulk)?$/.exec(p))) {
      const items = body?.[m[1]];
      return ok({ success: true, synced: Array.isArray(items) ? items.length : 1, failed: 0 });
    }
    if (p === "/activity/create" && M === "POST") return ok({ success: true, activity: await createActivity(body || {}) });
    if (p.startsWith("/activity/history") && M === "GET") return ok(await notificationHistory(query));
    if (p === "/teams/members" && M === "GET") {
      const { user } = await ensureLocalProfile();
      // The Team page knows the roles admin / operator / viewer; the workspace owner is an admin with isOwner.
      return ok({ members: [{ id: user.id, userId: user.id, name: user.name, email: user.email, role: "admin", isOwner: true, status: "active" }] });
    }
    if (p.startsWith("/teams/")) return { __http: true, status: 400, body: { error: "Team members are not available in the standalone edition." } };

    return { __http: true, status: 404, body: { error: `Route not available in the standalone edition: ${M} ${p}` } };
  }

  // ─── fetch interception ───────────────────────────────────────────────────

  function matchBase(url) {
    for (const base of [API_BASE, ...LEGACY_API_BASES]) {
      if (url === base || url.startsWith(base + "/") || url.startsWith(base + "?")) return base;
    }
    return null;
  }

  async function handleRequest(url, init) {
    const base = matchBase(url);
    const u = new URL(url);
    const basePath = new URL(base).pathname.replace(/\/+$/, "");
    const path = u.pathname.slice(basePath.length) || "/";
    const query = Object.fromEntries(u.searchParams.entries());
    const method = (init?.method || "GET").toUpperCase();
    let body = init?.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {}
    }
    let result;
    try {
      result = await route(method, path, query, body);
    } catch (e) {
      console.error("[DownlabsLocal] route failed", method, path, e);
      result = { status: 500, body: { error: e instanceof Error ? e.message : String(e) } };
    }
    return new Response(JSON.stringify(result.body ?? {}), {
      status: result.status || 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  const nativeFetch = global.fetch.bind(global);
  async function localFetch(input, init) {
    let url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    if (url && matchBase(url)) {
      if (input && typeof input === "object" && !(input instanceof URL) && !init) {
        const req = input;
        const ct = req.headers.get("content-type") || "";
        const reqBody = req.method === "GET" || req.method === "HEAD" ? undefined : ct.includes("multipart/form-data") ? await req.formData() : await req.text();
        init = { method: req.method, body: reqBody };
      }
      return handleRequest(url, init);
    }
    return nativeFetch(input, init);
  }
  if (!global.__downlabsFetchPatched) {
    global.fetch = localFetch;
    global.__downlabsFetchPatched = true;
  }

  const supabaseChannel = () => {
    const ch = {
      on: () => ch,
      subscribe: (cb) => { try { cb && cb("CLOSED"); } catch {} return ch; },
      send: async () => "ok",
      unsubscribe: async () => "ok"
    };
    return ch;
  };
  global.__downlabsSupabaseStub = { channel: supabaseChannel, removeChannel: async () => "ok", removeAllChannels: async () => [] };

  global.DownlabsLocal = {
    API_BASE,
    UNLIMITED_PLAN,
    ensureLocalProfile,
    linkWhatsappPhone,
    refreshRealtimeUsage,
    recordMessage,
    trackAiReply,
    route
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
