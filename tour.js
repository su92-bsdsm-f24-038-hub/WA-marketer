/*
 * WAMarketer — small guided-tour engine (coach marks). Used by the Bulk Sender (bulk.js).
 *
 *   WAMTour.start([{ target: "#el" | () => el | null, title, text, action: { label, run } }], { onEnd(reason) })
 *
 * A step without a target (or whose target is missing or hidden) is shown centred. The rest of
 * the page is dimmed and blocked while the tour runs. Keys: → / Enter next, ← back, Esc skip.
 */
(function (global) {
  "use strict";

  let active = null;

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  }

  function resolve(target) {
    const el = typeof target === "function" ? target() : typeof target === "string" ? document.querySelector(target) : target;
    return visible(el) ? el : null;
  }

  function start(steps, opts = {}) {
    if (active) active.end("replaced");
    let index = 0;
    const prevFocus = document.activeElement;

    const root = document.createElement("div");
    root.className = "wt-root";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "wt-title");
    root.innerHTML = `
      <div class="wt-shade"></div>
      <div class="wt-spot" aria-hidden="true"></div>
      <div class="wt-pop" tabindex="-1">
        <div class="wt-count"></div>
        <h3 id="wt-title" class="wt-title"></h3>
        <p class="wt-text"></p>
        <div class="wt-actions">
          <button type="button" class="wt-btn wt-skip">Skip tour</button>
          <span class="wt-nav">
            <button type="button" class="wt-btn wt-back">Back</button>
            <button type="button" class="wt-btn wt-extra" hidden></button>
            <button type="button" class="wt-btn wt-next">Next</button>
          </span>
        </div>
      </div>`;
    document.body.appendChild(root);
    const $ = (s) => root.querySelector(s);
    const shade = $(".wt-shade"), spot = $(".wt-spot"), pop = $(".wt-pop");

    let target = null;
    let raf = 0;

    function place() {
      const vw = window.innerWidth, vh = window.innerHeight, gap = 12, pad = 6;
      pop.style.maxWidth = `${Math.min(340, vw - 24)}px`;
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      if (!target) {
        spot.hidden = true;
        shade.hidden = false;
        pop.style.left = `${Math.max(12, (vw - pw) / 2)}px`;
        pop.style.top = `${Math.max(12, (vh - ph) / 2)}px`;
        pop.dataset.side = "center";
        return;
      }
      shade.hidden = true;
      spot.hidden = false;
      const r = target.getBoundingClientRect();
      const top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad);
      const bottom = Math.min(vh - 4, r.bottom + pad), right = Math.min(vw - 4, r.right + pad);
      Object.assign(spot.style, { top: `${top}px`, left: `${left}px`, width: `${Math.max(0, right - left)}px`, height: `${Math.max(0, bottom - top)}px` });
      let y, side;
      if (bottom + gap + ph <= vh - 8) { y = bottom + gap; side = "below"; }
      else if (top - gap - ph >= 8) { y = top - gap - ph; side = "above"; }
      else { y = Math.max(8, vh - ph - 8); side = "over"; }
      const x = Math.min(Math.max(12, r.left + r.width / 2 - pw / 2), vw - pw - 12);
      pop.style.left = `${x}px`;
      pop.style.top = `${y}px`;
      pop.dataset.side = side;
    }

    function schedule() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    }

    function show(i) {
      index = i;
      const step = steps[index];
      target = step.target ? resolve(step.target) : null;
      // Tall sections scroll to their top so the heading stays in view; the card then sits over their lower part.
      if (target) target.scrollIntoView({ block: target.getBoundingClientRect().height > window.innerHeight * 0.55 ? "start" : "center" });
      $(".wt-count").textContent = `${index + 1} of ${steps.length}`;
      $(".wt-title").textContent = step.title || "";
      $(".wt-text").textContent = step.text || "";
      $(".wt-back").hidden = index === 0;
      const last = index === steps.length - 1;
      $(".wt-next").textContent = last ? (step.doneLabel || "Done") : "Next";
      $(".wt-skip").hidden = last;
      const extra = $(".wt-extra");
      extra.hidden = !step.action;
      if (step.action) extra.textContent = step.action.label;
      place();
      requestAnimationFrame(place); // after scrollIntoView settles
      pop.focus({ preventScroll: true });
    }

    function end(reason) {
      if (!active || active.root !== root) return;
      active = null;
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      document.removeEventListener("keydown", onKey, true);
      root.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
      opts.onEnd && opts.onEnd(reason);
    }

    function next() { index < steps.length - 1 ? show(index + 1) : end("done"); }
    function back() { if (index > 0) show(index - 1); }

    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); end("skip"); }
      else if (e.key === "ArrowRight" || (e.key === "Enter" && e.target === pop)) { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
      else if (e.key === "Tab") {
        // Keep focus inside the tour card.
        const items = Array.from(pop.querySelectorAll("button:not([hidden])"));
        if (!items.length) return;
        const i = items.indexOf(document.activeElement);
        e.preventDefault();
        items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
      }
    }

    $(".wt-next").addEventListener("click", next);
    $(".wt-back").addEventListener("click", back);
    $(".wt-skip").addEventListener("click", () => end("skip"));
    $(".wt-extra").addEventListener("click", () => {
      const action = steps[index].action;
      end("action");
      action && action.run && action.run();
    });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    document.addEventListener("keydown", onKey, true);

    active = { root, end };
    show(0);
    return { end: () => end("closed") };
  }

  global.WAMTour = { start, get running() { return !!active; } };
})(typeof globalThis !== "undefined" ? globalThis : self);
