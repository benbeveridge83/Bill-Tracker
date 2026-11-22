import test from 'node:test';
import assert from 'node:assert/strict';
import { trackerMonthAmount } from './trackerAmounts.js';

test('tracker month displays actual bank payments, including multiple charges', () => {
  const bank = [{ amount: 18.64, matched_bill_id: 'efax', match_status: 'approved' }];
  assert.equal(Math.round(trackerMonthAmount(bank, null, 17)), 19);
  assert.equal(Math.round(trackerMonthAmount([...bank, { amount: 3.2, matched_bill_id: 'efax', match_status: 'approved' }], null, 17)), 22);
  assert.equal(Math.round(trackerMonthAmount([], { paid: true, source: 'plaid', amount: 18.64 }, 17)), 19);
  assert.equal(Math.round(trackerMonthAmount([], { paid: true, source: 'manual' }, 17)), 17);
});
