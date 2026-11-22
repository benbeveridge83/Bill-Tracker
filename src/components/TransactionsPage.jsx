import React, { useEffect, useMemo, useState } from 'react';
import { fmtMoney } from '../lib/dates';
import {
  accountLabel,
  humanizeFinanceCategory,
  inMonth,
  isConfirmedBillTransaction,
  isMoneyIn,
  isSuggestedBillTransaction,
  transactionName,
  DEFAULT_SPENDING_CATEGORIES,
} from '../lib/bank';
import { visibleSpendingCategories } from '../lib/spendingCategories';
import { supabase } from '../lib/supabaseClient';
import { SectionTitle } from './ui';
import CheckboxFilter from './CheckboxFilter';
import { matchesTransactionFilters } from '../lib/transactionFilters';
import { accountBillCategory } from '../lib/billMatching';
import TransactionBillMatch from './TransactionBillMatch';
import ExpenseTypePicker, { ExpenseTypeDialog } from './ExpenseTypePicker';

function normalizeMerchant(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export default function TransactionsPage({
  month,
  setMonth,
  transactions,
  accounts,
  bills,
  filters,
  setFilters,
  matching,
  matchStatus,
  onMatchMonth,
  onClassify,
  onNonRecurringBill,
  onFlagPossibleFraud,
  onLink,
  onMatchAction,
  mappings = [],
  matchRules = [],
  matchFeedback = [],
  billPickerPreferences,
  onBillPickerPreferences,
  aiSuggestions,
  onAccountBillCategory,
  onApplyExpenseType,
  onReviewTransactions,
  onRefresh,
  unreviewedCount,
  reviewOpen,
  setReviewOpen,
}) {
  const [billView, setBillView] = useState(true);
  const [sortOrder, setSortOrder] = useState('date-desc');
  const [hiddenTransactions, setHiddenTransactions] = useState(new Set());
  const [selectedTransactionIds, setSelectedTransactionIds] = useState(new Set());
  const [bulkAction, setBulkAction] = useState('');
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkSubcategory, setBulkSubcategory] = useState('');
  const [bulkBillId, setBulkBillId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [categories, setCategories] = useState([]);
  const [hiddenCategories, setHiddenCategories] = useState([]);
  const [rules, setRules] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [showManager, setShowManager] = useState(false);
  const [showSubscriptions, setShowSubscriptions] = useState(false);
  const [showFraud, setShowFraud] = useState(false);
  const [managerStatus, setManagerStatus] = useState('');
  const [expenseTypes, setExpenseTypes] = useState([]);
  const [addingExpenseFor, setAddingExpenseFor] = useState(null);
  const [openDetail, setOpenDetail] = useState(null);
  const [selectedReviewIds, setSelectedReviewIds] = useState(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const shownAccounts = accounts.filter((account) => !account.is_hidden && !account.connection_inactive);

  const accountsById = useMemo(
    () => Object.fromEntries(shownAccounts.map((account) => [account.account_id, account])),
    [shownAccounts],
  );
  const allAccountsById = useMemo(
    () => Object.fromEntries(accounts.map((account) => [account.account_id, account])),
    [accounts],
  );
  const billsById = useMemo(
    () => Object.fromEntries(bills.map((bill) => [bill.id, bill])),
    [bills],
  );
  const openSubscriptionKeys = useMemo(
    () => new Set(subscriptions.filter((item) => item.status === 'open').map((item) => item.merchant_key)),
    [subscriptions],
  );

  async function loadRulesAndCategories() {
    const [categoryResult, ruleResult, subscriptionResult, expenseResult, hiddenResult] = await Promise.all([
      supabase.from('spending_categories').select('*').order('name'),
      supabase.from('transaction_classification_rules').select('*').eq('active', true).order('merchant_pattern'),
      supabase.from('subscription_cancellations').select('*').order('status').order('updated_at', { ascending: false }),
      supabase.from('non_recurring_expense_types').select('*').order('name'),
      supabase.from('hidden_spending_categories').select('category_name'),
    ]);
    if (!categoryResult.error) setCategories(categoryResult.data || []);
    if (!ruleResult.error) setRules(ruleResult.data || []);
    if (!subscriptionResult.error) setSubscriptions(subscriptionResult.data || []);
    if (!expenseResult.error) setExpenseTypes(expenseResult.data || []);
    if (!hiddenResult.error) setHiddenCategories(hiddenResult.data || []);
  }

  async function addExpenseType(transaction, form) {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!userData.user) throw new Error('Sign in to save an expense.');
    const { data, error } = await supabase.from('non_recurring_expense_types')
      .upsert({ user_id: userData.user.id, ...form }, { onConflict: 'user_id,name' }).select('*').single();
    if (error) throw error;
    await onApplyExpenseType(transaction, data);
    await loadRulesAndCategories();
  }

  useEffect(() => {
    loadRulesAndCategories();
  }, []);

  const monthTransactions = transactions
    .filter((tx) => inMonth(tx.date, month))
    .filter((tx) => Boolean(accountsById[tx.account_id]))
    .filter((tx) => matchesTransactionFilters(tx, filters))
    .filter((tx) => !hiddenTransactions.has(tx.transaction_id))
    .filter((tx) => {
      const needle = String(filters.search || '').trim().toLowerCase();
      if (!needle) return true;
      return [transactionName(tx), tx.name, tx.spending_category, tx.spending_subcategory]
        .filter(Boolean).join(' ').toLowerCase().includes(needle);
    })
    .sort((a, b) => {
      const amountDifference = Math.abs(Number(a.amount) || 0) - Math.abs(Number(b.amount) || 0);
      if (sortOrder === 'amount-asc' && amountDifference) return amountDifference;
      if (sortOrder === 'amount-desc' && amountDifference) return -amountDifference;
      return String(b.date).localeCompare(String(a.date));
    });
  const selectedTransactions = monthTransactions.filter((tx) => selectedTransactionIds.has(tx.transaction_id));
  const selectedCount = selectedTransactions.length;

  function toggleTransactionSelection(id) {
    setSelectedTransactionIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function applyBulkAction() {
    if (!bulkAction || !selectedCount || bulkBusy) return;
    if (bulkAction === 'hide') {
      setHiddenTransactions((previous) => new Set([...previous, ...selectedTransactions.map((tx) => tx.transaction_id)]));
      setSelectedTransactionIds(new Set());
      setBulkStatus(`Hid ${selectedCount} transaction(s). Use Show all to restore them.`);
      return;
    }
    const eligible = selectedTransactions.filter((tx) => {
      if (bulkAction === 'expense' || bulkAction === 'remove-expense') return !tx.matched_bill_id && Number(tx.amount) > 0 && (bulkAction === 'expense' ? !tx.non_recurring_bill : Boolean(tx.non_recurring_bill));
      if (bulkAction === 'cancel') return Number(tx.amount) > 0;
      if (bulkAction === 'rule') return Boolean(tx.spending_category);
      if (bulkAction === 'link') return !isConfirmedBillTransaction(tx) && !isSuggestedBillTransaction(tx) && !tx.non_recurring_bill && !tx.possible_fraud;
      return true;
    });
    if (!eligible.length) { setBulkStatus('None of the selected transactions qualify for this action.'); return; }
    if (bulkAction === 'classify' && !bulkCategory.trim()) { setBulkStatus('Enter a bookkeeping category first.'); return; }
    if (bulkAction === 'link' && !bulkBillId) { setBulkStatus('Choose a bill first.'); return; }
    if ((bulkAction === 'link' || bulkAction === 'rule') && !window.confirm(`Apply ${bulkAction === 'link' ? 'this bill' : 'a separate merchant rule'} to ${eligible.length} transaction(s)?`)) return;
    setBulkBusy(true);
    setBulkStatus('Applying selected action…');
    let completed = 0;
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const userId = userData.user?.id;
      if (!userId) throw new Error('Sign in to change transactions.');
      if (['expense', 'remove-expense', 'fraud', 'clear-fraud', 'classify'].includes(bulkAction)) {
        const values = bulkAction === 'expense' ? { non_recurring_bill: true }
          : bulkAction === 'remove-expense' ? { non_recurring_bill: false, expense_type_id: null }
          : bulkAction === 'fraud' ? { possible_fraud: true }
          : bulkAction === 'clear-fraud' ? { possible_fraud: false }
          : { spending_category: bulkCategory.trim(), spending_subcategory: bulkSubcategory.trim() || null, classification_status: 'manual', classified_at: new Date().toISOString() };
        for (let index = 0; index < eligible.length; index += 100) {
          const { error } = await supabase.from('plaid_transactions').update(values).eq('user_id', userId).in('transaction_id', eligible.slice(index, index + 100).map((tx) => tx.transaction_id));
          if (error) throw error;
          completed += Math.min(100, eligible.length - index);
        }
      } else {
        const seen = new Set();
        for (const tx of eligible) {
          const merchant = tx.merchant_name || tx.name || transactionName(tx);
          const merchantKey = normalizeMerchant(merchant);
          if (bulkAction === 'link') {
            const { error } = await supabase.functions.invoke('bill-match-action', { body: { action: 'approve', transaction_id: tx.transaction_id, bill_id: bulkBillId } });
            if (error) throw error;
          } else if (merchantKey && !seen.has(merchantKey)) {
            seen.add(merchantKey);
            const table = bulkAction === 'cancel' ? 'subscription_cancellations' : 'transaction_classification_rules';
            const row = bulkAction === 'cancel'
              ? { user_id: userId, merchant_key: merchantKey, merchant_name: merchant, source_transaction_id: tx.transaction_id, latest_transaction_date: tx.date, latest_amount: Math.abs(Number(tx.amount) || 0), spending_category: tx.spending_category || null, status: 'open', cancelled_at: null, updated_at: new Date().toISOString() }
              : { user_id: userId, merchant_pattern: merchant, normalized_pattern: merchantKey, spending_category: tx.spending_category, spending_subcategory: tx.spending_subcategory || null, excluded_from_spending: Boolean(tx.excluded_from_spending), active: true, updated_at: new Date().toISOString() };
            const { error } = await supabase.from(table).upsert(row, { onConflict: bulkAction === 'cancel' ? 'user_id,merchant_key' : 'user_id,normalized_pattern' });
            if (error) throw error;
          }
          completed++;
        }
        await loadRulesAndCategories();
      }
      setBulkStatus(`Updated ${completed} transaction(s).${selectedCount > eligible.length ? ` ${selectedCount - eligible.length} did not qualify.` : ''}`);
      setSelectedTransactionIds(new Set());
      await onRefresh();
    } catch (error) {
      setBulkStatus(`Updated ${completed} transaction(s) before an error: ${error.message}`);
      if (completed) await onRefresh();
    } finally { setBulkBusy(false); }
  }

  function recognizedFor(accountId) {
    return transactions
      .filter((tx) => tx.account_id === accountId && inMonth(tx.date, month) && isConfirmedBillTransaction(tx))
      .reduce((sum, tx) => sum + Math.abs(Number(tx.amount) || 0), 0);
  }

  async function addCategory() {
    const name = window.prompt('New spending category name:');
    if (!name?.trim()) return;
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;
    const { error } = await supabase.from('spending_categories').upsert({
      user_id: userId,
      name: name.trim(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,name' });
    if (error) setManagerStatus(error.message);
    else {
      setManagerStatus(`Added category “${name.trim()}”.`);
      await loadRulesAndCategories();
    }
  }

  async function togglePresetCategory(name) {
    const hidden = hiddenCategories.some((item) => item.category_name === name);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) { setManagerStatus(userError?.message || 'Sign in to edit categories.'); return; }
    const query = supabase.from('hidden_spending_categories');
    const { error } = hidden
      ? await query.delete().eq('user_id', userData.user.id).eq('category_name', name)
      : await query.insert({ user_id: userData.user.id, category_name: name });
    if (error) { setManagerStatus(error.message); return; }
    setHiddenCategories((previous) => hidden ? previous.filter((item) => item.category_name !== name) : [...previous, { category_name: name }]);
    setManagerStatus(`${hidden ? 'Restored' : 'Hidden'} “${name}” in category choices. Existing transactions keep their labels.`);
  }

  function openCategoryManager() {
    setAddingExpenseFor(null);
    setShowManager(true);
    window.requestAnimationFrame(() => document.getElementById('category-manager')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function editCategory(category) {
    const name = window.prompt('Rename category:', category.name);
    if (!name?.trim() || name.trim() === category.name) return;
    const oldName = category.name;
    const newName = name.trim();
    const { error } = await supabase.from('spending_categories')
      .update({ name: newName, updated_at: new Date().toISOString() })
      .eq('id', category.id);
    if (error) {
      setManagerStatus(error.message);
      return;
    }
    const results = await Promise.all([
      supabase.from('plaid_transactions').update({ spending_category: newName }).eq('spending_category', oldName),
      supabase.from('transaction_classification_rules').update({ spending_category: newName, updated_at: new Date().toISOString() }).eq('spending_category', oldName),
      supabase.from('subscription_cancellations').update({ spending_category: newName, updated_at: new Date().toISOString() }).eq('spending_category', oldName),
      supabase.from('non_recurring_expense_types').update({ category: newName }).eq('category', oldName),
    ]);
    const failed = results.find((result) => result.error);
    setManagerStatus(failed ? `Category renamed, but some existing records could not be updated: ${failed.error.message}` : `Renamed “${oldName}” to “${newName}”.`);
    await loadRulesAndCategories();
  }

  async function deleteCategory(category) {
    if (!window.confirm(`Delete category “${category.name}”? Existing transactions and saved expenses will keep their current text, but rules using this category will be removed.`)) return;
    const { error } = await supabase.from('spending_categories').delete().eq('id', category.id);
    if (error) {
      setManagerStatus(error.message);
      return;
    }
    await supabase.from('transaction_classification_rules').delete().eq('spending_category', category.name);
    setManagerStatus(`Deleted category “${category.name}”.`);
    await loadRulesAndCategories();
  }

  async function makeRule(tx) {
    if (!tx.spending_category) {
      setManagerStatus('Characterize this transaction first, then make the rule.');
      return;
    }
    const defaultPattern = tx.merchant_name || tx.name || transactionName(tx);
    const pattern = window.prompt(
      'Merchant wording to match. Future transactions containing this wording will use the same category:',
      defaultPattern,
    );
    if (!pattern?.trim()) return;

    const applyExisting = window.confirm(
      `Create a rule so transactions matching “${pattern.trim()}” are categorized as “${tx.spending_category}”?\n\nClick OK to also apply it to existing matching transactions.`,
    );

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;
    const normalized = normalizeMerchant(pattern);
    const { error } = await supabase.from('transaction_classification_rules').upsert({
      user_id: userId,
      merchant_pattern: pattern.trim(),
      normalized_pattern: normalized,
      spending_category: tx.spending_category,
      spending_subcategory: tx.spending_subcategory || null,
      excluded_from_spending: Boolean(tx.excluded_from_spending),
      active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,normalized_pattern' });

    if (error) {
      setManagerStatus(error.message);
      return;
    }

    let applied = 0;
    if (applyExisting) {
      const matchingIds = transactions
        .filter((row) => normalizeMerchant(`${row.merchant_name || ''} ${row.name || ''}`).includes(normalized))
        .map((row) => row.transaction_id);
      applied = matchingIds.length;
      for (let index = 0; index < matchingIds.length; index += 100) {
        await supabase.from('plaid_transactions').update({
          spending_category: tx.spending_category,
          spending_subcategory: tx.spending_subcategory || null,
          excluded_from_spending: Boolean(tx.excluded_from_spending),
          classification_status: 'manual',
          classified_at: new Date().toISOString(),
        }).in('transaction_id', matchingIds.slice(index, index + 100));
      }
    }

    setManagerStatus(
      `Rule saved: “${pattern.trim()}” → ${tx.spending_category}.${applyExisting ? ` Applied to ${applied} existing transaction(s).` : ''}`,
    );
    setShowManager(true);
    await loadRulesAndCategories();
  }

  async function deleteRule(rule) {
    const { error } = await supabase.from('transaction_classification_rules').delete().eq('id', rule.id);
    if (error) setManagerStatus(error.message);
    else {
      setManagerStatus(`Deleted rule “${rule.merchant_pattern}”.`);
      await loadRulesAndCategories();
    }
  }

  async function flagSubscription(tx) {
    const merchant = tx.merchant_name || tx.name || transactionName(tx);
    const merchantKey = normalizeMerchant(merchant);
    if (!merchantKey) return;
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    const { error } = await supabase.from('subscription_cancellations').upsert({
      user_id: userId,
      merchant_key: merchantKey,
      merchant_name: merchant,
      source_transaction_id: tx.transaction_id,
      latest_transaction_date: tx.date,
      latest_amount: Math.abs(Number(tx.amount) || 0),
      spending_category: tx.spending_category || null,
      status: 'open',
      cancelled_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,merchant_key' });

    if (error) {
      setManagerStatus(error.message);
      return;
    }
    setManagerStatus(`Added “${merchant}” to Subscriptions to cancel.`);
    setShowSubscriptions(true);
    await loadRulesAndCategories();
  }

  async function setSubscriptionStatus(item, status) {
    const { error } = await supabase.from('subscription_cancellations')
      .update({
        status,
        cancelled_at: status === 'cancelled' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id);
    if (error) setManagerStatus(error.message);
    else {
      setManagerStatus(status === 'cancelled' ? `Marked “${item.merchant_name}” cancelled.` : `Reopened “${item.merchant_name}”.`);
      await loadRulesAndCategories();
    }
  }

  async function deleteSubscription(item) {
    if (!window.confirm(`Remove “${item.merchant_name}” from the cancellation list?`)) return;
    const { error } = await supabase.from('subscription_cancellations').delete().eq('id', item.id);
    if (error) setManagerStatus(error.message);
    else {
      setManagerStatus(`Removed “${item.merchant_name}” from the cancellation list.`);
      await loadRulesAndCategories();
    }
  }

  const openSubscriptions = subscriptions.filter((item) => item.status === 'open');
  const cancelledSubscriptions = subscriptions.filter((item) => item.status === 'cancelled');
  const fraudTransactions = transactions
    .filter((transaction) => transaction.possible_fraud)
    .sort((left, right) => String(right.date).localeCompare(String(left.date)));
  const monthAccountTotal = transactions.filter((tx) => inMonth(tx.date, month) && Boolean(accountsById[tx.account_id]) && (filters.account === 'all' || (Array.isArray(filters.account) ? filters.account.includes(tx.account_id) : filters.account === tx.account_id))).length;
  const needsReview = transactions.filter((tx) => accountsById[tx.account_id] && !tx.reviewed_at)
    .sort((left, right) => String(right.date).localeCompare(String(left.date)));
  const reviewSelection = selectedReviewIds ?? new Set(needsReview.map((tx) => tx.transaction_id));

  async function approveReview(ids) {
    if (!ids.length || reviewBusy) return;
    setReviewBusy(true);
    try {
      await onReviewTransactions(ids);
      setSelectedReviewIds((previous) => previous === null ? null : new Set([...previous].filter((id) => !ids.includes(id))));
    } catch (error) { setManagerStatus(error.message); }
    finally { setReviewBusy(false); }
  }

  return (
    <section className="card">
      <SectionTitle>Accounts & bank transactions</SectionTitle>
      <div className="pad">
        <button className="ghost mini" onClick={() => setReviewOpen((value) => !value)}>New bank transactions {unreviewedCount ? `(${unreviewedCount})` : ''}</button>
        {reviewOpen && <div className="card ruleManagerCard reviewInbox"><div className="pad">
          <div className="toolbar"><h3>New transactions to review ({needsReview.length})</h3><button className="ghost mini" onClick={() => setReviewOpen(false)}>Close</button></div>
          <p className="help">Reviewing acknowledges the bank transaction. Categorize a bill or expense separately below.</p>
          {needsReview.length ? <>
            <div className="toolbar"><button className="ghost mini" onClick={() => setSelectedReviewIds(new Set(needsReview.map((tx) => tx.transaction_id)))}>Select all</button><button className="ghost mini" onClick={() => setSelectedReviewIds(new Set())}>Clear selection</button><button className="brand mini" disabled={!reviewSelection.size || reviewBusy} onClick={() => approveReview([...reviewSelection])}>Approve selected ({reviewSelection.size})</button></div>
            <div className="tableScroll"><table className="transactionTable"><thead><tr><th>Select</th><th>Date</th><th>Account</th><th>Transaction</th><th>Amount</th><th>Action</th></tr></thead><tbody>{needsReview.map((tx) => <tr key={tx.transaction_id}>
              <td><input type="checkbox" aria-label={`Select ${transactionName(tx)} on ${tx.date}`} checked={reviewSelection.has(tx.transaction_id)} onChange={() => { const next = new Set(reviewSelection); if (next.has(tx.transaction_id)) next.delete(tx.transaction_id); else next.add(tx.transaction_id); setSelectedReviewIds(next); }} /></td>
              <td>{tx.date}</td><td>{accountLabel(accountsById[tx.account_id])}</td><td>{transactionName(tx)}{tx.pending && <div className="help">Pending</div>}</td><td className="mono">{fmtMoney(Math.abs(Number(tx.amount) || 0))}</td><td><button className="ghost mini" disabled={reviewBusy} onClick={() => approveReview([tx.transaction_id])}>Approve</button></td>
            </tr>)}</tbody></table></div>
          </> : <p className="muted">All imported transactions have been reviewed.</p>}
        </div></div>}
        <div className="accountSummaryGrid">
          {shownAccounts.map((account) => {
            const recognized = recognizedFor(account.account_id);
            const current = Number(account.current_balance || 0);
            return (
              <div className="accountSummaryCard" key={account.account_id}>
                <strong>{account.display_name || account.name || 'Account'}{account.mask ? ` •••• ${account.mask}` : ''}</strong>
                <div className="help">{account.institution_name || ''}</div>
                <dl className="accountMetrics">
                  <div><dt>Current balance</dt><dd>{fmtMoney(current)}</dd></div>
                  <div><dt>Available</dt><dd>{account.available_balance == null ? '—' : fmtMoney(account.available_balance)}</dd></div>
                  <div><dt>Recognized bills</dt><dd>{fmtMoney(recognized)}</dd></div>
                  <div><dt>Balance − recognized bills</dt><dd>{fmtMoney(current - recognized)}</dd></div>
                </dl>
                <label htmlFor={`account-bill-category-${account.account_id}`}>Suggest bills from</label>
                <select id={`account-bill-category-${account.account_id}`} value={accountBillCategory(account, mappings)} onChange={(event) => onAccountBillCategory(account.account_id, event.target.value)}>
                  <option value="Business">Business bills</option>
                  <option value="Household">Household bills</option>
                  <option value="all">All bills</option>
                </select>
              </div>
            );
          })}
        </div>

        <div className="toolbar accountLedgerToolbar">
          <button className={billView ? 'brand' : 'ghost'} onClick={() => setBillView((value) => !value)}>
            {billView ? 'Bill view on' : 'Highlight bill transactions'}
          </button>
          <button className="ghost" onClick={() => setShowManager((value) => !value)}>
            {showManager ? 'Hide expense categories & rules' : 'Expense categories & rules'}
          </button>
          <button className={fraudTransactions.length ? 'brand' : 'ghost'} onClick={() => setShowFraud((value) => !value)}>
            Possible fraud ({fraudTransactions.length})
          </button>
          <button className={openSubscriptions.length ? 'brand' : 'ghost'} onClick={() => setShowSubscriptions((value) => !value)}>
            Need to cancel ({openSubscriptions.length})
          </button>
        </div>

        {showFraud && (
          <div className="card ruleManagerCard" style={{ marginBottom: 16 }}>
            <div className="pad">
              <h3>Possible fraud ({fraudTransactions.length})</h3>
              <p className="help">Flagged transactions from every month and account. This list does not notify your bank.</p>
              {fraudTransactions.length ? (
                <div className="tableScroll"><table className="transactionTable reviewListTable">
                  <thead><tr><th>Date</th><th>Account</th><th>Transaction</th><th>Amount</th><th>Category</th><th>Action</th></tr></thead>
                  <tbody>{fraudTransactions.map((tx) => <tr key={tx.transaction_id}>
                    <td>{tx.date}</td><td>{accountLabel(allAccountsById[tx.account_id])}</td>
                    <td><strong>{transactionName(tx)}</strong>{tx.name && tx.name !== tx.merchant_name && <div className="help">{tx.name}</div>}</td>
                    <td className="mono">{fmtMoney(Math.abs(Number(tx.amount) || 0))}</td>
                    <td>{tx.spending_category || 'Uncharacterized'}</td>
                    <td><button className="ghost mini" onClick={() => onFlagPossibleFraud(tx, false)}>Clear fraud flag</button></td>
                  </tr>)}</tbody>
                </table></div>
              ) : <p className="muted">No transactions are flagged as possible fraud.</p>}
            </div>
          </div>
        )}

        {showSubscriptions && (
          <div className="card ruleManagerCard" style={{ marginBottom: 16 }}>
            <div className="pad">
              <div><h3>Need to cancel ({openSubscriptions.length})</h3><div className="help">Flag a charge with “Need to cancel.” Each merchant stays on this list until you mark it cancelled or remove it.</div></div>
              {openSubscriptions.length ? (
                <div className="tableScroll">
                  <table className="transactionTable">
                    <thead><tr><th>Merchant</th><th>Charge</th><th>Account</th><th>Amount</th><th>Category</th><th>Actions</th></tr></thead>
                    <tbody>{openSubscriptions.map((item) => (
                      <tr key={item.id}>
                        <td><strong>{item.merchant_name}</strong></td>
                        <td>{item.latest_transaction_date || '—'}</td>
                        <td>{accountLabel(allAccountsById[transactions.find((tx) => tx.transaction_id === item.source_transaction_id)?.account_id])}</td>
                        <td className="mono">{item.latest_amount == null ? '—' : fmtMoney(item.latest_amount)}</td>
                        <td>{item.spending_category || '—'}</td>
                        <td><div className="actionStack"><button className="brand mini" onClick={() => setSubscriptionStatus(item, 'cancelled')}>Mark cancelled</button><button className="ghost mini" onClick={() => deleteSubscription(item)}>Remove</button></div></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="muted">Nothing is currently marked for cancellation.</p>}
              {cancelledSubscriptions.length > 0 && (
                <details style={{ marginTop: 12 }}>
                  <summary>Cancelled subscriptions ({cancelledSubscriptions.length})</summary>
                  <div className="tableScroll" style={{ marginTop: 8 }}>
                    <table className="transactionTable">
                      <thead><tr><th>Merchant</th><th>Last charge</th><th>Amount</th><th>Actions</th></tr></thead>
                      <tbody>{cancelledSubscriptions.map((item) => (
                        <tr key={item.id}><td>{item.merchant_name}</td><td>{item.latest_transaction_date || '—'}</td><td>{item.latest_amount == null ? '—' : fmtMoney(item.latest_amount)}</td><td><button className="ghost mini" onClick={() => setSubscriptionStatus(item, 'open')}>Reopen</button></td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                </details>
              )}
              {managerStatus && <p className="statusMessage">{managerStatus}</p>}
            </div>
          </div>
        )}

        {showManager && (
          <div className="card ruleManagerCard" id="category-manager" style={{ marginBottom: 16 }}>
            <div className="pad">
              <div className="toolbar">
                <div><h3>Bookkeeping categories</h3><div className="help">Add Groceries and Eating Out, then hide Food & Dining below. Hiding a preset leaves existing transactions unchanged.</div></div>
                <button className="brand mini" onClick={addCategory}>+ New category</button>
              </div>
              <h4>Preset categories</h4>
              <div className="categoryChips">
                {DEFAULT_SPENDING_CATEGORIES.map((name) => <span className="chip" key={name}>{name} <button className="ghost mini" onClick={() => togglePresetCategory(name)}>{hiddenCategories.some((item) => item.category_name === name) ? 'Restore' : 'Hide'}</button></span>)}
              </div>
              <h4>Your categories</h4>
              <div className="toolbar" style={{ flexWrap: 'wrap', marginTop: 8 }}>
                {categories.length ? categories.map((category) => (
                  <span className="chip" key={category.id}>{category.name}<button className="ghost mini" onClick={() => editCategory(category)}>Edit</button><button className="ghost mini" onClick={() => deleteCategory(category)}>Delete</button></span>
                )) : <span className="muted">No custom categories yet. You can still type a category when characterizing a transaction.</span>}
              </div>
              <div className="toolbar" style={{ marginTop: 16 }}><div><h3>Automatic categorization rules</h3><div className="help">QuickBooks-style rules apply the same category to matching merchant wording.</div></div></div>
              {rules.length ? (
                <div className="tableScroll"><table className="transactionTable"><thead><tr><th>If description contains</th><th>Category</th><th>Subcategory</th><th>Action</th></tr></thead><tbody>{rules.map((rule) => (<tr key={rule.id}><td><strong>{rule.merchant_pattern}</strong></td><td>{rule.spending_category}</td><td>{rule.spending_subcategory || '—'}</td><td><button className="ghost mini" onClick={() => deleteRule(rule)}>Delete rule</button></td></tr>))}</tbody></table></div>
              ) : <p className="muted">No rules yet. Characterize a transaction, then click “Make rule”.</p>}
              {managerStatus && <p className="statusMessage">{managerStatus}</p>}
            </div>
          </div>
        )}

        <div className="bankToolbar">
          <div><label>Month</label><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
          <CheckboxFilter label="Account" options={shownAccounts.map((account) => ({ value: account.account_id, label: accountLabel(account) }))} value={filters.account} onChange={(account) => setFilters({ ...filters, account })} />
          <CheckboxFilter label="Transaction group" options={[{ value: 'confirmed', label: 'Bills' }, { value: 'suggested', label: 'Bill suggestions' }, { value: 'not-bill', label: 'Needs review' }, { value: 'non-recurring', label: 'Non-recurring expenses' }]} value={filters.billState} onChange={(billState) => setFilters({ ...filters, billState })} />
          <CheckboxFilter label="Characterization" options={[{ value: 'characterized', label: 'Characterized' }, { value: 'uncharacterized', label: 'Uncharacterized' }]} value={filters.classification} onChange={(classification) => setFilters({ ...filters, classification })} />
          <CheckboxFilter label="Review flag" options={[{ value: 'possible-fraud', label: 'Possible fraud' }, { value: 'unflagged', label: 'Not flagged' }]} value={filters.reviewFlag} onChange={(reviewFlag) => setFilters({ ...filters, reviewFlag })} />
          <CheckboxFilter label="Flow / type" options={[{ value: 'in', label: 'Other money in' }, { value: 'out', label: 'Other money out' }, { value: 'checks', label: 'Checks' }, { value: 'transfers', label: 'Transfers' }]} value={filters.flow} onChange={(flow) => setFilters({ ...filters, flow })} />
        </div>

        <div className="toolbar transactionControls">
          <input placeholder="Search description / category" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
          <button className="ghost" disabled={!hiddenTransactions.size} onClick={() => setHiddenTransactions(new Set())}>Show all{hiddenTransactions.size ? ` (${hiddenTransactions.size} hidden)` : ''}</button>
          <div>
            <label htmlFor="transaction-sort">Sort by</label>
            <select id="transaction-sort" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} title="Amount sorting uses transaction size for both money in and money out.">
              <option value="date-desc">Date: newest first</option>
              <option value="amount-desc">Amount: greatest to least</option>
              <option value="amount-asc">Amount: least to greatest</option>
            </select>
          </div>
          <button className="brand" onClick={onMatchMonth} disabled={matching}>{matching ? 'Matching...' : 'Find bill payments'}</button>
        </div>
        <div className="toolbar bulkTransactionControls">
          <button className="ghost mini" disabled={!monthTransactions.length || bulkBusy} onClick={() => setSelectedTransactionIds(new Set(monthTransactions.map((tx) => tx.transaction_id)))}>Select all shown</button>
          <button className="ghost mini" disabled={!selectedCount || bulkBusy} onClick={() => setSelectedTransactionIds(new Set())}>Deselect all</button>
          <span className="help">{selectedCount} selected</span>
          <select aria-label="Action for selected transactions" value={bulkAction} disabled={bulkBusy} onChange={(e) => { setBulkAction(e.target.value); setBulkStatus(''); }}>
            <option value="">Action for selected…</option>
            <option value="expense">Non-recurring expense</option>
            <option value="remove-expense">Remove expense label</option>
            <option value="fraud">Possible fraud</option>
            <option value="clear-fraud">Clear fraud flag</option>
            <option value="classify">Characterize</option>
            <option value="cancel">Need to cancel</option>
            <option value="rule">Make rule</option>
            <option value="link">Link to bill</option>
            <option value="hide">Hide selected</option>
          </select>
          {bulkAction === 'classify' && <><input aria-label="Bookkeeping category for selected transactions" placeholder="Bookkeeping category" list="bulk-bookkeeping-categories" value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} /><datalist id="bulk-bookkeeping-categories">{visibleSpendingCategories(categories, hiddenCategories).map((name) => <option key={name} value={name} />)}</datalist><input aria-label="Subcategory for selected transactions" placeholder="Subcategory (optional)" value={bulkSubcategory} onChange={(e) => setBulkSubcategory(e.target.value)} /></>}
          {bulkAction === 'link' && <select aria-label="Bill for selected transactions" value={bulkBillId} onChange={(e) => setBulkBillId(e.target.value)}><option value="">Choose bill…</option>{[...bills].sort((a, b) => a.name.localeCompare(b.name)).map((bill) => <option key={bill.id} value={bill.id}>{bill.name} ({bill.category})</option>)}</select>}
          <button className="brand mini" disabled={!selectedCount || !bulkAction || bulkBusy} onClick={applyBulkAction}>{bulkBusy ? 'Applying…' : `Apply to selected (${selectedCount})`}</button>
        </div>
        {bulkStatus && <p className="statusMessage" role="status">{bulkStatus}</p>}
        {matchStatus && <p className="statusMessage">{matchStatus}</p>}
        {aiSuggestions.status && <div className="statusMessage toolbar" role="status"><span>{aiSuggestions.status}</span><button className="ghost mini" disabled={aiSuggestions.loading} onClick={aiSuggestions.retry}>{aiSuggestions.loading ? 'Checking...' : 'Retry AI suggestions'}</button></div>}
        <p className="help" role="status"><strong>{monthTransactions.length} transaction{monthTransactions.length === 1 ? '' : 's'} showing</strong> out of {monthAccountTotal} in the selected month and account{monthAccountTotal === 1 ? '' : 's'}.{hiddenTransactions.size ? ` ${hiddenTransactions.size} manually hidden.` : ''}</p>

        {monthTransactions.length ? (
          <div className="tableScroll">
            <table className="transactionTable">
              <thead><tr><th>Select</th><th>Date</th><th>Account</th><th>Description</th><th>Amount</th><th>Bank category</th><th>Group</th><th>Category / type</th><th>Actions</th></tr></thead>
              <tbody>{monthTransactions.map((tx) => {
                const confirmedBill = billsById[tx.matched_bill_id];
                const suggestedBill = billsById[tx.suggested_bill_id];
                const confirmed = isConfirmedBillTransaction(tx);
                const suggested = isSuggestedBillTransaction(tx);
                const merchantKey = normalizeMerchant(tx.merchant_name || tx.name || transactionName(tx));
                const needsCancel = openSubscriptionKeys.has(merchantKey);
                const detailOpen = openDetail?.id === tx.transaction_id;
                const detailMode = detailOpen ? openDetail.mode : null;
                const toggleDetail = (mode) => setOpenDetail(detailOpen ? null : { id: tx.transaction_id, mode });
                const handleAction = (event) => {
                  const action = event.target.value;
                  event.target.value = '';
                  if (action === 'link') onLink(tx);
                  else if (action === 'expense-label') onNonRecurringBill(tx, !tx.non_recurring_bill);
                  else if (action === 'fraud') onFlagPossibleFraud(tx, !tx.possible_fraud);
                  else if (action === 'classify') onClassify(tx);
                  else if (action === 'rule') makeRule(tx);
                  else if (action === 'cancel') flagSubscription(tx);
                };
                return (
                  <React.Fragment key={tx.transaction_id}>
                  <tr className={tx.possible_fraud ? 'possibleFraudRow' : billView && confirmed ? 'recognizedBillRow' : suggested ? 'suggestedBillRow' : ''}>
                    <td><input className="transactionVisibilityCheckbox" type="checkbox" checked={selectedTransactionIds.has(tx.transaction_id)} aria-label={`Select ${transactionName(tx)} on ${tx.date}`} title="Select for a batch action" onChange={() => toggleTransactionSelection(tx.transaction_id)} /></td>
                    <td>{tx.date}{tx.pending && <div className="pendingText">pending</div>}</td>
                    <td>{accountLabel(accountsById[tx.account_id])}</td>
                    <td>{tx.non_recurring_bill || (tx.possible_fraud && !confirmed) ? <strong>{transactionName(tx)}</strong> : <button className="transactionMerchantButton" onClick={() => onLink(tx)}>{billView && confirmedBill ? confirmedBill.name : transactionName(tx)}</button>}{billView && confirmedBill && <div className="help">Bank: {transactionName(tx)}</div>}{tx.possible_fraud && <div className="fraudText">POSSIBLE FRAUD — review with your bank</div>}{needsCancel && <div className="warningText">NEED TO CANCEL</div>}</td>
                    <td className={`mono amountCell ${isMoneyIn(tx) ? 'moneyIn' : 'moneyOut'}`}>{isMoneyIn(tx) ? '+' : '-'}{fmtMoney(Math.abs(Number(tx.amount) || 0))}</td>
                    <td>{humanizeFinanceCategory(tx.personal_finance_detailed || tx.personal_finance_primary) || '—'}</td>
                    <td>{confirmed ? 'Bill' : suggested ? 'Bill suggestion' : tx.non_recurring_bill ? 'Non-recurring expense' : 'Needs review'}</td>
                    <td>{confirmedBill ? confirmedBill.subcategory || 'Bill type not set' : suggestedBill && suggested ? suggestedBill.subcategory || 'Bill type not set' : tx.spending_category || (tx.classification_status === 'uncharacterized' ? 'Uncharacterized' : '—')}{!confirmedBill && !suggested && tx.spending_subcategory && <div className="help">{tx.spending_subcategory}</div>}</td>
                    <td><div className="transactionQuickActions">
                      <button className="ghost mini" aria-expanded={detailOpen} aria-controls={detailOpen ? `transaction-detail-${tx.transaction_id}` : undefined} onClick={() => toggleDetail(tx.non_recurring_bill ? 'expense' : 'bill')}>{detailOpen ? 'Close details' : 'Details'}</button>
                      <select aria-label={`Actions for ${transactionName(tx)}`} defaultValue="" onChange={handleAction}>
                        <option value="" disabled>Actions…</option>
                        {!confirmed && !suggested && !tx.non_recurring_bill && !tx.possible_fraud && <option value="link">Link to bill</option>}
                        {!tx.matched_bill_id && Number(tx.amount) > 0 && <option value="expense-label">{tx.non_recurring_bill ? 'Remove expense label' : 'Non-recurring expense'}</option>}
                        <option value="fraud">{tx.possible_fraud ? 'Clear fraud flag' : 'Possible fraud'}</option>
                        <option value="classify">Characterize</option>
                        {tx.spending_category && <option value="rule">Make rule</option>}
                        {!needsCancel && Number(tx.amount) > 0 && <option value="cancel">Need to cancel</option>}
                      </select>
                    </div></td>
                  </tr>
                  {detailOpen && <tr className="transactionMatchRow" id={`transaction-detail-${tx.transaction_id}`}><td colSpan={9}>
                    <div className="transactionDetailTabs">
                      {!tx.non_recurring_bill && <button className={detailMode === 'bill' ? 'brand mini' : 'ghost mini'} onClick={() => setOpenDetail({ id: tx.transaction_id, mode: 'bill' })}>Bill</button>}
                      {!confirmed && <button className={detailMode === 'expense' ? 'brand mini' : 'ghost mini'} onClick={() => setOpenDetail({ id: tx.transaction_id, mode: 'expense' })}>Expense</button>}
                    </div>
                    {detailMode === 'bill' && (tx.possible_fraud && !confirmed ? <div className="inlineBillMatch help">Set aside for fraud review. Clear the flag before linking to a bill; this does not contact the bank.</div> : !tx.non_recurring_bill && <TransactionBillMatch transaction={tx} bills={bills} account={accountsById[tx.account_id]} mappings={mappings} rules={matchRules} feedback={matchFeedback}
                      preferences={billPickerPreferences} onPreferences={onBillPickerPreferences} aiMatch={aiSuggestions.matches[tx.transaction_id]} onMatchAction={onMatchAction} onLink={onLink} />
                    )}
                    {detailMode === 'expense' && !confirmed && <ExpenseTypePicker transaction={tx} types={expenseTypes} onApply={onApplyExpenseType} onAdd={setAddingExpenseFor} />}
                  </td></tr>}
                  </React.Fragment>
                );
              })}</tbody>
            </table>
          </div>
        ) : <p className="emptyState">{hiddenTransactions.size ? 'No visible transactions match these filters. Use Show all to restore hidden rows, or adjust your filters.' : 'No transactions match these filters. Sync Plaid or choose another month.'}</p>}
        {addingExpenseFor && <ExpenseTypeDialog transaction={addingExpenseFor} types={expenseTypes} categories={visibleSpendingCategories(categories, hiddenCategories)} onManageCategories={openCategoryManager} onSave={addExpenseType} onClose={() => setAddingExpenseFor(null)} />}
      </div>
    </section>
  );
}
