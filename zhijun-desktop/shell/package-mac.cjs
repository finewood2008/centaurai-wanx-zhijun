const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("本地交付脚本仅用于 macOS Apple Silicon");
const runtime =
  process.env.ZHIJUN_ELECTRON_DIST ||
  path.join(path.dirname(require.resolve("electron")), "dist");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const target = path.join(root, "release", "知君.app");
if (!fs.existsSync(path.join(root, "dist", "index.html")))
  throw new Error("请先运行 npm run build");
execFileSync(process.execPath, [path.join(root, "shell/build-speech.cjs")], {
  stdio: "inherit",
});
if (fs.existsSync(target))
  throw new Error("release/知君.app 已存在，请保留或移走上一份交付后再打包");
fs.mkdirSync(path.dirname(target), { recursive: true });
execFileSync("ditto", [path.join(runtime, "Electron.app"), target]);
const resources = path.join(target, "Contents", "Resources");
const app = path.join(resources, "app");
fs.mkdirSync(app);
for (const name of ["dist", "shell"])
  fs.cpSync(path.join(root, name), path.join(app, name), { recursive: true });
fs.writeFileSync(
  path.join(app, "package.json"),
  JSON.stringify({
    name: pkg.name,
    productName: "知君",
    version: pkg.version,
    main: "shell/main.cjs",
  }),
);
fs.copyFileSync(
  path.join(root, "assets", "zhijun.icns"),
  path.join(resources, "zhijun.icns"),
);
const plist = path.join(target, "Contents", "Info.plist");
for (const [key, value] of Object.entries({
  CFBundleIdentifier: "ai.zhijun.wanx",
  CFBundleName: "知君",
  CFBundleDisplayName: "知君",
  CFBundleVersion: pkg.version,
  CFBundleShortVersionString: pkg.version,
  CFBundleIconFile: "zhijun.icns",
  NSSpeechRecognitionUsageDescription:
    "知君仅在你点击开始后请求设备端语音识别权限，将本机转写结果放入可编辑草稿；音频不发送至云端。",
  NSMicrophoneUsageDescription:
    "知君仅在你开始语音输入后使用麦克风，将识别文字放入可编辑草稿。",
})) {
  try {
    execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", `Set :${key} ${value}`, plist],
      { stdio: "pipe" },
    );
  } catch {
    execFileSync("/usr/libexec/PlistBuddy", [
      "-c",
      `Add :${key} string ${value}`,
      plist,
    ]);
  }
}
execFileSync(
  "codesign",
  ["--force", "--deep", "--sign", "-", "--timestamp=none", target],
  { stdio: "inherit" },
);
execFileSync("codesign", ["--verify", "--deep", "--strict", target], {
  stdio: "inherit",
});
console.log(target);
