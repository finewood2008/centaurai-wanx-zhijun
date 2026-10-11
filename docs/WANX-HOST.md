# 知君 WANX Host 模式

知君安装包包含 `application.manifest.json`，运行时由万象 Host 通过一次性 `WANX_HOST_*` 环境变量启动。`desktop/shell/host-client.cjs` 使用本机 Unix socket 或 Windows named pipe 调用固定 IPC 方法，不保存平台 token、盒端 JWT 或盒端地址。

Host 模式只替换运行时的上游传输：知君现有 `/api` 业务接口和 React 页面继续保留，`server/app.mjs` 将盒端请求交给 Host。没有 `WANX_HOST_SOCKET` 时仍使用原有 Web/LAN 连接和本地登录流程。

发布前先运行 `npm run build`，再运行 `node tools/prepare-desktop.mjs`；Host 安装目录应为准备后的 `desktop/`，不是仓库根目录。
