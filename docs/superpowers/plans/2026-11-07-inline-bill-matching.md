# Inline Bill Matching Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Search, suggest, and confirm bills below transaction rows, with remembered filters and authenticated OpenAI suggestions.

**Architecture:** Share candidate eligibility, local name matching, search, and AI-result validation between the browser and a new Supabase Edge Function. Keep account matching categories in the database and picker category/sort preferences in browser storage scoped to the signed-in user. Reuse one searchable picker in transaction rows and the existing link dialog.

**Tech Stack:** Existing React/Vite, Supabase, OpenAI Responses API with structured JSON output.

**Spec:** User requirements in this conversation: remembered Business/Household/all category and amount ascending/descending/alphabetical order; search while typing; immediate and AI suggestions below each transaction; account-specific matching category; retain full new-bill form; publish live.

## Global Constraints

- Never expose API keys, Plaid tokens, balances, or bank numbers to OpenAI or the browser bundle.
- A suggestion requires user confirmation before marking a bill paid.
- Preserve row hiding, existing transaction filters, full new-bill creation, and learned matching.
- Use existing account defaults as fallback; do not infer or rewrite the user's account assignments.

## Review Focus

- Category changes must invalidate stale guesses and prevent cross-category approvals.
- Search must preserve selected choices without approving text that was only typed.
- Rejected pairings, archived bills, and bills assigned to other accounts must not reappear as automatic suggestions.
- Missing API credentials or API failure must leave manual search usable.
- Storage failures, refreshes, and account switching must preserve safe defaults.

### Task 1: Candidate and search rules

- [ ] Write and run failing Node tests for exact Clio matching, categories/accounts, rejected guesses, search, sorting, and AI result validation.
- [ ] Implement pure helpers in `src/lib/billMatching.js`; verify tests.

### Task 2: Shared picker and transaction layout

- [ ] Add user-scoped remembered preferences and `BillPicker.jsx` with keyboard-accessible search results, category and sort controls.
- [ ] Replace Bill Match column with a full-width matching row; reuse picker in `LinkBillDialog` and retain Add a new bill.
- [ ] Exercise selection, typing, keyboard navigation, preferences, creation/link failure recovery, and old transaction controls with actual React components.

### Task 3: Account categories and OpenAI

- [ ] Add nullable checked `plaid_accounts.bill_match_category` with a column-level owner UPDATE grant and existing RLS.
- [ ] Add account category controls to Transactions and authenticated save callback.
- [ ] Add authenticated `suggest-bill-matches` Edge Function: server-owned candidates, bounded batches, structured Responses API, validated output, no automatic financial writes.
- [ ] Add batched/cached AI loading to transaction rows and dialog; test missing key, invalid output, rejection, and auth boundaries.

### Task 4: Verify and publish

- [ ] Run Node tests, changed-file lint, clean production build, and independent review.
- [ ] Apply and verify additive migration; deploy and verify Edge Function authentication/configuration.
- [ ] Merge reviewed changes and verify GitHub Pages deployment and live assets.
