import { useEditorActions, useEditorState } from "../state/EditorContext";
import { IconButton } from "./controls";
import { FitIcon, MinusIcon, PlusIcon, TrashIcon } from "./icons";

export function ZoomControls() {
  const { viewport, selectedCount } = useEditorState();
  const { zoomBy, zoomTo, fitAll, deleteSelected } = useEditorActions();
  return (
    <div className="bb-zoom-controls">
      {selectedCount > 0 ? (
        <div className="bb-selection-pill">
          <span>{selectedCount} 个已选</span>
          <IconButton
            label="删除选中节点"
            size="sm"
            danger
            onClick={deleteSelected}
          >
            <TrashIcon size={14} />
          </IconButton>
        </div>
      ) : null}
      <div className="bb-zoom-cluster">
        <IconButton label="缩小" size="sm" onClick={() => zoomBy(1 / 1.2)}>
          <MinusIcon size={14} />
        </IconButton>
        <button
          type="button"
          className="bb-zoom-value"
          title="恢复到 100%"
          onClick={() => zoomTo(1)}
        >
          {Math.round(viewport.zoom * 100)}%
        </button>
        <IconButton label="放大" size="sm" onClick={() => zoomBy(1.2)}>
          <PlusIcon size={14} />
        </IconButton>
        <IconButton label="查看全部内容" size="sm" onClick={fitAll}>
          <FitIcon size={14} />
        </IconButton>
      </div>
    </div>
  );
}
