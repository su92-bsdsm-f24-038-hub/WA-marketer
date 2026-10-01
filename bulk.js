// Bulk Sender page: list, create, edit, run and delete campaigns.
// Views (hash routes): #/ list · #/new · #/edit/<id> · #/view/<id>
(async function () {
  "use strict";

  const B = DownlabsBulk;
  const K = B.KEYS;
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, text) => {
    const n = document.createElement(tag);
    Object.assign(n, props);
    if (text !== undefined) n.textContent = text;
    return n;
  };

  const params = new URLSearchParams(location.search);
  if (params.has("embedded")) document.documentElement.classList.add("embedded");
  if (params.has("compact")) document.documentElement.classList.add("compact");
  await B.migrateLegacy();

  function showMsg(id, kind, text) {
    const m = $(id);
    m.className = "msg" + (kind ? " " + kind : "");
    m.textContent = text || "";
  }

  const STATUS_LABEL = { draft: "Draft", running: "Running", saving: "Saving contacts", paused: "Paused", stopped: "Stopped", completed: "Completed" };

  function attachmentsOf(value) {
    if (Array.isArray(value && value.attachments) && value.attachments.length) return value.attachments;
    return value && value.attachment ? [value.attachment] : [];
  }

  function attachmentLabel(a) {
    return a && a.name ? a.name : "file";
  }

  // ─── WhatsApp tab ─────────────────────────────────────────────────────────

  async function findWaTab() {
    const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
    return tabs[0] || null;
  }

  async function kickRunner() {
    const tab = await findWaTab();
    if (tab) chrome.tabs.sendMessage(tab.id, { type: "DL_BULK_KICK" }).catch(() => {});
  }

  let waReady = false;
  async function checkWhatsApp() {
    const tab = await findWaTab();
    const dot = $("waDot");
    const text = $("waText");
    $("openWa").classList.toggle("hidden", !!tab);
    $("reloadWa").classList.add("hidden");
    waReady = false;
    if (!tab) {
      dot.className = "dot off";
      text.textContent = "WhatsApp Web is not open. Open it and keep that tab open while campaigns run.";
      return;
    }
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "DL_BULK_PING" });
      waReady = !!(res && res.ready);
      dot.className = "dot " + (waReady ? "on" : "wait");
      text.textContent = waReady ? "WhatsApp Web is connected and ready." : "WhatsApp Web is open but not connected yet (log in or wait for it to load).";
    } catch {
      dot.className = "dot wait";
      text.textContent = "WhatsApp Web was opened before the extension was updated — reload that tab once.";
      $("reloadWa").classList.remove("hidden");
    }
  }

  $("openWa").addEventListener("click", () => chrome.tabs.create({ url: "https://web.whatsapp.com" }));
  $("reloadWa").addEventListener("click", async () => {
    const tab = await findWaTab();
    if (tab) chrome.tabs.reload(tab.id);
    setTimeout(checkWhatsApp, 6000);
  });

  // ─── campaign actions (shared by list and detail) ─────────────────────────

  function canLaunch(c) {
    if (!c.recipients || !c.recipients.length) return "Add at least one recipient first (Edit the campaign).";
    if (!String(c.message || "").trim() && !attachmentsOf(c).length) return "Add a message or an attachment first (Edit the campaign).";
    return null;
  }

  async function setStatus(id, status) {
    const c = await B.getCampaign(id);
    if (!c) return null;
    if (status === "running") {
      const problem = canLaunch(c);
      if (problem) return problem;
    }
    await B.patchCampaign(id, (x) => {
      x.status = status;
      if (status === "running") {
        x.startedAt = x.startedAt || Date.now();
        x.nextSendAt = Date.now();
        x.consecutiveFailures = 0;
        x.note = x.cursor > 0 ? "Resuming…" : "Starting…";
      } else if (status === "paused") x.note = "Paused by you.";
      else if (status === "stopped") x.note = "Stopped by you.";
    });
    kickRunner();
    return null;
  }

  /** Saves the campaign's numbers as WhatsApp contacts without sending anything. */
  async function saveContactsOnly(id) {
    const c = await B.getCampaign(id);
    if (!c) return null;
    if (!c.recipients || !c.recipients.length) return "Add recipients first (Edit the campaign).";
    if (c.status === "running" || c.status === "saving") return "Pause the campaign first.";
    await B.patchCampaign(id, (x) => {
      x.statusBeforeSaving = x.status;
      x.status = "saving";
      x.settings = { ...x.settings, saveContacts: true };
      if ((x.contactCursor || 0) >= x.recipients.length) {
        x.contactCursor = 0;
        x.contactResults = [];
        x.contactCounts = {};
      }
      x.nextSendAt = Date.now();
      x.note = "Saving contacts…";
    });
    kickRunner();
    return null;
  }

  async function stopSaving(id) {
    await B.patchCampaign(id, (x) => {
      if (x.status !== "saving") return;
      x.status = x.statusBeforeSaving || "draft";
      x.statusBeforeSaving = null;
      x.note = "Contact saving stopped by you.";
    });
    return null;
  }

  function contactStatsText(c) {
    const k = c.contactCounts || {};
    const done = Math.min(c.contactCursor || 0, c.recipients.length);
    if (!done && c.status !== "saving") {
      return B.normalizeSettings(c.settings).saveContacts ? "Contacts: will be saved before the first message" : "";
    }
    const parts = [`${k.saved || 0} saved`];
    if (k.exists) parts.push(`${k.exists} already in contacts`);
    if (k.not_on_whatsapp) parts.push(`${k.not_on_whatsapp} not on WhatsApp`);
    if (k.failed) parts.push(`${k.failed} failed`);
    if (done < c.recipients.length) parts.push(`${c.recipients.length - done} pending`);
    return `Contacts: ${parts.join(" · ")}`;
  }

  async function duplicate(id) {
    const c = await B.getCampaign(id);
    if (!c) return null;
    const copy = B.newCampaign({
      name: `Copy of ${c.name}`,
      message: c.message,
      settings: c.settings,
      recipients: c.recipients,
      source: c.source || {},
      attachments: attachmentsOf(c).map((a) => ({ ...a, version: Date.now() })),
      attachment: null
    });
    const atts = await B.getAttachments(id);
    if (atts.length) await chrome.storage.local.set({ [B.attachmentKey(copy.id)]: atts });
    await B.putCampaign(copy);
    return copy.id;
  }

  function exportReport(c) {
    const blob = new Blob(["﻿" + B.reportCSV(c)], { type: "text/csv;charset=utf-8" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `${(c.name || "campaign").replace(/[^\w-]+/g, "_")}-report.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Two-step confirmation on a button (no browser dialogs).
  function confirmClick(button, label, action) {
    if (button.dataset.armed === "1") {
      button.dataset.armed = "";
      action();
      return;
    }
    const original = button.textContent;
    button.dataset.armed = "1";
    button.textContent = label;
    setTimeout(() => {
      if (button.dataset.armed === "1") {
        button.dataset.armed = "";
        button.textContent = original;
      }
    }, 4000);
  }

  // ─── list view ────────────────────────────────────────────────────────────

  let campaigns = [];

  function progressOf(c) {
    const total = c.recipients.length;
    return { total, done: Math.min(c.cursor || 0, total), pct: total ? Math.round(((c.cursor || 0) / total) * 100) : 0 };
  }

  /** Swaps a campaign row's name cell for an inline name editor. Works regardless of status. */
  function startRenameRow(nameCell, campaign) {
    nameCell.textContent = "";
    const input = el("input", { type: "text", value: campaign.name || "" });
    input.style.cssText = "width:100%;max-width:240px;padding:6px 8px;border-radius:8px;border:1.5px solid var(--line);background:var(--field);color:var(--ink);font:inherit;";
    const row = el("div", { style: "display:flex;gap:6px;align-items:center;flex-wrap:wrap;" });
    const save = el("button", { className: "btn sm primary", type: "button" }, "Save");
    const cancel = el("button", { className: "btn sm", type: "button" }, "Cancel");
    row.append(input, save, cancel);
    nameCell.appendChild(row);
    input.focus();
    input.select();
    const stop = (e) => e.stopPropagation();
    input.addEventListener("click", stop);
    row.addEventListener("click", stop);
    const finish = async (commit) => {
      if (commit) {
        const v = input.value.trim();
        if (v && v !== campaign.name) await B.patchCampaign(campaign.id, (x) => { x.name = v; });
      }
      renderList();
    };
    save.addEventListener("click", () => finish(true));
    cancel.addEventListener("click", () => finish(false));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") finish(false);
    });
  }

  function renderList() {
    const tbody = $("campaignTable").tBodies[0];
    tbody.textContent = "";
    $("emptyState").classList.toggle("hidden", campaigns.length > 0);
    $("campaignTable").classList.toggle("hidden", campaigns.length === 0);

    const stats = $("listStats");
    stats.textContent = "";
    const count = (s) => campaigns.filter((c) => c.status === s).length;
    if (campaigns.length) {
      stats.append(el("span", { className: "chip" }, `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}`));
      if (count("running")) stats.append(el("span", { className: "chip ok" }, `${count("running")} running`));
      const sent = campaigns.reduce((n, c) => n + (c.counts.sent || 0), 0);
      stats.append(el("span", { className: "chip" }, `${sent} message${sent === 1 ? "" : "s"} sent`));
    }

    for (const c of campaigns) {
      const p = progressOf(c);
      const tr = el("tr");
      const name = el("td", { className: "name" });
      const link = el("a", {}, c.name || "Untitled campaign");
      link.addEventListener("click", () => go(c.status === "draft" ? `#/edit/${c.id}` : `#/view/${c.id}`));
      const names = attachmentsOf(c).map(attachmentLabel).join(", ");
      name.append(link, el("div", { className: "hint", style: "margin:2px 0 0" }, `${p.total} recipient${p.total === 1 ? "" : "s"}${names ? ` · 📎 ${names}` : ""}`));
      const status = el("td");
      status.append(el("span", { className: "badge " + c.status }, STATUS_LABEL[c.status] || c.status));
      const prog = el("td");
      prog.append(el("div", { style: "font-size:12.5px" }, `${c.counts.sent || 0} sent · ${p.done}/${p.total}`));
      const bar = el("div", { className: "mini" });
      bar.append(el("i", { style: `width:${p.pct}%` }));
      prog.append(bar);
      const created = el("td", { style: "font-size:12.5px;color:var(--muted)" }, new Date(c.createdAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }));
      const actions = el("td");
      const box = el("div", { className: "actions" });
      const btn = (label, cls, fn) => {
        const b = el("button", { className: `btn sm ${cls || ""}`, type: "button" }, label);
        b.addEventListener("click", () => fn(b));
        box.append(b);
      };
      const listAction = async (fn) => {
        const problem = await fn();
        showMsg("listMsg", problem ? "err" : "", problem || "");
      };
      btn("Rename", "", () => startRenameRow(name, c));
      if (c.status !== "draft") btn("View", "", () => go(`#/view/${c.id}`));
      if (c.status === "draft") btn("Start", "primary", () => listAction(() => setStatus(c.id, "running")));
      if (c.status === "running") btn("Pause", "", () => listAction(() => setStatus(c.id, "paused")));
      if (c.status === "saving") btn("Stop saving", "", () => listAction(() => stopSaving(c.id)));
      if ((c.status === "paused" || c.status === "stopped") && p.done < p.total) btn("Resume", "primary", () => listAction(() => setStatus(c.id, "running")));
      if (!["running", "saving", "completed"].includes(c.status)) btn("Edit", "", () => go(`#/edit/${c.id}`));
      btn("Duplicate", "", async () => {
        const id = await duplicate(c.id);
        if (id) go(`#/edit/${id}`);
      });
      btn("Delete", "danger", (b) => confirmClick(b, "Confirm delete", () => B.deleteCampaign(c.id)));
      actions.append(box);
      tr.append(name, status, prog, created, actions);
      tbody.append(tr);
    }
  }

  const FOLLOWUP_DAYS = [3, 7, 14];
  function defaultFollowupSteps() {
    return FOLLOWUP_DAYS.map((days) => ({
      days,
      message: days === 3
        ? "Hi {{first_name|there}}, just following up on my previous message."
        : days === 7
          ? "Hi {{first_name|there}}, do you have any questions I can help with?"
          : "Hi {{first_name|there}}, this is my final follow-up. Reply whenever you are ready."
    }));
  }

  function renderDashboard() {
    const sent = campaigns.reduce((n, c) => n + (c.counts.sent || 0), 0);
    const replies = campaigns.reduce((n, c) => n + (c.counts.replied || 0), 0);
    $("mdCampaigns").textContent = campaigns.length;
    $("mdSent").textContent = sent;
    $("mdReplies").textContent = replies;
    B.listFollowupFlows().then((flows) => { $("mdFollowups").textContent = flows.filter((f) => f.status === "active").length; });
    const recent = $("mdRecent");
    recent.textContent = "";
    if (!campaigns.length) { recent.append(el("span", { className: "hint" }, "No campaigns yet.")); return; }
    campaigns.slice(0, 5).forEach((c) => {
      const row = el("div", { className: "flow-list-row" });
      row.append(el("span", {}, c.name || "Untitled campaign"), el("span", { className: "hint" }, (c.counts.sent || 0) + " sent · " + (c.counts.replied || 0) + " replies"));
      recent.append(row);
    });
  }

  function renderFollowupSteps(steps = defaultFollowupSteps()) {
    const box = $("followupSteps");
    box.textContent = "";
    FOLLOWUP_DAYS.forEach((days) => {
      const existing = steps.find((s) => Number(s.days) === days) || { days, message: "" };
      const row = el("div", { className: "flow-step" });
      row.dataset.days = String(days);
      const toggle = el("label", { className: "field" });
      toggle.append(el("span", {}, days + " days"));
      const check = el("input", { type: "checkbox", className: "flow-step-enabled" });
      check.checked = !!steps.find((s) => Number(s.days) === days);
      toggle.append(check);
      const message = el("textarea", { className: "flow-step-message", rows: 2, placeholder: "Message sent after " + days + " days" });
      message.value = existing.message || "";
      message.disabled = !check.checked;
      check.addEventListener("change", () => { message.disabled = !check.checked; });
      row.append(toggle, message);
      box.append(row);
    });
  }

  function readFollowupSteps() {
    return [...document.querySelectorAll("#followupSteps .flow-step")]
      .filter((row) => row.querySelector(".flow-step-enabled").checked)
      .map((row) => ({ days: Number(row.dataset.days), message: row.querySelector(".flow-step-message").value.trim() }))
      .filter((s) => s.message);
  }

  async function renderFollowupView() {
    const select = $("followupCampaign");
    const current = select.value;
    select.textContent = "";
    campaigns.filter((c) => c.recipients && c.recipients.length).forEach((c) => select.append(el("option", { value: c.id }, c.name || "Untitled campaign")));
    if (current && [...select.options].some((o) => o.value === current)) select.value = current;
    else if (select.options.length) select.selectedIndex = 0;
    if (!$("followupSteps").children.length) renderFollowupSteps();
    const list = $("followupList");
    list.textContent = "";
    const flows = await B.listFollowupFlows();
    if (!flows.length) { list.append(el("span", { className: "hint" }, "No follow-up flows yet.")); return; }
    for (const flow of flows) {
      const campaign = campaigns.find((c) => c.id === flow.campaignId);
      const row = el("div", { className: "flow-list-row" });
      const info = el("div");
      info.append(el("strong", {}, flow.name || "Follow-up flow"), el("span", { className: "hint" }, (campaign ? campaign.name : "Campaign unavailable") + " · " + (flow.steps || []).map((s) => s.days + "d").join(", ") + " · " + flow.status));
      const actions = el("div", { className: "row" });
      const toggle = el("button", { className: "btn", type: "button" }, flow.status === "active" ? "Pause" : "Resume");
      toggle.addEventListener("click", async () => { await B.patchFollowupFlow(flow.id, (f) => { f.status = f.status === "active" ? "paused" : "active"; }); renderFollowupView(); });
      const del = el("button", { className: "btn danger", type: "button" }, "Delete");
      del.addEventListener("click", async () => { await B.deleteFollowupFlow(flow.id); renderFollowupView(); });
      actions.append(toggle, del);
      row.append(info, actions);
      list.append(row);
    }
  }

  let followupCreating = false;
  async function createFollowupFlow() {
    if (followupCreating) return;
    const campaignId = $("followupCampaign").value;
    const steps = readFollowupSteps();
    if (!campaignId) return showMsg("followupMsg", "err", "Select a campaign first.");
    if (!steps.length) return showMsg("followupMsg", "err", "Enable at least one follow-up step and add its message.");
    followupCreating = true;
    $("createFollowupBtn").disabled = true;
    try {
    const campaign = campaigns.find((c) => c.id === campaignId);
    const flow = B.newFollowupFlow({
      name: $("followupName").value.trim() || ((campaign && campaign.name) || "Campaign") + " follow-up",
      campaignId,
      steps
    });
    await B.putFollowupFlow(flow);
    showMsg("followupMsg", "ok", "Follow-up flow created.");
    $("followupName").value = "";
    renderFollowupView();
    } finally {
      followupCreating = false;
      $("createFollowupBtn").disabled = false;
    }
  }

  function setMarketingNav(active) {
    $("marketingNav").classList.toggle("hidden", !["list", "dashboard", "followups"].includes(view));
    document.querySelectorAll("[data-marketing-view]").forEach((b) => b.classList.toggle("active", b.dataset.marketingView === active));
  }

  // ─── detail view ──────────────────────────────────────────────────────────

  let detailId = null;

  function relTime(ts) {
    const s = Math.round((ts - Date.now()) / 1000);
    if (s <= 0) return "any moment";
    if (s < 60) return `in ${s}s`;
    if (s < 3600) return `in ${Math.floor(s / 60)}m ${s % 60}s`;
    return `at ${new Date(ts).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}`;
  }

  function detailCampaign() {
    return campaigns.find((c) => c.id === detailId) || null;
  }

  function renderDetail() {
    const c = detailCampaign();
    if (!c) return;
    const p = progressOf(c);
    $("jobName").textContent = c.name || "Untitled campaign";
    const badge = $("jobStatus");
    badge.className = "badge " + c.status;
    badge.textContent = STATUS_LABEL[c.status] || c.status;
    $("jobBar").style.width = `${p.pct}%`;
    $("stSent").textContent = c.counts.sent || 0;
    $("stFailed").textContent = c.counts.failed || 0;
    $("stSkipped").textContent = c.counts.skipped || 0;
    $("stReplied").textContent = c.counts.replied || 0;
    $("stLeft").textContent = Math.max(0, p.total - p.done);
    $("startBtnDetail").classList.toggle("hidden", c.status !== "draft");
    $("pauseBtn").classList.toggle("hidden", c.status !== "running");
    $("resumeBtn").classList.toggle("hidden", !((c.status === "paused" || c.status === "stopped") && p.done < p.total));
    $("stopBtn").classList.toggle("hidden", !(c.status === "running" || c.status === "paused"));
    $("editBtn").classList.toggle("hidden", ["running", "saving", "completed"].includes(c.status));
    $("saveContactsBtn").classList.toggle("hidden", c.status === "running" || !c.recipients.length);
    $("saveContactsBtn").textContent = c.status === "saving" ? "Stop saving" : "Save contacts only";
    const stats = $("contactStats");
    stats.textContent = "";
    const ctext = contactStatsText(c);
    if (ctext) stats.append(el("span", { className: "chip" + (c.contactCounts && c.contactCounts.saved ? " ok" : "") }, ctext));
    renderDetailNote();

    const log = $("jobLog");
    log.textContent = "";
    const rows = [];
    for (let i = p.done - 1; i >= 0 && rows.length < 50; i--) rows.push(i);
    for (const i of rows) {
      const r = c.recipients[i];
      const res = c.results[i] || {};
      const tr = el("tr");
      tr.append(el("td", {}, String(i + 1)), el("td", {}, "+" + r.phone), el("td", {}, r.name || "—"));
      tr.append(el("td", { className: "s-" + (res.status || "") }, (res.status || "") + (res.replied ? " · replied" : "")));
      tr.append(el("td", { title: res.error || "" }, res.error || ""), el("td", {}, res.at ? new Date(res.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""));
      log.append(tr);
    }
  }

  function renderDetailNote() {
    const c = detailCampaign();
    if (!c) return;
    let note = c.note || (c.status === "draft" ? "Draft — not started yet." : "");
    if (c.status === "running" && c.nextSendAt && c.nextSendAt > Date.now()) note += ` · next message ${relTime(c.nextSendAt)}`;
    $("jobNote").textContent = note;
  }

  const detailAction = async (fn) => {
    const problem = await fn();
    showMsg("detailMsg", problem ? "err" : "", problem || "");
  };
  $("startBtnDetail").addEventListener("click", () => detailAction(() => setStatus(detailId, "running")));
  $("saveContactsBtn").addEventListener("click", () => detailAction(() => (detailCampaign() && detailCampaign().status === "saving" ? stopSaving(detailId) : saveContactsOnly(detailId))));
  $("pauseBtn").addEventListener("click", () => detailAction(() => setStatus(detailId, "paused")));
  $("resumeBtn").addEventListener("click", () => detailAction(() => setStatus(detailId, "running")));
  $("stopBtn").addEventListener("click", (e) => confirmClick(e.currentTarget, "Confirm stop", () => detailAction(() => setStatus(detailId, "stopped"))));
  $("editBtn").addEventListener("click", () => go(`#/edit/${detailId}`));
  $("renameCampaignBtn").addEventListener("click", () => {
    const c = detailCampaign();
    if (!c) return;
    const nameSpan = $("jobName");
    const renameBtn = $("renameCampaignBtn");
    nameSpan.style.display = "none";
    renameBtn.style.display = "none";
    const input = el("input", { type: "text", value: c.name || "" });
    input.style.cssText = "font:600 16px inherit;padding:6px 10px;border-radius:8px;border:1.5px solid var(--line);background:var(--field);color:var(--ink);max-width:280px;vertical-align:middle;";
    const save = el("button", { className: "btn sm primary", type: "button" }, "Save");
    const cancel = el("button", { className: "btn sm", type: "button" }, "Cancel");
    nameSpan.after(input, save, cancel);
    input.focus();
    input.select();
    const finish = async (commit) => {
      if (commit) {
        const v = input.value.trim();
        if (v && v !== c.name) await B.patchCampaign(c.id, (x) => { x.name = v; });
      }
      input.remove();
      save.remove();
      cancel.remove();
      nameSpan.style.display = "";
      renameBtn.style.display = "";
      renderDetail();
    };
    save.addEventListener("click", () => finish(true));
    cancel.addEventListener("click", () => finish(false));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") finish(false);
    });
  });
  $("duplicateBtn").addEventListener("click", async () => {
    const id = await duplicate(detailId);
    if (id) go(`#/edit/${id}`);
  });
  $("exportBtn").addEventListener("click", () => { const c = detailCampaign(); if (c) exportReport(c); });
  $("deleteBtn").addEventListener("click", (e) => confirmClick(e.currentTarget, "Confirm delete", async () => {
    await B.deleteCampaign(detailId);
    go("#/");
  }));

  // ─── editor ───────────────────────────────────────────────────────────────

  const form = {
    mode: "new", // "new" | "edit"
    id: null,
    locked: false,
    status: "draft",
    tab: "csv",
    csvText: "",
    csvName: "",
    pasteText: "",
    countryCode: "",
    message: "",
    name: "",
    testPhone: "",
    settings: B.normalizeSettings({}),
    attachments: [], // [{ name, type, size, dataUrl }]
    attachmentChanged: false,
    report: null,
    recipientsDirty: false,
    original: null,
    seed: Math.random()
  };

  let draftTimer = null;
  function saveDraft() {
    if (form.mode !== "new") return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const { tab, csvText, csvName, pasteText, countryCode, message, name, testPhone, settings } = form;
      chrome.storage.local.set({ [K.draft]: { tab, csvText, csvName, pasteText, countryCode, message, name, testPhone, settings } });
    }, 400);
  }

  function reportFromCampaign(c) {
    const columns = new Set();
    for (const r of c.recipients.slice(0, 200)) Object.keys(r.vars || {}).forEach((k) => columns.add(k));
    ["name", "first_name", "phone"].forEach((k) => columns.delete(k));
    return { recipients: c.recipients, invalid: [], duplicates: 0, columns: [...columns], total: c.recipients.length, truncated: false, saved: true };
  }

  async function openEditor(id) {
    form.seed = Math.random();
    form.attachmentChanged = false;
    form.recipientsDirty = false;
    showMsg("launchMsg");
    if (!id) {
      const s = await chrome.storage.local.get([K.draft, K.draftAttachment]);
      const d = s[K.draft] || {};
      Object.assign(form, {
        mode: "new", id: null, locked: false, status: "draft", original: null,
        tab: d.tab || "csv", csvText: d.csvText || "", csvName: d.csvName || "", pasteText: d.pasteText || "",
        countryCode: d.countryCode || "", message: d.message || "", name: d.name || "", testPhone: d.testPhone || "",
        settings: B.normalizeSettings(d.settings), attachments: Array.isArray(s[K.draftAttachment]) ? s[K.draftAttachment] : (s[K.draftAttachment] ? [s[K.draftAttachment]] : [])
      });
    } else {
      const c = await B.getCampaign(id);
      if (!c) return go("#/");
      const atts = await B.getAttachments(id);
      const src = c.source || {};
      Object.assign(form, {
        mode: "edit", id, locked: (c.cursor || 0) > 0 || (c.results || []).some(Boolean), status: c.status, original: c,
        tab: src.tab || "csv", csvText: "", csvName: src.csvName || "", pasteText: src.pasteText || "",
        countryCode: (c.settings && c.settings.defaultCountryCode) || "", message: c.message || "", name: c.name || "",
        testPhone: (await chrome.storage.local.get([K.draft]))[K.draft]?.testPhone || "",
        settings: B.normalizeSettings(c.settings), attachments: atts.map((a) => ({ ...a }))
      });
    }
    form.settings.defaultCountryCode = form.countryCode;
    $("pasteBox").value = form.pasteText;
    $("countryCode").value = form.countryCode;
    $("message").value = form.message;
    $("campaignName").value = form.name;
    $("testPhone").value = form.testPhone;
    $("lockNotice").classList.toggle("hidden", !form.locked);
    resetConfirm();
    selectTab(form.tab, true);
    renderSettings();
    renderAttachment();
    renderEditorButtons();
  }

  function renderEditorButtons() {
    const isNewOrDraft = form.mode === "new" || form.status === "draft";
    $("startBtn").classList.toggle("hidden", !isNewOrDraft);
    $("saveBtn").textContent = isNewOrDraft ? "Save draft" : "Save changes";
    const canResume = form.mode === "edit" && (form.status === "paused" || form.status === "stopped") && form.original && (form.original.cursor || 0) < form.original.recipients.length;
    $("resumeSaveBtn").classList.toggle("hidden", !canResume);
  }

  // Recipients
  function parseRecipients() {
    const cc = form.countryCode;
    const hasInput = form.tab === "csv" ? !!form.csvText : !!form.pasteText.trim();
    if (form.mode === "edit" && (!form.recipientsDirty || !hasInput)) {
      form.report = reportFromCampaign(form.original);
    } else if (form.tab === "csv") {
      form.report = form.csvText ? B.recipientsFromRows(B.parseCSV(form.csvText), cc) : null;
    } else {
      form.report = form.pasteText.trim() ? B.recipientsFromText(form.pasteText, cc) : null;
    }
    renderRecipients();
    renderVariables();
    renderPreview();
    renderEstimate();
  }

  function renderRecipients() {
    const sum = $("recipientSummary");
    sum.textContent = "";
    const table = $("recipientPreview");
    const r = form.report;
    if (!r) {
      table.classList.add("hidden");
      if (form.tab === "csv") sum.append(el("span", { className: "chip" }, "No file loaded"));
      return;
    }
    if (r.saved) sum.append(el("span", { className: "chip" }, form.locked ? "Saved list (locked)" : "Saved list — load a new file or paste numbers to replace it"));
    else if (form.tab === "csv" && form.csvName) sum.append(el("span", { className: "chip" }, form.csvName));
    sum.append(el("span", { className: "chip ok" }, `${r.recipients.length} valid`));
    if (r.invalid.length) sum.append(el("span", { className: "chip bad", title: r.invalid.slice(0, 20).join(", ") }, `${r.invalid.length} invalid`));
    if (r.duplicates) sum.append(el("span", { className: "chip" }, `${r.duplicates} duplicates removed`));
    if (r.truncated) sum.append(el("span", { className: "chip bad" }, `Limited to ${B.MAX_RECIPIENTS}`));

    const extra = r.columns.filter((c) => !["phone", "name", "first_name"].includes(c) && !/phone|mobile|number|whatsapp|cell|tel/.test(c)).slice(0, 3);
    const thead = table.tHead;
    const tbody = table.tBodies[0];
    thead.textContent = "";
    tbody.textContent = "";
    const hr = el("tr");
    const showSaved = form.settings.saveContacts;
    const savedAs = showSaved ? B.contactNames(r.recipients.slice(0, 5), form.settings, form.name) : [];
    ["#", "Number", "Name", ...(showSaved ? ["Saved as"] : []), ...extra].forEach((h) => hr.append(el("th", {}, h)));
    thead.append(hr);
    r.recipients.slice(0, 5).forEach((rec, i) => {
      const tr = el("tr");
      [String(i + 1), "+" + rec.phone, rec.name || "—", ...(showSaved ? [savedAs[i].fullName] : []), ...extra.map((c) => rec.vars[c] || "")].forEach((v) => tr.append(el("td", {}, v)));
      tbody.append(tr);
    });
    if (r.recipients.length > 5) {
      const tr = el("tr");
      tr.append(el("td", { colSpan: 3 + (showSaved ? 1 : 0) + extra.length }, `… and ${r.recipients.length - 5} more`));
      tbody.append(tr);
    }
    table.classList.toggle("hidden", !r.recipients.length);
  }

  function selectTab(tab, silent) {
    form.tab = tab;
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    document.querySelectorAll("[data-panel]").forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== tab || form.locked));
    document.querySelector(".tabs").classList.toggle("hidden", form.locked);
    if (!silent) saveDraft();
    parseRecipients();
  }

  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => selectTab(b.dataset.tab)));

  function wireDrop(dropId, inputId, onFile, { multiple = false } = {}) {
    const drop = $(dropId);
    const input = $(inputId);
    drop.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      const files = Array.from(input.files || []);
      if (files.length) onFile(multiple ? files : files[0]);
      input.value = "";
    });
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length) onFile(multiple ? files : files[0]);
    });
  }

  wireDrop("csvDrop", "csvFile", async (file) => {
    if (form.locked) return;
    if (file.size > 5 * 1024 * 1024) return showMsg("launchMsg", "err", "CSV file is larger than 5 MB.");
    form.csvText = await file.text();
    form.csvName = file.name;
    form.recipientsDirty = true;
    saveDraft();
    parseRecipients();
  });

  $("downloadSampleCsv").addEventListener("click", (e) => {
    e.stopPropagation();
    // Wrapping the phone column as ="…" keeps its + sign and full digits when the file is
    // opened in Excel or Google Sheets — without it, spreadsheets treat a long "+92…" value as
    // a number and mangle it into scientific notation (e.g. 9.23001E+11), which then loses the
    // trailing digits for good. Our own CSV importer understands and strips this wrapper.
    const excelSafe = (phone) => `="${phone}"`;
    const rows = [
      ["phone", "name", "city"],
      [excelSafe("+923001234567"), "Ali Khan", "Lahore"],
      [excelSafe("+923009876543"), "Sara Ahmed", "Karachi"],
      [excelSafe("03001112233"), "", "Islamabad"],
      [excelSafe("+14155552671"), "John Smith", "New York"]
    ];
    const csv = rows.map((r) => r.map((v) => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "sample-contacts.csv" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $("pasteBox").addEventListener("input", (e) => { form.pasteText = e.target.value; form.recipientsDirty = true; saveDraft(); parseRecipients(); });
  $("countryCode").addEventListener("input", (e) => {
    form.countryCode = e.target.value.replace(/[^\d+]/g, "");
    form.settings.defaultCountryCode = form.countryCode;
    if (form.mode === "edit" && !form.locked && (form.csvText || form.pasteText.trim())) form.recipientsDirty = true;
    saveDraft();
    parseRecipients();
  });

  // Message & attachment
  const messageBox = $("message");
  messageBox.addEventListener("input", () => { form.message = messageBox.value; saveDraft(); renderPreview(); });

  function renderVariables() {
    const box = $("varChips");
    box.textContent = "";
    box.append(el("span", { className: "hint", style: "margin:0 4px 0 0;align-self:center" }, "Insert:"));
    for (const v of B.templateVariables(form.report && form.report.columns)) {
      const chip = el("span", { className: "chip var", title: "Click to insert" }, `{{${v}}}`);
      chip.addEventListener("click", () => {
        const token = `{{${v}}}`;
        const { selectionStart: s, selectionEnd: e, value } = messageBox;
        messageBox.value = value.slice(0, s) + token + value.slice(e);
        messageBox.focus();
        messageBox.selectionStart = messageBox.selectionEnd = s + token.length;
        messageBox.dispatchEvent(new Event("input"));
      });
      box.append(chip);
    }
  }

  function sampleRecipient() {
    const first = form.report && form.report.recipients[0];
    return first || { phone: "923001234567", name: "Ali Khan", vars: { name: "Ali Khan", first_name: "Ali", phone: "+923001234567" } };
  }

  function seededRandom(seed) {
    let x = Math.floor(seed * 2147483647) || 1;
    return () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
  }

  function renderPreview() {
    const rec = sampleRecipient();
    $("previewWho").textContent = form.report && form.report.recipients.length ? `— to +${rec.phone}` : "— sample data";
    const text = B.withFooter(B.renderMessage(form.message, rec, seededRandom(form.seed)), form.settings);
    const bubble = $("previewBubble");
    bubble.textContent = "";
    const attachments = form.attachments || [];
    for (const a of attachments) {
      if (/^image\//.test(a.type)) bubble.append(el("img", { src: a.dataUrl, alt: "" }));
      else if (/^video\//.test(a.type)) bubble.append(el("video", { src: a.dataUrl, controls: true, muted: true, playsInline: true }));
      else if (/^audio\//.test(a.type)) bubble.append(el("audio", { src: a.dataUrl, controls: true }));
      else {
        const doc = el("div", { className: "doc" });
        doc.append(el("b", {}, "PDF"), el("span", {}, a.name));
        bubble.append(doc);
      }
    }
    bubble.append(document.createTextNode(text || (attachments.length ? "" : "Your message preview appears here.")));
    $("charCount").textContent = `${text.length} characters`;

    const missing = B.missingVariables(form.message, form.report ? form.report.recipients : []);
    showMsg("varWarning", missing.length ? "info" : "", missing.map((m) => `${m.missing} recipient${m.missing === 1 ? " has" : "s have"} no ${m.key} — it will be left out. Add a fallback like {{${m.key}|there}} if you want a word there.`).join("\n"));
  }

  $("shuffleBtn").addEventListener("click", () => {
    const hasVariation = /\{[^{}|]+\|[^{}|]+(?:\|[^{}|]+)*\}/.test(String(form.message || ""));
    if (!hasVariation) {
      showMsg("variationMsg", "err", "No message variations found.");
      return;
    }
    form.seed = Math.random();
    renderPreview();
    showMsg("variationMsg", "ok", "Variation preview updated.");
  });

  function formatBytes(n) {
    return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  }

  function renderAttachment() {
    const attachments = form.attachments || [];
    const box = $("attachBox");
    $("fileDrop").classList.toggle("hidden", attachments.length >= B.MAX_ATTACHMENTS);
    box.classList.toggle("hidden", !attachments.length);
    box.textContent = "";
    attachments.forEach((a, index) => {
      const item = el("div", { className: "attachment" });
      const isImage = /^image\//.test(a.type);
      const isVideo = /^video\//.test(a.type);
      const isAudio = /^audio\//.test(a.type);
      if (isImage) item.append(el("img", { src: a.dataUrl, alt: "" }));
      else if (isVideo) item.append(el("video", { src: a.dataUrl, muted: true, playsInline: true }));
      else {
        const icon = el("div", { className: "doc", style: "margin:0" });
        icon.append(el("b", {}, isAudio ? "MP3" : "PDF"));
        item.append(icon);
      }
      const meta = el("div", { className: "meta" });
      meta.append(el("div", {}, a.name), el("span", { className: "hint", style: "margin:0" }, `${formatBytes(a.size)} · ${isImage ? "photo" : isVideo ? "video" : isAudio ? "audio" : "document"}`));
      const caption = el("textarea", { className: "attachment-caption", rows: 2, placeholder: "Caption for this file (optional)" });
      caption.value = a.caption || "";
      caption.addEventListener("input", () => {
        a.caption = caption.value;
        form.attachmentChanged = true;
        if (form.mode === "new") chrome.storage.local.set({ [K.draftAttachment]: form.attachments });
      });
      meta.append(caption);
      item.append(meta);
      const remove = el("button", { className: "btn danger", type: "button" }, "Remove");
      remove.addEventListener("click", () => removeAttachment(index));
      item.append(remove);
      box.append(item);
    });
  }

  async function removeAttachment(index) {
    form.attachments.splice(index, 1);
    form.attachmentChanged = true;
    if (form.mode === "new") await chrome.storage.local.set({ [K.draftAttachment]: form.attachments });
    renderAttachment();
    renderPreview();
  }

  wireDrop("fileDrop", "attachFile", async (files) => {
    const attachmentError = (message) => showMsg("attachmentMsg", "err", message);
    const incoming = files.filter((file) => B.ATTACHMENT_TYPES.includes(file.type));
    if (incoming.length !== files.length) return attachmentError("Unsupported file type. Use JPG, PNG, WEBP, GIF, MP4/WEBM/3GP/MOV, MP3/audio or PDF.");
    if ((form.attachments.length + incoming.length) > B.MAX_ATTACHMENTS) return attachmentError(`You can attach up to ${B.MAX_ATTACHMENTS} files per campaign.`);
    if (incoming.some((file) => file.size > B.MAX_ATTACHMENT_BYTES)) return attachmentError("File is too large. Maximum file size is 30 MB.");
    for (const file of incoming) {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      form.attachments.push({ name: file.name, type: file.type, size: file.size, dataUrl, caption: "" });
    }
    form.attachmentChanged = true;
    if (form.mode === "new") await chrome.storage.local.set({ [K.draftAttachment]: form.attachments });
    showMsg("attachmentMsg");
    renderAttachment();
    renderPreview();
  }, { multiple: true });

  // Timing & safety
  const hourToTime = (h) => `${String(h % 24).padStart(2, "0")}:00`;

  function renderSettings() {
    const s = form.settings;
    document.querySelectorAll(".radio-card").forEach((c) => c.classList.toggle("on", c.dataset.mode === s.delayMode));
    $("randomFields").classList.toggle("hidden", s.delayMode !== "random");
    $("fixedFields").classList.toggle("hidden", s.delayMode !== "fixed");
    $("minDelay").value = s.minDelaySec;
    $("maxDelay").value = s.maxDelaySec;
    $("fixedDelay").value = s.fixedDelaySec;
    $("delayHuman").value = `${B.formatDuration(s.minDelaySec * 1000)} – ${B.formatDuration(s.maxDelaySec * 1000)}`.replace(/^0 min/, "<1 min");
    $("dailyLimit").value = s.dailyLimit;
    $("batchSize").value = s.batchSize;
    $("batchPause").value = s.batchPauseMin;
    $("hoursEnabled").checked = s.hoursEnabled;
    $("startTime").value = hourToTime(s.startHour);
    $("endTime").value = hourToTime(s.endHour);
    $("hoursRow").style.opacity = s.hoursEnabled ? 1 : 0.5;
    $("typingSimulation").checked = s.typingSimulation;
    $("respectOptOut").checked = s.respectOptOut;
    $("optOutKeywords").value = s.optOutKeywords;
    $("appendOptOutFooter").checked = s.appendOptOutFooter;
    $("optOutFooter").value = s.optOutFooter;
    $("maxFailures").value = s.maxConsecutiveFailures;
    $("saveContacts").checked = s.saveContacts;
    $("contactNameFields").style.opacity = s.saveContacts ? 1 : 0.5;
    if (document.activeElement !== $("contactPrefix")) $("contactPrefix").value = s.contactPrefix;
    $("contactStart").value = s.contactStart;
    $("contactAppendCampaign").checked = s.contactAppendCampaign;
    $("contactSyncToPhone").checked = s.contactSyncToPhone;
    renderContactExample();
    renderEstimate();
  }

  function renderContactExample() {
    const [a, b] = B.contactNames([{}, {}], form.settings, form.name || "Campaign name");
    $("contactExample").textContent = `Numbers without a name are saved as “${a.fullName}”, “${b.fullName}”, …`;
  }

  // ─── plan (trial / free / Pro, from license.js) ───────────────────────────

  let plan = null;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const PLAN_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 7 5 5 5-8 5 8 5-5-2 12H4L2 7Z"/><path d="M4 21h16"/></svg>';

  async function loadPlan() {
    try {
      const s = await chrome.runtime.sendMessage({ type: "WAM_LICENSE_STATUS" });
      plan = s && s.plan ? s : null;
    } catch {
      plan = null;
    }
    renderPlanBanner();
    if (view === "editor") renderEstimate();
  }

  function renderPlanBanner() {
    const el = $("planBanner");
    if (!el) return;
    if (!plan || plan.plan === "pro") { el.hidden = true; return; }
    const price = `${plan.store.price}/${plan.store.period}`;
    let text;
    if (plan.plan === "trial") {
      const h = Math.floor(plan.trialMsLeft / 3600000);
      const m = Math.floor((plan.trialMsLeft % 3600000) / 60000);
      text = `<strong>Free trial:</strong> ${h}h ${m}m left with unlimited messages. Afterwards the free plan sends ${plan.store.freeDailyMessages} messages a day, or go Pro for ${price}.`;
      el.className = "plan-banner";
    } else {
      text = plan.trialAvailable
        ? `<strong>Free plan:</strong> ${plan.remainingToday} of ${plan.dailyLimit} messages left today. Activate your one-time ${plan.store.trialHours}-hour free trial for unlimited messages.`
        : plan.remainingToday > 0
        ? `<strong>Free plan:</strong> ${plan.remainingToday} of ${plan.dailyLimit} messages left today. Campaigns pause at the limit and continue after midnight.`
        : `<strong>Free plan limit reached:</strong> ${plan.dailyLimit} of ${plan.dailyLimit} messages sent today. Sending continues after midnight, or upgrade for unlimited messages.`;
      el.className = plan.remainingToday > 0 ? "plan-banner free" : "plan-banner out";
    }
    const trialBtn = plan.plan === "free" && plan.trialAvailable ? `<button type="button" id="planTrialBtn">Start free trial</button>` : "";
    el.innerHTML = `<div class="pb-text">${PLAN_ICON}<span>${text}</span></div><span class="pb-actions">${trialBtn}<button type="button" id="planUpgradeBtn">Upgrade to Pro · ${esc(price)}</button></span>`;
    el.hidden = false;
    $("planTrialBtn")?.addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      await chrome.runtime.sendMessage({ type: "WAM_TRIAL_START" }).catch(() => {});
      loadPlan();
    });
    $("planUpgradeBtn").addEventListener("click", () => chrome.runtime.sendMessage({ type: "WAM_OPEN_PLANS" }).catch(() => {}));
  }

  function renderEstimate() {
    const n = form.report ? form.report.recipients.length - (form.locked && form.original ? form.original.cursor || 0 : 0) : 0;
    const s = form.settings;
    const days = Math.ceil(n / (plan && plan.plan === "free" ? Math.min(s.dailyLimit, plan.dailyLimit) : s.dailyLimit));
    $("estimate").textContent = n > 0
      ? `About ${B.formatDuration(B.estimateDurationMs(n, s))} of sending time for ${n} ${form.locked ? "remaining " : ""}recipient${n === 1 ? "" : "s"}${days > 1 ? ` — spread over at least ${days} days by the daily limit` : ""}${s.hoursEnabled ? `, only between ${hourToTime(s.startHour)} and ${hourToTime(s.endHour)}` : ""}.`
      : "";
    if (n > 0 && plan && plan.plan === "free" && n > plan.remainingToday) {
      $("estimate").textContent += ` Free plan: ${plan.dailyLimit} messages a day (${plan.remainingToday} left today), so this list needs about ${Math.ceil(n / plan.dailyLimit)} days. Pro sends without a daily cap.`;
    }
  }

  function updateSetting(patch) {
    form.settings = B.normalizeSettings({ ...form.settings, ...patch });
    saveDraft();
    renderSettings();
    renderPreview();
  }

  document.querySelectorAll(".radio-card").forEach((c) => c.addEventListener("click", () => updateSetting({ delayMode: c.dataset.mode })));
  const numberSetting = (id, key) => $(id).addEventListener("change", (e) => updateSetting({ [key]: Number(e.target.value) }));
  numberSetting("minDelay", "minDelaySec");
  numberSetting("maxDelay", "maxDelaySec");
  numberSetting("fixedDelay", "fixedDelaySec");
  numberSetting("dailyLimit", "dailyLimit");
  numberSetting("batchSize", "batchSize");
  numberSetting("batchPause", "batchPauseMin");
  numberSetting("maxFailures", "maxConsecutiveFailures");
  $("hoursEnabled").addEventListener("change", (e) => updateSetting({ hoursEnabled: e.target.checked }));
  $("startTime").addEventListener("change", (e) => updateSetting({ startHour: parseInt(e.target.value, 10) || 0 }));
  $("endTime").addEventListener("change", (e) => updateSetting({ endHour: parseInt(e.target.value, 10) || 24 }));
  $("typingSimulation").addEventListener("change", (e) => updateSetting({ typingSimulation: e.target.checked }));
  $("respectOptOut").addEventListener("change", (e) => updateSetting({ respectOptOut: e.target.checked }));
  $("optOutKeywords").addEventListener("change", (e) => updateSetting({ optOutKeywords: e.target.value }));
  $("appendOptOutFooter").addEventListener("change", (e) => updateSetting({ appendOptOutFooter: e.target.checked }));
  $("optOutFooter").addEventListener("input", (e) => { form.settings.optOutFooter = e.target.value; saveDraft(); renderPreview(); });
  const contactSetting = (patch) => { updateSetting(patch); renderRecipients(); };
  $("saveContacts").addEventListener("change", (e) => contactSetting({ saveContacts: e.target.checked }));
  $("contactPrefix").addEventListener("input", (e) => { form.settings.contactPrefix = e.target.value; saveDraft(); renderContactExample(); renderRecipients(); });
  $("contactPrefix").addEventListener("change", (e) => contactSetting({ contactPrefix: e.target.value }));
  $("contactStart").addEventListener("change", (e) => contactSetting({ contactStart: Number(e.target.value) }));
  $("contactAppendCampaign").addEventListener("change", (e) => contactSetting({ contactAppendCampaign: e.target.checked }));
  $("contactSyncToPhone").addEventListener("change", (e) => contactSetting({ contactSyncToPhone: e.target.checked }));

  // Test & save
  $("testPhone").addEventListener("input", (e) => {
    form.testPhone = e.target.value;
    chrome.storage.local.get([K.draft]).then((s) => chrome.storage.local.set({ [K.draft]: { ...(s[K.draft] || {}), testPhone: form.testPhone } }));
  });
  $("campaignName").addEventListener("input", (e) => {
    form.name = e.target.value;
    saveDraft();
    if (form.settings.contactAppendCampaign) { renderContactExample(); renderRecipients(); }
  });

  $("testBtn").addEventListener("click", async () => {
    const btn = $("testBtn");
    if (!form.message.trim() && !form.attachments.length) return showMsg("launchMsg", "err", "Write a message or attach a file first.");
    if (!B.normalizePhone(form.testPhone, form.countryCode)) return showMsg("launchMsg", "err", "Enter the phone number to send the test to.");
    const tab = await findWaTab();
    if (!tab) return showMsg("launchMsg", "err", "Open WhatsApp Web first.");
    btn.disabled = true;
    showMsg("launchMsg", "info", "Sending test…");
    try {
      const res = await chrome.tabs.sendMessage(tab.id, {
        type: "DL_BULK_TEST",
        payload: { phone: form.testPhone, message: form.message, attachments: form.attachments, recipient: sampleRecipient(), settings: form.settings }
      });
      if (res && res.ok) showMsg("launchMsg", "ok", "Test sent. Check the chat in WhatsApp.");
      else showMsg("launchMsg", "err", `Test failed: ${(res && res.error) || "no response"}`);
    } catch {
      showMsg("launchMsg", "err", "Could not reach WhatsApp Web — reload the WhatsApp tab and try again.");
    } finally {
      btn.disabled = false;
    }
  });

  let confirmArmed = false;
  function resetConfirm() {
    confirmArmed = false;
    $("startBtn").textContent = "Save & start";
    $("cancelStart").classList.add("hidden");
    $("startHint").textContent = "";
  }
  $("cancelStart").addEventListener("click", resetConfirm);

  function readyToLaunch() {
    if (!form.report || !form.report.recipients.length) return "Add at least one valid recipient.";
    if (!form.message.trim() && !form.attachments.length) return "Write a message or attach a file.";
    return null;
  }

  /** action: "draft" | "start" | "save" | "resume" */
  async function save(action) {
    const launching = action === "start" || action === "resume";
    if (launching) {
      const problem = readyToLaunch();
      if (problem) return showMsg("launchMsg", "err", problem);
    }
    const name = form.name.trim() || `Campaign ${new Date().toLocaleDateString()}`;
    const attachmentMeta = form.attachments.map((a) => ({ name: a.name, type: a.type, size: a.size, caption: a.caption || "", version: Date.now() }));
    const recipients = form.report ? form.report.recipients : [];
    const source = { tab: form.tab, csvName: form.tab === "csv" ? form.csvName : "", pasteText: form.tab === "paste" ? form.pasteText : "" };
    let id = form.id;

    if (form.mode === "new") {
      const c = B.newCampaign({ name, message: form.message, settings: form.settings, recipients, source, attachments: attachmentMeta, attachment: null, status: "draft" });
      id = c.id;
      if (form.attachments.length) await chrome.storage.local.set({ [B.attachmentKey(id)]: form.attachments });
      await B.putCampaign(c);
      await chrome.storage.local.remove([K.draftAttachment]);
      await chrome.storage.local.set({ [K.draft]: { testPhone: form.testPhone, countryCode: form.countryCode, settings: form.settings } });
    } else {
      const current = await B.getCampaign(id);
      if (!current) return showMsg("launchMsg", "err", "This campaign no longer exists.");
      if (current.status === "running") return showMsg("launchMsg", "err", "Pause the campaign before saving changes.");
      if (form.attachmentChanged) {
        if (form.attachments.length) await chrome.storage.local.set({ [B.attachmentKey(id)]: form.attachments });
        else await chrome.storage.local.remove(B.attachmentKey(id));
      }
      await B.patchCampaign(id, (x) => {
        x.name = name;
        x.message = form.message;
        x.settings = form.settings;
        if (form.attachmentChanged) { x.attachments = attachmentMeta; x.attachment = null; }
        if (form.recipientsDirty && !form.locked) {
          x.recipients = recipients;
          x.source = source;
          x.results = [];
          x.cursor = 0;
          x.counts = { sent: 0, failed: 0, skipped: 0, replied: 0 };
          x.contactCursor = 0;
          x.contactResults = [];
          x.contactCounts = {};
        }
      });
    }

    if (launching) {
      const problem = await setStatus(id, "running");
      if (problem) return showMsg("launchMsg", "err", problem);
    }
    resetConfirm();
    go(launching || form.mode === "edit" ? `#/view/${id}` : "#/");
  }

  $("startBtn").addEventListener("click", () => {
    const problem = readyToLaunch();
    if (problem) return showMsg("launchMsg", "err", problem);
    if (!confirmArmed) {
      confirmArmed = true;
      const n = form.report.recipients.length;
      $("startBtn").textContent = `Confirm: send to ${n} recipient${n === 1 ? "" : "s"}`;
      $("cancelStart").classList.remove("hidden");
      $("startHint").textContent = waReady ? "" : "WhatsApp Web isn't ready yet — the campaign will wait for it.";
      return;
    }
    save("start");
  });
  $("saveBtn").addEventListener("click", () => save(form.mode === "new" || form.status === "draft" ? "draft" : "save"));
  $("resumeSaveBtn").addEventListener("click", () => save("resume"));

  // ─── routing ──────────────────────────────────────────────────────────────

  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  document.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => go(b.dataset.nav)));
  $("newCampaignBtn").addEventListener("click", () => go("#/new"));
  document.querySelectorAll("[data-marketing-view]").forEach((b) => b.addEventListener("click", () => go(b.dataset.marketingView === "campaigns" ? "#/" : "#/" + b.dataset.marketingView)));
  $("dashboardNewCampaign").addEventListener("click", () => go("#/new"));
  $("followupRefresh").addEventListener("click", renderFollowupView);
  $("createFollowupBtn").addEventListener("click", createFollowupFlow);

  // ─── first-run tours (tour.js) ────────────────────────────────────────────

  const TOUR_KEY = "wamBulkTour";

  function listTourSteps() {
    const planText = !plan ? "" : plan.plan === "trial"
      ? `Your free trial gives you unlimited messages for ${Math.max(1, Math.floor(plan.trialMsLeft / 3600000))} more hours. After that the free plan sends ${plan.store.freeDailyMessages} messages a day.`
      : plan.plan === "free"
        ? `You're on the free plan: ${plan.dailyLimit} messages a day. Campaigns pause at the limit and carry on after midnight.${plan.trialAvailable ? " Start your 24-hour trial here for unlimited messages." : ""}`
        : "";
    return [
      { title: "Welcome to the Bulk Sender", text: "Send personalized WhatsApp messages to a whole list, with images or PDFs, at a safe, human pace. This one-minute tour shows you around." },
      { target: "#marketingNav", title: "Three areas", text: "Dashboard shows your results. Campaigns is where you create and manage sends. Follow-up flows message people again after 3, 7 and 14 days if they haven't replied." },
      { target: () => [$("newCampaignBtn"), $("dashboardNewCampaign")].find((b) => b && b.offsetParent), title: "Create a campaign", text: "Add recipients, write your message, choose the timing, send yourself a test, then start. Campaigns send from your open WhatsApp Web tab." },
      ...(planText ? [{ target: "#planBanner", title: "Your plan", text: planText }] : []),
      { target: ".notice", title: "Stay safe", text: "Only message people who agreed to hear from you. Keep the random delay, daily limit and sending hours on: they're what protect your number from being banned." },
      { title: "You're ready", text: "Replay this tour any time with “Take the tour”.", doneLabel: "Done", action: { label: "Create my first campaign", run: () => go("#/new") } }
    ];
  }

  function editorTourSteps() {
    return [
      { target: "#secRecipients", title: "1 · Add recipients", text: "Upload a CSV (download the sample to see the format) or paste numbers. Every column, like name or city, becomes a variable. Set a default country code for local numbers." },
      { target: () => $("saveContacts") && $("saveContacts").closest(".contact-save"), title: "Save them as contacts first", text: "Numbers are saved to your WhatsApp contacts before the first message, so your messages look less like spam. Numbers without a name are saved as “Client 1”, “Client 2”, and so on." },
      { target: "#secMessage", title: "2 · Write the message", text: "Use {{name}}, or {{name|there}} for a fallback, and {Hi|Hello} to vary the wording. Attach up to 10 images, videos or PDFs. The preview shows exactly what a recipient sees." },
      { target: "#secTiming", title: "3 · Timing & safety", text: "A random wait of 1–10 minutes between messages, a daily limit, short breaks and sending hours make your sending look human. Keep them on." },
      { target: "#secLaunch", title: "4 · Test, then start", text: "Send a test to your own number first. Then name the campaign and choose Save & start, or Save draft to start later. You can pause or stop at any time.", doneLabel: "Got it" }
    ];
  }

  async function runTour(kind) {
    if (!window.WAMTour) return;
    if (kind === "editor" && view !== "editor") return;
    await new Promise((r) => setTimeout(r, 250)); // let the view finish rendering
    window.WAMTour.start(kind === "editor" ? editorTourSteps() : listTourSteps(), {
      onEnd: async () => {
        const seen = (await chrome.storage.local.get([TOUR_KEY]))[TOUR_KEY] || {};
        await chrome.storage.local.set({ [TOUR_KEY]: { ...seen, [kind]: Date.now() } });
      }
    });
  }

  /** Shows each tour once, the first time its screen is opened. */
  async function maybeStartTour() {
    if (!window.WAMTour || window.WAMTour.running) return;
    const kind = view === "editor" ? "editor" : ["list", "dashboard", "followups"].includes(view) ? "list" : null;
    if (!kind) return;
    let seen = {};
    try { seen = (await chrome.storage.local.get([TOUR_KEY]))[TOUR_KEY] || {}; } catch { return; }
    if (seen[kind]) return;
    // Only marked as seen once the user closes it, so starting in a background tab is fine.
    runTour(kind);
  }

  document.querySelectorAll("[data-tour]").forEach((b) => b.addEventListener("click", () => runTour(b.dataset.tour)));

  let view = "list";
  async function route() {
    const h = location.hash.replace(/^#\/?/, "");
    const [name, id] = h.split("/");
    campaigns = await B.listCampaigns();
    view = name === "new" || name === "edit" ? "editor" : name === "view" && id ? "detail" : name === "dashboard" ? "dashboard" : name === "followups" ? "followups" : "list";
    $("listView").classList.toggle("hidden", view !== "list");
    $("jobCard").classList.toggle("hidden", view !== "detail");
    $("builder").classList.toggle("hidden", view !== "editor");
    $("marketingDashboard").classList.toggle("hidden", view !== "dashboard");
    $("followupView").classList.toggle("hidden", view !== "followups");
    setMarketingNav(view);
    showMsg("listMsg");
    showMsg("detailMsg");
    if (view === "list") {
      $("pageTitle").textContent = "Bulk Sender";
      renderList();
    } else if (view === "dashboard") {
      $("pageTitle").textContent = "Marketing dashboard";
      renderDashboard();
    } else if (view === "followups") {
      $("pageTitle").textContent = "Follow-up flows";
      renderFollowupView();
    } else if (view === "detail") {
      detailId = id;
      if (!detailCampaign()) return go("#/");
      $("pageTitle").textContent = "Campaign";
      renderDetail();
    } else {
      $("pageTitle").textContent = name === "new" ? "New campaign" : "Edit campaign";
      await openEditor(name === "edit" ? id : null);
    }
    window.scrollTo(0, 0);
    maybeStartTour();
  }

  window.addEventListener("hashchange", route);

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    if (changes.wamLicense || changes.wamUsage) loadPlan();
    if (!Object.keys(changes).some((k) => k === K.index || k === K.followupIndex || k.startsWith(K.campaignPrefix) || k.startsWith(K.followupPrefix))) return;
    campaigns = await B.listCampaigns();
    if (view === "list") renderList();
    else if (view === "detail") {
      if (!detailCampaign()) go("#/");
      else renderDetail();
    } else if (view === "dashboard") renderDashboard();
    else if (view === "followups") renderFollowupView();
  });

  setInterval(() => { if (view === "detail") renderDetailNote(); }, 1000);
  setInterval(checkWhatsApp, 10000);

  setInterval(() => { if (plan && plan.plan === "trial") loadPlan(); }, 60000);

  checkWhatsApp();
  loadPlan();
  route();
})();
