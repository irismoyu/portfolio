import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree, invalidate } from "@react-three/fiber";
import { ContactShadows, Environment, Text3D, Stats } from "@react-three/drei";
import { MeshTransmissionMaterial } from "@react-three/drei";
import { EffectComposer, DepthOfField } from "@react-three/postprocessing";
import { useSpring } from "@react-spring/three";
import { Leva, useControls } from "leva";
import * as THREE from "three";
import helvetikerBold from "three/examples/fonts/helvetiker_bold.typeface.json?url";
import helvetikerBoldData from "three/examples/fonts/helvetiker_bold.typeface.json";

// Standard easeOutExpo — written out directly rather than importing
// react-spring's `easings` (whose export surface varies by entry point)
// since this is the only curve needed. Used only for the collapse-to-
// arranged transition (see Letter's spring config) — the initial fall
// keeps its physics-spring feel (a "tumbling in" motion suits gravity),
// this is specifically for making the "收回" (settle to center) read as
// a deliberate, decelerating glide instead of a springy bounce.
function easeOutExpo(t) {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

const NAME = "LIU YUMO";
const LETTER_SIZE = 1.3;
// Chunky block, not a thin slice — "solid crystal" reads much better thick.
const EXTRUDE_DEPTH = 0.9;
// Slight negative tracking so glyphs touch/overlap a little (the "glued
// glass shards" look) — applied on top of each glyph's real advance width,
// not a fixed per-letter step (a fixed step ignored that e.g. "I" is much
// narrower than "M", leaving a phantom gap after narrow letters).
const KERNING = 0.88;
const SPACE_ADVANCE = 0.7;

// Real per-glyph box (font units are relative to `resolution`), scaled to
// our letter size. Height uses the font's shared cap-height since this
// charset (L I U Y U M O) has no descenders — good enough for layout math.
function glyphMetrics(char) {
  const glyph = helvetikerBoldData.glyphs[char];
  const unitsPerEm = helvetikerBoldData.resolution;
  const ha = glyph ? glyph.ha : unitsPerEm * 0.6;
  return {
    w: (ha / unitsPerEm) * LETTER_SIZE,
    h: (helvetikerBoldData.boundingBox.yMax / unitsPerEm) * LETTER_SIZE,
  };
}

// Kerned advance used only for the arranged word's cursor layout.
function glyphAdvance(char) {
  return glyphMetrics(char).w * KERNING;
}
// Lowest point letters ever rest at (below the scatter pose's y range) —
// shared by the scatter layout and the invisible ContactShadows floor.
const GROUND_Y = -3.25;
// How far below world y=0 the ARRANGED (settled) word sits — shifts the
// composition's weight down, opening up headroom above the word. Only
// the arranged pose uses this (see Letter's arrangedPose below); the
// scatter layout's hand-tuned, non-overlapping positions are untouched,
// and DepthOfField's focus target stays at the world origin regardless
// (DOF blur is driven by camera-to-target distance/depth, not proximity
// to a 3D point, so a vertical shift here doesn't affect focus).
const ARRANGED_Y_OFFSET = -1;
// Glow blobs live on a layer the ContactShadows capture camera doesn't see,
// so they tint the transmission/reflections without smudging the shadow.
const GLOW_LAYER = 1;

// Real (non-CSS) radial gradient so MeshTransmissionMaterial's transmission
// buffer actually samples something with depth instead of a flat color.
// "Indigo Sky" — bright, but hue-matched to --deep (#081160, ~234°) instead
// of the earlier cyan-leaning sky blue (~205°). Edge color reuses the
// existing --hi token so the hero stays in the same family as the rest of
// the site's palette.
//
// inner was #C3CFFA (very pale, near-white lavender) covering the FULL
// radius (only 2 stops, 0 and 1) — since the letters sit right in front
// of this, centered, that bright core was washing out the middle glyphs
// (Y/U) against the camera's straight-on view of it. Dimmed toward outer
// (less contrast, not "off") and given a third stop at 0.35 so the
// brightened core only occupies the innermost ~35% of the radius instead
// of ramping all the way to the edge — a smaller, softer hot spot behind
// the word instead of one big wash across the whole backdrop.
function useBrandGradientTexture(inner = "#96ABFB", outer = "#4C6FFF", size = 512) {
  return useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2,
    );
    gradient.addColorStop(0, inner);
    gradient.addColorStop(0.35, outer);
    gradient.addColorStop(1, outer);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, [inner, outer, size]);
}

