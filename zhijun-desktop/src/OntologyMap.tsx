import { useState } from "react";
import { isCore, type PersonalOntology, type OntologyClaim } from "./ontology";
export const understandingLabel = (c: OntologyClaim) =>
  isCore(c) ? "本人确认" : "待确认";
const groups = [
  { label: "价值与原则", kinds: ["principle", "value", "boundary"] },
  { label: "自我定位", kinds: ["identity"] },
  { label: "应对与决策", kinds: ["decision"] },
  { label: "希望成为", kinds: ["aspiration"] },
  { label: "理解与回应", kinds: ["response"] },
];
export function OntologyMap({
  doc,
  selected,
  onSelect,
}: {
  doc: PersonalOntology;
  selected: string;
  onSelect: (id: string) => void;
  expanded?: boolean;
}) {
  const [openGroup, setOpenGroup] = useState(-1);
  const buckets = groups.map((g) =>
    doc.claims
      .filter((c) => isCore(c) && g.kinds.includes(c.kind))
      .sort(
        (a, b) =>
          (b.importance || 1) - (a.importance || 1) || a.id.localeCompare(b.id),
      ),
  );
  const visible = buckets.flatMap((items, group) => {
    const nodes = items.slice(0, 2);
    const choice = items.find((c) => c.id === selected);
    if (choice && !nodes.includes(choice)) nodes.splice(1, 1, choice);
    return nodes.map((claim, slot) => ({ claim, group, slot }));
  });
  return (
    <div className="ontology-map" aria-label="我的本体地图">
      <svg
        className="ontology-radar core-radar"
        viewBox="0 0 560 480"
        role="group"
        aria-label="个人本体雷达图"
      >
        <title>个人本体雷达图</title>
        <desc>
          每个可点击的圆点是一项本人确认的理解。大小表示你设定的重要程度，位置用于分类。
        </desc>
        {[92, 148, 190].map((r) => (
          <circle
            key={r}
            cx="280"
            cy="240"
            r={r}
            className="ontology-radar-ring"
          />
        ))}
        {groups.map((g, i) => {
          const angle = ((-90 + i * 72) * Math.PI) / 180;
          return (
            <g key={g.label}>
              <line
                x1="280"
                y1="240"
                x2={280 + Math.cos(angle) * 190}
                y2={240 + Math.sin(angle) * 190}
                className="ontology-radar-axis"
              />
              <text
                x={280 + Math.cos(angle) * 226}
                y={245 + Math.sin(angle) * 212}
                textAnchor="middle"
                className="ontology-radar-group"
              >
                {g.label}
              </text>
            </g>
          );
        })}
        <circle cx="280" cy="240" r="38" className="ontology-radar-center" />
        <text
          x="280"
          y="245"
          textAnchor="middle"
          className="ontology-radar-center-label"
        >
          现在的我
        </text>
        {visible.map(({ claim: c, group, slot }) => {
          const a =
            ((-90 + group * 72 + (slot === 0 ? -11 : 11)) * Math.PI) / 180;
          const radius = slot === 0 ? 123 : 158;
          const x = 280 + Math.cos(a) * radius,
            y = 240 + Math.sin(a) * radius;
          return (
            <g
              key={c.id}
              role="button"
              tabIndex={0}
              className={`ontology-radar-point core-point importance-${
                c.importance || 1
              } ${selected === c.id ? "selected" : ""}`}
              aria-label={`本人确认 ${c.statement}`}
              aria-pressed={selected === c.id}
              onClick={() => onSelect(c.id)}
              onKeyDown={(e) => {
                if (["Enter", " "].includes(e.key)) {
                  e.preventDefault();
                  onSelect(c.id);
                }
              }}
            >
              <title>
                {c.statement} ·{" "}
                {["一般", "重要", "非常重要"][(c.importance || 1) - 1]} ·
                点击调整
              </title>
              <circle cx={x} cy={y} r="22" fill="transparent" />
              <circle
                cx={x}
                cy={y}
                r={8 + (c.importance || 1) * 2}
                className="ontology-radar-dot"
              />
              <circle
                cx={x}
                cy={y}
                r={14 + (c.importance || 1) * 2}
                className="core-point-ring"
              />
              <text
                x={x}
                y={y - 25}
                textAnchor="middle"
                className="ontology-radar-point-label"
              >
                {c.title.slice(0, 12)} ↗
              </text>
            </g>
          );
        })}
      </svg>
      <p className="muted fine core-radar-hint">
        {visible.length
          ? "点选圆点，查看与调整 · 圆点大小表示重要程度"
          : "每一次亲自确认，都让这里更清晰。"}
      </p>
      <div className="core-map-more">
        {buckets.map(
          (items, i) =>
            items.length > 2 && (
              <button
                className="quiet"
                key={i}
                aria-expanded={openGroup === i}
                onClick={() => setOpenGroup(openGroup === i ? -1 : i)}
              >
                {groups[i].label} · {items.length} 项 ↗
              </button>
            ),
        )}
      </div>
      {openGroup >= 0 && (
        <div className="core-map-list">
          {buckets[openGroup].map((c) => (
            <button
              key={c.id}
              aria-pressed={selected === c.id}
              onClick={() => {
                onSelect(c.id);
                setOpenGroup(-1);
              }}
            >
              {c.title}
              <span aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
