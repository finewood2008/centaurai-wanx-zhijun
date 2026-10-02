import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { profileApi } from "./profile";

const auth = vi.hoisted(() => ({
  token: "scoped-fixture",
  clear: vi.fn(),
  logout: vi.fn(),
  redirect: vi.fn(),
  unmounted: vi.fn(),
  captchaReady: true,
  connectionLost: false,
}));
vi.mock("../../dashboard/src/api/request", () => ({
  request: vi.fn(),
  getAuthToken: () => auth.token,
  setAuthToken: (token: string) => {
    auth.token = token;
  },
  clearAuthToken: () => {
    auth.token = "";
    auth.clear();
  },
  setActiveAgentId: vi.fn(),
  UNAUTHORIZED_EVENT: "expired",
  FORBIDDEN_EVENT: "forbidden",
}));
vi.mock("../../dashboard/src/api/modules/auth", () => ({
  authApi: {
    getCaptcha: async () => ({ provider: "none" }),
    logout: auth.logout,
  },
}));
vi.mock("../../dashboard/src/pages/Login/CaptchaField", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef<
      { getToken: () => Promise<string> },
      { onReadyChange: (value: boolean) => void; resetKey: number }
    >((props, ref) => {
      React.useEffect(
        () => props.onReadyChange(auth.captchaReady),
        [props.resetKey],
      );
      React.useImperativeHandle(ref, () => ({
        getToken: async () => "captcha-fixture",
      }));
      return (
        <button
          type="button"
          data-testid="captcha-fixture"
          data-reset-key={props.resetKey}
          onClick={() => props.onReadyChange(true)}
        >
          模拟完成验证
        </button>
      );
    }),
  };
});
vi.mock("../../dashboard/src/pages/Chat/hooks/useMemoryMaintenance", () => ({
  useMemoryMaintenance: () => ({
    blocking: false,
    connectionLost: auth.connectionLost,
    visible: false,
  }),
}));
vi.mock("../../dashboard/src/api/modules/memoryDashboard", () => ({
  memoryDashboardApi: { statsCounts: async () => ({}) },
}));
vi.mock("./Conversation", async () => {
  const React = await import("react");
  return {
    Conversation: ({ agentId }: { agentId: string }) => {
      React.useEffect(() => () => auth.unmounted(agentId), [agentId]);
      return <main>个人对话：{agentId}</main>;
    },
  };
});
vi.mock("./Panels", () => ({
  MemoryPanel: () => <p>合成记忆面板</p>,
  ConversationsPanel: () => <p>合成主题对话</p>,
  Sources: () => null,
  Preferences: () => null,
}));
vi.mock("./KnowledgeLibrary", () => ({
  KnowledgeLibrary: () => <p>合成知识库</p>,
}));
const user = {
  id: 1,
  application_id: "zhijun",
  username: "synthetic",
} as never;
const profile = {
  agent_id: "personal",
  application_id: "zhijun",
  user_id: 1,
  state: "running",
} as never;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Object.assign(HTMLDialogElement.prototype, {
    show() {
      this.setAttribute("open", "");
    },
    close() {
      this.removeAttribute("open");
    },
  });
  auth.token = "scoped-fixture";
  auth.clear.mockClear();
  auth.logout.mockReset().mockResolvedValue(undefined);
  auth.redirect.mockClear();
  auth.unmounted.mockClear();
  auth.captchaReady = true;
  auth.connectionLost = false;
  sessionStorage.clear();
  vi.stubGlobal(
    "window",
    new Proxy(window, {
      get(target, key) {
        if (key === "location") return { replace: auth.redirect };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
  );
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  });
  vi.spyOn(profileApi, "me").mockResolvedValue(user);
  vi.spyOn(profileApi, "get").mockResolvedValue({ profile: null });
  vi.spyOn(profileApi, "create").mockResolvedValue({ profile });
  vi.spyOn(profileApi, "login").mockResolvedValue({
    access_token: "login-scoped-token",
    user,
  });
  vi.spyOn(profileApi, "register").mockResolvedValue({
    access_token: "registered-scoped-token",
    user,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("restores the reading size when reopening the application without replacing the conversation", async () => {
  localStorage.setItem("zhijun:reading-size", "21");
  vi.mocked(profileApi.get).mockResolvedValue({ profile });
  render(<App />);
  await screen.findByText("个人对话：personal");
  expect(
    document.documentElement.style.getPropertyValue("--reading-size"),
  ).toBe("21px");
  expect(auth.unmounted).not.toHaveBeenCalled();
  expect(profileApi.create).not.toHaveBeenCalled();
});
it("starts with an empty personal profile only after the owner's create action", async () => {
  render(<App />);
  const button = await screen.findByRole("button", {
    name: "创建我的知君档案",
  });
  expect(profileApi.create).not.toHaveBeenCalled();
  fireEvent.click(button);
  await screen.findByText("个人对话：personal");
  expect(profileApi.create).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("button", { name: "记忆", exact: true }),
  ).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
});
it("announces recovery once without replacing the profile or clearing login", async () => {
  vi.mocked(profileApi.get).mockResolvedValue({ profile });
  const restored = vi.fn();
  window.addEventListener("zhijun-service-restored", restored);
  try {
    const { rerender } = render(<App />);
    await screen.findByText("个人对话：personal");
    expect(restored).not.toHaveBeenCalled();
    auth.connectionLost = true;
    rerender(<App />);
    expect(screen.getByText("连接中断")).toBeTruthy();
    auth.connectionLost = false;
    rerender(<App />);
    expect(restored).toHaveBeenCalledOnce();
    rerender(<App />);
    expect(restored).toHaveBeenCalledOnce();
    expect(auth.clear).not.toHaveBeenCalled();
    expect(profileApi.create).not.toHaveBeenCalled();
    expect(auth.unmounted).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("zhijun-service-restored", restored);
  }
});
it("makes topic conversations, memory and the knowledge library directly accessible from the top navigation", async () => {
  vi.spyOn(profileApi, "get").mockResolvedValue({ profile });
  render(<App />);
  await screen.findByText("个人对话：personal");
  expect(
    screen.queryByRole("button", { name: "历史", exact: true }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "对话", exact: true }));
  expect(screen.getByText("合成主题对话")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "记忆", exact: true }));
  expect(screen.getByText("合成记忆面板")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "知识库", exact: true }));
  expect(screen.getByText("合成知识库")).toBeTruthy();
  expect(screen.getByText("个人对话：personal")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "知识库", exact: true }));
  expect(screen.queryByText("合成知识库")).toBeNull();
  expect(
    screen.getByRole("button", { name: "设置", exact: true }),
  ).toBeTruthy();
});
it("clears an old WANX login and binding before any profile request", async () => {
  localStorage.setItem("zhijun:wanx:agent:1", "old-agent");
  localStorage.setItem("zhijun:draft:1:old-agent:existing", "旧版私人草稿");
  vi.spyOn(profileApi, "me").mockResolvedValue({
    ...(user as object),
    application_id: "wanx",
  } as never);
  render(<App />);
  await screen.findByText(/旧版万象会话不会用于知君/);
  expect(auth.clear).toHaveBeenCalledOnce();
  expect(localStorage.getItem("zhijun:wanx:agent:1")).toBeNull();
  expect(localStorage.getItem("zhijun:draft:1:old-agent:existing")).toBeNull();
  expect(profileApi.get).not.toHaveBeenCalled();
  expect(profileApi.create).not.toHaveBeenCalled();
});
it("keeps a failed model startup visible and recovers the same profile", async () => {
  vi.spyOn(profileApi, "get").mockResolvedValue({
    profile: {
      ...(profile as object),
      state: "failed",
      last_error: "模型未配置",
    } as never,
  });
  render(<App />);
  await screen.findByText(/模型未配置/);
  expect(screen.queryByText("个人对话：personal")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "恢复这份档案" }));
  await screen.findByText("个人对话：personal");
  expect(profileApi.create).toHaveBeenCalledOnce();
});
it("reads back a timed-out create and requires truth recovery before showing success", async () => {
  vi.spyOn(profileApi, "get")
    .mockResolvedValueOnce({ profile: null })
    .mockResolvedValue({ profile });
  vi.spyOn(profileApi, "create").mockRejectedValue(new Error("timeout"));
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "创建我的知君档案" }),
  );
  await screen.findByText(/结果尚未核实/);
  expect(screen.queryByText("个人对话：personal")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
  await screen.findByText("个人对话：personal");
  await waitFor(() => expect(profileApi.create).toHaveBeenCalledOnce());
});

