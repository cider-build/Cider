# Cider console design rules

These rules are binding for all console work. They came from many design
rounds; the shipped console follows them. Do not regress them.

## Tokens

- Define shared tokens in `src/styles/tokens.css`.
- Use a token before a literal value.
- Define all color values in the token file. Stylelint rejects color literals elsewhere.
- Use a space token when the required value exists.
- Use a literal size only for unique component geometry.
- Font: Montserrat, weights 400–800.
- Ink `#171717`, muted `#737373`, faint `#a3a3a3`, hairline `#ececec`,
  page background `#fafafa`, card `#ffffff`.
- Orange `#ff8200` with hard offset shadow `3px 3px 0 #b76900` — reserved
  for primary actions only.
- Motion: 120–200ms, `cubic-bezier(0.23, 1, 0.32, 1)`. Animate transform,
  opacity, and color only. No entrance animations, nothing decorative.
- Destructive: red `#b42318` appears only on hover of a danger control.

## Component files

- Put each component in `components/component-name`.
- Name its code file `component-name.tsx`.
- Name its style file `component-name.module.css`.
- Keep one top-level function in each TSX file.
- Put non-rendering helper functions in a `.utils.ts` file.
- Run `npm run lint` before each frontend change.

## Copy

- Sentence case everywhere. No all-caps, no letter-spacing labels.
- No "·" middot separators — use commas, columns, or two lines.
- No counts in the sidebar.
- Natural sentences, never "Vendor · category" fragments. Never show
  install commands.
- OS names in full: "macOS 26 Tahoe", "macOS 15 Sequoia", "macOS 14
  Sonoma".
- Remove labels that repeat the current page or product name.
- Keep descriptions short. Show help only where a choice needs it.
- Show an age as one unit only. Use the largest whole unit that fits.
  Write "7d", never "7d 4h".
- Never write a sentence that describes a resource. Do not write "build-runner-01
  is running on Builder M2 Ultra with 12 cores" or "build-runner-01 is Running
  after 7d". Give each value a label and show the value. A sentence buries the
  data, cannot be scanned, and breaks the moment a field is empty.
- Never state a conclusion the code did not calculate. "Increasing slowly",
  "Burst activity", and "No sustained pressure" are inventions. Show the number.
- Never show a raw environment variable name. Write "Anthropic API key", not
  "ANTHROPIC_API_KEY". The variable is an implementation detail of the server,
  not a label for the person filling the field.

## Navigation

- Use a left sidebar for primary navigation.
- Put search below the logo and above the navigation buttons.
- Do not put action buttons in the sidebar.
- Do not show badges, counts, indexes, or hotkeys in the sidebar.

## Resource lists

- Give each primary resource table space for 15 rows.
- Keep this table height when fewer than 15 records exist.
- Do not stretch existing rows to fill the empty space.
- Do not show a record count below the page title.
- Use one status select. Do not use status chips.
- A row click opens its resource page.
- Do not open a row while the user selects text.
- Do not show an Open column or Open button.
- Do not show a Refresh control on a resource list.
- Show a status only where the database stores one. Nodes have no status
  field, so nodes show no status text, no status column, and no status
  filter.

## Detail page headers

- Show the resource name as the title. Show nothing beside it.
- Never put a status beside the title. Put the status in the detail
  table instead.
- Put the identifier and the parent resource on one grey line under the
  title.
- Link to a related resource with the diagonal arrow. The arrow marks a
  jump to another page.

## Identifiers

- The database stores 32 hexadecimal characters for every id.
- Use the full id in mock data. Never invent short ids such as "srv-002".
- Truncate a long id in a table with an ellipsis. Keep the full value in
  the tooltip and on the detail page.
- Use the first 12 characters in a heading or an inline reference.
- A sandbox has no name. Show "cider-" and the sandbox id instead.

## Resource tabs

- Put Overview, Metrics, and Terminal on one bottom rule.
- Do not put a rule above these tabs.
- Use compact tab spacing.
- Use text weight to show the selected tab.
- Do not use a colored selected-tab rule.

## Controls

- Every visible button must perform an action or open a complete control.
- Remove a button when its action does not belong in the current view.
- Use the shared button component for every button. One button system
  covers every page, dialog, and toolbar. A button must look the same in
  a page header, a list toolbar, and a dialog footer.
- Give a button three kinds only: primary, default, and quiet. Orange
  stays reserved for primary.
- Give every button press feedback in 160ms. Transition named properties
  only, never `all`. Gate a hover state behind
  `(hover: hover) and (pointer: fine)`.
- Use the shared dropdown component for every choice. Do not use the
  native `select` element. The browser controls its menu, so it cannot
  follow these rules.
- Draw a chevron as a stroke SVG. Do not use a text glyph.

## Banned tells

These read as AI-generated. They are banned everywhere: colored status
dots or pills, middot separators, all-caps micro-labels, counts in the
sidebar, "Vendor · category" copy, visible install commands, invented
brand icons, containers that resize with their content.
