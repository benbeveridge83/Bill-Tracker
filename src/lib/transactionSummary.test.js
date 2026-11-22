import test from 'node:test';
import assert from 'node:assert/strict';
import { transactionSummary } from './transactionSummary.js';

test('transaction summary distinguishes confirmed bills, saved expenses and uncategorized charges', () => {
  const bills = { bill: { name: 'Internet', category: 'Household', subcategory: 'Utilities' } };
  const expenses = { groceries: { name: 'Weekly groceries', category: 'Groceries' } };
  assert.deepEqual(transactionSummary({ matched_bill_id: 'bill', match_status: 'approved' }, bills, expenses),
    { type: 'Bill / recurring', name: 'Internet', category: 'Utilities', categorized: true });
  assert.deepEqual(transactionSummary({ non_recurring_bill: true, expense_type_id: 'groceries' }, bills, expenses),
    { type: 'Non-recurring', name: 'Weekly groceries', category: 'Groceries', categorized: true });
  assert.equal(transactionSummary({ amount: 15 }, bills, expenses).categorized, false);
  assert.equal(transactionSummary({ suggested_bill_id: 'bill', match_status: 'suggested' }, bills, expenses).type, 'Suggested bill');
});
