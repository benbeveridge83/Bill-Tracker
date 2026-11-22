import { isConfirmedBillTransaction, isMoneyIn, isSuggestedBillTransaction } from './bank.js';

export function transactionSummary(tx, billsById, expenseTypesById) {
  const bill = billsById[tx.matched_bill_id];
  const suggestedBill = billsById[tx.suggested_bill_id];
  const expense = expenseTypesById[tx.expense_type_id];
  if (isConfirmedBillTransaction(tx)) return { type: 'Bill / recurring', name: bill?.name || 'Bill no longer listed', category: bill?.subcategory || bill?.category || '—', categorized: true };
  if (isSuggestedBillTransaction(tx)) return { type: 'Suggested bill', name: suggestedBill?.name || 'Bill no longer listed', category: 'Confirm match', categorized: false };
  const categorized = Boolean(expense || tx.spending_category);
  return {
    type: tx.is_transfer ? 'Transfer' : isMoneyIn(tx) ? 'Money in' : categorized || tx.non_recurring_bill ? 'Non-recurring' : 'Uncategorized',
    name: expense?.name || (categorized ? '—' : 'Needs category'),
    category: expense?.category || tx.spending_category || '—',
    categorized,
  };
}
