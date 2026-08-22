import React from 'react';
import { fmtMoney } from '../lib/dates';
import {
  accountLabel,
  transactionName,
} from '../lib/bank';
import { SectionTitle } from './ui';

const BILL_CATEGORIES = [
  'Household',
  'Business',
];

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
  const billsById = Object.fromEntries(
    bills.map((bill) => [
      bill.id,
      bill.name,
    ]),
  );

  const itemIds = [
    ...new Set(
      accounts.map(
        (account) => account.item_id,
      ),
    ),
  ];

  function mappingFor(category) {
    return (
      mappings.find(
        (mapping) =>
          mapping.bill_category === category,
      )?.account_id || ''
    );
  }

  return (
    <section className="card">
      <SectionTitle>
        Bank connections
      </SectionTitle>

      <div className="pad">
        <div className="toolbar">
          <button
            className="brand"
            onClick={onConnect}
            disabled={connecting}
          >
            {connecting
              ? 'Connecting...'
              : 'Connect bank account'}
          </button>

          <button
            className="ghost"
            onClick={onSync}
            disabled={
              syncing || !accounts.length
            }
          >
            {syncing
              ? 'Syncing...'
              : 'Sync balances & transactions'}
          </button>

          {itemIds.map((itemId) => (
            <button
              className="destr mini"
              key={itemId}
              onClick={() =>
                onDisconnect(itemId)
              }
            >
              Disconnect{' '}
              {accounts.find(
                (account) =>
                  account.item_id === itemId,
              )?.institution_name ||
                'institution'}
            </button>
          ))}
        </div>

        {status && (
          <p
            className="statusMessage"
            role="status"
          >
            {status}
          </p>
        )}

        <p className="help">
          Plaid access tokens stay in the
          protected server database. OpenAI
          receives bill and transaction matching
          fields only—not bank credentials,
          access tokens, or account numbers.
        </p>

        <h3>
          Assign bill categories to accounts
        </h3>

        <div className="mappingGrid">
          {BILL_CATEGORIES.map((category) => (
            <div
              className="mappingCard"
              key={category}
            >
              <label>
                {category} bills use
              </label>

              <select
                value={mappingFor(category)}
                onChange={(event) =>
                  onMapping(
                    category,
                    event.target.value,
                  )
                }
              >
                <option value="">
                  Not assigned
                </option>

                {accounts.map((account) => (
                  <option
                    key={account.account_id}
                    value={account.account_id}
                  >
                    {accountLabel(account)}
                  </option>
                ))}
              </select>

              <div className="help">
                Only transactions from this
                account are compared with{' '}
                {category.toLowerCase()} bills.
              </div>
            </div>
          ))}
        </div>

        <h3>Connected accounts</h3>

        {accounts.length ? (
          <div className="tableScroll">
            <table className="compact">
              <thead>
                <tr>
                  <th>Institution</th>
                  <th>Name</th>
                  <th>Subtype</th>
                  <th>Mask</th>
                  <th>Available</th>
                  <th>Current</th>
                </tr>
              </thead>

              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      {account.institution_name ||
                        '—'}
                    </td>
                    <td>{account.name}</td>
                    <td>{account.subtype}</td>
                    <td>
                      {account.mask
                        ? `•••• ${account.mask}`
                        : '—'}
                    </td>
                    <td>
                      {account.available_balance ==
                      null
                        ? '—'
                        : fmtMoney(
                            account.available_balance,
                          )}
                    </td>
                    <td>
                      {account.current_balance ==
                      null
                        ? '—'
                        : fmtMoney(
                            account.current_balance,
                          )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="emptyState">
            No bank accounts connected yet.
          </p>
        )}

        <h3>Learned bill wording</h3>

        <p className="help">
          Bill Tracker has {matchRules.length}{' '}
          learned wording rule(s). Approving a
          bank match adds or strengthens a rule
          for that bill and account.
        </p>

        {matchRules.length > 0 && (
          <div className="tableScroll">
            <table className="compact">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Bank wording</th>
                  <th>Typical amount</th>
                  <th>Approvals</th>
                </tr>
              </thead>

              <tbody>
                {matchRules
                  .slice(0, 100)
                  .map((rule) => (
                    <tr key={rule.id}>
                      <td>
                        {billsById[
                          rule.bill_id
                        ] || '(deleted)'}
                      </td>
                      <td>
                        {rule.merchant_name ||
                          rule.transaction_name ||
                          rule.normalized_descriptor}
                      </td>
                      <td>
                        {fmtMoney(
                          rule.amount_average,
                        )}
                      </td>
                      <td>
                        {
                          rule.confirmation_count
                        }
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        <h3>Recent imported transactions</h3>

        {transactions.length ? (
          <div className="tableScroll">
            <table className="compact">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Name</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Bill</th>
                </tr>
              </thead>

              <tbody>
                {transactions
                  .slice(0, 50)
                  .map((transaction) => (
                    <tr key={transaction.id}>
                      <td>
                        {transaction.date}
                      </td>
                      <td>
                        {transactionName(
                          transaction,
                        )}
                      </td>
                      <td>
                        {fmtMoney(
                          Math.abs(
                            Number(
                              transaction.amount,
                            ),
                          ),
                        )}
                      </td>
                      <td>
                        {transaction.pending
                          ? 'Pending'
                          : transaction.match_status}
                      </td>
                      <td>
                        {billsById[
                          transaction
                            .matched_bill_id ||
                            transaction
                              .suggested_bill_id
                        ] || '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="emptyState">
            Connect an account, then sync to
            import transactions.
          </p>
        )}
      </div>
    </section>
  );
}
