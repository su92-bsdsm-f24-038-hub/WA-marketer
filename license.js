/*
 * WAMarketer — plans, trial and Gumroad licensing (runs in the background service worker).
 *
 *   free   everything, but `freeDailyMessages` outgoing messages a day
 *   trial  `trialHours` of no limits, which the user switches on once (onboarding or plan pages)
 *   pro    a valid Gumroad license: no limits
 *
 * The service worker is the only writer of the plan state and the daily counter. Pages and
 * content scripts ask it through runtime messages (WAM_*), so parallel senders in several
 * tabs can never overshoot the daily limit.
 */
(function (global) {
  "use strict";

  const STATE_KEY = "wamLicense";
  const USAGE_KEY = "wamUsage";
  // Mirrors the trial start in sync storage, so reinstalling does not offer a second trial.
  const SYNC_TRIAL_KEY = "wamTrialActivatedAt";
  const VERIFY_URL = "https://api.gumroad.com/v2/licenses/verify";
  const HOUR = 3600000;
  const DAY = 24 * HOUR;

  function dayKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function nextMidnight(ms) {
    const d = new Date(ms);
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }

  function maskKey(key) {
    const k = String(key || "");
    return k.length <= 8 ? k : `${k.slice(0, 4)}…${k.slice(-4)}`;
  }

  /** Maps a Gumroad verify response to { valid, reason, message, info }. Pure. */
  function classifyPurchase(json, config) {
    if (!json || json.success !== true || !json.purchase) {
      return { valid: false, reason: "not_found", message: (json && json.message) || "That license key was not found for this product." };
    }
    const p = json.purchase;
    const info = {
      email: p.email || "",
      productName: p.product_name || "",
      saleId: p.sale_id || p.id || "",
      saleAt: p.sale_timestamp || p.created_at || "",
      subscriptionId: p.subscription_id || "",
      recurrence: p.recurrence || "",
      test: !!p.test,
      uses: Number(json.uses) || 0,
      cancelledAt: p.subscription_cancelled_at || null
    };
    if (p.refunded) return { valid: false, reason: "refunded", message: "This purchase was refunded, so the license is no longer active.", info };
    if (p.chargebacked || (p.disputed && !p.dispute_won)) return { valid: false, reason: "disputed", message: "This purchase is disputed, so the license is not active.", info };
    if (p.subscription_ended_at) return { valid: false, reason: "ended", message: "This subscription has ended. Renew it on Gumroad to get Pro back.", info };
    if (p.subscription_failed_at) return { valid: false, reason: "payment_failed", message: "The last subscription payment failed. Update your card on Gumroad, then refresh.", info };
    const max = Number(config.gumroad.maxActivations) || 0;
    if (max > 0 && info.uses > max) return { valid: false, reason: "too_many_activations", message: `This license is already active on ${max} browsers.`, info };
    // A cancelled subscription keeps access until the paid period ends; Gumroad then sets subscription_ended_at.
    return { valid: true, reason: "ok", message: "", info };
  }

  /** Current plan from stored state. Pure, so it can be tested with any clock. */
  function evaluate(state, usage, config, now) {
    const s = state || {};
    const installedAt = Number(s.installedAt) || now;
    const trialStartedAt = Number(s.trialStartedAt) || 0;
    const trialEndsAt = trialStartedAt ? trialStartedAt + config.trialHours * HOUR : 0;
    const lic = s.license || null;
    const graceMs = config.offlineGraceDays * DAY;
    const proActive = !!(lic && lic.key && lic.status === "active" && now - (Number(lic.verifiedAt) || 0) < graceMs);
    const plan = proActive ? "pro" : trialStartedAt && now < trialEndsAt ? "trial" : "free";
    const unlimited = plan !== "free";
    const today = dayKey(now);
    const used = usage && usage.date === today ? Number(usage.count) || 0 : 0;
    const limit = unlimited ? -1 : config.freeDailyMessages;
    return {
      plan,
      isPro: plan === "pro",
      isTrial: plan === "trial",
      unlimited,
      installedAt,
      trialAvailable: !trialStartedAt,
      trialStartedAt,
      trialEndsAt,
      trialMsLeft: trialStartedAt ? Math.max(0, trialEndsAt - now) : 0,
      usedToday: used,
      dailyLimit: limit,
      remainingToday: unlimited ? -1 : Math.max(0, limit - used),
      resetsAt: nextMidnight(now),
      license: lic ? {
        keyMasked: maskKey(lic.key),
        status: lic.status,
        reason: lic.reason || "",
        message: lic.message || "",
        email: lic.email || "",
        cancelledAt: lic.cancelledAt || null,
        test: !!lic.test,
        verifiedAt: lic.verifiedAt || 0,
        checkedAt: lic.checkedAt || 0
      } : null,
      store: {
        configured: !!(config.gumroad.productId || config.gumroad.productPermalink),
        productUrl: config.gumroad.productUrl || "",
        planName: config.plan.name,
        price: config.plan.price,
        period: config.plan.period,
        trialHours: config.trialHours,
        freeDailyMessages: config.freeDailyMessages,
        maxActivations: Number(config.gumroad.maxActivations) || 0,
        supportEmail: config.supportEmail || ""
      }
    };
  }

  function createLicense({ storage, syncStorage, fetchImpl, config, now = () => Date.now() }) {
    // Serializes every read-modify-write of our keys.
    let chain = Promise.resolve();
    const exclusive = (fn) => {
      const run = chain.then(fn, fn);
      chain = run.catch(() => {});
      return run;
    };

    async function read() {
      const r = await storage.get([STATE_KEY, USAGE_KEY]);
      return { state: r[STATE_KEY] || null, usage: r[USAGE_KEY] || null };
    }

    async function readSyncedTrial() {
      try { return Number((await syncStorage.get([SYNC_TRIAL_KEY]))[SYNC_TRIAL_KEY]) || 0; } catch { return 0; }
    }

    /** Records the install time once, and restores a trial already used in this Chrome profile. */
    function init() {
      return exclusive(async () => {
        const { state } = await read();
        const next = { ...(state || {}) };
        if (!next.installedAt) next.installedAt = now();
        const synced = await readSyncedTrial();
        if (synced && (!next.trialStartedAt || synced < next.trialStartedAt)) next.trialStartedAt = synced;
        if (next.trialStartedAt && synced !== next.trialStartedAt) {
          try { await syncStorage.set({ [SYNC_TRIAL_KEY]: next.trialStartedAt }); } catch {}
        }
        if (JSON.stringify(next) !== JSON.stringify(state)) await storage.set({ [STATE_KEY]: next });
        return next.installedAt;
      });
    }

    /** Starts the one-time free trial. */
    function startTrial() {
      return exclusive(async () => {
        const { state } = await read();
        const synced = await readSyncedTrial();
        const started = Number(state && state.trialStartedAt) || synced;
        if (started) {
          if (!(state && state.trialStartedAt)) await storage.set({ [STATE_KEY]: { ...(state || {}), trialStartedAt: started } });
          const ended = now() >= started + config.trialHours * HOUR;
          return { ok: false, already: true, message: ended ? "Your free trial has already been used." : "Your free trial is already running." };
        }
        const t = now();
        await storage.set({ [STATE_KEY]: { ...(state || {}), installedAt: (state && state.installedAt) || t, trialStartedAt: t } });
        try { await syncStorage.set({ [SYNC_TRIAL_KEY]: t }); } catch {}
        return { ok: true, trialEndsAt: t + config.trialHours * HOUR };
      });
    }

    async function status() {
      const { state, usage } = await read();
      return evaluate(state, usage, config, now());
    }

    async function verifyRemote(key, increment) {
      const form = new URLSearchParams();
      if (config.gumroad.productId) form.set("product_id", config.gumroad.productId);
      else form.set("product_permalink", config.gumroad.productPermalink);
      form.set("license_key", key);
      form.set("increment_uses_count", increment ? "true" : "false");
      let res;
      try {
        res = await fetchImpl(VERIFY_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
      } catch (err) {
        return { network: true, message: "Could not reach Gumroad. Check your internet connection and try again." };
      }
      let json = null;
      try { json = await res.json(); } catch {}
      if (!json && res.status >= 500) return { network: true, message: `Gumroad is not responding (HTTP ${res.status}). Try again in a minute.` };
      return { network: false, json };
    }

    function activate(rawKey) {
      const key = String(rawKey || "").trim();
      if (!key) return Promise.resolve({ ok: false, message: "Paste your license key first." });
      if (!config.gumroad.productId && !config.gumroad.productPermalink) {
        return Promise.resolve({ ok: false, message: "The Gumroad product is not set up yet (config.js → gumroad.productId)." });
      }
      return exclusive(async () => {
        const check = await verifyRemote(key, false);
        if (check.network) return { ok: false, message: check.message };
        const verdict = classifyPurchase(check.json, config);
        if (!verdict.valid) return { ok: false, reason: verdict.reason, message: verdict.message };
        const { state } = await read();
        const previous = state && state.license;
        // Count one activation per browser; re-activating the same key here does not use another seat.
        if (!previous || previous.key !== key) verifyRemote(key, true).catch(() => {});
        const t = now();
        const license = {
          key,
          status: "active",
          reason: "ok",
          message: "",
          email: verdict.info.email,
          cancelledAt: verdict.info.cancelledAt,
          test: verdict.info.test,
          activatedAt: t,
          verifiedAt: t,
          checkedAt: t
        };
        await storage.set({ [STATE_KEY]: { ...(state || {}), installedAt: (state && state.installedAt) || t, license } });
        return { ok: true, email: license.email, cancelled: !!license.cancelledAt };
      });
    }

    function deactivate() {
      return exclusive(async () => {
        const { state } = await read();
        const next = { ...(state || {}) };
        delete next.license;
        await storage.set({ [STATE_KEY]: next });
        return { ok: true };
      });
    }

    /** Re-checks a stored license with Gumroad (always when forced, else when it is due). */
    function refresh(force) {
      return exclusive(async () => {
        const { state } = await read();
        const lic = state && state.license;
        if (!lic || !lic.key) return { ok: true, skipped: true };
        const t = now();
        if (!force && t - (Number(lic.checkedAt) || 0) < config.revalidateHours * HOUR) return { ok: true, skipped: true };
        const check = await verifyRemote(lic.key, false);
        if (check.network) {
          // Keep Pro while offline; evaluate() drops it once the grace period runs out.
          await storage.set({ [STATE_KEY]: { ...state, license: { ...lic, checkedAt: t } } });
          return { ok: false, network: true, message: check.message };
        }
        const verdict = classifyPurchase(check.json, config);
        const license = verdict.valid
          ? { ...lic, status: "active", reason: "ok", message: "", email: verdict.info.email || lic.email, cancelledAt: verdict.info.cancelledAt, test: verdict.info.test, verifiedAt: t, checkedAt: t }
          : { ...lic, status: "invalid", reason: verdict.reason, message: verdict.message, checkedAt: t };
        await storage.set({ [STATE_KEY]: { ...state, license } });
        return { ok: verdict.valid, reason: verdict.reason, message: verdict.message };
      });
    }

    /**
     * Reserves `count` outgoing messages. Unlimited plans always pass (the count is still
     * kept for stats). Returns { allowed, ...status } plus a user-facing message when refused.
     */
    function consume(count = 1, source = "other") {
      return exclusive(async () => {
        const { state, usage } = await read();
        const t = now();
        const st = evaluate(state, usage, config, t);
        const n = Math.max(1, Number(count) || 1);
        if (!st.unlimited && st.usedToday + n > st.dailyLimit) {
          return {
            allowed: false,
            ...st,
            message: `Free plan limit reached: ${st.usedToday}/${st.dailyLimit} messages sent today. Sending resumes after midnight, or upgrade to ${config.plan.name} for unlimited messages.`
          };
        }
        const today = dayKey(t);
        const base = usage && usage.date === today ? usage : { date: today, count: 0, bySource: {} };
        const bySource = { ...(base.bySource || {}) };
        bySource[source] = (bySource[source] || 0) + n;
        const next = { date: today, count: (Number(base.count) || 0) + n, bySource };
        await storage.set({ [USAGE_KEY]: next });
        return { allowed: true, ...evaluate(state, next, config, t) };
      });
    }

    /** Gives back a reservation whose send did not go out. */
    function refund(count = 1, source = "other") {
      return exclusive(async () => {
        const { usage } = await read();
        const today = dayKey(now());
        if (!usage || usage.date !== today) return;
        const n = Math.max(1, Number(count) || 1);
        const bySource = { ...(usage.bySource || {}) };
        if (bySource[source]) bySource[source] = Math.max(0, bySource[source] - n);
        await storage.set({ [USAGE_KEY]: { ...usage, count: Math.max(0, (Number(usage.count) || 0) - n), bySource } });
      });
    }

    return { init, status, startTrial, activate, deactivate, refresh, consume, refund };
  }

  const api = { createLicense, evaluate, classifyPurchase, dayKey, nextMidnight, maskKey, STATE_KEY, USAGE_KEY };

  // ─── service-worker wiring ─────────────────────────────────────────────────
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id && global.WAM_CONFIG && typeof importScripts === "function") {
    const lic = createLicense({
      storage: chrome.storage.local,
      syncStorage: chrome.storage.sync,
      fetchImpl: (...a) => fetch(...a),
      config: global.WAM_CONFIG
    });
    Object.assign(api, lic);

    const openPage = (path) => chrome.tabs.create({ url: chrome.runtime.getURL(path) });

    /**
     * Wraps an outgoing-message handler: refuses it when the free quota is used up, and gives
     * the reservation back when the handler reports { success: false }.
     */
    api.gate = async function gate(source, sendResponse, run) {
      const q = await lic.consume(1, source);
      if (!q.allowed) {
        sendResponse({ success: false, limitExceeded: true, error: q.message, used: q.usedToday, limit: q.dailyLimit, planName: "Free" });
        return;
      }
      let settled = false;
      const respond = (result) => {
        if (settled) return;
        settled = true;
        if (!result || result.success === false) lic.refund(1, source);
        sendResponse(result);
      };
      try {
        await run(respond);
      } catch (err) {
        respond({ success: false, error: String((err && err.message) || err) });
      }
    };

    // Trial-ended notice: shown once, when the trial runs out.
    async function scheduleTrialEnd() {
      const st = await lic.status();
      if (st.plan === "trial") chrome.alarms.create("wamTrialEnd", { when: st.trialEndsAt + 1000 });
    }

    chrome.runtime.onInstalled.addListener(async (details) => {
      await lic.init();
      await scheduleTrialEnd();
      if (details.reason === "install") openPage("welcome.html");
    });
    lic.init().then(scheduleTrialEnd).catch(() => {});
    chrome.alarms.create("wamLicenseCheck", { periodInMinutes: 60 });

    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === "wamLicenseCheck") {
        await lic.refresh(false).catch(() => {});
      } else if (alarm.name === "wamTrialEnd") {
        const st = await lic.status();
        if (st.plan !== "free") return;
        chrome.notifications.create("wamTrialEnded", {
          type: "basic",
          iconUrl: chrome.runtime.getURL("icons/icon128.png"),
          title: "Your WAMarketer trial has ended",
          message: `You're on the free plan now: ${st.store.freeDailyMessages} messages a day. Upgrade to Pro (${st.store.price}/${st.store.period}) for unlimited sending.`,
          priority: 1
        });
      }
    });
    chrome.notifications.onClicked.addListener((id) => {
      if (id === "wamTrialEnded") openPage("plans.html");
    });

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("WAM_")) return false;
      const reply = (p) => p.then(sendResponse, (e) => sendResponse({ ok: false, message: String((e && e.message) || e) }));
      switch (msg.type) {
        case "WAM_TRIAL_START": reply(lic.startTrial().then(async (r) => { await scheduleTrialEnd(); return r; })); return true;
        case "WAM_LICENSE_STATUS": reply(lic.refresh(false).catch(() => {}).then(() => lic.status())); return true;
        case "WAM_LICENSE_ACTIVATE": reply(lic.activate(msg.key)); return true;
        case "WAM_LICENSE_DEACTIVATE": reply(lic.deactivate()); return true;
        case "WAM_LICENSE_REFRESH": reply(lic.refresh(true)); return true;
        case "WAM_QUOTA_CONSUME": reply(lic.consume(msg.count, msg.source)); return true;
        case "WAM_QUOTA_REFUND": reply(lic.refund(msg.count, msg.source).then(() => ({ ok: true }))); return true;
        case "WAM_OPEN_PLANS": openPage("plans.html"); sendResponse({ ok: true }); return false;
        case "WAM_OPEN_WELCOME": openPage("welcome.html"); sendResponse({ ok: true }); return false;
        default: return false;
      }
    });
  }

  global.WAMLicense = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
