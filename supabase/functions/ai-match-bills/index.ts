import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function getUser(request: Request) {
  const authorization = request.headers.get('Authorization');
  if (!authorization) throw new Error('Missing authorization header');
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authorization } } },
  );
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('Unauthorized');
  return data.user;
}

function parseMonth(value: unknown) {
  const text = String(value || '');
  const match = /^(\d{4})-(\d{2})$/.exec(text);
  if (!match) throw new Error('Month must use YYYY-MM');
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error('Month must use YYYY-MM');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    text,
    year,
    month,
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

function normalize(value: unknown) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(?:x{2,}|\*+)\d{2,}\b/g, ' ')
    .replace(/\b\d{5,}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !['ach','auth','card','checkcard','debit','online','payment','pos','purchase','recurring','transaction','withdrawal','www','com'].includes(word))
    .join(' ')
    .trim();
}

function descriptor(transaction: any) {
  return normalize([
    transaction.merchant_name,
    transaction.name,
    ...(transaction.counterparty_names || []),
  ].filter(Boolean).join(' '));
}

function amountClose(actualValue: unknown, expectedValue: unknown, toleranceValue: unknown) {
  const actual = Math.abs(Number(actualValue) || 0);
  const expected = Math.abs(Number(expectedValue) || 0);
  if (!expected) return true;
  const tolerance = Math.max(0, Math.min(1, Number(toleranceValue) || 0.15));
  return Math.abs(actual - expected) <= Math.max(2, expected * tolerance);
}

function localScore(transaction: any, bill: any, rules: any[]) {
  if (transaction.pending || Number(transaction.amount) <= 0 || bill.match_mode === 'off') return null;
  const txText = descriptor(transaction);
  if (!txText) return null;
  const tolerance = bill.match_amount_tolerance ?? 0.15;

  for (const rule of rules) {
    if (rule.bill_id !== bill.id || rule.account_id !== transaction.account_id || rule.active === false) continue;
    const learned = normalize(rule.normalized_descriptor);
    if (learned && amountClose(transaction.amount, rule.amount_average || bill.amount, rule.amount_tolerance ?? tolerance)) {
      if (learned === txText) return { confidence: 0.995, reason: 'Previously approved bank wording matched exactly and the amount is similar.', source: 'learned_rule' };
      if (learned.length >= 5 && (txText.includes(learned) || learned.includes(txText))) return { confidence: 0.965, reason: 'Previously approved bank wording matched closely and the amount is similar.', source: 'learned_rule' };
    }
  }

  const phrases = [bill.name, ...(Array.isArray(bill.match_keywords) ? bill.match_keywords : [])]
    .map(normalize)
    .filter(Boolean);
  const exactPhrase = phrases.find((phrase) => phrase.length >= 4 && (txText.includes(phrase) || phrase.includes(txText)));
  const close = amountClose(transaction.amount, bill.amount, tolerance);
  if (exactPhrase && close) return { confidence: 0.94, reason: 'The bank wording matches the bill name or keyword and the amount is similar.', source: 'keyword' };

  const tokens = [...new Set(phrases.flatMap((phrase) => phrase.split(/\s+/)))].filter((token) => token.length >= 3);
  const matchingTokens = tokens.filter((token) => txText.includes(token));
  const ratio = tokens.length ? matchingTokens.length / tokens.length : 0;
  if (close && matchingTokens.length >= 1 && ratio >= 0.5) return { confidence: Math.min(0.92, 0.84 + ratio * 0.08), reason: `Matched bank wording (${matchingTokens.join(', ')}) and a similar amount.`, source: 'keyword' };
  if (exactPhrase) return { confidence: 0.74, reason: 'The bank wording matches, but the amount differs from the expected amount.', source: 'keyword' };
  return null;
}

async function saveSuggestion(supabase: any, userId: string, bill: any, transaction: any, result: any) {
  const { data: rejected, error: feedbackError } = await supabase
    .from('bill_match_feedback')
    .select('id')
    .eq('user_id', userId)
    .eq('bill_id', bill.id)
    .eq('transaction_id', transaction.transaction_id)
    .eq('decision', 'rejected')
    .maybeSingle();
  if (feedbackError) throw feedbackError;
  if (rejected) return false;

  const { error } = await supabase
    .from('plaid_transactions')
    .update({
      suggested_bill_id: bill.id,
      match_status: 'suggested',
      match_confidence: result.confidence,
      match_reason: result.reason,
      match_source: result.source,
      matched_at: null,
    })
    .eq('user_id', userId)
    .eq('transaction_id', transaction.transaction_id)
    .is('matched_bill_id', null);
  if (error) throw error;
  return true;
}

