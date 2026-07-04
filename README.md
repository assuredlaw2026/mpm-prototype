# MyPropertyManager.com — inspection-first prototype

A runnable full-stack prototype of the MPM inspection-first workflow. It implements Phases 1 through 3 with real backend and database-level enforcement, and holds Phase 4 (live SMS, live notice generation, live mailing) behind counsel gates that the prototype cannot open.

This is a prototype, not production. SMS, notices, and mailing are simulated. The point of the build is to show that the compliance controls are enforced where they cannot be bypassed, not to ship a product.

## Requirements

- Node.js v22.5+ (uses the built-in `node:sqlite` module via `--experimental-sqlite`). Verified on v22.22.2.
- No npm dependencies. Nothing to install.

## Run

```bash
npm start         # serves the app at http://localhost:3000
npm test          # runs the S1 bypass test suite (Phase 3)
npm run fresh     # deletes the local mpm.db file and starts clean
```

Open http://localhost:3000 for the homepage and pricing. The owner console is at `/app`. The tenant inspection opens from a per-matter link the console generates (`/inspect/:token`); open it in a separate tab to play the tenant role, then pull the report back in the console.

A `mpm.db` SQLite file is created on first run. Delete it (or run `npm run fresh`) to reset.

## What the journey demonstrates

**Phase 1 — inspection-first.** Homepage and pricing, owner account, add property (NV/AZ/TX), add tenant, five-part owner attestation, simulated purchase, inspection creation, simulated link dispatch, the tenant-guided mobile inspection (consent or neutral decline, per-area capture with simulated photo, completeness-gated certification, mid-flow withdrawal), the owner report, the property file, and the defensible-packet export with its fixed disclaimer.

**Phase 2 — incomplete and notice path.** Timeout resolution, the neutral Final Inspection Cooperation Request with its 48-hour window, the five-gate Notice Eligibility Review rendered as a gate ledger (A lawful basis, B identified tenancy, C no protected activity, D no disputed facts, E approved state content), and the attorney off-ramp. There is no path from a completed inspection, an incomplete inspection, an AI flag, or a tenant decline directly to a notice.

**Phase 3 — enforcement and QA.** Every control above is enforced in the API and, for the load-bearing ones, in the database. The bypass suite (`npm test`) attempts to defeat each control and asserts it fails closed.

**Phase 4 — gated.** Live SMS, live notice generation, and live mailing exist only as endpoints that refuse. The console includes prototype-only simulation controls to toggle the TCPA and state-content flags so the gates can be seen opening and closing; in production those flags are owned by counsel, not by a button.

## Architecture

```
src/db.mjs     schema (DDL), CHECK constraints, triggers, seed data, audit helper
src/app.mjs    routing + domain logic + the gate evaluations
src/server.mjs node:http server: JSON API + static SPA hosting
public/        vanilla-JS single-page client (no build step)
test/bypass.test.mjs   the S1 bypass suite (node:test)
```

The client is not a control. It is a convenience over the API. Every rule is enforced server-side; the database is the final backstop.

## What is enforced, and where

The design rule is that the strongest controls are made *unrepresentable* in the database, so no screen, endpoint, worker, or future module can write a bypassing row.

Enforced in the **database** (CHECK constraints and triggers; a bypass is not storable):

- Only the three locked prices exist; `$25` and any other amount cannot be inserted (`package`, `purchase` price CHECKs).
- An attestation row cannot exist unless all five affirmations are true (`attestation` CHECK).
- A notice is `sendable = 1` only if predicate validity, all five gates, state-module availability, no attorney routing, and owner approval hold in the same row (`notice_matter` CHECK).
- A mail job cannot be created for a non-sendable notice (`mail_job` BEFORE INSERT trigger raising `E_NOTICE_NOT_SENDABLE`).
- Audit rows cannot be updated or deleted (triggers raising `E_AUDIT_IMMUTABLE`).
- Media rows are stored with EXIF stripped and no GPS columns exist to hold location.
- A response row must carry content or a valid N/A reason (`inspection_response` CHECK).

Enforced in the **API** (server-side logic over the constrained schema):

- Completed inspections never auto-create a notice; both predicate paths must be built deliberately and fail closed.
- The finding predicate routes to attorney review on any high-risk trigger: high-risk category, AI confidence below the versioned threshold, inadequate or uncertain evidence quality, owner-maintenance classification, missing lease evidence, exposure over $1,000, or missing/unevaluable estimated exposure.
- Non-completion must traverse the cooperation window before eligibility; gates C and D fail closed on anything other than an explicit "no."
- An unavailable state module has no generic fallback and routes to the attorney off-ramp.
- Live SMS, notice generation, and mailing are blocked until their gates are cleared.
- Tenant token access is scoped to a single matter and cannot reach owner endpoints or another matter's media; media is private and served only via a signed URL or an authorized session.
- Owner-entered text is screened for forbidden marketing and legal-sufficiency terms.

## Tests (Phase 3)

`npm test` runs the seventeen mandated S1 bypass scenarios plus paired positive and backstop tests (22 in total). Each asserts that a control fails closed: no auto-notice, no direct-to-notice routing, predicate paths fail closed, the attorney off-ramp blocks approval, the TCPA/state-module/mailing gates hold, media stays private, audit rows are immutable, tenant tokens are sandboxed, and only the locked prices are representable. Severity S1 is non-waivable: any failure is a release blocker.

## Prototype boundaries

No real carrier, mailing, or payment integration. Simulation controls and `/api/dev/*` endpoints exist for demonstration only and would not ship. Retention, EXIF, and geolocation policy are placeholders pending state privacy review. State notice content is data owned by legal and product; none is invented here. The five counsel and product gates (TCPA approval, NV/AZ/TX notice content, retention/EXIF/geolocation finalization, referral monetization review, defensible-file copy review) remain open and are not engineering items.
