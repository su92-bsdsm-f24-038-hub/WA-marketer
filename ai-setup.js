/*
 * WAMarketer — "Connect your AI" form (provider, API key, base URL, model, test).
 * Shared by the onboarding (welcome.html, step 4) and the Settings page (options.html).
 * Needs ai-providers.js (DownlabsAI) and ai-setup.css.
 *
 *   const ai = await WAMAiSetup.mount(element, { onSaved(settings), onTested(result) });
 *   ai.settings        the live settings object (the Settings page edits voice options on it too)
 *   ai.save()          debounced save · ai.flush() save now · ai.render() redraw after outside edits
 */
(function (global) {
  "use strict";

  const TAGLINES = {
    openai: "GPT-4o, GPT-5",
    anthropic: "Claude models",
    gemini: "Free tier available",
    groq: "Very fast, free tier",
    openrouter: "100+ models, one key",
    deepseek: "Low cost",
    mistral: "European models",
    xai: "Grok models",
    together: "Open-source models",
    ollama: "Runs on your computer",
    custom: "Any OpenAI-compatible API"
  };

  let seq = 0;

  async function mount(root, opts = {}) {
    const AI = global.DownlabsAI;
    const { PROVIDERS } = AI;
    const uid = `ai${++seq}`;
    root.classList.add("ai-setup");
    root.innerHTML = `
      <div class="ai-label">Choose a provider</div>
      <div class="providers" role="radiogroup" aria-label="AI provider"></div>
      <div class="ai-fields">
        <label class="field" data-f="key">
          <span>API key</span>
          <span class="with-btn">
            <input type="password" data-i="key" autocomplete="off" spellcheck="false" placeholder="Paste your API key">
            <button class="btn" type="button" data-a="toggle">Show</button>
          </span>
          <small data-i="keyHint"></small>
        </label>
        <label class="field" data-f="base">
          <span>API base URL</span>
          <input type="url" data-i="base" spellcheck="false" placeholder="https://api.example.com/v1">
          <small>OpenAI-compatible endpoint (the URL that ends before <code>/chat/completions</code>).</small>
        </label>
        <label class="field" data-f="model">
          <span>Model</span>
          <span class="with-btn">
            <input type="text" data-i="model" list="${uid}-models" spellcheck="false" placeholder="Model name">
            <button class="btn" type="button" data-a="models">Load models</button>
          </span>
          <datalist id="${uid}-models"></datalist>
          <small>Pick a suggestion or type any model your provider offers.</small>
        </label>
      </div>
      <div class="ai-actions">
        <button class="btn primary" type="button" data-a="test">Save &amp; test connection</button>
        <span class="ai-saved" aria-live="polite">Saved</span>
      </div>
      <div class="msg" data-i="status" role="status"></div>`;

    const q = (sel) => root.querySelector(sel);
    const el = {
      providers: q(".providers"),
      key: q('[data-i="key"]'),
      keyHint: q('[data-i="keyHint"]'),
      baseField: q('[data-f="base"]'),
      base: q('[data-i="base"]'),
      model: q('[data-i="model"]'),
      list: q("datalist"),
      toggle: q('[data-a="toggle"]'),
      loadModels: q('[data-a="models"]'),
      test: q('[data-a="test"]'),
      saved: q(".ai-saved"),
      status: q('[data-i="status"]')
    };

    let settings = await AI.getSettings();
    const loadedModels = {};
    let saveTimer = null;

    const current = () => (PROVIDERS[settings.provider] ? settings.provider : "openai");

    function setStatus(kind, text) {
      el.status.className = kind ? `msg show ${kind}` : "msg";
      el.status.textContent = text || "";
    }

    function flashSaved() {
      el.saved.classList.add("show");
      setTimeout(() => el.saved.classList.remove("show"), 1400);
    }

    function save() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        saveTimer = null;
        await AI.saveSettings(settings);
        flashSaved();
        renderProviders();
        opts.onSaved && opts.onSaved(settings);
      }, 300);
    }

    async function flush() {
      clearTimeout(saveTimer);
      saveTimer = null;
      await AI.saveSettings(settings);
      opts.onSaved && opts.onSaved(settings);
    }

    function renderProviders() {
      el.providers.textContent = "";
      for (const [id, def] of Object.entries(PROVIDERS)) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "provider" + (settings.apiKeys[id] ? " has-key" : "");
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(id === current()));
        b.title = settings.apiKeys[id] ? "API key saved" : "";
        const name = document.createElement("strong");
        name.textContent = def.label;
        const tag = document.createElement("span");
        tag.textContent = TAGLINES[id] || "";
        const dot = document.createElement("i");
        dot.className = "dot";
        b.append(name, tag, dot);
        b.addEventListener("click", () => {
          settings.provider = id;
          setStatus();
          renderFields();
          renderProviders();
          save();
        });
        el.providers.appendChild(b);
      }
    }

    function fillModelList() {
      const id = current();
      el.list.textContent = "";
      for (const m of new Set([...(PROVIDERS[id].models || []), ...(loadedModels[id] || [])])) {
        const o = document.createElement("option");
        o.value = m;
        el.list.appendChild(o);
      }
    }

    function renderFields() {
      const id = current();
      const def = PROVIDERS[id];
      el.key.value = settings.apiKeys[id] || "";
      el.key.placeholder = def.keyOptional ? "Optional for this provider" : `Paste your ${def.label} API key`;
      el.keyHint.textContent = "";
      if (def.keyUrl) {
        el.keyHint.append("Get a key: ");
        const a = document.createElement("a");
        a.href = def.keyUrl;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = new URL(def.keyUrl).host;
        el.keyHint.appendChild(a);
      } else if (id === "ollama") {
        el.keyHint.textContent = "No key needed. If requests fail with 403, start Ollama with OLLAMA_ORIGINS=chrome-extension://* and make sure the model is pulled.";
      } else {
        el.keyHint.textContent = "Leave empty if your endpoint doesn't need one.";
      }
      el.baseField.hidden = !def.editableBaseUrl;
      el.base.value = settings.baseUrls[id] || def.baseUrl || "";
      el.model.value = settings.models[id] || def.defaultModel || "";
      fillModelList();
    }

    el.key.addEventListener("input", () => { settings.apiKeys[current()] = el.key.value.trim(); save(); });
    el.base.addEventListener("input", () => { settings.baseUrls[current()] = el.base.value.trim(); save(); });
    el.model.addEventListener("input", () => { settings.models[current()] = el.model.value.trim(); save(); });
    el.toggle.addEventListener("click", () => {
      el.key.type = el.key.type === "password" ? "text" : "password";
      el.toggle.textContent = el.key.type === "password" ? "Show" : "Hide";
    });

    // Custom / local endpoints may live on hosts the manifest doesn't cover. Must run directly
    // inside the click handler so Chrome sees the user gesture.
    function requestEndpointAccess() {
      const id = current();
      if (!PROVIDERS[id].editableBaseUrl) return Promise.resolve(true);
      let origin;
      try { origin = new URL(settings.baseUrls[id] || PROVIDERS[id].baseUrl).origin; } catch { return Promise.resolve(false); }
      return chrome.permissions.request({ origins: [origin + "/*"] }).catch(() => false);
    }

    el.test.addEventListener("click", async () => {
      const access = requestEndpointAccess();
      el.test.disabled = true;
      setStatus("warn", "Testing…");
      let result = null;
      try {
        if (!(await access)) {
          setStatus("err", "Chrome did not grant access to that endpoint.");
          return;
        }
        await flush();
        result = await AI.testConnection(settings);
        const id = current();
        if (result.ok) setStatus("ok", `Connected to ${PROVIDERS[id].label} (${settings.models[id] || PROVIDERS[id].defaultModel}) in ${result.ms} ms. Reply: “${result.reply || "(empty)"}”`);
        else setStatus("err", result.error || "Request failed.");
      } finally {
        el.test.disabled = false;
        opts.onTested && opts.onTested(result);
      }
    });

    el.loadModels.addEventListener("click", async () => {
      const access = requestEndpointAccess();
      el.loadModels.disabled = true;
      try {
        if (!(await access)) {
          setStatus("err", "Chrome did not grant access to that endpoint.");
          return;
        }
        await flush();
        const models = await AI.listModels(settings);
        loadedModels[current()] = models;
        fillModelList();
        setStatus("ok", `Loaded ${models.length} models. Click the Model field to pick one.`);
      } catch (e) {
        setStatus("err", `Could not load models: ${e.message || e}`);
      } finally {
        el.loadModels.disabled = false;
      }
    });

    // Follow changes made in another tab (e.g. the popup or the CRM).
    chrome.storage.onChanged.addListener((changes, area) => {
      const change = area === "local" && changes[AI.SETTINGS_KEY];
      if (change && !saveTimer && JSON.stringify(change.newValue) !== JSON.stringify(settings)) {
        AI.getSettings().then((s) => {
          settings = s;
          renderProviders();
          renderFields();
          opts.onSaved && opts.onSaved(settings);
        });
      }
    });

    renderProviders();
    renderFields();

    return {
      get settings() { return settings; },
      save,
      flush,
      render() { renderProviders(); renderFields(); },
      focus() { (el.key.closest("[hidden]") ? el.model : el.key).focus(); }
    };
  }

  global.WAMAiSetup = { mount };
})(typeof globalThis !== "undefined" ? globalThis : self);
