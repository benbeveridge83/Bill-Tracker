import React, { useMemo, useState } from 'react';
import { fmtMoney } from '../lib/dates';
import {
  accountLabel,
  humanizeFinanceCategory,
  inMonth,
  isConfirmedBillTransaction,
  isMoneyIn,
  isSuggestedBillTransaction,
  transactionName,
} from '../lib/bank';
import { SectionTitle } from './ui';

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
  onLink,
  onMatchAction,
}) {
  const [billView, setBillView] = useState(true);
  const shownAccounts = accounts.filter((account) => !account.is_hidden);
  const accountsById = useMemo(
    () => Object.fromEntries(shownAccounts.map((account) => [account.account_id, account])),
    [shownAccounts],
  );
  const billsById = useMemo(
    () => Object.fromEntries(bills.map((bill) => [bill.id, bill])),
    [bills],
  );

  const monthTransactions = transactions
    .filter((tx) => inMonth(tx.date, month))
    .filter((tx) => Boolean(accountsById[tx.account_id]))
    .filter((tx) => filters.account === 'all' || tx.account_id === filters.account)
    .filter((tx) => {
      if (filters.billState === 'confirmed') return isConfirmedBillTransaction(tx);
      if (filters.billState === 'suggested') return isSuggestedBillTransaction(tx);
      if (filters.billState === 'not-bill') return !tx.matched_bill_id && !tx.suggested_bill_id;
      return true;
    })
    .filter((tx) => {
      if (filters.classification === 'characterized') return tx.classification_status !== 'uncharacterized';
      if (filters.classification === 'uncharacterized') return tx.classification_status === 'uncharacterized';
      return true;
    })
    .filter((tx) => {
      if (filters.flow === 'in') return Number(tx.amount) < 0;
      if (filters.flow === 'out') return Number(tx.amount) > 0;
      if (filters.flow === 'checks') return Boolean(tx.is_check);
      if (filters.flow === 'transfers') return Boolean(tx.is_transfer);
      return true;
    })
    .filter((tx) => {
      const needle = String(filters.search || '').trim().toLowerCase();
      if (!needle) return true;
      return [transactionName(tx), tx.name, tx.spending_category, tx.spending_subcategory]
        .filter(Boolean).join(' ').toLowerCase().includes(needle);
    });

  function recognizedFor(accountId) {
    return transactions
      .filter((tx) => tx.account_id === accountId && inMonth(tx.date, month) && isConfirmedBillTransaction(tx))
      .reduce((sum, tx) => sum + Math.abs(Number(tx.amount) || 0), 0);
  }

  return (
    <section className="card">
      <SectionTitle>Accounts & bank transactions</SectionTitle>
      <div className="pad">
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
              </div>
            );
          })}
        </div>

        <div className="toolbar accountLedgerToolbar">
          <button className={billView ? 'brand' : 'ghost'} onClick={() => setBillView((value) => !value)}>
            {billView ? 'Bill view on' : 'Highlight bill transactions'}
          </button>
          <div className="help">Bill view makes confirmed bill rows green and shows the Bill Tracker bill name as the main description.</div>
        </div>

        <div className="bankToolbar">
          <div><label>Month</label><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
          <div><label>Account</label><select value={filters.account} onChange={(e) => setFilters({ ...filters, account: e.target.value })}>
            <option value="all">All shown accounts</option>
            {shownAccounts.map((account) => <option key={account.account_id} value={account.account_id}>{accountLabel(account)}</option>)}
          </select></div>
          <div><label>Bill status</label><select value={filters.billState} onChange={(e) => setFilters({ ...filters, billState: e.target.value })}>
            <option value="all">All transactions</option><option value="confirmed">Recognized bills</option><option value="suggested">Suggested bills</option><option value="not-bill">Not identified as bills</option>
          </select></div>
          <div><label>Characterization</label><select value={filters.classification} onChange={(e) => setFilters({ ...filters, classification: e.target.value })}>
            <option value="all">All</option><option value="characterized">Characterized</option><option value="uncharacterized">Uncharacterized</option>
          </select></div>
          <div><label>Flow / type</label><select value={filters.flow} onChange={(e) => setFilters({ ...filters, flow: e.target.value })}>
            <option value="all">All</option><option value="in">Money in</option><option value="out">Money out</option><option value="checks">Checks</option><option value="transfers">Transfers</option>
          </select></div>
        </div>

        <div className="toolbar transactionControls">
          <input placeholder="Search description / category" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
          <button className="brand" onClick={onMatchMonth} disabled={matching}>{matching ? 'Matching...' : 'Find bill payments'}</button>
        </div>
        {matchStatus && <p className="statusMessage">{matchStatus}</p>}

        {monthTransactions.length ? (
          <div className="tableScroll">
            <table className="transactionTable">
              <thead><tr><th>Date</th><th>Account</th><th>Description</th><th>Amount</th><th>Bank category</th><th>Bill match</th><th>Spending category</th><th>Actions</th></tr></thead>
              <tbody>{monthTransactions.map((tx) => {
                const confirmedBill = billsById[tx.matched_bill_id];
                const suggestedBill = billsById[tx.suggested_bill_id];
                const confirmed = isConfirmedBillTransaction(tx);
                const suggested = isSuggestedBillTransaction(tx);
                return (
                  <tr key={tx.transaction_id} className={billView && confirmed ? 'recognizedBillRow' : suggested ? 'suggestedBillRow' : ''}>
                    <td>{tx.date}{tx.pending && <div className="pendingText">pending</div>}</td>
                    <td>{accountLabel(accountsById[tx.account_id])}</td>
                    <td><strong>{billView && confirmedBill ? confirmedBill.name : transactionName(tx)}</strong>{billView && confirmedBill && <div className="help">Bank: {transactionName(tx)}</div>}</td>
                    <td className={`mono amountCell ${isMoneyIn(tx) ? 'moneyIn' : 'moneyOut'}`}>{isMoneyIn(tx) ? '+' : '-'}{fmtMoney(Math.abs(Number(tx.amount) || 0))}</td>
                    <td>{humanizeFinanceCategory(tx.personal_finance_detailed || tx.personal_finance_primary) || '—'}</td>
                    <td>
                      {confirmedBill ? <><span className="chip ok">{confirmedBill.name}</span><div className="help">{Math.round(Number(tx.match_confidence || 0) * 100)}% confirmed</div></> : suggestedBill ? <><span className="chip review">{suggestedBill.name}</span><div className="help">{Math.round(Number(tx.match_confidence || 0) * 100)}% suggestion</div></> : '—'}
                    </td>
                    <td>{tx.spending_category || (tx.classification_status === 'uncharacterized' ? 'Uncharacterized' : '—')}{tx.spending_subcategory && <div className="help">{tx.spending_subcategory}</div>}</td>
                    <td><div className="actionStack">
                      {suggested && <><button className="brand mini" onClick={() => onMatchAction('approve', tx)}>Approve</button><button className="ghost mini" onClick={() => onMatchAction('reject', tx)}>Reject</button></>}
                      {confirmed && <button className="ghost mini" onClick={() => onMatchAction('unmatch', tx)}>Remove bill match</button>}
                      {!confirmed && !suggested && <button className="ghost mini" onClick={() => onLink(tx)}>Link to bill</button>}
                      <button className="ghost mini" onClick={() => onClassify(tx)}>Characterize</button>
                    </div></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : <p className="emptyState">No transactions match these filters. Sync Plaid or choose another month.</p>}
      </div>
    </section>
  );
}
