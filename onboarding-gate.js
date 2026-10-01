/*
 * WAMarketer — keeps the CRM dashboard closed until onboarding is finished.
 * Loaded first in crm/index.html. Whether the dashboard is opened from the popup, the WhatsApp
 * sidebar or by typing its address, an unfinished setup goes to welcome.html, which comes back
 * to the same dashboard page (?next=#/…) once the user finishes.
 */
(function () {
  "use strict";
  if (window.top !== window) return; // pages embedded in the dashboard are never redirected

  const root = document.documentElement;
  root.style.visibility = "hidden"; // no flash of the dashboard before the check
  const reveal = () => { root.style.visibility = ""; };
  const failSafe = setTimeout(reveal, 2500);

  try {
    chrome.storage.local.get(["wamOnboarding"], (r) => {
      const done = !!(r && r.wamOnboarding && r.wamOnboarding.completedAt);
      if (done) {
        clearTimeout(failSafe);
        reveal();
        return;
      }
      const next = location.hash && location.hash !== "#/" ? location.hash : "";
      const params = new URLSearchParams({ from: "dashboard" });
      if (next) params.set("next", next);
      location.replace(chrome.runtime.getURL(`welcome.html?${params}`));
    });
  } catch {
    clearTimeout(failSafe);
    reveal();
  }
})();
