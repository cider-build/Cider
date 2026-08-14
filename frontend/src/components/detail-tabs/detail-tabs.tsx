import styles from "./detail-tabs.module.css";

export function DetailTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: Array<{
    id: string;
    label: string;
    disabled?: boolean;
    title?: string;
  }>;
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className={styles.tabs} aria-label="Sections">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-current={tab.id === active ? "page" : undefined}
          disabled={tab.disabled}
          title={tab.title}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
