import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Hero3D from "./Hero3D.jsx";

const el = document.getElementById("hero-3d-root");

if (el) {
  createRoot(el).render(
    <StrictMode>
      <Hero3D />
    </StrictMode>,
  );
}
