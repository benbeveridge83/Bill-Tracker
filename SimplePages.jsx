import React from 'react';
import { fmtMoney } from '../lib/dates';
import {
  monthlyEq,
  statusFor,
} from '../lib/billMath';
import {
  MatchModeLabel,
  SectionTitle,
} from './ui';

export function PayLog({ logs, bills }) {
  const billsById = Object.fromEntries(
    bills.map((bill) => [
      bill.id,
      bill,
    ]),
  );

  return (
    <section className="card">
      <SectionTitle>Pay Log</SectionTitle>

      <div className="pad">
        <div className="tableScroll">
          <table className="compact">
            <thead>
              <tr>
                <th>Date</th>
                <th>Bill</th>
                <th>Amount</th>
                <th>Source</th>
                <th>Memo</th>
              </tr>
            </thead>

            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{log.date}</td>
                  <td>
                    {billsById[log.bill_id]
                      ?.name || '(deleted)'}
                  </td>
                  <td>
                    {fmtMoney(log.amount)}
                  </td>
                  <td>{log.source}</td>
                  <td>{log.memo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function Summary({ bills }) {
  return (
    <section className="card">
      <SectionTitle>Summary</SectionTitle>

      <div className="pad">
        <div className="tableScroll">
          <table className="compact">
            <thead>
              <tr>
                <th>Name</th>
                <th>Cat.</th>
                <th>Subcat.</th>
                <th>Monthly</th>
                <th>Overdue</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Match handling</th>
              </tr>
            </thead>

            <tbody>
              {bills.map((bill) => {
                const status =
                  statusFor(bill);

                const className =
                  bill.cancel_requested
                    ? 'cancelRow'
                    : status.code === 'overdue'
                      ? 'pastDueRow'
                      : status.code ===
                          'current'
                        ? 'currentRow'
                        : '';

                return (
                  <tr
                    key={bill.id}
                    className={className}
                  >
                    <td>
                      <strong>
                        {bill.name}
                      </strong>
                    </td>
                    <td>{bill.category}</td>
                    <td>
                      {bill.subcategory}
                    </td>
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
                    <td>{status.label}</td>
                    <td>
                      <MatchModeLabel
                        mode={bill.match_mode}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
