const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { transformSync } = require('esbuild');

const source = readFileSync(require('node:path').join(__dirname, '../_matching.ts'), 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'cjs' }).code;
const moduleUnderTest = { exports: {} };
new Function('module', 'exports', 'require', compiled)(moduleUnderTest, moduleUnderTest.exports, require);
const { recordConfirmedMatch, clearConfirmedMatch } = moduleUnderTest.exports;

function memoryClient() {
  const tables = { plaid_transactions: [], bill_month_marks: [], payment_logs: [], bill_match_feedback: [] };
  const from = (name) => {
    let rows = tables[name];
    let action = 'select';
    let payload;
    let max;
    const checks = [];
    const query = {
      select() { return query; },
      eq(field, value) { checks.push((row) => row[field] === value); return query; },
      neq(field, value) { checks.push((row) => row[field] !== value); return query; },
      gte(field, value) { checks.push((row) => row[field] >= value); return query; },
      lt(field, value) { checks.push((row) => row[field] < value); return query; },
      in(field, values) { checks.push((row) => values.includes(row[field])); return query; },
      order(field, { ascending }) { rows = [...rows].sort((a, b) => ascending ? String(a[field]).localeCompare(String(b[field])) : String(b[field]).localeCompare(String(a[field]))); return query; },
      limit(value) { max = value; return query; },
      update(value) { action = 'update'; payload = value; return query; },
      upsert(value, { onConflict }) { action = 'upsert'; payload = { value, keys: onConflict.split(',') }; return query; },
      delete() { action = 'delete'; return query; },
      maybeSingle() { return Promise.resolve({ data: rows.filter((row) => checks.every((check) => check(row)))[0] || null, error: null }); },
      then(resolve, reject) {
        const matches = rows.filter((row) => checks.every((check) => check(row))).slice(0, max);
        if (action === 'update') matches.forEach((row) => Object.assign(row, payload));
        if (action === 'delete') tables[name] = tables[name].filter((row) => !matches.includes(row));
        if (action === 'upsert') {
          const existing = tables[name].find((row) => payload.keys.every((key) => row[key] === payload.value[key]));
          if (existing) Object.assign(existing, payload.value);
          else tables[name].push({ ...payload.value });
        }
        return Promise.resolve({ data: action === 'select' ? matches : null, error: null }).then(resolve, reject);
      },
    };
    return query;
  };
  return { tables, client: { from } };
}

test('two charges to one bill in one month stay confirmed, and removing one retains the paid mark', async () => {
  const { tables, client } = memoryClient();
  const bill = { id: 'bill-1' };
  const first = { user_id: 'user-1', transaction_id: 'charge-1', account_id: 'account-1', date: '2026-10-16', amount: 106.4, name: 'OpenAI', matched_bill_id: null };
  const second = { ...first, transaction_id: 'charge-2', date: '2026-10-29' };
  tables.plaid_transactions.push(first, second);

  await recordConfirmedMatch(client, 'user-1', bill, first, 'approved', 1, 'Confirmed', 'manual', false);
  await recordConfirmedMatch(client, 'user-1', bill, second, 'approved', 1, 'Confirmed', 'manual', false);
  assert.equal(first.matched_bill_id, bill.id);
  assert.equal(second.matched_bill_id, bill.id);
  assert.equal(tables.payment_logs.length, 2);
  assert.equal(tables.bill_month_marks.length, 1);
  assert.equal(tables.bill_month_marks[0].plaid_transaction_id, second.transaction_id);

  await recordConfirmedMatch(client, 'user-1', bill, first, 'approved', 1, 'Confirmed again', 'manual', false);
  assert.equal(second.matched_bill_id, bill.id);
  assert.equal(tables.payment_logs.length, 2);
  assert.equal(tables.bill_month_marks[0].plaid_transaction_id, first.transaction_id);

  await clearConfirmedMatch(client, 'user-1', first.transaction_id);
  assert.equal(first.matched_bill_id, null);
  assert.equal(tables.bill_month_marks[0].plaid_transaction_id, second.transaction_id);

  await clearConfirmedMatch(client, 'user-1', second.transaction_id);
  assert.equal(second.matched_bill_id, null);
  assert.equal(tables.payment_logs.length, 0);
  assert.equal(tables.bill_month_marks.length, 0);
});
