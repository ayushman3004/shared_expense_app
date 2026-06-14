# QUESTIONS.md — Interview & Alignment Log

This document tracks all the questions asked by the junior developer (AI) and the answers/decisions provided by the product manager/senior developer (User) before and during the development of the Spreetail app.

---

## Interview Questions & Decisions

### 1. Authentication & Users
- **Q1.1: How should user registration and seeding work?**
  - **Decision:** Pre-seed the 6 demo users (Aisha, Rohan, Priya, Meera, Dev, Sam). Implement login and signup modules to register new users.
- **Q1.2: Should self-registration (signup) be open to the public?**
  - **Decision:** Yes, self-registration is public, and every feature of the website is available to all users (creating groups, importing CSV files).
- **Q1.3: Is standard Email + Username + Password login sufficient, or do we need OAuth?**
  - **Decision:** Standard email + username + password and Google OAuth are both needed.

### 2. Group Management & Temporal Membership
- **Q2.1: How should group membership changes be handled in the UI?**
  - **Decision:** Managed through a Group Settings → Members screen, where admins can add members, record when they joined the group, and optionally record when they left.
- **Q2.2: Should the pre-seeded group have Meera's and Sam's dates automatically populated?**
  - **Decision:** Yes, for the pre-seeded demo group, these membership dates are automatically populated during database seeding. For future user-created groups, membership dates are entered manually.

### 3. Expenses & Splits
- **Q3.1: For custom splits, does the UI need to display inputs for each member?**
  - **Decision:** Yes, each user can set custom splits, and the UI will show a split matrix.
- **Q3.2: How strict should we be with rounding drift?**
  - **Decision:** Round all monetary values to 2 decimal places (paise). Ensure sum of shares exactly equals original expense amount. Any rounding drift is absorbed by the last participant in the calculated split list.
- **Q3.3: How do we handle Meera (moved out) and Sam (not yet moved in) on expense creation/editing?**
  - **Decision:** Backend checks expense date against each participant’s membership window (joinedAt and leftAt). Members who were not active on that date cannot be included in the split.

### 4. CSV Import Flow
- **Q4.1: How should the import session wizard work?**
  - **Decision:** Use a two-phase import with deferred commit:
    1. Upload CSV → Parse → Detect anomalies
    2. Persist the import session, raw rows, and anomalies in the DB
    3. Show an Import Review Dashboard
    4. User resolves all HELD_FOR_REVIEW anomalies
    5. Commit all approved rows atomically in a single database transaction.
- **Q4.2: For unknown payers or duplicates, what are the expected UI resolution elements?**
  - **Decision:** Anomaly-specific resolution UI. The dashboard will show the minimum information necessary to resolve the anomaly (e.g. dropdown to remap unknown payers, side-by-side comparison to keep/reject duplicates).
- **Q4.3: For currency conversions (USD), when does the user enter the exchange rate?**
  - **Decision:** Prompt the user for the exchange rate only when USD rows are detected.
- **Q4.4: How does name mapping work in general?**
  - **Decision:** Name resolution happens in tiers (e.g. exact match, case-insensitive match, trimmed match, first name match, otherwise flag as PAYER_UNKNOWN).

### 5. Balances & Settlements
- **Q5.1: How should balances be displayed?**
  - **Decision:** Show simplified settlements (who pays whom, how much) + detailed expense breakdowns (no magic numbers).
- **Q5.2: For settlements, can a user record a settlement directly?**
  - **Decision:** Yes, allow manual settlements; they immediately reduce outstanding balances.

### 6. Development & Environment Setup
- **Q6.1: What connection string should we use?**
  - **Decision:** Use Neon connection string in `.env` for local, and environment variables for production.
- **Q6.2: How to run the project locally?**
  - **Decision:** Use a single `npm run dev` command in the root folder with `concurrently` to launch Vite and Express.
- **Q6.3: Folder structure and libraries?**
  - **Decision:** Proceed with the structure outlined in the implementation plan.
