import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesTransactionFilters } from './transactionFilters.js';

const rows = [
  { id: 'bill', account_id: 'a', amount: 100, matched_bill_id: 'b', match_status: 'approved', classification_status: 'manual' },
  { id: 'suggestion', account_id: 'b', amount: 20, suggested_bill_id: 'b', match_status: 'suggested', classification_status: 'uncharacterized', is_check: true },
  { id: 'deposit', account_id: 'c', amount: -200, classification_status: 'bank', is_transfer: true },
  { id: 'expense', account_id: 'a', amount: 15, classification_status: 'uncharacterized' },
  { id: 'parking', account_id: 'a', amount: 17, non_recurring_bill: true, classification_status: 'uncharacterized' },
  { id: 'suspicious', account_id: 'a', amount: 42, possible_fraud: true, classification_status: 'uncharacterized' },
];
const ids = (filters) => rows.filter((row) => matchesTransactionFilters(row, filters)).map((row) => row.id);

test('account choices include one or multiple accounts, and empty means none', () => {
  assert.deepEqual(ids({ account: ['a'] }), ['bill', 'expense', 'parking', 'suspicious']);
  assert.deepEqual(ids({ account: ['a', 'c'] }), ['bill', 'deposit', 'expense', 'parking', 'suspicious']);
  assert.deepEqual(ids({ account: [] }), []);
  assert.deepEqual(ids({ account: 'all' }), ['bill', 'suggestion', 'deposit', 'expense', 'parking', 'suspicious']);
});

test('bill status choices combine with OR and other groups with AND', () => {
  assert.deepEqual(ids({ billState: ['confirmed', 'suggested'] }), ['bill', 'suggestion']);
  assert.deepEqual(ids({ billState: ['confirmed', 'not-bill'], classification: ['uncharacterized'] }), ['expense', 'suspicious']);
  assert.deepEqual(ids({ billState: [] }), []);
  assert.deepEqual(ids({ billState: ['non-recurring'], classification: ['uncharacterized'] }), ['parking']);
});

test('transfers and checks only appear when their type is selected', () => {
  assert.deepEqual(ids({ flow: ['out', 'checks'] }), ['bill', 'suggestion', 'expense', 'parking', 'suspicious']);
  assert.deepEqual(ids({ flow: ['in', 'checks'] }), ['suggestion']);
  assert.deepEqual(ids({ flow: ['transfers'] }), ['deposit']);
  assert.deepEqual(ids({ flow: ['out'] }), ['bill', 'expense', 'parking', 'suspicious']);
  assert.deepEqual(ids({ flow: ['in', 'out', 'checks'] }), ['bill', 'suggestion', 'expense', 'parking', 'suspicious']);
  assert.deepEqual(ids({ flow: [] }), []);
});

test('legacy single selections still work', () => {
  assert.deepEqual(ids({ account: 'a', flow: 'out', classification: 'uncharacterized' }), ['expense', 'parking', 'suspicious']);
});

test('possible fraud remains independently filterable before characterization', () => {
  assert.deepEqual(ids({ reviewFlag: ['possible-fraud'], classification: ['uncharacterized'] }), ['suspicious']);
  assert.deepEqual(ids({ reviewFlag: ['unflagged'], billState: ['non-recurring'] }), ['parking']);
});
