import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent
} from "react";
import type { CanvasTab } from "../../shared/types";
import { useExecution } from "../state/ExecutionProvider";
import { useWorkspace } from "../state/WorkspaceProvider";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconButton } from "./controls";
import { MoreIcon, PenIcon, PlusIcon, TrashIcon } from "./icons";
import { Menu, type MenuEntry } from "./Menu";

type TabMenuState = {
  x: number;
  y: number;
  canvas: CanvasTab;
};

export function CanvasTabs() {
  const {
    tabs,
    activeCanvasId,
    busy,
    unread,
    switchCanvas,
    createCanvas,
    deleteCanvas,
    renameCanvas
  } = useWorkspace();
  const { entries } = useExecution();
  const trackRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState("");
  const [tabMenu, setTabMenu] = useState<TabMenuState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CanvasTab | null>(null);
  const cancelEditRef = useRef(false);

  useEffect(() => {
    if (!editingId) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
  }, [editingId]);

  const activityByCanvas = useMemo(() => {
    const activity: Record<string, "working" | "error"> = {};
    for (const entry of Object.values(entries)) {
      if (entry.tone === "working") activity[entry.canvasId] = "working";
      else if (entry.tone === "error" && activity[entry.canvasId] !== "working") {
        activity[entry.canvasId] = "error";
      }
    }
    return activity;
  }, [entries]);

  const beginRename = (canvas: CanvasTab) => {
    if (busy) return;
    cancelEditRef.current = false;
    setDraft(canvas.title);
    setEditingId(canvas.id);
  };

  const commitRename = async (canvas: CanvasTab) => {
    if (cancelEditRef.current) {
      cancelEditRef.current = false;
      setEditingId("");
      return;
    }
    const title = draft.trim();
    setEditingId("");
    if (!title || title === canvas.title) return;
    await renameCanvas(canvas.id, title);
  };

  const cancelRename = () => {
    cancelEditRef.current = true;
    setEditingId("");
  };

  const handleTabWheel = (event: WheelEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track || track.scrollWidth <= track.clientWidth) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    track.scrollLeft += event.deltaY;
    event.preventDefault();
  };

  const activeCanvas = tabs.find((canvas) => canvas.id === activeCanvasId);
  const buildMenuItems = (canvas: CanvasTab): MenuEntry[] => [
    {
      label: "重命名画布",
      icon: <PenIcon size={14} />,
      onSelect: () => beginRename(canvas)
    },
    "separator",
    {
      label: "删除画布",
      icon: <TrashIcon size={14} />,
      danger: true,
      disabled: tabs.length <= 1 || busy,
      onSelect: () => setDeleteTarget(canvas)
    }
  ];

  return (
    <>
      <nav className="bb-tabs" aria-label="画布">
        <div className="bb-tabs-track" ref={trackRef} onWheel={handleTabWheel}>
          {tabs.map((canvas) => {
            const isActive = canvas.id === activeCanvasId;
            const activity = activityByCanvas[canvas.id];
            const unreadCount = unread[canvas.id] ?? 0;
            if (editingId === canvas.id) {
              return (
                <div key={canvas.id} className="bb-tab editing">
                  <input
                    ref={inputRef}
                    value={draft}
                    maxLength={40}
                    aria-label="画布名称"
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => void commitRename(canvas)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commitRename(canvas);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRename();
                      }
                    }}
                  />
                </div>
              );
            }
            return (
              <button
                key={canvas.id}
                type="button"
                className={`bb-tab ${isActive ? "active" : ""}`}
                aria-pressed={isActive}
                disabled={busy && !isActive}
                title={canvas.title}
                onClick={() => {
                  if (!isActive) void switchCanvas(canvas.id);
                }}
                onDoubleClick={() => {
                  void (async () => {
                    if (!isActive) {
                      const switched = await switchCanvas(canvas.id);
                      if (!switched) return;
                    }
                    beginRename(canvas);
                  })();
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setTabMenu({ x: event.clientX, y: event.clientY, canvas });
                }}
              >
                <span className="bb-tab-title">{canvas.title}</span>
                {activity === "working" ? (
                  <span className="bb-tab-activity working" aria-label="正在生成" />
                ) : activity === "error" ? (
                  <span className="bb-tab-activity error" aria-label="生成失败" />
                ) : unreadCount > 0 ? (
                  <span className="bb-tab-unread" aria-label={`${unreadCount} 张新图片`}>
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <IconButton
          label="新建画布"
          size="sm"
          className="bb-tab-add"
          disabled={busy}
          onClick={() => void createCanvas()}
        >
          <PlusIcon size={14} />
        </IconButton>
        {activeCanvas ? (
          <IconButton
            label="当前画布操作"
            size="sm"
            className="bb-tab-more"
            disabled={busy}
            onClick={(event) =>
              setTabMenu({
                x: event.clientX,
                y: event.currentTarget.getBoundingClientRect().bottom + 4,
                canvas: activeCanvas
              })
            }
          >
            <MoreIcon size={14} />
          </IconButton>
        ) : null}
      </nav>

      {tabMenu ? (
        <Menu
          x={tabMenu.x}
          y={tabMenu.y}
          header={tabMenu.canvas.title}
          items={buildMenuItems(tabMenu.canvas)}
          onClose={() => setTabMenu(null)}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title={`删除画布「${deleteTarget.title}」？`}
          description="画布中的节点、图片和本地记录会被删除，此操作无法撤销。"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            void deleteCanvas(target.id);
          }}
        />
      ) : null}
    </>
  );
}
