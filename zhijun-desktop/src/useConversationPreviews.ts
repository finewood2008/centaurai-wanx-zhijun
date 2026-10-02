import { useEffect, useRef, useState } from "react";
import {
  octopThreadsApi,
  type OctopThread,
} from "../../dashboard/src/api/modules/octopThreads";
import {
  extractText,
  filterDialogueHistoryMessages,
} from "../../dashboard/src/utils/messageParser";

type Preview =
  | { status: "ready"; text: string; role: string }
  | { status: "pending" | "empty" | "unavailable" };

function previewKey(row: OctopThread) {
  return `${row.thread_id}:${row.last_active}`;
}

/** Read only the visible page, with two small history requests at a time. */
export function useConversationPreviews(
  agentId: string,
  rows: OctopThread[],
  list: OctopThread[] | null,
) {
  const cache = useRef(new Map<string, Preview>());
  const previousList = useRef<OctopThread[] | null>(null);
  const workers = useRef([Promise.resolve(), Promise.resolve()]);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const key = rows.map(previewKey).join("|");
  useEffect(() => {
    let alive = true;
    if (previousList.current !== list) {
      cache.current.clear();
      previousList.current = list;
    }
    setPreviews(Object.fromEntries(cache.current));
    const queue = rows.filter(
      (row) =>
        row.has_messages !== false && !cache.current.has(previewKey(row)),
    );
    const read = async () => {
      while (alive && queue.length) {
        const row = queue.shift()!;
        let preview: Preview;
        try {
          const history = await octopThreadsApi.history(
            agentId,
            row.thread_id,
            {
              limit: 4,
              offset: 0,
            },
          );
          if (history.thread_id !== row.thread_id)
            throw new Error("对话归属未核实");
          if (history.history_status === "failed") {
            preview = { status: "unavailable" };
          } else if (history.history_loading) {
            preview = { status: "pending" };
          } else {
            const message = filterDialogueHistoryMessages(history.messages)
              .slice()
              .reverse()
              .find((item) => extractText(item.content).trim());
            preview = message
              ? {
                  status: "ready",
                  role: message.role,
                  text: extractText(message.content)
                    .replace(/\s+/g, " ")
                    .trim()
                    .slice(0, 180),
                }
              : { status: "empty" };
          }
        } catch {
          preview = { status: "unavailable" };
        }
        if (alive) {
          cache.current.set(previewKey(row), preview);
          setPreviews(Object.fromEntries(cache.current));
        }
      }
    };
    workers.current = workers.current.map((worker) => worker.then(read));
    return () => {
      alive = false;
    };
  }, [agentId, key, list]);
  return (row: OctopThread) => previews[previewKey(row)];
}
