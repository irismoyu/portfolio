(function () {
  var playground = document.querySelector('.about-playground');
  if (!playground) return;
  var stage = playground.querySelector('.sticker-stage');
  var portrait = stage.querySelector('.sticker-person');
  var stickers = Array.from(stage.querySelectorAll('.sticker'));
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var active = null;
  var copies = new Map();
  // One shared DetailPanel, outside the composition's normal flow.
  var reader = document.createElement('div');
  reader.className = 'sticker-reader';
  reader.tabIndex = 0;
  reader.hidden = true;
  stage.appendChild(reader);
  var announcement = document.createElement('p');
  announcement.className = 'fragment-announcement';
  announcement.setAttribute('role', 'status');
  stage.appendChild(announcement);
  var animation = null;
  var revision = 0;
  stickers.forEach(function (sticker) {
    var copy = sticker.querySelector('.sticker-copy');
    copies.set(sticker, copy);
    reader.appendChild(copy);
    sticker.querySelector('.asset-wrapper').addEventListener('animationend', function (event) {
      if (event.animationName === 'asset-click') sticker.classList.remove('is-clicked');
    });
  });

  function placeReader() {
    if (!active || reader.hidden) return;
    var bounds = stage.getBoundingClientRect();
    var person = portrait.getBoundingClientRect();
    var node = active.getBoundingClientRect();
    var mobile = window.matchMedia('(max-width: 900px)').matches;
    var angle = parseFloat(active.style.getPropertyValue('--orbit-angle'));
    var right = mobile ? node.left + node.width / 2 < bounds.left + bounds.width / 2 :
      (Math.cos(angle * Math.PI / 180) < -.1 || angle === -90);
    var gap = mobile ? 8 : 24;
    // Side lanes exclude the portrait. Mobile retains its existing grid,
    // placing the note in the opposite column, below the portrait.
    var left = right ? (mobile ? bounds.width / 2 + gap : person.right - bounds.left + gap) : 0;
    var edge = right ? bounds.width : (mobile ? bounds.width / 2 - gap : person.left - bounds.left - gap);
    var width = Math.min(480, edge - left);
    if (!right) left = edge - width;
    var minTop = Math.max(0, 76 - bounds.top, mobile ? person.bottom - bounds.top + gap : 0);
    var bottom = Math.min(bounds.height, window.innerHeight - bounds.top - 16);
    // Scrolling away must never push the absolute layer outside its stage.
    reader.style.visibility = bottom - minTop < 80 ? 'hidden' : '';
    if (bottom - minTop < 80) return;
    reader.style.width = width + 'px';
    reader.style.left = left + 'px';
    reader.style.maxHeight = Math.max(0, bottom - minTop - 8) + 'px';
    var preferredTop = mobile ? node.top - bounds.top : bounds.height * (angle < 0 ? .36 : .16);
    reader.style.top = Math.max(minTop, Math.min(preferredTop, bottom - reader.offsetHeight - 8)) + 'px';
    reader.dataset.placement = right ? 'right' : 'left';
  }

  async function renderDetail() {
    var current = ++revision;
    if (animation) animation.cancel();
    if (!reader.hidden && !reduced.matches) {
      animation = reader.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' });
      try { await animation.finished; } catch (_) {}
      if (current !== revision) return;
    }
    copies.forEach(function (copy, sticker) { copy.hidden = sticker !== active; });
    reader.hidden = !active;
    if (animation) animation.cancel();
    announcement.textContent = active ? '正在查看：' + active.querySelector('.sticker-title').textContent : '';
    if (!active) return;
    reader.setAttribute('aria-labelledby', copies.get(active).getAttribute('aria-labelledby'));
    reader.scrollTop = 0;
    placeReader();
    if (!reduced.matches) {
      animation = reader.animate([
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ], { duration: 300, easing: 'ease-out' });
    }
  }

  function select(sticker) {
    active = sticker;
    stickers.forEach(function (item) {
      item.classList.toggle('is-open', item === active);
      item.querySelector('.sticker-toggle').setAttribute('aria-expanded', String(item === active));
    });
    stage.classList.toggle('has-open', Boolean(active));
    renderDetail();
  }
  function closeActive(restoreFocus) {
    if (!active) return;
    var button = active.querySelector('.sticker-toggle');
    select(null);
    if (restoreFocus) button.focus({ preventScroll: true });
  }
  document.addEventListener('click', function (event) {
    if (event.target.closest('.sticker-toggle') || reader.contains(event.target)) return;
    closeActive(reader.contains(document.activeElement));
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && active) {
      event.preventDefault();
      closeActive(true);
    }
  });
  stickers.forEach(function (sticker) {
    sticker.querySelector('.sticker-toggle').addEventListener('click', function () {
      stage.classList.remove('stickers-pending', 'stickers-enter');
      select(active === sticker ? null : sticker);
      sticker.classList.remove('is-clicked');
      if (active && !reduced.matches) {
        requestAnimationFrame(function () {
          if (active === sticker) sticker.classList.add('is-clicked');
        });
      }
    });
  });
  window.addEventListener('resize', placeReader);
  window.addEventListener('scroll', placeReader, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(placeReader).observe(stage);
  if (document.fonts) document.fonts.ready.then(placeReader);
  reduced.addEventListener('change', function () {
    if (reduced.matches) {
      stage.classList.remove('stickers-pending', 'stickers-enter');
      stickers.forEach(function (sticker) { sticker.classList.remove('is-clicked'); });
      renderDetail();
    }
  });
  if ('IntersectionObserver' in window && !reduced.matches) {
    stage.classList.add('stickers-pending');
    var observer = new IntersectionObserver(function (entries) {
      if (entries.some(function (entry) { return entry.isIntersecting; })) {
        stage.classList.remove('stickers-pending');
        stage.classList.add('stickers-enter');
        observer.disconnect();
      }
    }, { threshold: .12 });
    observer.observe(stage);
    stage.addEventListener('focusin', function () { stage.classList.remove('stickers-pending'); });
  }
})();
