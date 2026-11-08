import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesTransactionFilters } from './transactionFilters.js';

const rows = [
  { id: 'bill', account_id: 'a', amount: 100, matched_bill_id: 'b', match_status: 'approved', classification_status: 'manual' },
  { id: 'suggestion', account_id: 'b', amount: 20, suggested_bill_id: 'b', match_status: 'suggested', classification_status: 'uncharacterized', is_check: true },
  { id: 'deposit', account_id: 'c', amount: -200, classification_status: 'bank', is_transfer: true },
  { id: 'expense', account_id: 'a', amount: 15, classification_status: 'uncharacterized' },
];
const ids = (filters) => rows.filter((row) => matchesTransactionFilters(row, filters)).map((row) => row.id);

test('account choices include one or multiple accounts, and empty means none', () => {
  assert.deepEqual(ids({ account: ['a'] }), ['bill', 'expense']);
  assert.deepEqual(ids({ account: ['a', 'c'] }), ['bill', 'deposit', 'expense']);
  assert.deepEqual(ids({ account: [] }), []);
  assert.deepEqual(ids({ account: 'all' }), ['bill', 'suggestion', 'deposit', 'expense']);
});

test('bill status choices combine with OR and other groups with AND', () => {
  assert.deepEqual(ids({ billState: ['confirmed', 'suggested'] }), ['bill', 'suggestion']);
  assert.deepEqual(ids({ billState: ['confirmed', 'not-bill'], classification: ['uncharacterized'] }), ['expense']);
  assert.deepEqual(ids({ billState: [] }), []);
});

test('overlapping flow choices do not duplicate transactions', () => {
  assert.deepEqual(ids({ flow: ['out', 'checks'] }), ['bill', 'suggestion', 'expense']);
  assert.deepEqual(ids({ flow: ['in', 'checks'] }), ['suggestion', 'deposit']);
  assert.deepEqual(ids({ flow: [] }), []);
});

test('legacy single selections still work', () => {
  assert.deepEqual(ids({ account: 'a', flow: 'out', classification: 'uncharacterized' }), ['expense']);
});
