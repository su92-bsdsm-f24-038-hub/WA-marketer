/*
 * WAMarketer — AI provider layer.
 *
 * The rest of the extension builds OpenAI "chat/completions" style requests.
 * This module sends them straight to the provider the user picked in Settings,
 * using the user's own API key. No proxy server is involved.
 *
 * Loaded as a classic script (importScripts in the service worker, <script> in
 * extension pages) and exposed as globalThis.DownlabsAI.
 */
(function (global) {
  "use strict";

  const SETTINGS_KEY = "downlabsAiSettings";

  // kind: "openai" = OpenAI-compatible /chat/completions, "anthropic" = Messages API.
  const PROVIDERS = {
    openai: {
      label: "OpenAI",
      kind: "openai",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o-mini",
      models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "gpt-5-mini", "gpt-5"],
      keyUrl: "https://platform.openai.com/api-keys",
      transcription: { model: "whisper-1" }
    },
    anthropic: {
      label: "Anthropic (Claude)",
      kind: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      defaultModel: "claude-opus-5",
      models: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5", "claude-opus-5-5", "claude-fable-5-1"],
      keyUrl: "https://console.anthropic.com/settings/keys"
    },
    gemini: {
      label: "Google Gemini",
      kind: "openai",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      defaultModel: "gemini-2.5-flash",
      models: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
      keyUrl: "https://aistudio.google.com/app/apikey"
    },
    groq: {
      label: "Groq",
      kind: "openai",
      baseUrl: "https://api.groq.com/openai/v1",
      defaultModel: "openai/gpt-oss-20b",
      models: ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
      keyUrl: "https://console.groq.com/keys",
      transcription: { model: "whisper-large-v3-turbo" }
    },
    openrouter: {
      label: "OpenRouter",
      kind: "openai",
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: "openai/gpt-4o-mini",
      models: ["openai/gpt-4o-mini", "anthropic/claude-sonnet-5", "google/gemini-2.5-flash", "meta-llama/llama-3.3-70b-instruct"],
      keyUrl: "https://openrouter.ai/keys"
    },
    deepseek: {
      label: "DeepSeek",
      kind: "openai",
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-chat",
      models: ["deepseek-chat", "deepseek-reasoner"],
      keyUrl: "https://platform.deepseek.com/api_keys"
    },
    mistral: {
      label: "Mistral",
      kind: "openai",
      baseUrl: "https://api.mistral.ai/v1",
      defaultModel: "mistral-small-latest",
      models: ["mistral-small-latest", "mistral-medium-latest", "mistral-large-latest"],
      keyUrl: "https://console.mistral.ai/api-keys"
    },
    xai: {
      label: "xAI (Grok)",
      kind: "openai",
      baseUrl: "https://api.x.ai/v1",
      defaultModel: "grok-3-mini",
      models: ["grok-3-mini", "grok-3", "grok-4"],
      keyUrl: "https://console.x.ai"
    },
    together: {
      label: "Together AI",
      kind: "openai",
      baseUrl: "https://api.together.xyz/v1",
      defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct-Turbo"],
      keyUrl: "https://api.together.ai/settings/api-keys"
    },
    ollama: {
      label: "Ollama (local, free)",
      kind: "openai",
      baseUrl: "http://localhost:11434/v1",
      defaultModel: "llama3.1",
      models: ["llama3.1", "qwen2.5", "mistral", "gemma2"],
      keyOptional: true,
      editableBaseUrl: true
    },
    custom: {
      label: "Custom (OpenAI-compatible)",
      kind: "openai",
      baseUrl: "",
      defaultModel: "",
      models: [],
      keyOptional: true,
      editableBaseUrl: true,
      transcription: { model: "whisper-1" }
    }
  };

  const TRANSCRIPTION_PROVIDERS = ["openai", "groq", "custom"];
  const TRANSCRIPTION_LANGUAGES = new Set([
    "", "af", "ar", "hy", "az", "be", "bs", "bg", "ca", "zh", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "gl", "de", "el", "he", "hi", "hu", "is", "id", "it", "ja", "kn", "kk", "ko", "lv", "lt", "mk", "ms", "mr", "ne", "no", "fa", "pl", "pt", "ro", "ru", "sr", "sk", "sl", "es", "sw", "sv", "tl", "ta", "te", "th", "tr", "uk", "ur", "vi", "cy"
  ]);

  const DEFAULT_SETTINGS = {
    provider: "openai",
    apiKeys: {},
    models: {},
    baseUrls: {},
    transcription: { provider: "auto", model: "", language: "" }
  };

  function storageGet(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (r) => resolve(r || {}));
      } catch {
        resolve({});
      }
    });
  }

  async function getSettings() {
    const r = await storageGet([SETTINGS_KEY]);
    const s = r[SETTINGS_KEY] || {};
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      apiKeys: { ...(s.apiKeys || {}) },
      models: { ...(s.models || {}) },
      baseUrls: { ...(s.baseUrls || {}) },
      transcription: { ...DEFAULT_SETTINGS.transcription, ...(s.transcription || {}) }
    };
  }

  async function saveSettings(settings) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  }

  function resolveProvider(settings, providerId) {
    const id = providerId || settings.provider;
    const def = PROVIDERS[id];
    if (!def) throw new Error(`Unknown AI provider "${id}". Open extension Settings to pick one.`);
    const baseUrl = String(settings.baseUrls[id] || def.baseUrl || "").replace(/\/+$/, "");
    return {
      id,
      def,
      baseUrl,
      apiKey: String(settings.apiKeys[id] || "").trim(),
      model: String(settings.models[id] || def.defaultModel || "").trim()
    };
  }

  function configError(message) {
    return { ok: false, httpStatus: 401, data: { error: { message } }, error: message };
  }

  function checkReady(p) {
    if (!p.baseUrl) return `No API base URL set for ${p.def.label}. Open extension Settings → AI Provider.`;
    if (!p.apiKey && !p.def.keyOptional) return `No API key set for ${p.def.label}. Open extension Settings → AI Provider and paste your key.`;
    if (!p.model) return `No model selected for ${p.def.label}. Open extension Settings → AI Provider.`;
    return null;
  }

  async function readError(res) {
    const text = await res.text().catch(() => "");
    let data = {};
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    const err = Array.isArray(data) ? data[0]?.error : data?.error;
    const message = (typeof err === "string" ? err : err?.message) || data?.message || text.slice(0, 300) || `HTTP ${res.status}`;
    return { data, message };
  }

  // ─── OpenAI-compatible ────────────────────────────────────────────────────

  const OPENAI_REASONING_MODEL = /^(o\d|gpt-5)/i;

  function buildOpenAIBody(p, body) {
    const out = { ...body, model: p.model, stream: false };
    if (p.id === "openai") {
      // Current OpenAI models take max_completion_tokens; reasoning models reject custom temperature.
      if (out.max_tokens != null && out.max_completion_tokens == null) out.max_completion_tokens = out.max_tokens;
      delete out.max_tokens;
      if (OPENAI_REASONING_MODEL.test(p.model)) delete out.temperature;
    } else {
      // Most compatible APIs only understand max_tokens.
      if (out.max_completion_tokens != null && out.max_tokens == null) out.max_tokens = out.max_completion_tokens;
      delete out.max_completion_tokens;
    }
    return out;
  }

  function openAIHeaders(p) {
    const headers = { "Content-Type": "application/json" };
    if (p.apiKey) headers.Authorization = `Bearer ${p.apiKey}`;
    if (p.id === "openrouter") headers["X-Title"] = "WAMarketer";
    return headers;
  }

  // Strips a parameter the provider says it does not support and reports whether a retry is worthwhile.
  function dropRejectedParam(body, message) {
    const m = String(message || "").toLowerCase();
    for (const key of ["temperature", "response_format", "max_completion_tokens", "tool_choice", "parallel_tool_calls"]) {
      if (m.includes(key) && body[key] !== undefined) {
        if (key === "max_completion_tokens") body.max_tokens = body.max_completion_tokens;
        delete body[key];
        return true;
      }
    }
    return false;
  }

  async function openAIChat(p, body) {
    const payload = buildOpenAIBody(p, body);
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${p.baseUrl}/chat/completions`, {
        method: "POST",
        headers: openAIHeaders(p),
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: true, httpStatus: res.status, data };
      }
      const { data, message } = await readError(res);
      if (res.status === 400 && dropRejectedParam(payload, message)) continue;
      return { ok: false, httpStatus: res.status, data: { error: { message } , details: data }, error: message };
    }
    return configError("Provider rejected the request parameters.");
  }

  // ─── Anthropic Messages API ───────────────────────────────────────────────

  // Newer Claude models reject sampling parameters; older ones still accept them.
  const CLAUDE_NO_SAMPLING = /claude-(opus-5|sonnet-5|fable|mythos|opus-4-[78])/i;
  const CLAUDE_EFFORT = /claude-(opus-5|sonnet-5|fable|mythos|opus-4-[5678]|sonnet-4-6)/i;

  function textOf(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map((c) => (typeof c === "string" ? c : c?.text || "")).join("\n");
    return content == null ? "" : String(content);
  }

  function toClaudeContent(content) {
    if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
    if (!Array.isArray(content)) return [{ type: "text", text: textOf(content) }];
    const blocks = [];
    for (const part of content) {
      if (!part) continue;
      if (part.type === "text") {
        if (part.text) blocks.push({ type: "text", text: part.text });
      } else if (part.type === "image_url") {
        const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
        const m = /^data:([^;]+);base64,(.*)$/s.exec(url || "");
        if (m) blocks.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
        else if (url) blocks.push({ type: "image", source: { type: "url", url } });
      }
    }
    return blocks;
  }

  function parseArgs(raw) {
    if (raw && typeof raw === "object") return raw;
    try { return JSON.parse(raw || "{}"); } catch { return {}; }
  }

  function toClaudeRequest(p, body) {
    const system = [];
    const messages = [];
    const push = (role, blocks) => {
      if (!blocks.length) return;
      const last = messages[messages.length - 1];
      if (last && last.role === role) last.content.push(...blocks);
      else messages.push({ role, content: blocks });
    };

    for (const msg of body.messages || []) {
      if (!msg) continue;
      if (msg.role === "system" || msg.role === "developer") {
        const t = textOf(msg.content).trim();
        if (t) system.push(t);
      } else if (msg.role === "assistant") {
        const blocks = toClaudeContent(msg.content);
        for (const tc of msg.tool_calls || []) {
          blocks.push({ type: "tool_use", id: tc.id, name: tc.function?.name, input: parseArgs(tc.function?.arguments) });
        }
        push("assistant", blocks);
      } else if (msg.role === "tool") {
        push("user", [{ type: "tool_result", tool_use_id: msg.tool_call_id, content: textOf(msg.content) || "(empty)" }]);
      } else {
        push("user", toClaudeContent(msg.content));
      }
    }
    if (!messages.length || messages[0].role !== "user") messages.unshift({ role: "user", content: [{ type: "text", text: "(start)" }] });
    // Current models do not accept a trailing assistant turn (prefill).
    if (messages[messages.length - 1].role === "assistant") push("user", [{ type: "text", text: "Continue." }]);

    const wantsJson = body.response_format && body.response_format.type && body.response_format.type !== "text";
    if (wantsJson) system.push("Respond with a single valid JSON object only — no markdown fences, no text before or after it.");

    const requested = body.max_completion_tokens ?? body.max_tokens ?? 1024;
    const req = {
      model: p.model,
      // Adaptive thinking on current models shares this budget, so keep headroom above short reply caps.
      max_tokens: Math.max(Number(requested) || 1024, 4096),
      messages
    };
    if (system.length) req.system = system.join("\n\n");
    if (body.temperature != null && !CLAUDE_NO_SAMPLING.test(p.model)) req.temperature = Math.min(1, Math.max(0, body.temperature));
    if (CLAUDE_EFFORT.test(p.model)) req.output_config = { effort: "low" };

    const tools = (body.tools || []).filter((t) => t && t.type === "function" && t.function);
    if (tools.length) {
      req.tools = tools.map((t) => ({
        name: t.function.name,
        description: t.function.description || "",
        input_schema: t.function.parameters || { type: "object", properties: {} }
      }));
      const tc = body.tool_choice;
      if (tc === "none") req.tool_choice = { type: "none" };
      else if (tc === "required") req.tool_choice = { type: "any" };
      else if (tc && typeof tc === "object" && tc.function?.name) req.tool_choice = { type: "tool", name: tc.function.name };
      if (body.parallel_tool_calls === false) req.tool_choice = { ...(req.tool_choice || { type: "auto" }), disable_parallel_tool_use: true };
    }
    return { req, wantsJson };
  }

  function stripFences(text) {
    const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
    return m ? m[1] : text;
  }

  function fromClaudeResponse(data, wantsJson) {
    const blocks = Array.isArray(data.content) ? data.content : [];
    let text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
    if (wantsJson) text = stripFences(text);
    const toolCalls = blocks.filter((b) => b.type === "tool_use").map((b) => ({
      id: b.id,
      type: "function",
      function: { name: b.name, arguments: JSON.stringify(b.input || {}) }
    }));
    const finish = { end_turn: "stop", stop_sequence: "stop", tool_use: "tool_calls", max_tokens: "length", refusal: "content_filter" }[data.stop_reason] || "stop";
    const message = { role: "assistant", content: text || (toolCalls.length ? null : "") };
    if (toolCalls.length) message.tool_calls = toolCalls;
    const inTok = data.usage?.input_tokens || 0;
    const outTok = data.usage?.output_tokens || 0;
    return {
      id: data.id,
      object: "chat.completion",
      model: data.model,
      choices: [{ index: 0, message, finish_reason: finish }],
      usage: { prompt_tokens: inTok, completion_tokens: outTok, total_tokens: inTok + outTok }
    };
  }

  function anthropicHeaders(p) {
    return {
      "Content-Type": "application/json",
      "x-api-key": p.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    };
  }

  async function anthropicChat(p, body) {
    const { req, wantsJson } = toClaudeRequest(p, body);
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${p.baseUrl}/messages`, { method: "POST", headers: anthropicHeaders(p), body: JSON.stringify(req) });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: true, httpStatus: res.status, data: fromClaudeResponse(data, wantsJson) };
      }
      const { data, message } = await readError(res);
      if (res.status === 400) {
        const m = message.toLowerCase();
        if (m.includes("temperature") && req.temperature !== undefined) { delete req.temperature; continue; }
        if ((m.includes("effort") || m.includes("output_config")) && req.output_config) { delete req.output_config; continue; }
        if (m.includes("tool_choice") && req.tool_choice) { delete req.tool_choice; continue; }
      }
      return { ok: false, httpStatus: res.status, data: { error: { message }, details: data }, error: message };
    }
    return configError("Anthropic rejected the request parameters.");
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  async function chatCompletion(body, opts = {}) {
    try {
      if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
        return { ok: false, httpStatus: 400, data: {}, error: "messages is required" };
      }
      const settings = opts.settings || (await getSettings());
      const p = resolveProvider(settings, opts.provider);
      const notReady = checkReady(p);
      if (notReady) return configError(notReady);
      return p.def.kind === "anthropic" ? await anthropicChat(p, body) : await openAIChat(p, body);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, httpStatus: 500, data: { error: { message } }, error: `AI request failed: ${message}` };
    }
  }

  // "auto" uses the chat provider when it can transcribe, else any Whisper provider that has a key.
  function transcriptionProviderId(settings) {
    const chosen = settings.transcription.provider;
    if (chosen === "off") return null;
    if (chosen && chosen !== "auto") return chosen;
    return TRANSCRIPTION_PROVIDERS.includes(settings.provider) ? settings.provider
      : TRANSCRIPTION_PROVIDERS.find((id) => settings.apiKeys[id]) || "openai";
  }

  function resolveTranscription(settings) {
    const providerId = transcriptionProviderId(settings);
    if (!providerId) return null;
    const p = resolveProvider(settings, providerId);
    p.model = settings.transcription.model || PROVIDERS[providerId].transcription?.model || "whisper-1";
    return p;
  }

  async function transcribe(formData) {
    try {
      const settings = await getSettings();
      const p = resolveTranscription(settings);
      if (!p) return { ok: false, httpStatus: 400, error: "Voice transcription is turned off in extension Settings." };
      if (!p.apiKey && !p.def.keyOptional) {
        return { ok: false, httpStatus: 401, error: `Voice transcription needs a ${p.def.label} API key. Add one in extension Settings → Voice transcription.` };
      }
      formData.set("model", p.model);
      const language = String(settings.transcription.language || "").trim().toLowerCase();
      if (!TRANSCRIPTION_LANGUAGES.has(language)) {
        return { ok: false, httpStatus: 400, error: `Selected transcription language "${language}" is not supported.` };
      }
      if (language) formData.set("language", language);
      else if (typeof formData.delete === "function") formData.delete("language");
      const headers = {};
      if (p.apiKey) headers.Authorization = `Bearer ${p.apiKey}`;
      const res = await fetch(`${p.baseUrl}/audio/transcriptions`, { method: "POST", headers, body: formData });
      if (!res.ok) {
        const { data, message } = await readError(res);
        return { ok: false, httpStatus: res.status, error: message, data };
      }
      return { ok: true, data: await res.json().catch(() => ({})) };
    } catch (e) {
      return { ok: false, httpStatus: 500, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function listModels(settings, providerId) {
    const p = resolveProvider(settings, providerId);
    if (!p.baseUrl) throw new Error("Set the API base URL first.");
    const headers = p.def.kind === "anthropic" ? anthropicHeaders(p) : openAIHeaders(p);
    delete headers["Content-Type"];
    const res = await fetch(`${p.baseUrl}/models${p.def.kind === "anthropic" ? "?limit=100" : ""}`, { headers });
    if (!res.ok) throw new Error((await readError(res)).message);
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.data || data.models || [];
    return list.map((m) => String(m.id || m.name || "").replace(/^models\//, "")).filter(Boolean).sort();
  }

  async function testConnection(settings, providerId) {
    const started = Date.now();
    const result = await chatCompletion(
      { messages: [{ role: "user", content: "Reply with the single word: OK" }], max_completion_tokens: 20, temperature: 0 },
      { settings, provider: providerId }
    );
    if (!result.ok) return { ok: false, error: result.error };
    const reply = result.data?.choices?.[0]?.message?.content || "";
    return { ok: true, reply: String(reply).trim().slice(0, 80), ms: Date.now() - started };
  }

  async function isConfigured() {
    const settings = await getSettings();
    try {
      return !checkReady(resolveProvider(settings));
    } catch {
      return false;
    }
  }

  async function describe() {
    const settings = await getSettings();
    const p = resolveProvider(settings);
    return { provider: p.id, label: p.def.label, model: p.model, configured: !checkReady(p) };
  }

  global.DownlabsAI = {
    SETTINGS_KEY,
    PROVIDERS,
    TRANSCRIPTION_PROVIDERS,
    getSettings,
    saveSettings,
    chatCompletion,
    transcribe,
    listModels,
    testConnection,
    transcriptionProviderId,
    isConfigured,
    describe
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
