# SCOPE.md — Anomaly Log & Database Schema

## Project Scope

Spreetail is a shared flat-expenses tracker for 6 people: **Aisha, Rohan, Priya, Meera, Dev, and Sam**.
Meera moved out on 2026-03-31; Sam moved in on 2026-04-08; Dev was a trip guest (2026-02-08 to 2026-03-14).

---

## Part 1 — CSV Anomaly Log

The import pipeline processes `expenses_export.csv` (43 data rows). Every anomaly is detected, surfaced to the user, and handled according to a documented policy. Anomalies that can be fixed deterministically are **auto-fixed** (logged for audit). Anomalies that require human judgement are **held for review**.

**Policy definitions:**
- `AUTO_FIXED` — Problem has a safe, deterministic fix. Applied automatically; reason logged.
- `HELD_FOR_REVIEW` — Problem requires user decision. Row is held; import blocked until resolved.
- `SKIPPED` — Row has no financial impact (e.g. zero amount). Skipped without user action needed.
- `REJECTED` — User explicitly chose not to import this row.

---

### Anomaly 1 — DUPLICATE_EXACT (Row 6)

**CSV Rows:** 5 and 6
```
Row 5: 2026-02-08, Dinner at Marina Bites, Dev, 3200, INR, equal, Aisha;Rohan;Priya;Dev
Row 6: 2026-02-08, dinner - marina bites,  Dev, 3200, INR, equal, Aisha;Rohan;Priya;Dev
```
**Problem:** Same date, same payer (Dev), same amount (₹3,200), same participants. Two different descriptions for what is clearly the same dinner.

**Policy:** HELD_FOR_REVIEW. Both rows flagged; user chooses which to keep or reject. We do not auto-delete because the user (Meera) requested approval of anything deleted.

---

### Anomaly 2 — AMOUNT_COMMA_FORMAT (Row 7)

**CSV Row:** 7
```
Row 7: 2026-02-10, Electricity Feb, Aisha, "1,200", INR, equal, ...
```
**Problem:** Amount `"1,200"` contains a thousands-separator comma inside quotes. PapaParse correctly unquotes it; we then detect the comma pattern and strip it.

**Policy:** AUTO_FIXED. Parsed as `1200`. Logged: `Removed thousands comma; parsed as 1200`.

---

### Anomaly 3 — AMOUNT_EXCESS_PRECISION (Row 10)

**CSV Row:** 10
```
Row 10: 2026-02-15, Cylinder refill, Rohan, 899.995, INR, equal, ...
```
**Problem:** Amount `899.995` has 3 decimal places. INR uses 2 decimal places (paise). The third decimal is a data entry artifact.

**Policy:** AUTO_FIXED. Rounded to `900.00` using standard "round half up". Logged.

---

### Anomaly 4 — PAYER_LOWERCASE (Row 9)

**CSV Row:** 9
```
Row 9: 2026-02-14, Movie night snacks, priya, 640, INR, equal, Aisha;Rohan;Priya
```
**Problem:** `paid_by` is `"priya"` (all lowercase). The canonical name is `"Priya"`.

**Policy:** AUTO_FIXED. Normalised to canonical name by case-insensitive lookup. Logged.

---

### Anomaly 5 — PAYER_UNKNOWN (Row 11)

**CSV Row:** 11
```
Row 11: 2026-02-18, Groceries DMart, Priya S, 1875, INR, equal, ...
```
**Problem:** `paid_by` is `"Priya S"`. No member named exactly "Priya S" exists. First-name match succeeds ("Priya"), but the trailing "S" is unexplained (initial? surname? typo?).

**Policy:** HELD_FOR_REVIEW. The first-name match is plausible but not certain. User must confirm whether this is Priya or someone else.

---

### Anomaly 6 — PAYER_MISSING (Row 13)

**CSV Row:** 13
```
Row 13: 2026-02-22, House cleaning supplies, , 780, INR, equal, ...
         Notes: can't remember who paid
```
**Problem:** `paid_by` field is completely blank. Notes confirm the payer is genuinely unknown.

