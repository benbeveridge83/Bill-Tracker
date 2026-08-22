import React from 'react';
import {
  clamp0,
  fmtMoney,
  today,
} from '../lib/dates';
import {
  monthNameShort,
  monthlyEq,
} from '../lib/billMath';
import {
  isConfirmedBillTransaction,
  isSuggestedBillTransaction,
} from '../lib/bank';
import {
  MatchModeLabel,
  SectionTitle,
} from './ui';

export default function Tracker({
  bills,
  filters,
  setFilters,
  expanded,
  setExpanded,
  getMark,
  transactionsForBillMonth,
  onMonth,
}) {
  const year = today().getFullYear();
  const previousYear = year - 1;
  const nowMonth = today().getMonth() + 1;

  const sorted = [...bills].sort(
    (left, right) => {
      const key = filters.trackerSort;

      if (key === 'monthlyDesc') {
        return monthlyEq(right) - monthlyEq(left);
      }
      if (key === 'monthlyAsc') {
        return monthlyEq(left) - monthlyEq(right);
      }
      if (key === 'balanceDesc') {
        return (
          clamp0(right.balance) -
          clamp0(left.balance)
        );
      }
      if (key === 'balanceAsc') {
        return (
          clamp0(left.balance) -
          clamp0(right.balance)
        );
      }

      return (left.name || '').localeCompare(
        right.name || '',
      );
    },
  );

  function monthCell(
    bill,
    cellYear,
    month,
    priorYear = false,
  ) {
    const mark = getMark(
      bill.id,
      cellYear,
      month,
    );

    const transactions =
      transactionsForBillMonth(
        bill.id,
        cellYear,
        month,
      );

    const confirmed = transactions.some(
      isConfirmedBillTransaction,
    );
    const suggested = transactions.some(
      isSuggestedBillTransaction,
    );

    const past =
      cellYear < year ||
      (
        cellYear === year &&
        month < nowMonth
      );

    const classes =
      confirmed || mark?.paid
        ? 'green'
        : suggested
          ? 'reviewBox'
          : past
            ? 'red'
            : '';

    return (
      <td
        key={month}
        className={
          `mcol ` +
          `${!priorYear && month === nowMonth ? 'mNow' : ''}`
        }
      >
        <button
          className={`box ${classes}`}
          onClick={() =>
            onMonth(
              bill,
              cellYear,
              month,
            )
          }
          title={
            confirmed || mark?.source === 'plaid'
              ? 'Paid from a bank transaction'
              : suggested
                ? 'Bank transaction waiting for review'
                : mark?.paid
                  ? 'Marked paid manually'
                  : 'Click for this month'
          }
        >
          <span>
            {Math.round(monthlyEq(bill))
              ? `$${Math.round(monthlyEq(bill))}`
              : '$0'}
          </span>

          {(confirmed ||
            mark?.source === 'plaid') && (
            <small>BANK</small>
          )}

          {!confirmed && suggested && (
            <small>REVIEW</small>
          )}
        </button>
      </td>
    );
  }

  return (
    <section className="card">
      <SectionTitle>Tracker</SectionTitle>

      <div className="pad">
        <div
          className="toolbar trackerTools"
          style={{ marginBottom: 8 }}
        >
          <label className="inlineLabel">
            Sort
            <select
              value={filters.trackerSort}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  trackerSort:
                    event.target.value,
                })
              }
            >
              <option value="alpha">
                Alphabetical
              </option>
              <option value="monthlyDesc">
                Monthly High to Low
              </option>
              <option value="monthlyAsc">
                Monthly Low to High
              </option>
              <option value="balanceDesc">
                Balance High to Low
              </option>
              <option value="balanceAsc">
                Balance Low to High
              </option>
            </select>
          </label>

          <div className="help">
            Green means paid. Yellow means a
            bank transaction is waiting for
            review. Click a month to inspect the
            bank transaction or mark the bill
            manually.
          </div>
        </div>

        <div className="trackerWrap">
          <table className="tracker compact">
            <thead>
              <tr>
                <th>Name / Actions</th>
                <th>Cat.</th>
                <th>Subcat.</th>
                <th>Monthly</th>
                <th>Ovd.</th>
                <th>Bal.</th>
                {Array.from(
                  { length: 12 },
                  (_, index) => (
                    <th
                      key={index}
                      className={
                        `mhead mcol ` +
                        `${index + 1 === nowMonth ? 'mNow' : ''}`
                      }
                    >
                      {monthNameShort(
                        index + 1,
                      )}
                    </th>
                  ),
                )}
              </tr>
            </thead>

            <tbody>
              {sorted.map((bill) => (
                <React.Fragment key={bill.id}>
                  <tr className="rowMain">
                    <td>
                      <div className="toolbar">
                        <strong>
                          {bill.name}
                        </strong>

                        {bill.autopay && (
                          <span className="autopayBadge">
                            AUTOPAY
                          </span>
                        )}

                        <MatchModeLabel
                          mode={bill.match_mode}
                          compact
                        />

                        <button
                          className="ghost mini"
                          onClick={() =>
                            setExpanded({
                              ...expanded,
                              [bill.id]:
                                !expanded[
                                  bill.id
                                ],
                            })
                          }
                        >
                          {expanded[bill.id]
                            ? 'Hide prior year'
                            : 'Show prior year'}
                        </button>
                      </div>
                    </td>
                    <td>{bill.category}</td>
                    <td>{bill.subcategory}</td>
                    <td className="mono">
                      {fmtMoney(
                        monthlyEq(bill),
                      )}
                    </td>
                    <td>
                      {fmtMoney(bill.overdue)}
                    </td>
                    <td>
                      {fmtMoney(bill.balance)}
                    </td>

                    {Array.from(
                      { length: 12 },
                      (_, index) =>
                        monthCell(
                          bill,
                          year,
                          index + 1,
                        ),
                    )}
                  </tr>

                  {expanded[bill.id] && (
                    <tr className="prevRow">
                      <td>
                        Prior year (
                        {previousYear})
                      </td>
                      <td />
                      <td />
                      <td>
                        {fmtMoney(
                          monthlyEq(bill),
                        )}
                      </td>
                      <td>
                        {fmtMoney(
                          bill.overdue,
                        )}
                      </td>
                      <td>
                        {fmtMoney(
                          bill.balance,
                        )}
                      </td>

                      {Array.from(
                        { length: 12 },
                        (_, index) =>
                          monthCell(
                            bill,
                            previousYear,
                            index + 1,
                            true,
                          ),
                      )}
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
