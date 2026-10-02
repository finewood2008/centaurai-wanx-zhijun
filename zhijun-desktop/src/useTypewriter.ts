import { useEffect, useMemo, useRef, useState } from "react";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Never cut a UTF-16 pair, combining sequence or joined emoji. */
export function replyGraphemes(text: string) {
  return Array.from(
    segmenter.segment(text.replace(/[\uD800-\uDBFF]$/, "")),
    (part) => part.segment,
  );
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * `eligible` identifies a new live reply, not history or a resumed connection.
 * Keep it true through that reply's completion so a short backlog can finish.
 * A reply first seen as ineligible is never replayed under the same id.
 * A new eligible reply can already be done when React batches short streams.
 */
export function useTypewriter({
  id,
  text,
  streaming,
  eligible,
}: {
  id: string;
  text: string;
  streaming: boolean;
  eligible: boolean;
}) {
  const reduced = useReducedMotion();
  const graphemes = useMemo(() => replyGraphemes(text), [text]);
  const session = useRef({
    id,
    typing: eligible && !reduced,
    target: text,
  });
  if (session.current.id !== id)
    session.current = {
      id,
      typing: eligible && !reduced,
      target: text,
    };
  const rewritten = !text.startsWith(session.current.target);
  if (!eligible || reduced || rewritten) session.current.typing = false;
  session.current.target = text;
  const immediate = !session.current.typing;
  // Withhold the last live grapheme: a subsequent chunk can extend it with a
  // combining mark or ZWJ, even when the current chunk ends on a code point.
  const targetCount = streaming
    ? Math.max(0, graphemes.length - 1)
    : graphemes.length;
  const [frame, setFrame] = useState({
    id,
    count: immediate ? graphemes.length : 0,
  });
  const count =
    frame.id === id ? frame.count : immediate ? graphemes.length : 0;
  const target = useRef({ id, count: targetCount });
  target.current = { id, count: targetCount };
  const completion = useRef({ id, at: streaming ? null : Date.now() });
  if (completion.current.id !== id || streaming)
    completion.current = { id, at: streaming ? null : Date.now() };
  else if (completion.current.at === null) completion.current.at = Date.now();
  const caughtUp = !streaming && count >= targetCount;
  useEffect(() => {
    if (immediate) {
      session.current.typing = false;
      return;
    }
    if (caughtUp) return;
    // The interval survives incoming chunks, so a fast stream cannot keep
    // cancelling the next reveal tick and starve the visible response.
    const timer = window.setInterval(() => {
      if (!session.current.typing || target.current.id !== id) return;
      setFrame((previous) => {
        const shown = previous.id === id ? previous.count : 0;
        const backlog = target.current.count - shown;
        return backlog <= 0
          ? previous
          : {
              id,
              count: Math.min(
                target.current.count,
                !streaming && Date.now() - completion.current.at! >= 240
                  ? target.current.count
                  : shown + Math.min(512, Math.max(1, Math.ceil(backlog / 8))),
              ),
            };
      });
    }, 24);
    return () => clearInterval(timer);
  }, [id, immediate, streaming, caughtUp]);
  const displayedText = immediate
    ? graphemes.join("")
    : graphemes.slice(0, count).join("");
  return {
    displayedText,
    isRevealing: !immediate && count < graphemes.length,
    revealAll: () => {
      session.current.typing = false;
      setFrame({ id, count: graphemes.length });
    },
  };
}
