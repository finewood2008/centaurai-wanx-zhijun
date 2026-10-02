import { useCallback, useEffect, useRef, useState } from "react";
import {
  authApi,
  type OctopUser,
  type PublicCaptcha,
} from "../../dashboard/src/api/modules/auth";
import {
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  setActiveAgentId,
  UNAUTHORIZED_EVENT,
  FORBIDDEN_EVENT,
} from "../../dashboard/src/api/request";
import CaptchaField, {
  type CaptchaFieldHandle,
} from "../../dashboard/src/pages/Login/CaptchaField";
import {
  MIN_PASSWORD_LENGTH,
  passwordPolicyIssue,
} from "../../dashboard/src/utils/passwordPolicy";
import {
  apiErrorMessage,
  parseApiError,
} from "../../dashboard/src/utils/apiError";
import {
  clearConversationCaches,
  clearLegacyBindings,
  profileApi,
  validProfile,
  type ZhijunProfile,
} from "./profile";
import { Conversation } from "./Conversation";
import {
  MemoryPanel,
  ConversationsPanel,
  Sources,
  Preferences,
} from "./Panels";
import { DigitalSelf } from "./DigitalSelfPanel";
import { ExperienceNavigation } from "./ExperienceNavigation";
import type { MemoryReference } from "./references";
import { attachmentPath } from "./attachmentPaths";
import { KnowledgeLibrary } from "./KnowledgeLibrary";
import { AboutZhijun } from "./AboutZhijun";
import { applyReadingSize, readReadingSize } from "./ReadingPreferences";
import { useMemoryMaintenance } from "../../dashboard/src/pages/Chat/hooks/useMemoryMaintenance";
import {
  memoryDashboardApi,
  type StatsCounts,
} from "../../dashboard/src/api/modules/memoryDashboard";

declare global {
  interface Window {
    zhijunDesktop?: {
      connection: () => Promise<{ url: string; version: string }>;
    };
  }
}
export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="notice" role="alert">
      {children}
    </p>
  );
}
export function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    const wide = window.matchMedia("(min-width: 1250px)");
    const open = () => {
      node?.close();
      if (wide.matches) node?.show();
      else node?.showModal();
    };
    open();
    wide.addEventListener("change", open);
    return () => {
      wide.removeEventListener("change", open);
      node?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="drawer-head">
        <h2>{title}</h2>
        <button aria-label="关闭抽屉" onClick={onClose}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div className="drawer-body">{children}</div>
    </dialog>
  );
}

export default function App() {
  useEffect(() => {
    applyReadingSize(readReadingSize());
  }, []);
  const [user, setUser] = useState<OctopUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    clearLegacyBindings(localStorage);
    const expired = (event: Event) => {
      event.preventDefault();
      clearClientLogin();
      setUser(null);
      window.location.replace("/login");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, expired);
    if (getAuthToken())
      void profileApi
        .me()
        .then(
          (u) => {
            if (!alive) return;
            if (u.application_id !== "zhijun") {
              clearClientLogin();
              setUser(null);
              setError("请重新登录知君。旧版万象会话不会用于知君的个人档案。");
              return;
            }
            setUser(u);
          },
          (e) => {
            if (alive) {
              if (String(e.message).includes("401")) clearClientLogin();
              setError(apiErrorMessage(e, "暂时无法连接本机万象。"));
            }
          },
        )
        .finally(() => {
          if (alive) setLoading(false);
        });
    else {
      clearClientLogin();
      setLoading(false);
    }
    return () => {
      alive = false;
      window.removeEventListener(UNAUTHORIZED_EVENT, expired);
    };
  }, [retry]);
  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      // Always discard this client's login, including when WANX is unavailable.
    } finally {
      clearClientLogin();
      setUser(null);
      window.location.replace("/login");
    }
  };
  if (loading)
    return (
      <main className="gate">
        <div className="seal">知</div>
        <p>正在连接本机万象…</p>
      </main>
    );
  if (!user)
    if (getAuthToken() && error)
      return (
        <main className="gate">
          <section className="welcome">
            <div className="seal">知</div>
            <h1>连接暂时未恢复</h1>
            <Notice>{error}</Notice>
            <button
              onClick={() => {
                setLoading(true);
                setError("");
                setRetry((n) => n + 1);
              }}
            >
              重新连接本机 WANX
            </button>
          </section>
        </main>
      );
  if (!user)
    return (
      <Login
        error={error}
        onLogin={(u) => {
          setError("");
          setUser(u);
        }}
      />
    );
  return <Account key={user.id} user={user} logout={() => void logout()} />;
}

function clearClientCaches() {
  for (const storage of [localStorage, sessionStorage]) {
    clearConversationCaches(storage);
    clearLegacyBindings(storage);
  }
}

function clearClientLogin() {
  clearAuthToken();
  clearClientCaches();
}

