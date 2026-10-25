import { useEffect, useRef, useState } from "react";
import { IconButton, Kbd } from "./controls";
import { HelpIcon } from "./icons";

function Shortcut({ keys, children }: { keys: string[]; children: string }) {
  return (
    <div className="bb-shortcut">
      <span>
        {keys.map((key, index) => (
          <Kbd key={`${key}-${index}`}>{key}</Kbd>
        ))}
      </span>
      <span>{children}</span>
    </div>
  );
}

export function HelpPopover() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && wrapRef.current?.contains(event.target)) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="bb-help-wrap" ref={wrapRef}>
      <IconButton
        label="快捷键与关系说明"
        active={open}
        onClick={() => setOpen((value) => !value)}
      >
        <HelpIcon size={16} />
      </IconButton>
      {open ? (
        <div className="bb-popover bb-help-popover" role="dialog" aria-label="帮助">
          <header className="bb-popover-header">
            <strong>操作与关系</strong>
          </header>
          <section>
            <h3>画布</h3>
            <Shortcut keys={["拖动空白", "滚轮"]}>平移画布</Shortcut>
            <Shortcut keys={["Ctrl", "滚轮"]}>以光标为中心缩放</Shortcut>
            <Shortcut keys={["Shift", "拖动"]}>框选节点</Shortcut>
            <Shortcut keys={["双击空白"]}>新建提示词</Shortcut>
          </section>
          <section>
            <h3>节点</h3>
            <Shortcut keys={["Ctrl", "Enter"]}>在提示词中生成</Shortcut>
            <Shortcut keys={["Ctrl", "Z"]}>撤销当前画布</Shortcut>
            <Shortcut keys={["Shift", "Ctrl", "Z"]}>重做</Shortcut>
            <Shortcut keys={["Ctrl", "D"]}>复制选中节点</Shortcut>
            <Shortcut keys={["Delete"]}>删除选中节点</Shortcut>
            <Shortcut keys={["双击图片"]}>预览大图</Shortcut>
          </section>
          <section>
            <h3>关系</h3>
            <div className="bb-legend">
              <span className="bb-legend-line generated" />
              <span>实线：生成结果</span>
            </div>
            <div className="bb-legend">
              <span className="bb-legend-line reference" />
              <span>虚线：图片作为参考</span>
            </div>
            <div className="bb-legend">
              <span className="bb-legend-line branch" />
              <span>点线：提示词分支</span>
            </div>
            <p className="bb-help-note">
              从图片右侧的圆点拖到提示词左侧，可手动建立参考关系。
            </p>
          </section>
          <section>
            <h3>生成</h3>
            <p className="bb-help-note">
              点击节点上的「生成」后，Branchboard 会操作当前 ChatGPT 页面。
              若 ChatGPT 输入框已有草稿，会停止发送以免覆盖。网页结构变化时，
              可先复制提示词手动发送，再把图片拖回画布。
            </p>
          </section>
        </div>
      ) : null}
    </div>
  );
}
