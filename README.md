# 知君 · WANX 个人 AI 伴侣

听你说，陪你想。

知君是独立 Electron 桌面应用，共用 WANX 账号和本机运行引擎。每个账号在知君拥有独立个人档案，由本人创建，从对话、经历和主动选择的资料中逐步积累记忆。

本仓库包含知君 **0.6.1** 客户端及其当前依赖的 WANX 服务端和共享前端源码，整理日期为 2026-10-02。账户、对话、个人记忆、模型密钥、本机配置、验收截图和安装包不在仓库中。

## 当前能力

- **对话**：主题会话、附件、流式文字、语音输入和可编辑的回应建议。
- **记忆**：用户画像中的个人本体与记忆资料，以及记忆树、情绪日记和记忆沉淀。
- **核心本体**：候选核对、本人确认、雷达展示、重要程度调整、修订和停止使用。候选支持去重及最新内容优先展示。
- **知识库与回响**：复用 WANX 的本地资料处理能力；选择阅读范围后形成带来源的线索，邀请本人讨论和核对。
- **微信**：在设置中连接本人微信，与桌面使用同一知君档案。

知君与 WANX 的业务资料由服务端按应用域隔离；共用本机服务不等于操作系统层面的隔离。数字分身和发现相关代码仍属实验方向，当前界面隐藏发现入口。

## 源码结构

| 目录 | 内容 |
| --- | --- |
| `zhijun-desktop/` | 知君界面、Electron 壳、语音输入、客户端测试 |
| `src/octop/` | WANX/Octop 服务端、知君档案、记忆、本体及知识理解 |
| `dashboard/` | 共享 API、组件和服务端管理界面 |
| `tests/` | 服务端单元测试及集成测试 |
| `desktop/portable/` | 共用运行服务的打包脚本 |
| `docs/` | 基础架构和开发说明 |

为保留当前依赖关系，仓库同时保留共用平台模块；不包含其他独立桌面产品的源码目录。本次以独立源码快照建立仓库，未复制开发机的 Git 历史或上游自动发布工作流。

## 开发前提

需要 Python 3.12+、[uv](https://docs.astral.sh/uv/)、Node.js 22+ 和 npm。macOS 桌面交付脚本面向 Apple Silicon。

**前端还需要另行取得授权的 WANX SDK 安装包。** `dashboard/package.json` 引用 `dashboard/vendor/centaurai-wanx-0.1.0-alpha.3.tgz`，该私有 SDK 不随公开源码发布。先将合法取得的文件放到这一位置，再安装前端依赖；校验值与边界见 [SDK 依赖说明](dashboard/vendor/README.md)。缺少它时，`npm ci` 和完整前端构建无法完成。

### 安装和检查

```sh
uv sync --frozen
make install-hooks

# 先放置上述 SDK 安装包
cd dashboard
npm ci
cd ../zhijun-desktop
npm install
cd ..

make all PYTEST_JOBS=8
make build-frontend
cd zhijun-desktop
npm test
npm run build
```

服务端的本地提交钩子会执行格式化、静态检查、受影响测试和 dashboard 构建。完整检查以 `make all` 为准；客户端测试和构建另行执行。

### 启动

在仓库根目录启动本机服务：

```sh
uv run octop run
```

完成 WANX 首次设置与模型配置后，在另一个终端启动知君：

```sh
cd zhijun-desktop
npm start
```

知君默认连接 `http://127.0.0.1:8088`，应用页面默认端口为 `28631`。首次登录后由本人创建独立档案，不自动迁入 WANX Agent 的记忆。

- `ZHIJUN_WANX_URL`：其他本机 WANX HTTP 地址，仅接受 loopback。
- `ZHIJUN_UI_PORT`：客户端本地页面端口。
- `ZHIJUN_USER_DATA`：隔离测试所用的 Electron 用户数据目录。

模型密钥在本机服务设置中配置，不应写进源码或提交到仓库。`.env.example` 仅为基础环境变量示例。

## macOS 打包

```sh
cd zhijun-desktop
npm run build
npm run package:mac
```

默认使用 npm 安装的官方 Electron 37.10.3；也可以通过 `ZHIJUN_ELECTRON_DIST=/path/to/electron/dist` 指定包含 `Electron.app` 的运行时目录。输出为 `zhijun-desktop/release/知君.app`，采用本机 ad-hoc 签名，未公证。已有同名应用时脚本会停止，须先保留或移走上一版。

自动化测试不替代真实微信、跨设备连接或用户对话体验验收。功能说明和早期交付边界见 [知君档案设计](docs/zhijun-agent-v1.md)；基础框架资料见 [Octop 参考说明](README.upstream.md)。

## 版权与许可

仓库公开可见不表示对全部产品代码重新授权。WANX 产品扩展、SDK 及生成应用沿用现有公司私有产品许可，不因本次公开改为 MIT。基础框架与第三方组件保留原有版权、许可和通知，见 [基础框架许可证](LICENSE) 及各组件内的第三方声明。私有 SDK 二进制不在本仓库中。
