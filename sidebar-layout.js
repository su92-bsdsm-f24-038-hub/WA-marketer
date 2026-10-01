/*
 * WAMarketer — sidebar layout (content script on web.whatsapp.com).
 *
 * Adds to the Downlabs sidebar built by content.js:
 *   - a drag handle on its left edge to resize it (double-click resets), and
 *   - a "CRM | Marketing" switch; Marketing shows the Bulk Sender inside the sidebar.
 * Mode and a width per mode are remembered in chrome.storage.
 */
(function () {
  "use strict";
  if (window.__downlabsSidebarLayout) return;
  window.__downlabsSidebarLayout = true;

  const STORE_KEY = "downlabsSidebarUi";
  const DEFAULT_WIDTH = { crm: 350, marketing: 520 };
  const MIN_WIDTH = 300;
  const MIN_WHATSAPP_WIDTH = 480; // keep WhatsApp itself usable
  const LABELS = {
    en: { crm: "CRM", marketing: "Marketing", expand: "Open Bulk Sender full screen", resize: "Drag to resize · double-click to reset" }
  };

  let ui = { mode: "crm", widths: { ...DEFAULT_WIDTH } };
  let labels = LABELS.en;

  const clampWidth = (w) => Math.round(Math.max(MIN_WIDTH, Math.min(w, window.innerWidth - MIN_WHATSAPP_WIDTH, 1100)));

  function applyWidth(width) {
    document.documentElement.style.setProperty("--dl-sidebar-w", `${clampWidth(width)}px`);
  }

  function save() {
    chrome.storage.local.set({ [STORE_KEY]: ui }).catch(() => {});
  }

  function injectStyles() {
    if (document.getElementById("dl-sidebar-layout-style")) return;
    const style = document.createElement("style");
    style.id = "dl-sidebar-layout-style";
    // Loaded after content.js's stylesheet, so these !important rules take precedence.
    style.textContent = `
      /* Higher specificity than content.js's "#app" rule, so it wins whichever loads first. */
      html body #app { width: calc(100vw - var(--dl-sidebar-w, 350px)) !important; }
      html body #smartdm-sidebar { width: var(--dl-sidebar-w, 350px) !important; }
      #dl-sidebar-resizer {
        position: fixed; top: 0; height: 100vh; width: 10px; z-index: 1001;
        right: calc(var(--dl-sidebar-w, 350px) - 5px); cursor: col-resize; touch-action: none;
      }
      #dl-sidebar-resizer::after {
        content: ""; position: absolute; top: 50%; left: 3px; width: 4px; height: 44px; margin-top: -22px;
        border-radius: 4px; background: #cbd5e1; opacity: 0; transition: opacity .15s, background .15s;
      }
      #dl-sidebar-resizer:hover::after, #dl-sidebar-resizer.dragging::after { opacity: 1; background: #25d366; }
      #dl-resize-shield { position: fixed; inset: 0; z-index: 100000; cursor: col-resize; }
      .dl-resizing, .dl-resizing * { user-select: none !important; }

      #dl-mode-row { display: flex; align-items: center; gap: 8px; padding: 0 18px 12px; }
      #dl-mode-switch { flex: 1; display: flex; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 10px; padding: 3px; }
      #dl-mode-switch button {
        flex: 1; border: 0; background: transparent; padding: 7px 8px; border-radius: 8px; cursor: pointer;
        font-size: 13px !important; color: #64748b; display: flex; align-items: center; justify-content: center; gap: 6px;
      }
      #dl-mode-switch button[aria-pressed="true"] { background: #fff; color: #0f172a; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
      #dl-mode-switch button[data-mode="marketing"][aria-pressed="true"] { color: #128c7e; }
      #dl-expand-bulk {
        width: 36px; height: 36px; border-radius: 10px; border: 1px solid #e2e8f0; background: #fff; cursor: pointer;
        display: none; align-items: center; justify-content: center; color: #475569; flex-shrink: 0;
      }
      #dl-plan-chip {
        height: 36px; padding: 0 10px; border-radius: 10px; border: 1px solid #e2e8f0; background: #fff; cursor: pointer;
        display: none; align-items: center; gap: 5px; font-size: 12px !important; font-weight: 600; white-space: nowrap; flex-shrink: 0; color: #128c7e;
      }
      #dl-plan-chip.show { display: inline-flex; }
      #dl-plan-chip.free { color: #8a5a00; background: #fff7e0; border-color: #f5dfa3; }
      #dl-plan-chip.out { color: #b42318; background: #fdecea; border-color: #f7c6c1; }
      #dl-plan-chip.pro { color: #fff; background: linear-gradient(135deg, #075e54, #128c7e); border-color: transparent; }
      #dl-expand-bulk:hover { color: #128c7e; border-color: #25d366; }

      #smartdm-sidebar.dl-marketing { display: flex !important; flex-direction: column; overflow: hidden !important; }
      #smartdm-sidebar.dl-marketing > :first-child { flex: none; }
      #smartdm-sidebar.dl-marketing > :not(:first-child):not(#dl-marketing-panel) { display: none !important; }
      #smartdm-sidebar.dl-marketing .dl-crm-tabs { display: none !important; }
      #smartdm-sidebar.dl-marketing #dl-expand-bulk { display: flex; }
      #dl-marketing-panel { display: none; flex: 1; min-height: 0; background: #f8fafc; }
      #smartdm-sidebar.dl-marketing #dl-marketing-panel { display: block; }
      #dl-marketing-panel iframe { width: 100%; height: 100%; border: 0; display: block; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ─── resizing ─────────────────────────────────────────────────────────────

  function addResizer() {
    if (document.getElementById("dl-sidebar-resizer")) return;
    const handle = document.createElement("div");
    handle.id = "dl-sidebar-resizer";
    handle.title = labels.resize;
    document.body.appendChild(handle);

    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handle.classList.add("dragging");
      document.documentElement.classList.add("dl-resizing");
      // Covers iframes (Bulk Sender) so they don't swallow pointer events mid-drag.
      const shield = document.createElement("div");
      shield.id = "dl-resize-shield";
      document.body.appendChild(shield);
      const move = (ev) => applyWidth(window.innerWidth - ev.clientX);
      const up = () => {
        shield.remove();
        handle.classList.remove("dragging");
        document.documentElement.classList.remove("dl-resizing");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        ui.widths[ui.mode] = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--dl-sidebar-w"), 10) || DEFAULT_WIDTH[ui.mode];
        save();
        window.dispatchEvent(new Event("resize")); // let WhatsApp re-measure its layout
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });

    handle.addEventListener("dblclick", () => {
      ui.widths[ui.mode] = DEFAULT_WIDTH[ui.mode];
      applyWidth(ui.widths[ui.mode]);
      save();
      window.dispatchEvent(new Event("resize"));
    });

    window.addEventListener("resize", () => applyWidth(ui.widths[ui.mode]));
  }

  // ─── CRM / Marketing mode ─────────────────────────────────────────────────

  const ICONS = {
    crm: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    marketing: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 11-5.8-1.6"/></svg>',
    expand: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>'
  };

  function addModeSwitch(sidebar) {
    if (document.getElementById("dl-mode-row")) return;
    const header = sidebar.firstElementChild;
    const logoRow = header && header.firstElementChild;
    const tabs = sidebar.querySelector("#smartdm-tab-home")?.parentElement;
    if (!header || !logoRow) return;
    if (tabs) tabs.classList.add("dl-crm-tabs");

    const row = document.createElement("div");
    row.id = "dl-mode-row";
    const sw = document.createElement("div");
    sw.id = "dl-mode-switch";
    sw.setAttribute("role", "group");
    for (const mode of ["crm", "marketing"]) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.mode = mode;
      b.innerHTML = ICONS[mode];
      b.append(document.createTextNode(labels[mode]));
      b.addEventListener("click", () => setMode(mode));
      sw.append(b);
    }
    const expand = document.createElement("button");
    expand.id = "dl-expand-bulk";
    expand.type = "button";
    expand.title = labels.expand;
    expand.innerHTML = ICONS.expand;
    expand.addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_BULK_SENDER" }).catch(() => {}));
    const chip = document.createElement("button");
    chip.id = "dl-plan-chip";
    chip.type = "button";
    chip.addEventListener("click", () => chrome.runtime.sendMessage({ type: "WAM_OPEN_PLANS" }).catch(() => {}));
    row.append(sw, chip, expand);
    refreshPlanChip();
    logoRow.insertAdjacentElement("afterend", row);

    const panel = document.createElement("div");
    panel.id = "dl-marketing-panel";
    sidebar.appendChild(panel);
  }

  function ensureBulkFrame() {
    const panel = document.getElementById("dl-marketing-panel");
    if (!panel || panel.querySelector("iframe")) return;
    const frame = document.createElement("iframe");
    frame.src = chrome.runtime.getURL("bulk.html?embedded=1&compact=1");
    frame.title = "Bulk Sender";
    frame.allow = "clipboard-write";
    panel.appendChild(frame);
  }

  function setMode(mode, persist = true) {
    const sidebar = document.getElementById("smartdm-sidebar");
    if (!sidebar) return;
    ui.mode = mode === "marketing" ? "marketing" : "crm";
    sidebar.classList.toggle("dl-marketing", ui.mode === "marketing");
    document.querySelectorAll("#dl-mode-switch button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === ui.mode)));
    if (ui.mode === "marketing") ensureBulkFrame();
    else sidebar.scrollTop = 0;
    applyWidth(ui.widths[ui.mode] || DEFAULT_WIDTH[ui.mode]);
    window.dispatchEvent(new Event("resize"));
    if (persist) save();
  }

  // ─── plan chip (trial time / free messages left / Pro) ─────────────────────

  async function refreshPlanChip(retry = true) {
    const chip = document.getElementById("dl-plan-chip");
    if (!chip) return;
    let s = null;
    try { s = await chrome.runtime.sendMessage({ type: "WAM_LICENSE_STATUS" }); } catch {}
    if (!s || !s.plan) {
      chip.className = "";
      // The background worker may still be starting up; ask once more shortly.
      if (retry) setTimeout(() => refreshPlanChip(false), 2000);
      return;
    }
    if (s.plan === "pro") {
      chip.textContent = "PRO";
      chip.title = "Pro — unlimited messages";
      chip.className = "show pro";
    } else if (s.plan === "trial") {
      const h = Math.floor(s.trialMsLeft / 3600000);
      chip.textContent = h >= 1 ? `Trial ${h}h` : `Trial ${Math.max(1, Math.floor(s.trialMsLeft / 60000))}m`;
      chip.title = "Free trial — unlimited messages. Click to see plans.";
      chip.className = "show";
    } else {
      chip.textContent = `${s.remainingToday}/${s.dailyLimit}`;
      chip.title = `Free plan — ${s.remainingToday} of ${s.dailyLimit} messages left today. Click to ${s.trialAvailable ? "start your free trial or " : ""}upgrade.`;
      chip.className = s.remainingToday > 0 ? "show free" : "show out";
    }
  }

  setInterval(() => refreshPlanChip(), 60000);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.wamLicense || changes.wamUsage)) refreshPlanChip();
  });

  // ─── init ─────────────────────────────────────────────────────────────────

  function enhance(sidebar) {
    injectStyles();
    addResizer();
    addModeSwitch(sidebar);
    setMode(ui.mode, false);
  }

  async function init() {
    try {
      const s = await chrome.storage.local.get([STORE_KEY, "locale"]);
      const saved = s[STORE_KEY] || {};
      ui = { mode: saved.mode === "marketing" ? "marketing" : "crm", widths: { ...DEFAULT_WIDTH, ...(saved.widths || {}) } };
      labels = LABELS.en;
    } catch {}
    injectStyles();
    applyWidth(ui.widths[ui.mode]);

    // content.js appends the (already filled) sidebar to <body> once its settings load; it may
    // also rebuild it later, so keep watching and enhance whenever our controls are missing.
    const check = () => {
      const sidebar = document.getElementById("smartdm-sidebar");
      if (sidebar && sidebar.querySelector("#smartdm-tab-home") && !document.getElementById("dl-mode-row")) enhance(sidebar);
    };
    check();
    new MutationObserver(check).observe(document.body, { childList: true });
  }


  init();
})();
