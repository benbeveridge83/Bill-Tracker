import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { supabase } from './lib/supabaseClient';
import { addDays, clamp0, fmtMoney, today, toISO } from './lib/dates';
import { monthKey, monthNameShort, monthlyEq, nextDueFrom, periodKey, statusFor } from './lib/billMath';
import './styles.css';

const APP_VERSION = '0.2.0';

async function invokeFunction(name, options) {
  const { data, error } = await supabase.functions.invoke(name, options);
  if (!error) return data;
  let detail = '';
  try {
    const body = await error.context?.json();
    detail = body?.error || '';
  } catch {
    // Fall back to the client error below when the response is not JSON.
  }
  throw new Error(detail || error.message || `${name} failed`);
}

const blankBill = {
  name: '', category: 'Household', subcategory: '', amount: 0, frequency: 'monthly',
  anchor: toISO(today()), custom_days: null, autopay: false, overdue: 0, balance: 0,
  balance_as_of: '', portal_url: '', account: '', notes: '', current_as_of: '',
  cancel_requested: false, archived: false
};

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) return <div className="authWrap"><div className="muted">Loading...</div></div>;
  if (!session) return <Auth />;
  return <BillsApp session={session} />;
}

function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('login');
  const [message, setMessage] = useState('');

  async function submit() {
    setMessage('');
    const action = mode === 'login'
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.href.split('?')[0] } });
    const { error } = await action;
    if (error) setMessage(error.message);
    else setMessage(mode === 'login' ? 'Signed in.' : 'Check your email if confirmation is required.');
  }

  return <div className="authWrap">
    <div className="card authCard">
      <div className="pad">
        <div className="toolbar"><div className="logo">BB</div><div><h1>Bills & Budget</h1><div className="help">Secure bank sync · v{APP_VERSION}</div></div></div>
        <div className="row" style={{marginTop:16}}>
          <div><label>Email</label><input value={email} onChange={e=>setEmail(e.target.value)} /></div>
          <div><label>Password</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')submit();}} /></div>
        </div>
        <div className="toolbar" style={{marginTop:12}}>
          <button className="brand" onClick={submit}>{mode === 'login' ? 'Log in' : 'Create account'}</button>
          <button className="ghost" onClick={()=>setMode(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? 'Need an account?' : 'Already have an account?'}</button>
        </div>
        {message && <p className="help">{message}</p>}
      </div>
    </div>
  </div>;
}

