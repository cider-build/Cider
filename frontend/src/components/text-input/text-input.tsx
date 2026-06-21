import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./text-input.module.css";

enum TextInputStyle {
  BottomBorder = "bottomBorder",
}

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & { styleType: TextInputStyle };

type TextInputComponent = ((props: TextInputProps) => ReactNode) & { Style: typeof TextInputStyle };

export const TextInput = Object.assign(
  function TextInput({ styleType, ...props }: TextInputProps) {
    switch (styleType) {
      case TextInputStyle.BottomBorder:
        return <input className={styles.bottomBorder} {...props} />;
    }
  },
  { Style: TextInputStyle },
) as TextInputComponent;
