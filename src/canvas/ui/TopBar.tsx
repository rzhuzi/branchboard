import { useEditorActions, useEditorState } from "../state/EditorContext";
import { useSettings } from "../state/SettingsProvider";
import { useWorkspace } from "../state/WorkspaceProvider";
import { Brand } from "./Brand";
import { CanvasTabs } from "./CanvasTabs";
import { IconButton } from "./controls";
import { HelpPopover } from "./HelpPopover";
import {
  MoonIcon,
  PlusIcon,
  RedoIcon,
  SunIcon,
  UndoIcon
} from "./icons";
import { TaskCenter } from "./TaskCenter";

function SaveIndicator() {
  const { saveState, saveError } = useEditorState();
  const { retrySave } = useEditorActions();
  const label =
    saveState === "saved" ? "已保存" : saveState === "saving" ? "保存中" : "保存失败";
  return (
    <span
      className={`bb-save-indicator ${saveState}`}
      title={saveState === "error" ? `${saveError || "保存失败"}，点击重试` : label}
      aria-live="polite"
      onClick={saveState === "error" ? retrySave : undefined}
      role={saveState === "error" ? "button" : "status"}
      tabIndex={saveState === "error" ? 0 : undefined}
      onKeyDown={(event) => {
        if (saveState === "error" && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          retrySave();
        }
      }}
    >
      <i aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function TopBar() {
  const { busy, embedded } = useWorkspace();
  const { canUndo, canRedo } = useEditorState();
  const { undo, redo, addPromptAtCenter } = useEditorActions();
  const { theme, toggleTheme } = useSettings();

  return (
    <header className="bb-topbar">
      {!embedded ? <Brand compact /> : null}
      <CanvasTabs />
      <div className="bb-topbar-actions">
        <SaveIndicator />
        <TaskCenter />
        <span className="bb-topbar-divider" aria-hidden="true" />
        <IconButton
          label="撤销 (Ctrl+Z)"
          size="sm"
          disabled={!canUndo}
          onClick={undo}
        >
          <UndoIcon size={15} />
        </IconButton>
        <IconButton
          label="重做 (Shift+Ctrl+Z)"
          size="sm"
          disabled={!canRedo}
          onClick={redo}
        >
          <RedoIcon size={15} />
        </IconButton>
        <button
          type="button"
          className="bb-new-prompt"
          title="新建提示词 (N)"
          disabled={busy}
          onClick={addPromptAtCenter}
        >
          <PlusIcon size={15} />
          <span>新建提示词</span>
        </button>
        <IconButton
          label={theme === "light" ? "切换到深色主题" : "切换到浅色主题"}
          size="sm"
          onClick={toggleTheme}
        >
          {theme === "light" ? <MoonIcon size={15} /> : <SunIcon size={15} />}
        </IconButton>
        <HelpPopover />
      </div>
    </header>
  );
}