function BillsApp({ session }) {
  const [bills, setBills] = useState([]);
  const [marks, setMarks] = useState([]);
  const [txns, setTxns] = useState([]);
  const [plaidTransactions, setPlaidTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [view, setView] = useState('dashboard');
  const [filters, setFilters] = useState({ category: 'all', status: 'any', autopay: 'all', search: '', sort: 'due', trackerSort: 'alpha' });
  const [editing, setEditing] = useState(null);
  const [paying, setPaying] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [plaidStatus, setPlaidStatus] = useState('');
  const [migrationStatus, setMigrationStatus] = useState('');
  const [migrating, setMigrating] = useState(false);

  function readLegacyData() {
    try {
      const profileId = localStorage.getItem('bb_current_profile');
      const key = profileId ? `billDB_v1:${profileId}` : 'billDB_v1';
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      if (!parsed || !Array.isArray(parsed.bills)) return null;
      return {
        bills: parsed.bills,
        marks: Array.isArray(parsed.monthMarks) ? parsed.monthMarks : [],
        logs: Array.isArray(parsed.txns) ? parsed.txns : []
      };
    } catch {
      return null;
    }
  }

  const legacyDataAvailable = !!readLegacyData()?.bills.length;

  async function loadAll() {
    const [b, m, t, a, p] = await Promise.all([
      supabase.from('bills').select('*').order('name'),
      supabase.from('bill_month_marks').select('*'),
      supabase.from('payment_logs').select('*').order('date', { ascending: false }).limit(500),
      supabase.from('plaid_accounts').select('*').order('name'),
      supabase.from('plaid_transactions').select('*').order('date', { ascending: false }).limit(500)
    ]);
    if (!b.error) setBills(b.data || []);
    if (!m.error) setMarks(m.data || []);
    if (!t.error) setTxns(t.data || []);
    if (!a.error) setAccounts(a.data || []);
    if (!p.error) setPlaidTransactions(p.data || []);
  }

  useEffect(() => { loadAll(); }, []);

  const visibleBills = useMemo(() => {
    return bills.filter(b => !b.archived)
      .filter(b => filters.category === 'all' || b.category === filters.category)
      .filter(b => filters.autopay === 'all' || (b.autopay ? 'yes' : 'no') === filters.autopay)
      .filter(b => !filters.search || `${b.name} ${b.subcategory} ${b.notes}`.toLowerCase().includes(filters.search.toLowerCase()))
      .filter(b => filters.status === 'any' || statusFor(b).code === filters.status)
      .sort((a,b) => {
        if (filters.sort === 'amountAsc') return monthlyEq(a) - monthlyEq(b);
        if (filters.sort === 'amountDesc') return monthlyEq(b) - monthlyEq(a);
        return statusFor(a).due - statusFor(b).due;
      });
  }, [bills, filters]);

  const kpis = useMemo(() => {
    const t = today();
    let overdueCnt = 0, dueAmt = 0, monthTotal = 0, paidTotal = 0, totOverdue = 0, totBalance = 0;
    visibleBills.forEach(b => {
      const st = statusFor(b);
      if (st.code === 'overdue') overdueCnt++;
      if (st.code === 'due') dueAmt += clamp0(b.amount);
      if (st.due.getMonth() === t.getMonth() && st.due.getFullYear() === t.getFullYear()) monthTotal += clamp0(b.amount);
      totOverdue += clamp0(b.overdue); totBalance += clamp0(b.balance);
    });
    txns.forEach(tx => { const d = new Date(tx.date); if (d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear()) paidTotal += clamp0(tx.amount); });
    return { overdueCnt, dueAmt, monthTotal, paidTotal, totOverdue, totBalance };
  }, [visibleBills, txns]);

  function getMark(billId, year, month) {
    return marks.find(m => m.key === monthKey(billId, year, month));
  }
  function isAutopayAutoPaid(bill, year, month) {
    if (!bill.autopay) return false;
    const t = today(); const y = t.getFullYear(); const m = t.getMonth() + 1;
    return year < y || (year === y && month <= m);
  }
  function isTrackerPaid(bill, year, month) { return !!getMark(bill.id, year, month)?.paid || isAutopayAutoPaid(bill, year, month); }

  async function markPaidThrough(bill, year, month) {
    const priorYear = year - 1;
    const rows = [];
    let newlyPaid = 0;
    for (let m = 1; m <= 12; m++) {
      if (!getMark(bill.id, priorYear, m)?.paid) newlyPaid++;
      rows.push({ user_id: session.user.id, bill_id: bill.id, key: monthKey(bill.id, priorYear, m), year: priorYear, month: m, paid: true, amount: monthlyEq(bill), date: toISO(today()) });
    }
    for (let m = 1; m <= month; m++) {
      if (!getMark(bill.id, year, m)?.paid) newlyPaid++;
      rows.push({ user_id: session.user.id, bill_id: bill.id, key: monthKey(bill.id, year, m), year, month: m, paid: true, amount: monthlyEq(bill), date: toISO(today()) });
    }
    await supabase.from('bill_month_marks').upsert(rows, { onConflict: 'user_id,key' });
    if (newlyPaid > 0) await supabase.from('payment_logs').insert({ user_id: session.user.id, bill_id: bill.id, date: toISO(today()), amount: newlyPaid * monthlyEq(bill), memo: `Tracker: paid through ${year}-${String(month).padStart(2,'0')}`, period_key: `trackerThrough:${year}-${String(month).padStart(2,'0')}` });
    setExpanded(prev => ({ ...prev, [bill.id]: false }));
    await loadAll();
  }

  async function saveBill(data) {
    const payload = { ...data, user_id: session.user.id, amount: clamp0(data.amount), overdue: clamp0(data.overdue), balance: clamp0(data.balance), custom_days: data.custom_days ? Number(data.custom_days) : null };
    if (payload.id) await supabase.from('bills').update(payload).eq('id', payload.id);
    else await supabase.from('bills').insert(payload);
    setEditing(null); await loadAll();
  }

  async function deleteBill(id) {
    if (!confirm('Delete this bill and related tracker/pay-log rows?')) return;
    await supabase.from('bills').delete().eq('id', id);
    setEditing(null); await loadAll();
  }

  async function markCurrent(b) {
    const d = toISO(today());
    const curDue = nextDueFrom(b);
    const nextDue = nextDueFrom(b, addDays(curDue, 1));
    await supabase.from('payment_logs').insert({ user_id: session.user.id, bill_id: b.id, date: d, amount: clamp0(b.amount), memo: 'Marked current', period_key: periodKey(b, curDue) });
    await supabase.from('bills').update({ last_paid: d, current_as_of: d, overdue: 0, balance: 0, balance_as_of: d, next_due: toISO(nextDue) }).eq('id', b.id);
    await loadAll();
  }

  async function savePartialPayment(form) {
    await supabase.from('payment_logs').insert({ user_id: session.user.id, bill_id: paying.id, date: form.date, amount: clamp0(form.amount), memo: form.memo || 'Partial payment', period_key: periodKey(paying) });
    const update = { last_paid: form.date, overdue: Math.max(0, clamp0(paying.overdue) - clamp0(form.amount)) };
    if (form.reduceBalance) { update.balance = Math.max(0, clamp0(paying.balance) - clamp0(form.amount)); update.balance_as_of = form.date; }
    await supabase.from('bills').update(update).eq('id', paying.id);
    setPaying(null); await loadAll();
  }

  async function connectPlaid() {
    setConnecting(true);
    setPlaidStatus('Starting secure bank connection…');
    try {
      if (!window.Plaid) throw new Error('Plaid Link did not load. Refresh the page and try again.');
      const data = await invokeFunction('plaid-create-link-token');
      const handler = window.Plaid.create({
        token: data.link_token,
        onSuccess: async (public_token, metadata) => {
          try {
            setPlaidStatus(`Finishing ${metadata.institution?.name || 'bank'} connection…`);
            await invokeFunction('plaid-exchange-public-token', {
              body: { public_token, institution: metadata.institution }
            });
            await loadAll();
            setPlaidStatus(`${metadata.accounts?.length || 0} account(s) connected successfully.`);
          } catch (error) {
            setPlaidStatus(error.message);
          } finally {
            setConnecting(false);
            handler.destroy();
          }
        },
        onExit: (error) => {
          if (error) setPlaidStatus(error.display_message || error.error_message || 'Bank connection was not completed.');
          else setPlaidStatus('Bank connection canceled.');
          setConnecting(false);
          handler.destroy();
        }
      });
      handler.open();
    } catch (error) {
      setPlaidStatus(error.message);
      setConnecting(false);
    }
  }

  async function syncPlaid() {
    setSyncing(true);
    setPlaidStatus('Refreshing balances and transactions…');
    try {
      const result = await invokeFunction('plaid-sync-transactions');
      await loadAll();
      setPlaidStatus(`Sync complete: ${result.imported} transaction update(s).`);
    } catch (error) {
      setPlaidStatus(error.message);
    } finally {
      setSyncing(false);
    }
  }

  async function disconnectPlaid(itemId) {
    if (!confirm('Disconnect this institution and remove its imported accounts and transactions?')) return;
    setPlaidStatus('Disconnecting institution…');
    try {
      await invokeFunction('plaid-disconnect-item', { body: { item_id: itemId } });
      await loadAll();
      setPlaidStatus('Institution disconnected.');
    } catch (error) {
      setPlaidStatus(error.message);
    }
  }

  async function importLegacyData() {
    const legacy = readLegacyData();
    if (!legacy?.bills.length) return setMigrationStatus('No existing Bills & Budget data was found in this browser.');
    if (bills.length) return setMigrationStatus('Import is available only when this account has no bills, which prevents duplicates.');
    if (!confirm(`Import ${legacy.bills.length} existing bill(s), ${legacy.marks.length} tracker mark(s), and ${legacy.logs.length} pay-log row(s) into this account?`)) return;

    setMigrating(true);
    setMigrationStatus('Importing existing browser data…');
    let insertedBillIds = [];
    try {
      const billRows = legacy.bills.map((bill, index) => ({
        user_id: session.user.id,
        legacy_id: String(bill.id || `legacy-${index}`),
        name: bill.name || 'Unnamed bill',
        category: bill.category || 'Household',
        subcategory: bill.subcategory || '',
        amount: clamp0(bill.amount),
        frequency: bill.frequency || 'monthly',
        anchor: bill.anchor || toISO(today()),
        custom_days: bill.customDays ? Number(bill.customDays) : null,
        autopay: bill.autopay === true || bill.autopay === 'yes',
        overdue: clamp0(bill.overdue),
        balance: clamp0(bill.balance),
        balance_as_of: bill.balanceAsOf || null,
        portal_url: bill.portalUrl || '',
        account: bill.account || '',
        notes: bill.notes || '',
        current_as_of: bill.currentAsOf || null,
        cancel_requested: !!bill.cancelRequested,
        cancel_at: bill.cancelAt || null,
        archived: !!bill.archived,
        archived_at: bill.archivedAt || null,
        mail_updated_at: bill.mailUpdatedAt || null
      }));
      const { data: insertedBills, error: billError } = await supabase.from('bills').insert(billRows).select('id,legacy_id');
      if (billError) throw billError;
      insertedBillIds = insertedBills.map(bill => bill.id);
      const idMap = Object.fromEntries(insertedBills.map(bill => [bill.legacy_id, bill.id]));

      const markRows = legacy.marks.flatMap(mark => {
        const billId = idMap[String(mark.billId)];
        const year = Number(mark.year); const month = Number(mark.month);
        if (!billId || !year || month < 1 || month > 12) return [];
        return [{
          user_id: session.user.id, bill_id: billId, key: monthKey(billId, year, month),
          year, month, paid: mark.paid !== false, amount: clamp0(mark.amount), date: mark.date || toISO(today())
        }];
      });
      for (let i = 0; i < markRows.length; i += 250) {
        const { error } = await supabase.from('bill_month_marks').insert(markRows.slice(i, i + 250));
        if (error) throw error;
      }

      const logRows = legacy.logs.flatMap(log => {
        const billId = idMap[String(log.billId)];
        if (!billId) return [];
        return [{
          user_id: session.user.id, bill_id: billId, date: log.date || toISO(today()),
          amount: clamp0(log.amount), memo: log.memo || 'Imported payment',
          period_key: log.periodKey || '', source: log.source || 'manual'
        }];
      });
      for (let i = 0; i < logRows.length; i += 250) {
        const { error } = await supabase.from('payment_logs').insert(logRows.slice(i, i + 250));
        if (error) throw error;
      }

      await loadAll();
      setMigrationStatus(`Imported ${billRows.length} bills, ${markRows.length} tracker marks, and ${logRows.length} pay-log rows.`);
    } catch (error) {
      if (insertedBillIds.length) {
        await supabase.from('payment_logs').delete().in('bill_id', insertedBillIds);
        await supabase.from('bill_month_marks').delete().in('bill_id', insertedBillIds);
        await supabase.from('bills').delete().in('id', insertedBillIds);
      }
      setMigrationStatus(`Import stopped and rolled back: ${error.message}`);
    } finally {
      setMigrating(false);
    }
  }

  async function signOut() { await supabase.auth.signOut(); }

  return <>
    <header className="toolbar">
      <div className="toolbar"><div className="logo">BB</div><div><h1>Bills & Budget</h1><div className="help">{session.user.email} · v{APP_VERSION}</div></div></div>
      <div className="right toolbar">
        {['dashboard','tracker','paylog','summary','plaid'].map(v => <button key={v} className="ghost mini" onClick={()=>setView(v)}>{v === 'paylog' ? 'Pay Log' : v[0].toUpperCase() + v.slice(1)}</button>)}
        <select value={filters.category} onChange={e=>setFilters({...filters, category:e.target.value})}><option value="all">All</option><option>Household</option><option>Business</option></select>
        <select value={filters.status} onChange={e=>setFilters({...filters, status:e.target.value})}><option value="any">Any</option><option value="current">Current</option><option value="overdue">Overdue</option><option value="due">Due</option><option value="future">Future</option><option value="cancel">Need to cancel</option></select>
        <select value={filters.autopay} onChange={e=>setFilters({...filters, autopay:e.target.value})}><option value="all">All bills</option><option value="yes">Autopay only</option><option value="no">Manual pay only</option></select>
        <button className="ghost mini" onClick={signOut}>Sign out</button>
      </div>
    </header>
    <main>
      {view === 'dashboard' && <Dashboard kpis={kpis} bills={visibleBills} filters={filters} setFilters={setFilters} onEdit={setEditing} onAdd={()=>setEditing(blankBill)} onCurrent={markCurrent} onPartial={setPaying} onImport={importLegacyData} legacyDataAvailable={legacyDataAvailable} migrating={migrating} migrationStatus={migrationStatus} />}
      {view === 'tracker' && <Tracker bills={visibleBills} filters={filters} setFilters={setFilters} marks={marks} expanded={expanded} setExpanded={setExpanded} isTrackerPaid={isTrackerPaid} isAutopayAutoPaid={isAutopayAutoPaid} markPaidThrough={markPaidThrough} />}
      {view === 'paylog' && <PayLog txns={txns} bills={bills} />}
      {view === 'summary' && <Summary bills={visibleBills} />}
      {view === 'plaid' && <PlaidPanel accounts={accounts} transactions={plaidTransactions} bills={bills} onConnect={connectPlaid} onSync={syncPlaid} onDisconnect={disconnectPlaid} syncing={syncing} connecting={connecting} status={plaidStatus} />}
    </main>
    {editing && <BillDialog bill={editing} onClose={()=>setEditing(null)} onSave={saveBill} onDelete={deleteBill} />}
    {paying && <PartialDialog bill={paying} onClose={()=>setPaying(null)} onSave={savePartialPayment} />}
  </>;
}

function Dashboard({ kpis, bills, filters, setFilters, onEdit, onAdd, onCurrent, onPartial, onImport, legacyDataAvailable, migrating, migrationStatus }) {
  return <section>
    <h2>Overview</h2>
    <div className="kpi">
      <K label="Overdue count" value={kpis.overdueCnt} /><K label="Due in 7 days" value={fmtMoney(kpis.dueAmt)} /><K label="Month total" value={fmtMoney(kpis.monthTotal)} /><K label="Paid this month" value={fmtMoney(kpis.paidTotal)} /><K label="Total overdue" value={fmtMoney(kpis.totOverdue)} /><K label="Total balance" value={fmtMoney(kpis.totBalance)} />
    </div>
    <div className="pad" />
    <div className="card"><h2 style={{padding:'12px 16px',margin:0,borderBottom:'1px solid var(--line)'}}>Bills</h2><div className="pad">
      <div className="toolbar" style={{marginBottom:10}}><input placeholder="Search by name / subcategory / notes" value={filters.search} onChange={e=>setFilters({...filters, search:e.target.value})} /><select value={filters.sort} onChange={e=>setFilters({...filters, sort:e.target.value})}><option value="due">Due date</option><option value="amountDesc">Amount: High to Low</option><option value="amountAsc">Amount: Low to High</option></select><button className="brand" onClick={onAdd}>Add bill</button>{legacyDataAvailable && <button className="ghost" onClick={onImport} disabled={migrating}>{migrating ? 'Importing…' : 'Import existing browser data'}</button>}</div>
      {migrationStatus && <p className="statusMessage" role="status">{migrationStatus}</p>}
      <div style={{overflow:'auto',border:'1px solid var(--line)',borderRadius:14}}><table><thead><tr><th>Name</th><th>Cat.</th><th>Subcat.</th><th>Amount</th><th>Ovd.</th><th>Bal.</th><th>Due</th><th>Status</th><th>Actions</th></tr></thead><tbody>{bills.map(b => { const st = statusFor(b); return <tr key={b.id}><td><strong>{b.name}</strong><div className="help">{b.notes}</div>{b.autopay && <span className="autopayBadge">AUTO</span>}</td><td>{b.category}</td><td>{b.subcategory}</td><td className="mono">{fmtMoney(b.amount)}</td><td className="mono">{fmtMoney(b.overdue)}</td><td className="mono">{fmtMoney(b.balance)}</td><td>{toISO(st.due)}</td><td><span className={`chip ${st.code==='overdue'?'over':st.code==='due'?'due':st.code==='cancel'?'pend':'ok'}`}>{st.label}</span></td><td><div className="toolbar"><button className="ghost mini" onClick={()=>onEdit(b)}>Edit</button>{b.portal_url && <button className="ghost mini" onClick={()=>window.open(b.portal_url,'_blank')}>Portal</button>}<button className="ghost mini" onClick={()=>onCurrent(b)}>Current</button><button className="ghost mini" onClick={()=>onPartial(b)}>Partial</button></div></td></tr>; })}</tbody></table></div>
    </div></div>
  </section>;
}
function K({ label, value }) { return <div className="k"><div className="muted">{label}</div><strong>{value}</strong></div>; }

function Tracker({ bills, filters, setFilters, expanded, setExpanded, isTrackerPaid, isAutopayAutoPaid, markPaidThrough }) {
  const y = today().getFullYear(); const prevY = y - 1; const nowM = today().getMonth() + 1;
  const sorted = [...bills].sort((a,b) => {
    const key = filters.trackerSort;
    if (key === 'monthlyDesc') return monthlyEq(b) - monthlyEq(a);
    if (key === 'monthlyAsc') return monthlyEq(a) - monthlyEq(b);
    if (key === 'balanceDesc') return clamp0(b.balance) - clamp0(a.balance);
    if (key === 'balanceAsc') return clamp0(a.balance) - clamp0(b.balance);
    return (a.name || '').localeCompare(b.name || '');
  });
  return <section className="card"><h2 style={{padding:'12px 16px',margin:0,borderBottom:'1px solid var(--line)'}}>Tracker</h2><div className="pad">
    <div className="toolbar" style={{marginBottom:8}}><label style={{display:'inline-flex',alignItems:'center',gap:6}}>Sort <select value={filters.trackerSort} onChange={e=>setFilters({...filters, trackerSort:e.target.value})}><option value="alpha">Alphabetical</option><option value="monthlyDesc">Monthly High to Low</option><option value="monthlyAsc">Monthly Low to High</option><option value="balanceDesc">Balance High to Low</option><option value="balanceAsc">Balance Low to High</option></select></label><div className="help">Click a month to mark paid through that month. Autopay turns green with dark outline.</div></div>
    <div className="trackerWrap"><table className="tracker compact"><thead><tr><th>Name / Actions</th><th>Cat.</th><th>Subcat.</th><th>Monthly</th><th>Ovd.</th><th>Bal.</th>{Array.from({length:12},(_,i)=><th key={i} className={`mhead mcol ${i+1===nowM?'mNow':''}`}>{monthNameShort(i+1)}</th>)}</tr></thead><tbody>{sorted.map(b => <React.Fragment key={b.id}><tr className="rowMain"><td><div className="toolbar"><strong>{b.name}</strong>{b.autopay && <span className="autopayBadge">AUTO</span>}<button className="ghost mini" onClick={()=>setExpanded({...expanded,[b.id]:!expanded[b.id]})}>{expanded[b.id]?'Hide prior year':'Show prior year'}</button></div></td><td>{b.category}</td><td>{b.subcategory}</td><td className="mono">{fmtMoney(monthlyEq(b))}</td><td>{fmtMoney(b.overdue)}</td><td>{fmtMoney(b.balance)}</td>{Array.from({length:12},(_,i)=>{ const m=i+1; const auto=isAutopayAutoPaid(b,y,m); const paid=isTrackerPaid(b,y,m); const past=m<nowM; return <td key={m} className={`mcol ${m===nowM?'mNow':''}`}><button className={`box ${auto?'autopayGreen':paid?'green':past?'red':''}`} onClick={()=>markPaidThrough(b,y,m)}>{Math.round(monthlyEq(b)) ? '$'+Math.round(monthlyEq(b)) : '$0'}</button></td>; })}</tr>{expanded[b.id] && <tr className="prevRow"><td>Prior year ({prevY})</td><td></td><td></td><td>{fmtMoney(monthlyEq(b))}</td><td>{fmtMoney(b.overdue)}</td><td>{fmtMoney(b.balance)}</td>{Array.from({length:12},(_,i)=>{ const m=i+1; const auto=isAutopayAutoPaid(b,prevY,m); const paid=isTrackerPaid(b,prevY,m); return <td key={m} className="mcol"><span className={`box ${auto?'autopayGreen':paid?'green':'red'}`}>{Math.round(monthlyEq(b)) ? '$'+Math.round(monthlyEq(b)) : '$0'}</span></td>; })}</tr>}</React.Fragment>)}</tbody></table></div>
  </div></section>;
}

function PayLog({ txns, bills }) { const byId = Object.fromEntries(bills.map(b=>[b.id,b])); return <section className="card"><h2 style={{padding:'12px 16px',margin:0,borderBottom:'1px solid var(--line)'}}>Pay Log</h2><div className="pad"><table className="compact"><thead><tr><th>Date</th><th>Bill</th><th>Amount</th><th>Memo</th></tr></thead><tbody>{txns.map(t=><tr key={t.id}><td>{t.date}</td><td>{byId[t.bill_id]?.name || '(deleted)'}</td><td>{fmtMoney(t.amount)}</td><td>{t.memo}</td></tr>)}</tbody></table></div></section>; }
function Summary({ bills }) { return <section className="card"><h2 style={{padding:'12px 16px',margin:0,borderBottom:'1px solid var(--line)'}}>Summary</h2><div className="pad"><table className="compact"><thead><tr><th>Name</th><th>Cat.</th><th>Subcat.</th><th>Monthly</th><th>Overdue</th><th>Balance</th><th>Status</th></tr></thead><tbody>{bills.map(b=>{ const st=statusFor(b); return <tr key={b.id} className={b.cancel_requested?'cancelRow':st.code==='overdue'?'pastDueRow':st.code==='current'?'currentRow':''}><td><strong>{b.name}</strong></td><td>{b.category}</td><td>{b.subcategory}</td><td>{fmtMoney(monthlyEq(b))}</td><td>{fmtMoney(b.overdue)}</td><td>{fmtMoney(b.balance)}</td><td>{st.label}</td></tr>;})}</tbody></table></div></section>; }

function PlaidPanel({ accounts, transactions, bills, onConnect, onSync, onDisconnect, syncing, connecting, status }) {
  const billsById = Object.fromEntries(bills.map(bill => [bill.id, bill.name]));
  const itemIds = [...new Set(accounts.map(account => account.item_id))];
  return <section className="card"><h2 style={{padding:'12px 16px',margin:0,borderBottom:'1px solid var(--line)'}}>Bank connections</h2><div className="pad"><div className="toolbar"><button className="brand" onClick={onConnect} disabled={connecting}>{connecting?'Connecting…':'Connect bank account'}</button><button className="ghost" onClick={onSync} disabled={syncing || !accounts.length}>{syncing?'Syncing…':'Sync balances & transactions'}</button>{itemIds.map(itemId=><button className="destr mini" key={itemId} onClick={()=>onDisconnect(itemId)}>Disconnect {accounts.find(a=>a.item_id===itemId)?.institution_name || 'institution'}</button>)}</div>{status && <p className="statusMessage" role="status">{status}</p>}<p className="help">Your Plaid access tokens stay in the protected server database and are never sent to this browser. Suggested bill matches do not automatically mark a bill paid.</p><h3>Connected accounts</h3>{accounts.length ? <div className="tableScroll"><table className="compact"><thead><tr><th>Institution</th><th>Name</th><th>Subtype</th><th>Mask</th><th>Available</th><th>Current</th></tr></thead><tbody>{accounts.map(a=><tr key={a.id}><td>{a.institution_name || '—'}</td><td>{a.name}</td><td>{a.subtype}</td><td>{a.mask ? `•••• ${a.mask}` : '—'}</td><td>{a.available_balance == null ? '—' : fmtMoney(a.available_balance)}</td><td>{a.current_balance == null ? '—' : fmtMoney(a.current_balance)}</td></tr>)}</tbody></table></div> : <p className="emptyState">No bank accounts connected yet.</p>}<h3>Recent imported transactions</h3>{transactions.length ? <div className="tableScroll"><table className="compact"><thead><tr><th>Date</th><th>Name</th><th>Amount</th><th>Status</th><th>Suggested bill</th></tr></thead><tbody>{transactions.slice(0,50).map(t=><tr key={t.id}><td>{t.date}</td><td>{t.merchant_name || t.name}</td><td>{fmtMoney(Math.abs(Number(t.amount)))}</td><td>{t.pending ? 'Pending' : 'Posted'}</td><td>{billsById[t.matched_bill_id] || '—'}</td></tr>)}</tbody></table></div> : <p className="emptyState">Connect an account, then sync to import transactions.</p>}</div></section>;
}

function BillDialog({ bill, onClose, onSave, onDelete }) {
  const [f, setF] = useState({ ...blankBill, ...bill });
  const set = (k,v) => setF(prev => ({ ...prev, [k]: v }));
  return <div className="dialogBackdrop"><div className="dialog"><h2 style={{padding:'12px 16px',margin:0,borderBottom:'1px solid var(--line)'}}>Bill</h2><div className="pad"><div className="row"><div><label>Name</label><input value={f.name} onChange={e=>set('name',e.target.value)} /></div><div><label>Category</label><select value={f.category} onChange={e=>set('category',e.target.value)}><option>Household</option><option>Business</option></select></div></div><div className="row"><div><label>Subcategory</label><input value={f.subcategory || ''} onChange={e=>set('subcategory',e.target.value)} /></div><div><label>Amount</label><input type="number" value={f.amount || ''} onChange={e=>set('amount',e.target.value)} /></div></div><div className="row"><div><label>Frequency</label><select value={f.frequency} onChange={e=>set('frequency',e.target.value)}><option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="quarterly">Quarterly</option><option value="weekly">Weekly</option><option value="custom">Custom days</option></select></div><div><label>Anchor / next due</label><input type="date" value={f.anchor || ''} onChange={e=>set('anchor',e.target.value)} /></div></div><div className="row"><div><label>Custom days</label><input type="number" value={f.custom_days || ''} onChange={e=>set('custom_days',e.target.value)} /></div><div><label>Autopay?</label><select value={f.autopay ? 'yes' : 'no'} onChange={e=>set('autopay', e.target.value==='yes')}><option value="no">No</option><option value="yes">Yes</option></select></div></div><div className="row"><div><label>Overdue</label><input type="number" value={f.overdue || ''} onChange={e=>set('overdue',e.target.value)} /></div><div><label>Balance</label><input type="number" value={f.balance || ''} onChange={e=>set('balance',e.target.value)} /></div></div><div className="row"><div><label>Portal URL</label><input value={f.portal_url || ''} onChange={e=>set('portal_url',e.target.value)} /></div><div><label>Notes / match keywords</label><input value={f.notes || ''} onChange={e=>set('notes',e.target.value)} /></div></div><div className="toolbar" style={{marginTop:12}}><button className="brand" onClick={()=>onSave(f)}>Save</button><button className="ghost" onClick={onClose}>Close</button>{f.id && <button className="destr right" onClick={()=>onDelete(f.id)}>Delete</button>}</div></div></div></div>;
}

function PartialDialog({ bill, onClose, onSave }) { const [f,setF]=useState({date:toISO(today()),amount:'',memo:'',reduceBalance:true}); return <div className="dialogBackdrop"><div className="dialog"><h2 style={{padding:'12px 16px',margin:0,borderBottom:'1px solid var(--line)'}}>Partial Payment - {bill.name}</h2><div className="pad"><div className="row"><div><label>Date</label><input type="date" value={f.date} onChange={e=>setF({...f,date:e.target.value})}/></div><div><label>Amount</label><input type="number" value={f.amount} onChange={e=>setF({...f,amount:e.target.value})}/></div></div><div><label>Memo</label><input value={f.memo} onChange={e=>setF({...f,memo:e.target.value})}/></div><label style={{display:'inline-flex',gap:8,marginTop:10}}><input type="checkbox" checked={f.reduceBalance} onChange={e=>setF({...f,reduceBalance:e.target.checked})}/> Also reduce balance</label><div className="toolbar" style={{marginTop:12}}><button className="brand" onClick={()=>onSave(f)}>Save</button><button className="ghost" onClick={onClose}>Close</button></div></div></div></div>; }

createRoot(document.getElementById('root')).render(<App />);