// Composition anchor — real, opaque geometry (see note below on why it
// must stay opaque). The ONLY decorative shape left in the scene now —
// no accent blocks, no drift, nothing else.
//
// Why opaque at all: THREE's native transmission pre-pass
// (WebGLRenderer.renderTransmissionPass) only renders `opaqueObjects` into
// the buffer the glass samples — anything with `transparent: true` is
// skipped from that capture entirely, regardless of how it looks. An
// earlier soft-blob version used alpha blending and was invisible to
// transmission because of exactly this. Solid color with no alpha channel
// stays classified as opaque and actually shows up when the glass
// refracts it.
//
// A shallow ARC, not a full ball: sphereGeometry's own thetaStart/
// thetaLength args select just a small cap near the sphere's "north
// pole" directly (radius stays real/large — HERO_ARC_RADIUS — only the
// swept angle, HERO_ARC_THETA, is small), instead of a non-uniformly
// scaled ellipsoid — that would flatten the actual curvature/shading
// falloff along with the shape, which is exactly what "still has real
// spherical volume, not a flat ellipse" rules out. A cap this shallow
// naturally reads as wide + low, like a sliver of a sun on the horizon,
// with the letters floating in front of it. Deliberately positioned by
// its APEX (see the mesh position math below) rather than guessed
// against the camera's framing — cap width/height are then just
// geometry (radius × trig on theta), not trial and error.
const HERO_ARC_RADIUS = 5.5;
const HERO_ARC_THETA = 0.44; // ~25°: cap ≈ 4.7 wide × 0.5 tall
const HERO_ARC_APEX = { x: 0, y: -1.2, z: -4.5 }; // apex sits toward the letters' lower-middle
const HERO_ARC_COLOR = "#FF9A44";

function BackdropAccents() {
  return (
    // Standard (lit) material — gives the arc real dimensional shading
    // from the scene's existing lights instead of a flat colored patch.
    // roughness raised well past the earlier full-sphere version (0.45
    // -> 0.85) and metalness dropped to 0: a duller, softer specular so
    // it doesn't compete with the glass letters for "shiny" — the glass
    // is the only thing in frame that should read as sharply reflective.
    // Sitting further back in z than before (-3.5 -> -4.5) also pulls it
    // further outside DepthOfField's focusRange, so it renders visibly
    // softened/out-of-focus — a cheap stand-in for a real blur pass,
    // reusing the postprocessing chain that's already running.
    <mesh
      position={[HERO_ARC_APEX.x, HERO_ARC_APEX.y - HERO_ARC_RADIUS, HERO_ARC_APEX.z]}
      layers={GLOW_LAYER}
    >
      <sphereGeometry args={[HERO_ARC_RADIUS, 64, 12, 0, Math.PI * 2, 0, HERO_ARC_THETA]} />
      <meshStandardMaterial color={HERO_ARC_COLOR} roughness={0.85} metalness={0} />
    </mesh>
  );
}

// Boosted-brightness color (values above 1.0 per channel) for the
// reflection-only spheres below — combined with toneMapped={false} this
// keeps them reading as vivid/hot highlights instead of flat pastel dots
// once they're compressed into a small mirror/chromatic glint.
function hotColor(hex, boost = 1.7) {
  return new THREE.Color(hex).multiplyScalar(boost);
}

// Colored shapes that exist ONLY to be reflected/refracted — passed as
// children to <Environment>, drei renders them into a separate offscreen
// portal scene that's baked into a cubemap and used as scene.environment.
// They are never part of the main camera's render at all (not "hard to
// see", literally not drawn there), so the letters pick up rich colored
// highlights/chromatic glints without a single extra shape showing up in
// the actual background. Eight of them, spread around every angle (this is
// a 360° cubemap capture, not a camera-framed shot) across five hues, so
// facets catch a different color depending on which way they're tilted.
const REFLECTION_SPHERES = [
  { position: [6, 3, 2], radius: 1.6, color: "#FFD9A0" }, // warm gold
  { position: [-5, -2, 4], radius: 1.8, color: "#7FD8E8" }, // cyan
  { position: [-3, 5, -6], radius: 2, color: "#BCB2F2" }, // violet
  { position: [4, -4, -5], radius: 1.4, color: "#FF6EC7" }, // magenta
  { position: [0, 7, 3], radius: 1.7, color: "#FF9F5A" }, // orange
  { position: [7, -1, -4], radius: 1.5, color: "#FFD9A0" }, // warm gold
  { position: [-6, 2, -3], radius: 1.9, color: "#7FD8E8" }, // cyan
  { position: [2, -6, 5], radius: 1.6, color: "#BCB2F2" }, // violet
];

