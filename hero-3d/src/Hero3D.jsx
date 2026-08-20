import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Text3D, Stats } from "@react-three/drei";
import { MeshTransmissionMaterial } from "@react-three/drei";
import { EffectComposer, DepthOfField } from "@react-three/postprocessing";
import { useSpring } from "@react-spring/three";
import { Leva, useControls } from "leva";
import * as THREE from "three";
import helvetikerBold from "three/examples/fonts/helvetiker_bold.typeface.json?url";
import helvetikerBoldData from "three/examples/fonts/helvetiker_bold.typeface.json";

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
// Glow blobs live on a layer the ContactShadows capture camera doesn't see,
// so they tint the transmission/reflections without smudging the shadow.
const GLOW_LAYER = 1;

// Real (non-CSS) radial gradient so MeshTransmissionMaterial's transmission
// buffer actually samples something with depth instead of a flat color.
// "Indigo Sky" — bright, but hue-matched to --deep (#081160, ~234°) instead
// of the earlier cyan-leaning sky blue (~205°). Edge color reuses the
// existing --hi token so the hero stays in the same family as the rest of
// the site's palette.
function useBrandGradientTexture(inner = "#C3CFFA", outer = "#4C6FFF", size = 512) {
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
    gradient.addColorStop(1, outer);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, [inner, outer, size]);
}

// Colored accents behind AND in front of the letters — real, opaque
// geometry (see note below on why it must stay opaque). Split into three
// layers at different depths (far background, near foreground, plus
// ReflectionAccents' envmap-only spheres further below) so a real
// DepthOfField pass (see Hero3D component) can blur near and far alike
// while the letters' own depth stays in focus — that's what actually sells
// "this is transparent glass" rather than "these are pale shapes". Colors
// mixed ~40% toward white (not toward the indigo background — mixing warm
// hues straight into blue just muddies them). Positions are pushed to the
// corners/edges, clear of both the scattered layout's footprint and the
// arranged word's central band, so there's a clean patch directly behind
// "LIU YUMO".
//
// Why opaque at all: THREE's native transmission pre-pass
// (WebGLRenderer.renderTransmissionPass) only renders `opaqueObjects` into
// the buffer the glass samples — anything with `transparent: true` is
// skipped from that capture entirely, regardless of how it looks. An
// earlier soft-blob version used alpha blending and was invisible to
// transmission because of exactly this. Circles/rectangles with solid
// color and no alpha channel stay classified as opaque and actually show
// up when the glass refracts them.
// Background layer — far behind the letters (z very negative).
const BACKDROP_STRIPES = [
  { color: "#FFC59C", position: [-5.5, 3.2, -7], size: [15, 0.85], rotationZ: -0.3, driftSpeed: 0.03, phase: 0 }, // pastel orange
  { color: "#D7D1F7", position: [5.8, -2.6, -8], size: [13, 0.65], rotationZ: 0.28, driftSpeed: 0.026, phase: 1.7 }, // pastel violet
];

const BACKDROP_BLOCKS = [
  { color: "#FFE8C6", position: [6.3, 2.8, -7.5], radius: 1.7, driftSpeed: 0.036, phase: 0.8 }, // pastel gold
  { color: "#B2E8F1", position: [-6.3, -2.4, -8.5], radius: 1.5, driftSpeed: 0.031, phase: 2.6 }, // pastel cyan
  { color: "#FFA8DD", position: [0.3, 3.6, -9], radius: 1.3, driftSpeed: 0.04, phase: 4.5 }, // pastel pink
];

// Foreground layer — between the letters and the camera (z positive),
// pushed to the frame edges/corners so they never sit over the letters
// themselves. This is what makes the depth of field read as real depth
// instead of just "background blur": with DepthOfField focused on the
// letters, near objects defocus at least as fast as far ones, so these
// read as big, soft color washes framing the shot — the classic
// "shooting through foreground bokeh" look. Richer/more saturated than
// the background pastels since the blur will mute them anyway.
const FOREGROUND_BLOCKS = [
  { color: "#FFB37A", position: [-8.6, -2.6, 3.4], radius: 2.9, driftSpeed: 0.022, phase: 0.4 }, // warm orange
  { color: "#8FD8F2", position: [8.4, 2.6, 3.0], radius: 2.6, driftSpeed: 0.019, phase: 2.3 }, // cyan
  { color: "#D6A8F0", position: [-7.6, 3.4, 4.1], radius: 2, driftSpeed: 0.025, phase: 3.9 }, // violet
];

const DRIFT_AMP = 0.3;

