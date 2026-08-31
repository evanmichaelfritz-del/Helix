/// <reference types="vite-plugin-pwa/client" />
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App.tsx";
import { bindGlassPress } from "./lib/glass-press.ts";
import { bindHaptics } from "./lib/haptics.ts";
import "./styles.css";

registerSW({ immediate: true });
bindGlassPress();
bindHaptics();

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
