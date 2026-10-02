import {
  memoryDashboardApi,
  type EpisodeItem,
  type ListEpisodesBody,
} from "../../dashboard/src/api/modules/memoryDashboard";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
dayjs.extend(utc);
dayjs.extend(timezone);

export const emotionLabels: Record<string, string> = {
  neutral: "平静",
  happy: "开心",
  sad: "难过",
  angry: "生气",
  anxious: "焦虑",
  excited: "兴奋",
  frustrated: "受挫",
  grateful: "感激",
  tired: "疲惫",
  reflective: "沉思",
};
export const emotionLabel = (emotion: string) =>
  emotionLabels[emotion] || emotion || "未提炼情绪";

/** Add native source fields locally without changing WANX's shared API types. */
export type ZhijunEpisode = EpisodeItem & {
  raw_event_ids?: string[];
  quote_event_id?: string | null;
};
export const episodeApi = {
  list: async (agentId: string, body: ListEpisodesBody) => {
    const result = await memoryDashboardApi.listEpisodes(agentId, body);
    return { ...result, items: result.items as ZhijunEpisode[] };
  },
  get: async (agentId: string, id: string) =>
    (await memoryDashboardApi.getEpisode(agentId, id)) as ZhijunEpisode,
};

export function recentSevenDays(
  timeZone: string,
  now = new Date(),
): { from: string; to: string } {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  const to = `${part("year")}-${part("month")}-${part("day")}`;
  const first = new Date(`${to}T12:00:00Z`);
  first.setUTCDate(first.getUTCDate() - 6);
  return { from: first.toISOString().slice(0, 10), to };
}

export function dateBounds(from: string, to: string, timeZone: string) {
  return {
    date_from: from
      ? dayjs.tz(from, timeZone).startOf("day").toISOString()
      : undefined,
    date_to: to
      ? dayjs
          .tz(dayjs.utc(to).add(1, "day").format("YYYY-MM-DD"), timeZone)
          .startOf("day")
          .toISOString()
      : undefined,
  };
}

export function stageReviewDraft(
  from: string,
  to: string,
  timeZone: string,
): string {
  const bounds = dateBounds(from, to, timeZone);
  return `我想回看 ${from} 至 ${to} 这段时间（${timeZone}，包含起止两天）。请用 zhijun_episode_search 按 date_from=${bounds.date_from}、date_to=${bounds.date_to}（不包含结束边界）分页查找本档案的经历，逐条用 zhijun_episode_get 查证原话，也查找相关事实与决定。只依据实际读到的材料，说说重要的事情、当时的感受和后来的变化；说明覆盖范围、记录不足或尚未读完之处。我们再一起聊聊其中最在意的一件事。`;
}
