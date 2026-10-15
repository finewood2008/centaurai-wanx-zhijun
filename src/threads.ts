import {api, getActiveExpert, getActiveRole, roleRequestOptions} from './api';

export const THREAD_DELETED = 'zhijun-thread-deleted';
export type ThreadDeleted = {threadId: string; roleId: string; expertId: string};
export function currentThreadDeletion(event: Event): ThreadDeleted | null {
  const detail = (event as CustomEvent<ThreadDeleted>).detail;
  return detail && detail.roleId === getActiveRole() && detail.expertId === getActiveExpert() ? detail : null;
}
/** All deletion entry points share the same success notification and identity scope. */
export async function deleteThread(threadId: string): Promise<void> {
  const detail: ThreadDeleted = {threadId, roleId: getActiveRole(), expertId: getActiveExpert()};
  const signal = roleRequestOptions().signal;
  await api(`/threads/${encodeURIComponent(threadId)}`, 'DELETE');
  if (!signal?.aborted) window.dispatchEvent(new CustomEvent(THREAD_DELETED, {detail}));
}
