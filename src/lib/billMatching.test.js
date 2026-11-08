import assert from 'node:assert/strict';
import test from 'node:test';
import { candidateBills, suggestBill, searchBills, validateAiMatches, accountBillCategory } from './billMatching.js';

const bills = [
  { id: 'clio', name: 'Clio', category: 'Business', amount: 330, bank_account_id: 'business' },
  { id: 'gas', name: 'Centerpoint gas', category: 'Household', amount: 36.5 },
  { id: 'adobe', name: 'Adobe', category: 'Business', amount: 22 },
  { id: 'old', name: 'Clio old', category: 'Business', amount: 330, archived: true },
];
const tx = { transaction_id: 'tx', account_id: 'business', merchant_name: 'Clio', name: 'CARD PAYMENT CLIO', amount: 343.45 };

test('Clio is immediately suggested even when its amount differs', () => {
  assert.equal(suggestBill(tx, bills).bill.id, 'clio');
  assert.equal(suggestBill({ ...tx, amount: 500 }, bills).bill.id, 'clio');
  assert.equal(suggestBill({ ...tx, merchant_name: 'Unrelated', name: 'Other merchant', amount: 330 }, bills), null);
});

test('suggestions honor category, account, disabled matching and rejected pairs', () => {
  assert.equal(suggestBill(tx, bills, { category: 'Household' }), null);
  assert.equal(suggestBill({ ...tx, account_id: 'other' }, bills), null);
  assert.equal(suggestBill(tx, bills, { feedback: [{ transaction_id: 'tx', bill_id: 'clio', decision: 'rejected' }] }), null);
  assert.equal(suggestBill(tx, [{ ...bills[0], match_mode: 'off' }]), null);
  assert.deepEqual(candidateBills(tx, bills, 'Business').map((b) => b.id), ['clio', 'adobe']);
});

test('account settings override category defaults and support all bills', () => {
  const mappings = [{ account_id: 'business', bill_category: 'Business' }];
  assert.equal(accountBillCategory({ account_id: 'business' }, mappings), 'Business');
  assert.equal(accountBillCategory({ account_id: 'business', bill_match_category: 'Household' }, mappings), 'Household');
  assert.equal(accountBillCategory({ account_id: 'business', bill_match_category: 'all' }, mappings), 'all');
});

test('typing filters names and keywords and chosen amount ordering remains numeric', () => {
  assert.deepEqual(searchBills(bills, 'cl', 'amount-desc').map((b) => b.id), ['clio']);
  assert.deepEqual(searchBills(bills, '', 'amount-asc').map((b) => b.id), ['adobe', 'gas', 'clio']);
  assert.deepEqual(searchBills(bills, '', 'alpha').map((b) => b.id), ['adobe', 'gas', 'clio']);
  assert.equal(searchBills([{ id: 'alias', name: 'Practice software', match_keywords: ['clio'] }], 'cli')[0].id, 'alias');
});

test('AI output cannot select unknown, cross-account or out-of-category bills', () => {
  const contexts = [{ transaction: tx, bills: candidateBills(tx, bills, 'Business') }];
  const matches = validateAiMatches([
    { transaction_id: 'tx', bill_id: 'gas', confidence: 0.99, reason: 'wrong category' },
    { transaction_id: 'unknown', bill_id: 'clio', confidence: 0.9 },
    { transaction_id: 'tx', bill_id: 'clio', confidence: 0.9, reason: 'Practice management subscription' },
  ], contexts);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].bill_id, 'clio');
  assert.equal(matches[0].category, 'Business');
  assert.deepEqual(validateAiMatches([{ transaction_id: 'tx', bill_id: 'clio', confidence: 0.1 }], contexts), []);
});
