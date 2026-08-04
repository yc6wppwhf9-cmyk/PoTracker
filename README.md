# RM Sheet → PO Reconciliation & Approval

Standalone internal procurement app: upload an RM (raw-material) requirement
sheet, route purchasing to buyers, reconcile POs against the requirement, and
run a two-stage approval (Approver → Managing Director).

## Architecture

| Concern                              | Tech                                   |
| ------------------------------------ | -------------------------------------- |
| Frontend                             | Next.js 16 (App Router) on Vercel — `web/` |
| Heavy backend (files, math, Claude)  | Python FastAPI on Cloud Run — `api/` (Phase 2+) |
| DB / Auth / Storage / Realtime       | Supabase (project `Procurement`, ref `zpuhlgjuoqrxcakeyhbg`) |
| AI (fuzzy match + MD summary)        | Claude API — called only from FastAPI  |
| Email                                | Resend (Phase 6)                       |

> **Region note:** the brief specified Mumbai (`ap-south-1`), but the free-tier
> project cap forced reuse of an existing empty project in **Tokyo
> (`ap-northeast-1`)**. FastAPI should therefore deploy to `asia-northeast1` to
> avoid cross-region hops. Revisit if the project is later moved to Mumbai.

## Boundary rule

- **Next.js** → auth-gated CRUD straight to Supabase (RLS enforced).
- **FastAPI** → anything that parses a spreadsheet, compares quantities, or
  calls Claude. Reconciliation math is **SQL only**, never the LLM.

## Data model & reconciliation

Tables: `item_master`, `uom_conversion`, `rm_sheet`, `rm_requirement`, `po`,
`po_line`, `approval`, `escalation`, `audit_log`, plus `profiles` + roles. The
`reconciliation` view (Phase 5) classifies each line as `not_bought` /
`partial` / `on_target` / `over_buy` / `extra_not_in_sheet`, distinguishing
MOQ-forced over-buy from genuine over-order.

> ⚠️ **The schema is not in this repository** — it lives only in the hosted
> Supabase project, including all RLS policies and the `reconciliation` view.
> See [`supabase/README.md`](supabase/README.md) for how to capture it. This is
> the highest-priority outstanding item.

## Roles (Supabase Auth + RLS)

`uploader`, `purchase_head`, `buyer`, `po_team`, `approver`, `md`, `admin`.
Roles live in `public.profiles.role`; RLS policies are the real access boundary.
New sign-ups default to `uploader`; an admin promotes them at `/admin/users`.

## Local development

```bash
cd web
npm install
npm run dev
```

Environment (`web/.env.local`):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...        # publishable key
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

### Demo logins (seeded)

| Email               | Password       | Role  |
| ------------------- | -------------- | ----- |
| `admin@demo.local`  | `Password123!` | admin |
| `buyer@hscvpl.com`  | `Password123!` | buyer |

> Supabase GoTrue rejects reserved TLDs like `.local`/`example.com` on **signup**
> (these demo users were seeded directly in the DB). Use real corporate emails
> (e.g. `@hscvpl.com`) for UI sign-ups.

## Backend (FastAPI, `api/`)

