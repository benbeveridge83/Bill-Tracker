import { isConfirmedBillTransaction, isSuggestedBillTransaction } from './bank.js';

export function pendingBillMatches(bills, transactions, getMark, year) {
  const billById = new Map(bills.filter((bill) => bill.match_mode !== 'off').map((bill) => [bill.id, bill]));
  const confirmedMonths = new Set(transactions.filter(isConfirmedBillTransaction).map((tx) => `${tx.matched_bill_id}:${String(tx.date).slice(0, 7)}`));
  return transactions.flatMap((tx) => {
    if (!isSuggestedBillTransaction(tx)) return [];
    const bill = billById.get(tx.suggested_bill_id);
    const date = String(tx.date || '');
    const month = Number(date.slice(5, 7));
    if (!bill || Number(date.slice(0, 4)) !== year || month < 1 || month > 12) return [];
    if (getMark(bill.id, year, month)?.paid || confirmedMonths.has(`${bill.id}:${date.slice(0, 7)}`)) return [];
    return [{ bill, tx, year, month }];
  }).sort((left, right) => right.tx.date.localeCompare(left.tx.date) || left.bill.name.localeCompare(right.bill.name));
}
