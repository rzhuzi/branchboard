import type { CanvasDocument } from "../../shared/types";
import type { WorkspaceSession } from "../../shared/workspace";
import { useAssets } from "./AssetProvider";
import { useExecution } from "./ExecutionProvider";
import { useToast } from "./ToastProvider";
import type { EditorActions, EditorStateValue } from "./EditorContext";
import { useEditorCore } from "./editorCore";
import { useEditorSave } from "./useEditorSave";
import { useEditorHistory } from "./useEditorHistory";
import { useEditorViewport } from "./useEditorViewport";
import { useEditorNodes } from "./useEditorNodes";
import { useEditorImages } from "./useEditorImages";
import { useEditorBindings } from "./useEditorBindings";

export function useEditor({
  workspace,
  canvasId,
  document: initialDocument,
  embedded
}: {
  workspace: WorkspaceSession;
  canvasId: string;
  document: CanvasDocument;
  embedded: boolean;
}): {
  state: EditorStateValue;
  actions: EditorActions;
  flush: () => Promise<boolean>;
  isDirty: () => boolean;
} {
  const { getAssetEntry, getDataUrl, storeBlob } = useAssets();
  const { cancelPrompt, runPrompt } = useExecution();
  const { pushToast } = useToast();

  const core = useEditorCore({ canvasId, document: initialDocument });

  const history = useEditorHistory(core, { cancelPrompt });
  const viewport = useEditorViewport(core);
  const nodes = useEditorNodes(
    core,
    {
      focusPrompt: viewport.focusPrompt,
      clampToVisible: viewport.clampToVisible,
      canvasCenterFlow: viewport.canvasCenterFlow
    },
    { cancelPrompt, pushToast }
  );
  const images = useEditorImages(
    core,
    { insertImageAssets: nodes.insertImageAssets },
    { embedded, getDataUrl, getAssetEntry, storeBlob, runPrompt, pushToast }
  );
  const save = useEditorSave(core, workspace);

  const { actions, state } = useEditorBindings(
    core,
    history,
    viewport,
    nodes,
    images,
    save
  );

  return { state, actions, flush: save.flush, isDirty: save.isDirty };
}
