# Cider console design rules

These rules are binding for all console work. They came from many design
rounds; the shipped console follows them. Do not regress them.

## Tokens

- Font: Montserrat, weights 400–800.
- Ink `#171717`, muted `#737373`, faint `#a3a3a3`, hairline `#ececec`,
  page background `#fafafa`, card `#ffffff`.
- Orange `#ff8200` with hard offset shadow `3px 3px 0 #b76900` — reserved
  for primary actions only.
- Motion: 120–200ms, `cubic-bezier(0.23, 1, 0.32, 1)`. Animate transform,
  opacity, and color only. No entrance animations, nothing decorative.
- Destructive: red `#b42318` appears only on hover of a danger control.

## Copy

- Sentence case everywhere. No all-caps, no letter-spacing labels.
- No "·" middot separators — use commas, columns, or two lines.
- No counts in the sidebar.
- Natural sentences, never "Vendor · category" fragments. Never show
  install commands.
- OS names in full: "macOS 26 Tahoe", "macOS 15 Sequoia", "macOS 14
  Sonoma".

## Banned tells

These read as AI-generated. They are banned everywhere: colored status
dots or pills, middot separators, all-caps micro-labels, counts in the
sidebar, "Vendor · category" copy, visible install commands, invented
brand icons, containers that resize with their content.
