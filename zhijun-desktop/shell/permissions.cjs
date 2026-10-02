function sameOrigin(value, origin) {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

function trustedMainFrame(contents, expectedContents, origin, details) {
  return (
    contents === expectedContents &&
    details?.isMainFrame === true &&
    sameOrigin(contents.getURL(), origin) &&
    sameOrigin(details.requestingUrl, origin)
  );
}

function installMicrophonePermissions(contents, origin) {
  contents.session.setPermissionRequestHandler(
    (requestingContents, permission, callback, details) => {
      callback(
        permission === "media" &&
          trustedMainFrame(requestingContents, contents, origin, details) &&
          Array.isArray(details.mediaTypes) &&
          details.mediaTypes.length === 1 &&
          details.mediaTypes[0] === "audio" &&
          (!details.securityOrigin ||
            sameOrigin(details.securityOrigin, origin)),
      );
    },
  );
  contents.session.setPermissionCheckHandler(
    (requestingContents, permission, requestingOrigin, details) =>
      permission === "media" &&
      trustedMainFrame(requestingContents, contents, origin, details) &&
      sameOrigin(requestingOrigin, origin) &&
      details.mediaType === "audio" &&
      (!details.securityOrigin || sameOrigin(details.securityOrigin, origin)),
  );
}

module.exports = { installMicrophonePermissions };
