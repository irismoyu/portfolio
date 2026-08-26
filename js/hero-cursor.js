/*
  Hero mouse interaction — a trailing chain of colored balls on a single
  2D <canvas>, blended onto the WebGL scene below it via CSS
  mix-blend-mode. This is deliberately NOT part of hero-3d: the glass
  letters render once (fall-in + auto-arrange) and then sit completely
  frozen (see Hero3D.jsx) — an earlier version drove real 3D parallax and
  a moving Three.js light off the pointer, which meant a full extra
  WebGL frame (transmission + DOF passes) per mouse move for a payoff
  that didn't read clearly. This layer carries all of the "reacts to
  your mouse" feeling instead: ~10 filled circles redrawn on a plain 2D
  canvas, no WebGL/3D involved, and mix-blend-mode is compositor work,
  not a re-render of anything beneath it — the colors read as tinting/
  reflecting off the glass for effectively zero extra GPU cost.

  Bails out entirely on touch/coarse pointers, prefers-reduced-motion,
  and narrow/mobile viewports — same thresholds as hero-3d's own
  isMobile check, so the two agree on what counts as "desktop enough".

  Perf: the rAF draw loop below (draw()) is real per-frame canvas work,
  and the fall-in + collapse stretch (Hero3D.jsx) is already the single
  busiest/jankiest part of this page — so this stays fully inert (no
  draw loop, native cursor untouched) until Hero3D dispatches
  "hero:settled" (fired once the letters are done falling AND
  collapsing, not just once nothing happens to be moving at that exact
  instant — see Hero3D's own HERO_SETTLE_DELAY_MS comment). Mouse
  position is tracked the whole time regardless (a few numbers on
  mousemove, not a rAF loop) so the ball can appear exactly under the
  pointer the instant it activates, instead of flying in from wherever
  it last was. A generous timeout activates anyway if that event never
  arrives, so a future regression in hero-3d can't silently disable this
  feature forever.
*/
(function () {
  var MOBILE_WIDTH = 768;
  var BALL_COUNT = 10;
  // Warm gold / cyan / pink / violet — the same family used throughout
  // hero-3d's own backdrop/reflection accents, so the trail reads as
  // part of the same palette instead of a bolted-on new one.
  var BALL_COLORS = ["#FFD9A0", "#7FD8E8", "#FF6EC7", "#BCB2F2"];
  var HEAD_EASE = 0.35;
  var TRAIL_EASE = 0.28;
  var HEAD_RADIUS = 15;
  var TAIL_RADIUS = 6;

  if (window.matchMedia("(hover: none), (pointer: coarse)").matches) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (window.innerWidth < MOBILE_WIDTH) return;

  var hero = document.getElementById("hero");
  if (!hero) return;

  var canvas = document.createElement("canvas");
  canvas.className = "hero-ball-cursor";
  hero.appendChild(canvas);
  // body.custom-cursor-active (hides the native cursor over #hero, see
  // the CSS) is added later, in activate() below — not here. Adding it
  // this early would hide the native cursor before the ball is actually
  // drawing, leaving no cursor at all over hero during the fall-in/collapse.

  var ctx = canvas.getContext("2d");
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var width = 0;
  var height = 0;

  function resize() {
    var rect = hero.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  var balls = [];
  for (var i = 0; i < BALL_COUNT; i++) {
    balls.push({ x: 0, y: 0, color: BALL_COLORS[i % BALL_COLORS.length] });
  }

  var targetX = 0;
  var targetY = 0;
  var visible = false;
  var raf = null;

  function draw() {
    ctx.clearRect(0, 0, width, height);

    balls[0].x += (targetX - balls[0].x) * HEAD_EASE;
    balls[0].y += (targetY - balls[0].y) * HEAD_EASE;
    for (var i = 1; i < balls.length; i++) {
      balls[i].x += (balls[i - 1].x - balls[i].x) * TRAIL_EASE;
      balls[i].y += (balls[i - 1].y - balls[i].y) * TRAIL_EASE;
    }

    // Tail-first so the (smaller, brighter) head paints on top of
    // whatever trail balls it overlaps, not the other way round.
    for (var j = balls.length - 1; j >= 0; j--) {
      var t = j / (balls.length - 1); // 0 at head, 1 at tail
      var radius = HEAD_RADIUS - (HEAD_RADIUS - TAIL_RADIUS) * t;
      var alpha = 1 - t * 0.45;
      var b = balls[j];
      var gradient = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, radius);
      // A solid-ish core out to ~45% of the radius, THEN fading to
      // transparent — a pure center-to-edge fade (stop 0 straight to
      // stop 1) reads as a faint hazy smudge once blended additively;
      // this reads as an actual ball with a soft glow edge instead.
      gradient.addColorStop(0, b.color);
      gradient.addColorStop(0.45, b.color);
      gradient.addColorStop(1, "transparent");
      ctx.globalAlpha = alpha;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(b.x, b.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    raf = requestAnimationFrame(draw);
  }

  function start() {
    if (raf === null) raf = requestAnimationFrame(draw);
  }

  function stop() {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
  }

  function show(clientX, clientY) {
    var rect = hero.getBoundingClientRect();
    var lx = clientX - rect.left;
    var ly = clientY - rect.top;
    // First entry (or a stray move before an enter event): snap the
    // whole chain to the pointer instead of letting it lerp in from
    // wherever it last was, so the trail doesn't fly in across the hero.
    if (!visible) {
      for (var i = 0; i < balls.length; i++) {
        balls[i].x = lx;
        balls[i].y = ly;
      }
    }
    targetX = lx;
    targetY = ly;
    visible = true;
    canvas.classList.add("is-visible");
    start();
  }

  // Settle gate: draw()'s rAF loop and the native-cursor-hiding class
  // both stay off until settled — see the file header comment. Position
  // is still tracked while disabled (cheap) so activate() can place the
  // ball under the pointer immediately instead of waiting for the next
  // mousemove.
  var settled = false;
  var overHero = false;
  var lastClientX = 0;
  var lastClientY = 0;

  function activate() {
    if (settled) return;
    settled = true;
    document.body.classList.add("custom-cursor-active");
    if (overHero) show(lastClientX, lastClientY);
  }

  window.addEventListener("hero:settled", activate, { once: true });
  // Safety net: if hero-3d's bundle fails to load/dispatch, or this
  // script ever drifts out of sync with it, don't leave the ball cursor
  // silently disabled forever — activate anyway after a generous wait.
  setTimeout(activate, 8000);

  hero.addEventListener("mouseenter", function (e) {
    overHero = true;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    if (settled) show(e.clientX, e.clientY);
  });

  hero.addEventListener("mousemove", function (e) {
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    if (settled) show(e.clientX, e.clientY);
  });

  hero.addEventListener("mouseleave", function () {
    overHero = false;
    if (!settled) return;
    visible = false;
    canvas.classList.remove("is-visible");
    stop();
  });
})();
