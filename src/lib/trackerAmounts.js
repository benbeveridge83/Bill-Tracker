import { isConfirmedBillTransaction } from './bank.js';

export function trackerMonthAmount(transactions, mark, expectedAmount) {
  const confirmed = transactions.filter(isConfirmedBillTransaction);
  if (confirmed.length) return confirmed.reduce((sum, tx) => sum + Math.abs(Number(tx.amount) || 0), 0);
  if (mark?.paid && mark.source === 'plaid' && mark.amount != null) return Number(mark.amount);
  return expectedAmount;
}
