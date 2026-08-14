import { Dropdown } from "../ui";
import styles from "./status-filter.module.css";

export function StatusFilter({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={styles.filter}>
      <Dropdown
        label="Status"
        value={value}
        options={options.map((option) => ({ value: option, label: option }))}
        onChange={onChange}
        width={178}
      />
    </div>
  );
}
