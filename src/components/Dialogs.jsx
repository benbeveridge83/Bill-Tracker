import React, { useState } from 'react';
import {
  fmtMoney,
  today,
  toISO,
} from '../lib/dates';
import { monthNameShort } from '../lib/billMath';
import {
  DEFAULT_SPENDING_CATEGORIES,
  confidenceLabel,
  humanizeFinanceCategory,
  isConfirmedBillTransaction,
  isSuggestedBillTransaction,
  transactionName,
} from '../lib/bank';
import { Modal } from './ui';
import BillPicker from './BillPicker';
import { accountBillCategory, candidateBills, suggestBill } from '../lib/billMatching';

export function BillDialog({
  bill,
  blankBill,
  onClose,
  onSave,
  onDelete,
  title = 'Bill',
  saveLabel = 'Save',
  errorMessage = '',
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState({
    ...blankBill,
    ...bill,
    match_keywords: Array.isArray(
      bill.match_keywords,
    )
      ? bill.match_keywords.join(', ')
      : bill.match_keywords || '',
  });

  function set(key, value) {
    setForm((previous) => ({
      ...previous,
      [key]: value,
    }));
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await onSave(form);
    } catch (error) {
      setSaveError(error.message);
    } finally {
      setSaving(false);
    }
  }

  const tolerancePercent = Math.round(
    Number(
      form.match_amount_tolerance ?? 0.15,
    ) * 100,
  );

  return (
    <Modal
      title={title}
      onClose={saving ? () => {} : onClose}
      wide
    >
      <div className="row">
        <div>
          <label>Name</label>
          <input
            value={form.name}
            onChange={(event) =>
              set('name', event.target.value)
            }
          />
        </div>

        <div>
          <label>Category</label>
          <select
            value={form.category}
            onChange={(event) =>
              set(
                'category',
                event.target.value,
              )
            }
          >
            <option>Household</option>
            <option>Business</option>
          </select>
        </div>
      </div>

      <div className="row">
        <div>
          <label>Subcategory</label>
          <input
            value={form.subcategory || ''}
            onChange={(event) =>
              set(
                'subcategory',
                event.target.value,
              )
            }
          />
        </div>

        <div>
          <label>Expected amount</label>
          <input
            type="number"
            step="0.01"
            value={form.amount || ''}
            onChange={(event) =>
              set('amount', event.target.value)
            }
          />
        </div>
      </div>

      <div className="row">
        <div>
          <label>Frequency</label>
          <select
            value={form.frequency}
            onChange={(event) =>
              set(
                'frequency',
                event.target.value,
              )
            }
          >
            <option value="monthly">
              Monthly
            </option>
            <option value="yearly">
              Yearly
            </option>
            <option value="quarterly">
              Quarterly
            </option>
            <option value="weekly">
              Weekly
            </option>
            <option value="custom">
              Custom days
            </option>
          </select>
        </div>

        <div>
          <label>Anchor / next due</label>
          <input
            type="date"
            value={form.anchor || ''}
            onChange={(event) =>
              set('anchor', event.target.value)
            }
          />
        </div>
      </div>

      <div className="row">
        <div>
          <label>Custom days</label>
          <input
            type="number"
            value={form.custom_days || ''}
            onChange={(event) =>
              set(
                'custom_days',
                event.target.value,
              )
            }
          />
        </div>

        <div>
          <label>
            Vendor charges this automatically?
          </label>
          <select
            value={
              form.autopay ? 'yes' : 'no'
            }
            onChange={(event) =>
              set(
                'autopay',
                event.target.value === 'yes',
              )
            }
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </div>
      </div>

      <fieldset className="matchSettings">
        <legend>Bank matching</legend>

        <div className="row">
          <div>
            <label>
              When Bill Tracker finds a match
            </label>
            <select
              value={
                form.match_mode || 'review'
              }
              onChange={(event) =>
                set(
                  'match_mode',
                  event.target.value,
                )
              }
            >
              <option value="review">
                Ask me to approve it
              </option>
              <option value="automatic">
                Mark paid automatically when
                confidence is high
              </option>
              <option value="off">
                Do not match this bill
              </option>
            </select>
          </div>

          <div>
            <label>
              Allowed amount difference
            </label>
            <select
              value={String(
                tolerancePercent,
              )}
              onChange={(event) =>
                set(
                  'match_amount_tolerance',
                  Number(
                    event.target.value,
                  ) / 100,
                )
              }
            >
              <option value="5">5%</option>
              <option value="10">10%</option>
              <option value="15">15%</option>
              <option value="20">20%</option>
              <option value="30">30%</option>
              <option value="50">50%</option>
            </select>
          </div>
        </div>

        <div>
          <label>
            Bank wording / matching keywords
          </label>
          <input
            placeholder="amazon prime, amzn prime"
            value={form.match_keywords || ''}
            onChange={(event) =>
              set(
                'match_keywords',
                event.target.value,
              )
            }
          />
          <div className="help">
            Separate alternatives with commas.
            Approving a match also teaches the
            exact bank wording automatically.
          </div>
        </div>
      </fieldset>

      <div className="row">
        <div>
          <label>Overdue</label>
          <input
            type="number"
            value={form.overdue || ''}
            onChange={(event) =>
              set(
                'overdue',
                event.target.value,
              )
            }
          />
        </div>

        <div>
          <label>Balance</label>
          <input
            type="number"
            value={form.balance || ''}
            onChange={(event) =>
              set(
                'balance',
                event.target.value,
              )
            }
          />
        </div>
      </div>

      <div className="row">
        <div>
          <label>Portal URL</label>
          <input
            value={form.portal_url || ''}
            onChange={(event) =>
              set(
                'portal_url',
                event.target.value,
              )
            }
          />
        </div>

        <div>
          <label>Notes</label>
          <input
            value={form.notes || ''}
            onChange={(event) =>
              set('notes', event.target.value)
            }
          />
        </div>
      </div>

      {(saveError || errorMessage) && <p className="errorMessage" role="alert">{saveError || errorMessage}</p>}
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button
          className="brand"
          disabled={saving}
          onClick={save}
        >
          {saving ? 'Saving...' : saveLabel}
        </button>

        <button
          className="ghost"
          onClick={onClose}
          disabled={saving}
        >
          Close
        </button>

        {form.id && (
          <button
            className="destr right"
            disabled={saving}
            onClick={() =>
              onDelete(form.id)
            }
          >
            Delete
          </button>
        )}
      </div>
    </Modal>
  );
}

