(function () {
  var currentScope = null;
  var rafId = 0;

  function getHashPath() {
    var hash = window.location.hash || "";
    if (!hash) {
      return "/";
    }

    var raw = hash.charAt(0) === "#" ? hash.slice(1) : hash;
    var path = raw.split("?")[0].split("&")[0];
    if (!path) {
      return "/";
    }

    if (path.charAt(0) !== "/") {
      path = "/" + path;
    }

    path = path.replace(/\/+$/, "");
    return path || "/";
  }

  function isDashboardRoute() {
    return getHashPath() === "/dashboard";
  }

  function clearDecorations() {
    document.querySelectorAll(".premium-surface").forEach(function (node) {
      node.classList.remove("premium-surface");
      node.style.removeProperty("--card-delay");
    });

    document.querySelectorAll(".premium-button").forEach(function (node) {
      node.classList.remove("premium-button");
    });

    document.querySelectorAll(".premium-table").forEach(function (node) {
      node.classList.remove("premium-table");
    });
  }

  function clearScopeClasses() {
    if (currentScope && currentScope.classList) {
      currentScope.classList.remove("crm-dashboard-root");
    }

    currentScope = null;
    clearDecorations();
  }

  function findDashboardScope(anchor) {
    var scope = anchor.closest("[class*='max-w-'], [class*='px-6'], [class*='p-6']");
    if (scope) {
      return scope;
    }

    var walker = anchor;
    for (var i = 0; i < 6 && walker; i += 1) {
      if (walker.classList && walker.classList.length > 0) {
        return walker;
      }
      walker = walker.parentElement;
    }

    return anchor.parentElement || anchor;
  }

  function decorateDashboard(scope) {
    var cards = scope.querySelectorAll(".bg-white.rounded-xl, .bg-white.rounded-2xl, .bg-white.rounded-lg, .card");
    cards.forEach(function (card, index) {
      card.classList.add("premium-surface");
      card.style.setProperty("--card-delay", String(Math.min(index, 12) * 45) + "ms");
    });

    scope.querySelectorAll("button").forEach(function (button) {
      button.classList.add("premium-button");
    });

    scope.querySelectorAll("table").forEach(function (table) {
      table.classList.add("premium-table");
    });
  }

  function applyDashboardTheme() {
    var enabled = isDashboardRoute();
    document.body.classList.toggle("route-dashboard", enabled);

    if (!enabled) {
      clearScopeClasses();
      return;
    }

    var anchor =
      document.querySelector("[data-crm-tour='dashboard-stats']") ||
      document.querySelector("[data-crm-tour='dashboard-period']") ||
      document.querySelector("[data-crm-tour='dashboard-refresh']");

    if (!anchor) {
      return;
    }

    var nextScope = findDashboardScope(anchor);

    if (currentScope && currentScope !== nextScope && currentScope.classList) {
      currentScope.classList.remove("crm-dashboard-root");
    }

    clearDecorations();
    currentScope = nextScope;
    currentScope.classList.add("crm-dashboard-root");
    decorateDashboard(currentScope);
  }

  function scheduleApply() {
    if (rafId) {
      cancelAnimationFrame(rafId);
    }

    rafId = requestAnimationFrame(function () {
      rafId = 0;
      applyDashboardTheme();
    });
  }

  window.addEventListener("hashchange", scheduleApply, { passive: true });
  window.addEventListener("popstate", scheduleApply, { passive: true });

  var root = document.getElementById("root");
  if (root && typeof MutationObserver !== "undefined") {
    var observer = new MutationObserver(scheduleApply);
    observer.observe(root, { childList: true, subtree: true });
  }

  scheduleApply();
})();
