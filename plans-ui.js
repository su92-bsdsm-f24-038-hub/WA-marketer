/*
 * WAMarketer — plan status, pricing and license activation widgets.
 * Fills every [data-wam="..."] element on the page: status, countdown, pricing, activate, faq.
 * All plan data comes from the background worker (license.js), so every page stays in sync.
 */
(function () {
  "use strict";

  if (new URLSearchParams(location.search).get("embedded") === "1") document.documentElement.classList.add("embedded");

  const ICON = {
    check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    clock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    crown: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 7 5 5 5-8 5 8 5-5-2 12H4L2 7Z"/><path d="M4 21h16"/></svg>',
    key: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M16 7l3 3M19 4l2 2"/></svg>',
    refresh: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>'
  };

  // What Pro includes. The free plan has every feature too, capped at the daily message limit.
  const PRO_FEATURES = [
    ["Unlimited messages", "No daily cap on campaigns, follow-ups, AI auto-replies and scheduled messages."],
    ["Bulk campaigns", "Import a CSV or paste numbers: up to 5,000 recipients per campaign."],
    ["Personalized messages", "Variables with fallbacks, like {{name|there}}, plus spintax so every message reads differently."],
    ["Images, videos & PDFs", "Up to 10 attachments per message, each with its own caption."],
    ["Automatic follow-ups", "Follow-up flows on day 3, 7 and 14 that skip anyone who has replied."],
    ["Account-safe sending", "Random human-like delays, typing simulation, sending hours, batch breaks and auto-pause."],
    ["Auto-save contacts", "Save recipients to WhatsApp contacts with names from your list or a numbered prefix."],
    ["AI auto-replies", "Answer customers around the clock with your own OpenAI, Claude, Gemini, Groq or OpenRouter key."],
    ["WhatsApp CRM", "Contacts, pipeline, tags, notes, tasks and a Campaigns tab inside WhatsApp Web."],
    ["Dashboard & reports", "Sent, failed, reply and opt-out stats per campaign, with CSV export."],
    ["Opt-out handling", "STOP keywords and an unsubscribe footer are handled for you."],
    ["Every future update", "New features ship to Pro at no extra cost."]
  ];

  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra });

  let status = null;
  const listeners = [];
  // A notice for the license card that survives the re-renders triggered by storage changes.
  let flash = null;

  function checkoutUrl() {
    const url = status && status.store.productUrl;
    if (!url) return "";
    return url + (url.includes("?") ? "&" : "?") + "wanted=true";
  }

  function splitDuration(ms) {
    const mins = Math.max(0, Math.floor(ms / 60000));
    return { h: Math.floor(mins / 60), m: mins % 60 };
  }

  function durationText(ms) {
    const { h, m } = splitDuration(ms);
    return h ? `${h}h ${m}m` : `${m}m`;
  }

  function fmtTime(ms) {
    return new Date(ms).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function trialButton() {
    return `<button class="btn primary" type="button" data-act="start-trial">${ICON.clock}Start ${status.store.trialHours}-hour free trial</button>`;
  }

  function upgradeButton(label) {
    const url = checkoutUrl();
    if (!url) return `<button class="btn pro" type="button" disabled title="Set gumroad.productUrl in config.js">${ICON.crown}${esc(label)}</button>`;
    return `<a class="btn pro" href="${esc(url)}" target="_blank" rel="noopener">${ICON.crown}${esc(label)}</a>`;
  }

  // ─── widgets ──────────────────────────────────────────────────────────────

  function renderStatus(el) {
    const s = status;
    const price = `${s.store.price}/${s.store.period}`;
    let pill, title, body;
    if (s.plan === "pro") {
      pill = `<span class="pill pro">${ICON.crown}Pro</span>`;
      title = `${esc(s.store.planName)} is active`;
      body = `<p class="muted" style="margin:0">Unlimited messages on every feature.${s.license && s.license.cancelledAt ? " Your subscription is cancelled and stays active until the end of the paid period." : ""}</p>
        <p class="muted small" style="margin:0">${s.usedToday} message${s.usedToday === 1 ? "" : "s"} sent today.</p>`;
    } else if (s.plan === "trial") {
      pill = `<span class="pill trial"><span class="dot"></span>Free trial</span>`;
      title = `${durationText(s.trialMsLeft)} of your free trial left`;
      body = `<p class="muted" style="margin:0">Everything is unlimited until ${esc(fmtTime(s.trialEndsAt))}. After that you keep every feature on the free plan with ${s.store.freeDailyMessages} messages a day, or upgrade to Pro for ${esc(price)}.</p>
        <p class="muted small" style="margin:0">${s.usedToday} message${s.usedToday === 1 ? "" : "s"} sent today.</p>`;
    } else {
      const pct = Math.min(100, Math.round((s.usedToday / Math.max(1, s.dailyLimit)) * 100));
      pill = `<span class="pill free"><span class="dot"></span>Free plan</span>`;
      title = s.remainingToday > 0 ? `${s.remainingToday} of ${s.dailyLimit} messages left today` : "Today's free messages are used up";
      body = `<div><div class="meter${pct >= 100 ? " full" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="${s.dailyLimit}" aria-valuenow="${s.usedToday}" aria-label="Messages sent today"><span style="width:${pct}%"></span></div>
        <div class="meter-row"><span>${s.usedToday} / ${s.dailyLimit} sent today</span><span>Resets ${esc(fmtTime(s.resetsAt))}</span></div></div>
        <p class="muted" style="margin:0">${s.trialAvailable
          ? `Want to test without limits first? Start your one-time ${s.store.trialHours}-hour free trial: unlimited messages, then you're back to ${s.dailyLimit} a day.`
          : "Your free trial has ended. Campaigns keep running and pause automatically when the daily limit is reached; they continue after midnight."}</p>`;
    }
    const license = s.license && s.license.status === "invalid" && s.plan !== "pro"
      ? `<div class="msg warn show" style="margin:0">Your Pro license is no longer active: ${esc(s.license.message)}</div>` : "";
    el.innerHTML = `<div class="card status-card">
      <div class="status-top"><h2 class="status-title">${title}</h2>${pill}</div>
      ${body}${license}
      ${s.plan === "pro" ? "" : `<div class="row">${s.trialAvailable ? trialButton() : ""}${upgradeButton(`Upgrade to Pro · ${price}`)}</div>`}
    </div>`;
  }

  function renderCountdown(el) {
    const s = status;
    if (s.plan === "trial") {
      const { h, m } = splitDuration(s.trialMsLeft);
      el.innerHTML = `<div class="sub">Your free Pro trial is running</div>
        <div class="big">Unlimited</div>
        <div class="sub">Every feature, no message limit, until ${esc(fmtTime(s.trialEndsAt))}.</div>
        <div class="countdown" aria-label="Trial time left"><div><b>${h}</b><small>hours</small></div><div><b>${m}</b><small>minutes</small></div><div><b>∞</b><small>messages</small></div></div>`;
    } else if (s.plan === "pro") {
      el.innerHTML = `<div class="sub">You're on</div><div class="big">Pro</div><div class="sub">Unlimited messages on every feature. Thank you for your support.</div>`;
    } else if (s.trialAvailable) {
      el.innerHTML = `<div class="sub">Ready when you are</div><div class="big">${s.store.trialHours} hours free</div>
        <div class="sub">Unlimited messages and every feature. Afterwards, ${s.store.freeDailyMessages} messages a day stay free.</div>`;
    } else {
      el.innerHTML = `<div class="sub">Your trial has ended</div><div class="big">${s.remainingToday}/${s.dailyLimit}</div>
        <div class="sub">free messages left today. Upgrade to Pro for ${esc(s.store.price)}/${esc(s.store.period)} to remove the limit.</div>`;
    }
  }

  function renderPricing(el) {
    const s = status;
    const free = [
      ["Every feature included", "Campaigns, follow-ups, AI replies, CRM and reports."],
      [`${s.store.freeDailyMessages} messages per day`, "Campaign messages, follow-ups, AI auto-replies and scheduled messages all count.", "limit"],
      ["Resets every midnight", "Campaigns wait and continue automatically the next day."],
      ["No card, no account", `Includes a one-time ${s.store.trialHours}-hour trial with unlimited messages.`]
    ];
    const li = ([t, d, cls]) => `<li${cls ? ` class="${cls}"` : ""}>${cls ? ICON.clock : ICON.check}<div><strong>${esc(t)}</strong><span>${esc(d)}</span></div></li>`;
    const proCta = s.plan === "pro"
      ? `<button class="btn" type="button" disabled>${ICON.check}Your current plan</button>`
      : upgradeButton(`Get Pro · ${s.store.price}/${s.store.period}`);
    el.innerHTML = `<div class="pricing">
      <div class="card plan">
        <div><h3>Free</h3><p class="muted small" style="margin:0">For trying things out and small lists</p></div>
        <div class="price">$0 <small>forever</small></div>
        <ul class="features">${free.map(li).join("")}</ul>
        <div class="cta">${s.plan === "free" ? `<button class="btn" type="button" disabled>Your current plan</button>` : `<p class="muted small" style="margin:0;text-align:center">You move to Free when the trial ends${s.plan === "pro" ? " or your subscription ends" : ""}.</p>`}</div>
      </div>
      <div class="card plan pro-plan">
        <span class="ribbon">Most popular</span>
        <div><h3>${esc(s.store.planName)}</h3><p class="muted small" style="margin:0">For businesses that market on WhatsApp every day</p></div>
        <div class="price">${esc(s.store.price)} <small>/ ${esc(s.store.period)}</small></div>
        <ul class="features">${PRO_FEATURES.map(li).join("")}</ul>
        <div class="cta">${proCta}<p class="muted small" style="margin:0;text-align:center">Secure checkout by Gumroad · Cancel anytime</p></div>
      </div>
    </div>`;
  }

  function renderActivate(el) {
    const s = status;
    const lic = s.license;
    if (lic && lic.status === "active") {
      el.innerHTML = `<div class="card activate">
        <h3>${ICON.key} License</h3>
        <dl class="kv">
          <dt>Status</dt><dd>${s.plan === "pro" ? "Active" : "Not verified recently. Connect to the internet and refresh"}${lic.test ? " (test purchase)" : ""}</dd>
          <dt>Key</dt><dd><code>${esc(lic.keyMasked)}</code></dd>
          ${lic.email ? `<dt>Purchased by</dt><dd>${esc(lic.email)}</dd>` : ""}
          <dt>Last checked</dt><dd>${lic.checkedAt ? esc(fmtTime(lic.checkedAt)) : "—"}</dd>
        </dl>
        <div class="row">
          <button class="btn" type="button" data-act="refresh">${ICON.refresh}Check again</button>
          <button class="btn ghost danger" type="button" data-act="deactivate">Remove license from this browser</button>
        </div>
        <div class="msg" role="status"></div>
      </div>`;
    } else {
      el.innerHTML = `<div class="card activate">
        <h3>${ICON.key} Already bought Pro? Activate it</h3>
        <p class="muted small" style="margin:0 0 12px">Paste the license key from your Gumroad receipt email (also in your Gumroad library).</p>
        <form novalidate>
          <input name="key" autocomplete="off" spellcheck="false" placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX" aria-label="License key" value="">
          <button class="btn primary" type="submit">Activate</button>
        </form>
        ${s.store.configured ? "" : `<div class="msg warn show">Store not configured: set <code>gumroad.productId</code> in config.js.</div>`}
        <div class="msg" role="status"></div>
      </div>`;
    }
    const box = el.querySelector(".msg[role=status]");
    const say = (cls, text) => { box.className = `msg show ${cls}`; box.textContent = text; };
    if (flash && Date.now() < flash.until) say(flash.cls, flash.text);
    const flashAndLoad = async (cls, text) => { flash = { cls, text, until: Date.now() + 8000 }; await load(); };

    el.querySelector("form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = e.target.elements.key;
      const btn = e.target.querySelector("button");
      btn.disabled = true;
      btn.textContent = "Checking…";
      try {
        const r = await send("WAM_LICENSE_ACTIVATE", { key: input.value });
        if (r && r.ok) {
          input.blur(); // let render() swap the form for the license details
          await flashAndLoad("ok", `Pro activated${r.email ? ` for ${r.email}` : ""}. Unlimited messages are on.`);
        } else {
          say("err", (r && r.message) || "Activation failed.");
        }
      } catch (err) {
        say("err", String(err.message || err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Activate";
      }
    });
    el.querySelector('[data-act="refresh"]')?.addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      const r = await send("WAM_LICENSE_REFRESH").catch((err) => ({ ok: false, message: String(err) }));
      await flashAndLoad(r && r.ok ? "ok" : r && r.network ? "warn" : "err", r && r.ok ? "License is valid." : (r && r.message) || "Could not verify the license.");
    });
    el.querySelector('[data-act="deactivate"]')?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      if (btn.dataset.confirm !== "1") {
        btn.dataset.confirm = "1";
        btn.textContent = "Click again to remove";
        setTimeout(() => { if (btn.isConnected) { btn.dataset.confirm = ""; btn.textContent = "Remove license from this browser"; } }, 4000);
        return;
      }
      await send("WAM_LICENSE_DEACTIVATE");
      await flashAndLoad("ok", "License removed from this browser. You can activate it again any time.");
    });
  }

  function renderFaq(el) {
    const s = status;
    const items = [
      ["What counts as a message?", `Every message WAMarketer sends for you: campaign messages, follow-ups, AI auto-replies and scheduled messages. A message with attachments counts once. Messages you type yourself in WhatsApp never count.`],
      ["What happens when I reach the free limit?", `Running campaigns and follow-ups pause with a note and continue automatically after midnight. AI auto-replies stop for the rest of the day. Upgrading to Pro resumes everything straight away.`],
      ["How do I get my license key?", `After checkout, Gumroad emails you a receipt with your license key. It is also in your Gumroad library. Paste it on this page and click Activate.`],
      ["Can I cancel anytime?", `Yes. Cancel from your Gumroad library or receipt. Pro stays active until the end of the period you paid for, then you're back on the free plan with all your data kept.`],
      ["Where is my data stored?", `On this computer, in your browser. Campaigns, contacts and AI keys never go to our servers. Activating a license only sends the key to Gumroad to check it.`],
      ["Can I use one license on several computers?", s.store.maxActivations > 0
        ? `Yes, on up to ${s.store.maxActivations} browsers. Activate the same key in each one.`
        : `Yes. Activate the same key in each browser where you use WAMarketer.`]
    ];
    if (s.store.supportEmail) items.push(["I have a billing question", `Email ${s.store.supportEmail}.`]);
    el.innerHTML = `<div class="card faq">${items.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>`;
  }

  // "Start free trial" buttons anywhere on the page.
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest('[data-act="start-trial"]');
    if (!btn) return;
    btn.disabled = true;
    const r = await send("WAM_TRIAL_START").catch((err) => ({ ok: false, message: String(err) }));
    if (!r || !r.ok) flash = { cls: "warn", text: (r && r.message) || "Could not start the trial.", until: Date.now() + 8000 };
    await load();
    document.dispatchEvent(new CustomEvent("wam:trial", { detail: r }));
  });

  const RENDER = { status: renderStatus, countdown: renderCountdown, pricing: renderPricing, activate: renderActivate, faq: renderFaq };

  function render(only) {
    if (!status) return;
    for (const el of $$("[data-wam]")) {
      const kind = el.dataset.wam;
      if (only && !only.includes(kind)) continue;
      // Keep a half-typed license key through background refreshes.
      if (kind === "activate" && el.contains(document.activeElement) && document.activeElement.tagName === "INPUT") continue;
      if (RENDER[kind]) RENDER[kind](el);
    }
    for (const el of $$("[data-wam-plan]")) el.hidden = !el.dataset.wamPlan.split(" ").includes(status.plan);
    for (const el of $$("[data-wam-price]")) el.textContent = `${status.store.price}/${status.store.period}`;
    for (const el of $$("[data-wam-free-limit]")) el.textContent = String(status.store.freeDailyMessages);
    for (const el of $$("[data-wam-trial-hours]")) el.textContent = String(status.store.trialHours);
  }

  async function load() {
    try {
      status = await send("WAM_LICENSE_STATUS");
    } catch (err) {
      status = null;
    }
    if (!status || !status.plan) {
      for (const el of $$("[data-wam]")) el.innerHTML = `<div class="card"><p class="muted" style="margin:0">Plan details are loading. If this stays, reload the extension.</p></div>`;
      return;
    }
    render();
    for (const fn of listeners) { try { fn(status); } catch (err) { console.warn(err); } }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.wamLicense || changes.wamUsage)) load();
  });
  // Keep the trial countdown and "resets" times current.
  setInterval(() => { if (status && status.plan !== "pro") load(); }, 30000);

  window.WAMPlans = {
    load,
    get status() { return status; },
    async startTrial() {
      const r = await send("WAM_TRIAL_START").catch((err) => ({ ok: false, message: String(err) }));
      await load();
      return r;
    },
    onChange(fn) { listeners.push(fn); }
  };
  load();
})();