export function PartialDialog({
  bill,
  onClose,
  onSave,
}) {
  const [form, setForm] = useState({
    date: toISO(today()),
    amount: '',
    memo: '',
    reduceBalance: true,
  });

  return (
    <Modal
      title={`Partial Payment — ${bill.name}`}
      onClose={onClose}
    >
      <div className="row">
        <div>
          <label>Date</label>
          <input
            type="date"
            value={form.date}
            onChange={(event) =>
              setForm({
                ...form,
                date: event.target.value,
              })
            }
          />
        </div>

        <div>
          <label>Amount</label>
          <input
            type="number"
            step="0.01"
            value={form.amount}
            onChange={(event) =>
              setForm({
                ...form,
                amount: event.target.value,
              })
            }
          />
        </div>
      </div>

      <div>
        <label>Memo</label>
        <input
          value={form.memo}
          onChange={(event) =>
            setForm({
              ...form,
              memo: event.target.value,
            })
          }
        />
      </div>

      <label className="checkLabel">
        <input
          type="checkbox"
          checked={form.reduceBalance}
          onChange={(event) =>
            setForm({
              ...form,
              reduceBalance:
                event.target.checked,
            })
          }
        />
        Also reduce balance
      </label>

      <div
        className="toolbar"
        style={{ marginTop: 12 }}
      >
        <button
          className="brand"
          onClick={() => onSave(form)}
        >
          Save
        </button>

        <button
          className="ghost"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </Modal>
  );
}

