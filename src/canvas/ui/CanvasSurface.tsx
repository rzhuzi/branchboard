import { useEditorActions, useEditorState } from "../state/EditorContext";
import { Button } from "./controls";
import { CanvasView } from "./CanvasView";
import { TopBar } from "./TopBar";

export function CanvasSurface() {
  const { saveState, saveError } = useEditorState();
  const { retrySave } = useEditorActions();
  return (
    <main className="bb-app">
      <TopBar />
      {saveState === "error" ? (
        <div className="bb-save-banner" role="alert">
          <span>{saveError || "当前修改尚未保存"}</span>
          <Button variant="secondary" onClick={retrySave}>
            重试保存
          </Button>
        </div>
      ) : null}
      <CanvasView />
    </main>
  );
}
