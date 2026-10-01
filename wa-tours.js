/*
 * WAMarketer — first-time tutorials inside WhatsApp Web (content script, uses tour.js).
 *
 *   intro        the first time the WAMarketer sidebar appears: header filters, CRM/Marketing
 *                switch, sidebar tabs, Home panel, plan chip, resizing
 *   sidebar tab  the first time each sidebar tab (AI agent, Timeline, …) is opened
 *   campaigns    the first time the header's Campaigns filter is clicked
 *
 * Each tour is shown once; what has been seen is kept in chrome.storage (wamWaTours).
 */
(function () {
  "use strict";
  if (window.__wamWaTours) return;
  window.__wamWaTours = true;

  const KEY = "wamWaTours";
  const $ = (sel) => document.querySelector(sel);
  const shown = (el) => !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;

  const TAB_TOURS = {
    ai: [{ target: "#smartdm-panel-ai", title: "AI agent", text: "Turn AI auto-replies on or off, pick the default agent and who it answers (your CRM contacts or everyone), pause it for 30 minutes, and try replies in the preview chat before customers see them." }],
    activity: [{ target: "#smartdm-panel-activity", title: "Timeline", text: "Everything that happened with the open contact, newest first: messages, flows and campaigns. Use the filters to show just one kind." }],
    templates: [{ target: "#smartdm-panel-templates", title: "Templates", text: "Quick replies you can drop into the chat. Search them, or create new ones by category. Write [name] and [phone] and they're filled in for each contact." }],
    message: [{ target: "#smartdm-panel-message", title: "Send a message", text: "Message any phone number, even someone you don't have a chat with yet. Include the country code." }],
    translate: [{ target: "#smartdm-panel-translate", title: "Auto-translate", text: "Translate messages into your language, and turn on auto-translate for new ones. You can also click the Aa icon next to any message to translate just that one." }],
    crm: [{ target: "#smartdm-panel-crm", title: "CRM details", text: "Calendar bookings, active flows and the CRM record for the open chat. Open a chat to see its details here." }],
    home: [{ target: "#smartdm-panel-home", title: "Home", text: "The AI reply switch, plus the open chat's contact card: pipeline stage, tags, notes & tasks, and follow-ups." }]
  };

  function introSteps() {
    return [
      { title: "WAMarketer is ready", text: "Here's a quick look at what's been added to WhatsApp Web. Each tab also explains itself the first time you open it." },
      { target: "#smartdm-chat-tabs", title: "Smart chat filters", text: "Filter your chats: Unread, Awaiting Reply, Needs Reply, Auto Replied, and Campaigns for people you've messaged in a campaign. Add your own tab with +, and use the gear to manage tabs." },
      { target: "#dl-mode-switch", title: "CRM or Marketing", text: "CRM shows tools for the open chat. Marketing opens the Bulk Sender right here, for campaigns and follow-ups." },
      { target: () => { const home = $("#smartdm-tab-home"); return home && home.parentElement; }, title: "Sidebar tabs", text: "Home, AI agent, Timeline, Templates, Send message, Auto-translate and CRM details. Hover an icon to see its name." },
      { target: "#smartdm-panel-home", title: "Home", text: "Switch AI replies on or off, and see the open chat's contact card: pipeline stage, tags, notes & tasks, and follow-ups." },
      { target: "#dl-plan-chip", title: "Your plan", text: "Shows your trial time or today's free messages. Click it to see plans." },
      { target: "#dl-sidebar-resizer", title: "Make it yours", text: "Drag the sidebar's left edge to resize it. Double-click the edge to reset.", doneLabel: "Start using WAMarketer" }
    ];
  }

  const CAMPAIGNS_TOUR = [{ target: '#smartdm-chat-tabs [data-tab-id="campaigns"]', title: "Campaign chats", text: "Shows only chats with people from your campaigns. Pick a campaign to narrow the list down, so replies to your campaigns are easy to find." }];

  let seen = null;
  async function loadSeen() {
    if (seen) return seen;
    try { seen = (await chrome.storage.local.get([KEY]))[KEY] || {}; } catch { seen = {}; }
    return seen;
  }
  async function markSeen(id) {
    const s = await loadSeen();
    s[id] = Date.now();
    try { await chrome.storage.local.set({ [KEY]: s }); } catch {}
  }

  /** Runs a tour once. Steps whose target isn't on screen are left out (a step without a target always stays). */
  async function runOnce(id, steps, alsoMark = []) {
    if (!window.WAMTour || window.WAMTour.running) return false;
    if ((await loadSeen())[id]) return false;
    const usable = steps.filter((st) => {
      if (!st.target) return true;
      const el = typeof st.target === "function" ? st.target() : $(st.target);
      return shown(el);
    });
    if (!usable.length) return false;
    window.WAMTour.start(usable, { onEnd: async () => { for (const other of alsoMark) await markSeen(other); await markSeen(id); } });
    return true;
  }

  // Sidebar tabs and the header's Campaigns filter: first click.
  document.addEventListener("click", (e) => {
    const tab = e.target.closest && e.target.closest(".sdm-tab-btn[id^='smartdm-tab-']");
    if (tab) {
      const name = tab.id.replace("smartdm-tab-", "");
      if (TAB_TOURS[name]) setTimeout(() => runOnce(`tab:${name}`, TAB_TOURS[name]), 350);
      return;
    }
    const campaigns = e.target.closest && e.target.closest('#smartdm-chat-tabs [data-tab-id="campaigns"]');
    if (campaigns) setTimeout(() => runOnce("header:campaigns", CAMPAIGNS_TOUR), 600);
  }, true);

  // Intro: once the sidebar (and WhatsApp's chat list) is on screen.
  let introTimer = null;
  function checkIntro() {
    if (introTimer || !shown($("#smartdm-sidebar")) || !$("#smartdm-tab-home") || !$("#dl-mode-switch")) return;
    introTimer = setTimeout(async () => {
      const started = await runOnce("intro", introSteps(), ["tab:home"]);
      if (started || (await loadSeen()).intro) stopWatching();
      introTimer = null;
    }, 2000);
  }
  // The sidebar is added to <body>; its CRM/Marketing switch follows a moment later, so also re-check on a timer.
  const observer = new MutationObserver(checkIntro);
  let poll = null;
  function stopWatching() {
    observer.disconnect();
    clearInterval(poll);
  }
  loadSeen().then((s) => {
    if (s.intro) return;
    observer.observe(document.body, { childList: true });
    poll = setInterval(checkIntro, 3000);
    checkIntro();
  });

  // Replay from the console or other scripts: WAMWaTours.reset()
  window.WAMWaTours = { async reset() { seen = {}; await chrome.storage.local.remove(KEY); } };
})();