it("clears all login-owned conversation caches when switching accounts, even if logout fails", async () => {
  localStorage.setItem("zhijun:thread:1:personal", "private-thread");
  localStorage.setItem("zhijun:draft:1:personal:private-thread", "私人草稿");
  localStorage.setItem("zhijun:draft:2:other:new", "另一账号的旧草稿");
  sessionStorage.setItem("zhijun:draft:1:personal:new", "临时草稿");
  localStorage.setItem("unrelated", "keep");
  auth.logout.mockRejectedValue(new Error("WANX unavailable"));
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "切换账号" }));
  await screen.findByRole("button", { name: "连接知君" });
  expect(auth.token).toBe("");
  expect(localStorage.getItem("zhijun:thread:1:personal")).toBeNull();
  expect(
    localStorage.getItem("zhijun:draft:1:personal:private-thread"),
  ).toBeNull();
  expect(localStorage.getItem("zhijun:draft:2:other:new")).toBeNull();
  expect(sessionStorage.getItem("zhijun:draft:1:personal:new")).toBeNull();
  expect(localStorage.getItem("unrelated")).toBe("keep");
  expect(auth.redirect).toHaveBeenCalledWith("/login");
});

it("drops the previous account's UI and conversation cache when the login expires", async () => {
  vi.spyOn(profileApi, "get").mockResolvedValue({ profile });
  render(<App />);
  await screen.findByText("个人对话：personal");
  localStorage.setItem("zhijun:thread:1:personal", "private-thread");
  localStorage.setItem("zhijun:draft:1:personal:private-thread", "私人草稿");
  fireEvent(window, new Event("expired", { cancelable: true }));
  await screen.findByRole("button", { name: "连接知君" });
  expect(screen.queryByText("个人对话：personal")).toBeNull();
  expect(auth.unmounted).toHaveBeenCalledWith("personal");
  expect(auth.token).toBe("");
  expect(localStorage.getItem("zhijun:thread:1:personal")).toBeNull();
  expect(
    localStorage.getItem("zhijun:draft:1:personal:private-thread"),
  ).toBeNull();
});

