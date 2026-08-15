import type { ReactNode } from "react";
import { NavLink } from "react-router";
import type { IconName } from "../icon/icon";
import { Icon } from "../ui";
import styles from "./nav-item.module.css";

export function NavItem({
  to,
  page,
  children,
}: {
  to: string;
  page: IconName;
  children: ReactNode;
}) {
  return (
    <NavLink
      className={({ isActive }) =>
        isActive ? `${styles.link} ${styles.active}` : styles.link}
      to={to}
    >
      <Icon name={page} />
      {children}
    </NavLink>
  );
}
