import { Component, type ErrorInfo, type ReactNode } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { AssetProvider } from "./state/AssetProvider";
import { ExecutionProvider } from "./state/ExecutionProvider";
import { SettingsProvider } from "./state/SettingsProvider";
import { ToastProvider } from "./state/ToastProvider";
import { WorkspaceLoader } from "./state/WorkspaceProvider";
import { CanvasSurface } from "./ui/CanvasSurface";

class CanvasErrorBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: "" };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : "画布渲染失败" };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Branchboard canvas crashed", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="bb-app-loading error">
          <span className="bb-loader-mark" aria-hidden="true">
            !
          </span>
          <strong>画布遇到错误</strong>
          <p>{this.state.error}</p>
          <button
            type="button"
            className="bb-button primary"
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App({ embedded }: { embedded: boolean }) {
  return (
    <SettingsProvider embedded={embedded}>
      <AssetProvider>
        <ToastProvider>
          <ExecutionProvider embedded={embedded}>
            <ReactFlowProvider>
              <CanvasErrorBoundary>
                <WorkspaceLoader embedded={embedded}>
                  <CanvasSurface />
                </WorkspaceLoader>
              </CanvasErrorBoundary>
            </ReactFlowProvider>
          </ExecutionProvider>
        </ToastProvider>
      </AssetProvider>
    </SettingsProvider>
  );
}