it("clears stale caches before entering a newly authenticated account", async () => {
  auth.token = "";
  const nextUser = { ...(user as object), id: 2 } as never;
  vi.spyOn(profileApi, "login").mockResolvedValue({
    access_token: "new-scoped-token",
    user: nextUser,
  });
  vi.spyOn(profileApi, "get").mockResolvedValue({
    profile: {
      ...(profile as object),
      agent_id: "second",
      user_id: 2,
    } as never,
  });
  render(<App />);
  const button = await screen.findByRole("button", { name: "连接知君" });
  localStorage.setItem("zhijun:draft:1:personal:new", "之前账号的草稿");
  sessionStorage.setItem("zhijun:thread:1:personal", "previous-thread");
  fireEvent.change(screen.getByLabelText("账号"), {
    target: { value: "second" },
  });
  fireEvent.change(screen.getByLabelText("密码"), {
    target: { value: "fixture" },
  });
  fireEvent.click(button);
  await screen.findByText("个人对话：second");
  expect(auth.token).toBe("new-scoped-token");
  expect(localStorage.getItem("zhijun:draft:1:personal:new")).toBeNull();
  expect(sessionStorage.getItem("zhijun:thread:1:personal")).toBeNull();
});

it("preserves the current login's unsent draft across an ordinary restart", async () => {
  localStorage.setItem("zhijun:thread:1:personal", "existing");
  localStorage.setItem("zhijun:draft:1:personal:existing", "尚未发送的草稿");
  vi.spyOn(profileApi, "get").mockResolvedValue({ profile });
  render(<App />);
  await screen.findByText("个人对话：personal");
  expect(localStorage.getItem("zhijun:thread:1:personal")).toBe("existing");
  expect(localStorage.getItem("zhijun:draft:1:personal:existing")).toBe(
    "尚未发送的草稿",
  );
});

async function openRegistration(
  password = "PrivatePass27",
  confirm = password,
) {
  auth.token = "";
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "注册", exact: true }),
  );
  fireEvent.change(screen.getByLabelText("账号"), {
    target: { value: "  new-owner  " },
  });
  fireEvent.change(screen.getByLabelText("密码"), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText("确认密码"), {
    target: { value: confirm },
  });
  return screen.getByRole("button", { name: "注册并进入知君" });
}

it("registers a shared account and waits for the owner's separate empty-profile create action", async () => {
  const button = await openRegistration();
  expect(screen.getByText(/知君与万象通用的账号，无需邀请码/)).toBeTruthy();
  expect(screen.getByText(/两款应用的记忆彼此独立/)).toBeTruthy();
  fireEvent.click(button);
  await screen.findByRole("button", { name: "创建我的知君档案" });
  expect(profileApi.register).toHaveBeenCalledWith(
    "new-owner",
    "PrivatePass27",
    "captcha-fixture",
  );
  expect(profileApi.login).not.toHaveBeenCalled();
  expect(auth.token).toBe("registered-scoped-token");
  expect(profileApi.get).toHaveBeenCalledOnce();
  expect(profileApi.create).not.toHaveBeenCalled();
});

