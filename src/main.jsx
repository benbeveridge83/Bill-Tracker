import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import { supabase } from './lib/supabaseClient';
import {
  addDays,
  clamp0,
  today,
  toISO,
} from './lib/dates';
import {
  monthKey,
  monthlyEq,
  nextDueFrom,
  periodKey,
  statusFor,
} from './lib/billMath';
import {
  currentMonthValue,
  inMonth,
  monthLabel,
} from './lib/bank';
import Dashboard from './components/Dashboard';
import Tracker from './components/Tracker';
import TransactionsPage from './components/TransactionsPage';
import SpendingPage from './components/SpendingPage';
import PlaidPanel from './components/PlaidPanel';
import {
  PayLog,
  Summary,
} from './components/SimplePages';
import {
  BillDialog,
  ClassificationDialog,
  LinkBillDialog,
  MonthDetailDialog,
  PartialDialog,
} from './components/Dialogs';
import './styles.css';

const APP_VERSION = '0.3.0';
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

const blankBill = {
  name: '',
  category: 'Household',
  subcategory: '',
  amount: 0,
  frequency: 'monthly',
  anchor: toISO(today()),
  custom_days: null,
  autopay: false,
  overdue: 0,
  balance: 0,
  balance_as_of: '',
  portal_url: '',
  account: '',
  notes: '',
  next_due: null,
  last_paid: null,
  current_as_of: '',
  cancel_requested: false,
  cancel_at: null,
  archived: false,
  archived_at: null,
  mail_updated_at: null,
  match_mode: 'review',
  match_keywords: [],
  match_amount_tolerance: 0.15,
};

async function invokeFunction(name, options) {
  const { data, error } =
    await supabase.functions.invoke(
      name,
      options,
    );

  if (!error) return data;

  let detail = '';

  try {
    const body = await error.context?.json();
    detail = body?.error || '';
  } catch {
    // Use the Supabase client error when the
    // function response is not JSON.
  }

  throw new Error(
    detail ||
    error.message ||
    `${name} failed`,
  );
}

async function fetchPagedRows({
  table,
  orderColumn,
  ascending = false,
}) {
  const rows = [];

  for (
    let page = 0;
    page < MAX_PAGES;
    page += 1
  ) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const result = await supabase
      .from(table)
      .select('*')
      .order(orderColumn, { ascending })
      .range(from, to);

    if (result.error) return result;

    rows.push(...(result.data || []));

    if (
      !result.data ||
      result.data.length < PAGE_SIZE
    ) {
      break;
    }
  }

  return {
    data: rows,
    error: null,
  };
}

function App() {
  const [session, setSession] =
    useState(null);
  const [loading, setLoading] =
    useState(true);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
        setLoading(false);
      });

    const { data: subscription } =
      supabase.auth.onAuthStateChange(
        (_event, nextSession) => {
          setSession(nextSession);
        },
      );

    return () =>
      subscription.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="authWrap">
        <div className="muted">
          Loading...
        </div>
      </div>
    );
  }

  if (!session) return <Auth />;

  return <BillsApp session={session} />;
}