export function ClassificationDialog({
  transaction,
  onClose,
  onSave,
}) {
  const [form, setForm] = useState({
    category:
      transaction.spending_category || '',
    subcategory:
      transaction.spending_subcategory || '',
    excluded: Boolean(
      transaction.excluded_from_spending,
    ),
  });

  return (
    <Modal
      title={`Characterize: ${transactionName(transaction)}`}
      onClose={onClose}
    >
      <div className="transactionSummary">
        <strong>{transaction.date}</strong>
        <span>
          {fmtMoney(
            Math.abs(
              Number(transaction.amount),
            ),
          )}
        </span>
        <span>
          {humanizeFinanceCategory(
            transaction
              .personal_finance_detailed ||
              transaction
                .personal_finance_primary,
          )}
        </span>
      </div>

      <div>
        <label>Spending category</label>
        <input
          list="spending-categories"
          value={form.category}
          onChange={(event) =>
            setForm({
              ...form,
              category: event.target.value,
            })
          }
          placeholder="Choose or type a category"
        />

        <datalist id="spending-categories">
          {DEFAULT_SPENDING_CATEGORIES.map(
            (category) => (
              <option
                key={category}
                value={category}
              />
            ),
          )}
        </datalist>
      </div>

      <div>
        <label>Subcategory / note</label>
        <input
          value={form.subcategory}
          onChange={(event) =>
            setForm({
              ...form,
              subcategory:
                event.target.value,
            })
          }
        />
      </div>

      <label className="checkLabel">
        <input
          type="checkbox"
          checked={form.excluded}
          onChange={(event) =>
            setForm({
              ...form,
              excluded:
                event.target.checked,
            })
          }
        />
        Exclude this transaction from spending
        totals
      </label>

      <div
        className="toolbar"
        style={{ marginTop: 12 }}
      >
        <button
          className="brand"
          onClick={() =>
            onSave(transaction, form)
          }
        >
          Save classification
        </button>

        <button
          className="ghost"
          onClick={() =>
            onSave(transaction, {
              category: '',
              subcategory: '',
              excluded: false,
            })
          }
        >
          Clear
        </button>

        <button
          className="ghost"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </Modal>
  );
}

export function LinkBillDialog({
  transaction,
  bills,
  onClose,
  onLink,
  blankBill,
  onCreateBill,
  errorMessage = '',
  status = '',
  account,
  mappings = [],
  rules = [],
  feedback = [],
  preferences,
  onPreferences,
  aiMatch,
}) {
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [billId, setBillId] = useState(
    null,
  );
  const accountCategory = accountBillCategory(account, mappings);
  const category = preferences.category === 'account' ? accountCategory : preferences.category;
  const choices = candidateBills(transaction, bills, category, { manual: true });
  const eligible = candidateBills(transaction, bills, category, { feedback });
  const aiBill = eligible.find((bill) => bill.id === aiMatch?.bill_id);
  const storedBill = eligible.find((bill) => bill.id === transaction.suggested_bill_id);
  const suggestion = aiBill ? { bill: aiBill, ...aiMatch } : storedBill ? { bill: storedBill, source: transaction.match_source, reason: transaction.match_reason }
    : suggestBill(transaction, bills, { category, rules, feedback });
  const selected = choices.find((bill) => bill.id === (billId ?? suggestion?.bill.id));

  async function link(id) {
    setBusy(true);
    try {
      await onLink(transaction, id);
    } finally {
      setBusy(false);
    }
  }

  if (creating) {
    return (
      <BillDialog
        bill={{ ...blankBill, name: transactionName(transaction), amount: Math.abs(Number(transaction.amount) || 0), anchor: transaction.date, category: category === 'all' ? blankBill.category : category }}
        blankBill={blankBill}
        title="Add bill and link transaction"
        saveLabel="Save and link"
        errorMessage={errorMessage}
        onClose={() => setCreating(false)}
        onSave={async (form) => {
          const saved = await onCreateBill(form);
          if (!saved) return;
          if (category !== 'all' && form.category !== category) onPreferences({ category: form.category });
          setBillId(saved.id);
          setCreating(false);
          await link(saved.id);
        }}
      />
    );
  }

  return (
    <Modal
      title="Link transaction to a bill"
      onClose={busy ? () => {} : onClose}
    >
      <div className="transactionSummary">
        <strong>
          {transactionName(transaction)}
        </strong>
        <span>{transaction.date}</span>
        <span>
          {fmtMoney(
            Math.abs(
              Number(transaction.amount),
            ),
          )}
        </span>
      </div>

      {suggestion && <p className="billDialogSuggestion"><strong>{suggestion.source === 'openai' ? 'AI suggestion' : 'Suggested bill'}: {suggestion.bill.name}</strong><span className="help">{suggestion.reason}</span></p>}
      <BillPicker bills={choices} value={selected?.id || ''} onChange={setBillId} preferences={preferences} onPreferences={onPreferences} accountCategory={accountCategory} disabled={busy} />

      <p className="help">
        Approving teaches Bill Tracker this bank
        wording so it can recognize the bill
        more confidently next time.
      </p>

      <div className="toolbar">
        <button className="ghost" disabled={busy} onClick={() => setCreating(true)}>+ Add a new bill</button>
        <button
          className="brand"
          disabled={!selected || busy}
          onClick={() => link(selected.id)}
        >
          {busy ? 'Linking...' : 'Approve and learn'}
        </button>

        <button
          className="ghost"
          onClick={onClose}
          disabled={busy}
        >
          Close
        </button>
      </div>
      {status && <p className="statusMessage" role="status">{status}</p>}
    </Modal>
  );
}

