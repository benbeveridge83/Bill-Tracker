import React, { useEffect, useMemo, useState } from 'react';
import { clamp0, fmtMoney, today } from '../lib/dates';
import { monthNameShort, monthlyEq, nextDueFrom } from '../lib/billMath';
import {
  accountShortLabel,
  confidenceLabel,
  currentMonthValue,
  inMonth,
  isConfirmedBillTransaction,
  isSuggestedBillTransaction,
  transactionName,
} from '../lib/bank';
import { supabase } from '../lib/supabaseClient';
import { MatchModeLabel, SectionTitle } from './ui';

export default function Tracker({
  bills,
  filters,
  setFilters,
  getMark,
  transactionsForBillMonth,
  onMonth,
}) {
  const year = today().getFullYear();
  const nowMonth = today().getMonth() + 1;
  const currentMonth = currentMonthValue();
  const [mode, setMode] = useState('calendar');
  const [accounts, setAccounts] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [bankTransactions, setBankTransactions] = useState([]);
  const [matching, setMatching] = useState(false);
  const [matchStatus, setMatchStatus] = useState('');

  async function loadReviewData() {
    const lastDay = new Date(year, nowMonth, 0).toISOString().slice(0, 10);
    const [a, m, t] = await Promise.all([
      supabase.from('plaid_accounts').select('*').order('name'),
      supabase.from('category_account_mappings').select('*'),
      supabase.from('plaid_transactions').select('*')
        .gte('date', `${currentMonth}-01`).lte('date', lastDay)
        .order('date', { ascending: false }),
    ]);
    if (!a.error) setAccounts(a.data || []);
    if (!m.error) setMappings(m.data || []);
    if (!t.error) setBankTransactions(t.data || []);
  }

  useEffect(() => {
    if (mode === 'review') loadReviewData();
  }, [mode, currentMonth]);

  async function invoke(name, body) {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (!error) return data;
    let message = error.message;
    try {
      const payload = await error.context?.json();
      message = payload?.error || message;
    } catch {
      // Keep client error.
    }
    throw new Error(message);
  }

  async function findMatches() {
    setMatching(true);
    setMatchStatus('Looking for bank transactions...');
    try {
      const data = await invoke('ai-match-bills', {
        month: currentMonth,
        category: filters.category,
      });
      setMatchStatus(
        `${data?.message || 'Matching complete.'} ${data?.local_suggestions || 0} local, ${data?.ai_suggestions || 0} AI, ${data?.automatic_matches || 0} automatic.`,
      );
      await loadReviewData();
    } catch (error) {
      setMatchStatus(error.message);
    } finally {
      setMatching(false);
    }
  }

  async function decide(action, transaction, billId) {
    setMatchStatus(action === 'approve' ? 'Confirming bank payment...' : 'Rejecting suggestion...');
    try {
      await invoke('bill-match-action', {
        action,
        transaction_id: transaction.transaction_id,
        bill_id: billId,
      });
      setMatchStatus(
        action === 'approve'
          ? 'Confirmed. The tracker uses the exact bank amount and learned this wording.'
          : 'Suggestion rejected and remembered.',
      );
      await loadReviewData();
    } catch (error) {
      setMatchStatus(error.message);
    }
  }

  const accountsById = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.account_id, a])),
    [accounts],
  );
  const mappingByCategory = useMemo(
    () => Object.fromEntries(mappings.map((m) => [m.bill_category, m.account_id])),
    [mappings],
  );

  const sorted = [...bills].sort((a, b) => {
    if (filters.trackerSort === 'monthlyDesc') return monthlyEq(b) - monthlyEq(a);
    if (filters.trackerSort === 'monthlyAsc') return monthlyEq(a) - monthlyEq(b);
    if (filters.trackerSort === 'balanceDesc') return clamp0(b.balance) - clamp0(a.balance);
    if (filters.trackerSort === 'balanceAsc') return clamp0(a.balance) - clamp0(b.balance);
    return (a.name || '').localeCompare(b.name || '');
  });

  const reviewBills = useMemo(() => {
    const end = new Date(year, nowMonth, 0);
    return [...bills]
      .filter((bill) => bill.match_mode !== 'off')
      .filter((bill) => Number(bill.overdue || 0) > 0 || nextDueFrom(bill) <= end)
      .sort((a, b) => {
        const ao = Number(a.overdue || 0);
        const bo = Number(b.overdue || 0);
        if (Boolean(ao) !== Boolean(bo)) return bo - ao;
        return nextDueFrom(a) - nextDueFrom(b);
      });
  }, [bills, year, nowMonth]);

  function accountIdFor(bill) {
    return bill.bank_account_id || mappingByCategory[bill.category] || '';
  }

  function matchFor(bill) {
    const rows = bankTransactions.filter(
      (tx) => inMonth(tx.date, currentMonth) &&
        (tx.matched_bill_id === bill.id || tx.suggested_bill_id === bill.id),
    );
    return rows.find(isConfirmedBillTransaction) || rows.find(isSuggestedBillTransaction) || null;
  }

  function monthCell(bill, month) {
    const mark = getMark(bill.id, year, month);
    const rows = transactionsForBillMonth(bill.id, year, month);
    const confirmed = rows.some(isConfirmedBillTransaction);
    const suggested = rows.some(isSuggestedBillTransaction);
    const past = month < nowMonth;
    const cls = confirmed || mark?.paid ? 'green' : suggested ? 'reviewBox' : past ? 'red' : '';
    return (
      <td key={month} className={`mcol ${month === nowMonth ? 'mNow' : ''}`}>
        <button className={`box ${cls}`} onClick={() => onMonth(bill, year, month)}>
          <span>${Math.round(monthlyEq(bill))}</span>
          {(confirmed || mark?.source === 'plaid') && <small>BANK</small>}
          {!confirmed && suggested && <small>REVIEW</small>}
        </button>
      </td>
    );
  }

  return (
    <section className="card">
      <SectionTitle>Tracker</SectionTitle>
      <div className="pad">
        <div className="trackerModeBar">
          <button className={mode === 'calendar' ? 'brand mini' : 'ghost mini'} onClick={() => setMode('calendar')}>Monthly tracker</button>
          <button className={mode === 'review' ? 'brand mini' : 'ghost mini'} onClick={() => setMode('review')}>Review bank matches</button>
        </div>

        {mode === 'review' ? (
          <>
            <div className="toolbar matchReviewHeader">
              <div>
                <h3>Past due + due this month</h3>
                <div className="help">Each bill is compared only with transactions from its assigned bank account.</div>
              </div>
              <button className="brand" onClick={findMatches} disabled={matching}>{matching ? 'Searching banks...' : 'Find bank transactions'}</button>
            </div>
            {matchStatus && <p className="statusMessage">{matchStatus}</p>}
            <div className="tableScroll">
              <table className="matchReviewTable">
                <thead><tr><th>Bill</th><th>Bank account</th><th>Expected</th><th>Due / overdue</th><th>Bank transaction</th><th>Bank amount</th><th>Confidence</th><th>Action</th></tr></thead>
                <tbody>
                  {reviewBills.map((bill) => {
                    const tx = matchFor(bill);
                    const confirmed = tx && isConfirmedBillTransaction(tx);
                    const suggested = tx && isSuggestedBillTransaction(tx);
                    const accountId = accountIdFor(bill);
                    return (
                      <tr key={bill.id} className={confirmed ? 'recognizedBillRow' : suggested ? 'suggestedBillRow' : ''}>
                        <td><strong>{bill.name}</strong><div className="help">{bill.category}</div></td>
                        <td>{accountId ? accountShortLabel(accountsById[accountId]) : <span className="warningText">No account assigned</span>}</td>
                        <td className="mono">{fmtMoney(bill.amount)}</td>
                        <td>{Number(bill.overdue || 0) > 0 ? <strong className="warningText">{fmtMoney(bill.overdue)} overdue</strong> : nextDueFrom(bill).toLocaleDateString()}</td>
                        <td>{tx ? <><strong>{transactionName(tx)}</strong><div className="help">{tx.date}</div></> : <span className="muted">No match found yet</span>}</td>
                        <td className="mono">{tx ? fmtMoney(Math.abs(Number(tx.amount) || 0)) : '—'}</td>
                        <td>{tx ? confidenceLabel(tx.match_confidence) || '—' : '—'}{tx?.match_reason && <div className="help">{tx.match_reason}</div>}</td>
                        <td>
                          {confirmed ? <span className="chip ok">Confirmed paid</span> : suggested ? (
                            <div className="actionStack">
                              <button className="brand mini" onClick={() => decide('approve', tx, bill.id)}>Yes, this is it</button>
                              <button className="ghost mini" onClick={() => decide('reject', tx, bill.id)}>No</button>
                            </div>
                          ) : <span className="muted">{accountId ? 'No suggestion yet' : 'Assign account first'}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="toolbar trackerTools">
              <label className="inlineLabel">Sort
                <select value={filters.trackerSort} onChange={(e) => setFilters({ ...filters, trackerSort: e.target.value })}>
                  <option value="alpha">Alphabetical</option>
                  <option value="monthlyDesc">Monthly High to Low</option>
                  <option value="monthlyAsc">Monthly Low to High</option>
                  <option value="balanceDesc">Balance High to Low</option>
                  <option value="balanceAsc">Balance Low to High</option>
                </select>
              </label>
              <div className="help">Green means paid. Yellow means a bank suggestion is waiting for review.</div>
            </div>
            <div className="trackerWrap">
              <table className="tracker compact">
                <thead><tr><th>Name / Actions</th><th>Cat.</th><th>Subcat.</th><th>Monthly</th><th>Ovd.</th><th>Bal.</th>{Array.from({ length: 12 }, (_, i) => <th key={i} className={`mhead mcol ${i + 1 === nowMonth ? 'mNow' : ''}`}>{monthNameShort(i + 1)}</th>)}</tr></thead>
                <tbody>{sorted.map((bill) => (
                  <tr key={bill.id} className="rowMain">
                    <td><div className="toolbar"><strong>{bill.name}</strong>{bill.autopay && <span className="autopayBadge">AUTOPAY</span>}<MatchModeLabel mode={bill.match_mode} compact /></div></td>
                    <td>{bill.category}</td><td>{bill.subcategory}</td><td className="mono">{fmtMoney(monthlyEq(bill))}</td><td>{fmtMoney(bill.overdue)}</td><td>{fmtMoney(bill.balance)}</td>
                    {Array.from({ length: 12 }, (_, i) => monthCell(bill, i + 1))}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