function ReflectionAccents() {
  return (
    <>
      {REFLECTION_SPHERES.map((s, i) => (
        <mesh key={i} position={s.position}>
          <sphereGeometry args={[s.radius, 16, 16]} />
          <meshBasicMaterial color={hotColor(s.color)} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

function useLetterLayout() {
  return useMemo(() => {
    const letters = [];
    let cursor = 0;
    for (const char of NAME) {
      if (char === " ") {
        cursor += SPACE_ADVANCE;
        continue;
      }
      letters.push({ char, x: cursor });
      cursor += glyphAdvance(char);
    }
    // True visual span: left edge of the first glyph (0) to the right edge
    // of the last glyph (its cursor position + its own natural width, NOT
    // its kerned advance — the advance is how far the cursor moves for the
    // *next* letter, which is tighter than the glyph's real width). Centering
    // on half of that — instead of the old half-of-cursor-run approximation,
    // which silently dropped the last glyph's width — is what makes L's gap
    // to the left edge match O's gap to the right edge.
    const last = letters[letters.length - 1];
    const lastWidth = glyphMetrics(last.char).w;
    const totalWidth = last.x + lastWidth;
    const centerOffset = totalWidth / 2;
    return {
      letters: letters.map((l) => ({ ...l, x: l.x - centerOffset })),
      totalWidth,
    };
  }, []);
}

// Hand-authored fixed scatter pose, one entry per letter in NAME order
// (L, I, U, Y, U, M, O) — same every time the page loads, not random.
// x/y are the letter's true visual CENTER (see the center-pivot group in
// Letter below); z/rotX/rotY/rotZ are hand-picked for "some leaning, some
// toppled over" variety. Positions were solved with a pairwise-disk
// repulsion pass using each glyph's rotation-invariant bounding radius
// (half-diagonal from its center), so every pair keeps a real >=0.3 world
// unit gap for ANY rotation — letters can never clip or overlap.
// y values shifted -0.4 from the original solve (see SCATTER_Y_SHIFT) to
// move the whole cluster down, opening up headroom above for the DOF's
// foreground layer and just to give the composition more breathing room.
const SCATTER_Y_SHIFT = -0.4;
const SCATTER_LAYOUT = [
  { x: -5.799, y: -1.415 + SCATTER_Y_SHIFT, z: 0.15, rotX: 0.08, rotY: -0.12, rotZ: -0.31 }, // L — casual lean
  { x: -3.792, y: -1.875 + SCATTER_Y_SHIFT, z: -0.25, rotX: 0.15, rotY: 0.05, rotZ: 1.26 }, // I — toppled on its side
  { x: -2.204, y: -0.473 + SCATTER_Y_SHIFT, z: 0.3, rotX: -0.05, rotY: 0.18, rotZ: 0.24 }, // U — gentle lean
  { x: -0.274, y: -1.705 + SCATTER_Y_SHIFT, z: -0.15, rotX: 0.22, rotY: -0.15, rotZ: -0.8 }, // Y — well tilted
  { x: 1.678, y: -0.509 + SCATTER_Y_SHIFT, z: 0.35, rotX: 0.06, rotY: -0.08, rotZ: 0.35 }, // U — gentle lean
  { x: 3.777, y: -1.619 + SCATTER_Y_SHIFT, z: -0.3, rotX: 0.1, rotY: 0.2, rotZ: -0.21 }, // M — mostly upright
  { x: 5.664, y: -0.064 + SCATTER_Y_SHIFT, z: 0.1, rotX: -0.25, rotY: 0.1, rotZ: 0.58 }, // O — reclined, rolled
];

// Perspective camera distance needed for `width` (world units) to fit
// horizontally, given the viewport's current aspect ratio.
function FitCamera({ width, margin = 1.35 }) {
  const { camera, size } = useThree();
  useEffect(() => {
    if (!camera.isPerspectiveCamera) return;
    const aspect = size.width / size.height;
    const halfW = (width * margin) / 2;
    const vFov = (camera.fov * Math.PI) / 180;
    const dist = halfW / (Math.tan(vFov / 2) * aspect);
    camera.position.z = Math.max(dist, 6);
    camera.updateProjectionMatrix();
  }, [camera, size, width, margin]);
  return null;
}

function Letter({
  char,
  arrangedX,
  scatter,
  dropDelay,
  glass,
  reduceMotion,
  arranged,
  onAnimatingChange,
}) {
  const group = useRef(null);
  const wasAnimatingRef = useRef(false);
  const { w, h } = useMemo(() => glyphMetrics(char), [char]);

  // arrangedX is the glyph's left-edge cursor position (from useLetterLayout);
  // convert to a center position so it matches the center-pivot group below.
  // y: ARRANGED_Y_OFFSET (not 0) puts the glyph's own vertical center that
  // far below world y=0 (the group's position IS the glyph's center thanks
  // to the center-pivot offset below) — shifted down from dead-center on
  // purpose, see ARRANGED_Y_OFFSET's own comment.
  const arrangedPose = useMemo(
    () => ({ x: arrangedX + w / 2, y: ARRANGED_Y_OFFSET, z: 0, rotX: 0, rotY: 0, rotZ: 0 }),
    [arrangedX, w],
  );
  const scatteredPose = useMemo(
    () => ({
      x: scatter.x,
      y: scatter.y,
      z: scatter.z,
      rotX: scatter.rotX,
      rotY: scatter.rotY,
      rotZ: scatter.rotZ,
    }),
    [scatter],
  );
  // Entrance-only: start high above the scattered resting spot and tumble in.
  const fallFrom = useMemo(
    () => ({ ...scatteredPose, y: scatteredPose.y + 7, rotX: scatteredPose.rotX - 0.7 }),
    [scatteredPose],
  );

  const target = arranged ? arrangedPose : scatteredPose;

  const spring = useSpring({
    to: target,
    from: reduceMotion ? target : fallFrom,
    delay: reduceMotion ? 0 : dropDelay,
    immediate: reduceMotion,
    // Physics spring for the fall (a "tumbling in" motion suits gravity —
    // mass/tension/friction is what gives it that slight overshoot/settle
    // feel) but a duration+easing curve for the collapse-to-arranged
    // transition: `arranged` is exactly the flag that also picks which
    // pose `target` above resolves to, so this branches on the same
    // condition and switches configs the instant the word starts
    // collapsing to center. easeOutExpo reads as a deliberate,
    // decelerating glide — no bounce/overshoot — which is what "自然减速"
    // asked for specifically for the retract, not the fall.
    config: arranged
      ? { duration: 850, easing: easeOutExpo }
      : { mass: 2, tension: 170, friction: 22 },
  });

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    // Perf: frameloop="demand" only renders when invalidate() is called.
    // Every spring key transitions together (fall-in, arrange<->scatter),
    // but not every key necessarily changes value in every transition (e.g.
    // only y/rotX move during the fall), so checking a single key would
    // miss some — check all six and keep asking for frames while any is
    // still interpolating. Once every key settles this stops on its own —
    // and nothing else asks for a frame afterward (see Hero3D: mouse
    // movement no longer invalidates once arranged), so the letters then
    // sit completely still, rendering zero further frames until the next
    // scroll or resize.
    const animating =
      spring.x.isAnimating ||
      spring.y.isAnimating ||
      spring.z.isAnimating ||
      spring.rotX.isAnimating ||
      spring.rotY.isAnimating ||
      spring.rotZ.isAnimating;
    if (animating) invalidate();
    // Edge-triggered (only on true<->false flips, not every frame) report
    // up to Scene, which aggregates all 7 letters into one shared "is
    // anything still moving" flag — that's what drives the temporary
    // transmission quality drop during the fall/collapse (see Scene's
    // glassLive). A per-frame report would just be 7x redundant state
    // churn; this only fires ~3 times per letter across the whole
    // entrance+collapse sequence.
    if (animating !== wasAnimatingRef.current) {
      wasAnimatingRef.current = animating;
      onAnimatingChange(animating);
    }
    g.position.set(spring.x.get(), spring.y.get(), spring.z.get());
    g.rotation.set(spring.rotX.get(), spring.rotY.get(), spring.rotZ.get());
  });

  return (
    <group ref={group}>
      {/* Re-centers the glyph so the outer group's origin (what we
          position/rotate above) is the glyph's true visual center, not its
          baseline-left anchor. This makes rotation pivot in place — required
          for the fixed scatter layout's non-overlap guarantee, which assumes
          each letter's footprint is a rotation-invariant disk around its
          center. */}
      <group position={[-w / 2, -h / 2, -EXTRUDE_DEPTH / 2]}>
        <Text3D
          font={helvetikerBold}
          size={LETTER_SIZE}
          height={EXTRUDE_DEPTH}
          curveSegments={8}
          bevelEnabled
          bevelThickness={0.07}
          bevelSize={0.055}
          bevelSegments={5}
        >
          {char}
          <MeshTransmissionMaterial
            color="#ffffff"
            attenuationColor="#ffffff"
            attenuationDistance={Infinity}
            envMapIntensity={2.1}
            {...glass}
          />
        </Text3D>
      </group>
    </group>
  );
}

// Mounts (and stays mounted — it's declarative, no imperative "did this
// already fire" bookkeeping needed) only once its parent <Suspense> has
// actually resolved, i.e. once the font/geometry work behind the letters
// is done. That's the signal Hero3D uses to fade the static preload
// placeholder out — tying it to Suspense resolving (not e.g. a fixed
// timeout, or Canvas's onCreated, which fires before Suspense children
// are ready) means the crossfade happens exactly when there's something
// real to show, on fast and slow devices alike.
function ReadySignal({ onReady }) {
  useEffect(() => {
    onReady();
  }, [onReady]);
  return null;
}


// Dropped during the fall/collapse only (see Scene's glassLive) —
// transmission sampling is the single biggest GPU cost in this scene (a
// full extra render pass per sample, per glass surface), and it's
// spent on detail that's genuinely invisible while seven letters are
// tumbling/gliding across the frame. Restored to the real (Leva)
// values the instant nothing is animating.
const LOW_QUALITY_RESOLUTION = 128;
const LOW_QUALITY_SAMPLES = 2;

function Scene({ arranged, onReady }) {
  const { letters, totalWidth } = useLetterLayout();
  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  // Aggregates all 7 letters' individual animating flags into one "is
  // anything still moving" bit. A ref-based counter (not 7 separate
  // booleans in state) so the up/down edges from different letters can't
  // race each other — React state updates from inside useFrame are
  // fine as long as they're rare (this fires only ~3x per letter across
  // the whole entrance+collapse sequence, not every frame).
  const [lowQuality, setLowQuality] = useState(true);
  const animatingCountRef = useRef(0);
  const handleAnimatingChange = useCallback((isAnimatingNow) => {
    animatingCountRef.current += isAnimatingNow ? 1 : -1;
    setLowQuality(animatingCountRef.current > 0);
  }, []);

  const glass = useControls("玻璃材质 glass", {
    // Thick, strongly refractive crystal — near-zero roughness for crisp
    // edges, and a strong chromatic fringe (visible red/green/violet
    // split at edges, not just a faint tint). transmission was 1 (fully
    // see-through) — at the outer letters (L, O), which sit further from
    // HERO_ARC's warm color and mostly refract flat background blue, that
    // read as "no letter there at all," not glass. Dropped to 0.85 so
    // every letter keeps a bit of its own body/color instead of vanishing
    // into whatever's behind it; thickness bumped 3 -> 3.6 alongside it —
    // more internal volume for that reduced transmission to tint through,
    // which is what actually keeps letters reading as "thick and solid"
    // rather than just "less see-through."
    transmission: { value: 0.85, min: 0, max: 1 },
    thickness: { value: 3.6, min: 0, max: 5 },
    roughness: { value: 0, min: 0, max: 1 },
    chromaticAberration: { value: 0.55, min: 0, max: 0.6 },
    ior: { value: 1.5, min: 1, max: 2.4 },
    // Perf: transmission sampling is the single biggest GPU cost in this
    // scene (a full extra render pass per sample, per glass surface).
    // 256/4 reads visually identical to 512/6 at this letter scale — the
    // blur from chromaticAberration + roughness already hides the
    // difference — for roughly a 3x cheaper transmission pass.
    samples: { value: 4, min: 1, max: 16, step: 1 },
    resolution: { value: 256, min: 32, max: 1024, step: 32 },
    transmissionSampler: true,
  });

  // The actual per-frame prop each Letter gets — same object as `glass`
  // whenever nothing's animating, swapped for the cheap resolution/
  // samples pair while the fall/collapse is in motion. Recomputed only
  // when `glass` or `lowQuality` actually change (not every render).
  const glassLive = useMemo(
    () =>
      lowQuality
        ? { ...glass, resolution: LOW_QUALITY_RESOLUTION, samples: LOW_QUALITY_SAMPLES }
        : glass,
    [glass, lowQuality],
  );

  const scene = useControls("场景 scene", {
    envPreset: {
      // night: high dark/light contrast — crisp, directional highlights
      // instead of studio's evenly-lit softbox fog.
      value: "night",
      options: ["city", "night", "studio", "warehouse", "dawn"],
    },
    dropStagger: { value: 80, min: 0, max: 300, step: 10 },
  });

  const bgTexture = useBrandGradientTexture();

  return (
    <>
      {/* Was briefly tightened to 1.4 (word filling ~71% of frame width)
          to make the word read as the clear visual lead over the backdrop
          accents — reverted back to 1.9 (~53% of frame width): at 1.4 the
          word ran too close to the left/right edges, not enough breathing
          room on the sides. */}
      <FitCamera width={totalWidth} margin={1.9} />
      <primitive attach="background" object={bgTexture} />
      {/* brighter fill to match the bright indigo backdrop — shadow sides
          read as cool indigo instead of near-black now */}
      <hemisphereLight args={["#eef1ff", "#4A5DC9", 0.35]} />
      {/* strong directional key + a cooler counter light for edge definition
          — still what makes the glass edges/chromatic fringe pop, bright
          background or not */}
      <directionalLight position={[5, 6, 7]} intensity={3.8} color="#f2f4ff" />
      <directionalLight position={[-6, -2, -5]} intensity={1.7} color="#b9c8f2" />
      {/* one warm accent light — restrained, just enough to tint the highlights */}
      <pointLight position={[3.2, -1.4, 5]} intensity={2.2} color="#FFD9A0" decay={0} />
      <Suspense fallback={null}>
        {/* preset still drives the base reflection tone; the colored sphere
            children are composited into the same offscreen cubemap so the
            glass has actual colored things to reflect/refract, without
            them ever appearing in the visible scene (see ReflectionAccents
            above). */}
        <Environment preset={scene.envPreset} frames={1}>
          <ReflectionAccents />
        </Environment>
      </Suspense>
      {/* the warm arc for the glass to actually refract — see
          BackdropAccents above. Fully static (no drift, no useFrame at
          all), same as the letters below once settled — nothing in this
          scene reacts to the mouse. */}
      <BackdropAccents />
      {/* invisible floor: renders nothing but the baked contact shadow itself.
          far is capped to the letters' real travel range so it stays under
          the glow patch and doesn't smudge it into the shadow. Deep indigo
          (not near-black) so it stays soft against the bright backdrop. */}
      <ContactShadows
        position={[0, GROUND_Y, 0]}
        scale={16}
        far={4.1}
        blur={3}
        opacity={0.35}
        color="#232C6B"
      />
      <Suspense fallback={null}>
        {letters.map((l, i) => (
          <Letter
            key={l.char + i}
            char={l.char}
            arrangedX={l.x}
            scatter={SCATTER_LAYOUT[i]}
            dropDelay={i * scene.dropStagger}
            glass={glassLive}
            reduceMotion={reduceMotion}
            arranged={arranged}
            onAnimatingChange={handleAnimatingChange}
          />
        ))}
        {/* Only the letters' own readiness gates the preload crossfade —
            not <Environment>'s separate Suspense above, which fetches an
            HDR over the network and would otherwise hold the placeholder
            up for however long that request takes (or hangs, if offline).
            The environment's reflections upgrade invisibly on top of an
            already-visible scene instead. */}
        <ReadySignal onReady={onReady} />
      </Suspense>
    </>
  );
}

// Scroll distance (px) past which the hero freezes: stops the render loop
// and applies a CSS blur/dim, so a fast scroll-past doesn't compete with
// scroll compositing for GPU time. Deliberately small — this should fire
// almost as soon as the user starts scrolling, well before hero is
// anywhere near covered (that's the separate, later heroVisible/sentinel
// check below), not as a "scrolled most of the way past" threshold.
const SCROLL_FREEZE_PX = 40;

// Cheap, synchronous "should this device even attempt WebGL 3D" check —
// deliberately conservative (only flags cases that are near-certain to be
// a bad experience) rather than trying to score GPU performance, which
// has no reliable cross-browser signal. Two checks:
//  1. No WebGL context at all (old/locked-down browser) — an instant no.
//  2. A software rasterizer (SwiftShader/llvmpipe/etc, exposed via the
//     WEBGL_debug_renderer_info extension) — technically "supports"
//     WebGL but renders every frame on the CPU, which is worse than no
//     3D at all for a scene this GPU-heavy (transmission + DOF passes).
// Runs once (called from a lazy useState initializer in Hero3D below),
// not on every render — creating a throwaway canvas + GL context isn't
// free.
function detectWeakDevice() {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return true;
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    if (debugInfo) {
      const renderer = String(
        gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || "",
      );
      if (/swiftshader|llvmpipe|software/i.test(renderer)) return true;
    }
    return false;
  } catch {
    // Any failure creating/querying the context: treat as unsupported
    // rather than risk mounting a Canvas that's about to throw.
    return true;
  }
}

function StaticFallback() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#4C6FFF",
        color: "#081160",
        fontFamily: "sans-serif",
        fontWeight: 700,
        fontSize: "8vw",
        letterSpacing: "0.05em",
      }}
    >
      LIU YUMO
    </div>
  );
}