export function MonthDetailDialog({
  detail,
  mark,
  transactions,
  onClose,
  onMarkPaidThrough,
  onMatchAction,
}) {
  const { bill, year, month } = detail;

  const confirmed = transactions.filter(
    isConfirmedBillTransaction,
  );

  const suggestions = transactions.filter(
    isSuggestedBillTransaction,
  );

  return (
    <Modal
      title={
        `${bill.name} — ` +
        `${monthNameShort(month)} ${year}`
      }
      onClose={onClose}
    >
      {confirmed.length > 0 && (
        <div>
          <h3>Linked bank transaction</h3>

          {confirmed.map((transaction) => (
            <div
              className="matchCard confirmedMatch"
              key={transaction.transaction_id}
            >
              <div>
                <strong>
                  {transactionName(
                    transaction,
                  )}
                </strong>
                <div className="help">
                  {transaction.date} ·{' '}
                  {fmtMoney(
                    Math.abs(
                      Number(
                        transaction.amount,
                      ),
                    ),
                  )}{' '}
                  ·{' '}
                  {confidenceLabel(
                    transaction.match_confidence,
                  )}
                </div>
                <div className="help">
                  {transaction.match_reason}
                </div>
              </div>

              <button
                className="ghost mini"
                onClick={() =>
                  onMatchAction(
                    'unmatch',
                    transaction,
                    bill.id,
                  )
                }
              >
                Remove match
              </button>
            </div>
          ))}
        </div>
      )}

      {suggestions.length > 0 && (
        <div>
          <h3>Suggested bank transaction</h3>

          {suggestions.map(
            (transaction) => (
              <div
                className="matchCard suggestedMatch"
                key={
                  transaction.transaction_id
                }
              >
                <div>
                  <strong>
                    {transactionName(
                      transaction,
                    )}
                  </strong>
                  <div className="help">
                    {transaction.date} ·{' '}
                    {fmtMoney(
                      Math.abs(
                        Number(
                          transaction.amount,
                        ),
                      ),
                    )}{' '}
                    ·{' '}
                    {confidenceLabel(
                      transaction
                        .match_confidence,
                    )}
                  </div>
                  <div className="help">
                    {
                      transaction.match_reason
                    }
                  </div>
                </div>

                <div className="toolbar">
                  <button
                    className="brand mini"
                    onClick={() =>
                      onMatchAction(
                        'approve',
                        transaction,
                        bill.id,
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
                        bill.id,
                      )
                    }
                  >
                    Reject
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      )}

      {!confirmed.length &&
        !suggestions.length && (
          <p className="emptyState">
            No bank transaction is linked or
            suggested for this bill and month.
          </p>
        )}

      {mark?.paid && (
        <p className="statusMessage">
          This month is marked paid
          {mark.source === 'plaid'
            ? ' from a bank transaction'
            : ' manually'}
          .
        </p>
      )}

      <div
        className="toolbar"
        style={{ marginTop: 16 }}
      >
        <button
          className="ghost"
          onClick={() =>
            onMarkPaidThrough(
              bill,
              year,
              month,
            )
          }
        >
          Mark paid through this month
        </button>

        <button
          className="ghost"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </Modal>
  );
}
