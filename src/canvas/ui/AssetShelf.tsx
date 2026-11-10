import type { CanvasNode, ImageNodeData } from "../../shared/types";
import { useAsset } from "../state/AssetProvider";
import { useEditorActions, useEditorState } from "../state/EditorContext";
import { IconButton, Spinner } from "./controls";
import { CloseIcon, ImageIcon, ImagePlusIcon } from "./icons";

type ImageCanvasNode = CanvasNode & { data: ImageNodeData };

function AssetThumbnail({ node, onLocate }: { node: ImageCanvasNode; onLocate: () => void }) {
  const { asset, loading, error } = useAsset(node.data.assetId);
  const { locateNodes } = useEditorActions();
  return (
    <button
      type="button"
      className={`bb-asset-thumbnail ${node.selected ? "selected" : ""}`}
      onClick={() => {
        locateNodes([node.id]);
        onLocate();
      }}
      aria-label={`定位图片：${node.data.name}`}
      title={error || node.data.name}
    >
      <span className="bb-asset-thumbnail-frame">
        {asset ? (
          <img src={asset.url} alt="" loading="lazy" />
        ) : loading ? <Spinner size={16} /> : <ImageIcon size={20} />}
      </span>
      <span className="bb-asset-thumbnail-name">{node.data.name}</span>
    </button>
  );
}

export function AssetShelf({ onClose, onImport }: {
  onClose: () => void;
  onImport: () => void;
}) {
  const { nodes } = useEditorState();
  const images = nodes.filter((node): node is ImageCanvasNode => node.data.kind === "image");
  return (
    <aside id="bb-asset-shelf" className="bb-asset-shelf" aria-label="画布图片">
      <header className="bb-asset-shelf-header">
        <strong>图片 <span>{images.length}</span></strong>
        <div>
          <IconButton size="sm" label="导入图片到画布" onClick={onImport}>
            <ImagePlusIcon size={15} />
          </IconButton>
          <IconButton size="sm" label="收起图片栏" onClick={onClose}>
            <CloseIcon size={15} />
          </IconButton>
        </div>
      </header>
      {images.length ? (
        <div className="bb-asset-grid">
          {images.map((node) => (
            <AssetThumbnail
              key={node.id}
              node={node}
              onLocate={() => {
                if (window.matchMedia("(max-width: 760px)").matches) onClose();
              }}
            />
          ))}
        </div>
      ) : (
        <button type="button" className="bb-asset-empty" onClick={onImport}>
          <ImagePlusIcon size={25} /><span>导入第一张图片</span>
        </button>
      )}
    </aside>
  );
}
