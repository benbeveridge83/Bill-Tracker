import React from 'react';
import { fmtMoney, toISO } from '../lib/dates';
import { statusFor } from '../lib/billMath';
import {
  Kpi,
  MatchModeLabel,
  SectionTitle,
  StatusChip,
} from './ui';

export default function Dashboard({
  kpis,
  bills,
  filters,
  setFilters,
  onEdit,
  onAdd,
  onCurrent,
  onPartial,
  onImport,
  legacyDataAvailable,
  migrating,
  migrationStatus,
}) {
  return (
    <section>
      <h2>Overview</h2>

      <div className="kpi">
        <Kpi
          label="Overdue count"
          value={kpis.overdueCnt}
        />
        <Kpi
          label="Due in 7 days"
          value={fmtMoney(kpis.dueAmt)}
        />
        <Kpi
          label="Month total"
          value={fmtMoney(kpis.monthTotal)}
        />
        <Kpi
          label="Paid this month"
          value={fmtMoney(kpis.paidTotal)}
        />
        <Kpi
          label="Total overdue"
          value={fmtMoney(kpis.totOverdue)}
        />
        <Kpi
          label="Total balance"
          value={fmtMoney(kpis.totBalance)}
        />
      </div>

      <div className="pad" />

      <div className="card">
        <SectionTitle>Bills</SectionTitle>

        <div className="pad">
          <div
            className="toolbar controls"
            style={{ marginBottom: 10 }}
          >
            <input
              aria-label="Search bills"
              placeholder="Search by name / subcategory / notes"
              value={filters.search}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  search: event.target.value,
                })
              }
            />

            <select
              aria-label="Sort bills"
              value={filters.sort}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  sort: event.target.value,
                })
              }
            >
              <option value="due">Due date</option>
              <option value="amountDesc">
                Amount: High to Low
              </option>
              <option value="amountAsc">
                Amount: Low to High
              </option>
            </select>

            <button
              className="brand"
              onClick={onAdd}
            >
              Add bill
            </button>

            {legacyDataAvailable && (
              <button
                className="ghost"
                onClick={onImport}
                disabled={migrating}
              >
                {migrating
                  ? 'Importing...'
                  : 'Import existing browser data'}
              </button>
            )}
          </div>

          {migrationStatus && (
            <p
              className="statusMessage"
              role="status"
            >
              {migrationStatus}
            </p>
          )}

          <div className="tableScroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Cat.</th>
                  <th>Subcat.</th>
                  <th>Amount</th>
                  <th>Ovd.</th>
                  <th>Bal.</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Bank match</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {bills.map((bill) => {
                  const status = statusFor(bill);

                  return (
                    <tr key={bill.id}>
                      <td>
                        <strong>{bill.name}</strong>
                        <div className="help">
                          {bill.notes}
                        </div>
                        {bill.autopay && (
                          <span className="autopayBadge">
                            AUTOPAY
                          </span>
                        )}
                      </td>
                      <td>{bill.category}</td>
                      <td>{bill.subcategory}</td>
                      <td className="mono">
                        {fmtMoney(bill.amount)}
                      </td>
                      <td className="mono">
                        {fmtMoney(bill.overdue)}
                      </td>
                      <td className="mono">
                        {fmtMoney(bill.balance)}
                      </td>
                      <td>{toISO(status.due)}</td>
                      <td>
                        <StatusChip
                          status={status.code}
                          label={status.label}
                        />
                      </td>
                      <td>
                        <MatchModeLabel
                          mode={bill.match_mode}
                        />
                      </td>
                      <td>
                        <div className="toolbar">
                          <button
                            className="ghost mini"
                            onClick={() => onEdit(bill)}
                          >
                            Edit
                          </button>
                          {bill.portal_url && (
                            <button
                              className="ghost mini"
                              onClick={() =>
                                window.open(
                                  bill.portal_url,
                                  '_blank',
                                )
                              }
                            >
                              Portal
                            </button>
                          )}
                          <button
                            className="ghost mini"
                            onClick={() =>
                              onCurrent(bill)
                            }
                          >
                            Current
                          </button>
                          <button
                            className="ghost mini"
                            onClick={() =>
                              onPartial(bill)
                            }
                          >
                            Partial
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
