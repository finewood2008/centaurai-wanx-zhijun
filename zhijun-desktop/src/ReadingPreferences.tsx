import { useState } from "react";

export const READING_SIZES = [
  { size: 15, label: "较小" },
  { size: 17, label: "标准" },
  { size: 19, label: "较大" },
  { size: 21, label: "特大" },
] as const;
const STORAGE_KEY = "zhijun:reading-size";

export function readReadingSize(): number {
  const stored = Number(localStorage.getItem(STORAGE_KEY));
  return READING_SIZES.find(({ size }) => size === stored)?.size ?? 17;
}

export function applyReadingSize(size: number) {
  document.documentElement.style.setProperty("--reading-size", `${size}px`);
}

export function ReadingPreferences() {
  const [size, setSize] = useState(readReadingSize);
  return (
    <section className="reading-preferences" aria-label="阅读与显示">
      <h3>阅读与显示</h3>
      <p className="muted">让文字，停在你读着舒服的大小。</p>
      <h4>文字大小</h4>
      <div className="reading-size-options" role="group" aria-label="文字大小">
        {READING_SIZES.map((option) => (
          <button
            key={option.size}
            aria-pressed={size === option.size}
            onClick={() => {
              localStorage.setItem(STORAGE_KEY, String(option.size));
              applyReadingSize(option.size);
              setSize(option.size);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div
        className="reading-preview"
        aria-label="字号预览"
        style={{ fontSize: size }}
      >
        <p>听你说，陪你想。</p>
        <p>不急着找到答案。把此刻在意的事，慢慢说清楚。</p>
      </div>
      <p className="muted fine">
        对话、输入与回应思路会一起调整。下次打开，仍按你的习惯显示。
      </p>
    </section>
  );
}
