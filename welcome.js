/*
 * WAMarketer — 5-step onboarding (welcome.html).
 *   1 Welcome · 2 Free trial (activate the 24-hour trial, go Pro, or enter a key)
 *   3 WhatsApp Web · 4 AI provider (optional) · 5 Launch
 * Progress is remembered, so closing the tab and reopening it resumes where the user left off.
 */
(function () {
  "use strict";

  const TOTAL = 5;
  const STORE_KEY = "wamOnboarding";
  const $ = (id) => document.getElementById(id);
  const screens = Array.from(document.querySelectorAll(".screen"));
  const progress = Array.from(document.querySelectorAll(".onb-progress [data-goto]"));
  const nextBtn = $("nextBtn");
  const backBtn = $("backBtn");

  // Opened by the dashboard gate (onboarding-gate.js): say why, and go back there afterwards.
  const params = new URLSearchParams(location.search);
  const cameFromDashboard = params.get("from") === "dashboard";
  const nextRoute = /^#\/[\w\-/]*$/.test(params.get("next") || "") ? params.get("next") : "";
  if (cameFromDashboard) $("gateNote").hidden = false;

  let step = 1;
  let maxVisited = 1;
  let choice = "trial";
  let busy = false;
  let waTimer = null;

  const plan = () => (window.WAMPlans && window.WAMPlans.status) || null;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function timeLeft(ms) {
    const mins = Math.max(0, Math.floor(ms / 60000));
    const h = Math.floor(mins / 60);
    return h ? `${h}h ${mins % 60}m` : `${mins}m`;
  }

  function fmtTime(ms) {
    return new Date(ms).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  }

  function save(extra = {}) {
    chrome.storage.local.get([STORE_KEY]).then((r) => {
      chrome.storage.local.set({ [STORE_KEY]: { ...(r[STORE_KEY] || {}), step, maxVisited, ...extra } });
    }).catch(() => {});
  }

  function say(cls, text) {
    const el = $("planMsg");
    el.className = text ? `msg show ${cls}` : "msg";
    el.textContent = text || "";
  }

  // ─── step 2: plan ───────────────────────────────────────────────────────

  function renderPlanStep() {
    const s = plan();
    const state = $("planState");
    const trialInput = document.querySelector('input[name="start"][value="trial"]');
    if (!s) return;
    if (s.plan === "pro") {
      state.className = "plan-state pro";
      state.textContent = `${s.store.planName} is active: unlimited messages, every day.`;
    } else if (s.plan === "trial") {
      state.className = "plan-state";
      state.textContent = `Your free trial is active: ${timeLeft(s.trialMsLeft)} left with unlimited messages (until ${fmtTime(s.trialEndsAt)}).`;
    } else if (!s.trialAvailable) {
      state.className = "plan-state free";
      state.textContent = `Your free trial has been used. You're on the free plan with ${s.dailyLimit} messages a day; upgrade any time for unlimited.`;
    } else {
      state.className = "plan-state";
      state.hidden = true;
    }
    if (s.plan === "pro" || s.plan === "trial" || !s.trialAvailable) state.hidden = false;

    // The trial can only be activated once.
    trialInput.disabled = !s.trialAvailable;
    const trialTitle = trialInput.closest(".choice").querySelector("strong");
    if (s.plan === "trial") trialTitle.textContent = "Free trial activated";
    else if (!s.trialAvailable) trialTitle.textContent = "Free trial already used";
    if (trialInput.disabled && choice === "trial" && s.plan !== "trial") {
      choice = s.plan === "pro" ? "key" : "pro";
      document.querySelector(`input[name="start"][value="${choice}"]`).checked = true;
    }
    $("keyBox").hidden = choice !== "key";
    updateNav();
  }

  document.querySelectorAll('input[name="start"]').forEach((input) => {
    input.addEventListener("change", () => {
      choice = input.value;
      say("", "");
      renderPlanStep();
    });
  });

  async function completePlanStep() {
    const s = plan();
    if (!s || s.plan === "pro" || s.plan === "trial") return true;
    if (choice === "trial" && s.trialAvailable) {
      const r = await window.WAMPlans.startTrial();
      if (r && r.ok) return true;
      say("warn", (r && r.message) || "Could not start the trial. Try again.");
      return !!(r && r.already);
    }
    if (choice === "pro") {
      const url = s.store.productUrl;
      if (!url) {
        say("warn", "Checkout isn't available yet. You can continue on the free plan and upgrade later from Plan & License.");
        return false;
      }
      window.open(url + (url.includes("?") ? "&" : "?") + "wanted=true", "_blank", "noopener");
      say("ok", "Checkout opened in a new tab. After paying, paste your license key under “I already have a license key”, or later on the Plan & License page.");
      return true;
    }
    // "I already have a key": continuing without activating keeps the free plan.
    return true;
  }

  // ─── step 3: WhatsApp Web tab ───────────────────────────────────────────

  async function checkWhatsApp() {
    const el = $("waStatus");
    let open = false;
    try { open = (await chrome.tabs.query({ url: "https://web.whatsapp.com/*" })).length > 0; } catch {}
    el.className = `status-line ${open ? "ok" : "warn"}`;
    el.lastElementChild.textContent = open
      ? "WhatsApp Web is open. Once your phone is linked, the WAMarketer sidebar shows on the right."
      : "No WhatsApp Web tab yet. Open it, link your phone, then come back here.";
  }

  // ─── step 4: AI provider ────────────────────────────────────────────────

  let aiTested = null; // { ok, provider } from the last "Save & test connection"

  async function checkAi() {
    const el = $("aiStatus");
    let d = null;
    try { d = window.DownlabsAI ? await window.DownlabsAI.describe() : null; } catch {}
    const ok = !!(d && d.configured);
    el.className = `status-line ${ok ? "ok" : "warn"}`;
    const tested = ok && aiTested && aiTested.ok && aiTested.provider === d.provider;
    el.lastElementChild.textContent = !ok
      ? "Not set up yet. That's fine: skip this step if you only want campaigns."
      : tested
        ? `Connected and tested: ${d.label}${d.model ? ` · ${d.model}` : ""}. AI replies are ready.`
        : `Key saved for ${d.label}${d.model ? ` · ${d.model}` : ""}. Use “Save & test connection” to check it works.`;
  }

  let aiForm = null;

  async function openAiPanel() {
    $("aiPanel").hidden = false;
    $("aiOpenRow").hidden = true;
    $("aiOpen").setAttribute("aria-expanded", "true");
    if (!aiForm && window.WAMAiSetup) {
      aiForm = await window.WAMAiSetup.mount($("aiMount"), {
        onSaved: () => { aiTested = null; checkAi(); },
        onTested: (r) => { aiTested = r ? { ok: !!r.ok, provider: aiForm && aiForm.settings.provider } : null; checkAi(); }
      });
    }
    aiForm && aiForm.focus();
  }

  function closeAiPanel() {
    $("aiPanel").hidden = true;
    $("aiOpenRow").hidden = false;
    $("aiOpen").setAttribute("aria-expanded", "false");
    $("aiOpen").focus();
  }

  $("aiOpen").addEventListener("click", openAiPanel);
  $("aiClose").addEventListener("click", closeAiPanel);

  // ─── step 5: summary ────────────────────────────────────────────────────

  const CROWN = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 7 5 5 5-8 5 8 5-5-2 12H4L2 7Z"/><path d="M4 21h16"/></svg>';

  function renderSummary() {
    const s = plan();
    const el = $("planSummary");
    if (!s) { el.hidden = true; return; }
    let title, text;
    if (s.plan === "pro") {
      title = `${s.store.planName} is active`;
      text = "Unlimited messages on every feature.";
    } else if (s.plan === "trial") {
      title = `Free trial active · ${timeLeft(s.trialMsLeft)} left`;
      text = `Unlimited messages until ${fmtTime(s.trialEndsAt)}. After that, ${s.store.freeDailyMessages} messages a day stay free.`;
    } else {
      title = `Free plan · ${s.remainingToday} of ${s.dailyLimit} messages left today`;
      text = s.trialAvailable
        ? `You can still activate your ${s.store.trialHours}-hour free trial from step 2 or Plan & License.`
        : `Upgrade to Pro (${s.store.price}/${s.store.period}) any time for unlimited messages.`;
    }
    el.hidden = false;
    el.innerHTML = `<span class="s-ic">${CROWN}</span><div><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`;
  }

  // ─── navigation ─────────────────────────────────────────────────────────

  function nextLabel() {
    if (step === 1) return "Get started";
    if (step === 5) return cameFromDashboard ? "Finish & open dashboard" : "Finish setup";
    if (step === 2) {
      const s = plan();
      if (s && s.plan === "free") {
        if (choice === "trial" && s.trialAvailable) return "Activate free trial";
        if (choice === "pro") return "Continue to checkout";
      }
    }
    if (step === 4) return "Continue";
    return "Continue";
  }

  function updateNav() {
    nextBtn.textContent = busy ? "One moment…" : nextLabel();
    nextBtn.disabled = busy;
    backBtn.hidden = step === 1;
    $("stepCount").textContent = `${step} / ${TOTAL}`;
    progress.forEach((b) => {
      const n = Number(b.dataset.goto);
      b.dataset.state = n < step ? "done" : n === step ? "current" : "todo";
      b.disabled = n > maxVisited;
      if (n === step) b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
    });
  }

  function show(n, { focus = true } = {}) {
    step = Math.min(TOTAL, Math.max(1, n));
    maxVisited = Math.max(maxVisited, step);
    screens.forEach((s) => { s.hidden = Number(s.dataset.step) !== step; });
    clearInterval(waTimer);
    if (step === 2) renderPlanStep();
    if (step === 3) { checkWhatsApp(); waTimer = setInterval(checkWhatsApp, 3000); }
    if (step === 4) checkAi();
    if (step === 5) renderSummary();
    updateNav();
    history.replaceState(null, "", `${location.pathname}${location.search}#step-${step}`);
    save();
    if (focus) {
      window.scrollTo({ top: 0 });
      const h = screens[step - 1].querySelector("h1");
      if (h) h.focus({ preventScroll: true });
    }
  }

  function finish(target) {
    save({ completedAt: Date.now() });
    location.href = target;
  }

  nextBtn.addEventListener("click", async () => {
    if (busy) return;
    if (step === 5) return finish(`crm/index.html${nextRoute}`);
    if (step === 2) {
      busy = true;
      updateNav();
      let ok = false;
      try { ok = await completePlanStep(); } finally { busy = false; updateNav(); }
      if (!ok) return;
    }
    show(step + 1);
  });
  backBtn.addEventListener("click", () => show(step - 1));
  progress.forEach((b) => b.addEventListener("click", () => { if (!b.disabled) show(Number(b.dataset.goto)); }));
  $("finishCampaign").addEventListener("click", (e) => { e.preventDefault(); finish("crm/index.html#/bulk-sender"); });

  // A key activated in the step-2 box moves straight on.
  if (window.WAMPlans) {
    window.WAMPlans.onChange(() => {
      if (step === 2) renderPlanStep();
      if (step === 5) renderSummary();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && window.DownlabsAI && changes[window.DownlabsAI.SETTINGS_KEY] && step === 4) checkAi();
  });
  window.addEventListener("focus", () => { if (step === 3) checkWhatsApp(); if (step === 4) checkAi(); });

  // ─── start ──────────────────────────────────────────────────────────────

  (async () => {
    let saved = {};
    try { saved = (await chrome.storage.local.get([STORE_KEY]))[STORE_KEY] || {}; } catch {}
    maxVisited = Math.min(TOTAL, Number(saved.maxVisited) || 1);
    const fromHash = Number((/^#step-(\d)$/.exec(location.hash) || [])[1]);
    const start = fromHash || (saved.completedAt ? 1 : Number(saved.step) || 1);
    maxVisited = Math.max(maxVisited, start);
    show(start, { focus: false });
  })();
})();
