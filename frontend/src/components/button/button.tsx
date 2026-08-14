import type { ButtonHTMLAttributes } from "react";
import styles from "./button.module.css";

export function Button({
  kind = "default",
  block = false,
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: {
  kind?: "default" | "primary" | "quiet";
  block?: boolean;
  loading?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={className ? `${styles.button} ${className}` : styles.button}
      data-kind={kind}
      data-block={block || undefined}
      data-loading={loading || undefined}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
      {loading && (
        <svg
          className={styles.spinner}
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="8"
            cy="8"
            r="6.5"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="2"
          />
          <path
            d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}
