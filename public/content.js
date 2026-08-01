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
    <button class="orb" type="button" title="æ‹–åŠ¨å®šä½ï¼Œç‚¹å‡»å±•å¼€ç”»å¸ƒ" aria-label="Branchboard ç”»å¸ƒ">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path class="icon-frame" d="M7.5 12V7.5H12M20 7.5h4.5V12M24.5 20v4.5H20M12 24.5H7.5V20"/>
        <path class="icon-link" d="m10.5 11.5 5 4.5 6-5M15.5 16v5"/>
        <circle class="icon-node" cx="10.5" cy="11.5" r="2.35"/>
        <circle class="icon-node" cx="21.5" cy="11" r="2.35"/>
        <circle class="icon-node" cx="15.5" cy="21" r="2.35"/>
      </svg>
    </button>
    <section class="floating" aria-label="Branchboard æµ®åŠ¨ç”»å¸ƒ">
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
            <strong>åˆ†æ”¯ç”»å¸ƒ</strong>
            <span>BRANCHBOARD</span>
          </span>
        </div>
        <div class="shell-actions">
          <button class="shell-button maximize" type="button" title="æœ€å¤§åŒ–">â–¡</button>
          <button class="shell-button minimize" type="button" title="æ”¶èµ·ç”»å¸ƒ">â€”</button>
        </div>
      </header>
      <iframe class="canvas-frame" title="Branchboard ç”»å¸ƒ"></iframe>
      <div class="drop-catcher">
        <i>â†™</i>
        <strong>æ”¾åˆ°ç”»å¸ƒé‡Œ</strong>
        <span>å›¾ç‰‡ä¼šè¿æ¥åˆ°å½“å‰é€‰ä¸­çš„æç¤ºè¯èŠ‚ç‚¹</span>
      </div>
      <div class="toast"><i>âœ“</i><span></span></div>
      <button class="resize-handle" type="button" title="æ‹–åŠ¨è°ƒæ•´ç”»å¸ƒå¤§å°"></button>
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
    toast.querySelector("i").textContent = warning ? "!" : "âœ“";
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
      maximize.textContent = "â";
      maximize.title = "è¿˜åŸ";
      return;
    }

    floatingGeometry = savedGeometry || floatingGeometry;
    applyFloatingGeometry();
    resizeHandle.style.display = "";
    maximize.textContent = "â–¡";
    maximize.title = "æœ€å¤§åŒ–";
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
      ã~5¶‰Ëkºwµç@ô((€…Íå¹Œ™Õ¹Ñ¥½¸…ÁÑÕÉ••¹•É…Ñ•‘%µ…” (€€€¥µ…”°(€€€…¹Ù…Í%°(€€€ÁÉ½µÁÑ%°(€€€™…±±‰…­Q¥Ñ±”°(€€€Í¥¹…°°(€€€…ÁÑÕÉ•‘¥¹•ÉÁÉ¥¹ÑÌ(€€¤ì(€€€½¹ÍĞ¥µ…•UÉ°€ô•¹•É…Ñ•‘%µ…•-•ä¡¥µ…”¤ì(€€€¥˜€ …¥µ…•UÉ°¤Ñ¡É½Ü¹•ÜÉÉ½È ‹Rš"C–nû&šÊ‡šr'–>¿¢¾ï–>[j–rÃ–v ˆ¤ì(€€€½¹ÍĞÉ•ÍÁ½¹Í”€ô…İ…¥Ğ™•Ñ ¡¥µ…•UÉ°°ì(€€€€€É•‘•¹Ñ¥…±Ìè€‰¥¹±Õ‘”ˆ°(€€€€€Í¥¹…°(€€€ô¤ì(€€€¥˜€ …É•ÍÁ½¹Í”¹½¬¤ì(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È¡ƒ¢¾ï–>[Rš"C–nû&–’Ç¢Ò”€ ‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍô¥€¤ì(€€€ô(€€€½¹ÍĞ‰±½ˆ€ô…İ…¥ĞÉ•ÍÁ½¹Í”¹‰±½ˆ ¤ì(€€€½¹ÍĞ™¥¹•ÉÁÉ¥¹Ğ€ô…İ…¥Ğ‰±½‰¥¹•ÉÁÉ¥¹Ğ¡‰±½ˆ¤ì(€€€¥˜€¡…ÁÑÕÉ•‘¥¹•ÉÁÉ¥¹ÑÌ¹¡…Ì¡™¥¹•ÉÁÉ¥¹Ğ¤¤É•ÑÕÉ¸™…±Í”ì(€€€…ÁÑÕÉ•‘¥¹•ÉÁÉ¥¹ÑÌ¹…‘¡™¥¹•ÉÁÉ¥¹Ğ¤ì(€€€…İ…¥ĞÍ…Ù•%µ…•	±½ˆ (€€€€€‰±½ˆ°(€€€€€•¹•É…Ñ•‘%µ…•9…µ”¡¥µ…”°™…±±‰…­Q¥Ñ±”¤°(€€€€€ÁÉ½µÁÑ%°(€€€€€…¹Ù…Í%(€€€€¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô((€™Õ¹Ñ¥½¸™¥¹‘MÑ½Á	ÕÑÑ½¸ ¤ì(€€€½¹ÍĞÍ•±•Ñ½ÉÌ€ôl(€€€€€€‰‰ÕÑÑ½¹m‘…Ñ„µÑ•ÍÑ¥ôÍÑ½Àµ‰ÕÑÑ½¸tˆ°(€€€€€€‰‰ÕÑÑ½¹m…É¥„µ±…‰•°¨ôMÑ½À•¹•É…Ñ¥¹œœ¥tˆ°(€€€€€€‰‰ÕÑÑ½¹m…É¥„µ±…‰•°¨ôMÑ½ÀÍÑÉ•…µ¥¹œœ¥tˆ°(€€€€€€‰‰ÕÑÑ½¹m…É¥„µ±…‰•°¨ôŸ–sš¶‹Rš"@tˆ°(€€€€€€‰‰ÕÑÑ½¹m…É¥„µ±…‰•°¨ôŸ–sš¶‹–n{–’4tˆ(€€€tì(€€€™½È€¡½¹ÍĞÍ•±•Ñ½È½˜Í•±•Ñ½ÉÌ¤ì(€€€€€½¹ÍĞ‰ÕÑÑ½¸€ô‘½Õµ•¹Ğ¹ÅÕ•ÉåM•±•Ñ½È¡Í•±•Ñ½È¤ì(€€€€€¥˜€¡‰ÕÑÑ½¸¥¹ÍÑ…¹•½˜!Q51	ÕÑÑ½¹±•µ•¹Ğ¤É•ÑÕÉ¸‰ÕÑÑ½¸ì(€€€ô(€€€É•ÑÕÉ¸¹Õ±°ì(€ô((€™Õ¹Ñ¥½¸¥ÍI•ÍÁ½¹Í••¹•É…Ñ¥¹œ ¤ì(€€€É•ÑÕÉ¸	½½±•…¸¡™¥¹‘MÑ½Á	ÕÑÑ½¸ ¤¤ì(€ô((€™Õ¹Ñ¥½¸¹•İÍÍ¥ÍÑ…¹ÑQÕÉ¹Ì¡‰…Í•±¥¹•QÕÉ¸¤ì(€€€½¹ÍĞµ¥¹¥µÕµQÕÉ¸€ô‰…Í•±¥¹•QÕÉ¸€¬€Èì(€€€É•ÑÕÉ¸ÉÉ…ä¹™É½´ (€€€€€‘½Õµ•¹Ğ¹ÅÕ•ÉåM•±•Ñ½É±° ‰Í•Ñ¥½¹m‘…Ñ„µÑ•ÍÑ¥‘xô½¹Ù•ÉÍ…Ñ¥½¸µÑÕÉ¸´tˆ¤(€€€€¤¹™¥±Ñ•È ¡Í•Ñ¥½¸¤€ôøì(€€€€€½¹ÍĞµ…Ñ €ôÍ•Ñ¥½¸(€€€€€€€€¹•ÑÑÑÉ¥‰ÕÑ” ‰‘…Ñ„µÑ•ÍÑ¥ˆ¤(€€€€€€€€ü¹µ…Ñ  ½½¹Ù•ÉÍ…Ñ¥½¸µÑÕÉ¸´¡q¬¤¼¤ì(€€€€€½¹ÍĞÑÕÉ¸€ôµ…Ñ €ü9Õµ‰•È¡µ…Ñ¡lÅt¤€è€´Äì(€€€€€¥˜€¡ÑÕÉ¸€øôµ¥¹¥µÕµQÕÉ¸¤É•ÑÕÉ¸ÑÉÕ”ì(€€€€€½¹ÍĞ¡•…‘¥¹œ€ôÉÉ…ä¹™É½´¡Í•Ñ¥½¸¹ÅÕ•ÉåM•±•Ñ½É±° ‰ Ğ° Ô° Øˆ¤¤(€€€€€€€€¹µ…À ¡•±•µ•¹Ğ¤€ôø•±•µ•¹Ğ¹Ñ•áÑ½¹Ñ•¹Ğñğ€ˆˆ¤(€€€€€€€€¹©½¥¸ ˆ€ˆ¤ì(€€€€€É•ÑÕÉ¸€ (€€€€€€€ÑÕÉ¸€ø‰…Í•±¥¹•QÕÉ¸€˜˜(€€€€€€€€½¡…ÑAQñ…ÍÍ¥ÍÑ…¹Ñó–*§š&,½¤¹Ñ•ÍĞ¡¡•…‘¥¹œ¤(€€€€€€¤ì(€€€ô¤ì(€ô((€™Õ¹Ñ¥½¸¡…Í%µ…••¹•É…Ñ¥½¹A±…•¡½±‘•È¡ÑÕÉ¹Ì¤ì(€€€É•ÑÕÉ¸ÑÕÉ¹Ì¹Í½µ” (€€€€€€¡ÑÕÉ¸¤€ôø(€€€€€€€ÑÕÉ¸¹ÅÕ•ÉåM•±•Ñ½È m±…ÍÌ¨ô‰¥µ…••¸‰tœ¤ñğ(€€€€€€€ÉÉ…ä¹™É½´¡ÑÕÉ¸¹ÅÕ•ÉåM•±•Ñ½É±° ‰¥µœˆ¤¤¹Í½µ” (€€€€€€€€€€¡¥µ…”¤€ôø(€€€€€€€€€€€¥µ…”¥¹ÍÑ…¹•½˜!Q51%µ…•±•µ•¹Ğ€˜˜¥Í•¹•É…Ñ•‘%µ…”¡¥µ…”¤(€€€€€€€€¤(€€€€¤ì(€ô((€™Õ¹Ñ¥½¸…ÍÍ•ÉÑá•ÕÑ¥½¹Ñ¥Ù”¡•á•ÕÑ¥½¸¤ì(€€€¥˜€¡•á•ÕÑ¥½¸¹…¹•±±•ñğ•á•ÕÑ¥½¸¹½¹ÑÉ½±±•È¹Í¥¹…°¹…‰½ÉÑ•¤ì(€€€€€Ñ¡É½Ü¹•Ü=5á•ÁÑ¥½¸ ‹¢şC¢†3–ŞË–>[šÚ ˆ°€‰‰½ÉÑÉÉ½Èˆ¤ì(€€€ô(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸İ…¥Ñ½É•¹•É…Ñ•‘I•ÍÕ±ÑÌ¡ì(€€€É•ÅÕ•ÍÑ%°(€€€…¹Ù…Í%°(€€€ÁÉ½µÁÑ%°(€€€Ñ¥Ñ±”°(€€€‰…Í•±¥¹•QÕÉ¸°(€€€‰…Í•±¥¹•-•åÌ°(€€€•á•ÕÑ¥½¸°(€€€Ñ¥µ•½ÕĞ€ô€ÌØÁ|ÀÀÀ(€ô¤ì(€€€½¹ÍĞÍÑ…ÉÑ•‘Ğ€ô…Ñ”¹¹½Ü ¤ì(€€€±•Ğ™¥ÉÍÑI•…‘åĞ€ô€Àì(€€€±•ĞÑ•áÑI•ÍÁ½¹Í•I•…‘åĞ€ô€Àì((€€€É•Á½ÉÑá•ÕÑ¥½¸¡É•ÅÕ•ÍÑ%°€‰İ…¥Ñ¥¹œˆ°€‰¡…ÑAPƒš¶–r£Rš"C–nû&ˆ¤ì(€€€İ¡¥±”€¡…Ñ”¹¹½Ü ¤€´ÍÑ…ÉÑ•‘Ğ€ğÑ¥µ•½ÕĞ¤ì(€€€€€…ÍÍ•ÉÑá•ÕÑ¥½¹Ñ¥Ù”¡•á•ÕÑ¥½¸¤ì(€€€€€½¹ÍĞ…¹‘¥‘…Ñ•Ì€ô¹•İ•¹•É…Ñ•‘%µ…•Ì¡‰…Í•±¥¹•QÕÉ¸°‰…Í•±¥¹•-•åÌ¤ì(€€€€€¥˜€ ……¹‘¥‘…Ñ•Ì¹±•¹Ñ ¤ì(€€€€€€€™¥ÉÍÑI•…‘åĞ€ô€Àì(€€€€€€€½¹ÍĞ…ÍÍ¥ÍÑ…¹ÑQÕÉ¹Ì€ô¹•İÍÍ¥ÍÑ…¹ÑQÕÉ¹Ì¡‰…Í•±¥¹•QÕÉ¸¤ì(€€€€€€€½¹ÍĞÉ•ÍÁ½¹Í•MÑ¥±±IÕ¹¹¥¹œ€ô¥ÍI•ÍÁ½¹Í••¹•É…Ñ¥¹œ ¤ì(€€€€€€€½¹ÍĞ¥µ…•A±…•¡½±‘•È€ô¡…Í%µ…••¹•É…Ñ¥½¹A±…•¡½±‘•È¡…ÍÍ¥ÍÑ…¹ÑQÕÉ¹Ì¤ì(€€€€€€€¥˜€ (€€€€€€€€€…ÍÍ¥ÍÑ…¹ÑQÕÉ¹Ì¹±•¹Ñ €˜˜(€€€€€€€€€€…É•ÍÁ½¹Í•MÑ¥±±IÕ¹¹¥¹œ€˜˜(€€€€€€€€€€…¥µ…•A±…•¡½±‘•È(€€€€€€€€¤ì(€€€€€€€€€¥˜€ …Ñ•áÑI•ÍÁ½¹Í•I•…‘åĞ¤Ñ•áÑI•ÍÁ½¹Í•I•…‘åĞ€ô…Ñ”¹¹½Ü ¤ì(€€€€€€€€€¥˜€¡…Ñ”¹¹½Ü ¤€´Ñ•áÑI•ÍÁ½¹Í•I•…‘åĞ€øôQaQ}IMA=9M}I}5L¤ì(€€€€€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰¡…ÑAPƒ¢şS–n{’êšZ–¶_¾ò3šÊ‡šr'Rš"C–nû&ˆ¤ì(€€€€€€€€€ô(€€€€€€€ô•±Í”ì(€€€€€€€€€Ñ•áÑI•ÍÁ½¹Í•I•…‘åĞ€ô€Àì(€€€€€€€ô(€€€€€€€…İ…¥Ğİ…¥Ğ äÀÀ¤ì(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€ô((€€€€€Ñ•áÑI•ÍÁ½¹Í•I•…‘åĞ€ô€Àì(€€€€€¥˜€ …™¥ÉÍÑI•…‘åĞ¤™¥ÉÍÑI•…‘åĞ€ô…Ñ”¹¹½Ü ¤ì(€€€€€¥˜€¡…Ñ”¹¹½Ü ¤€´™¥ÉÍÑI•…‘åĞ€ğ€ÄØÀÀ¤ì(€€€€€€€…İ…¥Ğİ…¥Ğ ÔÀÀ¤ì(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€ô((€€€€€É•Á½ÉÑá•ÕÑ¥½¸ (€€€€€€€É•ÅÕ•ÍÑ%°(€€€€€€€€‰…ÁÑÕÉ¥¹œˆ°(€€€€€€€ƒš¶–r£šš~”€‘í…¹‘¥‘…Ñ•Ì¹±•¹Ñ¡ôƒ’â«Rš"CîOšzq€(€€€€€€¤ì(€€€€€½¹ÍĞ…ÁÑÕÉ•‘¥¹•ÉÁÉ¥¹ÑÌ€ô¹•ÜM•Ğ ¤ì(€€€€€±•Ğ…ÁÑÕÉ•‘½Õ¹Ğ€ô€Àì(€€€€€™½È€¡½¹ÍĞ¥µ…”½˜…¹‘¥‘…Ñ•Ì¤ì(€€€€€€€…ÍÍ•ÉÑá•ÕÑ¥½¹Ñ¥Ù”¡•á•ÕÑ¥½¸¤ì(€€€€€€€¥˜€¡…İ…¥Ğ…ÁÑÕÉ••¹•É…Ñ•‘%µ…” (€€€€€€€€€¥µ…”°(€€€€€€€€€…¹Ù…Í%°(€€€€€€€€€ÁÉ½µÁÑ%°(€€€€€€€€€Ñ¥Ñ±”°(€€€€€€€€€•á•ÕÑ¥½¸¹½¹ÑÉ½±±•È¹Í¥¹…°°(€€€€€€€€€…ÁÑÕÉ•‘¥¹•ÉÁÉ¥¹ÑÌ(€€€€€€€€¤¤ì(€€€€€€€€€…ÁÑÕÉ•‘½Õ¹Ğ€¬ô€Äì(€€€€€€€ô(€€€€€ô(€€€€€É•Á½ÉÑá•ÕÑ¥½¸ (€€€€€€€É•ÅÕ•ÍÑ%°(€€€€€€€€‰…ÁÑÕÉ•ˆ°(€€€€€€€€‘í…ÁÑÕÉ•‘½Õ¹Ñôƒ–òƒ–nû&–ŞË¢«–*£–n{–"ÃRï–â€(€€€€€€¤ì(€€€€€Í¡½İQ½…ÍĞ¡€‘í…ÁÑÕÉ•‘½Õ¹Ñôƒ–òƒ–nû&–ŞË¢«–*£–*ƒ–—Rï–â€¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€Ñ¡É½Ü¹•ÜÉÉ½È ‹¶'–úRš"C–nû&¢Úš^Û¾ò3¢¾ßšš~”¡…ÑAPƒšb¿–B›Rš"Cš"C–*|ˆ¤ì(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸•á•ÕÑ•AÉ½µÁĞ¡µ•ÍÍ…”¤ì(€€€½¹ÍĞÉ•ÅÕ•ÍÑ%€ôMÑÉ¥¹œ¡µ•ÍÍ…”¹É•ÅÕ•ÍÑ%ñğ€ˆˆ¤ì(€€€¥˜€ …É•ÅÕ•ÍÑ%¤É•ÑÕÉ¸ì(€€€¥˜€¡…Ñ¥Ù•á•ÕÑ¥½¸¤ì(€€€€€É•Á½ÉÑá•ÕÑ¥½¸¡É•ÅÕ•ÍÑ%°€‰™…¥±•ˆ°€‹–>›’â’â«¢*
çš¶–r£š&Ÿ¢†0ˆ°ì(€€€€€€€ÁÉ½µÁÑ%èMÑÉ¥¹œ¡µ•ÍÍ…”¹ÁÉ½µÁÑ%ñğ€ˆˆ¤°(€€€€€€€…¹Ù…Í%èMÑÉ¥¹œ¡µ•ÍÍ…”¹…¹Ù…Í%ñğ€ˆˆ¤(€€€€€ô¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€½¹ÍĞ•á•ÕÑ¥½¸€ôì(€€€€€É•ÅÕ•ÍÑ%°(€€€€€…¹Ù…Í%èMÑÉ¥¹œ¡µ•ÍÍ…”¹…¹Ù…Í%ñğ€ˆˆ¤°(€€€€€ÁÉ½µÁÑ%èMÑÉ¥¹œ¡µ•ÍÍ…”¹ÁÉ½µÁÑ%ñğ€ˆˆ¤°(€€€€€…¹•±±•è™…±Í”°(€€€€€½¹ÑÉ½±±•Èè¹•Ü‰½ÉÑ½¹ÑÉ½±±•È ¤(€€€ôì(€€€…Ñ¥Ù•á•ÕÑ¥½¸€ô•á•ÕÑ¥½¸ì(€€€ÑÉäì(€€€€€½¹ÍĞÁÉ½µÁĞ€ôMÑÉ¥¹œ¡µ•ÍÍ…”¹ÁÉ½µÁĞñğ€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€€€¥˜€ …ÁÉ½µÁĞ¤Ñ¡É½Ü¹•ÜÉÉ½È ‹š>C’ë¢¾7šb¿¦ëjˆ¤ì((€€€€€¥˜€¡µ•ÍÍ…”¹É•™•É•¹•%µ…”ü¹‘…Ñ…UÉ°¤ì(€€€€€€€É•Á½ÉÑá•ÕÑ¥½¸¡É•ÅÕ•ÍÑ%°€‰…ÑÑ…¡¥¹œˆ°€‹š¶–r£¦f–*ƒ’â+šâã–>¢–nøˆ¤ì(€€€€€€€…İ…¥Ğ…ÑÑ…¡I•™•É•¹•%µ…” (€€€€€€€€€µ•ÍÍ…”¹É•™•É•¹•%µ…”°(€€€€€€€€€•á•ÕÑ¥½¸¹½¹ÑÉ½±±•È¹Í¥¹…°(€€€€€€€€¤ì(€€€€€ô((€€€€€…ÍÍ•ÉÑá•ÕÑ¥½¹Ñ¥Ù”¡•á•ÕÑ¥½¸¤ì(€€€€€É•Á½ÉÑá•ÕÑ¥½¸¡É•ÅÕ•ÍÑ%°€‰™¥±±¥¹œˆ°€‹š¶–r£–†¯–”¡…ÑAPˆ¤ì(€€€€€…İ…¥Ğ™¥±±½µÁ½Í•È¡ÁÉ½µÁĞ°•á•ÕÑ¥½¸¤ì((€€€€€…ÍÍ•ÉÑá•ÕÑ¥½¹Ñ¥Ù”¡•á•ÕÑ¥½¸¤ì(€€€€€É•Á½ÉÑá•ÕÑ¥½¸¡É•ÅÕ•ÍÑ%°€‰Í•¹‘¥¹œˆ°€‹š¶–r£–>G¦ˆ¤ì(€€€€€½¹ÍĞ‰…Í•±¥¹•QÕÉ¸€ô±…Ñ•ÍÑ½¹Ù•ÉÍ…Ñ¥½¹QÕÉ¸ ¤ì(€€€€€½¹ÍĞ‰…Í•±¥¹•-•åÌ€ô•¹•É…Ñ•‘%µ…•-•åÌ ¤ì(€€€€€½¹ÍĞÍ•¹‘	ÕÑÑ½¸€ô…İ…¥Ğİ…¥Ñ½ÉM•¹‘	ÕÑÑ½¸¡•á•ÕÑ¥½¸¤ì(€€€€€…ÍÍ•ÉÑá•ÕÑ¥½¹Ñ¥Ù”¡•á•ÕÑ¥½¸¤ì(€€€€€Í•¹‘	ÕÑÑ½¸¹±¥¬ ¤ì(€€€€€É•Á½ÉÑá•ÕÑ¥½¸¡É•ÅÕ•ÍÑ%°€‰Í•¹Ğˆ°€‹–ŞËî?–>G¦¾ò3¶'–ú¡…ÑAPƒRš"@ˆ¤ì(€€€€€…İ…¥Ğİ…¥Ñ½É•¹•É…Ñ•‘I•ÍÕ±ÑÌ¡ì(€€€€€€€É•ÅÕ•ÍÑ%°(€€€€€€€…¹Ù…Í%è•á•ÕÑ¥½¸¹…¹Ù…Í%°(€€€€€€€ÁÉ½µÁÑ%èMÑÉ¥¹œ¡µ•ÍÍ…”¹ÁÉ½µÁÑ%ñğ€ˆˆ¤°(€€€€€€€Ñ¥Ñ±”èMÑÉ¥¹œ¡µ•ÍÍ…”¹Ñ¥Ñ±”ñğ€ˆˆ¤°(€€€€€€€‰…Í•±¥¹•QÕÉ¸°(€€€€€€€‰…Í•±¥¹•-•åÌ°(€€€€€€€•á•ÕÑ¥½¸(€€€€€ô¤ì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€¥˜€¡•ÉÉ½È¥¹ÍÑ…¹•½˜=5á•ÁÑ¥½¸€˜˜•ÉÉ½È¹¹…µ”€ôôô€‰‰½ÉÑÉÉ½Èˆ¤É•ÑÕÉ¸ì(€€€€€½¹ÍĞµ•ÍÍ…•Q•áĞ€ô(€€€€€€€•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½È¤ì(€€€€€É•Á½ÉÑá•ÕÑ¥½¸¡É•ÅÕ•ÍÑ%°€‰™…¥±•ˆ°µ•ÍÍ…•Q•áĞ¤ì(€€€€€Í¡½İQ½…ÍĞ¡µ•ÍÍ…•Q•áĞ°ÑÉÕ”¤ì(€€€ô™¥¹…±±äì(€€€€€¥˜€¡…Ñ¥Ù•á•ÕÑ¥½¸€ôôô•á•ÕÑ¥½¸¤…Ñ¥Ù•á•ÕÑ¥½¸€ô¹Õ±°ì(€€€ô(€ô((€™Õ¹Ñ¥½¸…¹•±á•ÕÑ¥½¸¡ÁÉ½µÁÑ%‘Ì¤ì(€€€¥˜€ ……Ñ¥Ù•á•ÕÑ¥½¸ñğ€…ÁÉ½µÁÑ%‘Ì¹¥¹±Õ‘•Ì¡…Ñ¥Ù•á•ÕÑ¥½¸¹ÁÉ½µÁÑ%¤¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€½¹ÍĞ•á•ÕÑ¥½¸€ô…Ñ¥Ù•á•ÕÑ¥½¸ì(€€€•á•ÕÑ¥½¸¹…¹•±±•€ôÑÉÕ”ì(€€€•á•ÕÑ¥½¸¹½¹ÑÉ½±±•È¹…‰½ÉĞ ¤ì(€€€…Ñ¥Ù•á•ÕÑ¥½¸€ô¹Õ±°ì(€€€™¥¹‘MÑ½Á	ÕÑÑ½¸ ¤ü¹±¥¬ ¤ì(€€€É•Á½ÉÑá•ÕÑ¥½¸ (€€€€€•á•ÕÑ¥½¸¹É•ÅÕ•ÍÑ%°(€€€€€€‰…¹•±±•ˆ°(€€€€€€‹¢*
ç–ŞË–"ƒ¦f“¾ò3¢şC¢†3–ŞË–>[šÚ ˆ°(€€€€€ì(€€€€€€€ÁÉ½µÁÑ%è•á•ÕÑ¥½¸¹ÁÉ½µÁÑ%°(€€€€€€€…¹Ù…Í%è•á•ÕÑ¥½¸¹…¹Ù…Í%(€€€€€ô(€€€€¤ì(€€€Í¡½İQ½…ÍĞ ‹–ŞË–>[šÚ#¢Š¯–"ƒ¦f“¢*
çj¢şC¢†0ˆ¤ì(€ô((€½Éˆ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôøì(€€€¥˜€¡…Ñ”¹¹½Ü ¤€ğÍÕÁÁÉ•ÍÍ=É‰±¥­U¹Ñ¥°¤É•ÑÕÉ¸ì(€€€Í•Ñ=Á•¸¡ÑÉÕ”¤ì(€ô¤ì(€½Éˆ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰Á½¥¹Ñ•É‘½İ¸ˆ°€¡•Ù•¹Ğ¤€ôøì(€€€¥˜€¡•Ù•¹Ğ¹‰ÕÑÑ½¸€„ôô€À¤É•ÑÕÉ¸ì(€€€½¹ÍĞÉ•Ğ€ô¡½ÍĞ¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ğ ¤ì(€€€¡½ÍĞ¹ÍÑå±”¹±•™Ğ€ô€‘íÉ•Ğ¹±•™ÑõÁá€ì(€€€¡½ÍĞ¹ÍÑå±”¹Ñ½À€ô€‘íÉ•Ğ¹Ñ½ÁõÁá€ì(€€€¡½ÍĞ¹ÍÑå±”¹É¥¡Ğ€ô€‰…ÕÑ¼ˆì(€€€¡½ÍĞ¹ÍÑå±”¹‰½ÑÑ½´€ô€‰…ÕÑ¼ˆì(€€€½É‰É…MÑ…Ñ”€ôì(€€€€€Á½¥¹Ñ•É%è•Ù•¹Ğ¹Á½¥¹Ñ•É%°(€€€€€ÍÑ…ÉÑ`è•Ù•¹Ğ¹±¥•¹Ñ`°(€€€€€ÍÑ…ÉÑdè•Ù•¹Ğ¹±¥•¹Ñd°(€€€€€½™™Í•Ñ`è•Ù•¹Ğ¹±¥•¹Ñ`€´É•Ğ¹±•™Ğ°(€€€€€½™™Í•Ñdè•Ù•¹Ğ¹±¥•¹Ñd€´É•Ğ¹Ñ½À°(€€€€€µ½Ù•è™…±Í”(€€€ôì(€ô¤ì(€İ¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰Á½¥¹Ñ•Éµ½Ù”ˆ°€¡•Ù•¹Ğ¤€ôøì(€€€¥˜€ …½É‰É…MÑ…Ñ”ñğ½É‰É…MÑ…Ñ”¹Á½¥¹Ñ•É%€„ôô•Ù•¹Ğ¹Á½¥¹Ñ•É%¤É•ÑÕÉ¸ì(€€€¥˜€ (€€€€€5…Ñ ¹¡åÁ½Ğ (€€€€€€€•Ù•¹Ğ¹±¥•¹Ñ`€´½É‰É…MÑ…Ñ”¹ÍÑ…ÉÑ`°(€€€€€€€•Ù•¹Ğ¹±¥•¹Ñd€´½É‰É…MÑ…Ñ”¹ÍÑ…ÉÑd(€€€€€€¤€øô€Ğ(€€€€¤ì(€€€€€½É‰É…MÑ…Ñ”¹µ½Ù•€ôÑÉÕ”ì(€€€€€½Éˆ¹±…ÍÍ1¥ÍĞ¹…‘ ‰‘É…¥¹œˆ¤ì(€€€ô(€€€¥˜€ …½É‰É…MÑ…Ñ”¹µ½Ù•¤É•ÑÕÉ¸ì(€€€½¹ÍĞµ…á1•™Ğ€ô5…Ñ ¹µ…à Ø°İ¥¹‘½Ü¹¥¹¹•É]¥‘Ñ €´€ÔØ¤ì(€€€½¹ÍĞµ…áQ½À€ô5…Ñ ¹µ…à Ø°İ¥¹‘½Ü¹¥¹¹•É!•¥¡Ğ€´€ÔØ¤ì(€€€¡½ÍĞ¹ÍÑå±”¹±•™Ğ€ô(€€€€€€‘í5…Ñ ¹µ¥¸¡µ…á1•™Ğ°5…Ñ ¹µ…à Ø°•Ù•¹Ğ¹±¥•¹Ñ`€´½É‰É…MÑ…Ñ”¹½™™Í•Ñ`¤¥õÁá€ì(€€€¡½ÍĞ¹ÍÑå±”¹Ñ½À€ô(€€€€€€‘í5…Ñ ¹µ¥¸¡µ…áQ½À°5…Ñ ¹µ…à Ø°•Ù•¹Ğ¹±¥•¹Ñd€´½É‰É…MÑ…Ñ”¹½™™Í•Ñd¤¥õÁá€ì(€ô°ÑÉÕ”¤ì(€İ¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰Á½¥¹Ñ•ÉÕÀˆ°€¡•Ù•¹Ğ¤€ôøì(€€€¥˜€ …½É‰É…MÑ…Ñ”ñğ½É‰É…MÑ…Ñ”¹Á½¥¹Ñ•É%€„ôô•Ù•¹Ğ¹Á½¥¹Ñ•É%¤É•ÑÕÉ¸ì(€€€½¹ÍĞµ½Ù•€ô½É‰É…MÑ…Ñ”¹µ½Ù•ì(€€€½É‰É…MÑ…Ñ”€ô¹Õ±°ì(€€€½Éˆ¹±…ÍÍ1¥ÍĞ¹É•µ½Ù” ‰‘É…¥¹œˆ¤ì(€€€¥˜€¡µ½Ù•¤ì(€€€€€ÍÕÁÁÉ•ÍÍ=É‰±¥­U¹Ñ¥°€ô…Ñ”¹¹½Ü ¤€¬€ÈÔÀì(€€€€€Ù½¥Á•ÉÍ¥ÍÑ=É‰A½Í¥Ñ¥½¸ ¤ì(€€€ô(€ô°ÑÉÕ”¤ì(€İ¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰Á½¥¹Ñ•É…¹•°ˆ°€¡•Ù•¹Ğ¤€ôøì(€€€¥˜€ …½É‰É…MÑ…Ñ”ñğ½É‰É…MÑ…Ñ”¹Á½¥¹Ñ•É%€„ôô•Ù•¹Ğ¹Á½¥¹Ñ•É%¤É•ÑÕÉ¸ì(€€€½É‰É…MÑ…Ñ”€ô¹Õ±°ì(€€€½Éˆ¹±…ÍÍ1¥ÍĞ¹É•µ½Ù” ‰‘É…¥¹œˆ¤ì(€€€…ÁÁ±å=É‰A½Í¥Ñ¥½¸ ¤ì(€ô°ÑÉÕ”¤ì(€µ¥¹¥µ¥é”¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôøÍ•Ñ=Á•¸¡™…±Í”¤¤ì(€µ…á¥µ¥é”¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôøÍ•Ñ5…á¥µ¥é• …µ…á¥µ¥é•¤¤ì((€¡•…‘•È¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰Á½¥¹Ñ•É‘½İ¸ˆ°€¡•Ù•¹Ğ¤€ôøì(€€€¥˜€¡µ…á¥µ¥é•ñğ•Ù•¹Ğ¹Ñ…É•Ğ¹±½Í•ÍĞ ‰‰ÕÑÑ½¸ˆ¤¤É•ÑÕÉ¸ì(€€€½¹ÍĞÉ•Ğ€ô¡½ÍĞ¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ğ ¤ì(€€€‘É…MÑ…Ñ”€ôì(€€€€€Á½¥¹Ñ•É%è•Ù•¹Ğ¹Á½¥¹Ñ•É%°(€€€€€½™™Í•Ñ`è•Ù•¹Ğ¹±¥•¹Ñ`€´É•Ğ¹±•™Ğ°(€€€€€½™™Í•Ñdè•Ù•¹Ğ¹±¥•¹Ñd€´É•Ğ¹Ñ½À(€€€ôì(€€€¡•…‘•È¹Í•ÑA½¥¹Ñ•É…ÁÑÕÉ”¡•Ù•¹Ğ¹Á½¥¹Ñ•É%¤ì(€ô¤ì(€¡•…‘•È¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰Á½¥¹Ñ•Éµ½Ù”ˆ°€¡•Ù•¹Ğ¤€ôøì(€€€¥˜€ …‘É…MÑ…Ñ”ñğ‘É…MÑ…Ñ”¹Á½¥¹Ñ•É%€„ôô•Ù•¹Ğ¹Á½¥¹Ñ•É%¤É•ÑÕÉ¸ì(€€€½¹ÍĞµ…á1•™Ğ€ô5…Ñ ¹µ…à Ø°İ¥¹‘½Ü¹¥¹¹•É]¥‘Ñ €´¡½ÍĞ¹½™™Í•Ñ]¥‘Ñ €´€Ø¤ì(€€€½¹ÍĞµ…áQ½À€ô5…Ñ ¹µ…à Ø°İ¥¹‘½Ü¹¥¹¹•É!•¥¡Ğ€´¡½ÍĞ¹½™™Í•Ñ!•¥¡Ğ€´€Ø¤ì(€€€¡½ÍĞ¹ÍÑå±”¹±•™Ğ€ô€‘í5…Ñ ¹µ¥¸¡µ…á1•™Ğ°5…Ñ ¹µ…à Ø°•Ù•¹Ğ¹±¥•¹Ñ`€´‘É…MÑ…Ñ”¹½™™Í•Ñ`¤¥õÁá€ì(€€€¡½ÍĞ¹ÍÑå±”¹Ñ½À€ô€‘í5…Ñ ¹µ¥¸¡µ…áQ½À°5…Ñ ¹µ…à Ø°•Ù•¹Ğ¹±¥•¹Ñd€´‘É…MÑ…Ñ”¹½™™Í•Ñd¤¥õÁá€ì(€€€¡½ÍĞ¹ÍÑå±”¹É¥¡Ğ€ô€‰…ÕÑ¼ˆì(€€€¡½ÍĞ¹ÍÑå±”¹‰½ÑÑ½´€ô€‰…ÕÑ¼ˆì(€ô¤ì(€¡•…‘•È¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰Á½¥¹Ñ•ÉÕÀˆ°€¡•Ù•¹Ğ¤€ôøì(€€€¥˜€¡‘É…MÑ…Ñ”ü¹Á½¥¹Ñ•É%€ôôô•Ù•¹Ğ¹Á½¥¹Ñ•É%¤ì(€€€€€¡•…‘•È¹É•±•…Í•A½¥¹Ñ•É…ÁÑÕÉ”¡•Ù•¹Ğ¹Á½¥¹Ñ•É%¤ì(€€€€€‘É…MÑ…Ñ”€ô¹Õ±°ì(€€€€€Ù½¥Á•ÉÍ¥ÍÑ•½µ•ÑÉä ¤ì(€€€ô(€ô¤ì((€É•Í¥é•!…¹‘±”¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰Á½¥¹Ñ•É‘½İ¸ˆ°€¡•Ù•¹Ğ¤€ôøì(€€€¥˜€¡µ…á¥µ¥é•¤É•ÑÕÉ¸ì(€€€•Ù•¹Ğ¹ÁÉ•Ù•¹Ñ•™…Õ±Ğ ¤ì(€€€•Ù•¹Ğ¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€½¹ÍĞ¡½ÍÑI•Ğ€ô¡½ÍĞ¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ğ ¤ì(€€€½¹ÍĞ™±½…Ñ¥¹I•Ğ€ô™±½…Ñ¥¹œ¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ğ ¤ì(€€€¡½ÍĞ¹ÍÑå±”¹±•™Ğ€ô€‘í¡½ÍÑI•Ğ¹±•™ÑõÁá€ì(€€€¡½ÍĞ¹ÍÑå±”¹Ñ½À€ô€‘í¡½ÍÑI•Ğ¹Ñ½ÁõÁá€ì(€€€¡½ÍĞ¹ÍÑå±”¹É¥¡Ğ€ô€‰…ÕÑ¼ˆì(€€€¡½ÍĞ¹ÍÑå±”¹‰½ÑÑ½´€ô€‰…ÕÑ¼ˆì(€€€É•Í¥é•MÑ…Ñ”€ôì(€€€€€Á½¥¹Ñ•É%è•Ù•¹Ğ¹Á½¥¹Ñ•É%°(€€€€€ÍÑ…ÉÑ`è•Ù•¹Ğ¹±¥•¹Ñ`°(€€€€€ÍÑ…ÉÑdè•Ù•¹Ğ¹±¥•¹Ñd°(€€€€€İ¥‘Ñ è™±½…Ñ¥¹I•Ğ¹İ¥‘Ñ °(€€€€€¡•¥¡Ğè™±½…Ñ¥¹I•Ğ¹¡•¥¡Ğ°(€€€€€±•™Ğè¡½ÍÑI•Ğ¹±•™Ğ°(€€€€€Ñ½Àè¡½ÍÑI•Ğ¹Ñ½À(€€€ôì(€€€É•Í¥é•!…¹‘±”¹Í•ÑA½¥¹Ñ•É…ÁÑÕÉ”¡•Ù•¹Ğ¹Á½¥¹Ñ•É%¤ì(€ô¤ì(€É•Í¥é•!…¹‘±”¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰Á½¥¹Ñ•Éµ½Ù”ˆ°€¡•Ù•¹Ğ¤€ôøì(€€€¥˜€ …É•Í¥é•MÑ…Ñ”ñğÉ•Í¥é•MÑ…Ñ”¹Á½¥¹Ñ•É%€„ôô•Ù•¹Ğ¹Á½¥¹Ñ•É%¤É•ÑÕÉ¸ì(€€€½¹ÍĞµ¥¹]¥‘Ñ €ô5…Ñ ¹µ¥¸ ÔÈÀ°İ¥¹‘½Ü¹¥¹¹•É]¥‘Ñ €´€ÄØ¤ì(€€€½¹ÍĞµ¥¹!•¥¡Ğ€ô5…Ñ ¹µ¥¸ ĞÈÀ°İ¥¹‘½Ü¹¥¹¹•É!•¥¡Ğ€´€ÄØ¤ì(€€€½¹ÍĞµ…á]¥‘Ñ €ô5…Ñ ¹µ…à¡µ¥¹]¥‘Ñ °İ¥¹‘½Ü¹¥¹¹•É]¥‘Ñ €´É•Í¥é•MÑ…Ñ”¹±•™Ğ€´€à¤ì(€€€½¹ÍĞµ…á!•¥¡Ğ€ô5…Ñ ¹µ…à¡µ¥¹!•¥¡Ğ°İ¥¹‘½Ü¹¥¹¹•É!•¥¡Ğ€´É•Í¥é•MÑ…Ñ”¹Ñ½À€´€à¤ì(€€€½¹ÍĞİ¥‘Ñ €ô5…Ñ ¹µ¥¸ (€€€€€µ…á]¥‘Ñ °(€€€€€5…Ñ ¹µ…à¡µ¥¹]¥‘Ñ °É•Í¥é•MÑ…Ñ”¹İ¥‘Ñ €¬•Ù•¹Ğ¹±¥•¹Ñ`€´É•Í¥é•MÑ…Ñ”¹ÍÑ…ÉÑ`¤(€€€€¤ì(€€€½¹ÍĞ¡•¥¡Ğ€ô5…Ñ ¹µ¥¸ (€€€€€µ…á!•¥¡Ğ°(€€€€€5…Ñ ¹µ…à¡µ¥¹!•¥¡Ğ°É•Í¥é•MÑ…Ñ”¹¡•¥¡Ğ€¬•Ù•¹Ğ¹±¥•¹Ñd€´É•Í¥é•MÑ…Ñ”¹ÍÑ…ÉÑd¤(€€€€¤ì(€€€™±½…Ñ¥¹œ¹ÍÑå±”¹İ¥‘Ñ €ô€‘íİ¥‘Ñ¡õÁá€ì(€€€™±½…Ñ¥¹œ¹ÍÑå±”¹¡•¥¡Ğ€ô€‘í¡•¥¡ÑõÁá€ì(€ô¤ì(€É•Í¥é•!…¹‘±”¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰Á½¥¹Ñ•ÉÕÀˆ°€¡•Ù•¹Ğ¤€ôøì(€€€¥˜€¡É•Í¥é•MÑ…Ñ”ü¹Á½¥¹Ñ•É%€ôôô•Ù•¹Ğ¹Á½¥¹Ñ•É%¤ì(€€€€€É•Í¥é•!…¹‘±”¹É•±•…Í•A½¥¹Ñ•É…ÁÑÕÉ”¡•Ù•¹Ğ¹Á½¥¹Ñ•É%¤ì(€€€€€É•Í¥é•MÑ…Ñ”€ô¹Õ±°ì(€€€€€Ù½¥Á•ÉÍ¥ÍÑ•½µ•ÑÉä ¤ì(€€€ô(€ô¤ì((€‘½Õµ•¹Ğ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€‰‘É…•¹Ñ•Èˆ°(€€€€¡•Ù•¹Ğ¤€ôøì(€€€€€¥˜€ …½Á•¸¤É•ÑÕÉ¸ì(€€€€€‘É…•ÁÑ €¬ô€Äì(€€€€€¥˜€¡•Ù•¹Ğ¹‘…Ñ…QÉ…¹Í™•Èü¹ÑåÁ•Ìü¹±•¹Ñ ¤ì(€€€€€€€‘É½Á…Ñ¡•È¹±…ÍÍ1¥ÍĞ¹…‘ ‰…Ñ¥Ù”ˆ¤ì(€€€€€ô(€€€ô°(€€€ÑÉÕ”(€€¤ì(€‘½Õµ•¹Ğ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€‰‘É…±•…Ù”ˆ°(€€€€ ¤€ôøì(€€€€€¥˜€ …½Á•¸¤É•ÑÕÉ¸ì(€€€€€‘É…•ÁÑ €ô5…Ñ ¹µ…à À°‘É…•ÁÑ €´€Ä¤ì(€€€€€¥˜€¡‘É…•ÁÑ €ôôô€À¤‘É½Á…Ñ¡•È¹±…ÍÍ1¥ÍĞ¹É•µ½Ù” ‰…Ñ¥Ù”ˆ¤ì(€€€ô°(€€€ÑÉÕ”(€€¤ì(€‘É½Á…Ñ¡•È¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰‘É…½Ù•Èˆ°€¡•Ù•¹Ğ¤€ôøì(€€€•Ù•¹Ğ¹ÁÉ•Ù•¹Ñ•™…Õ±Ğ ¤ì(€€€¥˜€¡•Ù•¹Ğ¹‘…Ñ…QÉ…¹Í™•È¤•Ù•¹Ğ¹‘…Ñ…QÉ…¹Í™•È¹‘É½Á™™•Ğ€ô€‰½Áäˆì(€ô¤ì(€‘É½Á…Ñ¡•È¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰‘É½Àˆ°€¡•Ù•¹Ğ¤€ôøì(€€€•Ù•¹Ğ¹ÁÉ•Ù•¹Ñ•™…Õ±Ğ ¤ì(€€€•Ù•¹Ğ¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€‘É…•ÁÑ €ô€Àì(€€€‘É½Á…Ñ¡•È¹±…ÍÍ1¥ÍĞ¹É•µ½Ù” ‰…Ñ¥Ù”ˆ¤ì(€€€¥˜€ …•Ù•¹Ğ¹‘…Ñ…QÉ…¹Í™•È¤É•ÑÕÉ¸ì(€€€Ù½¥É••¥Ù•É½À¡•Ù•¹Ğ¹‘…Ñ…QÉ…¹Í™•È¤¹…Ñ  ¡•ÉÉ½È¤€ôø(€€€€€Í¡½İQ½…ÍĞ¡•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½È¤°ÑÉÕ”¤(€€€€¤ì(€ô¤ì((€İ¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰µ•ÍÍ…”ˆ°€¡•Ù•¹Ğ¤€ôøì(€€€¥˜€¡•Ù•¹Ğ¹Í½ÕÉ”€„ôô™É…µ”¹½¹Ñ•¹Ñ]¥¹‘½Ü¤É•ÑÕÉ¸ì(€€€¥˜€¡•Ù•¹Ğ¹‘…Ñ„ü¹ÑåÁ”€ôôô€‰‰É…¹¡‰½…ÉéÑ¡•µ”µ¡…¹”ˆ¤ì(€€€€€¡½ÍĞ¹±…ÍÍ1¥ÍĞ¹Ñ½±” ‰Ñ¡•µ”µ±¥¡Ğˆ°•Ù•¹Ğ¹‘…Ñ„¹Ñ¡•µ”€ôôô€‰±¥¡Ğˆ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€¥˜€¡•Ù•¹Ğ¹‘…Ñ„ü¹ÑåÁ”€ôôô€‰‰É…¹¡‰½…Ééµ¥¹¥µ¥é”µ™±½…Ñ¥¹œµ…¹Ù…Ìˆ¤ì(€€€€€Í•Ñ=Á•¸¡™…±Í”¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€¥˜€¡•Ù•¹Ğ¹‘…Ñ„ü¹ÑåÁ”€ôôô€‰‰É…¹¡‰½…Éé•á•ÕÑ”µÁÉ½µÁĞˆ¤ì(€€€€€Ù½¥•á•ÕÑ•AÉ½µÁĞ¡•Ù•¹Ğ¹‘…Ñ„¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€¥˜€¡•Ù•¹Ğ¹‘…Ñ„ü¹ÑåÁ”€ôôô€‰‰É…¹¡‰½…Éé¥µÁ½ÉĞµ‘É½ÁÁ•µ¥µ…”ˆ¤ì(€€€€€Ù½¥É••¥Ù•É½ÁÁ•‘%µ…•UÉ°¡•Ù•¹Ğ¹‘…Ñ„¤¹…Ñ  ¡•ÉÉ½È¤€ôø(€€€€€€€Í¡½İQ½…ÍĞ¡•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½È¤°ÑÉÕ”¤(€€€€€€¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€¥˜€¡•Ù•¹Ğ¹‘…Ñ„ü¹ÑåÁ”€ôôô€‰‰É…¹¡‰½…Éé…¹•°µ•á•ÕÑ¥½¸ˆ¤ì(€€€€€…¹•±á•ÕÑ¥½¸ (€€€€€€€ÉÉ…ä¹¥ÍÉÉ…ä¡•Ù•¹Ğ¹‘…Ñ„¹ÁÉ½µÁÑ%‘Ì¤(€€€€€€€€€€ü•Ù•¹Ğ¹‘…Ñ„¹ÁÉ½µÁÑ%‘Ì¹µ…À¡MÑÉ¥¹œ¤(€€€€€€€€€€èmt(€€€€€€¤ì(€€€ô(€ô¤ì((€¡É½µ”¹ÉÕ¹Ñ¥µ”¹½¹5•ÍÍ…”¹…‘‘1¥ÍÑ•¹•È ¡µ•ÍÍ…”¤€ôøì(€€€¥˜€¡µ•ÍÍ…”ü¹ÑåÁ”€ôôô€‰‰É…¹¡‰½…ÉéÑ½±”µ™±½…Ñ¥¹œµ…¹Ù…Ìˆ¤ì(€€€€€Í•Ñ=Á•¸ …½Á•¸¤ì(€€€ô(€ô¤ì((€±•ĞÙ¥•İÁ½ÉÑI•Í¥é•Q¥µ•È€ô¹Õ±°ì(€İ¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰É•Í¥é”ˆ°€ ¤€ôøì(€€€¥˜€¡µ…á¥µ¥é•¤É•ÑÕÉ¸ì(€€€¥˜€¡Ù¥•İÁ½ÉÑI•Í¥é•Q¥µ•È¤±•…ÉQ¥µ•½ÕĞ¡Ù¥•İÁ½ÉÑI•Í¥é•Q¥µ•È¤ì(€€€Ù¥•İÁ½ÉÑI•Í¥é•Q¥µ•È€ôİ¥¹‘½Ü¹Í•ÑQ¥µ•½ÕĞ  ¤€ôøì(€€€€€¥˜€¡½Á•¸¤ì(€€€€€€€™±½…Ñ¥¹•½µ•ÑÉä€ôÉ•…‘±½…Ñ¥¹•½µ•ÑÉä ¤ì(€€€€€€€…ÁÁ±å±½…Ñ¥¹•½µ•ÑÉä ¤ì(€€€€€€€Ù½¥Á•ÉÍ¥ÍÑ•½µ•ÑÉä ¤ì(€€€€€ô•±Í”ì(€€€€€€€…ÁÁ±å=É‰A½Í¥Ñ¥½¸ ¤ì(€€€€€€€Ù½¥Á•ÉÍ¥ÍÑ=É‰A½Í¥Ñ¥½¸ ¤ì(€€€€€ô(€€€ô°€àÀ¤ì(€ô¤ì((€Ù½¥É•ÍÑ½É••½µ•ÑÉä ¤ì)ô¤ ¤ì(