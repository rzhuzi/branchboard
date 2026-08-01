(() => {
  if (globalThis.__branchboardFloatingCanvasLoaded) return;
  globalThis.__branchboardFloatingCanvasLoaded = true;
  const TEXT_RESPONSE_GRACE_MS = 10_000;
  const { uniqueByKey, sha256Hex, normalizeFloatingGeometry } =
    globalThis.__branchboardRuntimeUtils;

  const host = document.createElement("div");
  host.id = "branchboard-floating-canvas-host";
  host.style.position = "fixed";
  host.style.right = "18px";
  host.style.bottom = "18px";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";
  document.documentElement.appendChild(host);

  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host {
        all: initial;
        color-scheme: dark;
        font-family: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI",
          "Microsoft YaHei", Arial, sans-serif;
        --canvas-bg: #10161d;
        --titlebar-bg: #18212a;
        --toolbar-bg: #1d2731;
        --node-bg: #202a34;
        --inner-bg: #151d25;
        --hover-bg: #27333e;
        --border-default: #2b3742;
        --border-strong: #34414d;
        --text-primary: #e7ebef;
        --text-normal: #b7c0c9;
        --text-secondary: #8794a1;
        --text-placeholder: #65727f;
        --accent: #e9783e;
        --accent-hover: #f0864c;
        --accent-active: #ce6531;
        --accent-soft: rgba(233,120,62,.12);
        --accent-border: rgba(233,120,62,.45);
        --success: #70a989;
        --warning: #d9a35f;
        --danger: #d96c6c;
        --shadow-soft: rgba(8,12,16,.28);
        --shadow-card: rgba(8,12,16,.44);
      }
      :host(.theme-light) {
        color-scheme: light;
        --canvas-bg: #e7e3dd;
        --titlebar-bg: #dedad4;
        --toolbar-bg: #efebe5;
        --node-bg: #f7f4ef;
        --inner-bg: #ddd8d1;
        --hover-bg: #d5d0c9;
        --border-default: #cbc5bd;
        --border-strong: #b8b1a8;
        --text-primary: #27313a;
        --text-normal: #46525d;
        --text-secondary: #73808c;
        --text-placeholder: #929ca4;
        --success: #4f866b;
        --warning: #ad7734;
        --danger: #b84f4f;
        --shadow-soft: rgba(72,62,52,.18);
        --shadow-card: rgba(72,62,52,.26);
      }
      * { box-sizing: border-box; }
      button { font: inherit; }
      .orb {
        display: grid;
        pointer-events: auto;
        width: 50px;
        height: 50px;
        place-items: center;
        padding: 0;
        border: 1px solid var(--border-strong);
        border-radius: 12px;
        color: var(--text-normal);
        background: var(--toolbar-bg);
        box-shadow: 0 12px 30px var(--shadow-soft);
        cursor: grab;
        touch-action: none;
        transition: transform .16s ease, box-shadow .16s ease;
      }
      .orb svg {
        width: 31px;
        height: 31px;
        overflow: visible;
      }
      .orb .icon-frame,
      .orb .icon-link {
        fill: none;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .orb .icon-frame {
        stroke-width: 1.55;
        opacity: .62;
      }
      .orb .icon-link {
        stroke-width: 1.8;
      }
      .orb .icon-node {
        fill: var(--inner-bg);
        stroke: var(--text-secondary);
        stroke-width: .7;
      }
      .orb:hover {
        transform: translateY(-2px);
        background: var(--hover-bg);
        box-shadow: 0 15px 36px var(--shadow-soft);
      }
      .orb:active,
      .orb.dragging {
        cursor: grabbing;
        transform: scale(.97);
        box-shadow: 0 12px 34px var(--shadow-soft);
      }
      .orb.hidden { display: none; }
      .floating {
        position: relative;
        display: none;
        pointer-events: auto;
        width: min(860px, calc(100vw - 36px));
        height: min(690px, calc(100vh - 36px));
        min-width: min(520px, calc(100vw - 16px));
        min-height: min(420px, calc(100vh - 16px));
        overflow: hidden;
        resize: none;
        border: 1px solid var(--border-strong);
        border-radius: 12px;
        color: var(--text-normal);
        background: var(--canvas-bg);
        box-shadow: 0 24px 64px var(--shadow-card);
        animation: floating-in .18s ease-out;
      }
      .floating.open { display: block; }
      .shell-header {
        position: relative;
        z-index: 5;
        display: flex;
        height: 44px;
        align-items: center;
        justify-content: space-between;
        padding: 0 9px 0 12px;
        border-bottom: 1px solid var(--border-default);
        background: var(--titlebar-bg);
        cursor: grab;
        user-select: none;
      }
      .shell-header:active { cursor: grabbing; }
      .brand {
        display: flex;
        align-items: center;
        gap: 9px;
      }
      .mark {
        display: grid;
        width: 29px;
        height: 29px;
        place-items: center;
        border: 1px solid var(--border-default);
        border-radius: 7px;
        color: var(--text-normal);
        background: var(--toolbar-bg);
      }
      .mark svg {
        width: 19px;
        height: 19px;
        overflow: visible;
      }
      .mark .icon-frame,
      .mark .icon-link {
        fill: none;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .mark .icon-frame {
        stroke-width: 1.55;
        opacity: .62;
      }
      .mark .icon-link { stroke-width: 1.8; }
      .mark .icon-node {
        fill: var(--inner-bg);
        stroke: var(--text-secondary);
        stroke-width: .7;
      }
      .brand-copy {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .brand strong {
        color: var(--text-primary);
        font-size: 14px;
        font-weight: 600;
        letter-spacing: .01em;
      }
      .brand-copy span {
        color: var(--text-secondary);
        font-size: 8px;
        font-weight: 600;
        letter-spacing: .13em;
      }
      .shell-actions {
        display: flex;
        gap: 2px;
      }
      .shell-button {
        display: grid;
        width: 30px;
        height: 30px;
        place-items: center;
        border: 0;
        border-radius: 7px;
        color: var(--text-secondary);
        background: transparent;
        font-size: 16px;
        line-height: 1;
        cursor: pointer;
      }
      .shell-button:hover {
        color: var(--text-primary);
        background: var(--hover-bg);
      }
      .canvas-frame {
        display: block;
        width: 100%;
        height: calc(100% - 44px);
        border: 0;
        background: var(--canvas-bg);
      }
      .drop-catcher {
        position: absolute;
        z-index: 4;
        inset: 44px 0 0;
        display: none;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        border: 2px dashed var(--accent-border);
        color: var(--text-primary);
        background: rgba(16,22,29,.92);
      }
      .drop-catcher.active { display: flex; }
      .drop-catcher i {
        display: grid;
        width: 54px;
        height: 54px;
        place-items: center;
        border: 1px solid var(--accent-border);
        border-radius: 16px;
        color: var(--accent);
        background: var(--accent-soft);
        font-size: 24px;
        font-style: normal;
      }
      .drop-catcher strong {
        margin-top: 14px;
        font-size: 17px;
        font-weight: 600;
      }
      .drop-catcher span {
        margin-top: 5px;
        color: var(--text-secondary);
        font-size: 11px;
      }
      .toast {
        position: absolute;
        z-index: 8;
        right: 14px;
        bottom: 14px;
        display: none;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border: 1px solid var(--border-default);
        border-radius: 9px;
        color: var(--text-primary);
        background: rgba(29,39,49,.96);
        box-shadow: 0 16px 40px var(--shadow-card);
        font-size: 10px;
        font-weight: 700;
      }
      .toast.show { display: flex; }
      .toast i {
        display: grid;
        width: 18px;
        height: 18px;
        place-items: center;
        border-radius: 50%;
        color: var(--inner-bg);
        background: var(--success);
        font-size: 10px;
        font-style: normal;
      }
      .toast.warn i {
        color: var(--inner-bg);
        background: var(--warning);
      }
      .resize-handle {
        position: absolute;
        z-index: 9;
        right: 0;
        bottom: 0;
        width: 28px;
        height: 28px;
        border: 0;
        color: var(--text-secondary);
        background:
          linear-gradient(135deg, transparent 45%, rgba(135,148,161,.16) 46%, rgba(135,148,161,.16) 51%, transparent 52%),
          linear-gradient(135deg, transparent 62%, rgba(135,148,161,.24) 63%, rgba(135,148,161,.24) 68%, transparent 69%);
        cursor: nwse-resize;
      }
      .resize-handle:hover {
        color: var(--accent);
        background:
          linear-gradient(135deg, transparent 45%, rgba(233,120,62,.42) 46%, rgba(233,120,62,.42) 51%, transparent 52%),
          linear-gradient(135deg, transparent 62%, rgba(233,120,62,.65) 63%, rgba(233,120,62,.65) 68%, transparent 69%);
      }
      @keyframes floating-in {
        from { opacity: 0; transform: translateY(8px) scale(.99); }
      }
      @media (max-width: 650px) {
        .floating {
          width: calc(100vw - 16px);
          height: calc(100vh - 16px);
          min-width: 0;
          min-height: 0;
          resize: none;
        }
      }
    </style>
    <button class="orb" type="button" title="拖动定位，点击展开画布" aria-label="Branchboard 画布">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path class="icon-frame" d="M7.5 12V7.5H12M20 7.5h4.5V12M24.5 20v4.5H20M12 24.5H7.5V20"/>
        <path class="icon-link" d="m10.5 11.5 5 4.5 6-5M15.5 16v5"/>
        <circle class="icon-node" cx="10.5" cy="11.5" r="2.35"/>
        <circle class="icon-node" cx="21.5" cy="11" r="2.35"/>
        <circle class="icon-node" cx="15.5" cy="21" r="2.35"/>
      </svg>
    </button>
    <section class="floating" aria-label="Branchboard 浮动画布">
      <header class="shell-header">
        <div class="brand">
          <span class="mark" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <path class="icon-frame" d="M7.5 12V7.5H12M20 7.5h4.5V12M24.5 20v4.5H20M12 24.5H7.5V20"/>
              <path class="icon-link" d="m10.5 11.5 5 4.5 6-5M15.5 16v5"/>
              <circle class="icon-node" cx="10.5" cy="11.5" r="2.35"/>
              <circle class="icon-node" cx="21.5" cy="11" r="2.35"/>
              <circle class="icon-node" cx="15.5" cy="21" r="2.35"/>
            </svg>
          </span>
          <span class="brand-copy">
            <strong>分支画布</strong>
            <span>BRANCHBOARD</span>
          </span>
        </div>
        <div class="shell-actions">
          <button class="shell-button maximize" type="button" title="最大化">□</button>
          <button class="shell-button minimize" type="button" title="收起画布">—</button>
        </div>
      </header>
      <iframe class="canvas-frame" title="Branchboard 画布"></iframe>
      <div class="drop-catcher">
        <i>↙</i>
        <strong>放到画布里</strong>
        <span>图片会连接到当前选中的提示词节点</span>
      </div>
      <div class="toast"><i>✓</i><span></span></div>
      <button class="resize-handle" type="button" title="拖动调整画布大小"></button>
    </section>
  `;

  const orb = root.querySelector(".orb");
  const floating = root.querySelector(".floating");
  const header = root.querySelector(".shell-header");
  const minimize = root.querySelector(".minimize");
  const maximize = root.querySelector(".maximize");
  const frame = root.querySelector(".canvas-frame");
  const dropCatcher = root.querySelector(".drop-catcher");
  const resizeHandle = root.querySelector(".resize-handle");
  const toast = root.querySelector(".toast");
  const toastText = toast.querySelector("span");

  frame.src = `${chrome.runtime.getURL("canvas.html")}?embedded=1`;

  let open = false;
  let maximized = false;
  let dragState = null;
  let resizeState = null;
  let orbDragState = null;
  let suppressOrbClickUntil = 0;
  let floatingGeometry = null;
  let orbPosition = null;
  let savedGeometry = null;
  let toastTimer = null;
  let dragDepth = 0;
  let activeExecution = null;

  function showToast(message, warning = false) {
    if (toastTimer) clearTimeout(toastTimer);
    toastText.textContent = message;
    toast.classList.toggle("warn", warning);
    toast.querySelector("i").textContent = warning ? "!" : "✓";
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2300);
  }

  function setOpen(nextOpen) {
    if (nextOpen === open) return;
    if (nextOpen) {
      applyFloatingGeometry();
    } else {
      if (maximized) setMaximized(false);
      applyOrbPosition();
    }
    open = nextOpen;
    orb.classList.toggle("hidden", open);
    floating.classList.toggle("open", open);
    dropCatcher.classList.remove("active");
    dragDepth = 0;
    if (open) {
      window.setTimeout(() => {
        frame.contentWindow?.postMessage(
          { type: "branchboard:canvas-visible" },
          "*"
        );
      }, 80);
    }
  }

  function setMaximized(nextMaximized) {
    if (nextMaximized === maximized) return;
    maximized = nextMaximized;
    if (maximized) {
      savedGeometry = readFloatingGeometry();
      host.style.left = "10px";
      host.style.top = "10px";
      host.style.right = "10px";
      host.style.bottom = "10px";
      floating.style.width = "100%";
      floating.style.height = "100%";
      resizeHandle.style.display = "none";
      maximize.textContent = "❐";
      maximize.title = "还原";
      return;
    }

    floatingGeometry = savedGeometry || floatingGeometry;
    applyFloatingGeometry();
    resizeHandle.style.display = "";
    maximize.textContent = "□";
    maximize.title = "最大化";
  }

  async function persistGeometry() {
    if (maximized) return;
    floatingGeometry = readFloatingGeometry();
    await chrome.storage.local.set({
      floatingCanvasGeometry: floatingGeometry
    });
  }

  function readFloatingGeometry() {
    const hostRect = host.getBoundingClientRect();
    const floatingRect = floating.getBoundingClientRect();
    return {
      left: `${Math.round(hostRect.left)}px`,
      top: `${Math.round(hostRect.top)}px`,
      width: `${Math.round(floatingRect.width)}px`,
      height: `${Math.round(floatingRect.height)}px`
    };
  }

  function applyFloatingGeometry() {
    const normalized = normalizeFloatingGeometry(
      floatingGeometry,
      {
        width: window.innerWidth,
        height: window.innerHeight
      },
      {
        minWidth: 520,
        minHeight: 420,
        defaultWidth: 860,
        defaultHeight: 690,
        margin: 8
      }
    );
    floatingGeometry = {
      left: `${Math.round(normalized.left)}px`,
      top: `${Math.round(normalized.top)}px`,
      width: `${Math.round(normalized.width)}px`,
      height: `${Math.round(normalized.height)}px`
    };
    host.style.left = floatingGeometry.left;
    host.style.top = floatingGeometry.top;
    host.style.right = "auto";
    host.style.bottom = "auto";
    floating.style.width = floatingGeometry.width;
    floating.style.height = floatingGeometry.height;
  }

  function applyOrbPosition() {
    const left = Number(orbPosition?.left);
    const top = Number(orbPosition?.top);
    host.style.left = "";
    host.style.top = "";
    host.style.right = "18px";
    host.style.bottom = "18px";
    if (!Number.isFinite(left) || !Number.isFinite(top)) return;
    const maxLeft = Math.max(6, window.innerWidth - 56);
    const maxTop = Math.max(6, window.innerHeight - 56);
    host.style.left = `${Math.min(maxLeft, Math.max(6, left))}px`;
    host.style.top = `${Math.min(maxTop, Math.max(6, top))}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
  }

  async function persistOrbPosition() {
    const rect = host.getBoundingClientRect();
    orbPosition = {
      left: Math.round(rect.left),
      top: Math.round(rect.top)
    };
    await chrome.storage.local.set({
      floatingOrbPosition: orbPosition
    });
  }

  async function restoreGeometry() {
    const restored = await chrome.storage.local.get([
      "floatingCanvasGeometry",
      "floatingOrbPosition",
      "branchboardExecutionSettings"
    ]);
    floatingGeometry = restored.floatingCanvasGeometry || null;
    orbPosition = restored.floatingOrbPosition || null;
    host.classList.toggle(
      "theme-light",
      restored.branchboardExecutionSettings?.theme === "light"
    );
    if (open) {
      applyFloatingGeometry();
    } else {
      applyOrbPosition();
    }
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function saveImageBlob(
    blob,
    name,
    parentPromptId,
    canvasId,
    position
  ) {
    if (!blob.type.startsWith("image/")) {
      throw new Error("拖入的内容不是图片");
    }
    const dataUrl = await fileToDataUrl(blob);
    const response = await chrome.runtime.sendMessage({
      type: "branchboard:store-image",
      dataUrl,
      name,
      parentPromptId,
      canvasId,
      position
    });
    if (!response?.ok) throw new Error(response?.error || "保存图片失败");
    showToast("图片已加入画布");
  }

  function imageUrlFromTransfer(transfer) {
    const html = transfer.getData("text/html");
    if (html) {
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const source = parsed.querySelector("img")?.src || "";
      if (source) return source;
    }

    const uri = transfer
      .getData("text/uri-list")
      .split(/\r?\n/)
      .find((line) => line && !line.startsWith("#"));
    if (uri) return uri;
    return "";
  }

  async function receiveDrop(transfer) {
    const files = Array.from(transfer.files).filter((file) =>
      file.type.startsWith("image/")
    );
    if (files[0]) {
      await saveImageBlob(files[0], files[0].name || "ChatGPT 生成结果");
      return;
    }

    const imageUrl = imageUrlFromTransfer(transfer);
    if (!imageUrl) throw new Error("拖拽没有携带图片，请改用复制粘贴");
    const response = await fetch(imageUrl, { credentials: "include" });
    if (!response.ok) throw new Error("图片拖取受限，请改用复制粘贴");
    const blob = await response.blob();
    await saveImageBlob(blob, "ChatGPT 生成结果");
  }

  async function receiveDroppedImageUrl(message) {
    const imageUrl = String(message.imageUrl || "");
    if (!imageUrl) throw new Error("拖拽没有携带图片地址");
    const response = await fetch(imageUrl, { credentials: "include" });
    if (!response.ok) throw new Error("图片拖取受限，请改用复制粘贴");
    const blob = await response.blob();
    await saveImageBlob(
      blob,
      "拖入图片",
      String(message.parentPromptId || ""),
      String(message.canvasId || ""),
      message.position
    );
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function reportExecution(requestId, stage, message, details = {}) {
    const matchingExecution =
      activeExecution?.requestId === requestId ? activeExecution : null;
    frame.contentWindow?.postMessage(
      {
        type: "branchboard:execution-progress",
        requestId,
        promptId: details.promptId || matchingExe…755 tokens truncated…FileInput(timeout = 2400) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const input = findFileInput();
      if (input) return input;
      await wait(120);
    }
    return null;
  }

  function findAttachButton() {
    const selectors = [
      "button[data-testid='composer-plus-btn']",
      "button[aria-label*='Attach' i]",
      "button[aria-label*='Upload' i]",
      "button[aria-label*='添加']",
      "button[aria-label*='上传']"
    ];
    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button instanceof HTMLButtonElement) return button;
    }
    return null;
  }

  async function attachReferenceImage(referenceImage, signal) {
    let input = findFileInput();
    if (!input) {
      findAttachButton()?.click();
      input = await waitForFileInput();
    }
    if (!input) {
      throw new Error("找不到参考图上传入口，请改用标注模式添加图片");
    }

    const blob = await fetch(referenceImage.dataUrl, { signal }).then((response) =>
      response.blob()
    );
    const extension = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    const file = new File(
      [blob],
      referenceImage.name || `branchboard-reference.${extension}`,
      { type: blob.type || "image/png" }
    );
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const filesSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "files"
    )?.set;
    if (filesSetter) filesSetter.call(input, transfer.files);
    else input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(850);
  }

  function findSendButton() {
    const scope = findComposer()?.closest("form") || document;
    const selectors = [
      "button[data-testid='send-button']",
      "button[aria-label*='Send' i]",
      "button[aria-label*='发送']"
    ];
    for (const selector of selectors) {
      const button = scope.querySelector(selector);
      if (
        button instanceof HTMLButtonElement &&
        !button.disabled &&
        !button.hidden &&
        button.getClientRects().length
      ) {
        return button;
      }
    }
    return null;
  }

  async function waitForSendButton(execution, timeout = 10_000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      assertExecutionActive(execution);
      const button = findSendButton();
      if (button) return button;
      await wait(180);
    }
    throw new Error("提示词已填入，但发送按钮暂时不可用");
  }

  function conversationTurnNumber(element) {
    const section = element.closest("section[data-testid^='conversation-turn-']");
    const match = section?.getAttribute("data-testid")?.match(/conversation-turn-(\d+)/);
    return match ? Number(match[1]) : -1;
  }

  function latestConversationTurn() {
    return Math.max(
      -1,
      ...Array.from(
        document.querySelectorAll("section[data-testid^='conversation-turn-']")
      ).map((section) => {
        const match = section
          .getAttribute("data-testid")
          ?.match(/conversation-turn-(\d+)/);
        return match ? Number(match[1]) : -1;
      })
    );
  }

  function isGeneratedImage(image) {
    const alt = image.getAttribute("alt") || "";
    return (
      /^(?:已生成图片|generated image)\s*[:：]/i.test(alt) ||
      Boolean(image.closest('[class*="imagegen-image"]'))
    );
  }

  function generatedImageKey(image) {
    return image.currentSrc || image.src || "";
  }

  function generatedImageKeys() {
    return new Set(
      Array.from(document.querySelectorAll("img"))
        .filter((image) => image instanceof HTMLImageElement && isGeneratedImage(image))
        .map(generatedImageKey)
        .filter(Boolean)
    );
  }

  function newGeneratedImages(baselineTurn, baselineKeys) {
    const candidates = Array.from(document.querySelectorAll("img")).filter(
      (image) => {
        if (!(image instanceof HTMLImageElement)) return false;
        if (!isGeneratedImage(image)) return false;
        const key = generatedImageKey(image);
        if (!key || baselineKeys.has(key)) return false;
        const turn = conversationTurnNumber(image);
        if (baselineTurn >= 0 && turn >= 0 && turn <= baselineTurn) return false;
        return (
          image.complete &&
          image.naturalWidth >= 256 &&
          image.naturalHeight >= 256
        );
      }
    );
    return uniqueByKey(candidates, generatedImageKey);
  }

  function generatedImageName(image, fallbackTitle) {
    const alt = (image.getAttribute("alt") || "").replace(
      /^(?:已生成图片|generated image)\s*[:：]\s*/i,
      ""
    );
    return alt || fallbackTitle || "ChatGPT 生成结果";
  }

  async function blobFingerprint(blob) {
    return sha256Hex(await blob.arrayBuffer());
  }

  async function captureGeneratedImage(
    image,
    canvasId,
    promptId,
    fallbackTitle,
    signal,
    capturedFingerprints
  ) {
    const imageUrl = generatedImageKey(image);
    if (!imageUrl) throw new Error("生成图片没有可读取的地址");
    const response = await fetch(imageUrl, {
      credentials: "include",
      signal
    });
    if (!response.ok) {
      throw new Error(`读取生成图片失败 (${response.status})`);
    }
    const blob = await response.blob();
    const fingerprint = await blobFingerprint(blob);
    if (capturedFingerprints.has(fingerprint)) return false;
    capturedFingerprints.add(fingerprint);
    await saveImageBlob(
      blob,
      generatedImageName(image, fallbackTitle),
      promptId,
      canvasId
    );
    return true;
  }

  function findStopButton() {
    const selectors = [
      "button[data-testid='stop-button']",
      "button[aria-label*='Stop generating' i]",
      "button[aria-label*='Stop streaming' i]",
      "button[aria-label*='停止生成']",
      "button[aria-label*='停止回复']"
    ];
    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button instanceof HTMLButtonElement) return button;
    }
    return null;
  }

  function isResponseGenerating() {
    return Boolean(findStopButton());
  }

  function newAssistantTurns(baselineTurn) {
    const minimumTurn = baselineTurn + 2;
    return Array.from(
      document.querySelectorAll("section[data-testid^='conversation-turn-']")
    ).filter((section) => {
      const match = section
        .getAttribute("data-testid")
        ?.match(/conversation-turn-(\d+)/);
      const turn = match ? Number(match[1]) : -1;
      if (turn >= minimumTurn) return true;
      const heading = Array.from(section.querySelectorAll("h4, h5, h6"))
        .map((element) => element.textContent || "")
        .join(" ");
      return (
        turn > baselineTurn &&
        /ChatGPT|assistant|助手/i.test(heading)
      );
    });
  }

  function hasImageGenerationPlaceholder(turns) {
    return turns.some(
      (turn) =>
        turn.querySelector('[class*="imagegen"]') ||
        Array.from(turn.querySelectorAll("img")).some(
          (image) =>
            image instanceof HTMLImageElement && isGeneratedImage(image)
        )
    );
  }

  function assertExecutionActive(execution) {
    if (execution.cancelled || execution.controller.signal.aborted) {
      throw new DOMException("运行已取消", "AbortError");
    }
  }

  async function waitForGeneratedResults({
    requestId,
    canvasId,
    promptId,
    title,
    baselineTurn,
    baselineKeys,
    execution,
    timeout = 360_000
  }) {
    const startedAt = Date.now();
    let firstReadyAt = 0;
    let textResponseReadyAt = 0;

    reportExecution(requestId, "waiting", "ChatGPT 正在生成图片");
    while (Date.now() - startedAt < timeout) {
      assertExecutionActive(execution);
      const candidates = newGeneratedImages(baselineTurn, baselineKeys);
      if (!candidates.length) {
        firstReadyAt = 0;
        const assistantTurns = newAssistantTurns(baselineTurn);
        const responseStillRunning = isResponseGenerating();
        const imagePlaceholder = hasImageGenerationPlaceholder(assistantTurns);
        if (
          assistantTurns.length &&
          !responseStillRunning &&
          !imagePlaceholder
        ) {
          if (!textResponseReadyAt) textResponseReadyAt = Date.now();
          if (Date.now() - textResponseReadyAt >= TEXT_RESPONSE_GRACE_MS) {
            throw new Error("ChatGPT 返回了文字，没有生成图片");
          }
        } else {
          textResponseReadyAt = 0;
        }
        await wait(900);
        continue;
      }

      textResponseReadyAt = 0;
      if (!firstReadyAt) firstReadyAt = Date.now();
      if (Date.now() - firstReadyAt < 1600) {
        await wait(500);
        continue;
      }

      reportExecution(
        requestId,
        "capturing",
        `正在检查 ${candidates.length} 个生成结果`
      );
      const capturedFingerprints = new Set();
      let capturedCount = 0;
      for (const image of candidates) {
        assertExecutionActive(execution);
        if (await captureGeneratedImage(
          image,
          canvasId,
          promptId,
          title,
          execution.controller.signal,
          capturedFingerprints
        )) {
          capturedCount += 1;
        }
      }
      reportExecution(
        requestId,
        "captured",
        `${capturedCount} 张图片已自动回到画布`
      );
      showToast(`${capturedCount} 张图片已自动加入画布`);
      return;
    }

    throw new Error("等待生成图片超时，请检查 ChatGPT 是否生成成功");
  }

  async function executePrompt(message) {
    const requestId = String(message.requestId || "");
    if (!requestId) return;
    if (activeExecution) {
      reportExecution(requestId, "failed", "另一个节点正在执行", {
        promptId: String(message.promptId || ""),
        canvasId: String(message.canvasId || "")
      });
      return;
    }

    const execution = {
      requestId,
      canvasId: String(message.canvasId || ""),
      promptId: String(message.promptId || ""),
      cancelled: false,
      controller: new AbortController()
    };
    activeExecution = execution;
    try {
      const prompt = String(message.prompt || "").trim();
      if (!prompt) throw new Error("提示词是空的");

      if (message.referenceImage?.dataUrl) {
        reportExecution(requestId, "attaching", "正在附加上游参考图");
        await attachReferenceImage(
          message.referenceImage,
          execution.controller.signal
        );
      }

      assertExecutionActive(execution);
      reportExecution(requestId, "filling", "正在填入 ChatGPT");
      await fillComposer(prompt, execution);

      assertExecutionActive(execution);
      reportExecution(requestId, "sending", "正在发送");
      const baselineTurn = latestConversationTurn();
      const baselineKeys = generatedImageKeys();
      const sendButton = await waitForSendButton(execution);
      assertExecutionActive(execution);
      sendButton.click();
      reportExecution(requestId, "sent", "已经发送，等待 ChatGPT 生成");
      await waitForGeneratedResults({
        requestId,
        canvasId: execution.canvasId,
        promptId: String(message.promptId || ""),
        title: String(message.title || ""),
        baselineTurn,
        baselineKeys,
        execution
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      const messageText =
        error instanceof Error ? error.message : String(error);
      reportExecution(requestId, "failed", messageText);
      showToast(messageText, true);
    } finally {
      if (activeExecution === execution) activeExecution = null;
    }
  }

  function cancelExecution(promptIds) {
    if (!activeExecution || !promptIds.includes(activeExecution.promptId)) {
      return;
    }
    const execution = activeExecution;
    execution.cancelled = true;
    execution.controller.abort();
    activeExecution = null;
    findStopButton()?.click();
    reportExecution(
      execution.requestId,
      "cancelled",
      "节点已删除，运行已取消",
      {
        promptId: execution.promptId,
        canvasId: execution.canvasId
      }
    );
    showToast("已取消被删除节点的运行");
  }

  orb.addEventListener("click", () => {
    if (Date.now() < suppressOrbClickUntil) return;
    setOpen(true);
  });
  orb.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = host.getBoundingClientRect();
    host.style.left = `${rect.left}px`;
    host.style.top = `${rect.top}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
    orbDragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false
    };
  });
  window.addEventListener("pointermove", (event) => {
    if (!orbDragState || orbDragState.pointerId !== event.pointerId) return;
    if (
      Math.hypot(
        event.clientX - orbDragState.startX,
        event.clientY - orbDragState.startY
      ) >= 4
    ) {
      orbDragState.moved = true;
      orb.classList.add("dragging");
    }
    if (!orbDragState.moved) return;
    const maxLeft = Math.max(6, window.innerWidth - 56);
    const maxTop = Math.max(6, window.innerHeight - 56);
    host.style.left =
      `${Math.min(maxLeft, Math.max(6, event.clientX - orbDragState.offsetX))}px`;
    host.style.top =
      `${Math.min(maxTop, Math.max(6, event.clientY - orbDragState.offsetY))}px`;
  }, true);
  window.addEventListener("pointerup", (event) => {
    if (!orbDragState || orbDragState.pointerId !== event.pointerId) return;
    const moved = orbDragState.moved;
    orbDragState = null;
    orb.classList.remove("dragging");
    if (moved) {
      suppressOrbClickUntil = Date.now() + 250;
      void persistOrbPosition();
    }
  }, true);
  window.addEventListener("pointercancel", (event) => {
    if (!orbDragState || orbDragState.pointerId !== event.pointerId) return;
    orbDragState = null;
    orb.classList.remove("dragging");
    applyOrbPosition();
  }, true);
  minimize.addEventListener("click", () => setOpen(false));
  maximize.addEventListener("click", () => setMaximized(!maximized));

  header.addEventListener("pointerdown", (event) => {
    if (maximized || event.target.closest("button")) return;
    const rect = host.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    header.setPointerCapture(event.pointerId);
  });
  header.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const maxLeft = Math.max(6, window.innerWidth - host.offsetWidth - 6);
    const maxTop = Math.max(6, window.innerHeight - host.offsetHeight - 6);
    host.style.left = `${Math.min(maxLeft, Math.max(6, event.clientX - dragState.offsetX))}px`;
    host.style.top = `${Math.min(maxTop, Math.max(6, event.clientY - dragState.offsetY))}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
  });
  header.addEventListener("pointerup", (event) => {
    if (dragState?.pointerId === event.pointerId) {
      header.releasePointerCapture(event.pointerId);
      dragState = null;
      void persistGeometry();
    }
  });

  resizeHandle.addEventListener("pointerdown", (event) => {
    if (maximized) return;
    event.preventDefault();
    event.stopPropagation();
    const hostRect = host.getBoundingClientRect();
    const floatingRect = floating.getBoundingClientRect();
    host.style.left = `${hostRect.left}px`;
    host.style.top = `${hostRect.top}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
    resizeState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: floatingRect.width,
      height: floatingRect.height,
      left: hostRect.left,
      top: hostRect.top
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
    if (resizeState?.pointerId === event.pointerId) {
      resizeHandle.releasePointerCapture(event.pointerId);
      resizeState = null;
      void persistGeometry();
    }
  });

  document.addEventListener(
    "dragenter",
    (event) => {
      if (!open) return;
      dragDepth += 1;
      if (event.dataTransfer?.types?.length) {
        dropCatcher.classList.add("active");
      }
    },
    true
  );
  document.addEventListener(
    "dragleave",
    () => {
      if (!open) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) dropCatcher.classList.remove("active");
    },
    true
  );
  dropCatcher.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  dropCatcher.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    dropCatcher.classList.remove("active");
    if (!event.dataTransfer) return;
    void receiveDrop(event.dataTransfer).catch((error) =>
      showToast(error instanceof Error ? error.message : String(error), true)
    );
  });

  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow) return;
    if (event.data?.type === "branchboard:theme-change") {
      host.classList.toggle("theme-light", event.data.theme === "light");
      return;
    }
    if (event.data?.type === "branchboard:minimize-floating-canvas") {
      setOpen(false);
      return;
    }
    if (event.data?.type === "branchboard:execute-prompt") {
      void executePrompt(event.data);
      return;
    }
    if (event.data?.type === "branchboard:import-dropped-image") {
      void receiveDroppedImageUrl(event.data).catch((error) =>
        showToast(error instanceof Error ? error.message : String(error), true)
      );
      return;
    }
    if (event.data?.type === "branchboard:cancel-execution") {
      cancelExecution(
        Array.isArray(event.data.promptIds)
          ? event.data.promptIds.map(String)
          : []
      );
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "branchboard:toggle-floating-canvas") {
      setOpen(!open);
    }
  });

  let viewportResizeTimer = null;
  window.addEventListener("resize", () => {
    if (maximized) return;
    if (viewportResizeTimer) clearTimeout(viewportResizeTimer);
    viewportResizeTimer = window.setTimeout(() => {
      if (open) {
        floatingGeometry = readFloatingGeometry();
        applyFloatingGeometry();
        void persistGeometry();
      } else {
        applyOrbPosition();
        void persistOrbPosition();
      }
    }, 80);
  });

  void restoreGeometry();
})();