async function learnRule(supabase: any, userId: string, bill: any, transaction: any) {
  const text = descriptor(transaction);
  if (!text) return;
  const { data: existing, error: readError } = await supabase
    .from('bill_match_rules')
    .select('*')
    .eq('user_id', userId)
    .eq('bill_id', bill.id)
    .eq('account_id', transaction.account_id)
    .eq('normalized_descriptor', text)
    .maybeSingle();
  if (readError) throw readError;
  const amount = Math.abs(Number(transaction.amount) || 0);
  const now = new Date().toISOString();
  if (existing) {
    const count = Math.max(1, Number(existing.confirmation_count) || 1);
    const average = ((Number(existing.amount_average) || 0) * count + amount) / (count + 1);
    const { error } = await supabase.from('bill_match_rules').update({ amount_average: average, confirmation_count: count + 1, active: true, last_confirmed_at: now }).eq('id', existing.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from('bill_match_rules').insert({
    user_id: userId,
    bill_id: bill.id,
    account_id: transaction.account_id,
    normalized_descriptor: text,
    merchant_name: transaction.merchant_name || null,
    transaction_name: transaction.name || null,
    amount_average: amount,
    amount_tolerance: bill.match_amount_tolerance ?? 0.15,
    confirmation_count: 1,
    active: true,
    first_confirmed_at: now,
    last_confirmed_at: now,
  });
  if (error) throw error;
}

async function confirmAutomatic(supabase: any, userId: string, bill: any, transaction: any, result: any, month: any) {
  const amount = Math.abs(Number(transaction.amount) || 0);
  const now = new Date().toISOString();
  const key = `${bill.id}:${month.year}:${month.month}`;

  let response = await supabase.from('plaid_transactions').update({
    matched_bill_id: bill.id,
    suggested_bill_id: null,
    match_status: 'automatic',
    match_confidence: result.confidence,
    match_reason: result.reason,
    match_source: result.source,
    matched_at: now,
  }).eq('user_id', userId).eq('transaction_id', transaction.transaction_id);
  if (response.error) throw response.error;

  response = await supabase.from('bill_month_marks').upsert({
    user_id: userId,
    bill_id: bill.id,
    key,
    year: month.year,
    month: month.month,
    paid: true,
    amount,
    date: transaction.date,
    source: 'plaid',
    plaid_transaction_id: transaction.transaction_id,
    match_confidence: result.confidence,
    match_reason: result.reason,
  }, { onConflict: 'user_id,key' });
  if (response.error) throw response.error;

  response = await supabase.from('payment_logs').upsert({
    user_id: userId,
    bill_id: bill.id,
    date: transaction.date,
    amount,
    memo: `Bank match: ${transaction.merchant_name || transaction.name || 'Bank transaction'}`,
    period_key: `plaid:${month.text}`,
    source: 'plaid-auto',
    plaid_transaction_id: transaction.transaction_id,
  }, { onConflict: 'plaid_transaction_id' });
  if (response.error) throw response.error;

  response = await supabase.from('bill_match_feedback').upsert({
    user_id: userId,
    bill_id: bill.id,
    transaction_id: transaction.transaction_id,
    decision: 'approved',
    updated_at: now,
  }, { onConflict: 'user_id,bill_id,transaction_id' });
  if (response.error) throw response.error;
  await learnRule(supabase, userId, bill, transaction);
}

function extractOutputText(response: any) {
  if (typeof response?.output_text === 'string') return response.output_text;
  for (const output of response?.output || []) {
    for (const content of output?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

async function askOpenAI(payload: any) {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return { available: false, matches: [], model: null };
  const model = Deno.env.get('OPENAI_MATCH_MODEL') || 'gpt-5.6-luna';
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      matches: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            bill_id: { type: 'string' },
            transaction_id: { type: 'string' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            reason: { type: 'string' },
          },
          required: ['bill_id','transaction_id','confidence','reason'],
        },
      },
    },
    required: ['matches'],
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: 'Match recurring bills to bank transactions. Be conservative and omit ambiguous matches. Each bill and transaction includes a bank_account_id. Only match when those account IDs are identical. Positive transaction amounts are money leaving the bank. Use description similarity, amount similarity, keywords, date, and frequency. Never match transfers, deposits, refunds, or cash withdrawals unless evidence clearly supports it. Each transaction may match at most one bill.' }] },
        { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(payload) }] },
      ],
      text: { format: { type: 'json_schema', name: 'bill_transaction_matches', strict: true, schema } },
      max_output_tokens: 5000,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI request failed (${response.status})`);
  const outputText = extractOutputText(data);
  const parsed = outputText ? JSON.parse(outputText) : { matches: [] };
  return { available: true, matches: Array.isArray(parsed.matches) ? parsed.matches : [], model };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await getUser(request);
    const body = await request.json().catch(() => ({}));
    const month = parseMonth(body.month);
    const requestedCategory = String(body.category || 'all');
    if (!['all','Household','Business'].includes(requestedCategory)) throw new Error('Category must be Household, Business, or all');
    const supabase = serviceClient();

    const [billsResult, mappingsResult, rulesResult, marksResult, accountsResult] = await Promise.all([
      supabase.from('bills').select('*').eq('user_id', user.id).eq('archived', false),
      supabase.from('category_account_mappings').select('*').eq('user_id', user.id),
      supabase.from('bill_match_rules').select('*').eq('user_id', user.id).eq('active', true),
      supabase.from('bill_month_marks').select('bill_id').eq('user_id', user.id).eq('year', month.year).eq('month', month.month).eq('paid', true),
      supabase.from('plaid_accounts').select('account_id,bill_match_category').eq('user_id', user.id),
    ]);
    for (const result of [billsResult,mappingsResult,rulesResult,marksResult,accountsResult]) if (result.error) throw result.error;

    const mappings = new Map((mappingsResult.data || []).map((mapping: any) => [mapping.bill_category, mapping.account_id]));
    const alreadyPaid = new Set((marksResult.data || []).map((mark: any) => mark.bill_id));
    const rules = rulesResult.data || [];
    const bills = (billsResult.data || [])
      .filter((bill: any) => (requestedCategory === 'all' || bill.category === requestedCategory) && bill.match_mode !== 'off' && !alreadyPaid.has(bill.id))
      .map((bill: any) => ({ ...bill, effective_bank_account_id: bill.bank_account_id || mappings.get(bill.category) || null }))
      .filter((bill: any) => {
        const account = (accountsResult.data || []).find((item: any) => item.account_id === bill.effective_bank_account_id);
        return !account?.bill_match_category || account.bill_match_category === 'all' || account.bill_match_category === bill.category;
      });

    const groups = new Map<string, any[]>();
    for (const bill of bills) {
      const accountId = bill.effective_bank_account_id;
      if (!accountId) continue;
      if (!groups.has(accountId)) groups.set(accountId, []);
      groups.get(accountId)!.push(bill);
    }

    let localSuggestions = 0;
    let automaticMatches = 0;
    let aiSuggestions = 0;
    const remainingForAI: any[] = [];

    for (const [accountId, accountBills] of groups.entries()) {
      const { data: transactions, error } = await supabase
        .from('plaid_transactions').select('*')
        .eq('user_id', user.id).eq('account_id', accountId)
        .gte('date', month.start).lte('date', month.end)
        .eq('pending', false).gt('amount', 0).is('matched_bill_id', null)
        .order('date', { ascending: true });
      if (error) throw error;

      const usedBills = new Set<string>();
      const usedTransactions = new Set<string>();
      for (const transaction of transactions || []) {
        const candidates = accountBills
          .filter((bill: any) => !usedBills.has(bill.id))
          .map((bill: any) => ({ bill, result: localScore(transaction, bill, rules) }))
          .filter((candidate: any) => candidate.result && candidate.result.confidence >= 0.72)
          .sort((a: any, b: any) => b.result.confidence - a.result.confidence);
        const best = candidates[0];
        const second = candidates[1];
        if (!best) continue;
        if (second && best.result.confidence - second.result.confidence < 0.04 && best.result.confidence < 0.965) continue;
        if (best.bill.match_mode === 'automatic' && best.result.confidence >= 0.94) {
          await confirmAutomatic(supabase, user.id, best.bill, transaction, best.result, month);
          automaticMatches += 1;
        } else if (await saveSuggestion(supabase, user.id, best.bill, transaction, best.result)) {
          localSuggestions += 1;
        }
        usedBills.add(best.bill.id);
        usedTransactions.add(transaction.transaction_id);
      }

      const aiBills = accountBills.filter((bill: any) => !usedBills.has(bill.id));
      const aiTransactions = (transactions || []).filter((transaction: any) => !usedTransactions.has(transaction.transaction_id) && !transaction.matched_bill_id && !transaction.suggested_bill_id);
      if (aiBills.length && aiTransactions.length) {
        remainingForAI.push({
          bank_account_id: accountId,
          bills: aiBills.slice(0,75).map((bill: any) => ({ id: bill.id, bank_account_id: accountId, name: bill.name, category: bill.category, amount: Number(bill.amount) || 0, overdue_amount: Number(bill.overdue) || 0, frequency: bill.frequency, due_date: bill.next_due || bill.anchor, keywords: bill.match_keywords || [] })),
          transactions: aiTransactions.slice(0,150).map((transaction: any) => ({ id: transaction.transaction_id, bank_account_id: accountId, date: transaction.date, description: transaction.merchant_name || transaction.name || '', bank_description: transaction.name || '', amount: Math.abs(Number(transaction.amount) || 0), is_transfer: Boolean(transaction.is_transfer), is_check: Boolean(transaction.is_check) })),
        });
      }
    }

    let aiAvailable = false;
    let model: string | null = null;
    let aiError = '';
    if (remainingForAI.length) {
      try {
        const ai = await askOpenAI({ month: month.text, account_batches: remainingForAI });
        aiAvailable = ai.available;
        model = ai.model;
        const billById = new Map(bills.map((bill: any) => [bill.id, bill]));
        const transactionIds = [...new Set(ai.matches.map((match: any) => match.transaction_id))];
        let transactionById = new Map();
        if (transactionIds.length) {
          const { data, error } = await supabase.from('plaid_transactions').select('*').eq('user_id', user.id).in('transaction_id', transactionIds);
          if (error) throw error;
          transactionById = new Map((data || []).map((transaction: any) => [transaction.transaction_id, transaction]));
        }
        const usedTransactions = new Set<string>();
        const usedBills = new Set<string>();
        for (const match of [...ai.matches].sort((a: any, b: any) => Number(b.confidence || 0) - Number(a.confidence || 0))) {
          const confidence = Math.max(0, Math.min(1, Number(match.confidence) || 0));
          if (confidence < 0.65) continue;
          const bill: any = billById.get(match.bill_id);
          const transaction: any = transactionById.get(match.transaction_id);
          if (!bill || !transaction || bill.effective_bank_account_id !== transaction.account_id || transaction.matched_bill_id || transaction.suggested_bill_id || usedTransactions.has(transaction.transaction_id) || usedBills.has(bill.id)) continue;
          if (await saveSuggestion(supabase, user.id, bill, transaction, { confidence, reason: String(match.reason || 'AI found similar bill wording, amount, and timing.'), source: 'openai' })) {
            aiSuggestions += 1;
            usedTransactions.add(transaction.transaction_id);
            usedBills.add(bill.id);
          }
        }
      } catch (error) {
        aiError = String(error?.message || error);
      }
    } else {
      aiAvailable = Boolean(Deno.env.get('OPENAI_API_KEY'));
      model = aiAvailable ? Deno.env.get('OPENAI_MATCH_MODEL') || 'gpt-5.6-luna' : null;
    }

    let message = 'Matching complete.';
    if (aiError) message = `Local matching completed, but OpenAI could not run: ${aiError}`;
    else if (!Deno.env.get('OPENAI_API_KEY')) message = 'Local matching complete. Add the OPENAI_API_KEY Supabase secret to enable AI matching.';

    return json({
      ok: true,
      month: month.text,
      accounts_processed: groups.size,
      unassigned_bills: bills.filter((bill: any) => !bill.effective_bank_account_id).length,
      local_suggestions: localSuggestions,
      ai_suggestions: aiSuggestions,
      automatic_matches: automaticMatches,
      ai_available: aiAvailable && !aiError,
      model: aiAvailable && !aiError ? model : null,
      message,
    });
  } catch (error) {
    return json({ error: String(error?.message || error) }, 400);
  }
});