// Loading placeholder shown over the Canvas until the glass letters are
// actually ready (see ReadySignal), then crossfaded out. Deliberately
// mirrors index.html's own pre-JS `.hero-fallback` markup (same copy,
// same rough layout) so the handoff from "static HTML before React
// mounts" to "this overlay, while React's 3D scene loads" is invisible —
// and deliberately all inline/hardcoded (not var(--deep) etc. or the
// site's utility classes) since this component also has to render
// correctly in the standalone hero-3d dev preview, which never loads the
// root site's stylesheet.
function PreloadOverlay({ visible, reduceMotion }) {
  return (
    <div
      aria-hidden={!visible}
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: "1.5rem",
        padding: "6rem 3rem",
        background: "#081160", // --deep
        color: "#EEF0F8", // --on-deep
        opacity: visible ? 1 : 0,
        transition: reduceMotion ? "none" : "opacity 600ms ease",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: "monospace",
          fontSize: "0.8rem",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "#6E8BFF", // --hi-on-deep
        }}
      >
        Phase 4
      </p>
      <h1
        style={{
          margin: 0,
          fontFamily: "sans-serif",
          fontWeight: 700,
          fontSize: "clamp(2.25rem, 1.6rem + 2.9vw, 3.05rem)", // --fs-display-l
          lineHeight: 1.1,
        }}
      >
        刘予墨 · Liu Yumo
      </h1>
    </div>
  );
}

