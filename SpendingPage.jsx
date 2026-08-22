import React from 'react';
import { fmtMoney } from '../lib/dates';
import {
  accountLabel,
  categoryForSpending,
  inMonth,
  isMoneyIn,
  isMoneyOut,
  monthLabel,
} from '../lib/bank';
import { Kpi, SectionTitle } from './ui';

export default function SpendingPage({
  month,
  setMonth,
  transactions,
  accounts,
  bills,
  accountFilter,
  setAccountFilter,
}) {
  const billsById = Object.fromEntries(
    bills.map((bill) => [bill.id, bill]),
  );

  const monthTransactions = transactions.filter(
    (transaction) =>
      inMonth(transaction.date, month) &&
      !transaction.pending &&
      (
        accountFilter === 'all' ||
        transaction.account_id ===
          accountFilter
      ),
  );

  const moneyInTransactions =
    monthTransactions.filter(isMoneyIn);
  const moneyOutTransactions =
    monthTransactions.filter(isMoneyOut);
  const checkTransactions =
    monthTransactions.filter(
      (transaction) => transaction.is_check,
    );
  const transferTransactions =
    monthTransactions.filter(
      (transaction) => transaction.is_transfer,
    );

  const moneyIn = moneyInTransactions.reduce(
    (sum, transaction) =>
      sum +
      Math.abs(Number(transaction.amount) || 0),
    0,
  );

  const moneyOut = moneyOutTransactions.reduce(
    (sum, transaction) =>
      sum +
      Math.abs(Number(transaction.amount) || 0),
    0,
  );

  const checks = checkTransactions.reduce(
    (sum, transaction) =>
      sum +
      Math.abs(Number(transaction.amount) || 0),
    0,
  );

  const transfers = transferTransactions.reduce(
    (sum, transaction) =>
      sum +
      Math.abs(Number(transaction.amount) || 0),
    0,
  );

  const spendableTransactions =
    monthTransactions.filter(
      (transaction) =>
        isMoneyOut(transaction) &&
        !transaction.is_transfer &&
        !transaction.excluded_from_spending,
    );

  const characterized =
    spendableTransactions.filter(
      (transaction) =>
        transaction.classification_status !==
        'uncharacterized',
    );

  const uncharacterized =
    spendableTransactions.filter(
      (transaction) =>
        transaction.classification_status ===
        'uncharacterized',
    );

  function spendingCategory(transaction) {
    if (transaction.spending_category) {
      return transaction.spending_category;
    }

    const bill =
      billsById[transaction.matched_bill_id];

    if (bill) {
      return (
        bill.subcategory ||
        'Bills & Utilities'
      );
    }

    return categoryForSpending(transaction);
  }

  const grouped = Object.entries(
    spendableTransactions.reduce(
      (accumulator, transaction) => {
        const category =
          spendingCategory(transaction);

        if (!accumulator[category]) {
          accumulator[category] = {
            total: 0,
            count: 0,
          };
        }

        accumulator[category].total +=
          Math.abs(
            Number(transaction.amount) || 0,
          );

        accumulator[category].count += 1;

        return accumulator;
      },
      {},
    ),
  ).sort(
    ([, left], [, right]) =>
      right.total - left.total,
  );

  const maxTotal = Math.max(
    1,
    ...grouped.map(
      ([, value]) => value.total,
    ),
  );

  const characterizedAmount =
    characterized.reduce(
      (sum, transaction) =>
        sum +
        Math.abs(
          Number(transaction.amount) || 0,
        ),
      0,
    );

  const uncharacterizedAmount =
    uncharacterized.reduce(
      (sum, transaction) =>
        sum +
        Math.abs(
          Number(transaction.amount) || 0,
        ),
      0,
    );

  return (
    <section>
      <div className="toolbar pageToolbar">
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

        <div className="wideControl">
          <label>Account</label>
          <select
            value={accountFilter}
            onChange={(event) =>
              setAccountFilter(
                event.target.value,
              )
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
      </div>

      <h2>{monthLabel(month)} cash flow</h2>

      <div className="kpi spendingKpi">
        <Kpi
          label="Money in"
          value={fmtMoney(moneyIn)}
          detail={`${moneyInTransactions.length} transaction(s)`}
        />
        <Kpi
          label="Money out"
          value={fmtMoney(moneyOut)}
          detail={`${moneyOutTransactions.length} transaction(s)`}
        />
        <Kpi
          label="Net cash flow"
          value={fmtMoney(moneyIn - moneyOut)}
        />
        <Kpi
          label="Checks"
          value={fmtMoney(checks)}
          detail={`${checkTransactions.length} check(s)`}
        />
        <Kpi
          label="Transfers"
          value={fmtMoney(transfers)}
          detail={`${transferTransactions.length} transfer(s)`}
        />
        <Kpi
          label="Characterized spending"
          value={fmtMoney(
            characterizedAmount,
          )}
        />
        <Kpi
          label="Uncharacterized spending"
          value={fmtMoney(
            uncharacterizedAmount,
          )}
        />
      </div>

      <div className="pad" />

      <div className="card">
        <SectionTitle>
          Spending by category
        </SectionTitle>

        <div className="pad">
          <p className="help">
            Transfers and transactions marked
            “excluded from spending” are omitted.
            A manually selected category takes
            priority; linked bills use the bill
            subcategory; otherwise the Plaid
            category is shown as a temporary
            category.
          </p>

          {grouped.length ? (
            <div className="tableScroll">
              <table className="categoryTable">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Transactions</th>
                    <th>Total</th>
                    <th>Relative amount</th>
                  </tr>
                </thead>

                <tbody>
                  {grouped.map(
                    ([category, value]) => (
                      <tr key={category}>
                        <td>
                          <strong>
                            {category}
                          </strong>
                        </td>
                        <td>{value.count}</td>
                        <td className="mono">
                          {fmtMoney(value.total)}
                        </td>
                        <td>
                          <div className="barTrack">
                            <div
                              className="barFill"
                              style={{
                                width:
                                  `${Math.max(
                                    2,
                                    (
                                      value.total /
                                      maxTotal
                                    ) * 100,
                                  )}%`,
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="emptyState">
              No posted spending transactions
              were found for this month.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
