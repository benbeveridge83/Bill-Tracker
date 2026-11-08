const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { build } = require('esbuild');

const transaction = { transaction_id: 'tx-a', account_id: 'account-a', name: 'CLIO PAYMENT', merchant_name: 'Clio', amount: 343.45, date: '2026-11-06' };
const bills = [{ id: 'clio', name: 'Clio', category: 'Business', amount: 330, bank_account_id: 'account-a' }, { id: 'gas', name: 'Gas', category: 'Household', amount: 36.5 }];
let source;

async function handler({ key = 'test-only-key', output, feedback = [], failApi = false } = {}) {
  if (!source) {
    const result = await build({ entryPoints: [path.join(__dirname, 'index.ts')], bundle: true, write: false, platform: 'node', format: 'iife', plugins: [{ name: 'external-boundaries', setup(b) {
      b.onLoad({ filter: /_shared\.ts$/ }, () => ({ contents: 'export const { corsHeaders, getUser, json, serviceClient } = globalThis.testDependencies;' }));
    } }] });
    source = result.outputFiles[0].text;
  }
  let serve;
  const calls = [];
  const tables = { plaid_transactions: [transaction], bills, plaid_accounts: [{ account_id: 'account-a', bill_match_category: 'Business' }], category_account_mappings: [], bill_match_rules: [], bill_match_feedback: feedback };
  const dependencies = {
    corsHeaders: {}, json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
    getUser: async (request) => { if (request.headers.get('Authorization') !== 'Bearer signed-in-user') throw new Error('Unauthorized'); return { id: 'user-a' }; },
    serviceClient: () => ({ from(table) {
      let owner = false; let ids;
      const q = { select: () => q, limit: () => q, eq(column, value) { if (column === 'user_id') { assert.equal(value, 'user-a'); owner = true; } return q; }, in(column, values) { if (column === 'transaction_id') ids = values; return q; }, then(resolve, reject) {
        assert.ok(owner, `Missing ownership filter on ${table}`);
        let rows = tables[table];
        if (ids) rows = rows.filter((row) => ids.includes(row.transaction_id));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      } }; return q;
    } }),
  };
  vm.runInNewContext(source, { Request, Response, AbortSignal, console: { info() {}, warn() {} }, testDependencies: dependencies,
    Deno: { env: { get: (name) => name === 'OPENAI_API_KEY' ? key : undefined }, serve: (fn) => { serve = fn; } },
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      if (failApi) return new Response(JSON.stringify({ error: { code: 'insufficient_quota' } }), { status: 429 });
      return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ matches: output || [{ transaction_id: 'tx-a', bill_id: 'clio', confidence: 0.92, reason: 'Practice software subscription', category: 'Business' }] }) }] }] }));
    },
  });
  const request = async (body = { transaction_ids: ['tx-a'], category: 'account' }, signedIn = true) => {
    const response = await serve(new Request('https://example.test/suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(signedIn ? { Authorization: 'Bearer signed-in-user' } : {}) }, body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  };
  return { request, calls };
}

test('unauthenticated requests are rejected without database or AI access', async () => {
  const api = await handler();
  assert.equal((await api.request(undefined, false)).status, 401);
  assert.equal(api.calls.length, 0);
});
test('missing key leaves manual matching available without calling OpenAI', async () => {
  const api = await handler({ key: '' });
  assert.equal((await api.request()).body.ai_available, false);
  assert.equal(api.calls.length, 0);
});
test('AI uses only owned transactions and category-scoped candidates', async () => {
  const api = await handler();
  const result = await api.request();
  assert.equal(result.body.matches[0].bill_id, 'clio');
  const request = api.calls[0].body;
  assert.equal(request.store, false);
  const payload = JSON.parse(request.input);
  assert.deepEqual(payload.transactions[0].candidate_bill_ids, ['clio']);
  assert.deepEqual(payload.bills.map((bill) => bill.id), ['clio']);
  assert.ok(!request.input.includes('test-only-key'));
  assert.ok(!request.input.includes('account-a'));
});
test('foreign transaction IDs and rejected pairs cannot produce AI matches', async () => {
  const api = await handler({ feedback: [{ transaction_id: 'tx-a', bill_id: 'clio', decision: 'rejected' }] });
  assert.deepEqual((await api.request()).body.matches, []);
  assert.equal(api.calls.length, 0);
  const foreign = await handler();
  assert.deepEqual((await foreign.request({ transaction_ids: ['not-owned'], category: 'all' })).body.matches, []);
  assert.equal(foreign.calls.length, 0);
});
test('hallucinated IDs and out-of-category output are discarded', async () => {
  const api = await handler({ output: [{ transaction_id: 'tx-a', bill_id: 'gas', confidence: 0.99 }, { transaction_id: 'foreign', bill_id: 'clio', confidence: 1 }] });
  assert.deepEqual((await api.request()).body.matches, []);
});
test('API errors leave search available and oversized batches are rejected', async () => {
  const api = await handler({ failApi: true });
  assert.equal((await api.request()).body.ai_available, false);
  assert.equal((await api.request({ transaction_ids: Array(21).fill('tx-a'), category: 'all' })).status, 400);
});
