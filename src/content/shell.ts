import {
  normalizeFloatingGeometry,
  type FloatingGeometry
} from "../shared/geometry";
import type { Theme } from "../shared/types";

const GEOMETRY_KEY = "floatingCanvasGeometry";
const ORB_KEY = "floatingOrbPosition";

type OrbPosition = {
  left: number;
  top: number;
};

export type ActivityState = "idle" | "running" | "done" | "error";

export type FloatingShell = {
  frame: HTMLIFrameElement;
  isOpen: () => boolean;
  setOpen: (open: boolean) => void;
  showToast: (message: string, warning?: boolean) => void;
  setActivity: (state: ActivityState) => void;
  applyTheme: (theme: Theme) => void;
};

function storageGet<T>(key: string): Promise<T | null> {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    return chrome.storage.local.get(key).then((result) => {
      return (result[key] as T | undefined) ?? null;
    });
  }
  try {
    const stored = localStorage.getItem(key);
    return Promise.resolve(stored ? (JSON.parse(stored) as T) : null);
  } catch {
    return Promise.resolve(null);
  }
}

function storageSet(key: string, value: unknown): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    return chrome.storage.local.set({ [key]: value });
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Window geometry is a convenience, not critical data.
  }
  return Promise.resolve();
}

export function createFloatingShell(): FloatingShell {
  const host = document.createElement("div");
  host.id = "branchboard-floating-canvas-host";
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: "open" });

  root.innerHTML = `
    <style>
      :host {
        all: initial;
        color-scheme: dark;
        font-family: "Segoe UI Variable Text", "PingFang SC", "Microsoft YaHei UI",
          "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
        --bb-canvas-bg: #101315;
        --bb-surface: #171b1f;
        --bb-surface-raised: #1d2227;
        --bb-surface-hover: #242a30;
        --bb-border: #2a3036;
        --bb-border-strong: #3a424a;
        --bb-text: #e8eaed;
        --bb-text-muted: #8d969f;
        --bb-text-faint: #646d76;
        --bb-accent: #df7c46;
        --bb-success: #69b18c;
        --bb-danger: #d87575;
        --bb-shadow: 0 18px 48px rgba(0,0,0,.42);
      }
      :host(.light) {
        color-scheme: light;
        --bb-canvas-bg: #f2f1ee;
        --bb-surface: #fbfaf8;
        --bb-surface-raised: #ffffff;
        --bb-surface-hover: #f0ece7;
        --bb-border: #ddd9d2;
        --bb-border-strong: #c7c1b8;
        --bb-text: #252b31;
        --bb-text-muted: #6d757d;
        --bb-text-faint: #979ea5;
        --bb-accent: #c65f2f;
        --bb-success: #42805e;
        --bb-danger: #b25353;
        --bb-shadow: 0 18px 48px rgba(60,52,44,.24);
      }
      * { box-sizing: border-box; }
      button { font: inherit; }

      .orb {
        position: fixed;
        right: 18px;
        bottom: 18px;
        display: grid;
        width: 48px;
        height: 48px;
        place-items: center;
        padding: 0;
        border: 1px solid var(--bb-border-strong);
        border-radius: 10px;
        color: var(--bb-text-muted);
        background: var(--bb-surface);
        box-shadow: 0 10px 28px rgba(0,0,0,.32);
        cursor: grab;
        pointer-events: auto;
        touch-action: none;
        transition: transform .14s ease, background .14s ease;
      }
      .orb:hover { color: var(--bb-text); background: var(--bb-surface-hover); transform: translateY(-1px); }
      .orb:active, .orb.dragging { cursor: grabbing; transform: scale(.97); }
      .orb.hidden { display: none; }
      .orb svg { width: 28px; height: 28px; overflow: visible; }
      .orb .frame { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; opacity: .55; }
      .orb .link { fill: none; stroke: var(--bb-accent); stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
      .orb .node { fill: var(--bb-surface-raised); stroke: var(--bb-text-muted); stroke-width: .7; }
      .orb-status {
        position: absolute;
        top: -2px;
        right: -2px;
        width: 10px;
        height: 10px;
        border: 2px solid var(--bb-surface);
        border-radius: 50%;
        background: transparent;
        opacity: 0;
        transform: scale(.5);
        transition: opacity .15s ease, transform .15s ease;
      }
      .orb-status.running { opacity: 1; transform: scale(1); background: var(--bb-accent); animation: pulse 1.3s ease-in-out infinite; }
      .orb-status.done { opacity: 1; transform: scale(1); background: var(--bb-success); }
      .orb-status.error { opacity: 1; transform: scale(1); background: var(--bb-danger); }
      @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(223,124,70,.42); } 50% { box-shadow: 0 0 0 6px rgba(223,124,70,0); } }

      .floating {
        position: fixed;
        z-index: 2;
        display: none;
        overflow: hidden;
        border: 1px solid var(--bb-border-strong);
        border-radius: 10px;
        background: var(--bb-canvas-bg);
        box-shadow: var(--bb-shadow);
        pointer-events: auto;
      }
      .floating.open { display: block; }

      .shell-header {
        position: relative;
        z-index: 2;
        display: flex;
        height: 36px;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 0 6px 0 10px;
        border-bottom: 1px solid var(--bb-border);
        background: var(--bb-surface);
        cursor: grab;
        user-select: none;
      }
      .shell-header:active { cursor: grabbing; }
      .shell-brand { display: flex; align-items: center; gap: 7px; color: var(--bb-text); font-size: 11.5px; font-weight: 600; letter-spacing: .01em; }
      .shell-brand svg { width: 19px; height: 19px; overflow: visible; }
      .shell-brand .frame { fill: none; stroke: var(--bb-text-muted); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; opacity: .55; }
      .shell-brand .link { fill: none; stroke: var(--bb-accent); stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
      .shell-brand .node { fill: var(--bb-surface-raised); stroke: var(--bb-text-muted); stroke-width: .7; }
      .shell-actions { display: flex; gap: 1px; }
      .shell-button {
        display: grid;
        width: 28px;
        height: 26px;
        place-items: center;
        border-radius: 4px;
        color: var(--bb-text-muted);
        background: transparent;
      }
      .shell-button:hover { color: var(--bb-text); background: var(--bb-surface-hover); }
      .shell-button svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

      .canvas-frame {
        display: block;
        width: 100%;
        height: calc(100% - 36px);
        border: 0;
        background: var(--bb-canvas-bg);
      }

      .resize-handle {
        position: absolute;
        z-index: 3;
        right: 0;
        bottom: 0;
        width: 20px;
        height: 20px;
        border: 0;
        background:
          linear-gradient(135deg, transparent 48%, rgba(135,148,161,.25) 49%, rgba(135,148,161,.25) 54%, transparent 55%),
          linear-gradient(135deg, transparent 66%, rgba(135,148,161,.32) 67%, rgba(135,148,161,.32) 72%, transparent 73%);
        cursor: nwse-resize;
      }
      .resize-handle:hover {
        background:
          linear-gradient(135deg, transparent 48%, var(--bb-accent) 49%, var(--bb-accent) 54%, transparent 55%),
          linear-gradient(135deg, transparent 66%, var(--bb-accent) 67%, var(--bb-accent) 72%, transparent 73%);
      }
      .resize-handle.hidden { display: none; }

      .toast {
        position: fixed;
        z-index: 6;
        right: 18px;
        bottom: 78px;
        display: flex;
        max-width: min(320px, calc(100vw - 36px));
        align-items: center;
        gap: 7px;
        padding: 8px 10px;
        border: 1px solid var(--bb-border-strong);
        border-radius: 7px;
        color: var(--bb-text);
        background: var(--bb-surface-raised);
        box-shadow: var(--bb-shadow);
        font-size: 10.5px;
        line-height: 1.4;
        pointer-events: none;
        opacity: 0;
        transform: translateY(5px);
        transition: opacity .16s ease, transform .16s ease;
      }
      .toast.show { opacity: 1; transform: translateY(0); }
      .toast-mark {
        display: grid;
        width: 17px;
        height: 17px;
        flex: none;
        place-items: center;
        border-radius: 50%;
        color: var(--bb-success);
        background: rgba(105,177,140,.13);
        font-size: 10px;
        font-weight: 700;
      }
      .toast.warn { border-color: var(--bb-danger); }
      .toast.warn .toast-mark { color: var(--bb-danger); background: rgba(216,117,117,.13); }

      @media (max-width: 640px) {
        .floating {
          left: 8px !important;
          top: 8px !important;
          width: calc(100vw - 16px) !important;
          height: calc(100vh - 16px) !important;
        }
      }
    </style>
    <button class="orb" type="button" title="打开 Branchboard 画布" aria-label="Branchboard 画布">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path class="frame" d="M7.5 12V7.5H12M20 7.5h4.5V12M24.5 20v4.5H20M12 24.5H7.5V20"/>
        <path class="link" d="m10.5 11.5 5 4.5 6-5M15.5 16v5"/>
        <circle class="node" cx="10.5" cy="11.5" r="2.35"/>
        <circle class="node" cx="21.5" cy="11" r="2.35"/>
        <circle class="node" cx="15.5" cy="21" r="2.35"/>
      </svg>
      <span class="orb-status"></span>
    </button>
    <section class="floating" aria-label="Branchboard 浮动画布">
      <header class="shell-header">
        <div class="shell-brand">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path class="frame" d="M7.5 12V7.5H12M20 7.5h4.5V12M24.5 20v4.5H20M12 24.5H7.5V20"/>
            <path class="link" d="m10.5 11.5 5 4.5 6-5M15.5 16v5"/>
            <circle class="node" cx="10.5" cy="11.5" r="2.35"/>
            <circle class="node" cx="21.5" cy="11" r="2.35"/>
            <circle class="node" cx="15.5" cy="21" r="2.35"/>
          </svg>
          <span>Branchboard</span>
        </div>
        <div class="shell-actions">
          <button class="shell-button maximize" type="button" title="最大化" aria-label="最大化">
            <svg viewBox="0 0 20 20"><rect x="4.5" y="4.5" width="11" height="11" rx="1"/></svg>
          </button>
          <button class="shell-button minimize" type="button" title="收起画布" aria-label="收起画布">
            <svg viewBox="0 0 20 20"><path d="M4.5 10h11"/></svg>
          </button>
        </div>
      </header>
      <iframe class="canvas-frame" title="Branchboard 画布"></iframe>
      <button class="resize-handle" type="button" title="拖动调整画布大小" aria-label="拖动调整画布大小"></button>
    </section>
    <div class="toast" role="status" aria-live="polite"><i class="toast-mark">✓</i><span class="toast-text"></span></div>
  `;

  const orb = root.querySelector<HTMLButtonElement>(".orb")!;
  const statusDot = root.querySelector<HTMLSpanElement>(".orb-status")!;
  const floating = root.querySelector<HTMLElement>(".floating")!;
  const header = root.querySelector<HTMLElement>(".shell-header")!;
  const minimize = root.querySelector<HTMLButtonElement>(".minimize")!;
  const maximize = root.querySelector<HTMLButtonElement>(".maximize")!;
  const frame = root.querySelector<HTMLIFrameElement>(".canvas-frame")!;
  const resizeHandle = root.querySelector<HTMLButtonElement>(".resize-handle")!;
  const toast = root.querySelector<HTMLElement>(".toast")!;
  const toastMark = root.querySelector<HTMLElement>(".toast-mark")!;
  const toastText = root.querySelector<HTMLElement>(".toast-text")!;

  frame.src = `${chrome.runtime.getURL("canvas.html")}?embedded=1`;

  let open = false;
  let maximized = false;
  let savedGeometry: FloatingGeometry | null = null;
  let floatingGeometry: FloatingGeometry | null = null;
  let orbPosition: OrbPosition | null = null;
  let toastTimer = 0;
  let activityTimer = 0;
  let dragState: { pointerId: number; offsetX: number; offsetY: number } | null = null;
  let orbDrag: {
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null = null;
  let resizeState: {
    pointerId: number;
    startX: number;
    startY: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null = null;
  let suppressOrbClickUntil = 0;

  function showToast(message: string, warning = false) {
    if (!message) return;
    window.clearTimeout(toastTimer);
    toastText.textContent = message;
    toastMark.textContent = warning ? "!" : "✓";
    toast.classList.toggle("warn", warning);
    toast.classList.add("show");
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3400);
  }

  function setActivity(state: ActivityState) {
    window.clearTimeout(activityTimer);
    statusDot.className = "orb-status";
    if (state !== "idle") statusDot.classList.add(state);
    if (state === "done") {
      activityTimer = window.setTimeout(() => setActivity("idle"), 4200);
    }
  }

  function applyTheme(theme: Theme) {
    host.classList.toggle("light", theme === "light");
  }

  function applyOrbPosition() {
    orb.style.left = "";
    orb.style.top = "";
    orb.style.right = "18px";
    orb.style.bottom = "18px";
    if (!orbPosition) return;
    const maxLeft = Math.max(6, window.innerWidth - 54);
    const maxTop = Math.max(6, window.innerHeight - 54);
    orb.style.left = `${Math.min(maxLeft, Math.max(6, orbPosition.left))}px`;
    orb.style.top = `${Math.min(maxTop, Math.max(6, orbPosition.top))}px`;
    orb.style.right = "auto";
    orb.style.bottom = "auto";
  }

  function readGeometry(): FloatingGeometry {
    const rect = floating.getBoundingClientRect();
    return {
      left: `${Math.round(rect.left)}px`,
      top: `${Math.round(rect.top)}px`,
      width: `${Math.round(rect.width)}px`,
      height: `${Math.round(rect.height)}px`
    };
  }

  function applyGeometry() {
    const normalized = normalizeFloatingGeometry(
      floatingGeometry,
      { width: window.innerWidth, height: window.innerHeight },
      {
        minWidth: 520,
        minHeight: 420,
        defaultWidth: 900,
        defaultHeight: 700,
        margin: 8
      }
    );
    floatingGeometry = {
      left: `${normalized.left}px`,
      top: `${normalized.top}px`,
      width: `${normalized.width}px`,
      height: `${normalized.height}px`
    };
    floating.style.left = floatingGeometry.left;
    floating.style.top = floatingGeometry.top;
    floating.style.width = floatingGeometry.width;
    floating.style.height = floatingGeometry.height;
  }

  function persistGeometry() {
    if (maximized) return;
    floatingGeometry = readGeometry();
    void storageSet(GEOMETRY_KEY, floatingGeometry);
  }

  function persistOrbPosition() {
    const rect = orb.getBoundingClientRect();
    orbPosition = { left: Math.round(rect.left), top: Math.round(rect.top) };
    void storageSet(ORB_KEY, orbPosition);
  }

  function setMaximized(next: boolean) {
    if (next === maximized) return;
    maximized = next;
    if (maximized) {
      savedGeometry = readGeometry();
      floating.style.left = "8px";
      floating.style.top = "8px";
      floating.style.width = "calc(100vw - 16px)";
      floating.style.height = "calc(100vh - 16px)";
      resizeHandle.classList.add("hidden");
      maximize.title = "还原";
      maximize.setAttribute("aria-label", "还原窗口");
      maximize.innerHTML =
        '<svg viewBox="0 0 20 20"><rect x="6" y="6" width="9" height="9" rx="1"/><path d="M4.5 12V4.5H12"/></svg>';
    } else {
      floatingGeometry = savedGeometry ?? floatingGeometry;
      applyGeometry();
      resizeHandle.classList.remove("hidden");
      maximize.title = "最大化";
      maximize.setAttribute("aria-label", "最大化");
      maximize.innerHTML =
        '<svg viewBox="0 0 20 20"><rect x="4.5" y="4.5" width="11" height="11" rx="1"/></svg>';
    }
  }

  function setOpen(next: boolean) {
    if (next === open) return;
    if (next) {
      applyGeometry();
    } else {
      if (maximized) setMaximized(false);
      applyOrbPosition();
    }
    open = next;
    orb.classList.toggle("hidden", open);
    floating.classList.toggle("open", open);
    if (open) setActivity("idle");
  }

  orb.addEventListener("click", () => {
    if (Date.now() < suppressOrbClickUntil) return;
    setOpen(true);
  });

  orb.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = orb.getBoundingClientRect();
    orbDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false
    };
  });

  window.addEventListener(
    "pointermove",
    (event) => {
      if (!orbDrag || orbDrag.pointerId !== event.pointerId) return;
      if (
        Math.hypot(
          event.clientX - orbDrag.startX,
          event.clientY - orbDrag.startY
        ) >= 4
      ) {
        orbDrag.moved = true;
        orb.classList.add("dragging");
      }
      if (!orbDrag.moved) return;
      const maxLeft = Math.max(6, window.innerWidth - 54);
      const maxTop = Math.max(6, window.innerHeight - 54);
      orb.style.left = `${Math.min(maxLeft, Math.max(6, event.clientX - orbDrag.offsetX))}px`;
      orb.style.top = `${Math.min(maxTop, Math.max(6, event.clientY - orbDrag.offsetY))}px`;
      orb.style.right = "auto";
      orb.style.bottom = "auto";
    },
    true
  );

  window.addEventListener(
    "pointerup",
    (event) => {
      if (!orbDrag || orbDrag.pointerId !== event.pointerId) return;
      const moved = orbDrag.moved;
      orbDrag = null;
      orb.classList.remove("dragging");
      if (moved) {
        suppressOrbClickUntil = Date.now() + 250;
        persistOrbPosition();
      }
    },
    true
  );

  window.addEventListener("pointercancel", () => {
    orbDrag = null;
    orb.classList.remove("dragging");
    applyOrbPosition();
  });

  header.addEventListener("pointerdown", (event) => {
    if (maximized || event.target instanceof Element && event.target.closest("button")) {
      return;
    }
    const rect = floating.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    header.setPointerCapture(event.pointerId);
  });

  header.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const maxLeft = Math.max(6, window.innerWidth - floating.offsetWidth - 6);
    const maxTop = Math.max(6, window.innerHeight - floating.offsetHeight - 6);
    floating.style.left = `${Math.min(maxLeft, Math.max(6, event.clientX - dragState.offsetX))}px`;
    floating.style.top = `${Math.min(maxTop, Math.max(6, event.clientY - dragState.offsetY))}px`;
  });

  header.addEventListener("pointerup", (event) => {
    if (dragState?.pointerId !== event.pointerId) return;
    header.releasePointerCapture(event.pointerId);
    dragState = null;
    persistGeometry();
  });

  header.addEventListener("dblclick", (event) => {
    if (event.target instanceof Element && event.target.closest("button")) return;
    setMaximized(!maximized);
  });

  resizeHandle.addEventListener("pointerdown", (event) => {
    if (maximized) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = floating.getBoundingClientRect();
    resizeState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
    resizeHandle.setPointerCapture(event.pointerId);
  });

  resizeHandle.addEventListener("pointermove", (event) => {
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    const minWidth = Math.min(520, window.innerWidth - 16);
    const minHeight = Math.min(420, window.innerHeight - 16);
    const maxWidth = Math.max(minWidth, window.innerWidth - resizeState.left - 8);
    const maxHeight = Math.max(minHeight, window.innerHeight - resizeState.top - 8);
    const width = Math.min(
      maxWidth,
      Math.max(minWidth, resizeState.width + event.clientX - resizeState.startX)
    );
    const height = Math.min(
      maxHeight,
      Math.max(minHeight, resizeState.height + event.clientY - resizeState.startY)
    );
    floating.style.width = `${width}px`;
    floating.style.height = `${height}px`;
  });

  resizeHandle.addEventListener("pointerup", (event) => {
    if (resizeState?.pointerId !== event.pointerId) return;
    resizeHandle.releasePointerCapture(event.pointerId);
    resizeState = null;
    persistGeometry();
  });

  minimize.addEventListener("click", () => setOpen(false));
  maximize.addEventListener("click", () => setMaximized(!maximized));

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    if (maximized) return;
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (open) {
        floatingGeometry = readGeometry();
        applyGeometry();
        persistGeometry();
      } else {
        applyOrbPosition();
        persistOrbPosition();
      }
    }, 80);
  });

  void (async () => {
    const [storedGeometry, storedOrb] = await Promise.all([
      storageGet<FloatingGeometry>(GEOMETRY_KEY),
      storageGet<OrbPosition>(ORB_KEY)
    ]);
    floatingGeometry = storedGeometry;
    orbPosition = storedOrb;
    if (open) applyGeometry();
    else applyOrbPosition();
  })();

  applyOrbPosition();

  return {
    frame,
    isOpen: () => open,
    setOpen,
    showToast,
    setActivity,
    applyTheme
  };
}
