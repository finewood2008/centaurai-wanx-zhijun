import type { ChatAttachment } from "../../dashboard/src/pages/Chat/hooks/sseHelpers";
import { workspacePathFromAccessUrl } from "../../dashboard/src/utils/toolMediaBlocks";

export function inboundPath(path: string | undefined): string | null {
  const normalized = path?.replace(/^\/+/, "") || "";
  return /^inbound\/[^/]+$/.test(normalized) &&
    !normalized.split("/").some((part) => part === ".." || part === ".") &&
    !/[\\\0]/.test(normalized)
    ? normalized
    : null;
}

export function attachmentPath(attachment: ChatAttachment): string | null {
  return inboundPath(
    attachment.workspacePath || workspacePathFromAccessUrl(attachment.url),
  );
}