it.each([
  ["PrivatePass27", "different", /两次密码不一致/],
  ["Ab12", "Ab12", /密码至少需要 8 个字符/],
  ["OnlyLetters", "OnlyLetters", /同时包含字母和数字/],
  ["password123", "password123", /避免使用常见密码/],
])(
  "rejects registration validation before any account request (%s)",
  async (password, confirm, message) => {
    fireEvent.click(await openRegistration(password, confirm));
    await screen.findByText(message);
    expect(profileApi.register).not.toHaveBeenCalled();
    expect(auth.token).toBe("");
    expect(profileApi.get).not.toHaveBeenCalled();
    expect(profileApi.create).not.toHaveBeenCalled();
  },
);

it.each(["timeout", "Request failed: 500 Internal Server Error"])(
  "keeps a failed registration truthful and offers scoped login recovery (%s)",
  async (failure) => {
    vi.mocked(profileApi.register).mockRejectedValue(new Error(failure));
    fireEvent.click(await openRegistration());
    await screen.findByText(new RegExp(`注册结果尚未确认：${failure}`));
    expect(auth.token).toBe("");
    expect(profileApi.get).not.toHaveBeenCalled();
    expect(profileApi.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "返回登录" }));
    expect(screen.queryByText(/注册结果尚未确认/)).toBeNull();
    expect(screen.queryByLabelText("确认密码")).toBeNull();
    expect((screen.getByLabelText("密码") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("账号") as HTMLInputElement).value).toBe(
      "  new-owner  ",
    );
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "PrivatePass27" },
    });
    fireEvent.click(screen.getByRole("button", { name: "连接知君" }));
    await screen.findByRole("button", { name: "创建我的知君档案" });
    expect(auth.token).toBe("login-scoped-token");
    expect(profileApi.register).toHaveBeenCalledOnce();
    expect(profileApi.create).not.toHaveBeenCalled();
  },
);

it.each([
  [409, "USERNAME_TAKEN", "这个账号已存在，请直接登录。"],
  [400, "CAPTCHA_FAILED", "验证未通过，请重新完成验证。"],
  [429, "REGISTRATION_RATE_LIMITED", "注册尝试过多，请稍后再试。"],
])(
  "shows a definite registration rejection without an uncertain-success message (%s)",
  async (status, code, message) => {
    vi.mocked(profileApi.register).mockRejectedValue(
      new Error(
        `Request failed: ${status} - ${JSON.stringify({
          error: { code, message },
        })}`,
      ),
    );
    fireEvent.click(await openRegistration());
    await screen.findByText(message);
    expect(screen.queryByText(/注册结果尚未确认/)).toBeNull();
    expect(screen.queryByText(/账号可能已经创建/)).toBeNull();
    expect(auth.token).toBe("");
    expect(profileApi.get).not.toHaveBeenCalled();
    expect(profileApi.create).not.toHaveBeenCalled();
  },
);

it("does not accept a registration token from another application scope", async () => {
  vi.mocked(profileApi.register).mockResolvedValue({
    access_token: "wanx-token",
    user: { ...(user as object), application_id: "wanx" } as never,
  });
  fireEvent.click(await openRegistration());
  await screen.findByText(/服务尚未支持知君独立登录/);
  expect(auth.token).toBe("");
  expect(profileApi.get).not.toHaveBeenCalled();
  expect(profileApi.create).not.toHaveBeenCalled();
});

it("clears passwords and resets verification when changing between login and registration", async () => {
  await openRegistration("PrivatePass27", "different");
  fireEvent.click(screen.getByRole("button", { name: "注册并进入知君" }));
  await screen.findByText(/两次密码不一致/);
  const before = screen
    .getByTestId("captcha-fixture")
    .getAttribute("data-reset-key");
  auth.captchaReady = false;
  fireEvent.click(screen.getByRole("button", { name: "登录", exact: true }));
  expect(screen.queryByText(/两次密码不一致/)).toBeNull();
  expect((screen.getByLabelText("密码") as HTMLInputElement).value).toBe("");
  expect(
    screen.getByTestId("captcha-fixture").getAttribute("data-reset-key"),
  ).not.toBe(before);
  fireEvent.click(screen.getByRole("button", { name: "注册", exact: true }));
  expect((screen.getByLabelText("确认密码") as HTMLInputElement).value).toBe(
    "",
  );
  fireEvent.change(screen.getByLabelText("密码"), {
    target: { value: "PrivatePass27" },
  });
  fireEvent.change(screen.getByLabelText("确认密码"), {
    target: { value: "PrivatePass27" },
  });
  const button = screen.getByRole("button", {
    name: "注册并进入知君",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "模拟完成验证" }));
  expect(button.disabled).toBe(false);
});
