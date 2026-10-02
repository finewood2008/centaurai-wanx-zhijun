export function ActionIcon({
  name,
}: {
  name: "trash" | "archive" | "restore" | "refresh";
}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === "trash" && (
        <>
          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" />
        </>
      )}
      {name === "archive" && (
        <>
          <path d="M4 4h16v4H4zM6 8v12h12V8M10 12h4" />
        </>
      )}
      {name === "restore" && (
        <>
          <path d="M4 10a8 8 0 1 1 1 7M4 4v6h6M12 8v5l3 2" />
        </>
      )}
      {name === "refresh" && (
        <>
          <path d="M4 10a8 8 0 0 1 13-4l3 3M20 4v5h-5M20 14a8 8 0 0 1-13 4l-3-3M4 20v-5h5" />
        </>
      )}
    </svg>
  );
}
