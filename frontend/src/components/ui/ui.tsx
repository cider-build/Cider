import { useEffect, useId, useRef, useState } from "react";
import "./ui.css";
import type { ButtonHTMLAttributes, KeyboardEvent, ReactNode } from "react";

function Spinner() {
  return (
    <svg
      className="ui-spinner"
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
  );
}

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
      className={className ? `ui-btn ${className}` : "ui-btn"}
      data-kind={kind}
      data-block={block || undefined}
      data-loading={loading || undefined}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
      {loading && <Spinner />}
    </button>
  );
}

export function StatusText({ label }: { label: string }) {
  return (
    <span className="ui-status" data-status={label.toLowerCase()}>
      {label}
    </span>
  );
}

type DropdownOption = { value: string; label: string };
const MENU_MAX = 264;

export function Dropdown({
  label,
  value,
  options,
  onChange,
  width,
}: {
  label?: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  function show() {
    setActiveIndex(selectedIndex);
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect !== undefined) {
      const wanted = Math.min(options.length * 29 + 8, MENU_MAX);
      const below = window.innerHeight - rect.bottom - 8;
      const above = rect.top - 8;
      setUp(below < wanted && above > below);
    }
    setOpen(true);
  }

  function commit(index: number) {
    onChange(options[index].value);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        show();
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex(
        (index) => (index + step + options.length) % options.length,
      );
      return;
    }
    if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End" && open) {
      event.preventDefault();
      setActiveIndex(options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) commit(activeIndex);
      else show();
    }
  }

  return (
    <div
      className="ui-dropdown"
      ref={rootRef}
      style={width ? { width } : undefined}
    >
      <button
        type="button"
        className="ui-dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        ref={triggerRef}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        {label && <span className="ui-dropdown-label">{label}</span>}
        <b>{selected.label}</b>
        <Chevron open={open} />
      </button>
      {open && (
        <div
          className="ui-dropdown-list"
          id={listId}
          data-up={up || undefined}
          role="listbox"
          tabIndex={-1}
          ref={listRef}
          aria-activedescendant={`${listId}-option-${activeIndex}`}
          onKeyDown={onKeyDown}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${listId}-option-${index}`}
              role="option"
              aria-selected={index === selectedIndex}
              data-active={index === activeIndex || undefined}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => commit(index)}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Id({ value, wide = false }: { value: string; wide?: boolean }) {
  return (
    <span className="ui-id" data-wide={wide || undefined} title={value}>
      {value}
    </span>
  );
}

export function Sparkline({
  values,
  color = "currentColor",
  fill = false,
}: {
  values: number[];
  color?: string;
  fill?: boolean;
}) {
  const width = 240;
  const height = 64;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const divisor = Math.max(1, values.length - 1);
  const points = values
    .map((value, index) => {
      const x = (index / divisor) * width;
      const y = height - 5 - ((value - min) / range) * (height - 12);
      return `${x},${y}`;
    })
    .join(" ");
  const fillPoints = `0,${height} ${points} ${width},${height}`;
  return (
    <svg
      className="ui-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path className="ui-grid-line" d="M0 16H240M0 32H240M0 48H240" />
      {fill && <polygon points={fillPoints} fill={color} opacity="0.08" />}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function LinkOut({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="ui-linkout" onClick={onClick}>
      {children}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M8 16 16 8M9 8h7v7" />
      </svg>
    </button>
  );
}

function Chevron({ open = false }: { open?: boolean }) {
  return (
    <svg
      className="ui-chevron"
      data-open={open || undefined}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

type IconName =
  | "nodes"
  | "sandboxes"
  | "servers"
  | "snapshots"
  | "search"
  | "terminal";

export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    nodes: (
      <>
        <rect x="4" y="5" width="16" height="11" rx="1" />
        <path d="M9 20h6M12 16v4" />
      </>
    ),
    sandboxes: (
      <>
        <path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" />
        <path d="m4 12 8 4.5 8-4.5M4 16.5 12 21l8-4.5" />
      </>
    ),
    servers: (
      <>
        <rect x="4" y="4" width="16" height="6" rx="1" />
        <rect x="4" y="14" width="16" height="6" rx="1" />
        <path d="M8 7h.01M8 17h.01" />
      </>
    ),
    snapshots: (
      <>
        <path d="m12 4 8 4-8 4-8-4 8-4Z" />
        <path d="m4 13 8 4 8-4M4 17l8 4 8-4" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    terminal: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="m7 9 3 3-3 3M13 15h4" />
      </>
    ),
  };
  return (
    <svg
      className="ui-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