```bash
cd api
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # Windows
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

Auth model: every request carries the caller's Supabase JWT; the API acts under
that token so **RLS governs all DB/Storage writes** (no service-role secret).

Endpoints:
- `POST /rm-sheets` — uploader/admin. Accepts `.xlsx`, stores to Storage, parses
  (header-driven), matches item codes to `item_master`, flags unmatched as
  `needs_review`, inserts `rm_sheet` + `rm_requirement`. Idempotent by SHA-256
  content hash. Assigns a sequential `MR-<year>-NNN` reference when none is
  given, auto-registers unseen item codes as *provisional* catalogue entries
  (those lines still go to review), and extracts POs already named on the sheet.
- `POST /item-master/import` — admin. Upserts the catalogue from `.xlsx`.
- `POST /pos/{id}/upload` — po_team. Attaches the finalised PO document.
- `POST /pos/import-register` — buyer/po_team/purchase_head. Bulk-creates POs
  and lines from a PO register `.xlsx`. Idempotent by content hash; item codes
  not in the catalogue are skipped and reported rather than aborting the batch.
- `POST /ai/rm-sheets/{id}/summary` — approver/md. Claude-written executive
  summary of a reconciliation, with a deterministic fallback when no API key is
  configured. **Not yet wired into the UI.**
- `POST /ai/rm-sheets/{id}/fuzzy-match` — uploader/purchase_head. Claude
  suggestions for `needs_review` lines. **Not yet wired into the UI**, and only
  samples the first 50 catalogue items — needs candidate pre-filtering before
  it is useful on the real catalogue.
- `GET /health`.

The `ANTHROPIC_API_KEY` lives in `api/.env` (server-side only). Model:
`claude-opus-5`.

### Tests

```bash
cd api
.venv/Scripts/python -m pytest        # Windows
```

Covers the RM sheet parser (header detection, alias matching, value-based
fallback, multi-tab merge). Nothing else has tests yet, and there is no CI.

### RM sheet format (HSCVPL)

Header-mapped columns (matched by name, order-independent): `COMPONENT ICODE`
(join key), `Final Pending (To Purchase)` (required qty, native units), falling
back to `TOTAL_COMPONENT_QUANTITY` on tabs with no pending column;
`COMPONENT ITEM NAME`, plus `Lot No` / `Department` / `COLOR` / `UOM` /
`PO Number` captured where present (`raw_row` jsonb holds the full original
row). Location is taken from the worksheet tab name. Multi-tab workbooks are
merged; the item-code column is detected by value when its header is junk.

## Build status

- **Phase 1 ✅** Schema, auth, roles, RLS, Next.js scaffold, admin user mgmt.
- **Phase 2 ✅** FastAPI (RM upload/parse, item_master importer), Storage +
  policies, Next.js upload + catalogue screens. Verified against the real
  861-row sheet: 858 matched, 3 flagged, idempotent re-upload.
- **Phase 3 ✅** Purchase Head assignment by category. `/procurement/assign`
  (list) + `/procurement/assign/[sheetId]` (group lines by catalogue category,
  bulk-assign a buyer per category). Implemented as Next.js Server Actions on
  Supabase (pure CRUD → §4 boundary; not FastAPI). RLS: purchase_head/admin
  write; staff can read profiles to pick buyers.
- **Phase 4 ✅** PO creation + document upload. Buyer workspace
  (`/procurement/buyer`) drafts POs with ordered qty + MOQ from their assigned
  items (Next.js Server Action, restricted to items actually assigned to them).
  PO team (`/procurement/po-team`) attaches the finalised PO document via
  FastAPI `POST /pos/{id}/upload` → `po-docs` bucket (kept off Vercel's 4.5 MB
  serverless limit). Verified: buyer denied doc upload (403), po_team allowed,
  PO flips to `uploaded`.
- **Phase 5 ✅** Reconciliation. Postgres `reconciliation` view (§6 logic:
  FULL OUTER JOIN, `expected_max = ceil(required/moq)*moq`, tolerance band,
  5-way classification, plus a `moq_forced` flag splitting MOQ-rounded buys from
  genuine over-orders) with `security_invoker` so RLS applies. Colour-tabbed
  screen `/procurement/reconciliation/[sheetId]` (green/amber/red/purple/coral)
  with summary cards + per-line variance. Verified: all 5 statuses + MOQ badge.
- **Phase 6 ✅** Approvals + escalations. Approver screen
  (`/procurement/approver/[sheetId]`) reviews reconciliation and sends to the MD
  (`approval` row, deterministic digest, Resend email). MD screen
  (`/procurement/md`) approves/rejects, flipping `rm_sheet.status`. Approvers
  can escalate a flagged material to its assigned buyer with a 9-working-hour
  SLA (`add_working_hours()`, Mon–Sat 09:00–18:00 IST); pg_cron auto-escalates
  overdue items to the MD.
- **Phase 7 🚧** Claude. `POST /ai/...` endpoints exist and work, but nothing in
  the UI calls them — the approver's MD summary is still the deterministic
  SQL-count digest from Phase 6.

## Known gaps

1. **The database schema is not in version control** — see
   [`supabase/README.md`](supabase/README.md). Highest priority.
2. **The `/ai` endpoints are unreachable from the UI.** Wiring
   `approveAndSend()` to the summary endpoint is the intended Phase 7 finish.
3. **Test coverage is limited to the parser**, and there is no CI.

Regenerate `web/src/lib/database.types.ts` after any schema change — it had
drifted (missing `item_master.article_name` / `hsn_code` / `material_type`,
all of which exist in the live table) and was corrected by hand:

```bash
supabase gen types typescript --project-id <project-ref> > web/src/lib/database.types.ts
```
