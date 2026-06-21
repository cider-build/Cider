import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./button.module.css";

enum ButtonStyle {
  OrangeOffset = "orangeOffset",
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; styleType: ButtonStyle };

type ButtonComponent = ((props: ButtonProps) => ReactNode) & { Style: typeof ButtonStyle };

export const Button = Object.assign(
  function Button({ children, styleType, ...props }: ButtonProps) {
    switch (styleType) {
      case ButtonStyle.OrangeOffset:
        return <button className={styles.orangeOffset} {...props}>{children}</button>;
    }
  },
  { Style: ButtonStyle },
) as ButtonComponent;