function Login({
  onLogin,
  error: initialError,
}: {
  onLogin: (u: OctopUser) => void;
  error: string;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [captcha, setCaptcha] = useState<PublicCaptcha | null>(null);
  const [ready, setReady] = useState(false);
  const [reset, setReset] = useState(0);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(false);
  const field = useRef<CaptchaFieldHandle>(null);
  const load = () => {
    setError("");
    void authApi.getCaptcha().then(setCaptcha, (e) => setError(e.message));
  };
  useEffect(load, []);
  const switchMode = (next: "login" | "register") => {
    setMode(next);
    setPassword("");
    setConfirmPassword("");
    setError("");
    setReady(false);
    setReset((n) => n + 1);
  };
  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (mode === "register") {
      if (password !== confirmPassword) {
        setError("两次密码不一致，请重新确认。");
        return;
      }
      const issue = passwordPolicyIssue(password);
      if (issue) {
        setError(
          issue === "too_short"
            ? `密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符。`
            : issue === "need_letter_and_digit"
            ? "密码需要同时包含字母和数字。"
            : "请避免使用常见密码，换一个更难猜的密码。",
        );
        return;
      }
    }
    setBusy(true);
    setError("");
    let submitted = false;
    try {
      const token = await field.current?.getToken();
      submitted = mode === "register";
      const result =
        mode === "register"
          ? await profileApi.register(name.trim(), password, token)
          : await profileApi.login(name.trim(), password, token);
      if (result.user.application_id !== "zhijun")
        throw new Error("服务尚未支持知君独立登录，请更新本机万象后重试。");
      clearClientCaches();
      setAuthToken(result.access_token, remember);
      setPassword("");
      setConfirmPassword("");
      onLogin(result.user);
    } catch (e) {
      const message = apiErrorMessage(e, "请求未完成，请重试。");
      const status =
        e instanceof Error
          ? Number(/^Request failed: (\d{3})\b/.exec(e.message)?.[1])
          : 0;
      const rejected =
        (status >= 400 && status < 500) ||
        [
          "USERNAME_TAKEN",
          "PASSWORD_TOO_WEAK",
          "CAPTCHA_REQUIRED",
          "CAPTCHA_FAILED",
          "REGISTRATION_RATE_LIMITED",
        ].includes(parseApiError(e)?.code || "");
      setError(
        submitted && !rejected
          ? `注册结果尚未确认：${message}。若提交后连接中断，账号可能已经创建，可返回登录尝试恢复。`
          : message,
      );
      setReset((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="gate">
      <form className="welcome login" onSubmit={(event) => void login(event)}>
        <div className="seal">知</div>
        <p className="eyebrow">知君 · 个人记忆</p>
        <h1>记得你，听你说。</h1>
        <div className="auth-modes" role="group" aria-label="账号入口">
          <button
            type="button"
            aria-pressed={mode === "login"}
            disabled={busy}
            onClick={() => switchMode("login")}
          >
            登录
          </button>
          <button
            type="button"
            aria-pressed={mode === "register"}
            disabled={busy}
            onClick={() => switchMode("register")}
          >
            注册
          </button>
        </div>
        <p className="muted">
          {mode === "register"
            ? "注册一个知君与万象通用的账号，无需邀请码。"
            : "用已有万象账号登录知君。"}
          <br />
          {mode === "register"
            ? "两款应用的记忆彼此独立。注册后，由你另行创建空白知君档案。"
            : "在这里，建立属于你的独立记忆档案。"}
        </p>
        <label>
          账号
          <input
            required
            disabled={busy}
            maxLength={mode === "register" ? 64 : undefined}
            autoComplete="username"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          密码
          <input
            type="password"
            required
            disabled={busy}
            maxLength={mode === "register" ? 200 : undefined}
            autoComplete={
              mode === "register" ? "new-password" : "current-password"
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {mode === "register" && (
          <>
            <p className="muted fine">
              至少 {MIN_PASSWORD_LENGTH} 个字符，包含字母和数字，避免常见密码。
            </p>
            <label>
              确认密码
              <input
                type="password"
                required
                disabled={busy}
                maxLength={200}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </label>
          </>
        )}
        {captcha ? (
          <CaptchaField
            key={mode}
            ref={field}
            config={captcha}
            resetKey={reset}
            slideHint="滑动完成验证"
            slideVerifiedLabel="已验证"
            unsupportedLabel="请在 WANX 配置受支持的登录验证"
            onReadyChange={setReady}
          />
        ) : (
          <button type="button" onClick={load}>
            重新连接
          </button>
        )}
        <label className="check">
          <input
            type="checkbox"
            disabled={busy}
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          在此客户端保留登录
        </label>
        {error && (
          <Notice>
            {error}
            {mode === "register" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => switchMode("login")}
              >
                返回登录
              </button>
            )}
          </Notice>
        )}
        <button
          className="primary"
          disabled={
            !name.trim() ||
            !password ||
            (mode === "register" && !confirmPassword) ||
            !ready ||
            busy
          }
        >
          {busy
            ? mode === "register"
              ? "正在注册…"
              : "正在连接…"
            : mode === "register"
            ? "注册并进入知君"
            : "连接知君"}
        </button>
        <footer>独立桌面端 · 账号通用，档案独立</footer>
      </form>
    </main>
  );
}

function Account({ user, logout }: { user: OctopUser; logout: () => void }) {
  const [profile, setProfile] = useState<ZhijunProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await profileApi.get();
      if (result.profile && !validProfile(result.profile, user.id))
        throw new Error("服务返回的档案不属于当前知君账号。");
      if (alive.current) setProfile(result.profile);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [user.id]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  const create = async () => {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const result = await profileApi.create();
      if (!validProfile(result.profile, user.id))
        throw new Error("档案归属未核实，请重新读取。");
      if (alive.current) setProfile(result.profile);
    } catch (e) {
      // A timed-out create can still have committed. Read truth before offering another attempt.
      try {
        const result = await profileApi.get();
        if (result.profile && !validProfile(result.profile, user.id))
          throw new Error("档案归属未核实。");
        if (alive.current) setProfile(result.profile);
      } catch {
        /* Keep the uncertainty visible; the POST is idempotent. */
      }
      if (alive.current)
        setError(
          `结果尚未核实：${(e as Error).message}。重新读取可恢复同一份档案。`,
        );
    } finally {
      if (alive.current) setCreating(false);
    }
  };
  useEffect(() => {
    setActiveAgentId(profile?.agent_id ?? null);
    return () => setActiveAgentId(null);
  }, [profile?.agent_id]);
  useEffect(() => {
    const forbidden = () => {
      setProfile(null);
      setError("当前档案的访问权限已失效。请重新读取，不会连接其他档案。");
    };
    window.addEventListener(FORBIDDEN_EVENT, forbidden);
    return () => window.removeEventListener(FORBIDDEN_EVENT, forbidden);
  }, []);
  useEffect(() => {
    if (!profile || !["starting", "loading"].includes(profile.state)) return;
    const timer = window.setTimeout(() => void refresh(), 3000);
    return () => clearTimeout(timer);
  }, [profile, refresh]);
  if (loading || error || !profile || profile.state !== "running")
    return (
      <main className="gate">
        <section className="welcome">
          <div className="seal">知</div>
          <p className="eyebrow">一份属于自己的记忆</p>
          <h1>{profile ? "你的知君，正在这里" : "从一张白纸开始"}</h1>
          <p className="muted">
            {profile
              ? "已有个人档案会继续保留。重新连接不会另建档案。"
              : "每个账号在知君拥有一份个人主档案。它从空白开始，随着我们的交谈慢慢积累。"}
            <br />
            知君与万象的对话、记忆和资料彼此独立。
          </p>
          {loading ? (
            <p>正在读取个人档案…</p>
          ) : (
            <>
              {profile && (
                <p className="muted">
                  档案状态：{profile.state}
                  {profile.last_error ? ` · ${profile.last_error}` : ""}
                </p>
              )}
              {error && <Notice>{error}</Notice>}
              <div className="actions">
                <button
                  className="primary"
                  disabled={
                    creating ||
                    !!error ||
                    (!!profile &&
                      ["starting", "loading"].includes(profile.state))
                  }
                  onClick={() => void create()}
                >
                  {creating
                    ? "正在准备…"
                    : profile
                    ? "恢复这份档案"
                    : "创建我的知君档案"}
                </button>
                <button disabled={creating} onClick={() => void refresh()}>
                  重新读取
                </button>
                <button disabled={creating} onClick={logout}>
                  切换账号
                </button>
              </div>
            </>
          )}
        </section>
      </main>
    );
  return (
    <Experience
      key={`${user.id}:${profile.agent_id}`}
      agent={profile}
      user={user}
      logout={logout}
    />
  );
}

function Experience({
  agent,
  user,
  logout,
}: {
  agent: ZhijunProfile;
  user: OctopUser;
  logout: () => void;
}) {
  const [panel, setPanel] = useState("");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [source, setSource] = useState<MemoryReference | null>(null);
  const [refs, setRefs] = useState<MemoryReference[]>([]);
  const [prefill, setPrefill] = useState<{
    text: string;
    key: number;
    knowledge?: { id: string; name: string };
  } | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [thread, setThread] = useState<string | null>(null);
  const [selectedThread, selectThread] = useState<{
    id: string | null;
    key: number;
  } | null>(null);
  const [stats, setStats] = useState<StatsCounts | null>(null);
  const maintenance = useMemoryMaintenance(agent.agent_id, true);
  const connectionWasLost = useRef(false);
  useEffect(() => {
    if (connectionWasLost.current && !maintenance.connectionLost)
      window.dispatchEvent(new Event("zhijun-service-restored"));
    connectionWasLost.current = maintenance.connectionLost;
  }, [maintenance.connectionLost]);
  useEffect(() => {
    let alive = true;
    const pull = () =>
      void memoryDashboardApi.statsCounts(agent.agent_id).then(
        (value) => {
          if (alive) setStats(value);
        },
        () => {
          if (alive) setStats(null);
        },
      );
    pull();
    const timer = window.setInterval(pull, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [agent.agent_id]);
  useEffect(() => {
    const open = () => {
      setPanel("");
      setAboutOpen(false);
    };
    window.addEventListener("zhijun-open-core-queue", open);
    return () => window.removeEventListener("zhijun-open-core-queue", open);
  }, []);
  const showSource = (ref: MemoryReference) => {
    setSource(ref);
    setPanel("sources");
  };
  const discuss = (text: string, knowledge?: { id: string; name: string }) => {
    setPrefill({ text, key: Date.now(), knowledge });
    setPanel("");
  };
  const blocked =
    maintenance.blocking ||
    maintenance.connectionLost ||
    agent.state !== "running";
  return (
    <div className="shell">
      <header className="presence">
        <button
          className="brand-seal"
          type="button"
          aria-label="关于知君"
          aria-haspopup="dialog"
          title="关于知君"
          onClick={() => setAboutOpen(true)}
        >
          知
        </button>
        <span>
          {maintenance.connectionLost
            ? "连接中断"
            : maintenance.visible
            ? "正在整理"
            : streaming
            ? "正在想…"
            : "听你说，陪你想。"}
        </span>
        <ExperienceNavigation
          active={panel}
          onSelect={(key) => {
            setSource(null);
            setPanel(panel === key ? "" : key);
          }}
        />
      </header>
      {aboutOpen && <AboutZhijun onClose={() => setAboutOpen(false)} />}
      {maintenance.connectionLost && (
        <Notice>
          本机服务暂时未连接，已暂停发送。恢复后先核对历史与任务状态。
        </Notice>
      )}
      {maintenance.visible && (
        <p className="status-line">
          原生记忆整理：{maintenance.status?.phase} {maintenance.status?.detail}
        </p>
      )}
      {stats?.last_extract_run?.failure_reason && (
        <Notice>上次提炼未完成：{stats.last_extract_run.failure_reason}</Notice>
      )}
      {agent.state !== "running" && (
        <Notice>个人档案当前为 {agent.state}，请重新读取档案状态。</Notice>
      )}
      <Conversation
        agentId={agent.agent_id}
        scope={`${user.id}:${agent.agent_id}`}
        blocked={blocked}
        auxiliaryOpen={!!panel || aboutOpen}
        prefill={prefill}
        selectedThread={selectedThread}
        onThread={setThread}
        onStreaming={setStreaming}
        onReferences={setRefs}
        onSource={showSource}
        onAttachment={(attachment) => {
          const path = attachmentPath(attachment);
          showSource({
            layer: "attachment",
            id: path || "unavailable",
            path: path || "unavailable",
            filename: attachment.filename,
          });
        }}
      />
      {panel && (
        <Drawer
          title={
            {
              memory: "记忆",
              conversations: "对话",
              sources: "这次理解的依据",
              preferences: "设置",
              library: "知识库",
              discovery: "发现",
            }[panel]!
          }
          onClose={() => setPanel("")}
        >
          {panel === "memory" && (
            <MemoryPanel
              agentId={agent.agent_id}
              onSource={showSource}
              onDiscuss={discuss}
            />
          )}{" "}
          {panel === "conversations" && (
            <ConversationsPanel
              agentId={agent.agent_id}
              current={thread}
              onSelect={(id) => {
                selectThread({ id, key: Date.now() });
                setPanel("");
              }}
              onNew={() => {
                selectThread({ id: null, key: Date.now() });
                setPanel("");
              }}
              disabled={streaming || blocked}
            />
          )}{" "}
          {panel === "sources" && (
            <Sources
              agentId={agent.agent_id}
              reference={source}
              references={refs}
              onSelect={setSource}
              onDiscuss={discuss}
            />
          )}{" "}
          {panel === "preferences" && (
            <Preferences agent={agent} user={user} logout={logout} />
          )}
          {panel === "discovery" && (
            <DigitalSelf key={user.id} userId={user.id} />
          )}
          {panel === "library" && (
            <KnowledgeLibrary
              userId={user.id}
              agentId={agent.agent_id}
              onDiscuss={discuss}
              onBack={() => setPanel("")}
              onSource={showSource}
            />
          )}
        </Drawer>
      )}
    </div>
  );
}