// Auto-collapse delay (ms): how long the letters stay in their fallen,
// scattered pose before automatically arranging into the centered "LIU
// YUMO" logo — no click needed. Sized to comfortably clear the fall-in
// animation's own timing (last letter's dropDelay, i * dropStagger's
// default 80ms * 6 = 480ms, plus that spring's settle time) with a short
// beat afterward so the scattered pose actually reads before it collapses.
const AUTO_ARRANGE_DELAY_MS = 2600;
// How long AFTER `arranged` flips true the letters are actually done
// moving: the collapse-to-arranged spring's own duration (850ms, see the
// `arranged` branch of Letter's spring config) plus a short buffer for
// its trailing settle. index.html's cursor-ball layer
// (js/hero-cursor.js) waits for the "hero:settled" event fired below
// before it starts its own rAF draw loop — that loop is real per-frame
// canvas work, and the fall-in + collapse stretch is already the
// single busiest/jankiest part of this scene, so it deliberately sits
// out until there's nothing else left to compete with.
const HERO_SETTLE_DELAY_MS = 1000;

export default function Hero3D() {
  const [isMobile, setIsMobile] = useState(false);
  const [arranged, setArranged] = useState(false);
  // Assume visible until proven otherwise — avoids a black/frozen flash on
  // mount, and is the correct fallback for the standalone hero-3d dev
  // preview, which has no #hero-cover-sentinel (see below) and so never
  // flips this.
  const [heroVisible, setHeroVisible] = useState(true);
  // Computed once (lazy initializer, not on every render) rather than
  // useMemo-with-deps: neither input can change during the component's
  // life (the OS motion setting and the device's GL capabilities are both
  // fixed for the session), so there's nothing to re-derive.
  const [reduceMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [isWeakDevice] = useState(() => detectWeakDevice());
  // Scroll-to-freeze (see the scrollY effect below): true once the user
  // has scrolled past SCROLL_FREEZE_PX, well before hero is anywhere near
  // covered. Distinct from heroVisible (which tracks full coverage) —
  // this fires almost immediately on any scroll, to free up the GPU for
  // scroll compositing rather than racing it.
  const [scrolledPast, setScrolledPast] = useState(false);
  // Gates the preload-placeholder crossfade (see PreloadOverlay/ReadySignal)
  // — flips true once the letters' Suspense boundary has actually resolved.
  const [ready, setReady] = useState(false);
  const handleReady = useCallback(() => setReady(true), []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Auto-arrange: no click needed, and no toggle back to scattered — the
  // letters fall in, hold their scattered pose for a beat, then collapse
  // into the centered logo on their own and sit there, fully still,
  // afterward. No post-arrange mouse interaction in this scene at all
  // (tried both per-letter parallax + a moving light, and later a
  // whole-word tilt — both removed; real-time WebGL response to mouse
  // move cost a full extra frame, transmission+DOF passes included, per
  // move). index.html's 2D ball-trail layer (js/hero-cursor.js) is the
  // only thing that still reacts to the mouse, blended on top via
  // mix-blend-mode — zero 3D re-renders involved.
  useEffect(() => {
    const id = setTimeout(() => setArranged(true), AUTO_ARRANGE_DELAY_MS);
    return () => clearTimeout(id);
  }, []);

  // Explicit kick so the collapse-to-arranged spring transition actually
  // starts rendering the instant it begins, the same way scrolledPast/
  // heroVisible resuming do below — depending on the state change alone
  // to ripple into a render (via React's commit -> Letter's useFrame ->
  // its own animating-check invalidate() chain) proved unreliable in
  // practice: without this, the transition could complete its math with
  // zero frames actually drawn, so the letters would just appear to
  // vanish until something else (e.g. a mouse move) finally triggered a
  // render showing the already-settled result.
  useEffect(() => {
    if (arranged) invalidate();
  }, [arranged]);

  // Fires once the collapse has actually finished (not the instant it
  // starts — `arranged` flips at the START of that spring transition).
  // A plain DOM event, not React state/context: js/hero-cursor.js is a
  // deliberately separate vanilla script (see its own file header) with
  // no reference to this React tree at all, so a window event is the
  // only channel between them. Runs in every render path, including
  // StaticFallback/reduceMotion/isWeakDevice below — arranged's own
  // timer already fires unconditionally (hooks can't be behind that
  // branch), and hero-cursor.js independently bails on reduced-motion
  // and mobile itself, so this only ever matters where it should.
  useEffect(() => {
    if (!arranged) return;
    const id = setTimeout(() => {
      window.dispatchEvent(new Event("hero:settled"));
    }, HERO_SETTLE_DELAY_MS);
    return () => clearTimeout(id);
  }, [arranged]);

  // Perf: freezes the render loop and (via the filter style below) blurs
  // + dims the canvas as soon as the user starts scrolling — not just
  // once hero is mostly/fully covered (that's heroVisible, further down).
  // A scroll gesture immediately competes with the GPU for compositing
  // time, so this deliberately fires early (SCROLL_FREEZE_PX is small)
  // rather than waiting until hero is nearly out of view. Separate effect
  // from the sentinel one below (rather than folding the threshold check
  // into that effect) so this still works even in contexts without a
  // #hero-cover-sentinel, e.g. the standalone dev preview.
  useEffect(() => {
    let ticking = false;
    const check = () => {
      ticking = false;
      setScrolledPast(window.scrollY > SCROLL_FREEZE_PX);
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Mirrors the heroVisible resume behavior below: frameloop is about to
  // flip from "never" back to "demand" (see the Canvas prop), which
  // renders nothing until something calls invalidate() — without this,
  // scrolling back to the top would leave the canvas frozen on its last
  // frame instead of resuming immediately.
  useEffect(() => {
    if (!scrolledPast) invalidate();
  }, [scrolledPast]);

  // Perf: hero sits behind About via position:sticky (see css/home.css) —
  // once scrolled past, hero's own bounding box never leaves the viewport
  // (sticky keeps it pinned), so hero can't tell "am I visible" about
  // itself. #hero-cover-sentinel lives at About's top edge instead: it
  // leaves the viewport (from the top) at the exact scroll position where
  // About's opaque box has risen up to fully cover hero. That's the signal
  // to fully stop the R3F render loop (frameloop="never") — not just slow
  // it down — since hero is 100% hidden and every render is otherwise
  // wasted GPU/CPU work competing with scroll compositing.
  useEffect(() => {
    const sentinel = document.getElementById("hero-cover-sentinel");
    if (!sentinel) return;
    // A plain scroll listener (rAF-throttled) instead of an
    // IntersectionObserver: the observer only calls back when the
    // sentinel's intersection ratio actually crosses a threshold, but on
    // a page that currently ends right at "About fully covers hero" (no
    // content below About yet), the sentinel scrolls from fully-visible
    // straight to exactly boundingClientRect.top === 0 and stops there —
    // that transition never crosses the isIntersecting boundary (a 1px
    // element sitting exactly at the viewport's top edge still counts as
    // intersecting), so the observer's "hero is now hidden" callback would
    // never fire and the render loop would idle forever instead of fully
    // stopping. Reading the rect directly on scroll has no such edge case.
    let ticking = false;
    const check = () => {
      ticking = false;
      const visible = sentinel.getBoundingClientRect().top > 0;
      setHeroVisible(visible);
      // frameloop flips straight from "never" to "demand" below, which
      // renders nothing until something calls invalidate() — without
      // this, scrolling back up would show a frozen/stale canvas instead
      // of resuming the scene immediately.
      if (visible) invalidate();
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Three independent reasons to skip WebGL entirely and never mount
  // <Canvas>, not just degrade it: too small a viewport to show the full
  // composition well (isMobile), the user asked for less motion
  // (reduceMotion — "respect prefers-reduced-motion" here means the
  // static image, not just skipping the individual entrance/drift
  // animations while still running a live 3D render loop), or the device
  // can't push this scene's transmission/DOF cost without becoming the
  // janky part of the page (isWeakDevice). All three get the exact same
  // treatment on purpose — there's no degraded-but-still-3D middle tier.
  if (isMobile || reduceMotion || isWeakDevice) return <StaticFallback />;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        style={{
          width: "100%",
          height: "100%",
          // Perf + UX: as soon as scrolling starts (scrolledPast), the
          // Canvas prop below has already frozen the render loop on
          // whatever frame was last drawn — this filter is what turns
          // that frozen frame into a deliberate "stepped back" visual
          // instead of just a stale-looking static image, while scroll
          // compositing gets the GPU headroom the paused render loop just
          // freed up.
          filter: scrolledPast ? "blur(6px) brightness(0.8)" : "none",
          transition: reduceMotion ? "none" : "filter 400ms ease",
        }}
      >
        <Canvas
          // Perf: high-DPR screens (2x/3x) were rendering 4-9x the pixels for
          // no visible gain at this content scale — 1.5 is the point where
          // pixel-doubling stops being perceptible on a glass/blur-heavy scene
          // but still costs meaningfully less than the old 1.75 ceiling.
          dpr={[1, 1.5]}
          camera={{ position: [0, 0, 11], fov: 32, rotation: [-0.1, 0, 0] }}
          // No inline cursor style: index.html's own hero-cursor script
          // (js/hero-cursor.js) sets `cursor: none` on #hero while active
          // and draws its own 2D ball trail instead — leaving this unset
          // lets that rule apply cleanly, and lets the plain default
          // cursor show through on devices/motion settings where that
          // script bails.
          style={{ width: "100%", height: "100%" }}
          // Deliberately no onPointerMove here — this scene reads the
          // pointer nowhere anymore (no per-letter parallax, no moving
          // light, no whole-word tilt; all removed), so there is nothing
          // for a move to invalidate. Once the fall/arrange entrance
          // settles, only a scroll or resize should ever draw another
          // frame.
          onCreated={(state) => state.camera.layers.enable(GLOW_LAYER)}
          // Perf: "demand" only renders when invalidate() is called (see
          // the spring/backdrop invalidate() calls above) instead of
          // rendering every rAF tick regardless of whether anything
          // changed — this is the biggest win for a scene that sits
          // completely still once arranged. Fully "never" once hero has
          // scrolled out of view (heroVisible) OR once the user has
          // started scrolling at all (scrolledPast) — either one alone is
          // enough to stop rendering; "never" freezes on the last drawn
          // frame rather than clearing it.
          frameloop={heroVisible && !scrolledPast ? "demand" : "never"}
        >
          <Scene arranged={arranged} onReady={handleReady} />
          {/* target [0,0,0] is where the letters live — DepthOfField reads the
              live camera-to-target distance every frame, so focus stays
              correct even though FitCamera moves the camera on resize.
              focusRange is in world units either side of that point: 1.4
              comfortably covers every letter's depth (they only ever span
              roughly ±0.5 units) while the foreground/background accent
              layers (2-9 units away) fall well outside it and blur.
              multisampling knocked down from EffectComposer's default 8 to 4
              — visibly identical at this scale, cheaper per frame.
              resolutionScale renders the postprocessing chain (DOF's blur
              passes included) at 75% resolution then upscales — DOF is
              already a soft/blurred effect, so the extra downsampling isn't
              visible, and it cuts the most expensive part of the frame.
              bokehScale bumped 4 -> 5.5 (composition-only change, same
              cost) so the muted backdrop/foreground accents read as soft
              atmosphere rather than merely-paler shapes. */}
          <EffectComposer multisampling={4} resolutionScale={0.75}>
            <DepthOfField target={[0, 0, 0]} focusRange={1.4} bokehScale={5.5} />
          </EffectComposer>
          {/* dev-only fps counter — never ships in the production/embedded build */}
          {import.meta.env.DEV && <Stats />}
        </Canvas>
      </div>
      {/* Sits over the Canvas until the letters are ready, then crossfades
          out — see ReadySignal/PreloadOverlay for why this is tied to
          Suspense resolving rather than a timeout. */}
      <PreloadOverlay visible={!ready} reduceMotion={reduceMotion} />
      {/* useControls elsewhere auto-mounts a global Leva panel unless one is
          rendered explicitly — this is that explicit mount, so `hidden` can
          hide it for the production/embedded build. transmission etc. still
          apply either way; only the floating control panel is affected. */}
      <Leva hidden={import.meta.env.PROD} />
    </div>
  );
}
