import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { blobToDataUrl, imageSizeFromBlob } from "../../shared/blob";
import { getAsset, putAsset } from "../../shared/db";
import type { StoredAsset } from "../../shared/types";

export type AssetEntry = {
  id: string;
  blob: Blob;
  url: string;
  mime: string;
  width: number;
  height: number;
  createdAt: string;
  name?: string;
};

type StoreBlobOptions = {
  name?: string;
  width?: number;
  height?: number;
  hash?: string;
};

type AssetContextValue = {
  getAssetEntry: (assetId: string) => Promise<AssetEntry>;
  storeBlob: (blob: Blob, options?: StoreBlobOptions) => Promise<AssetEntry>;
  getDataUrl: (assetId: string) => Promise<string>;
};

const AssetContext = createContext<AssetContextValue | null>(null);

function toEntry(asset: StoredAsset): AssetEntry {
  return {
    id: asset.id,
    blob: asset.blob,
    url: URL.createObjectURL(asset.blob),
    mime: asset.mime,
    width: asset.width,
    height: asset.height,
    createdAt: asset.createdAt,
    name: asset.name
  };
}

export function AssetProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, AssetEntry>());
  const pending = useRef(new Map<string, Promise<AssetEntry>>());

  const getAssetEntry = useCallback(async (assetId: string): Promise<AssetEntry> => {
    const cached = entries.current.get(assetId);
    if (cached) return cached;
    const inFlight = pending.current.get(assetId);
    if (inFlight) return inFlight;
    const promise = (async () => {
      const stored = await getAsset(assetId);
      if (!stored) throw new Error("图片资源不存在或已被删除");
      const entry = toEntry(stored);
      entries.current.set(assetId, entry);
      return entry;
    })();
    pending.current.set(assetId, promise);
    try {
      return await promise;
    } finally {
      pending.current.delete(assetId);
    }
  }, []);

  const storeBlob = useCallback(
    async (blob: Blob, options: StoreBlobOptions = {}): Promise<AssetEntry> => {
      const mime = blob.type || "image/png";
      let width = Number(options.width) || 0;
      let height = Number(options.height) || 0;
      if (!width || !height) {
        try {
          const size = await imageSizeFromBlob(blob);
          width = size.width;
          height = size.height;
        } catch {
          width = 1024;
          height = 1024;
        }
      }
      const asset: StoredAsset = {
        id: crypto.randomUUID(),
        blob,
        mime,
        width,
        height,
        createdAt: new Date().toISOString(),
        hash: options.hash,
        name: options.name
      };
      await putAsset(asset);
      const entry = toEntry(asset);
      entries.current.set(asset.id, entry);
      return entry;
    },
    []
  );

  const getDataUrl = useCallback(
    async (assetId: string): Promise<string> => {
      const entry = await getAssetEntry(assetId);
      return blobToDataUrl(entry.blob);
    },
    [getAssetEntry]
  );

  useEffect(
    () => () => {
      for (const entry of entries.current.values()) URL.revokeObjectURL(entry.url);
      entries.current.clear();
    },
    []
  );

  const value = useMemo<AssetContextValue>(
    () => ({ getAssetEntry, storeBlob, getDataUrl }),
    [getAssetEntry, getDataUrl, storeBlob]
  );

  return <AssetContext.Provider value={value}>{children}</AssetContext.Provider>;
}

export function useAssets(): AssetContextValue {
  const context = useContext(AssetContext);
  if (!context) throw new Error("useAssets must be used inside AssetProvider");
  return context;
}

export function useAsset(assetId: string | undefined): {
  asset: AssetEntry | null;
  error: string;
  loading: boolean;
} {
  const { getAssetEntry } = useAssets();
  const [asset, setAsset] = useState<AssetEntry | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(assetId));

  useEffect(() => {
    let cancelled = false;
    if (!assetId) {
      setAsset(null);
      setError("");
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setError("");
    void getAssetEntry(assetId)
      .then((entry) => {
        if (cancelled) return;
        setAsset(entry);
        setLoading(false);
      })
      .catch((reason) => {
        if (cancelled) return;
        setAsset(null);
        setError(reason instanceof Error ? reason.message : "图片加载失败");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assetId, getAssetEntry]);

  return { asset, error, loading };
}
