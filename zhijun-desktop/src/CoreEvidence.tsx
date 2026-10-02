import type { OntologyClaim } from "./ontology";
import type { MemoryReference } from "./references";
import { understandingReference } from "./understanding";

export function CoreEvidence({
  claim,
  onSource,
}: {
  claim: OntologyClaim;
  onSource: (r: MemoryReference) => void;
}) {
  return (
    <details className="core-evidence">
      <summary>为什么这样理解我 ↗</summary>
      {claim.declaration && (
        <p className="muted">本人表述：{claim.declaration}</p>
      )}
      {!claim.evidence.length && (
        <p className="muted">由你的表述形成，可以随时改写。</p>
      )}
      {claim.evidence.map((e, i) => (
        <div
          className="ontology-evidence"
          key={`${e.event_id || e.document_id}:${i}`}
        >
          <blockquote>{e.quote}</blockquote>
          {e.available === false ? (
            <small>这段来源已不可用</small>
          ) : e.source_type === "knowledge" &&
            e.kb_id &&
            e.document_id &&
            e.source_version ? (
            <button
              className="quiet"
              onClick={() =>
                onSource(
                  understandingReference({
                    kb_id: e.kb_id!,
                    document_id: e.document_id!,
                    source_version: e.source_version!,
                    filename: e.filename || "资料",
                    start: e.start || 0,
                    end: e.end || e.quote.length,
                  }),
                )
              }
            >
              查看资料原文 ↗
            </button>
          ) : e.event_id && e.source_type !== "owner_declaration" ? (
            <button
              className="quiet"
              onClick={() =>
                onSource({
                  layer: "raw",
                  id: e.event_id,
                  path: `/raw_events/${e.event_id}`,
                })
              }
            >
              查看来自哪些话 ↗
            </button>
          ) : null}
        </div>
      ))}
      {claim.exceptions && (
        <p className="muted">保留与例外：{claim.exceptions}</p>
      )}
    </details>
  );
}
