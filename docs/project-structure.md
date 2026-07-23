# EdgeEver Project Structure

```text
edgeever/
├── apps/
│   ├── web/
│   │   ├── public/
│   │   │   ├── manifest.webmanifest
│   │   │   └── icons/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── App.tsx
│   │   │   │   └── routes.tsx
│   │   │   ├── components/
│   │   │   │   ├── editor/
│   │   │   │   ├── layout/
│   │   │   │   ├── memo-list/
│   │   │   │   ├── notebook-tree/
│   │   │   │   └── ui/
│   │   │   ├── hooks/
│   │   │   ├── lib/
│   │   │   ├── styles/
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   ├── api/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── env.ts
│   │   │   ├── db/
│   │   │   ├── routes/
│   │   │   │   ├── memos.ts
│   │   │   │   ├── notebooks.ts
│   │   │   │   └── resources.ts
│   │   │   └── services/
│   │   │       ├── merge-memos.ts
│   │   │       └── resource-store.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── site/
│       ├── public/
│       ├── src/
│       │   ├── components/
│       │   ├── content/
│       │   ├── layouts/
│       │   ├── pages/
│       │   └── styles/
│       ├── astro.config.mjs
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── content.ts
│       │   ├── index.ts
│       │   ├── schemas.ts
│       │   └── types.ts
│       ├── package.json
│       └── tsconfig.json
├── migrations/
│   └── 0001_initial.sql
├── docs/
│   └── project-structure.md
├── tailwind.config.ts
├── wrangler.toml
├── bun.lock
└── package.json
```

## Deployment Shape

EdgeEver should deploy as one Cloudflare Worker:

- `/api/*` is routed to the Hono app first.
- Static files from `apps/web/dist` are served by Workers Assets.
- Unknown static routes fall back to `index.html` for SPA and PWA navigation.
- `env.DB` is the D1 binding.
- `env.RESOURCES` is the Workers KV namespace binding for images and attachments; D1 tracks physical usage and deferred deletion.

The official website in `apps/site` is an Astro static site. It is built and
deployed independently from the product Worker, typically to Cloudflare Pages.

## Frontend Boundaries

- `components/layout` owns the responsive three-pane shell.
- `components/notebook-tree` renders recursive notebooks from `parent_id`.
- `components/memo-list` owns checkbox selection and merge action surfaces.
- `components/editor` owns TipTap integration and Markdown serialization.
- `lib/api-client.ts` should be the only browser module that talks to `/api/*`.

## API Boundaries

- `routes/*` should stay thin: validate input, call services, return JSON.
- `services/merge-memos.ts` owns the D1 transaction that creates a merged memo, soft deletes source memos, and re-points resources.
- `resource-store.ts` owns Workers KV object access, capacity reservations, and deferred deletion.
- `db/*` owns SQL snippets and row mapping.

## Data Model Notes

- Notebook nesting is unbounded through `notebooks.parent_id`.
- Every memo belongs to exactly one notebook through `memos.notebook_id`.
- Merge output is represented by a new memo with `source_memo_ids` and `merge_source_count`.
- Merge inputs are retained as soft-deleted rows with `merged_into_memo_id`.
- KV objects are not moved during merge; `resources.memo_id` is updated to the new memo.
