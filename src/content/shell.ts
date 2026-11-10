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
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        -webkit-font-smoothing: antialiased;
        --bb-canvas-bg: #1e2023;
        --bb-surface: #282b2f;
        --bb-surface-raised: #303438;
        --bb-surface-hover: #373c3f;
        --bb-border: #373d3f;
        --bb-border-strong: #464d4f;
        --bb-text: #edeef0;
        --bb-text-muted: #a1a8a5;
        --bb-text-faint: #717975;
        --bb-accent: #99bba4;
        --bb-success: #99bba4;
        --bb-danger: #d87575;
        --bb-shadow: 0 28px 80px rgba(0,0,0,.4), 0 4px 18px rgba(0,0,0,.2);
        --bb-orb-shadow: 0 6px 20px rgba(0,0,0,.24), 0 1px 4px rgba(0,0,0,.12);
        --bb-pulse: rgba(153,187,164,.3);
      }
      :host(.light) {
        color-scheme: light;
        --bb-canvas-bg: #f4f5f5;
        --bb-surface: #ffffff;
        --bb-surface-raised: #ffffff;
        --bb-surface-hover: #f0f3f1;
        --bb-border: #e5e9e6;
        --bb-border-strong: #d4dad6;
        --bb-text: #262c29;
        --bb-text-muted: #737c76;
        --bb-text-faint: #9ca59f;
        --bb-accent: #50775e;
        --bb-success: #50775e;
        --bb-danger: #b25353;
        --bb-shadow: 0 28px 80px rgba(25,36,29,.18), 0 4px 18px rgba(25,36,29,.08);
        --bb-orb-shadow: 0 6px 20px rgba(25,36,29,.12), 0 1px 4px rgba(25,36,29,.06);
        --bb-pulse: rgba(80,119,94,.3);
      }
      * { box-sizing: border-box; }
      button { font: inherit; }
      button:focus-visible { outline: 2px solid var(--bb-accent); outline-offset: 3px; }

      .orb {
        position: fixed;
        right: 18px;
        bottom: 18px;
        display: grid;
        width: 48px;
        height: 48px;
        place-items: center;
        padding: 0;
        border: 1px solid #819d87;
        border-radius: 13px;
        color: #f4f8f2;
        background: #2b4334;
        box-shadow: var(--bb-orb-shadow);
        cursor: grab;
        pointer-events: auto;
        touch-action: none;
        transition: transform .16s ease, background .16s ease, box-shadow .16s ease;
      }
      .orb:hover { color: #ffffff; background: #35543f; transform: translateY(-1px); }
      .orb:active, .orb.dragging { cursor: grabbing; transform: scale(.97); }
      .orb.hidden { display: none; }
      .orb svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 1.65; stroke-linecap: round; stroke-linejoin: round; overflow: visible; }
      .orb svg circle { fill: #bcdab1; stroke: none; }
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
      @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 var(--bb-pulse); } 50% { box-shadow: 0 0 0 5px transparent; } }

      .floating {
        position: fixed;
        z-index: 2;
        display: none;
        overflow: hidden;
        border: 1px solid var(--bb-border-strong);
        border-radius: 14px;
        background: var(--bb-canvas-bg);
        box-shadow: var(--bb-shadow);
        pointer-events: auto;
      }
      .floating.open { display: block; }

      .shell-header {
        position: relative;
        z-index: 2;
        display: flex;
        height: 32px;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        padding: 0 6px;
        background: var(--bb-surface);
        cursor: grab;
        user-select: none;
        touch-action: none;
      }
      .shell-header:active { cursor: grabbing; }
      .shell-grip { position: absolute; top: 14px; left: 50%; width: 30px; height: 3px; transform: translateX(-50%); border-radius: 2px; background: var(--bb-border-strong); }
      .floating.maximized .shell-header { cursor: default; }
      .shell-actions { display: flex; gap: 3px; }
      .shell-button {
        display: grid;
        width: 30px;
        height: 25px;
        place-items: center;
        padding: 0;
        border: 0;
        border-radius: 5px;
        color: var(--bb-text-muted);
        background: transparent;
        cursor: pointer;
      }
      .shell-button:hover { color: var(--bb-text); background: var(--bb-surface-hover); }
      .shell-button svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

      .canvas-frame {
        display: block;
        width: 100%;
        height: calc(100% - 32px);
        border: 0;
        background: var(--bb-canvas-bg);
      }

      .resize-handle {
        position: absolute;
        z-index: 3;
        right: 0;
        bottom: 0;
        width: 22px;
        height: 22px;
        border: 0;
        background:
          linear-gradient(135deg, transparent 57%, var(--bb-border-strong) 58%, var(--bb-border-strong) 62%, transparent 63%),
          linear-gradient(135deg, transparent 74%, var(--bb-border-strong) 75%, var(--bb-border-strong) 79%, transparent 80%);
        cursor: nwse-resize;
      }
      .resize-handle:hover {
        background:
          linear-gradient(135deg, transparent 57%, var(--bb-accent) 58%, var(--bb-accent) 62%, transparent 63%),
          linear-gradient(135deg, transparent 74%, var(--bb-accent) 75%, var(--bb-accent) 79%, transparent 80%);
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
        gap: 9px;
        padding: 10px 13px;
        border: 1px solid var(--bb-border);
        border-radius: 9px;
        color: var(--bb-text);
        background: var(--bb-surface-raised);
        box-shadow: var(--bb-orb-shadow);
        font-size: 12px;
        line-height: 1.5;
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
        background: transparent;
        font-size: 10px;
        font-weight: 700;
      }
      .toast.warn { border-color: var(--bb-danger); }
      .toast.warn .toast-mark { color: var(--bb-danger); background: rgba(216,117,117,.13); }

      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation: none !important; transition: none !important; }
      }

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
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 5v14h5a5 5 0 0 0 0-10H5m5 0h3a4 4 0 0 0 0-8H9"/>
        <circle cx="18" cy="18" r="2"/>
      </svg>
      <span class="orb-status"></span>
    </button>
    <section class="floating" aria-label="Branchboard 浮动画布">
      <header class="shell-header" title="拖动窗口 · 双击最大化或还原">
        <span class="shell-grip" aria-hidden="true"></span>
        <div class="shell-actions">
          <button class="shell-button minimize" type="button" title="收起画布" aria-label="收起画布">
            <svg viewBox="0 0 20 20"><path d="M4.5 10h11"/></svg>
          </button>
          <button class="shell-button maximize" type="button" title="最大化" aria-label="最大化">
            <svg viewBox="0 0 20 20"><rect x="4.5" y="4.5" width="11" height="11" rx="1"/></svg>
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
        defaultWidth: 1040,
        defaultHeight: 760,
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
    floating.classList.toggle("maximized", maximized);
    maximize.setAttribute("aria-pressed", String(maximized));
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
