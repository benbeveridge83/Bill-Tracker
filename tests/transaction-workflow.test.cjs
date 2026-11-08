const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { build } = require('esbuild');
const React = require('react');
const { create, act } = require('react-test-renderer');
let source;

async function fixture(storage = new Map()) {
  if (!source) {
    const result = await build({ entryPoints: [path.resolve('src/main.jsx')], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' }, plugins: [{ name: 'external-boundaries', setup(b) {
      b.onLoad({ filter: /supabaseClient\.js$/ }, () => ({ contents: 'export const supabase = globalThis.qa.supabase;' }));
      b.onLoad({ filter: /src\/main\.jsx$/ }, ({ path: filename }) => ({ loader: 'jsx', contents: fs.readFileSync(filename, 'utf8').replace(/createRoot\(\s*document\.getElementById\('root'\),\s*\)\.render\(<App \/>\);/, '') + '\nexport { BillsApp }; export { default as BillPicker } from "./components/BillPicker"; export { default as TransactionBillMatch } from "./components/TransactionBillMatch"; export { BillDialog, LinkBillDialog } from "./components/Dialogs";' }));
    } }] });
    source = result.outputFiles[0].text;
  }
  const month = new Date().toISOString().slice(0, 7);
  const state = { inserts: 0, failSave: false, failLink: false, aiCalls: [], aiMatches: [], aiAvailable: true };
  const tables = {
    bills: [{ id: 'clio', name: 'Clio', category: 'Business', amount: 330, bank_account_id: 'a' }, { id: 'gas', name: 'Gas', category: 'Household', amount: 36.5 }, { id: 'adobe', name: 'Adobe', category: 'Business', amount: 22 }],
    plaid_accounts: ['a', 'b', 'c'].map((account_id) => ({ account_id, name: account_id })),
    category_account_mappings: [{ account_id: 'a', bill_category: 'Business' }, { account_id: 'b', bill_category: 'Household' }],
    plaid_transactions: [{ transaction_id: 'clio-tx', account_id: 'a', name: 'Clio', merchant_name: 'Clio', amount: 343.45, date: `${month}-06`, classification_status: 'uncharacterized' }, { transaction_id: 'gas-tx', account_id: 'b', name: 'Gas', amount: 36.5, date: `${month}-05`, classification_status: 'uncharacterized' }, { transaction_id: 'other-tx', account_id: 'c', name: 'Other', amount: 9, date: `${month}-04`, classification_status: 'manual' }],
    bill_match_feedback: [],
  };
  const supabase = {
    from(table) {
      let inserted; let updated; const where = {};
      const q = { select: () => q, order: () => q, range: () => q, single: () => q,
        eq(column, value) { where[column] = value; return q; },
        insert(value) { inserted = value; return q; }, update(value) { updated = value; return q; },
        then(resolve, reject) {
          let result;
          if (inserted) {
            assert.equal(table, 'bills');
            if (state.failSave) result = { error: { message: 'Save unavailable' } };
            else { state.inserts++; const bill = { ...inserted, id: `new-${state.inserts}` }; tables.bills.push(bill); result = { data: { id: bill.id }, error: null }; }
          } else if (updated) {
            assert.equal(table, 'plaid_accounts'); assert.equal(where.user_id, 'qa-user');
            Object.assign(tables.plaid_accounts.find((a) => a.account_id === where.account_id), updated);
            result = { data: null, error: null };
          } else result = { data: tables[table] || [], error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      }; return q;
    },
    functions: { async invoke(name, { body }) {
      if (name === 'suggest-bill-matches') { state.aiCalls.push(body); return { data: { ai_available: state.aiAvailable, matches: state.aiMatches, message: 'AI suggestions need setup.' }, error: null }; }
      assert.equal(name, 'bill-match-action');
      if (state.failLink) return { error: new Error('Link unavailable') };
      const tx = tables.plaid_transactions.find((item) => item.transaction_id === body.transaction_id);
      if (body.action === 'approve') { tx.matched_bill_id = body.bill_id; tx.match_status = 'approved'; }
      else if (body.action === 'reject') tables.bill_match_feedback.push({ transaction_id: tx.transaction_id, bill_id: body.bill_id, decision: 'rejected' });
      return { data: {}, error: null };
    } },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require, console, setTimeout, clearTimeout, qa: { supabase }, localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } });
  const types = module.exports;
  let tree;
  await act(async () => { tree = create(React.createElement(types.BillsApp, { session: { user: { id: 'qa-user', email: 'qa@example.test' } } })); });
  const text = (node) => node.children.map((child) => typeof child === 'string' ? child : text(child)).join('');
  const button = (label, scope = tree.root) => scope.findAllByType('button').find((node) => text(node).startsWith(label));
  const click = async (node) => { assert.ok(node, 'Button must exist'); assert.ok(!node.props.disabled, 'Button must be enabled'); await act(async () => { await node.props.onClick(); }); };
  await click(button('Transactions'));
  return { state, tables, tree, types, storage, text, button, click, close: async () => { await act(async () => tree.unmount()); } };
}

