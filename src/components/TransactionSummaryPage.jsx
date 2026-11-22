import React, { useEffect, useMemo, useState } from 'react';
import { fmtMoney } from '../lib/dates';
import { inMonth, isConfirmedBillTransaction, isMoneyIn, transactionName } from '../lib/bank';
import { transactionSummary } from '../lib/transactionSummary';
import { visibleSpendingCategories } from '../lib/spendingCategories';
import { supabase } from '../lib/supabaseClient';
import { SectionTitle } from './ui';
import TransactionBillMatch from './TransactionBillMatch';
import ExpenseTypePicker, { ExpenseTypeDialog } from './ExpenseTypePicker';

export default function TransactionSummaryPage({ month, setMonth, transactions, accounts, bills, userId, mappings, matchRules, matchFeedback, billPickerPreferences, onBillPickerPreferences, aiSuggestions, onMatchAction, onLink, onClassify, onApplyExpenseType, onNonRecurringBill, onOpenTransactions }) {
  const [period, setPeriod] = useState('month');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [mode, setMode] = useState('bill');
  const [expenseTypes, setExpenseTypes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [hiddenCategories, setHiddenCategories] = useState([]);
  const [addingExpenseFor, setAddingExpenseFor] = useState(null);
  const [error, setError] = useState('');
  const billsById = useMemo(() => Object.fromEntries(bills.map((bill) => [bill.id, bill])), [bills]);
  const accountsById = useMemo(() => Object.fromEntries(accounts.map((account) => [account.account_id, account])), [accounts]);
  const activeAccountIds = new Set(accounts.filter((account) => !account.is_hidden && !account.connection_inactive).map((account) => account.account_id));
  const expenseTypesById = useMemo(() => Object.fromEntries(expenseTypes.map((item) => [item.id, item])), [expenseTypes]);

  useEffect(() => {
    let active = true;
    Promise.all([
      supabase.from('non_recurring_expense_types').select('*').order('name'),
      supabase.from('spending_categories').select('name').order('name'),
      supabase.from('hidden_spending_categories').select('category_name'),
    ]).then(([expenses, saved, hidden]) => {
      if (!active) return;
      if (!expenses.error) setExpenseTypes(expenses.data || []);
      if (!saved.error) setCategories(saved.data || []);
      if (!hidden.error) setHiddenCategories(hidden.data || []);
    });
    return () => { active = false; };
  }, []);

  const rows = transactions.filter((tx) => activeAccountIds.has(tx.account_id) && (period === 'all' || inMonth(tx.date, month)))
    .filter((tx) => {
      const summary = transactionSummary(tx, billsById, expenseTypesById);
      return filter === 'all' || (filter === 'uncategorized' ? !summary.categorized : summary.categorized);
    })
    .filter((tx) => !search.trim() || `${transactionName(tx)} ${tx.spending_category || ''} ${billsById[tx.matched_bill_id]?.name || ''} ${expenseTypesById[tx.expense_type_id]?.name || ''}`.toLowerCase().includes(search.toLowerCase().trim()))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || transactionName(a).localeCompare(transactionName(b)));

  function toggle(tx) {
    if (expanded === tx.transaction_id) { setExpanded(null); return; }
    setExpanded(tx.transaction_id);
    setMode(tx.non_recurring_bill || (!tx.suggested_bill_id && !tx.matched_bill_id && tx.spending_category) ? 'expense' : 'bill');
  }

  async function addExpenseType(tx, form) {
    if (!userId) throw new Error('Sign in to save an expense.');
    const { data, error: saveError } = await supabase.from('non_recurring_expense_types')
      .upsert({ user_id: userId, ...form }, { onConflict: 'user_id,name' }).select('*').single();
    if (saveError) throw saveError;
    await onApplyExpenseType(tx, data);
    setExpenseTypes((previous) => [...previous.filter((item) => item.id !== data.id && item.name !== data.name), data]);
  }

  return <section className="card">
    <SectionTitle>Transaction summary</SectionTitle>
    <div className="pad">
      <div className="toolbar transactionSummaryControls">
        <select aria-label="Date range" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="month">Selected month</option><option value="all">All dates</option></select>
        {period === 'month' && <input aria-label="Transaction month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />}
        <select aria-label="Categorization filter" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All transactions</option><option value="uncategorized">Needs categorization</option><option value="categorized">Categorized</option></select>
        <input aria-label="Search transactions" type="search" placeholder="Search transactions" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      <p className="help">{rows.length} transaction{rows.length === 1 ? '' : 's'} · Click a row to view or change its category.</p>
      {error && <p className="errorMessage" role="alert">{error}</p>}
      <div className="tableScroll"><table className="compact transactionSummaryTable">
        <thead><tr><th>Date</th><th>Transaction</th><th>Amount</th><th>Type</th><th>Bill / expense</th><th>Category</th></tr></thead>
        <tbody>{rows.map((tx) => {
          const summary = transactionSummary(tx, billsById, expenseTypesById);
          const isOpen = expanded === tx.transaction_id;
          return <React.Fragment key={tx.transaction_id}>
            <tr className={`transactionSummaryRow ${summary.categorized ? '' : 'summaryNeedsCategory'}`} onClick={() => toggle(tx)}>
              <td>{tx.date}</td>
              <td><button className="transactionMerchantButton" aria-expanded={isOpen} aria-controls={isOpen ? `summary-detail-${tx.transaction_id}` : undefined} onClick={(event) => { event.stopPropagation(); toggle(tx); }}>{isOpen ? '▾' : '▸'} {transactionName(tx)}</button>{tx.pending && <span className="pendingText"> pending</span>}</td>
              <td className={`mono amountCell ${isMoneyIn(tx) ? 'moneyIn' : 'moneyOut'}`}>{isMoneyIn(tx) ? '+' : '-'}{fmtMoney(Math.abs(Number(tx.amount) || 0))}</td>
              <td>{summary.type}</td><td>{summary.name}</td><td>{summary.category}</td>
            </tr>
            {isOpen && <tr className="transactionMatchRow" id={`summary-detail-${tx.transaction_id}`}><td colSpan={6}>
              <div className="toolbar transactionDetailTabs">
                {!tx.non_recurring_bill && <button className={mode === 'bill' ? 'brand mini' : 'ghost mini'} onClick={() => setMode('bill')}>Bill / recurring</button>}
                {!isConfirmedBillTransaction(tx) && <button className={mode === 'expense' ? 'brand mini' : 'ghost mini'} onClick={() => setMode('expense')}>Non-recurring</button>}
                <button className="ghost mini" onClick={() => onClassify(tx)}>Edit category</button>
                {tx.non_recurring_bill && <button className="ghost mini" onClick={() => { onNonRecurringBill(tx, false); setMode('bill'); }}>Allow bill matching</button>}
              </div>
              {mode === 'bill' && !tx.non_recurring_bill && (tx.possible_fraud && !isConfirmedBillTransaction(tx) ? <div className="inlineBillMatch help">Clear the fraud flag on the detailed Transactions page before linking a bill.</div> : <TransactionBillMatch transaction={tx} bills={bills} account={accountsById[tx.account_id]} mappings={mappings} rules={matchRules} feedback={matchFeedback} preferences={billPickerPreferences} onPreferences={onBillPickerPreferences} aiMatch={aiSuggestions.matches[tx.transaction_id]} onMatchAction={onMatchAction} onLink={onLink} />)}
              {mode === 'expense' && !isConfirmedBillTransaction(tx) && <ExpenseTypePicker transaction={tx} types={expenseTypes} onApply={onApplyExpenseType} onAdd={setAddingExpenseFor} />}
            </td></tr>}
          </React.Fragment>;
        })}
        {!rows.length && <tr><td colSpan={6} className="emptyState">No transactions match these filters.</td></tr>}
        </tbody>
      </table></div>
      {addingExpenseFor && <ExpenseTypeDialog transaction={addingExpenseFor} types={expenseTypes} categories={visibleSpendingCategories(categories, hiddenCategories)} onManageCategories={() => { setAddingExpenseFor(null); onOpenTransactions(); }} onSave={async (tx, form) => { try { await addExpenseType(tx, form); setError(''); } catch (cause) { setError(cause.message); throw cause; } }} onClose={() => setAddingExpenseFor(null)} />}
    </div>
  </section>;
}
