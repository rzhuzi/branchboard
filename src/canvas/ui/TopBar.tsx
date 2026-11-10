import { useEditorActions, useEditorState } from "../state/EditorContext";
import { useSettings } from "../state/SettingsProvider";
import { Brand } from "./Brand";
import { CanvasTabs } from "./CanvasTabs";
import { IconButton } from "./controls";
import { HelpPopover } from "./HelpPopover";
import { MoonIcon, SunIcon } from "./icons";
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
  const { theme, toggleTheme } = useSettings();

  return (
    <header className="bb-topbar">
      <Brand compact />
      <CanvasTabs />
      <div className="bb-topbar-actions">
        <SaveIndicator />
        <TaskCenter />
        <span className="bb-topbar-divider" aria-hidden="true" />
        <IconButton
          label={theme === "light" ? "切换到深色主题" : "切换到浅色主题"}
          onClick={toggleTheme}
        >
          {theme === "light" ? <MoonIcon size={17} /> : <SunIcon size={17} />}
        </IconButton>
        <HelpPopover />
      </div>
    </header>
  );
}
