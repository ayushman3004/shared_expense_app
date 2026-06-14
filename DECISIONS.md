# DECISIONS.md — Engineering Decision Log

Each entry below records a significant design or implementation decision, the alternatives considered, the trade-offs evaluated, and the rationale for the choice made.

---

## D1 — Relational Database: PostgreSQL via Prisma

**Decision:** Use PostgreSQL as the sole data store, accessed through Prisma ORM.

**Options considered:**
1. PostgreSQL + Prisma (chosen)
2. MySQL + Sequelize
3. SQLite (file-based)
4. MongoDB (document store)

**Trade-offs:**
- PostgreSQL has the strongest support for decimal arithmetic (critical for financial data — no floating-point rounding errors), JSON columns (for storing raw CSV rows verbatim), and row-level locking (needed for the import transaction).
- Prisma gives TypeScript-first type safety, migration-based schema versioning, and a clean query API. Sequelize is older and more verbose.
- SQLite is not suitable for concurrent access or production deployment.
- MongoDB was ruled out by the requirement ("Use relational DBs only").

**Why Prisma over raw SQL:** Every schema change is captured as a versioned migration file. The generated client catches type mismatches at compile time, preventing a class of runtime bugs.

---

## D2 — Authentication Strategy: JWT (Access + Refresh Token Rotation)

**Decision:** Stateless JWT access tokens (15-minute expiry) + server-stored refresh tokens (7-day expiry) with rotation on use.

**Options considered:**
1. JWT access + refresh with rotation (chosen)
2. Session-based auth (server-side sessions in PostgreSQL)
3. JWT only (no refresh token)

**Trade-offs:**
- JWT-only with long expiry is insecure — a stolen token cannot be revoked.
- Session-based auth requires a session store and session lookup on every request.
- Rotation: when a refresh token is used to get a new access token, the old refresh token is immediately deleted and a new one is issued. This means a stolen refresh token is detected on the attacker's next use (the legitimate user's rotation will have already invalidated it).

**Why not Google OAuth as primary:** OAuth requires configuring external credentials. JWT works out of the box for an evaluator who clones the repo. Google OAuth is included as an optional enhancement.

---

## D3 — Balance Calculation: Recompute on Every Request

**Decision:** Balances are computed on-the-fly from the Expense + Settlement records every time the balance endpoint is called. No cached balance columns.

**Options considered:**
1. Recompute on every request (chosen)
2. Cached balance columns updated on every expense mutation (materialised view pattern)
3. Periodic background recomputation

**Trade-offs:**
- **Recompute:** Always correct. If an expense is deleted or a membership date changes, the balance is instantly correct on the next call. Dataset is small (≤50 expenses, 6 people) — computation takes < 5ms.
- **Cached columns:** Fast reads, but require careful invalidation. A bug in invalidation logic leads to stale balances that are hard to debug. This defeats Rohan's "no magic numbers" requirement — cached numbers become disconnected from their source.
- **Periodic recomputation:** Adds staleness and complexity.

**Why recompute wins here:** Correctness over performance. For a flat of 6 people, latency is not a concern. The recompute approach makes it trivially easy to answer Rohan's question ("which expenses make up my ₹2,300?") because we compute it from the same source as the summary.

---

## D4 — Membership Timeline: `joinedAt` / `leftAt` on `GroupMember`

**Decision:** Each `GroupMember` row has a `joinedAt` timestamp and an optional `leftAt` timestamp. The balance calculator only includes a person's split in their balance if `expense.date >= member.joinedAt AND expense.date <= member.leftAt` (or `leftAt` is null).

**Options considered:**
1. Temporal membership columns on GroupMember (chosen)
2. Separate `MembershipPeriod` table (one row per period)
3. Soft-delete only (no date tracking)
4. Exclude former members entirely from balance queries

**Trade-offs:**
- A single `leftAt` column assumes one membership period. A `MembershipPeriod` table handles people who rejoin. In this dataset, no one rejoins, so the simpler model is sufficient and avoids premature complexity.
- Soft-delete only (isDeleted) cannot answer "did this person owe this expense?" for historical records.
- Excluding former members entirely would erase Meera's legitimate debts from February and March.

**Why this answers Sam's question:** Sam's `joinedAt` is 2026-04-08. The March electricity expense is dated 2026-03-18. Since 2026-03-18 < 2026-04-08, Sam's split for that expense (if he were ever included) would be filtered out by the membership window check.

---

## D5 — USD Handling: User-Confirmed Exchange Rate at Import Time

**Decision:** When the importer detects USD rows, the entire import session is paused (status = REVIEWING). The user is prompted to enter a USD→INR exchange rate. All USD amounts are converted at that single rate. The rate is stored on the `ImportSession` record.

**Options considered:**
1. User-provided rate at import time, stored per session (chosen)
2. Fetch live rate from an exchange-rate API (e.g. exchangeratesapi.io)
3. Use a hardcoded rate (e.g. ₹83 per dollar)
4. Store amounts in USD and convert at query time

**Trade-offs:**
- **Live API:** Fetches today's rate, not the rate on the date of the transaction. A March 2026 expense converted at today's rate produces a wrong historical figure.
- **Hardcoded rate:** Produces wrong numbers if the rate has moved significantly.
- **Convert at query time:** Means every balance query needs the rate. Storing it on the session ties it to the import event, which is the closest approximation to the historical rate.
- **User-provided rate:** The user can look up the historical rate for the trip dates (early March 2026) and enter it. This is the most accurate approach for historical data. The rate is stored so the import report can show it.