function Auth() {
  const [email, setEmail] =
    useState('');
  const [password, setPassword] =
    useState('');
  const [mode, setMode] =
    useState('login');
  const [message, setMessage] =
    useState('');

  async function submit() {
    setMessage('');

    const action =
      mode === 'login'
        ? supabase.auth.signInWithPassword({
            email,
            password,
          })
        : supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo:
                window.location.href.split(
                  '?',
                )[0],
            },
          });

    const { error } = await action;

    setMessage(
      error
        ? error.message
        : mode === 'login'
          ? 'Signed in.'
          : 'Check your email if confirmation is required.',
    );
  }

  return (
    <div className="authWrap">
      <div className="card authCard">
        <div className="pad">
          <div className="toolbar">
            <div className="logo">BB</div>
            <div>
              <h1>Bills & Budget</h1>
              <div className="help">
                Secure bank sync · v
                {APP_VERSION}
              </div>
            </div>
          </div>

          <div
            className="row"
            style={{ marginTop: 16 }}
          >
            <div>
              <label>Email</label>
              <input
                value={email}
                onChange={(event) =>
                  setEmail(
                    event.target.value,
                  )
                }
              />
            </div>

            <div>
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(
                    event.target.value,
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    submit();
                  }
                }}
              />
            </div>
          </div>

          <div
            className="toolbar"
            style={{ marginTop: 12 }}
          >
            <button
              className="brand"
              onClick={submit}
            >
              {mode === 'login'
                ? 'Log in'
                : 'Create account'}
            </button>

            <button
              className="ghost"
              onClick={() =>
                setMode(
                  mode === 'login'
                    ? 'signup'
                    : 'login',
                )
              }
            >
              {mode === 'login'
                ? 'Need an account?'
                : 'Already have an account?'}
            </button>
          </div>

          {message && (
            <p className="help">
              {message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function readLegacyData() {
  try {
    const profileId =
      localStorage.getItem(
        'bb_current_profile',
      );

    const key = profileId
      ? `billDB_v1:${profileId}`
      : 'billDB_v1';

    const parsed = JSON.parse(
      localStorage.getItem(key) || 'null',
    );

    if (
      !parsed ||
      !Array.isArray(parsed.bills)
    ) {
      return null;
    }

    return {
      bills: parsed.bills,
      marks: Array.isArray(
        parsed.monthMarks,
      )
        ? parsed.monthMarks
        : [],
      logs: Array.isArray(parsed.txns)
        ? parsed.txns
        : [],
    };
  } catch {
    return null;
  }
}

function BillsApp({ session }) {
  const [bills, setBills] =
    useState([]);
  const [marks, setMarks] =
    useState([]);
  const [
    paymentLogs,
    setPaymentLogs,
  ] = useState([]);
  const [
    plaidTransactions,
    setPlaidTransactions,
  ] = useState([]);
  const [accounts, setAccounts] =
    useState([]);
  const [
    accountMappings,
    setAccountMappings,
  ] = useState([]);
  const [matchRules, setMatchRules] =
    useState([]);

  const [view, setView] =
    useState('dashboard');

  const [filters, setFilters] =
    useState({
      category: 'all',
      status: 'any',
      autopay: 'all',
      search: '',
      sort: 'due',
      trackerSort: 'alpha',
    });

  const [bankMonth, setBankMonth] =
    useState(currentMonthValue());

  const [bankFilters, setBankFilters] =
    useState({
      account: 'all',
      billState: 'all',
      classification: 'all',
      flow: 'all',
      search: '',
    });

  const [editing, setEditing] =
    useState(null);
  const [paying, setPaying] =
    useState(null);
  const [
    monthDetail,
    setMonthDetail,
  ] = useState(null);
  const [
    classifying,
    setClassifying,
  ] = useState(null);
  const [linking, setLinking] =
    useState(null);
  const [expanded, setExpanded] =
    useState({});

  const [syncing, setSyncing] =
    useState(false);
  const [
    connecting,
    setConnecting,
  ] = useState(false);
  const [matching, setMatching] =
    useState(false);

  const [
    plaidStatus,
    setPlaidStatus,
  ] = useState('');
  const [
    matchStatus,
    setMatchStatus,
  ] = useState('');
  const [appStatus, setAppStatus] =
    useState('');
  const [
    migrationStatus,
    setMigrationStatus,
  ] = useState('');
  const [migrating, setMigrating] =
    useState(false);

  const loadAll = useCallback(
    async () => {
      const [
        billsResult,
        marksResult,
        logsResult,
        accountsResult,
        transactionsResult,
        mappingsResult,
        rulesResult,
      ] = await Promise.all([
        supabase
          .from('bills')
          .select('*')
          .order('name'),
        fetchPagedRows({
          table: 'bill_month_marks',
          orderColumn: 'year',
          ascending: false,
        }),
        fetchPagedRows({
          table: 'payment_logs',
          orderColumn: 'date',
          ascending: false,
        }),
        supabase
          .from('plaid_accounts')
          .select('*')
          .order('name'),
        fetchPagedRows({
          table: 'plaid_transactions',
          orderColumn: 'date',
          ascending: false,
        }),
        supabase
          .from(
            'category_account_mappings',
          )
          .select('*')
          .order('bill_category'),
        supabase
          .from('bill_match_rules')
          .select('*')
          .eq('active', true)
          .order('last_confirmed_at', {
            ascending: false,
          }),
      ]);

      const results = [
        billsResult,
        marksResult,
        logsResult,
        accountsResult,
        transactionsResult,
        mappingsResult,
        rulesResult,
      ];

      const failures = results
        .filter((result) => result.error)
        .map(
          (result) =>
            result.error.message,
        );

      setAppStatus(failures[0] || '');

      if (!billsResult.error) {
        setBills(billsResult.data || []);
      }

      if (!marksResult.error) {
        setMarks(marksResult.data || []);
      }

      if (!logsResult.error) {
        setPaymentLogs(
          logsResult.data || [],
        );
      }

      if (!accountsResult.error) {
        setAccounts(
          accountsResult.data || [],
        );
      }

      if (!transactionsResult.error) {
        setPlaidTransactions(
          transactionsResult.data || [],
        );
      }

      if (!mappingsResult.error) {
        setAccountMappings(
          mappingsResult.data || [],
        );
      }

      if (!rulesResult.error) {
        setMatchRules(
          rulesResult.data || [],
        );
      }
    },
    [],
  );

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const legacyDataAvailable =
    Boolean(
      readLegacyData()?.bills.length,
    );

  const visibleBills = useMemo(
    () =>
      bills
        .filter((bill) => !bill.archived)
        .filter(
          (bill) =>
            filters.category === 'all' ||
            bill.category ===
              filters.category,
        )
        .filter(
          (bill) =>
            filters.autopay === 'all' ||
            (
              bill.autopay
                ? 'yes'
                : 'no'
            ) === filters.autopay,
        )
        .filter((bill) => {
          const needle =
            filters.search
              .trim()
              .toLowerCase();

          if (!needle) return true;

          return [
            bill.name,
            bill.subcategory,
            bill.notes,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(needle);
        })
        .filter(
          (bill) =>
            filters.status === 'any' ||
            statusFor(bill).code ===
              filters.status,
        )
        .sort((left, right) => {
          if (
            filters.sort ===
            'amountAsc'
          ) {
            return (
              monthlyEq(left) -
              monthlyEq(right)
            );
          }

          if (
            filters.sort ===
            'amountDesc'
          ) {
            return (
              monthlyEq(right) -
              monthlyEq(left)
            );
          }

          return (
            statusFor(left).due -
            statusFor(right).due
          );
        }),
    [bills, filters],
  );

  const kpis = useMemo(() => {
    const now = today();

    let overdueCnt = 0;
    let dueAmt = 0;
    let monthTotal = 0;
    let paidTotal = 0;
    let totOverdue = 0;
    let totBalance = 0;

    visibleBills.forEach((bill) => {
      const status = statusFor(bill);

      if (status.code === 'overdue') {
        overdueCnt += 1;
      }

      if (status.code === 'due') {
        dueAmt += clamp0(bill.amount);
      }

      if (
        status.due.getMonth() ===
          now.getMonth() &&
        status.due.getFullYear() ===
          now.getFullYear()
      ) {
        monthTotal +=
          clamp0(bill.amount);
      }

      totOverdue +=
        clamp0(bill.overdue);
      totBalance +=
        clamp0(bill.balance);
    });

    paymentLogs.forEach((log) => {
      const date = new Date(
        `${log.date}T12:00:00`,
      );

      if (
        date.getMonth() ===
          now.getMonth() &&
        date.getFullYear() ===
          now.getFullYear()
      ) {
        paidTotal +=
          clamp0(log.amount);
      }
    });

    return {
      overdueCnt,
      dueAmt,
      monthTotal,
      paidTotal,
      totOverdue,
      totBalance,
    };
  }, [visibleBills, paymentLogs]);

  function getMark(
    billId,
    year,
    month,
  ) {
    return marks.find(
      (mark) =>
        mark.key ===
        monthKey(
          billId,
          year,
          month,
        ),
    );
  }

  function transactionsForBillMonth(
    billId,
    year,
    month,
  ) {
    const value =
      `${year}-` +
      String(month).padStart(2, '0');

    return plaidTransactions.filter(
      (transaction) =>
        inMonth(transaction.date, value) &&
        (
          transaction.matched_bill_id ===
            billId ||
          transaction.suggested_bill_id ===
            billId
        ),
    );
  }

  async function markPaidThrough(
    bill,
    year,
    month,
  ) {
    const rows = [];
    let newlyPaid = 0;
    const priorYear = year - 1;

    for (
      let currentMonth = 1;
      currentMonth <= 12;
      currentMonth += 1
    ) {
      if (
        getMark(
          bill.id,
          priorYear,
          currentMonth,
        )?.paid
      ) {
        continue;
      }

      newlyPaid += 1;

      rows.push({
        user_id: session.user.id,
        bill_id: bill.id,
        key: monthKey(
          bill.id,
          priorYear,
          currentMonth,
        ),
        year: priorYear,
        month: currentMonth,
        paid: true,
        amount: monthlyEq(bill),
        date: toISO(today()),
        source: 'manual',
      });
    }

    for (
      let currentMonth = 1;
      currentMonth <= month;
      currentMonth += 1
    ) {
      if (
        getMark(
          bill.id,
          year,
          currentMonth,
        )?.paid
      ) {
        continue;
      }

      newlyPaid += 1;

      rows.push({
        user_id: session.user.id,
        bill_id: bill.id,
        key: monthKey(
          bill.id,
          year,
          currentMonth,
        ),
        year,
        month: currentMonth,
        paid: true,
        amount: monthlyEq(bill),
        date: toISO(today()),
        source: 'manual',
      });
    }

    if (rows.length) {
      const { error } = await supabase
        .from('bill_month_marks')
        .upsert(rows, {
          onConflict: 'user_id,key',
        });

      if (error) {
        setAppStatus(error.message);
        return;
      }
    }

    if (newlyPaid > 0) {
      const { error } = await supabase
        .from('payment_logs')
        .insert({
          user_id: session.user.id,
          bill_id: bill.id,
          date: toISO(today()),
          amount:
            newlyPaid * monthlyEq(bill),
          memo:
            `Tracker: paid through ` +
            `${year}-${String(month).padStart(2, '0')}`,
          period_key:
            `trackerThrough:${year}-` +
            String(month).padStart(
              2,
              '0',
            ),
          source: 'manual',
        });

      if (error) {
        setAppStatus(error.message);
        return;
      }
    }

    setExpanded((previous) => ({
      ...previous,
      [bill.id]: false,
    }));

    setMonthDetail(null);
    await loadAll();
  }

  function billPayloadFromForm(form) {
    const keywords = Array.isArray(
      form.match_keywords,
    )
      ? form.match_keywords
      : String(
          form.match_keywords || '',
        ).split(',');

    return {
      name: String(form.name || '').trim(),
      category:
        form.category || 'Household',
      subcategory:
        form.subcategory || '',
      amount: clamp0(form.amount),
      frequency:
        form.frequency || 'monthly',
      anchor:
        form.anchor || toISO(today()),
      custom_days: form.custom_days
        ? Number(form.custom_days)
        : null,
      autopay: Boolean(form.autopay),
      overdue: clamp0(form.overdue),
      balance: clamp0(form.balance),
      balance_as_of:
        form.balance_as_of || null,
      portal_url:
        form.portal_url || '',
      account: form.account || '',
      notes: form.notes || '',
      next_due:
        form.next_due || null,
      last_paid:
        form.last_paid || null,
      current_as_of:
        form.current_as_of || null,
      cancel_requested: Boolean(
        form.cancel_requested,
      ),
      cancel_at:
        form.cancel_at || null,
      archived: Boolean(form.archived),
      archived_at:
        form.archived_at || null,
      mail_updated_at:
        form.mail_updated_at || null,
      match_mode:
        form.match_mode || 'review',
      match_keywords: keywords
        .map((value) =>
          String(value).trim(),
        )
        .filter(Boolean),
      match_amount_tolerance:
        Math.max(
          0,
          Math.min(
            1,
            Number(
              form.match_amount_tolerance,
            ) || 0.15,
          ),
        ),
      updated_at:
        new Date().toISOString(),
    };
  }

  async function saveBill(form) {
    const payload =
      billPayloadFromForm(form);

    if (!payload.name) {
      setAppStatus(
        'Enter a bill name before saving.',
      );
      return;
    }

    const result = form.id
      ? await supabase
          .from('bills')
          .update(payload)
          .eq('id', form.id)
          .eq(
            'user_id',
            session.user.id,
          )
      : await supabase
          .from('bills')
          .insert({
            ...payload,
            user_id: session.user.id,
          });

    if (result.error) {
      setAppStatus(
        result.error.message,
      );
      return;
    }

    setEditing(null);
    setAppStatus('');
    await loadAll();
  }

  async function deleteBill(id) {
    if (
      !confirm(
        'Delete this bill and its tracker/pay-log rows?',
      )
    ) {
      return;
    }

    const relatedTransactions =
      plaidTransactions.filter(
        (transaction) =>
          transaction.matched_bill_id ===
            id ||
          transaction.suggested_bill_id ===
            id,
      );

    try {
      for (
        const transaction
        of relatedTransactions
      ) {
        const action =
          transaction.matched_bill_id === id
            ? 'unmatch'
            : 'reject';

        await invokeFunction(
          'bill-match-action',
          {
            body: {
              action,
              transaction_id:
                transaction.transaction_id,
              bill_id: id,
            },
          },
        );
      }

      const { error } = await supabase
        .from('bills')
        .delete()
        .eq('id', id)
        .eq(
          'user_id',
          session.user.id,
        );

      if (error) throw error;

      setEditing(null);
      await loadAll();
    } catch (error) {
      setAppStatus(error.message);
    }
  }

  async function markCurrent(bill) {
    const date = toISO(today());
    const currentDue =
      nextDueFrom(bill);
    const nextDue = nextDueFrom(
      bill,
      addDays(currentDue, 1),
    );

    const { error: logError } =
      await supabase
        .from('payment_logs')
        .insert({
          user_id: session.user.id,
          bill_id: bill.id,
          date,
          amount:
            clamp0(bill.amount),
          memo: 'Marked current',
          period_key: periodKey(
            bill,
            currentDue,
          ),
          source: 'manual',
        });

    if (logError) {
      setAppStatus(logError.message);
      return;
    }

    const { error: billError } =
      await supabase
        .from('bills')
        .update({
          last_paid: date,
          current_as_of: date,
          overdue: 0,
          balance: 0,
          balance_as_of: date,
          next_due: toISO(nextDue),
          updated_at:
            new Date().toISOString(),
        })
        .eq('id', bill.id)
        .eq(
          'user_id',
          session.user.id,
        );

    if (billError) {
      setAppStatus(billError.message);
      return;
    }

    await loadAll();
  }

  async function savePartialPayment(
    form,
  ) {
    const amount = clamp0(form.amount);

    if (!amount) {
      setAppStatus(
        'Enter a payment amount.',
      );
      return;
    }

    const { error: logError } =
      await supabase
        .from('payment_logs')
        .insert({
          user_id: session.user.id,
          bill_id: paying.id,
          date: form.date,
          amount,
          memo:
            form.memo ||
            'Partial payment',
          period_key:
            periodKey(paying),
          source: 'manual',
        });

    if (logError) {
      setAppStatus(logError.message);
      return;
    }

    const update = {
      last_paid: form.date,
      overdue: Math.max(
        0,
        clamp0(paying.overdue) -
          amount,
      ),
      updated_at:
        new Date().toISOString(),
    };

    if (form.reduceBalance) {
      update.balance = Math.max(
        0,
        clamp0(paying.balance) -
          amount,
      );
      update.balance_as_of =
        form.date;
    }

    const { error: billError } =
      await supabase
        .from('bills')
        .update(update)
        .eq('id', paying.id)
        .eq(
          'user_id',
          session.user.id,
        );

    if (billError) {
      setAppStatus(billError.message);
      return;
    }

    setPaying(null);
    await loadAll();
  }

  async function connectPlaid() {
    setConnecting(true);
    setPlaidStatus(
      'Starting secure bank connection...',
    );

    try {
      if (!window.Plaid) {
        throw new Error(
          'Plaid Link did not load. Refresh the page and try again.',
        );
      }

      const data = await invokeFunction(
        'plaid-create-link-token',
      );

      const handler =
        window.Plaid.create({
          token: data.link_token,

          onSuccess: async (
            publicToken,
            metadata,
          ) => {
            try {
              setPlaidStatus(
                `Finishing ` +
                `${metadata.institution?.name || 'bank'} connection...`,
              );

              await invokeFunction(
                'plaid-exchange-public-token',
                {
                  body: {
                    public_token:
                      publicToken,
                    institution:
                      metadata.institution,
                  },
                },
              );

              await loadAll();

              setPlaidStatus(
                `${metadata.accounts?.length || 0} account(s) connected successfully.`,
              );
            } catch (error) {
              setPlaidStatus(
                error.message,
              );
            } finally {
              setConnecting(false);
              handler.destroy();
            }
          },

          onExit: (error) => {
            setPlaidStatus(
              error
                ? error.display_message ||
                    error.error_message ||
                    'Bank connection was not completed.'
                : 'Bank connection canceled.',
            );

            setConnecting(false);
            handler.destroy();
          },
        });

      handler.open();
    } catch (error) {
      setPlaidStatus(error.message);
      setConnecting(false);
    }
  }

  async function syncPlaid() {
    setSyncing(true);
    setPlaidStatus(
      'Refreshing balances and transactions...',
    );

    try {
      const result =
        await invokeFunction(
          'plaid-sync-transactions',
        );

      await loadAll();

      setPlaidStatus(
        `Sync complete: ` +
        `${result.imported || 0} transaction update(s), ` +
        `${result.suggested || 0} suggestion(s), ` +
        `${result.automatic || 0} automatic match(es).`,
      );
    } catch (error) {
      setPlaidStatus(error.message);
    } finally {
      setSyncing(false);
    }
  }

  async function disconnectPlaid(
    itemId,
  ) {
    if (
      !confirm(
        'Disconnect this institution and remove its imported accounts and transactions?',
      )
    ) {
      return;
    }

    setPlaidStatus(
      'Disconnecting institution...',
    );

    try {
      await invokeFunction(
        'plaid-disconnect-item',
        {
          body: {
            item_id: itemId,
          },
        },
      );

      await loadAll();

      setPlaidStatus(
        'Institution disconnected.',
      );
    } catch (error) {
      setPlaidStatus(error.message);
    }
  }

  async function saveAccountMapping(
    category,
    accountId,
  ) {
    setPlaidStatus(
      `Saving ${category} account...`,
    );

    if (!accountId) {
      const { error } = await supabase
        .from(
          'category_account_mappings',
        )
        .delete()
        .eq(
          'user_id',
          session.user.id,
        )
        .eq('bill_category', category);

      if (error) {
        setPlaidStatus(error.message);
        return;
      }
    } else {
      const { error } = await supabase
        .from(
          'category_account_mappings',
        )
        .upsert(
          {
            user_id:
              session.user.id,
            bill_category: category,
            account_id: accountId,
            updated_at:
              new Date().toISOString(),
          },
          {
            onConflict:
              'user_id,bill_category',
          },
        );

      if (error) {
        setPlaidStatus(error.message);
        return;
      }
    }

    await loadAll();

    setPlaidStatus(
      `${category} account assignment saved.`,
    );
  }

  async function runAiMatch() {
    const categoriesToCheck =
      filters.category === 'all'
        ? ['Household', 'Business']
        : [filters.category];

    const missingMappings =
      categoriesToCheck.filter(
        (category) =>
          !accountMappings.some(
            (mapping) =>
              mapping.bill_category ===
              category,
          ),
      );

    if (missingMappings.length) {
      setMatchStatus(
        `Assign a bank account to ${missingMappings.join(' and ')} on the Plaid page first.`,
      );
      return;
    }

    setMatching(true);
    setMatchStatus(
      `Looking for ${monthLabel(bankMonth)} bill payments...`,
    );

    try {
      const result =
        await invokeFunction(
          'ai-match-bills',
          {
            body: {
              month: bankMonth,
              category:
                filters.category,
            },
          },
        );

      await loadAll();

      setMatchStatus(
        `${result.message} ` +
        `${result.local_suggestions || 0} local suggestion(s), ` +
        `${result.ai_suggestions || 0} AI suggestion(s), ` +
        `${result.automatic_matches || 0} automatic match(es).`,
      );
    } catch (error) {
      setMatchStatus(error.message);
    } finally {
      setMatching(false);
    }
  }

  async function matchTransaction(
    action,
    transaction,
    billId = null,
  ) {
    setMatchStatus(
      `${
        action === 'approve'
          ? 'Saving'
          : action === 'reject'
            ? 'Rejecting'
            : 'Removing'
      } bank match...`,
    );

    try {
      await invokeFunction(
        'bill-match-action',
        {
          body: {
            action,
            transaction_id:
              transaction.transaction_id,
            bill_id:
              billId ||
              transaction.suggested_bill_id ||
              transaction.matched_bill_id,
          },
        },
      );

      setMonthDetail(null);
      setLinking(null);

      await loadAll();

      setMatchStatus(
        action === 'approve'
          ? 'Match approved. Bill Tracker learned this bank wording for next time.'
          : action === 'reject'
            ? 'Suggestion rejected and remembered.'
            : 'Bank match removed.',
      );
    } catch (error) {
      setMatchStatus(error.message);
    }
  }

  async function saveClassification(
    transaction,
    form,
  ) {
    const category = String(
      form.category || '',
    ).trim();

    const { error } = await supabase
      .from('plaid_transactions')
      .update({
        spending_category:
          category || null,
        spending_subcategory:
          String(
            form.subcategory || '',
          ).trim() || null,
        classification_status:
          category
            ? 'manual'
            : 'uncharacterized',
        classified_at:
          category
            ? new Date().toISOString()
            : null,
        excluded_from_spending:
          Boolean(form.excluded),
      })
      .eq(
        'user_id',
        session.user.id,
      )
      .eq(
        'transaction_id',
        transaction.transaction_id,
      );

    if (error) {
      setAppStatus(error.message);
      return;
    }

    setClassifying(null);
    await loadAll();
  }

  async function importLegacyData() {
    const legacy = readLegacyData();

    if (!legacy?.bills.length) {
      setMigrationStatus(
        'No existing Bills & Budget data was found in this browser.',
      );
      return;
    }

    if (bills.length) {
      setMigrationStatus(
        'Import is available only when this account has no bills, which prevents duplicates.',
      );
      return;
    }

    if (
      !confirm(
        `Import ${legacy.bills.length} existing bill(s), ` +
        `${legacy.marks.length} tracker mark(s), and ` +
        `${legacy.logs.length} pay-log row(s) into this account?`,
      )
    ) {
      return;
    }

    setMigrating(true);
    setMigrationStatus(
      'Importing existing browser data...',
    );

    let insertedBillIds = [];

    try {
      const billRows =
        legacy.bills.map(
          (bill, index) => ({
            user_id:
              session.user.id,
            legacy_id: String(
              bill.id ||
                `legacy-${index}`,
            ),
            name:
              bill.name ||
              'Unnamed bill',
            category:
              bill.category ||
              'Household',
            subcategory:
              bill.subcategory || '',
            amount:
              clamp0(bill.amount),
            frequency:
              bill.frequency ||
              'monthly',
            anchor:
              bill.anchor ||
              toISO(today()),
            custom_days:
              bill.customDays
                ? Number(
                    bill.customDays,
                  )
                : null,
            autopay:
              bill.autopay === true ||
              bill.autopay === 'yes',
            overdue:
              clamp0(bill.overdue),
            balance:
              clamp0(bill.balance),
            balance_as_of:
              bill.balanceAsOf ||
              null,
            portal_url:
              bill.portalUrl || '',
            account:
              bill.account || '',
            notes:
              bill.notes || '',
            current_as_of:
              bill.currentAsOf ||
              null,
            cancel_requested:
              Boolean(
                bill.cancelRequested,
              ),
            cancel_at:
              bill.cancelAt || null,
            archived:
              Boolean(bill.archived),
            archived_at:
              bill.archivedAt ||
              null,
            mail_updated_at:
              bill.mailUpdatedAt ||
              null,
            match_mode: 'review',
            match_keywords: [],
          }),
        );

      const {
        data: insertedBills,
        error: billError,
      } = await supabase
        .from('bills')
        .insert(billRows)
        .select('id,legacy_id');

      if (billError) throw billError;

      insertedBillIds =
        insertedBills.map(
          (bill) => bill.id,
        );

      const idMap =
        Object.fromEntries(
          insertedBills.map(
            (bill) => [
              bill.legacy_id,
              bill.id,
            ],
          ),
        );

      const markRows =
        legacy.marks.flatMap(
          (mark) => {
            const billId =
              idMap[
                String(mark.billId)
              ];
            const year = Number(
              mark.year,
            );
            const month = Number(
              mark.month,
            );

            if (
              !billId ||
              !year ||
              month < 1 ||
              month > 12
            ) {
              return [];
            }

            return [
              {
                user_id:
                  session.user.id,
                bill_id: billId,
                key: monthKey(
                  billId,
                  year,
                  month,
                ),
                year,
                month,
                paid:
                  mark.paid !== false,
                amount:
                  clamp0(mark.amount),
                date:
                  mark.date ||
                  toISO(today()),
                source: 'manual',
              },
            ];
          },
        );

      for (
        let index = 0;
        index < markRows.length;
        index += 250
      ) {
        const { error } =
          await supabase
            .from('bill_month_marks')
            .insert(
              markRows.slice(
                index,
                index + 250,
              ),
            );

        if (error) throw error;
      }

      const logRows =
        legacy.logs.flatMap(
          (log) => {
            const billId =
              idMap[
                String(log.billId)
              ];

            if (!billId) return [];

            return [
              {
                user_id:
                  session.user.id,
                bill_id: billId,
                date:
                  log.date ||
                  toISO(today()),
                amount:
                  clamp0(log.amount),
                memo:
                  log.memo ||
                  'Imported payment',
                period_key:
                  log.periodKey || '',
                source:
                  log.source ||
                  'manual',
              },
            ];
          },
        );

      for (
        let index = 0;
        index < logRows.length;
        index += 250
      ) {
        const { error } =
          await supabase
            .from('payment_logs')
            .insert(
              logRows.slice(
                index,
                index + 250,
              ),
            );

        if (error) throw error;
      }

      await loadAll();

      setMigrationStatus(
        `Imported ${billRows.length} bills, ` +
        `${markRows.length} tracker marks, and ` +
        `${logRows.length} pay-log rows.`,
      );
    } catch (error) {
      if (insertedBillIds.length) {
        await supabase
          .from('payment_logs')
          .delete()
          .in(
            'bill_id',
            insertedBillIds,
          );

        await supabase
          .from('bill_month_marks')
          .delete()
          .in(
            'bill_id',
            insertedBillIds,
          );

        await supabase
          .from('bills')
          .delete()
          .in(
            'id',
            insertedBillIds,
          );
      }

      setMigrationStatus(
        `Import stopped and rolled back: ${error.message}`,
      );
    } finally {
      setMigrating(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  const navItems = [
    ['dashboard', 'Dashboard'],
    ['tracker', 'Tracker'],
    ['transactions', 'Transactions'],
    ['spending', 'Spending'],
    ['paylog', 'Pay Log'],
    ['summary', 'Summary'],
    ['plaid', 'Plaid'],
  ];

  return (
    <>
      <header className="appHeader">
        <div className="toolbar brandBlock">
          <div className="logo">BB</div>
          <div>
            <h1>Bills & Budget</h1>
            <div className="help">
              {session.user.email} · v
              {APP_VERSION}
            </div>
          </div>
        </div>

        <div className="navRow">
          {navItems.map(
            ([value, label]) => (
              <button
                key={value}
                className={
                  `ghost mini ` +
                  `${view === value ? 'activeNav' : ''}`
                }
                onClick={() =>
                  setView(value)
                }
              >
                {label}
              </button>
            ),
          )}
        </div>

        <div className="headerFilters">
          <select
            aria-label="Bill category filter"
            value={filters.category}
            onChange={(event) =>
              setFilters({
                ...filters,
                category:
                  event.target.value,
              })
            }
          >
            <option value="all">All</option>
            <option>Household</option>
            <option>Business</option>
          </select>

          <select
            aria-label="Bill status filter"
            value={filters.status}
            onChange={(event) =>
              setFilters({
                ...filters,
                status:
                  event.target.value,
              })
            }
          >
            <option value="any">Any</option>
            <option value="current">
              Current
            </option>
            <option value="overdue">
              Overdue
            </option>
            <option value="due">Due</option>
            <option value="future">
              Future
            </option>
            <option value="cancel">
              Need to cancel
            </option>
          </select>

          <select
            aria-label="Autopay filter"
            value={filters.autopay}
            onChange={(event) =>
              setFilters({
                ...filters,
                autopay:
                  event.target.value,
              })
            }
          >
            <option value="all">
              All bills
            </option>
            <option value="yes">
              Autopay only
            </option>
            <option value="no">
              Manual pay only
            </option>
          </select>

          <button
            className="ghost mini"
            onClick={signOut}
          >
            Sign out
          </button>
        </div>
      </header>

      <main>
        {appStatus && (
          <p
            className="errorMessage"
            role="alert"
          >
            {appStatus}
          </p>
        )}

        {view === 'dashboard' && (
          <Dashboard
            kpis={kpis}
            bills={visibleBills}
            filters={filters}
            setFilters={setFilters}
            onEdit={setEditing}
            onAdd={() =>
              setEditing({
                ...blankBill,
              })
            }
            onCurrent={markCurrent}
            onPartial={setPaying}
            onImport={importLegacyData}
            legacyDataAvailable={
              legacyDataAvailable
            }
            migrating={migrating}
            migrationStatus={
              migrationStatus
            }
          />
        )}

        {view === 'tracker' && (
          <Tracker
            bills={visibleBills}
            filters={filters}
            setFilters={setFilters}
            expanded={expanded}
            setExpanded={setExpanded}
            getMark={getMark}
            transactionsForBillMonth={
              transactionsForBillMonth
            }
            onMonth={(
              bill,
              year,
              month,
            ) =>
              setMonthDetail({
                bill,
                year,
                month,
              })
            }
          />
        )}

        {view === 'transactions' && (
          <TransactionsPage
            month={bankMonth}
            setMonth={setBankMonth}
            transactions={
              plaidTransactions
            }
            accounts={accounts}
            bills={bills}
            filters={bankFilters}
            setFilters={
              setBankFilters
            }
            matching={matching}
            matchStatus={matchStatus}
            onMatchMonth={runAiMatch}
            onClassify={
              setClassifying
            }
            onLink={setLinking}
            onMatchAction={
              matchTransaction
            }
          />
        )}

        {view === 'spending' && (
          <SpendingPage
            month={bankMonth}
            setMonth={setBankMonth}
            transactions={
              plaidTransactions
            }
            accounts={accounts}
            bills={bills}
            accountFilter={
              bankFilters.account
            }
            setAccountFilter={(
              account,
            ) =>
              setBankFilters({
                ...bankFilters,
                account,
              })
            }
          />
        )}

        {view === 'paylog' && (
          <PayLog
            logs={paymentLogs}
            bills={bills}
          />
        )}

        {view === 'summary' && (
          <Summary
            bills={visibleBills}
          />
        )}

        {view === 'plaid' && (
          <PlaidPanel
            accounts={accounts}
            transactions={
              plaidTransactions
            }
            bills={bills}
            mappings={
              accountMappings
            }
            matchRules={matchRules}
            onConnect={connectPlaid}
            onSync={syncPlaid}
            onDisconnect={
              disconnectPlaid
            }
            onMapping={
              saveAccountMapping
            }
            syncing={syncing}
            connecting={connecting}
            status={plaidStatus}
          />
        )}
      </main>

      {editing && (
        <BillDialog
          bill={editing}
          blankBill={blankBill}
          onClose={() =>
            setEditing(null)
          }
          onSave={saveBill}
          onDelete={deleteBill}
        />
      )}

      {paying && (
        <PartialDialog
          bill={paying}
          onClose={() =>
            setPaying(null)
          }
          onSave={
            savePartialPayment
          }
        />
      )}

      {classifying && (
        <ClassificationDialog
          transaction={classifying}
          onClose={() =>
            setClassifying(null)
          }
          onSave={
            saveClassification
          }
        />
      )}

      {linking && (
        <LinkBillDialog
          transaction={linking}
          bills={bills.filter(
            (bill) => !bill.archived,
          )}
          onClose={() =>
            setLinking(null)
          }
          onLink={(
            transaction,
            billId,
          ) =>
            matchTransaction(
              'approve',
              transaction,
              billId,
            )
          }
        />
      )}

      {monthDetail && (
        <MonthDetailDialog
          detail={monthDetail}
          mark={getMark(
            monthDetail.bill.id,
            monthDetail.year,
            monthDetail.month,
          )}
          transactions={
            transactionsForBillMonth(
              monthDetail.bill.id,
              monthDetail.year,
              monthDetail.month,
            )
          }
          onClose={() =>
            setMonthDetail(null)
          }
          onMarkPaidThrough={
            markPaidThrough
          }
          onMatchAction={
            matchTransaction
          }
        />
      )}
    </>
  );
}

createRoot(
  document.getElementById('root'),
).render(<App />);
