import { useCallback, useEffect, useRef } from "react";
import { mergeCanvasSnapshots } from "../../shared/merge";
import type { WorkspaceSession } from "../../shared/workspace";
import {
  prepareEdges,
  prepareNodes,
  snapshotFromDocument
} from "./editorPure";
import type { EditorCore } from "./editorCore";

export function useEditorSave(core: EditorCore, workspace: WorkspaceSession) {
  const {
    applyState,
    canvasIdRef,
    changeVersionRef,
    dirtyRef,
    flushViewport,
    historiesRef,
    revisionRef,
    saveLoopRef,
    saveNowRef,
    saveStateRef,
    saveTimerRef,
    setSaveState,
    setSaveStatus,
    setHistoryVersion,
    snapshotNow,
    viewportDirtyRef
  } = core;

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (saveLoopRef.current) {
      await saveLoopRef.current;
      if (!dirtyRef.current) return saveStateRef.current !== "error";
    }

    const run = async (): Promise<boolean> => {
      let loops = 0;
      while (dirtyRef.current && loops < 4) {
        loops += 1;
        const targetCanvasId = canvasIdRef.current;
        const versionAtStart = changeVersionRef.current;
        const candidate = snapshotNow();
        const result = await workspace.commit(targetCanvasId, candidate);
        if (canvasIdRef.current !== targetCanvasId) return true;
        if (!result.ok) {
          setSaveStatus("error", result.message);
          return false;
        }
        revisionRef.current = result.document.revision;
        if (result.merged) {
          const merged =
            changeVersionRef.current === versionAtStart
              ? snapshotFromDocument(result.document)
              : mergeCanvasSnapshots(
                  candidate,
                  snapshotNow(),
                  snapshotFromDocument(result.document)
                );
          applyState(prepareNodes(merged.nodes), merged.edges);
        }
        if (changeVersionRef.current === versionAtStart) {
          dirtyRef.current = false;
          setSaveStatus("saved");
          return true;
        }
      }
      if (dirtyRef.current) {
        saveStateRef.current = "saving";
        setSaveState("saving");
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = null;
          if (dirtyRef.current) void saveNowRef.current?.();
        }, 480);
      }
      return !dirtyRef.current && saveStateRef.current !== "error";
    };

    const promise = run();
    saveLoopRef.current = promise;
    try {
      return await promise;
    } finally {
      if (saveLoopRef.current === promise) saveLoopRef.current = null;
    }
  }, [applyState, setSaveStatus, snapshotNow, workspace]);

  saveNowRef.current = saveNow;

  const flushViewportRef = useRef(flushViewport);
  flushViewportRef.current = flushViewport;

  const retrySave = useCallback(() => {
    if (!dirtyRef.current) {
      setSaveStatus("saved");
      return;
    }
    setSaveStatus("saving");
    void saveNow();
  }, [saveNow, setSaveStatus]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    for (let attempt = 0; attempt < 3 && dirtyRef.current; attempt += 1) {
      await saveNow();
    }
    if (saveLoopRef.current) await saveLoopRef.current;
    const contentSaved = !dirtyRef.current && saveStateRef.current !== "error";
    const viewportSaved = await flushViewport();
    return contentSaved && viewportSaved;
  }, [flushViewport, saveNow]);

  const isDirty = useCallback(
    () => dirtyRef.current || viewportDirtyRef.current,
    [viewportDirtyRef]
  );

  useEffect(() => {
    const unsubscribe = workspace.subscribe((change) => {
      if (change.kind !== "canvas" || change.canvasId !== canvasIdRef.current) return;
      if (dirtyRef.current) return;
      void workspace.refreshDocument(change.canvasId).then((documentData) => {
        if (
          !documentData ||
          dirtyRef.current ||
          canvasIdRef.current !== change.canvasId ||
          documentData.revision <= revisionRef.current
        ) {
          return;
        }
        revisionRef.current = documentData.revision;
        const nextNodes = prepareNodes(documentData.nodes);
        const nextEdges = prepareEdges(documentData.edges, nextNodes);
        applyState(nextNodes, nextEdges);
        workspace.acceptDocument(documentData);
        historiesRef.current.set(change.canvasId, { past: [], future: [] });
        setHistoryVersion((value) => value + 1);
        setSaveStatus("saved");
      });
    });
    return unsubscribe;
  }, [applyState, setSaveStatus, workspace]);

  useEffect(() => {
    const flushOnHide = () => {
      if (document.visibilityState === "hidden" && dirtyRef.current) {
        void saveNowRef.current?.();
      }
      if (viewportDirtyRef.current) void flushViewportRef.current?.();
    };
    const flushOnPageHide = () => {
      if (dirtyRef.current) void saveNowRef.current?.();
      if (viewportDirtyRef.current) void flushViewportRef.current?.();
    };
    document.addEventListener("visibilitychange", flushOnHide);
    window.addEventListener("pagehide", flushOnPageHide);
    return () => {
      document.removeEventListener("visibilitychange", flushOnHide);
      window.removeEventListener("pagehide", flushOnPageHide);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { saveNow, retrySave, flush, isDirty };
}

export type SaveApi = ReturnType<typeof useEditorSave>;
