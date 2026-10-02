export const experienceEntries = [
  {
    key: "conversations",
    label: "对话",
    hint: "找回聊过的事，继续交谈",
    path: "M5 5h14v10H9l-4 4V5Z",
  },
  {
    key: "memory",
    label: "记忆",
    hint: "记忆树与情绪日记",
    path: "M12 20V9m0 4C5 13 4 8 4 4c5 0 8 3 8 9Zm0-3c0-4 3-6 8-6 0 4-2 7-8 7",
  },
  {
    key: "library",
    label: "知识库",
    hint: "管理希望知君查阅的资料",
    path: "M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1m0-14c3-2 6-2 9-1v14c-3-1-6-1-9 1V6Z",
  },
  {
    key: "preferences",
    label: "设置",
    hint: "账号、微信与陪伴节奏",
    path: "M4 7h16M4 17h16M8 4v6m8 4v6",
  },
] as const;

export type ExperienceEntry = (typeof experienceEntries)[number]["key"];

export function ExperienceNavigation({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (key: ExperienceEntry) => void;
}) {
  return (
    <nav className="experience-navigation" aria-label="知君入口">
      {experienceEntries.map(({ key, label, hint, path }) => (
        <button
          key={key}
          title={hint}
          aria-pressed={active === key}
          className={active === key ? "active" : ""}
          onClick={() => onSelect(key)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={path} />
          </svg>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
