// Settings page: AI provider, voice transcription, reply tuning and optional site access.
(async function () {
  "use strict";

  if (new URLSearchParams(location.search).has("embedded")) {
    document.documentElement.classList.add("embedded");
    document.querySelector("h1").textContent = "AI Provider & API Key";
  }

  const { PROVIDERS } = DownlabsAI;
  const $ = (id) => document.getElementById(id);

  function flash(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 1400);
  }
  function setStatus(id, kind, text) {
    const el = $(id);
    el.className = kind ? `msg show ${kind}` : "msg";
    el.textContent = text || "";
  }

  // ─── AI provider (shared with the onboarding, see ai-setup.js) ────────────

  // The voice section below edits the same settings object, so both parts always save together.
  const ai = await WAMAiSetup.mount($("aiMount"), { onSaved: () => renderVoice() });

  // ─── voice transcription ──────────────────────────────────────────────────

  function renderVoice() {
    const settings = ai.settings;
    $("sttProvider").value = settings.transcription.provider || "auto";
    $("sttModel").value = settings.transcription.model || "";
    $("sttLanguage").value = settings.transcription.language || "";
    const resolved = DownlabsAI.transcriptionProviderId(settings);
    const off = !resolved;
    $("sttModel").disabled = off;
    $("sttKeyField").style.display = off ? "none" : "";
    if (off) {
      $("sttResolved").textContent = "Voice notes will not be transcribed.";
      return;
    }
    const def = PROVIDERS[resolved];
    $("sttModel").placeholder = def.transcription?.model || "whisper-1";
    $("sttResolved").textContent = `Using ${def.label}${settings.apiKeys[resolved] || def.keyOptional ? "" : " — add its API key below"}.`;
    $("sttKeyLabel").textContent = `${def.label} API key`;
    if (document.activeElement !== $("sttKey")) $("sttKey").value = settings.apiKeys[resolved] || "";
  }

  function saveVoice() {
    ai.save();
    flash("savedVoice");
  }
  $("sttProvider").addEventListener("change", (e) => {
    ai.settings.transcription.provider = e.target.value;
    renderVoice();
    saveVoice();
  });
  $("sttModel").addEventListener("input", (e) => {
    ai.settings.transcription.model = e.target.value.trim();
    saveVoice();
  });
  $("sttLanguage").addEventListener("change", (e) => {
    ai.settings.transcription.language = e.target.value;
    saveVoice();
  });
  $("sttKey").addEventListener("input", (e) => {
    const id = DownlabsAI.transcriptionProviderId(ai.settings);
    if (!id) return;
    ai.settings.apiKeys[id] = e.target.value.trim();
    ai.render(); // keeps the AI section's key field and "key saved" dots in step
    saveVoice();
  });

  // ─── reply tuning (stored in aiConfig, read by the WhatsApp script) ───────

  const TUNING = {
    replyDelay: { min: 1, max: 120, def: 2, toStore: (v) => Math.round(v * 1000), fromStore: (v) => v / 1000 },
    debounceTime: { min: 3, max: 120, def: 10, toStore: (v) => Math.round(v * 1000), fromStore: (v) => v / 1000 },
    maxTokens: { min: 50, max: 4000, def: 500, toStore: (v) => Math.round(v), fromStore: (v) => v },
    temperature: { min: 0, max: 1, def: 0.7, toStore: (v) => Math.round(v * 100) / 100, fromStore: (v) => v }
  };

  async function renderTuning() {
    const { aiConfig } = await chrome.storage.local.get(["aiConfig"]);
    const c = aiConfig || {};
    for (const [key, t] of Object.entries(TUNING)) {
      $(key).value = typeof c[key] === "number" ? t.fromStore(c[key]) : t.def;
    }
  }

  for (const [key, t] of Object.entries(TUNING)) {
    $(key).addEventListener("change", async (e) => {
      let v = parseFloat(e.target.value);
      if (!Number.isFinite(v)) v = t.def;
      v = Math.min(t.max, Math.max(t.min, v));
      e.target.value = v;
      const { aiConfig } = await chrome.storage.local.get(["aiConfig"]);
      await chrome.storage.local.set({ aiConfig: { ...(aiConfig || {}), [key]: t.toStore(v) } });
      flash("savedTuning");
    });
  }

  // ─── optional site access ─────────────────────────────────────────────────

  const ALL_SITES = { origins: ["https://*/*", "http://*/*"] };
  async function renderAccess() {
    $("allSites").checked = await chrome.permissions.contains(ALL_SITES);
  }
  $("allSites").addEventListener("change", async (e) => {
    try {
      const granted = e.target.checked ? await chrome.permissions.request(ALL_SITES) : !(await chrome.permissions.remove(ALL_SITES));
      e.target.checked = granted;
      setStatus("accessStatus", granted ? "ok" : "", granted ? "Access granted. You can now import web pages and use custom endpoints." : "");
    } catch (err) {
      e.target.checked = false;
      setStatus("accessStatus", "err", String(err.message || err));
    }
  });

  // ─── misc ─────────────────────────────────────────────────────────────────

  $("openWa").addEventListener("click", () => chrome.tabs.create({ url: "https://web.whatsapp.com" }));
  $("openCrm").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("crm/index.html") }));
  $("version").textContent = chrome.runtime.getManifest().version;

  renderVoice();
  renderTuning();
  renderAccess();
})();
