import React from 'react';
import { fmtMoney } from '../lib/dates';
import {
  accountLabel,
  confidenceLabel,
  humanizeFinanceCategory,
  inMonth,
  isConfirmedBillTransaction,
  isMoneyIn,
  isMoneyOut,
  isSuggestedBillTransaction,
  monthLabel,
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
  const accountsById = Object.fromEntries(
    accounts.map((account) => [
      account.account_id,
      account,
    ]),
  );

  const billsById = Object.fromEntries(
    bills.map((bill) => [bill.id, bill]),
  );

  const monthTransactions = transactions
    .filter((transaction) =>
      inMonth(transaction.date, month),
    )
    .filter(
      (transaction) =>
        filters.account === 'all' ||
        transaction.account_id ===
          filters.account,
    )
    .filter((transaction) => {
      if (filters.billState === 'confirmed') {
        return isConfirmedBillTransaction(
          transaction,
        );
      }

      if (filters.billState === 'suggested') {
        return isSuggestedBillTransaction(
          transaction,
        );
      }

      if (filters.billState === 'notBills') {
        return (
          !transaction.matched_bill_id &&
          !transaction.suggested_bill_id
        );
      }

      return true;
    })
    .filter((transaction) => {
      if (
        filters.classification ===
        'characterized'
      ) {
        return (
          transaction.classification_status !==
          'uncharacterized'
        );
      }

      if (
        filters.classification ===
        'uncharacterized'
      ) {
        return (
          transaction.classification_status ===
          'uncharacterized'
        );
      }

      return true;
    })
    .filter((transaction) => {
      if (filters.flow === 'in') {
        return isMoneyIn(transaction);
      }
      if (filters.flow === 'out') {
        return isMoneyOut(transaction);
      }
      if (filters.flow === 'checks') {
        return transaction.is_check;
      }
      if (filters.flow === 'transfers') {
        return transaction.is_transfer;
      }
      return true;
    })
    .filter((transaction) => {
      const needle = filters.search
        .trim()
        .toLowerCase();

      if (!needle) return true;

      const haystack = [
        transaction.name,
        transaction.merchant_name,
        transaction.spending_category,
        transaction.spending_subcategory,
        transaction.personal_finance_primary,
        transaction.personal_finance_detailed,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(needle);
    });

  return (
    <section className="card">
      <SectionTitle>Bank transactions</SectionTitle>

      <div className="pad">
        <div className="bankToolbar">
          <div>
            <label>Month</label>
            <input
              type="month"
              value={month}
              onChange={(event) =>
                setMonth(event.target.value)
              }
            />
          </div>

          <div>
            <label>Account</label>
            <select
              value={filters.account}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  account: event.target.value,
                })
              }
            >
              <option value="all">
                All connected accounts
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
          </div>

          <div>
            <label>Bill status</label>
            <select
              value={filters.billState}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  billState:
                    event.target.value,
                })
              }
            >
              <option value="all">
                All transactions
              </option>
              <option value="confirmed">
                Identified bills
              </option>
              <option value="suggested">
                Bill suggestions
              </option>
              <option value="notBills">
                Not identified as bills
              </option>
            </select>
          </div>

          <div>
            <label>Characterization</label>
            <select
              value={filters.classification}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  classification:
                    event.target.value,
                })
              }
            >
              <option value="all">All</option>
              <option value="uncharacterized">
                Uncharacterized only
              </option>
              <option value="characterized">
                Characterized only
              </option>
            </select>
          </div>

          <div>
            <label>Money type</label>
            <select
              value={filters.flow}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  flow: event.target.value,
                })
              }
            >
              <option value="all">
                Money in and out
              </option>
              <option value="in">
                Money in
              </option>
              <option value="out">
                Money out
              </option>
              <option value="checks">
                Checks
              </option>
              <option value="transfers">
                Transfers
              </option>
            </select>
          </div>
        </div>

        <div className="toolbar transactionControls">
          <input
            aria-label="Search transactions"
            placeholder="Search bank wording or category"
            value={filters.search}
            onChange={(event) =>
              setFilters({
                ...filters,
                search: event.target.value,
              })
            }
          />

          <button
            className="brand"
            onClick={onMatchMonth}
            disabled={matching}
          >
            {matching
              ? 'Matching...'
              : `Find ${monthLabel(month)} bill payments`}
          </button>
        </div>

        {matchStatus && (
          <p
            className="statusMessage"
            role="status"
          >
            {matchStatus}
          </p>
        )}

        <p className="help">
          Showing {monthTransactions.length}{' '}
          transaction(s). Select “Not identified
          as bills” and “Uncharacterized only” to
          reduce the list to transactions that
          still need attention.
        </p>

        {monthTransactions.length ? (
          <div className="tableScroll">
            <table className="transactionTable">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Account</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Bank type</th>
                  <th>Spending category</th>
                  <th>Bill match</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {monthTransactions.map(
                  (transaction) => {
                    const confirmedBill =
                      billsById[
                        transaction
                          .matched_bill_id
                      ];

                    const suggestedBill =
                      billsById[
                        transaction
                          .suggested_bill_id
                      ];

                    return (
                      <tr
                        key={
                          transaction.transaction_id
                        }
                      >
                        <td>
                          {transaction.date}
                          {transaction.pending && (
                            <div className="pendingText">
                              Pending
                            </div>
                          )}
                        </td>

                        <td>
                          {accountLabel(
                            accountsById[
                              transaction
                                .account_id
                            ],
                          )}
                        </td>

                        <td>
                          <strong>
                            {transactionName(
                              transaction,
                            )}
                          </strong>

                          {transaction.name &&
                            transaction.name !==
                              transaction.merchant_name && (
                              <div className="help">
                                {transaction.name}
                              </div>
                            )}

                          {transaction.check_number && (
                            <div className="help">
                              Check #
                              {
                                transaction.check_number
                              }
                            </div>
                          )}
                        </td>

                        <td
                          className={
                            `mono amountCell ` +
                            `${isMoneyIn(transaction) ? 'moneyIn' : 'moneyOut'}`
                          }
                        >
                          {isMoneyIn(transaction)
                            ? '+'
                            : '-'}
                          {fmtMoney(
                            Math.abs(
                              Number(
                                transaction.amount,
                              ),
                            ),
                          )}
                        </td>

                        <td>
                          {humanizeFinanceCategory(
                            transaction
                              .personal_finance_detailed ||
                              transaction
                                .personal_finance_primary,
                          ) || '—'}

                          {transaction.is_transfer && (
                            <div>
                              <span className="chip neutral">
                                Transfer
                              </span>
                            </div>
                          )}

                          {transaction.is_check && (
                            <div>
                              <span className="chip neutral">
                                Check
                              </span>
                            </div>
                          )}
                        </td>

                        <td>
                          {transaction.spending_category || (
                            <span className="muted">
                              Uncharacterized
                            </span>
                          )}

                          {transaction.spending_subcategory && (
                            <div className="help">
                              {
                                transaction
                                  .spending_subcategory
                              }
                            </div>
                          )}

                          {transaction.excluded_from_spending && (
                            <div className="help">
                              Excluded from spending
                            </div>
                          )}
                        </td>

                        <td>
                          {confirmedBill ? (
                            <>
                              <span
                                className={
                                  `chip ` +
                                  `${transaction.match_status === 'automatic' ? 'autoMatch' : 'ok'}`
                                }
                              >
                                {transaction.match_status ===
                                'automatic'
                                  ? 'Automatic'
                                  : 'Approved'}
                              </span>

                              <div>
                                <strong>
                                  {
                                    confirmedBill.name
                                  }
                                </strong>
                              </div>

                              <div className="help">
                                {confidenceLabel(
                                  transaction
                                    .match_confidence,
                                )}{' '}
                                {
                                  transaction
                                    .match_reason
                                }
                              </div>
                            </>
                          ) : suggestedBill ? (
                            <>
                              <span className="chip review">
                                Review
                              </span>

                              <div>
                                <strong>
                                  {
                                    suggestedBill.name
                                  }
                                </strong>
                              </div>

                              <div className="help">
                                {confidenceLabel(
                                  transaction
                                    .match_confidence,
                                )}{' '}
                                {
                                  transaction
                                    .match_reason
                                }
                              </div>
                            </>
                          ) : (
                            <span className="muted">
                              Not a bill yet
                            </span>
                          )}
                        </td>

                        <td>
                          <div className="actionStack">
                            <button
                              className="ghost mini"
                              onClick={() =>
                                onClassify(
                                  transaction,
                                )
                              }
                            >
                              Characterize
                            </button>

                            {suggestedBill && (
                              <>
                                <button
                                  className="brand mini"
                                  disabled={
                                    transaction.pending
                                  }
                                  onClick={() =>
                                    onMatchAction(
                                      'approve',
                                      transaction,
                                      suggestedBill.id,
                                    )
                                  }
                                >
                                  Approve
                                </button>

                                <button
                                  className="ghost mini"
                                  onClick={() =>
                                    onMatchAction(
                                      'reject',
                                      transaction,
                                      suggestedBill.id,
                                    )
                                  }
                                >
                                  Reject
                                </button>
                              </>
                            )}

                            {confirmedBill ? (
                              <button
                                className="ghost mini"
                                onClick={() =>
                                  onMatchAction(
                                    'unmatch',
                                    transaction,
                                    confirmedBill.id,
                                  )
                                }
                              >
                                Remove bill match
                              </button>
                            ) : (
                              <button
                                className="ghost mini"
                                disabled={
                                  transaction.pending ||
                                  !isMoneyOut(
                                    transaction,
                                  )
                                }
                                onClick={() =>
                                  onLink(transaction)
                                }
                              >
                                Link to bill
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="emptyState">
            No transactions match these filters.
            Sync Plaid first or change the month
            and filters.
          </p>
        )}
      </div>
    </section>
  );
}
