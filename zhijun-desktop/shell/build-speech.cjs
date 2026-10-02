const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function buildNativeSpeech(
  output = path.join(__dirname, "native", "bin", "zhijun-speech"),
) {
  if (process.platform !== "darwin")
    throw new Error("本机语音助手仅可在 macOS 构建。");
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "zhijun-speech-build-"));
  try {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    execFileSync(
      "xcrun",
      [
        "swiftc",
        "-O",
        "-module-cache-path",
        cache,
        "-target",
        `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos12.0`,
        path.join(__dirname, "native", "zhijun-speech.swift"),
        "-Xlinker",
        "-sectcreate",
        "-Xlinker",
        "__TEXT",
        "-Xlinker",
        "__info_plist",
        "-Xlinker",
        path.join(__dirname, "native", "Info.plist"),
        "-o",
        output,
      ],
      { stdio: "inherit" },
    );
    return output;
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
}

if (require.main === module) console.log(buildNativeSpeech(process.argv[2]));
module.exports = { buildNativeSpeech };
