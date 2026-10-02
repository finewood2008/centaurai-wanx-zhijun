# WANX SDK 依赖

共享前端依赖公司私有 SDK `centaurai-wanx-0.1.0-alpha.3.tgz`，公开源码仓库不分发该二进制安装包。

构建前，请从有权提供该 SDK 的发行方取得授权副本，保存为本目录下的 `centaurai-wanx-0.1.0-alpha.3.tgz`。`package.json` 和 `package-lock.json` 保留原始本地依赖声明；文件由 `.gitignore` 排除。

SHA-256：`c7f0bf3a2a2ab3b466a10fc56097fa2bbac44d44dc7aa35736554d206a6249ed`。

```sh
shasum -a 256 dashboard/vendor/centaurai-wanx-0.1.0-alpha.3.tgz
cd dashboard
npm ci
```

Dashboard 仅导入 `centaurai-wanx/browser`。原安装包还包含 Node、Electron、Go 及原生运行能力，浏览器不加载这些原生二进制。保留安装包内第三方组件原许可证说明，不将该 SDK 重新授权为 MIT。
