export default {
  extends: ["stylelint-config-standard", "@stylistic/stylelint-config"],
  rules: {
    "function-disallowed-list": [
      "rgb",
      "rgba",
      "hsl",
      "hsla",
      "hwb",
      "lab",
      "lch",
      "oklab",
      "oklch",
      "color",
    ],
    "color-no-hex": true,
    "declaration-block-no-redundant-longhand-properties": null,
    "no-descending-specificity": null,
    "selector-class-pattern": null,
    "selector-pseudo-class-no-unknown": [
      true,
      { ignorePseudoClasses: ["global"] },
    ],
  },
  overrides: [
    {
      files: ["src/components/**/*.module.css"],
      rules: {
        "no-empty-source": null,
      },
    },
    {
      files: ["src/styles/tokens.css"],
      rules: {
        "function-disallowed-list": null,
        "color-no-hex": null,
      },
    },
  ],
};
