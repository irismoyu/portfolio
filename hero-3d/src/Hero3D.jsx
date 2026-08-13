import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Text3D, Stats } from "@react-three/drei";
import { MeshTransmissionMaterial } from "@react-three/drei";
import { useSpring, animated } from "@react-spring/three";
import { useControls } from "leva";
import helvetikerBold from "three/examples/fonts/helvetiker_bold.typeface.json?url";

const NAME = "LIU YUMO";
const LETTER_SIZE = 1.3;
const LETTER_ADVANCE = 0.95;
const SPACE_ADVANCE = 0.7;

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
      cursor += LETTER_ADVANCE;
    }
    const totalWidth = cursor - LETTER_ADVANCE + LETTER_SIZE;
    return {
      letters: letters.map((l) => ({ ...l, x: l.x - (cursor - LETTER_ADVANCE) / 2 })),
      totalWidth,
    };
  }, []);
}

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

function Letter({ char, x, delay, glass, reduceMotion, mouseInfluence }) {
  const group = useRef(null);
  const [settled, setSettled] = useState(reduceMotion);

  const { y, rotX } = useSpring({
    from: { y: reduceMotion ? 0 : 6, rotX: reduceMotion ? 0 : -0.6 },
    to: { y: 0, rotX: 0 },
    delay: reduceMotion ? 0 : delay,
    immediate: reduceMotion,
    config: { mass: 2, tension: 170, friction: 20 },
    onRest: () => setSettled(true),
  });

  useFrame((state) => {
    if (!settled || !group.current || mouseInfluence === 0) return;
    const { x: px, y: py } = state.pointer;
    group.current.rotation.y +=
      (px * mouseInfluence - group.current.rotation.y) * 0.05;
    group.current.rotation.x +=
      (-py * mouseInfluence * 0.6 - group.current.rotation.x) * 0.05;
  });

  return (
    <animated.group ref={group} position-x={x} position-y={y} rotation-x={rotX}>
      <Text3D
        font={helvetikerBold}
        size={LETTER_SIZE}
        height={0.4}
        curveSegments={8}
        bevelEnabled
        bevelThickness={0.02}
        bevelSize={0.015}
        bevelSegments={3}
      >
        {char}
        <MeshTransmissionMaterial {...glass} />
      </Text3D>
    </animated.group>
  );
}

function Scene() {
  const { letters, totalWidth } = useLetterLayout();
  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const glass = useControls("玻璃材质 glass", {
    transmission: { value: 1, min: 0, max: 1 },
    thickness: { value: 1.2, min: 0, max: 5 },
    roughness: { value: 0.05, min: 0, max: 1 },
    chromaticAberration: { value: 0.06, min: 0, max: 0.3 },
    ior: { value: 1.4, min: 1, max: 2.4 },
    samples: { value: 4, min: 1, max: 16, step: 1 },
    resolution: { value: 256, min: 32, max: 1024, step: 32 },
    transmissionSampler: true,
  });

  const scene = useControls("场景 scene", {
    envPreset: {
      value: "city",
      options: ["city", "night", "studio", "warehouse", "dawn"],
    },
    dropStagger: { value: 80, min: 0, max: 300, step: 10 },
    mouseInfluence: { value: 0.25, min: 0, max: 1 },
  });

  return (
    <>
      <FitCamera width={totalWidth} margin={1.9} />
      <color attach="background" args={["#081160"]} />
      <ambientLight intensity={0.3} />
      <Suspense fallback={null}>
        <Environment preset={scene.envPreset} />
      </Suspense>
      <Suspense fallback={null}>
        {letters.map((l, i) => (
          <Letter
            key={l.char + i}
            char={l.char}
            x={l.x}
            delay={i * scene.dropStagger}
            glass={glass}
            reduceMotion={reduceMotion}
            mouseInfluence={scene.mouseInfluence}
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
        background: "#081160",
        color: "#e8ecff",
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

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (isMobile) return <StaticFallback />;

  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 11], fov: 32 }}
      style={{ width: "100%", height: "100%" }}
    >
      <Scene />
      <Stats />
    </Canvas>
  );
}
