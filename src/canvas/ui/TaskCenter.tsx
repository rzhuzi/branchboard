import { useEffect, useRef, useState } from "react";
import type { PromptExecution } from "../../shared/types";
import { useExecution } from "../state/ExecutionProvider";
import { useWorkspace } from "../state/WorkspaceProvider";
import { Spinner } from "./controls";
import { CloseIcon, LocateIcon } from "./icons";

function useElapsed(startedAt: number, active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return Math.max(0, now - startedAt);
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function TaskRow({ entry }: { entry: PromptExecution }) {
  const { tabs, focusPromptInCanvas } = useWorkspace();
  const { cancelPrompt } = useExecution();
  const elapsed = useElapsed(entry.startedAt, entry.tone === "working");
  const canvasTitle =
    tabs.find((canvas) => canvas.id === entry.canvasId)?.title ?? "画布";
  return (
    <div className="bb-task-row">
      <div className="bb-task-main">
        <span className={`bb-task-state ${entry.tone}`}>
          {entry.tone === "working" ? <Spinner size={11} /> : null}
          {entry.tone === "working" ? "生成中" : "排队中"}
        </span>
        <strong title={entry.title}>{entry.title || "未命名提示词"}</strong>
        <span className="bb-task-meta">
          {canvasTitle} · {entry.tone === "working" ? formatElapsed(elapsed) : "等待前一个任务"}
        </span>
        <span className="bb-task-message">{entry.message}</span>
      </div>
      <div className="bb-task-actions">
        <button
          type="button"
          className="bb-task-action"
          title="定位提示词"
          aria-label="定位提示词"
          onClick={() => void focusPromptInCanvas(entry.canvasId, entry.promptId)}
        >
          <LocateIcon size={14} />
        </button>
        <button
          type="button"
          className="bb-task-action danger"
          title="取消生成"
          aria-label="取消生成"
          onClick={() => cancelPrompt(entry.promptId)}
        >
          <CloseIcon size={14} />
        </button>
      </div>
    </div>
  );
}

export function TaskCenter() {
  const { entries, workingCount, queuedCount } = useExecution();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tasks = Object.values(entries)
    .filter((entry) => entry.tone === "working" || entry.tone === "queued")
    .sort((a, b) => a.startedAt - b.startedAt);

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

  if (!tasks.length) return null;

  return (
    <div className="bb-task-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`bb-task-trigger ${open ? "active" : ""}`}
        aria-label={`${workingCount + queuedCount} 个生成任务`}
        title="生成任务"
        onClick={() => setOpen((value) => !value)}
      >
        <Spinner size={13} />
        <span>{workingCount + queuedCount}</span>
      </button>
      {open ? (
        <div className="bb-popover bb-task-popover" role="dialog" aria-label="生成任务">
          <header className="bb-popover-header">
            <strong>生成任务</strong>
            <span>
              {workingCount} 运行中
              {queuedCount ? ` · ${queuedCount} 排队` : ""}
            </span>
          </header>
          <div className="bb-task-list">
            {tasks.map((entry) => (
              <TaskRow key={entry.promptId} entry={entry} />
            ))}
          </div>
          <p className="bb-popover-note">
            任务按顺序执行，取消后可继续使用当前 ChatGPT 页面。
          </p>
        </div>
      ) : null}
    </div>
  );
}
