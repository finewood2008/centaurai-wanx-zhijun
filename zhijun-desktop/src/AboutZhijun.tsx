import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { version as buildVersion } from "../package.json";
import centaur from "./assets/centaur-official.png";

export function AboutZhijun({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [version, setVersion] = useState(
    window.zhijunDesktop ? "" : buildVersion,
  );
  useEffect(() => {
    let alive = true;
    const dialog = ref.current;
    dialog?.showModal();
    window.zhijunDesktop?.connection().then(
      ({ version }) => {
        if (alive) setVersion(version);
      },
      () => {},
    );
    return () => {
      alive = false;
      dialog?.close();
    };
  }, []);

  return createPortal(
    <dialog
      ref={ref}
      className="about-zhijun"
      aria-label="关于知君"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      onClick={(event) => {
        const dialog = ref.current;
        if (!dialog || event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      <button
        className="about-zhijun__close"
        type="button"
        aria-label="关闭关于知君"
        onClick={onClose}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="m18 6-12 12M6 6l12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <h2>知君</h2>
      <p className="about-zhijun__intro">
        和你一起，慢慢看清自己，成为更好的自己。
      </p>
      <p className="about-zhijun__relation">知君是你的知己，益友，良师</p>
      <div className="about-zhijun__origin">
        <img src={centaur} alt="半人马人工智能" width="44" height="59" />
        <div>
          <p className="about-zhijun__name">半人马人工智能出品</p>
          <p>半人马人工智能（深圳）有限公司</p>
        </div>
      </div>
      {version && <p className="about-zhijun__version">版本 {version}</p>}
    </dialog>,
    document.body,
  );
}
