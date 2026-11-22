import React, { useState } from 'react';
import { fmtMoney } from '../lib/dates';
import { accountShortLabel, confidenceLabel, transactionName } from '../lib/bank';
import { monthNameShort, monthlyEq } from '../lib/billMath';
import { SectionTitle } from './ui';

export default function BillMatchReview({ matches, accounts, onDecide }) {
  const [selectedIds, setSelectedIds] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const selected = selectedIds === null ? new Set(matches.map(({ tx }) => tx.transaction_id)) : selectedIds;
  const chosen = matches.filter(({ tx }) => selected.has(tx.transaction_id));
  const accountsById = Object.fromEntries(accounts.map((account) => [account.account_id, account]));

  async function decide(action, rows) {
    if (!rows.length || busy) return;
    setBusy(true);
    setStatus('');
    try {
      const count = await onDecide(action, rows);
      setStatus(`${count} match${count === 1 ? '' : 'es'} ${action === 'approve' ? 'accepted' : 'rejected'}.`);
      setSelectedIds((previous) => previous === null ? null : new Set([...previous].filter((id) => !rows.some(({ tx }) => tx.transaction_id === id))));
    } catch (error) { setStatus(error.message); }
    finally { setBusy(false); }
  }

  return <section className="card">
    <SectionTitle>Review bank matches</SectionTitle>
    <div className="pad">
      <div className="toolbar matchReviewHeader">
        <div><h3>{matches.length} suggested bill match{matches.length === 1 ? '' : 'es'}</h3><div className="help">Each transaction is paired with a bill for the same month. Uncheck any that need a closer look before accepting the rest.</div></div>
        <button className="brand" disabled={busy || !chosen.length} onClick={() => decide('approve', chosen)}>{busy ? 'Saving…' : `Accept all selected (${chosen.length})`}</button>
      </div>
      {status && <p className="statusMessage" role="status">{status}</p>}
      {matches.length ? <div className="tableScroll"><table className="matchReviewTable compactMatchReview">
        <thead><tr><th>Select</th><th>Bill month</th><th>Bill</th><th>Expected</th><th>Transaction</th><th>Bank amount</th><th>Confidence</th><th>Decision</th></tr></thead>
        <tbody>{matches.map((row) => {
          const { bill, tx, month, year } = row;
          return <tr key={tx.transaction_id} className="suggestedBillRow">
            <td><input type="checkbox" checked={selected.has(tx.transaction_id)} aria-label={`Select ${transactionName(tx)} for ${bill.name}, ${monthNameShort(month)} ${year}`} onChange={() => { const next = new Set(selected); if (next.has(tx.transaction_id)) next.delete(tx.transaction_id); else next.add(tx.transaction_id); setSelectedIds(next); }} /></td>
            <td>{monthNameShort(month)} {year}</td>
            <td><strong>{bill.name}</strong><div className="help">{bill.category}</div></td>
            <td className="mono">{fmtMoney(monthlyEq(bill))}</td>
            <td><strong>{transactionName(tx)}</strong><div className="help">{tx.date} · {accountShortLabel(accountsById[tx.account_id])}</div></td>
            <td className="mono">{fmtMoney(Math.abs(Number(tx.amount) || 0))}</td>
            <td>{confidenceLabel(tx.match_confidence) || '—'}{tx.match_reason && <div className="help">{tx.match_reason}</div>}</td>
            <td><div className="toolbar"><button className="brand mini" disabled={busy} onClick={() => decide('approve', [row])}>Accept</button><button className="ghost mini" disabled={busy} onClick={() => decide('reject', [row])}>Reject</button></div></td>
          </tr>;
        })}</tbody>
      </table></div> : <p className="emptyState">No yellow Tracker matches need review.</p>}
    </div>
  </section>;
}
