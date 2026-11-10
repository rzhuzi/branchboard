import { useState } from "react";
import { useEditorActions, useEditorState } from "../state/EditorContext";
import { useWorkspace } from "../state/WorkspaceProvider";
import { Button } from "./controls";
import { CanvasView } from "./CanvasView";
import { TopBar } from "./TopBar";

export function CanvasSurface() {
  const [assetsOpen, setAssetsOpen] = useState(false);
  const { saveState, saveError } = useEditorState();
  const { retrySave } = useEditorActions();
  const { embedded } = useWorkspace();
  return (
    <main className={`bb-app ${embedded ? "embedded" : ""}`.trim()}>
      <TopBar assetsOpen={assetsOpen} onToggleAssets={() => setAssetsOpen((open) => !open)} />
      {saveState === "error" ? (
        <div className="bb-save-banner" role="alert">
          <span>{saveError || "当前修改尚未保存"}</span>
          <Button variant="secondary" onClick={retrySave}>
            重试保存
          </Button>
        </div>
      ) : null}
      <CanvasView assetsOpen={assetsOpen} onCloseAssets={() => setAssetsOpen(false)} />
    </main>
  );
}
