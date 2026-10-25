import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles/index.css";
import { App } from "./App";

const embedded =
  new URLSearchParams(window.location.search).get("embedded") === "1";
if (embedded) document.documentElement.dataset.embedded = "true";

const prefersLight =
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: light)").matches;
document.documentElement.dataset.theme = prefersLight ? "light" : "dark";
document.documentElement.style.colorScheme = prefersLight ? "light" : "dark";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App embedded={embedded} />
  </StrictMode>
);
