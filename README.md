# 知君 · newzhijun

知己与导师，Context of Me。纸白、深墨与朱红的独立客户端，智能能力由 WANX 提供。

同一位用户可以创建个人、工作等不同角色。每个角色复用同一专家能力模板，但使用独立的私人实例、对话、记忆、知识库和本体。客户端不直接调用模型，也不建立第二套记忆数据库。

## 当前能力

- 完整登录页、会话恢复、账户与阅读设置；移除仅前端的滑动验证，保留 WANX 要求的第三方验证码。角色入口位于侧栏底部，头像进入设置。
- 登录前可在右下角搜索局域网万象WANX 或手动输入地址；进入应用后隐藏“连接服务”。不同后端的会话、实例和角色分别保存。
- 从万象“专家 → 我的专家”自动匹配知君；只有一个可用结果时直接连接，多个时弹窗选择。共享来源专家使用当前账户的私人实例，角色继续隔离。
- 原生 WebSocket 流式对话、对话附件、历史、操作确认、断线重连；发送后立即显示消息。对话列表在标题右侧显示来源标签，区分微信、网页、命令行、定时任务等渠道；缺少来源的历史记录显示“来源未知”。
- 九个原生记忆视图；用户画像分为「本体雷达 / 记忆资料」。
- 本体雷达：自动准备候选，确认理解及依据后一次纳入；简化的一张雷达、按需展开的编辑面板、五类个人本体、重要性、关联程度、直接修改、条件与例外、有效期、修改记录、停用及版本恢复。
- 对话中可明确说“请纳入本体：我是一个设计师”，成功回执后直接保存；指代不明、引文或疑问不代替本人确认。普通对话也可在候选卡核对依据后一键确认。
- 本体只在本人确认后进入可用上下文；当前角色已确认事实的来源变更、失效或撤回确认，会使依赖它的理解退出可用上下文。
- 对话在 WANX 模型调用前选择当前角色的有效本体，遵守当下表达优先；可查看本次参考内容、下一轮排除某项或停止以后使用。资料解释要求先忠实于原文，再讨论与本人的关联。
- 默认私人知识库、多文件上传、状态与预览；微信连接与角色记忆整理设置。
- Windows 0.4.2 桌面端直接显示同一登录页，在本机局域网发现并连接 WANX；安装包不再绑定家庭服务器，也不包含旧配对页。`remote-connect/` 保留旧部署的服务源码，不再随桌面安装包分发。

## 源码与当前版本

CodeUp `master` 是核心仓库；GitHub `codeup/master` 仅同步保存相同提交。本机统一使用 WANX 托管的知君 0.4.5，包含对话来源标签、原生附件上传兼容修复和 macOS 知君图标。升级时移出旧安装与旧自启动入口，保留原有账号、记忆和知识库数据。

## 快速启动

需要 Node.js 22+ 和已配置账户、模型及知君专家的兼容 WANX。使用本人拥有的知君专家时，可以自动准备私人实例；共享给其他账户的专家需要管理员提供可复用的行为模板。

```sh
npm ci
cp deployment.example.json deployment.json
# 填写 WANX 地址；已有私人实例可保留账户绑定
npm run build
npm start
```

默认访问 `http://127.0.0.1:28730`。现有机器不要用示例覆盖自己的 `deployment.json`。

桌面端构建：`npm --prefix desktop ci` → `npm run build` → `node tools/prepare-desktop.mjs` → `npm --prefix desktop run package:win -- --publish never`。桌面端不需要 `deployment.json` 或 `server-profile.json`，首次使用在登录页右下角选择 WANX；对话、记忆与知识库仍保存在所选 WANX。

开发入口 `npm run dev` 使用 28731；API 服务使用 `ZHIJUN_PUBLIC_ORIGIN=http://127.0.0.1:28731 npm start`，Vite 代理 HTTP 与 WebSocket。

## 万象应用市场包

市场版使用万象底座的 Electron、用户身份和设备连接，不需要独立登录或填写服务地址。先在万象登录并连接盒子，再从应用市场打开知君。

在本仓库使用一键脚本。首次复制本机配置：

```sh
cp market-release.example.json market-release.local.json
```

编辑 `market-release.local.json` 的 `version`（例如 `0.4.6`），然后执行：

```sh
./package.sh
```

也可以直接指定版本，命令行参数优先于配置文件：

```sh
./package.sh 0.4.7
# 查看全部参数
./package.sh --help
```

