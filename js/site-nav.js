/*
  Nav starts fully transparent (see css/home.css .site-nav) so it reads
  as light chrome over the hero instead of a bar cutting across it. This
  just toggles .is-scrolled once the page has moved a little, which is
  what brings back the translucent-chip background for readability once
  there's real content (not just the hero composition) behind the nav.
*/
(function () {
  var nav = document.querySelector(".site-nav");
  if (!nav) return;

  var THRESHOLD = 24;
  var ticking = false;

  function check() {
    ticking = false;
    nav.classList.toggle("is-scrolled", window.scrollY > THRESHOLD);
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(check);
  }

  check();
  window.addEventListener("scroll", onScroll, { passive: true });
})();