test('inline suggestions, live search, row hiding and remembered picker choices', async () => {
  const f = await fixture();
  try {
    const { tree, types, click, button, text } = f;
    const inline = tree.root.findAllByType(types.TransactionBillMatch)[0];
    assert.match(text(inline), /Suggested bill: Clio/);
    assert.ok(!tree.root.findAllByType('th').some((th) => text(th) === 'Bill match'));
    let picker = inline.findByType(types.BillPicker);
    assert.equal(picker.props.value, 'clio');
    const input = () => picker.findByProps({ role: 'combobox' });
    await act(async () => input().props.onFocus());
    await act(async () => input().props.onChange({ target: { value: 'cl' } }));
    assert.deepEqual(picker.findAllByProps({ role: 'option' }).map(text), ['ClioBusiness$330.00']);
    assert.equal(button('Confirm bill', inline).props.disabled, true, 'Typing alone must not approve a suggestion');
    await act(async () => input().props.onKeyDown({ key: 'Enter', preventDefault() {} }));
    assert.equal(button('Confirm bill', inline).props.disabled, false);
    await act(async () => picker.findAllByType('select')[0].props.onChange({ target: { value: 'Household' } }));
    await act(async () => picker.findAllByType('select')[1].props.onChange({ target: { value: 'alpha' } }));
    assert.equal(inline.findByType(types.BillPicker).props.preferences.category, 'Household');
    const checks = () => tree.root.findAllByProps({ className: 'transactionVisibilityCheckbox' });
    await act(async () => checks()[0].props.onChange()); assert.equal(checks().length, 2);
    await click(button('Show all')); assert.equal(checks().length, 3);
    await f.close();
    const reopened = await fixture(f.storage);
    try { const prefs = reopened.tree.root.findAllByType(reopened.types.BillPicker)[0].props.preferences; assert.equal(prefs.category, 'Household'); assert.equal(prefs.sort, 'alpha'); }
    finally { await reopened.close(); }
  } finally { await f.close(); }
});

test('ChatGPT result appears inline and saved account category controls candidates', async () => {
  const f = await fixture();
  try {
    f.state.aiMatches = [{ transaction_id: 'clio-tx', bill_id: 'clio', confidence: 0.95, reason: 'Practice software', source: 'openai' }];
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 520)); });
    assert.ok(f.state.aiCalls.length);
    assert.match(f.text(f.tree.root.findAllByType(f.types.TransactionBillMatch)[0]), /AI suggestion: Clio/);
    await act(async () => f.tree.root.findByProps({ id: 'account-bill-category-a' }).props.onChange({ target: { value: 'Household' } }));
    assert.equal(f.tables.plaid_accounts[0].bill_match_category, 'Household');
    assert.doesNotMatch(f.text(f.tree.root.findAllByType(f.types.TransactionBillMatch)[0]), /AI suggestion: Clio/);
  } finally { await f.close(); }
});

test('new bill retains full form and a failed link retries the saved bill without duplicates', async () => {
  const f = await fixture();
  try {
    await f.click(f.button('Link to bill'));
    await f.click(f.button('+ Add a new bill'));
    const field = (label, type) => f.tree.root.findByType(f.types.BillDialog).findAllByType('label').find((node) => f.text(node) === label).parent.findByType(type);
    assert.equal(field('Name', 'input').props.value, 'Clio');
    assert.equal(field('Category', 'select').props.value, 'Business');
    await act(async () => field('Name', 'input').props.onChange({ target: { value: 'New software' } }));
    await act(async () => field('Portal URL', 'input').props.onChange({ target: { value: 'https://example.test/pay' } }));
    f.state.failSave = true; await f.click(f.button('Save and link'));
    assert.equal(f.tree.root.findByType(f.types.BillDialog).props.errorMessage, 'Save unavailable');
    assert.equal(f.state.inserts, 0);
    f.state.failSave = false; f.state.failLink = true; await f.click(f.button('Save and link'));
    assert.equal(f.state.inserts, 1);
    assert.equal(f.tables.bills.at(-1).portal_url, 'https://example.test/pay');
    assert.equal(f.tree.root.findByType(f.types.LinkBillDialog).findByType(f.types.BillPicker).props.value, 'new-1');
    f.state.failLink = false; await f.click(f.button('Approve and learn'));
    assert.equal(f.state.inserts, 1);
    assert.equal(f.tables.plaid_transactions[0].matched_bill_id, 'new-1');
    assert.equal(f.tree.root.findAllByType(f.types.LinkBillDialog).length, 0);
  } finally { await f.close(); }
});
