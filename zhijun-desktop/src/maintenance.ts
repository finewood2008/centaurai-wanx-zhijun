import { request } from "../../dashboard/src/api/request";
import { isNotFoundApiError } from "../../dashboard/src/utils/apiError";
export type MemoryKind =
  | "atom"
  | "raw"
  | "episode"
  | "candidate"
  | "entity"
  | "ontology";
export type MaintenancePreview = {
  kind: MemoryKind;
  id: string;
  title: string;
  content?: string;
  version: string;
  counts: Record<string, number>;
};
export type MaintenanceRecord = MaintenancePreview & {
  archive_id: string;
  at: string;
  status: "prepared" | "archived" | "restoring" | "restored" | "purged";
};
export const maintenanceApi = {
  list: () => request<{ items: MaintenanceRecord[] }>("/zhijun/maintenance"),
  preview: (kind: MemoryKind, id: string) =>
    request<MaintenancePreview>("/zhijun/maintenance:preview", {
      method: "POST",
      body: JSON.stringify({ kind, id }),
    }),
  write: (preview: MaintenancePreview, action: "archive" | "purge") =>
    request<MaintenanceRecord>("/zhijun/maintenance", {
      method: "POST",
      body: JSON.stringify({
        kind: preview.kind,
        id: preview.id,
        version: preview.version,
        action,
      }),
    }),
  archive: (row: MaintenanceRecord, action: "restore" | "purge") =>
    request<MaintenanceRecord>("/zhijun/maintenance:archive", {
      method: "POST",
      body: JSON.stringify({
        archive_id: row.archive_id,
        version: row.version,
        action,
      }),
    }),
};
export function refreshMemory() {
  window.dispatchEvent(new Event("zhijun-memory-changed"));
}
export async function verifyAbsent(read: () => Promise<unknown>) {
  try {
    await read();
  } catch (e) {
    if (isNotFoundApiError(e)) return;
    throw e;
  }
  throw new Error("删除结果尚未核实，请刷新核对。不会自动再次删除。");
}
