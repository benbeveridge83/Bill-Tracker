import React, { useEffect, useState } from 'react';
import { fmtMoney } from '../lib/dates';
import { accountLabel, transactionName } from '../lib/bank';
import { supabase } from '../lib/supabaseClient';
import { SectionTitle } from './ui';

const BILL_CATEGORIES = ['Household', 'Business'];

function AccountRow({ account, onSaved }) {
  const [name, setName] = useState(account.display_name || '');
  useEffect(() => setName(account.display_name || ''), [account.display_name]);

  async function save(changes) {
    const { error } = await supabase
      .from('plaid_accounts')
      .update(changes)
      .eq('account_id', account.account_id);
    if (error) return alert(error.message);
    onSaved?.();
  }

  return (
    <tr>
      <td>{account.institution_name || '—'}</td>
      <td>{account.name || account.official_name || 'Account'}</td>
      <td><input className="accountNameInput" value={name} placeholder="Custom account name" onChange={(e) => setName(e.target.value)} /></td>
      <td>{account.mask ? `•••• ${account.mask}` : '—'}</td>
      <td>{account.available_balance == null ? '—' : fmtMoney(account.available_balance)}</td>
      <td>{account.current_balance == null ? '—' : fmtMoney(account.current_balance)}</td>
      <td><span className={`chip ${account.is_hidden ? 'neutral' : 'ok'}`}>{account.is_hidden ? 'Hidden' : 'Shown'}</span></td>
      <td><div className="toolbar">
        <button className="ghost mini" onClick={() => save({ display_name: name.trim() || null })}>Save name</button>
        <button className="ghost mini" onClick={() => save({ is_hidden: !account.is_hidden })}>{account.is_hidden ? 'Show account' : 'Hide account'}</button>
      </div></td>
    </tr>
  );
}

export default function PlaidPanel({
  accounts,
  transactions,
  bills,
  mappings,
  matchRules,
  onConnect,
  onSync,
  onDisconnect,
  onMapping,
  syncing,
  connecting,
  status,
}) {
  const [refresh, setRefresh] = useState(0);
  const [localAccounts, setLocalAccounts] = useState(accounts);
  const [localBills, setLocalBills] = useState(bills);

  useEffect(() => setLocalAccounts(accounts), [accounts]);
  useEffect(() => setLocalBills(bills), [bills]);

  async function reloadSettings() {
    const [a, b] = await Promise.all([
      supabase.from('plaid_accounts').select('*').order('name'),
      supabase.from('bills').select('*').eq('archived', false).order('name'),
    ]);
    if (!a.error) setLocalAccounts(a.data || []);
    if (!b.error) setLocalBills(b.data || []);
    setRefresh((value) => value + 1);
  }

  async function assignBill(bill, accountId) {
    const { error } = await supabase
      .from('bills')
      .update({ bank_account_id: accountId || null, account: accountId || '' })
      .eq('id', bill.id);
    if (error) return alert(error.message);
    await reloadSettings();
  }

  function mappingFor(category) {
    return mappings.find((m) => m.bill_category === category)?.account_id || '';
  }

  const itemIds = [...new Set(localAccounts.map((account) => account.item_id))];
  const billsById = Object.fromEntries(localBills.map((bill) => [bill.id, bill.name]));

  return (
    <section className="card" key={refresh}>
      <SectionTitle>Settings · Bank accounts</SectionTitle>
      <div className="pad">
        <div className="toolbar">
          <button className="brand" onClick={onConnect} disabled={connecting}>{connecting ? 'Connecting...' : 'Connect bank account'}</button>
          <button className="ghost" onClick={onSync} disabled={syncing || !localAccounts.length}>{syncing ? 'Syncing...' : 'Sync balances & transactions'}</button>
          {itemIds.map((itemId) => (
            <button className="destr mini" key={itemId} onClick={() => onDisconnect(itemId)}>
              Disconnect {localAccounts.find((a) => a.item_id === itemId)?.institution_name || 'institution'}
            </button>
          ))}
        </div>
        {status && <p className="statusMessage">{status}</p>}

        <h3>Default bank account by bill category</h3>
        <div className="mappingGrid">
          {BILL_CATEGORIES.map((category) => (
            <div className="mappingCard" key={category}>
              <label>{category} bills default to</label>
              <select value={mappingFor(category)} onChange={(e) => onMapping(category, e.target.value)}>
                <option value="">Not assigned</option>
                {localAccounts.map((account) => <option key={account.account_id} value={account.account_id}>{accountLabel(account)}</option>)}
              </select>
              <div className="help">New bills use this account unless you override the individual bill below.</div>
            </div>
          ))}
        </div>

        <h3>Connected account settings</h3>
        <p className="help">Rename an account or hide it from normal account/transaction views without disconnecting Plaid.</p>
        <div className="tableScroll">
          <table className="compact accountSettingsTable">
            <thead><tr><th>Institution</th><th>Bank name</th><th>Your name</th><th>Mask</th><th>Available</th><th>Current</th><th>Visibility</th><th>Actions</th></tr></thead>
            <tbody>{localAccounts.map((account) => <AccountRow key={account.account_id} account={account} onSaved={reloadSettings} />)}</tbody>
          </table>
        </div>

        <h3>Bank account for each bill</h3>
        <p className="help">Every bill can override its category default. Bill matching will search only the selected account.</p>
        <div className="tableScroll">
          <table className="compact">
            <thead><tr><th>Bill</th><th>Category</th><th>Bank account used for matching</th></tr></thead>
            <tbody>{localBills.map((bill) => {
              const effective = bill.bank_account_id || mappingFor(bill.category);
              return (
                <tr key={bill.id}>
                  <td><strong>{bill.name}</strong></td>
                  <td>{bill.category}</td>
                  <td><select value={effective || ''} onChange={(e) => assignBill(bill, e.target.value)}>
                    <option value="">No account assigned</option>
                    {localAccounts.map((account) => <option key={account.account_id} value={account.account_id}>{accountLabel(account)}</option>)}
                  </select></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>

        <h3>Learned bill wording</h3>
        <p className="help">Approving a bank match teaches Bill Tracker the bank wording for that bill and account.</p>
        {matchRules.length ? (
          <div className="tableScroll"><table className="compact"><thead><tr><th>Bill</th><th>Bank wording</th><th>Typical amount</th><th>Approvals</th></tr></thead><tbody>
            {matchRules.slice(0,100).map((rule) => <tr key={rule.id}><td>{billsById[rule.bill_id] || '(deleted)'}</td><td>{rule.merchant_name || rule.transaction_name || rule.normalized_descriptor}</td><td>{fmtMoney(rule.amount_average)}</td><td>{rule.confirmation_count}</td></tr>)}
          </tbody></table></div>
        ) : <p className="emptyState">No learned bill wording yet.</p>}

        <h3>Recent imported transactions</h3>
        {transactions.length ? (
          <div className="tableScroll"><table className="compact"><thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead><tbody>
            {transactions.slice(0,50).map((tx) => <tr key={tx.transaction_id}><td>{tx.date}</td><td>{transactionName(tx)}</td><td>{fmtMoney(Math.abs(Number(tx.amount) || 0))}</td></tr>)}
          </tbody></table></div>
        ) : <p className="emptyState">Connect an account, then sync to import transactions.</p>}
      </div>
    </section>
  );
}
