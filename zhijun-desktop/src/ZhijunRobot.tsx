export function ZhijunRobot() {
  return (
    <svg
      className="zhijun-robot"
      viewBox="0 0 88 98"
      fill="none"
      aria-hidden="true"
    >
      <ellipse
        className="robot-shadow"
        cx="44"
        cy="91"
        rx="22"
        ry="3"
        fill="#d9cbbb"
        opacity=".35"
      />
      <g className="robot-body">
        <path
          d="M44 15V8"
          stroke="#a6452e"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle
          className="robot-signal"
          cx="44"
          cy="6"
          r="3.5"
          fill="#a6452e"
        />
        <rect x="10" y="32" width="8" height="15" rx="4" fill="#d9c9b6" />
        <rect x="70" y="32" width="8" height="15" rx="4" fill="#d9c9b6" />
        <rect
          x="16"
          y="17"
          width="56"
          height="46"
          rx="19"
          fill="#f6ecdc"
          stroke="#cbb69e"
          strokeWidth="1.3"
        />
        <rect x="23" y="25" width="42" height="28" rx="11" fill="#434b45" />
        <g className="robot-eyes" fill="#fff5e5">
          <rect x="32" y="33" width="5" height="8" rx="2.5" />
          <rect x="51" y="33" width="5" height="8" rx="2.5" />
        </g>
        <path
          d="M40 45Q44 48 48 45"
          stroke="#fff5e5"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path
          d="M29 61Q44 57 59 61L62 79Q44 88 26 79Z"
          fill="#f6ecdc"
          stroke="#cbb69e"
          strokeWidth="1.2"
        />
        <path
          d="M26 65L20 73M62 65L68 73"
          stroke="#cbb69e"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d="M36 82V86M52 82V86"
          stroke="#cbb69e"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <rect x="38" y="65" width="12" height="13" rx="2" stroke="#a6452e" />
        <text
          x="44"
          y="75"
          textAnchor="middle"
          fill="#a6452e"
          fontSize="10"
          fontFamily="Songti SC, serif"
        >
          知
        </text>
      </g>
    </svg>
  );
}
