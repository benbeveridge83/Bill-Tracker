import React, { useEffect, useMemo, useRef, useState } from 'react';
import { clamp0, fmtMoney, today } from '../lib/dates';
import { monthNameShort, monthlyEq } from '../lib/billMath';
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

function legacyTrackerMarksForBills(bills) {
  try {
    const billByLegacyId = new Map(
      bills
        .filter((bill) => bill.legacy_id)
        .map((bill) => [String(bill.legacy_id), bill]),
    );

    if (!billByLegacyId.size) return [];

    const keys = [];
    const currentProfileId = localStorage.getItem('bb_current_profile');
    if (currentProfileId) keys.push(`billDB_v1:${currentProfileId}`);
    keys.push('billDB_v1');

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('billDB_v1:') && !keys.includes(key)) keys.push(key);
    }

    let best = [];

    for (const key of keys) {
      let parsed = null;
      try {
        parsed = JSON.parse(localStorage.getItem(key) || 'null');
      } catch {
        parsed = null;
      }

      if (!parsed || !Array.isArray(parsed.monthMarks)) continue;

      const rows = parsed.monthMarks.flatMap((mark) => {
        if (!mark || mark.paid === false) return [];
        const bill = billByLegacyId.get(String(mark.billId || ''));
        const year = Number(mark.year);
        const month = Number(mark.month);
        if (!bill || !year || month < 1 || month > 12) return [];

        return [{
          bill_id: bill.id,
          year,
          month,
          paid: true,
          amount: Number(mark.amount) || monthlyEq(bill),
          date: mark.date || new Date().toISOString().slice(0, 10),
          source: 'legacy-browser',
          legacy_key: mark.key || `${mark.billId}:${year}:${month}`,
        }];
      });

      if (rows.length > best.length) best = rows;
    }

    return best;
  } catch {
    return [];
  }
}

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
  const [historyStatus, setHistoryStatus] = useState('');
  const restoreAttempted = useRef(false);

  const legacyPaidMarks = useMemo(
    () => legacyTrackerMarksForBills(bills),
    [bills],
  );

  const legacyMarkByKey = useMemo(
    () => Object.fromEntries(
      legacyPaidMarks.map((mark) => [
        `${mark.bill_id}:${mark.year}:${mark.month}`,
        mark,
      ]),
    ),
    [legacyPaidMarks],
  );

  function effectiveMark(bill, markYear, month) {
    return getMark(bill.id, markYear, month)
      || legacyMarkByKey[`${bill.id}:${markYear}:${month}`]
      || null;
  }

  useEffect(() => {
    if (restoreAttempted.current || !legacyPaidMarks.length) return;
    restoreAttempted.current = true;

    async function restoreHistory() {
      try {
        const { data, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!data.user) return;

        const missing = legacyPaidMarks.filter(
          (mark) => !getMark(mark.bill_id, mark.year, mark.month),
        );

        if (!missing.length) return;

        const rows = missing.map((mark) => ({
          user_id: data.user.id,
          bill_id: mark.bill_id,
          key: `${mark.bill_id}:${mark.year}:${mark.month}`,
          year: mark.year,
          month: mark.month,
          paid: true,
          amount: mark.amount,
          date: mark.date,
          source: 'manual',
        }));

        const { error } = await supabase
          .from('bill_month_marks')
          .upsert(rows, {
            onConflict: 'user_id,key',
            ignoreDuplicates: true,
          });

        if (error) throw error;

        setHistoryStatus(
          `Restored ${rows.length} previously paid tracker month${rows.length === 1 ? '' : 's'} from your original tracker.`,
        );
      } catch (error) {
        setHistoryStatus(`Could not restore old tracker history automatically: ${error.message}`);
      }
    }

    restoreHistory();
  }, [legacyPaidMarks]);

  async function loadReviewData() {
    const start = `${year}-01-01`;
    const lastDay = new Date(year, nowMonth, 0).toISOString().slice(0, 10);
    const [a, m, t] = await Promise.all([
      supabase.from('plaid_accounts').select('*').order('name'),
      supabase.from('category_account_mappings').select('*'),
      supabase.from('plaid_transactions').select('*')
        .gte('date', start).lte('date', lastDay)
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

  const accountsById = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.account_id, a])),
    [accounts],
  );

  const mappingByCategory = useMemo(
    () => Object.fromEntries(mappings.map((m) => [m.bill_category, m.account_id])),
    [mappings],
  );

  function accountIdFor(bill) {
    return bill.bank_account_id || mappingByCategory[bill.category] || '';
  }

  function matchFor(bill, month) {
    const monthValue = `${year}-${String(month).padStart(2, '0')}`;
    const rows = bankTransactions.filter(
      (tx) => inMonth(tx.date, monthValue)
        && (tx.matched_bill_id === bill.id || tx.suggested_bill_id === bill.id),
    );
    return rows.find(isConfirmedBillTransaction) || rows.find(isSuggestedBillTransaction) || null;
  }

  const sorted = [...bills].sort((a, b) => {
    if (filters.trackerSort === 'monthlyDesc') return monthlyEq(b) - monthlyEq(a);
    if (filters.trackerSort === 'monthlyAsc') return monthlyEq(a) - monthlyEq(b);
    if (filters.trackerSort === 'balanceDesc') return clamp0(b.balance) - clamp0(a.balance);
    if (filters.trackerSort === 'balanceAsc') return clamp0(a.balance) - clamp0(b.balance);
    return (a.name || '').localeCompare(b.name || '');
  });

  const outstandingRows = useMemo(() => {
    const rows = [];

    for (const bill of bills) {
      if (bill.match_mode === 'off') continue;

      for (let month = 1; month <= nowMonth; month += 1) {
        const paid = Boolean(effectiveMark(bill, year, month)?.paid);
        const tx = matchFor(bill, month);
        const confirmed = Boolean(tx && isConfirmedBillTransaction(tx));
        if (paid || confirmed) continue;

        rows.push({
          bill,
          month,
          monthValue: `${year}-${String(month).padStart(2, '0')}`,
          tx,
        });
      }
    }

    return rows.sort((left, right) => {
      if (left.month !== right.month) return left.month - right.month;
      return (left.bill.name || '').localeCompare(right.bill.name || '');
    });
  }, [bills, bankTransactions, legacyMarkByKey, nowMonth, year]);

  async function findMatches() {
    const monthsToCheck = [...new Set(outstandingRows.map((row) => row.monthValue))];

    if (!monthsToCheck.length) {
      setMatchStatus('There are no unpaid tracker months to match.');
      return;
    }

    setMatching(true);
    setMatchStatus(`Looking for bank transactions in ${monthsToCheck.length} unpaid month${monthsToCheck.length === 1 ? '' : 's'}...`);

    try {
      let local = 0;
      let ai = 0;
      let automatic = 0;
      const notes = [];

      for (const month of monthsToCheck) {
        const data = await invoke('ai-match-bills', {
          month,
          category: filters.category,
        });
        local += Number(data?.local_suggestions || 0);
        ai += Number(data?.ai_suggestions || 0);
        automatic += Number(data?.automatic_matches || 0);
        if (data?.message && data.message !== 'Matching complete.') notes.push(data.message);
      }

      setMatchStatus(
        `Matching complete across ${monthsToCheck.length} month${monthsToCheck.length === 1 ? '' : 's'}: ${local} local suggestion(s), ${ai} AI suggestion(s), ${automatic} automatic match(es).${notes.length ? ` ${notes[0]}` : ''}`,
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

  function monthCell(bill, month) {
    const mark = effectiveMark(bill, year, month);
    const rows = transactionsForBillMonth(bill.id, year, month);
    const confirmed = rows.some(isConfirmedBillTransaction);
    const suggested = rows.some(isSuggestedBillTransaction);
    const past = month < nowMonth;
    const cls = confirmed || mark?.paid ? 'green' : suggested ? 'reviewBox' : past ? 'red' : '';
    return (
      <td key={month} className={`mcol ${month === nowMonth ? 'mNow' : ''}`}>
        <button className={`box ${cls}`} onClick={() => onMonth(bill, year, month)}>
          <span>${Math.round(monthlyEq(bill))}</span>
          {confirmed && <small>BANK</small>}
          {!confirmed && mark?.source === 'plaid' && <small>BANK</small>}
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

        {historyStatus && <p className="statusMessage">{historyStatus}</p>}

        {mode === 'review' ? (
          <>
            <div className="toolbar matchReviewHeader">
              <div>
                <h3>Unpaid tracker months through {monthNameShort(nowMonth)} {year}</h3>
                <div className="help">Only tracker months that are not already marked paid appear here. Each row is compared only with transactions from that bill's assigned bank account and matching month.</div>
              </div>
              <button className="brand" onClick={findMatches} disabled={matching}>{matching ? 'Searching banks...' : 'Find bank transactions'}</button>
            </div>
            {matchStatus && <p className="statusMessage">{matchStatus}</p>}
            <div className="tableScroll">
              <table className="matchReviewTable">
                <thead><tr><th>Month</th><th>Bill</th><th>Bank account</th><th>Expected</th><th>Bank transaction</th><th>Bank amount</th><th>Confidence</th><th>Action</th></tr></thead>
                <tbody>
                  {outstandingRows.map(({ bill, month, tx }) => {
                    const suggested = tx && isSuggestedBillTransaction(tx);
                    const accountId = accountIdFor(bill);
                    return (
                      <tr key={`${bill.id}:${year}:${month}`} className={suggested ? 'suggestedBillRow' : ''}>
                        <td><strong>{monthNameShort(month)} {year}</strong></td>
                        <td><strong>{bill.name}</strong><div className="help">{bill.category}</div></td>
                        <td>{accountId ? accountShortLabel(accountsById[accountId]) : <span className="warningText">No account assigned</span>}</td>
                        <td className="mono">{fmtMoney(monthlyEq(bill))}</td>
                        <td>{tx ? <><strong>{transactionName(tx)}</strong><div className="help">{tx.date}</div></> : <span className="muted">No match found yet</span>}</td>
                        <td className="mono">{tx ? fmtMoney(Math.abs(Number(tx.amount) || 0)) : '—'}</td>
                        <td>{tx ? confidenceLabel(tx.match_confidence) || '—' : '—'}{tx?.match_reason && <div className="help">{tx.match_reason}</div>}</td>
                        <td>
                          {suggested ? (
                            <div className="actionStack">
                              <button className="brand mini" onClick={() => decide('approve', tx, bill.id)}>Yes, this is it</button>
                              <button className="ghost mini" onClick={() => decide('reject', tx, bill.id)}>No</button>
                            </div>
                          ) : <span className="muted">{accountId ? 'No suggestion yet' : 'Assign account first'}</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {!outstandingRows.length && (
                    <tr><td colSpan="8" className="emptyState">Every tracker month through this month is already marked paid.</td></tr>
                  )}
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
              <div className="help">Green means paid. Yellow means a bank suggestion is waiting for review. Existing paid history is preserved; bank matching only fills unpaid months.</div>
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
