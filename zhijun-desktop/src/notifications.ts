import { request } from "../../dashboard/src/api/request";

export type ChannelPolicy = {
  channel_id: string;
  purpose: "work" | "private";
  declared: boolean;
};

export const notificationApi = {
  list: () => request<ChannelPolicy[]>("/zhijun/notification-channels"),
  setPurpose: (channel_id: string, purpose: ChannelPolicy["purpose"]) =>
    request<ChannelPolicy>("/zhijun/notification-channels", {
      method: "PUT",
      body: JSON.stringify({ channel_id, purpose }),
    }),
};