**Why user-provided wins:** Accuracy for historical data + transparency. The user takes responsibility for the rate they enter, which is documented in the import report.

---

## D6 — Negative Amounts: Held for Review (Not Auto-Imported as Refunds)

**Decision:** Negative amounts are flagged as `AMOUNT_NEGATIVE` and held for user review. The user decides whether it's a refund (import with negative amountInr) or a data entry error (reject).

**Options considered:**
1. Always hold for review (chosen)
2. Auto-import as a refund expense
3. Auto-reject all negative amounts

**Trade-offs:**
- Auto-import as refund: Reasonable for the parasailing refund (row 26 notes explain it). But "a crashed import and a silent guess are both failing answers." Auto-importing changes financials without user knowledge.
- Auto-reject: Loses legitimate refund data.
- Hold for review: User sees the row, sees the notes, and makes an informed decision.

**Precedent for this choice:** The assignment explicitly says "a silent guess is a failing answer." Negative amounts are rare enough that the UX cost of one extra click is negligible compared to the cost of wrong financials.

---

## D7 — Zero Amounts: Auto-Skipped

**Decision:** Zero-amount rows are automatically skipped (status = SKIPPED) without requiring user action.

**Rationale:** A zero-amount expense has zero financial impact by definition. Row 31 (`Dinner order Swiggy, ₹0`) has notes saying "counted twice earlier - fixing later." There is nothing to import. The row is logged in the import report with the reason.

**Why this is different from negative amounts:** Zero is mathematically certain to have no impact. Negative has an impact (it reduces a debt) and requires a judgement call.

---

## D8 — Duplicate Policy: Exact vs. Conflicting

**Decision:** Two anomaly codes for duplicates:
- `DUPLICATE_EXACT`: Same date + payer + amount + participants → user picks one to keep, one to reject.
- `DUPLICATE_CONFLICTING`: Similar description + same participants + different amounts → user reviews both and decides which (if either) to keep.

**Options considered:**
1. Two-code approach (chosen)
2. Single `DUPLICATE` code for all cases
3. Auto-reject the later row

**Trade-offs:**
- Single code loses the distinction between "clearly the same thing logged twice" vs. "possibly two separate events with similar descriptions."
- Auto-reject-later is a silent guess — the earlier row might be the wrong one (the Thalassa dinner notes say "I think hers [Aisha's row 24] is wrong" but it was logged first).
- Two codes give the user the right information to make the right decision.

---

## D9 — Split Types Supported

**Decision:** Four split types, matching all types in the CSV:
- `EQUAL` — total divided equally; rounding remainder goes to last participant
- `UNEQUAL` — each person's exact amount specified; must sum to total (±0.01 tolerance)
- `PERCENTAGE` — each person's percentage specified; must sum to 100% (±0.01%)
- `SHARE` — each person has a weight; share value = total / sum(weights)

**Rounding rule:** "Round half up" (standard banker's rounding avoided because it causes surprise). Rounding drift is absorbed by the last participant in the list.

**Why ±0.01 tolerance on sums:** Floating-point arithmetic in JavaScript means `0.1 + 0.2 ≠ 0.3`. A strict equality check would reject valid inputs. The tolerance is tight enough to catch genuine errors (e.g. 85% + 15% + 1% = 101%) while accepting floating-point noise.

---

## D10 — Settlement as Expense: Never Auto-Convert

**Decision:** When a row matches the settlement pattern (description contains "paid back", no split_type, single split_with entry, or notes flag it), the row is held and the user is given two options: (a) import as Settlement, or (b) reject. It is never imported as a shared Expense.

**Rationale:** A settlement incorrectly imported as an expense would:
1. Create an `ExpenseSplit` where the "recipient" owes money back to the payer — the opposite of what happened.
2. Double-count: the original debt + the repayment both appear as debts.

The financial consequence of getting this wrong is significant. This must be a user decision.

---

## D11 — Technology Stack Summary

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Backend language | TypeScript (Node.js) | Type safety, good ecosystem |
| Web framework | Express.js | Minimal, well-understood, no magic |
| ORM | Prisma | TypeScript-first, migration-based |
| Database | PostgreSQL | Decimal math, JSON columns, relational |
| Auth | JWT (bcrypt + jsonwebtoken) | Stateless, no external dependencies |
| CSV parsing | PapaParse | Handles quoted fields, edge cases |
| Validation | Zod | Runtime type checking with good errors |
| Frontend | React + Vite + TypeScript | Fast DX, standard choice |
| Styling | Vanilla CSS | Full control, no framework overhead |
| Font | Inter (Google Fonts) | Clean, modern, readable |

---

## D12 — Import Report

**Decision:** The import report is a structured JSON response from `GET /api/v1/import/:sessionId/report`, rendered as a human-readable page in the frontend. It includes:
- Total rows processed
- Rows imported, skipped, rejected, auto-fixed
- Per-row detail: status, anomalies, actions taken, resolutions
- USD exchange rate used

**Rationale:** The report answers the requirement "produced by your app when it ingests the CSV, listing every anomaly detected and the action taken." It is persisted in the database (ImportAnomaly records) so it can be recalled at any time, not just immediately after import.
