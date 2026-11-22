import React, { useState } from 'react';
import { fmtMoney } from '../lib/dates';
import { accountLabel, isMoneyIn, transactionName, inMonth } from '../lib/bank';
import { SectionTitle } from './ui';

export default function FindBillTransactions({ bill, account, month, transactions, bills, onMatch }) {
  const [search, setSearch] = useState('');
  const [showAllDates, setShowAllDates] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [status, setStatus] = useState('');
  const billsById = Object.fromEntries(bills.map((item) => [item.id, item]));
  const rows = transactions.filter((tx) => tx.account_id === account?.account_id)
    .filter((tx) => showAllDates || inMonth(tx.date, month))
    .filter((tx) => !search.trim() || `${transactionName(tx)} ${tx.date} ${tx.amount}`.toLowerCase().includes(search.toLowerCase().trim()))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  async function match(tx) {
    setBusyId(tx.transaction_id);
    setStatus('');
    try {
      await onMatch(tx, bill);
      setStatus(`Matched ${transactionName(tx)} to ${bill.name} for ${String(tx.date).slice(0, 7)}. The Tracker will update when you return to it.`);
    } catch (error) { setStatus(error.message); }
    finally { setBusyId(null); }
  }

  return <section className="card"><SectionTitle>Find transactions for {bill?.name || 'bill'}</SectionTitle><div className="pad">
    {!bill || !account ? <p className="errorMessage">The bill or bank account could not be found. Open Find Transactions from Tracker again.</p> : <>
      <p className="help">{accountLabel(account)} · Matching a charge records it in the Tracker month of the bank transaction’s date.</p>
      <div className="toolbar transactionSummaryControls">
        <label className="inlineLabel"><input type="checkbox" checked={showAllDates} onChange={(event) => setShowAllDates(event.target.checked)} /> All dates</label>
        {!showAllDates && <span className="help">{month}</span>}
        <input type="search" aria-label="Search bank transactions" placeholder="Search name, date, or amount" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      {status && <p className="statusMessage" role="status">{status}</p>}
      <div className="tableScroll"><table className="compact transactionSummaryTable"><thead><tr><th>Date</th><th>Transaction</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {rows.map((tx) => {
          const linkedBill = billsById[tx.matched_bill_id];
          const linked = Boolean(tx.matched_bill_id);
          const unavailable = tx.pending || isMoneyIn(tx) || linked || tx.possible_fraud || tx.non_recurring_bill;
          return <tr key={tx.transaction_id}><td>{tx.date}</td><td>{transactionName(tx)}</td><td className="mono">{isMoneyIn(tx) ? '+' : '-'}{fmtMoney(Math.abs(Number(tx.amount) || 0))}</td>
            <td>{linked ? `Linked to ${linkedBill?.name || 'another bill'}` : tx.pending ? 'Pending' : tx.possible_fraud ? 'Fraud review' : tx.non_recurring_bill ? 'Non-recurring expense' : isMoneyIn(tx) ? 'Money in' : tx.suggested_bill_id ? `Suggested: ${billsById[tx.suggested_bill_id]?.name || 'bill'}` : 'Unmatched'}</td>
            <td><button className="brand mini" disabled={unavailable || busyId !== null} onClick={() => match(tx)}>{busyId === tx.transaction_id ? 'Matching…' : 'Match to bill'}</button></td></tr>;
        })}
        {!rows.length && <tr><td colSpan={5} className="emptyState">No transactions match this account, date range, and search.</td></tr>}
      </tbody></table></div>
    </>}
  </div></section>;
}
