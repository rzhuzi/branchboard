import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CanvasApp } from "./CanvasApp";

if (new URLSearchParams(window.location.search).get("embedded") === "1") {
  document.documentElement.dataset.embedded = "true";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CanvasApp />
  </StrictMode>
);

