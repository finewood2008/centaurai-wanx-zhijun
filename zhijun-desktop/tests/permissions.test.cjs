const test = require("node:test");
const assert = require("node:assert/strict");
const { installMicrophonePermissions } = require("../shell/permissions.cjs");

function permissions() {
  let request, check;
  const origin = "http://127.0.0.1:28631";
  const contents = {
    getURL: () => `${origin}/`,
    session: {
      setPermissionRequestHandler: (handler) => {
        request = handler;
      },
      setPermissionCheckHandler: (handler) => {
        check = handler;
      },
    },
  };
  installMicrophonePermissions(contents, origin);
  return {
    contents,
    origin,
    request: (...args) => request(...args),
    check: (...args) => check(...args),
  };
}

test("only the trusted main window may request microphone audio", () => {
  const { contents, origin, request } = permissions();
  const details = {
    isMainFrame: true,
    requestingUrl: `${origin}/`,
    securityOrigin: origin,
    mediaTypes: ["audio"],
  };
  function allowed(who, permission, options) {
    let result;
    request(
      who,
      permission,
      (value) => {
        result = value;
      },
      options,
    );
    return result;
  }
  assert.equal(allowed(contents, "media", details), true);
  for (const invalid of [
    { ...details, isMainFrame: false },
    { ...details, requestingUrl: "https://untrusted.test" },
    { ...details, securityOrigin: "https://untrusted.test" },
    { ...details, mediaTypes: ["video"] },
    { ...details, mediaTypes: ["audio", "video"] },
    { ...details, mediaTypes: [] },
    { ...details, mediaTypes: undefined },
  ])
    assert.equal(allowed(contents, "media", invalid), false);
  assert.equal(allowed({ ...contents }, "media", details), false);
  assert.equal(allowed(contents, "display-capture", details), false);
  assert.equal(allowed(contents, "notifications", details), false);
});

test("permission checks enforce the same origin, main frame, and audio-only boundary", () => {
  const { contents, origin, check } = permissions();
  const details = {
    isMainFrame: true,
    requestingUrl: `${origin}/`,
    securityOrigin: origin,
    mediaType: "audio",
  };
  assert.equal(check(contents, "media", origin, details), true);
  assert.equal(
    check(contents, "media", "https://untrusted.test", details),
    false,
  );
  assert.equal(check(null, "media", origin, details), false);
  assert.equal(
    check(contents, "media", origin, { ...details, isMainFrame: false }),
    false,
  );
  assert.equal(
    check(contents, "media", origin, { ...details, mediaType: "video" }),
    false,
  );
  assert.equal(
    check(contents, "media", origin, { ...details, mediaType: "unknown" }),
    false,
  );
  assert.equal(
    check(contents, "media", origin, {
      ...details,
      requestingUrl: "about:blank",
    }),
    false,
  );
  assert.equal(check(contents, "geolocation", origin, details), false);
});
