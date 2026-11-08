import React, { useState } from 'react';
import { fmtMoney } from '../lib/dates';
import { candidateBills, suggestBill, accountBillCategory } from '../lib/billMatching';
import BillPicker from './BillPicker';

export default function TransactionBillMatch({ transaction, bills, account, mappings = [], rules = [], feedback = [], preferences, onPreferences, aiMatch, onMatchAction, onLink }) {
  const [selection, setSelection] = useState(null);
  const [busy, setBusy] = useState(false);
  const accountCategory = accountBillCategory(account, mappings);
  const category = preferences.category === 'account' ? accountCategory : preferences.category;
  const choices = candidateBills(transaction, bills, category, { manual: true });
  const eligible = candidateBills(transaction, bills, category, { feedback });
  const aiBill = eligible.find((bill) => bill.id === aiMatch?.bill_id);
  const storedBill = eligible.find((bill) => bill.id === transaction.suggested_bill_id);
  const suggestion = aiBill ? { bill: aiBill, ...aiMatch } : storedBill ? { bill: storedBill, source: transaction.match_source, confidence: transaction.match_confidence, reason: transaction.match_reason }
    : suggestBill(transaction, bills, { category, rules, feedback });
  const selected = choices.find((bill) => bill.id === (selection ?? suggestion?.bill.id));
  const confirmed = transaction.matched_bill_id && ['approved', 'automatic'].includes(transaction.match_status);
  const matchedBill = bills.find((bill) => bill.id === transaction.matched_bill_id);

  async function match(action, billId) {
    setBusy(true);
    try { await onMatchAction(action, { ...transaction, suggested_bill_id: billId || transaction.suggested_bill_id }, billId); }
    finally { setBusy(false); }
  }

  if (confirmed) return (
    <div className="inlineBillMatch confirmedBillMatch">
      <div><strong>Linked bill: {matchedBill?.name || 'Bill'}</strong><div className="help">{matchedBill?.category} · Payment confirmed</div></div>
      <button className="ghost mini" disabled={busy} onClick={() => match('unmatch', transaction.matched_bill_id)}>Remove bill match</button>
    </div>
  );

  return (
    <div className="inlineBillMatch">
      <div className="billSuggestionSummary">
        {suggestion ? <><strong>{suggestion.source === 'openai' ? 'AI suggestion' : 'Suggested bill'}: {suggestion.bill.name}</strong><span>{suggestion.bill.category} · Expected {fmtMoney(suggestion.bill.amount)}</span><div className="help">{suggestion.reason} Review and confirm below.</div></> : <><strong>Choose a bill for this transaction</strong><div className="help">Search the list below, or add a new bill.</div></>}
      </div>
      <BillPicker bills={choices} value={selected?.id || ''} onChange={setSelection} preferences={preferences} onPreferences={onPreferences} accountCategory={accountCategory} disabled={busy} />
      <div className="toolbar billMatchButtons">
        <button className="brand mini" disabled={!selected || busy} onClick={() => match('approve', selected.id)}>{busy ? 'Saving...' : 'Confirm bill'}</button>
        {suggestion && <button className="ghost mini" disabled={busy} onClick={() => { setSelection(''); return match('reject', suggestion.bill.id); }}>Not this bill</button>}
        <button className="ghost mini" disabled={busy} onClick={() => onLink(transaction)}>+ Add a bill / more options</button>
      </div>
    </div>
  );
}
