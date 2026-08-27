/*
  Project detail page — scroll-linked accordion (see docs/ia-detail.md
  §一). One .detail-accordion-panel open at a time, driven by TWO
  inputs that both just call the same setActive(index):

  1. Scroll: an IntersectionObserver watches each .detail-media-group
     for a thin horizontal band centered in the viewport (rootMargin
     "-45% 0px -45% 0px" — a 0-height line at 50% would also work, but
     a thin band is less prone to firing zero times on very fast/large
     scroll jumps). Whichever group is crossing that band right now is
     "the section you're looking at", so its accordion entry opens.

  2. Click: clicking a (possibly closed) trigger scrolls its matching
     media group to viewport-center and expands it immediately, rather
     than waiting for the observer to notice — otherwise there'd be a
     beat of the OLD section still shown while the page is mid-scroll.
     The observer is briefly suppressed during that programmatic
     scroll so it can't fight the click by snapping back to whatever
     section happens to be passing through center along the way.

  Works unchanged at every breakpoint, including the mobile stack
  (css/detail.css's own media query) — this only ever references
  .detail-media-group/.detail-accordion-trigger/.detail-accordion-panel
  by their DOM relationship (matching index), never their on-screen
  position, so it doesn't care whether the CSS currently renders them
  as two columns or one.
*/
(function () {
  var reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  var accordion = document.querySelector(".detail-accordion");
  var right = document.querySelector(".detail-right");
  if (!accordion || !right) return;

  var triggers = Array.prototype.slice.call(
    accordion.querySelectorAll(".detail-accordion-trigger")
  );
  var panels = Array.prototype.slice.call(
    accordion.querySelectorAll(".detail-accordion-panel")
  );
  var mediaGroups = Array.prototype.slice.call(
    right.querySelectorAll(".detail-media-group")
  );
  if (!triggers.length || !mediaGroups.length) return;

  var activeIndex = -1;
  var suppressObserver = false;
  var resumeTimer = null;

  function setActive(index) {
    if (index === activeIndex) return;
    activeIndex = index;
    triggers.forEach(function (trigger, i) {
      var open = i === index;
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
      panels[i].classList.toggle("is-open", open);
      panels[i].setAttribute("aria-hidden", open ? "false" : "true");
    });
  }

  triggers.forEach(function (trigger, i) {
    trigger.addEventListener("click", function () {
      var target = mediaGroups[i];
      if (!target) return;
      suppressObserver = true;
      clearTimeout(resumeTimer);
      target.scrollIntoView({
        behavior: reduceMotionQuery.matches ? "auto" : "smooth",
        block: "center",
      });
      setActive(i);
      // Smooth scrolling to a far-off section takes a while — release
      // the suppression only once it's had time to actually arrive,
      // not on the next tick.
      resumeTimer = setTimeout(
        function () {
          suppressObserver = false;
        },
        reduceMotionQuery.matches ? 50 : 900
      );
    });
  });

  var observer = new IntersectionObserver(
    function (entries) {
      if (suppressObserver) return;
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var index = mediaGroups.indexOf(entry.target);
        if (index !== -1) setActive(index);
      });
    },
    { root: null, rootMargin: "-45% 0px -45% 0px", threshold: 0 }
  );
  mediaGroups.forEach(function (group) {
    observer.observe(group);
  });

  // Matches the panel-1-open markup already in the HTML (see each
  // detail page) — this just brings the trigger/panel ARIA state in
  // sync with that on load, without re-triggering the transition.
  setActive(0);
})();
