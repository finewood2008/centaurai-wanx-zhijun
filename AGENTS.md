# 知君项目工作约定

- CodeUp 的 `origin/master` 是唯一核心源码；修改基于其最新提交，验证后按用户要求提交到 CodeUp。
- GitHub 的 `github/codeup/master` 仅保存 CodeUp 的原始提交，不在 GitHub 独立开发或用旧 GitHub 代码覆盖本项目。
- 本机只保留一套当前 WANX 托管知君入口。升级时统一包、桌面清单及市场清单版本；旧安装和旧自启动入口移出使用位置，保留用户数据。
- macOS 知君须使用 `desktop/resources/icon.png` 和对应的 `icon.icns`，同时核对 Dock 与应用包图标，不能沿用 Electron 默认图标。
- 不恢复历史独立知君服务、不另建账号或记忆数据。当前知君通过万象 Host 使用原有盒子和身份。
- 验证命令：`npm test`、`npm run test:ui`、`npm --prefix desktop test`、`npm run build`；在真实万象中确认启动、连接和显示。
- 默认用中文沟通。未经用户授权不提交或推送；不上传本机配置、凭据、会话、记忆或构建安装包。
