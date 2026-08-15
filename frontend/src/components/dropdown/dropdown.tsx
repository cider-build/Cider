import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import styles from "./dropdown.module.css";

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
      className={styles.dropdown}
      ref={rootRef}
      style={width ? { width } : undefined}
    >
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        ref={triggerRef}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        {label && <span className={styles.label}>{label}</span>}
        <b>{selected.label}</b>
        <svg
          className={styles.chevron}
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
      </button>
      {open && (
        <div
          className={styles.list}
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
