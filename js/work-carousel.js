/*
  Work section "focus center" carousel (see Léo Parpeix's project gallery):
  the active slide sits centered, full-size and fully opaque; its
  neighbours peek in from both edges, visibly smaller and dimmed, and
  grow/sharpen into focus as they glide to the center. Prev/next and
  drag both just move `index` — render() does the rest.

  Peek needs a real neighbour on BOTH sides at all times, including at
  the first/last real slide — a plain flex row doesn't have anything to
  show past its own ends. So each carousel's track gets a clone of its
  last slide prepended and a clone of its first slide appended
  (`[data-clone]`, inert, out of tab order). Real indices live at
  1..n in that extended array; index 0 and index n+1 are the clones.
  Stepping onto a clone plays the same transition as any other step
  (so the motion never looks different at the loop point), then once
  that transition has finished we silently re-point index at the real
  slide the clone stood in for — same pixel position, so nothing jumps.
*/
(function () {
  var reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  // How far (in slide-widths) a slide has to be from center before it's
  // fully at its "peeking" look. 1 = fully settled by the time an
  // immediate neighbour is one slide-step away, matching how far the
  // peek slides actually sit at rest.
  var PEEK_SCALE = 0.85;
  var PEEK_OPACITY = 0.5;
  var PEEK_BLUR = 1.5; // px
  var PEEK_BRIGHTNESS = 0.8;
  var SNAP_DELAY = 550; // ms — a touch past --duration-slow (500ms)

  function initCarousel(root) {
    var viewport = root.querySelector('.work-carousel-viewport');
    var track = root.querySelector('.work-carousel-track');
    var originalSlides = Array.prototype.slice.call(root.querySelectorAll('.work-carousel-slide'));
    var prevBtn = root.querySelector('.work-media-prev');
    var nextBtn = root.querySelector('.work-media-next');
    if (!viewport || !track || originalSlides.length === 0) return;

    var n = originalSlides.length;
    var navigable = n > 1;

    // Always build the clone-front/clone-back structure, even for a
    // single real slide (its own clones just mirror itself) — every
    // work item's carousel should read the same "centered, peeking on
    // both sides" way at rest, whether or not there's anywhere to
    // navigate to.
    var cloneFirst = originalSlides[0].cloneNode(true);
    var cloneLast = originalSlides[n - 1].cloneNode(true);
    [cloneFirst, cloneLast].forEach(function (clone) {
      clone.setAttribute('data-clone', '');
      clone.setAttribute('aria-hidden', 'true');
      clone.setAttribute('inert', '');
    });
    track.insertBefore(cloneLast, originalSlides[0]);
    track.appendChild(cloneFirst);

    var slides = Array.prototype.slice.call(root.querySelectorAll('.work-carousel-slide'));
    var index = 1; // real slide 0, since slides[0] is now the cloned-last slide

    var dragging = false;
    var dragStartX = 0;
    var dragDeltaX = 0;
    var baseOffset = 0;
    var pointerId = null;
    var moved = false;
    var snapTimer = null;

    function gapPx() {
      var style = window.getComputedStyle(track);
      return parseFloat(style.columnGap || style.gap || '0') || 0;
    }

    // offsetWidth (layout box) rather than getBoundingClientRect
    // (paint box) — the latter would report the shrunken size once a
    // slide's peek scale is applied, which would throw this math off.
    function slideWidth(i) {
      return slides[i].offsetWidth;
    }

    function distanceToSlide(i) {
      var d = 0;
      var gap = gapPx();
      for (var k = 0; k < i; k++) {
        d += slideWidth(k) + gap;
      }
      return d;
    }

    function offsetForIndex(i) {
      var viewportWidth = viewport.clientWidth;
      var w = slideWidth(i);
      var centerPad = (viewportWidth - w) / 2;
      return centerPad - distanceToSlide(i);
    }

    function applyTrackTransform(px, animate) {
      track.style.transition =
        animate && !reduceMotionQuery.matches
          ? 'transform var(--duration-slow) var(--ease-standard)'
          : 'none';
      track.style.transform = 'translate3d(' + px + 'px, 0, 0)';
    }

    // Continuous focus/peek: each slide's scale/opacity/blur is driven
    // by its ACTUAL current distance from the viewport's center (not
    // just "am I the active index"), so this reads correctly both
    // mid-drag (finger-tracked) and mid-snap (CSS-eased) — same
    // function, just called with a live px in one case and a settled
    // target px in the other.
    function updateVisualState(px) {
      var viewportCenter = viewport.clientWidth / 2;
      var gap = gapPx();
      var unit = slideWidth(index) + gap || 1;

      slides.forEach(function (slide, i) {
        var w = slideWidth(i);
        var slideCenter = px + distanceToSlide(i) + w / 2;
        var t = Math.min(1, Math.abs(slideCenter - viewportCenter) / unit);
        var scale = 1 - t * (1 - PEEK_SCALE);
        var opacity = 1 - t * (1 - PEEK_OPACITY);
        slide.style.transform = 'scale(' + scale.toFixed(3) + ')';
        slide.style.opacity = opacity.toFixed(3);
        slide.style.filter = reduceMotionQuery.matches
          ? ''
          : 'blur(' + (t * PEEK_BLUR).toFixed(2) + 'px) brightness(' +
            (1 - t * (1 - PEEK_BRIGHTNESS)).toFixed(3) + ')';
      });
    }

    function render(animate) {
      var px = offsetForIndex(index);
      applyTrackTransform(px, animate);
      updateVisualState(px);
      slides.forEach(function (slide, i) {
        if (slide.hasAttribute('data-clone')) return;
        slide.classList.toggle('is-active', i === index);
        slide.setAttribute('aria-hidden', i === index ? 'false' : 'true');
      });
      if (prevBtn) prevBtn.disabled = !navigable;
      if (nextBtn) nextBtn.disabled = !navigable;
    }

    // After landing on a clone (index 0 or slides.length - 1), silently
    // re-point at the real slide it mirrors once the eased transition
    // has had time to finish — same offsetForIndex() result either way,
    // so the jump is imperceptible.
    function scheduleSnapCheck() {
      clearTimeout(snapTimer);
      if (!navigable) return;
      var delay = reduceMotionQuery.matches ? 0 : SNAP_DELAY;
      snapTimer = setTimeout(function () {
        if (index === slides.length - 1) {
          index = 1;
          render(false);
        } else if (index === 0) {
          index = slides.length - 2;
          render(false);
        }
      }, delay);
    }

    function goTo(newIndex) {
      // Clamped to the extended (clone-inclusive) array bounds: a click
      // or drag-release landing on a clone is fine (that's the whole
      // point), but a second one arriving before scheduleSnapCheck has
      // re-pointed index at the real slide must not walk off the end
      // of `slides` — it just has no effect until the snap lands.
      index = Math.max(0, Math.min(slides.length - 1, newIndex));
      render(true);
      scheduleSnapCheck();
    }

    if (prevBtn) prevBtn.addEventListener('click', function () { if (navigable) goTo(index - 1); });
    if (nextBtn) nextBtn.addEventListener('click', function () { if (navigable) goTo(index + 1); });

    track.addEventListener('pointerdown', function (e) {
      if (!navigable) return;
      if (e.button !== undefined && e.button !== 0) return;
      dragging = true;
      moved = false;
      pointerId = e.pointerId;
      dragStartX = e.clientX;
      dragDeltaX = 0;
      baseOffset = offsetForIndex(index);
      clearTimeout(snapTimer);
      track.classList.add('is-dragging');
      track.setPointerCapture(pointerId);
    });

    track.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      dragDeltaX = e.clientX - dragStartX;
      if (Math.abs(dragDeltaX) > 4) moved = true;
      var px = baseOffset + dragDeltaX;
      applyTrackTransform(px, false);
      updateVisualState(px);
    });

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      track.classList.remove('is-dragging');
      var threshold = viewport.clientWidth * 0.12;
      var newIndex = index;
      if (dragDeltaX < -threshold) newIndex = index + 1;
      else if (dragDeltaX > threshold) newIndex = index - 1;
      dragDeltaX = 0;
      goTo(newIndex);
    }

    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    track.addEventListener('pointerleave', function () {
      if (dragging) endDrag();
    });

    // A drag that crossed the move threshold shouldn't also fire the
    // slide's detail-page link click.
    track.addEventListener(
      'click',
      function (e) {
        if (moved) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true
    );

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { render(false); }, 100);
    });

    render(false);
  }

  document.querySelectorAll('.work-media[data-carousel]').forEach(initCarousel);
})();
