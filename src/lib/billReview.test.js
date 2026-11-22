import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingBillMatches } from './billReview.js';

test('review includes only yellow tracker months and skips paid or confirmed months', () => {
  const bills = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }, { id: 'c', name: 'Disabled', match_mode: 'off' }];
  const suggested = (id, bill, date) => ({ transaction_id: id, suggested_bill_id: bill, match_status: 'suggested', date });
  const transactions = [
    suggested('yes', 'a', '2026-11-05'),
    suggested('paid', 'b', '2026-10-05'),
    suggested('confirmed', 'b', '2026-11-05'),
    suggested('disabled', 'c', '2026-11-05'),
    suggested('old', 'a', '2025-11-05'),
    { matched_bill_id: 'b', match_status: 'approved', date: '2026-11-03' },
  ];
  const getMark = (bill, year, month) => bill === 'b' && year === 2026 && month === 10 ? { paid: true } : null;
  assert.deepEqual(pendingBillMatches(bills, transactions, getMark, 2026).map(({ tx }) => tx.transaction_id), ['yes']);
});