**发行版本必须来自本机配置或 `--version`，不会回退读取源码版本。** 本机配置已加入 Git 忽略规则，不要提交。脚本不修改 `package.json`、锁文件、桌面或市场清单的源码版本；仅在本次构建中将所选版本写入界面显示、包内 `package.json`、市场清单和签名描述。普通开发构建仍显示源码版本。

默认输出到 `delivery/market/<版本>/`，包含 `.wanxapp` 和配套 `.wanxapp.release.json`。脚本先检查版本、私钥与万象信任公钥，再重新构建前端、封包、签名并校验签名与 SHA-256。已有产物不会覆盖。Admin 中创建与产物相同版本的草稿，上传这两个文件；脚本不会自动上传或发布。稳定通道请使用 `0.4.6` 这样的稳定版本；不能通过 `+build` 让同一版本成为升级。

默认复用已有 `~/.config/wanx-release/release-private.pem`，密钥 ID 为 `release-2026`，不会生成或替换密钥。可在配置中设置 `key`、`key-id`、`out`、`wanx-client`，或使用同名命令行参数覆盖。配置相对路径以配置文件所在目录为基准；命令行相对路径以当前目录为基准；支持 `~/`。自定义配置可用 `--config /路径/market-release.local.json`。配置只保存版本和路径，不保存私钥内容。

首次使用需在本仓库执行 `npm ci`，并在同级 `centuarai-wanx/wanx-client` 安装 npm 依赖。签名公钥必须同时配置在市场服务和万象客户端；私钥不会进入应用包。

知君市场包默认使用 `universal/universal`，同一个 `.wanxapp` 可供 Windows、Intel Mac 和 Apple 芯片 Mac 的万象使用。包内是前端资源和 JavaScript 服务，共享万象 Electron，不携带原生运行时。万象底座的 `.dmg` / `.exe` 仍区分平台与架构。各目标系统仍需完成运行验证；旧客户端和后台必须先更新到支持通用包的版本。确有平台依赖时可同时指定 `--os macos|windows --arch x64|arm64`。

## WANX 后端

本体的权威记录存放在每个私人实例的 WANX 工作区，原生记忆继续作为来源。`backend-overlay/` 是配套后端源码，必须与客户端一起部署；仅更新前端不会启用本体 API。

当前补丁基于本地 WANX/Octop `1.0.2b4` 加既有知君本体模块，不能按版本号判断任意同名上游是否兼容。安装前应核对文件哈希和依赖。详见 [后端部署](docs/ONTOLOGY-DEPLOYMENT.md)。

```sh
python3 tools/install-ontology-backend.py /path/to/wanx/packages/octop
# 使用原来的进程管理方式重启 WANX；然后重启本客户端
```

已有附件与记忆迁移功能对应 `patches/wanx-owned-chat-reference.patch`、`patches/wanx-private-memory-portable.patch`。记忆包导入需显式启用，默认关闭。

## 配置与数据

`deployment.json` 中的 `bindings` 将用户数字 ID 绑定到其私人实例。`provisioning` 可为指定用户配置角色开通模板；具体字段见 [配置说明](docs/CONFIGURATION.md)。自动匹配知君、角色创建与局域网广播扩展的部署方式见 [连接与角色说明](docs/LAN-CONNECTION.md)。所有绑定与权限均由接口层和 WANX 校验，浏览器不能选择任意实例或所有者。

本库不包含部署凭据、真实账号配置、会话、个人记忆、知识库内容、设备配对证书或构建安装包。运行数据保存在本地 `.runtime/` 与 WANX 数据目录。生产环境请使用受信任的 HTTPS。

## 验证

```sh
npm test
npm run test:ui
npm --prefix desktop test
node --test remote-connect/tests/*.test.mjs
npm run build
# 在 WANX 的 Python 运行环境执行（先安装后端补丁）
python3 tests/test_role_ontology.py
python3 tests/test_ontology_flow.py
```

本体改动已通过接口、界面与后端单元/集成测试。测试中的模型处理器和记忆数据使用隔离夹具；这些测试不等同于真实模型的理解质量验收。真实记忆不会为了展示雷达而自动确认为本人观点。

[本体设计](design/ontology-radar-20261010/设计说明.md) · [验收说明](docs/ONTOLOGY-ACCEPTANCE.md) · [Mock 验证](docs/MOCK-QA.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

私有工程，未授予公开再分发许可。内嵌第三方代码按对应声明保留授权。
