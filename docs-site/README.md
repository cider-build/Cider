# Cider docs (Fumadocs)

The Cider documentation site, built with [Fumadocs](https://fumadocs.dev) on Next.js.

## Develop

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Structure

- `content/docs/`: pages (MDX) and `meta.json` navigation files
- `content/docs/api-reference/endpoints/`: generated from `public/api-reference/openapi.yaml`. Regenerate with `npm run generate:api`.
- `app/global.css`: Cider design tokens (from `frontend/src/styles/tokens.css`) mapped onto the Fumadocs theme
- `components/mdx.tsx`: MDX components. The content uses Mintlify-style component names (`Note`, `Steps`, `Tabs`, `Card`) so the same pages build with either framework.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run generate:api` | Regenerate API endpoint pages from the OpenAPI spec |
| `npm run types:check` | Type check |
| `npm run lint` | Lint with oxlint |