**Policy:** HELD_FOR_REVIEW. Cannot create an expense without a payer. User must specify who paid or reject the row.

---

### Anomaly 7 — SETTLEMENT_AS_EXPENSE (Row 14)

**CSV Row:** 14
```
Row 14: 2026-02-25, Rohan paid Aisha back, Rohan, 5000, INR, , Aisha
         Notes: this is a settlement not an expense??
```
**Problem:** No `split_type`, only one person in `split_with`, description says "paid back", notes explicitly flag it as a settlement. This is a debt repayment, not a shared expense. Importing it as an expense would double-count: once as expense + once as settlement.

**Policy:** HELD_FOR_REVIEW. User shown two options: (a) import as Settlement record (reduces Rohan's debt to Aisha), or (b) reject the row. Not imported as an expense under any circumstance.

---

### Anomaly 8 — PERCENTAGE_INVALID_SUM (Row 15)

**CSV Row:** 15
```
Row 15: 2026-02-28, Pizza Friday, Aisha, 1440, INR, percentage
         split_details: "Aisha 30%; Rohan 30%; Priya 30%; Meera 20%"
         Notes: percentages might be off
```
**Problem:** 30 + 30 + 30 + 20 = **110%**. Percentages must sum to 100%. Notes confirm suspicion.

**Policy:** HELD_FOR_REVIEW. User must correct the percentages before this row can be committed. Cannot auto-fix because we cannot determine whose percentage is wrong (is it Meera's 20% or are all 30% really 25%?).

---

### Anomaly 9 — DATE_FORMAT_INCONSISTENT (Rows 16–27)

**Problem:** February rows use `YYYY-MM-DD` (ISO 8601). March rows switch to `DD/MM/YYYY` format (e.g. `01/03/2026`, `03/03/2026`).

**Policy:** AUTO_FIXED for unambiguous cases. Regex detects the format and normalises to ISO. When day > 12, the date can only be DD/MM/YYYY (e.g. `28/03/2026` — day 28 can't be month 28). Logged.

---

### Anomaly 10 — DATE_AMBIGUOUS (Row 34)

**CSV Row:** 34
```
Row 34: 04/05/2026, Deep cleaning service, Rohan, 2500, INR, equal, Aisha;Rohan;Priya
         Notes: is this April 5 or May 4? format is a mess
```
**Problem:** `04/05/2026` — both `04` ≤ 12 and `05` ≤ 12. Could be April 5th (DD/MM) or May 4th (MM/DD). Notes explicitly flag the ambiguity.

**Policy:** HELD_FOR_REVIEW. User must specify the correct date. Both interpretations are valid calendar dates.

---

### Anomaly 11 — DATE_NONSTANDARD (Row 27)

**CSV Row:** 27
```
Row 27: Mar 14, Airport cab, rohan , 1100, INR, equal, Aisha;Rohan;Priya;Dev
```
**Problem:** Date `"Mar 14"` is in a human-readable format, not a parseable date format. No year specified.

**Policy:** AUTO_FIXED. Parsed as `2026-03-14` (March 14, 2026 — consistent with surrounding Goa trip dates). Year inferred from context (all other dates in this CSV are 2026). Logged with inference rationale.

---

### Anomaly 12 — PAYER_TRAILING_SPACE (Row 27)

**CSV Row:** 27
```
Row 27: ..., rohan , 1100, ...  ← note the trailing space after "rohan"
```
**Problem:** `paid_by` is `"rohan "` — lowercase + trailing space.

**Policy:** AUTO_FIXED. Trimmed and case-normalised to `"Rohan"`. Combined with DATE_NONSTANDARD in the same row.

---

### Anomaly 13 — CURRENCY_USD (Rows 20, 21, 23, 26)

**CSV Rows:**
```
Row 20: Goa villa booking, Dev, 540, USD
Row 21: Beach shack lunch, Rohan, 84, USD
Row 23: Parasailing, Dev, 150, USD
Row 26: Parasailing refund, Dev, -30, USD
```
**Problem:** Amounts are in USD but the app's canonical currency is INR. The CSV treats a dollar as a rupee — as Priya flagged. An exchange rate must be applied.

**Policy:** HELD_FOR_REVIEW. Import wizard prompts user to enter the USD→INR exchange rate before committing. All USD rows are converted using that rate. Rate used is stored on the ImportSession for audit.

---

### Anomaly 14 — AMOUNT_NEGATIVE (Row 26)

**CSV Row:** 26
```
Row 26: 12/03/2026, Parasailing refund, Dev, -30, USD, equal, Aisha;Rohan;Priya;Dev
         Notes: one slot got cancelled
```
**Problem:** Amount is `-30` (negative). Notes explain it's a refund for a cancelled slot.

**Policy:** HELD_FOR_REVIEW. A negative amount could mean a refund (reduce everyone's share by ₹30 ÷ rate) or a data entry error. User decides: (a) import as a refund expense (negative amountInr reduces debts), or (b) reject. Cannot silently guess.

---

### Anomaly 15 — MEMBER_NOT_IN_GROUP (Row 23)

**CSV Row:** 23
```
Row 23: 11/03/2026, Parasailing, Dev, 150, USD, equal
         split_with: Aisha;Rohan;Priya;Dev;Dev's friend Kabir
```
**Problem:** `"Dev's friend Kabir"` is not a registered group member. Cannot create an ExpenseSplit for an unknown person.

**Policy:** HELD_FOR_REVIEW. User must either: (a) remove Kabir from split_with and adjust shares, or (b) add Kabir as a group member first, then re-import. Cannot auto-remove because that changes the financial calculation.

---

### Anomaly 16 — DUPLICATE_CONFLICTING (Rows 24 and 25)

**CSV Rows:**
```
Row 24: 11/03/2026, Dinner at Thalassa,  Aisha, 2400, INR, equal, Aisha;Rohan;Priya;Dev
Row 25: 11/03/2026, Thalassa dinner,     Rohan, 2450, INR, equal, Aisha;Rohan;Priya;Dev
         Notes: Aisha also logged this I think hers is wrong
```
**Problem:** Same date, same participants, similar descriptions ("Thalassa dinner" vs "Dinner at Thalassa"), but different payers and different amounts. Notes explicitly flag the conflict.

**Policy:** HELD_FOR_REVIEW. Both rows presented to user. User chooses: (a) keep Row 24 only, (b) keep Row 25 only, or (c) keep both (if they were genuinely separate events). Notes suggest Row 24 may be wrong.

---

### Anomaly 17 — CURRENCY_MISSING (Row 28)

**CSV Row:** 28
```
Row 28: 15/03/2026, Groceries DMart, Priya, 2105, , equal, Aisha;Rohan;Priya;Meera
         Notes: forgot to set currency
```
**Problem:** `currency` field is blank. Cannot determine if ₹2,105 or $2,105.

**Policy:** HELD_FOR_REVIEW. Context (it's groceries, other grocery rows are INR) suggests INR, but we cannot silently assume. User must specify the currency.

---

### Anomaly 18 — AMOUNT_SPACES (Row 29)

**CSV Row:** 29
```
Row 29: 18/03/2026, Electricity Mar, Aisha, " 1450 ", INR, equal, ...
```
**Problem:** Amount field contains leading and trailing spaces: `" 1450 "`.

**Policy:** AUTO_FIXED. Trimmed to `1450`. Logged.

---

### Anomaly 19 — AMOUNT_ZERO (Row 31)

**CSV Row:** 31
```
Row 31: 22/03/2026, Dinner order Swiggy, Priya, 0, INR, equal, ...
         Notes: counted twice earlier - fixing later
```
**Problem:** Amount is `0`. Zero-amount expenses have no financial impact. Notes confirm this is a placeholder / correction note, not a real expense.

**Policy:** SKIPPED automatically. No financial record created. Logged with reason.

---

### Anomaly 20 — MEMBERSHIP_VIOLATION (Row 36)

**CSV Row:** 36
```
Row 36: 2026-04-02, Groceries BigBasket, Priya, 2640, INR, equal
         split_with: Aisha;Rohan;Priya;Meera
         Notes: oops Meera still in the group list
```
**Problem:** Meera is in `split_with` for an expense dated 2026-04-02, but her membership ended 2026-03-31. Notes confirm the author noticed the mistake.

**Policy:** HELD_FOR_REVIEW. Meera cannot owe April expenses per Sam's requirement and general fairness. User must remove Meera from split_with and re-split among the 3 remaining members.

---

### Anomaly 21 — SETTLEMENT_AS_EXPENSE (Row 38)

**CSV Row:** 38
```
Row 38: 2026-04-08, Sam deposit share, Sam, 15000, INR, equal, Aisha
         Notes: Sam moving in! paid Aisha his deposit
```
**Problem:** Sam paying Aisha a deposit — this is a one-directional payment (like a settlement), not a shared expense to be split. `split_with` is just `Aisha`.

**Policy:** HELD_FOR_REVIEW. User chooses: (a) import as Settlement (Sam paid Aisha ₹15,000), or (b) reject. Not imported as a shared expense.

---

### Anomaly 22 — SPLIT_TYPE_CONFLICT (Row 42)

**CSV Row:** 42
```
Row 42: 2026-04-18, Furniture for common room, Aisha, 12000, INR, equal
         split_with: Aisha;Rohan;Priya;Sam
         split_details: "Aisha 1; Rohan 1; Priya 1; Sam 1"
         Notes: split_type says equal but someone added shares anyway
```
**Problem:** `split_type` is `"equal"`, but `split_details` contains share-style weights (1;1;1;1). Notes confirm the inconsistency. The final result is the same (all equal) but the data is contradictory.

**Policy:** HELD_FOR_REVIEW. User confirms intended split type. Equal-with-shares of 1 each is mathematically identical, but the conflict should be explicit. User approves the interpretation.

---

## Summary Table

| # | Row | Code | Default Action | Financial Impact |
|---|-----|------|---------------|-----------------|
| 1 | 6 | DUPLICATE_EXACT | HELD_FOR_REVIEW | Prevents double-counting |
| 2 | 7 | AMOUNT_COMMA_FORMAT | AUTO_FIXED | ₹1,200 parsed correctly |
| 3 | 10 | AMOUNT_EXCESS_PRECISION | AUTO_FIXED | ₹899.995 → ₹900.00 |
| 4 | 9 | PAYER_LOWERCASE | AUTO_FIXED | "priya" → "Priya" |
| 5 | 11 | PAYER_UNKNOWN | HELD_FOR_REVIEW | Cannot assign debt |
| 6 | 13 | PAYER_MISSING | HELD_FOR_REVIEW | Cannot assign debt |
| 7 | 14 | SETTLEMENT_AS_EXPENSE | HELD_FOR_REVIEW | Prevents double-count |
| 8 | 15 | PERCENTAGE_INVALID_SUM | HELD_FOR_REVIEW | 110% splits are wrong |
| 9 | 16–27 | DATE_FORMAT_INCONSISTENT | AUTO_FIXED | Correct date recorded |
| 10 | 34 | DATE_AMBIGUOUS | HELD_FOR_REVIEW | Month/day unknown |
| 11 | 27 | DATE_NONSTANDARD | AUTO_FIXED | "Mar 14" → 2026-03-14 |
| 12 | 27 | PAYER_TRAILING_SPACE | AUTO_FIXED | "rohan " → "Rohan" |
| 13 | 20,21,23,26 | CURRENCY_USD | HELD_FOR_REVIEW | Needs exchange rate |
| 14 | 26 | AMOUNT_NEGATIVE | HELD_FOR_REVIEW | Refund vs. error |
| 15 | 23 | MEMBER_NOT_IN_GROUP | HELD_FOR_REVIEW | Unknown participant |
| 16 | 24,25 | DUPLICATE_CONFLICTING | HELD_FOR_REVIEW | Two Thalassa entries |
| 17 | 28 | CURRENCY_MISSING | HELD_FOR_REVIEW | Currency unknown |
| 18 | 29 | AMOUNT_SPACES | AUTO_FIXED | " 1450 " → 1450 |
| 19 | 31 | AMOUNT_ZERO | SKIPPED | No financial impact |
| 20 | 36 | MEMBERSHIP_VIOLATION | HELD_FOR_REVIEW | Meera left Mar 31 |
| 21 | 38 | SETTLEMENT_AS_EXPENSE | HELD_FOR_REVIEW | Deposit ≠ expense |
| 22 | 42 | SPLIT_TYPE_CONFLICT | HELD_FOR_REVIEW | Contradictory fields |

---

## Part 2 — Database Schema

### Technology Choice
**PostgreSQL** via **Prisma ORM** (TypeScript-first, migration-based, relational).

### Entity Relationship Summary

```
User
  id, name, username (unique), email (unique), passwordHash?,
  emailVerified, isSeeded, isDeleted, authProvider, pfpUrl, createdAt

OtpToken                        RefreshToken
  userId → User                   userId → User
  token, expiresAt, used          token (unique), expiresAt

Group
  id, name, description, createdById → User, createdAt

GroupMember  [compound PK: groupId + userId]
  groupId → Group
  userId → User
  role: ADMIN | MEMBER
  joinedAt   ← membership start (expense date must be ≥ this)
  leftAt?    ← membership end (null = active; expense date must be ≤ this)

Expense
  id, groupId → Group, description
  amount (original), currency (INR/USD), exchangeRate?
  amountInr (canonical, used in all calculations)
  paidById → User, splitType: EQUAL|UNEQUAL|PERCENTAGE|SHARE
  date, notes, csvRowNumber?, createdById → User, createdAt, updatedAt

ExpenseSplit  [unique: expenseId + userId]
  expenseId → Expense (cascade delete)
  userId → User
  amountInr   ← this person's share in INR
  rawValue?   ← original value for audit ("30%" / "2" / "700" / "equal")

Settlement
  id, groupId → Group?
  fromUserId → User  ← person paying
  toUserId → User    ← person receiving
  amount, date, notes, csvRowNumber?, createdAt

ImportSession
  id, groupId → Group, filename, uploadedById → User
  usdToInr?  ← exchange rate confirmed by user during review
  status: PENDING | REVIEWING | COMPLETED | FAILED
  totalRows, importedRows, skippedRows, heldRows
  createdAt, completedAt?

ImportRow
  id, sessionId → ImportSession (cascade)
  rowNumber, rawData (JSON — untouched original)
  status: PENDING | IMPORTED | HELD | REJECTED | SKIPPED
  expenseId?, settlementId?

ImportAnomaly
  id, sessionId → ImportSession (cascade)
  rowId → ImportRow? (cascade)
  rowNumber (denormalised)
  code: AnomalyCode enum (22 values)
  description, action: AnomalyAction enum, resolution?, resolvedAt?
```

### Key Design Decisions

1. **Temporal membership** via `joinedAt`/`leftAt` on `GroupMember` answers Sam's question. The balance calculator filters each expense split against the participant's membership window at the expense's `date`.

2. **`amountInr` is canonical.** Original `amount` + `currency` + `exchangeRate` are stored for audit. All debt calculations use `amountInr` only.

3. **`rawValue` on `ExpenseSplit`** stores the original CSV value (`"30%"`, `"2"`, `"700"`) for Rohan's "no magic numbers" requirement — every split is traceable to its source.

4. **`csvRowNumber` on Expense/Settlement** links every imported record back to its source CSV row for the import report.

5. **Import pipeline is non-destructive** — `ImportRow.rawData` stores the original CSV row verbatim. Auto-fixes are applied to `CleanedRow` objects in memory; the DB stores both original and cleaned data.