function BackdropAccents() {
  const stripeRefs = useRef([]);
  const blockRefs = useRef([]);
  const foregroundRefs = useRef([]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const drift = (item, m) => {
      if (!m) return;
      m.position.x = item.position[0] + Math.sin(t * item.driftSpeed + item.phase) * DRIFT_AMP;
      m.position.y = item.position[1] + Math.cos(t * item.driftSpeed * 0.8 + item.phase) * DRIFT_AMP * 0.7;
    };
    BACKDROP_STRIPES.forEach((s, i) => drift(s, stripeRefs.current[i]));
    BACKDROP_BLOCKS.forEach((b, i) => drift(b, blockRefs.current[i]));
    FOREGROUND_BLOCKS.forEach((b, i) => drift(b, foregroundRefs.current[i]));
  });

  return (
    <>
      {BACKDROP_STRIPES.map((s, i) => (
        <mesh
          key={`stripe-${i}`}
          ref={(el) => (stripeRefs.current[i] = el)}
          position={s.position}
          rotation={[0, 0, s.rotationZ]}
          layers={GLOW_LAYER}
        >
          <planeGeometry args={s.size} />
          <meshBasicMaterial color={s.color} toneMapped={false} />
        </mesh>
      ))}
      {BACKDROP_BLOCKS.map((b, i) => (
        <mesh
          key={`block-${i}`}
          ref={(el) => (blockRefs.current[i] = el)}
          position={b.position}
          layers={GLOW_LAYER}
        >
          <circleGeometry args={[b.radius, 32]} />
          <meshBasicMaterial color={b.color} toneMapped={false} />
        </mesh>
      ))}
      {FOREGROUND_BLOCKS.map((b, i) => (
        <mesh
          key={`fg-${i}`}
          ref={(el) => (foregroundRefs.current[i] = el)}
          position={b.position}
          layers={GLOW_LAYER}
        >
          <circleGeometry args={[b.radius, 32]} />
          <meshBasicMaterial color={b.color} toneMapped={false} />
        </mesh>
      ))}
    </>
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
  mouseInfluence,
  arranged,
}) {
  const group = useRef(null);
  const { w, h } = useMemo(() => glyphMetrics(char), [char]);

  // arrangedX is the glyph's left-edge cursor position (from useLetterLayout);
  // convert to a center position so it matches the center-pivot group below.
  // y: 0 puts the glyph's own vertical center at world y=0 (the group's
  // position IS the glyph's center thanks to the center-pivot offset below),
  // so the arranged word sits truly vertically centered, not just baseline-
  // at-zero (which sat visibly above center).
  const arrangedPose = useMemo(
    () => ({ x: arrangedX + w / 2, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0 }),
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
    config: { mass: 2, tension: 170, friction: 22 },
  });

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    g.position.set(spring.x.get(), spring.y.get(), spring.z.get());
    let rx = spring.rotX.get();
    let ry = spring.rotY.get();
    const rz = spring.rotZ.get();
    // Only tilt toward the cursor while scattered — once arranged, the word
    // should read as a straight, centered logo, not lean with the mouse.
    if (mouseInfluence > 0 && !arranged) {
      const { x: px, y: py } = state.pointer;
      ry += px * mouseInfluence;
      rx += -py * mouseInfluence * 0.6;
    }
    g.rotation.set(rx, ry, rz);
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

function Scene({ arranged }) {
  const { letters, totalWidth } = useLetterLayout();
  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const glass = useControls("玻璃材质 glass", {
    // Thick, strongly refractive crystal: full transmission, thickness high
    // enough to visibly warp what's behind it, near-zero roughness for
    // crisp edges, and a strong chromatic fringe (visible red/green/violet
    // split at edges, not just a faint tint).
    transmission: { value: 1, min: 0, max: 1 },
    thickness: { value: 3, min: 0, max: 5 },
    roughness: { value: 0, min: 0, max: 1 },
    chromaticAberration: { value: 0.55, min: 0, max: 0.6 },
    ior: { value: 1.5, min: 1, max: 2.4 },
    samples: { value: 6, min: 1, max: 16, step: 1 },
    resolution: { value: 512, min: 32, max: 1024, step: 32 },
    transmissionSampler: true,
  });

  const scene = useControls("场景 scene", {
    envPreset: {
      // night: high dark/light contrast — crisp, directional highlights
      // instead of studio's evenly-lit softbox fog.
      value: "night",
      options: ["city", "night", "studio", "warehouse", "dawn"],
    },
    dropStagger: { value: 80, min: 0, max: 300, step: 10 },
    mouseInfluence: { value: 0.25, min: 0, max: 1 },
  });

  const bgTexture = useBrandGradientTexture();

  return (
    <>
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
      {/* sharp-edged colored backdrop for the glass to actually refract —
          see BackdropAccents above */}
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
            glass={glass}
            reduceMotion={reduceMotion}
            mouseInfluence={scene.mouseInfluence}
            arranged={arranged}
          />
        ))}
      </Suspense>
    </>
  );
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

export default function Hero3D() {
  const [isMobile, setIsMobile] = useState(false);
  const [arranged, setArranged] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const toggleArranged = useCallback(() => setArranged((a) => !a), []);

  if (isMobile) return <StaticFallback />;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [0, 0, 11], fov: 32, rotation: [-0.1, 0, 0] }}
        style={{ width: "100%", height: "100%", cursor: "pointer" }}
        onClick={toggleArranged}
        onCreated={(state) => state.camera.layers.enable(GLOW_LAYER)}
      >
        <Scene arranged={arranged} />
        {/* target [0,0,0] is where the letters live — DepthOfField reads the
            live camera-to-target distance every frame, so focus stays
            correct even though FitCamera moves the camera on resize.
            focusRange is in world units either side of that point: 1.4
            comfortably covers every letter's depth (they only ever span
            roughly ±0.5 units) while the foreground/background accent
            layers (2-9 units away) fall well outside it and blur. */}
        <EffectComposer>
          <DepthOfField target={[0, 0, 0]} focusRange={1.4} bokehScale={4} />
        </EffectComposer>
        {/* dev-only fps counter — never ships in the production/embedded build */}
        {import.meta.env.DEV && <Stats />}
      </Canvas>
      <div
        style={{
          position: "absolute",
          right: "1rem",
          bottom: "1rem",
          color: "rgba(8, 17, 96, 0.6)",
          fontFamily: "sans-serif",
          fontSize: "0.75rem",
          letterSpacing: "0.03em",
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        {arranged ? "click to scatter / 点击散开" : "click to arrange / 点击排列"}
      </div>
      {/* useControls elsewhere auto-mounts a global Leva panel unless one is
          rendered explicitly — this is that explicit mount, so `hidden` can
          hide it for the production/embedded build. transmission etc. still
          apply either way; only the floating control panel is affected. */}
      <Leva hidden={import.meta.env.PROD} />
    </div>
  );
}
