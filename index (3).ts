import {
  corsHeaders,
  getUser,
  json,
  serviceClient,
} from '../_shared.ts';
import {
  localMatchScore,
  recordConfirmedMatch,
  saveSuggestion,
  transactionDescriptor,
} from '../_matching.ts';

function parseMonth(value: unknown) {
  const text = String(value || '');
  const match = /^(\d{4})-(\d{2})$/.exec(text);

  if (!match) {
    throw new Error('Month must use YYYY-MM');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (month < 1 || month > 12) {
    throw new Error('Month must use YYYY-MM');
  }

  const lastDay = new Date(
    Date.UTC(year, month, 0),
  ).getUTCDate();

  return {
    text,
    year,
    month,
    start:
      `${year}-${String(month).padStart(2, '0')}-01`,
    end:
      `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

function extractOutputText(response: any) {
  if (typeof response?.output_text === 'string') {
    return response.output_text;
  }

  for (const output of response?.output || []) {
    for (const content of output?.content || []) {
      if (
        content?.type === 'output_text' &&
        typeof content.text === 'string'
      ) {
        return content.text;
      }
    }
  }

  return '';
}

async function callOpenAI(payload: any) {
  const apiKey = Deno.env.get('OPENAI_API_KEY');

  if (!apiKey) {
    return {
      available: false,
      matches: [],
      model: null,
    };
  }

  const model =
    Deno.env.get('OPENAI_MATCH_MODEL') ||
    'gpt-5.6-luna';

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
            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
            },
            reason: { type: 'string' },
          },
          required: [
            'bill_id',
            'transaction_id',
            'confidence',
            'reason',
          ],
        },
      },
    },
    required: ['matches'],
  };

  const response = await fetch(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        store: false,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: [
                  'You reconcile recurring bills against bank transactions.',
                  'Return only strong, defensible matches. Do not guess.',
                  'A positive transaction amount means money left the bank account.',
                  'Use merchant wording, amount similarity, bill frequency, explicit keywords, and transaction date.',
                  'Each transaction may match at most one bill.',
                  'A monthly, quarterly, or annual bill should normally match at most one transaction in the selected month.',
                  'Do not match transfers, cash withdrawals, refunds, or deposits unless the bill information clearly supports the match.',
                  'When evidence is ambiguous, omit the match.',
                ].join(' '),
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify(payload),
              },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'bill_transaction_matches',
            strict: true,
            schema,
          },
        },
        max_output_tokens: 5000,
      }),
    },
  );

  const data = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      `OpenAI request failed (${response.status})`,
    );
  }

  const outputText = extractOutputText(data);

  if (!outputText) {
    throw new Error(
      'OpenAI returned no structured match result',
    );
  }

  const parsed = JSON.parse(outputText);

  return {
    available: true,
    matches: Array.isArray(parsed.matches)
      ? parsed.matches
      : [],
    model,
  };
}

function chooseBestLocalMatch(
  transaction: any,
  bills: any[],
  rules: any[],
  usedBillIds: Set<string>,
) {
  const scored = bills
    .filter((bill) => !usedBillIds.has(bill.id))
    .map((bill) => ({
      bill,
      result: localMatchScore(
        transaction,
        bill,
        rules,
      ),
    }))
    .filter((entry) => entry.result.confidence > 0)
    .sort(
      (left, right) =>
        right.result.confidence -
        left.result.confidence,
    );

  const best = scored[0];
  const second = scored[1];

  if (!best) return null;

  if (
    second &&
    best.result.confidence -
      second.result.confidence < 0.04 &&
    best.result.confidence < 0.965
  ) {
    return null;
  }

  return best;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  try {
    const user = await getUser(request);
    const body = await request
      .json()
      .catch(() => ({}));

    const month = parseMonth(body.month);
    const requestedCategory = String(
      body.category || 'all',
    );

    if (
      ![
        'all',
        'Household',
        'Business',
      ].includes(requestedCategory)
    ) {
      throw new Error(
        'Category must be Household, Business, or all',
      );
    }

    const supabase = serviceClient();

    const [
      billsResult,
      mappingsResult,
      rulesResult,
      marksResult,
    ] = await Promise.all([
      supabase
        .from('bills')
        .select('*')
        .eq('user_id', user.id)
        .eq('archived', false),
      supabase
        .from('category_account_mappings')
        .select('*')
        .eq('user_id', user.id),
      supabase
        .from('bill_match_rules')
        .select('*')
        .eq('user_id', user.id)
        .eq('active', true),
      supabase
        .from('bill_month_marks')
        .select('bill_id,year,month,paid')
        .eq('user_id', user.id)
        .eq('year', month.year)
        .eq('month', month.month)
        .eq('paid', true),
    ]);

    for (const result of [
      billsResult,
      mappingsResult,
      rulesResult,
      marksResult,
    ]) {
      if (result.error) throw result.error;
    }

    const bills = billsResult.data || [];
    const rules = rulesResult.data || [];

    const mappings = (
      mappingsResult.data || []
    ).filter(
      (mapping: any) =>
        requestedCategory === 'all' ||
        mapping.bill_category ===
          requestedCategory,
    );

    const confirmedBillIds = new Set(
      (marksResult.data || []).map(
        (mark: any) => mark.bill_id,
      ),
    );

    let localSuggestions = 0;
    let automaticMatches = 0;
    let aiSuggestions = 0;

    const aiBatches: any[] = [];

    for (const mapping of mappings) {
      const categoryBills = bills.filter(
        (bill: any) =>
          bill.category ===
            mapping.bill_category &&
          bill.match_mode !== 'off' &&
          !confirmedBillIds.has(bill.id),
      );

      if (!categoryBills.length) continue;

      const {
        data: transactions,
        error: transactionError,
      } = await supabase
        .from('plaid_transactions')
        .select('*')
        .eq('user_id', user.id)
        .eq(
          'account_id',
          mapping.account_id,
        )
        .gte('date', month.start)
        .lte('date', month.end)
        .eq('pending', false)
        .gt('amount', 0)
        .is('matched_bill_id', null)
        .order('date', { ascending: true });

      if (transactionError) {
        throw transactionError;
      }

      const usedTransactionIds =
        new Set<string>();
      const usedBillIds = new Set<string>();

      for (
        const transaction
        of transactions || []
      ) {
        const best = chooseBestLocalMatch(
          transaction,
          categoryBills,
          rules,
          usedBillIds,
        );

        if (
          !best ||
          best.result.confidence < 0.72
        ) {
          continue;
        }

        if (
          best.bill.match_mode ===
            'automatic' &&
          best.result.confidence >= 0.94
        ) {
          await recordConfirmedMatch(
            supabase,
            user.id,
            best.bill,
            transaction,
            'automatic',
            best.result.confidence,
            best.result.reason,
            best.result.source,
          );

          automaticMatches += 1;
          confirmedBillIds.add(best.bill.id);
        } else if (
          await saveSuggestion(
            supabase,
            user.id,
            best.bill,
            transaction,
            best.result.confidence,
            best.result.reason,
            best.result.source,
          )
        ) {
          localSuggestions += 1;
        }

        usedTransactionIds.add(
          transaction.transaction_id,
        );
        usedBillIds.add(best.bill.id);
      }

      const remainingBills =
        categoryBills.filter(
          (bill: any) =>
            !confirmedBillIds.has(bill.id) &&
            !usedBillIds.has(bill.id),
        );

      const remainingTransactions = (
        transactions || []
      ).filter(
        (transaction: any) =>
          !usedTransactionIds.has(
            transaction.transaction_id,
          ) &&
          !transaction.suggested_bill_id &&
          !transaction.matched_bill_id,
      );

      if (
        !remainingBills.length ||
        !remainingTransactions.length
      ) {
        continue;
      }

      aiBatches.push({
        batch_id:
          `${mapping.bill_category}:${mapping.account_id}`,
        bill_category:
          mapping.bill_category,
        bills: remainingBills
          .slice(0, 75)
          .map((bill: any) => ({
            id: bill.id,
            name: bill.name,
            amount: Number(bill.amount) || 0,
            frequency: bill.frequency,
            anchor_or_due_date:
              bill.next_due || bill.anchor,
            subcategory:
              bill.subcategory || '',
            match_keywords:
              bill.match_keywords || [],
            automatic_confirmation_enabled:
              bill.match_mode === 'automatic',
            amount_tolerance_percent:
              Math.round(
                Number(
                  bill.match_amount_tolerance ??
                  0.15
                ) * 100,
              ),
          })),
        transactions:
          remainingTransactions
            .slice(0, 150)
            .map((transaction: any) => ({
              id:
                transaction.transaction_id,
              date: transaction.date,
              merchant_name:
                transaction.merchant_name || '',
              bank_description:
                transaction.name || '',
              normalized_description:
                transactionDescriptor(
                  transaction,
                ),
              amount: Math.abs(
                Number(transaction.amount) || 0,
              ),
              bank_category_primary:
                transaction.personal_finance_primary ||
                '',
              bank_category_detailed:
                transaction.personal_finance_detailed ||
                '',
              is_transfer:
                Boolean(transaction.is_transfer),
              is_check:
                Boolean(transaction.is_check),
            })),
      });
    }

    let openAIResult = {
      available: Boolean(
        Deno.env.get('OPENAI_API_KEY'),
      ),
      matches: [] as any[],
      model:
        Deno.env.get('OPENAI_MATCH_MODEL') ||
        'gpt-5.6-luna',
    };
    let aiError = '';

    if (aiBatches.length) {
      try {
        openAIResult = await callOpenAI({
          month: month.text,
          batches: aiBatches,
        });
      } catch (error) {
        aiError = String(
          error?.message || error,
        );
      }
    }

    if (
      openAIResult.available &&
      openAIResult.matches.length
    ) {
      const billIds = [
        ...new Set(
          openAIResult.matches.map(
            (match: any) => match.bill_id,
          ),
        ),
      ];
      const transactionIds = [
        ...new Set(
          openAIResult.matches.map(
            (match: any) =>
              match.transaction_id,
          ),
        ),
      ];

      const [
        matchedBillsResult,
        matchedTransactionsResult,
      ] = await Promise.all([
        supabase
          .from('bills')
          .select('*')
          .eq('user_id', user.id)
          .in('id', billIds),
        supabase
          .from('plaid_transactions')
          .select('*')
          .eq('user_id', user.id)
          .in(
            'transaction_id',
            transactionIds,
          ),
      ]);

      if (matchedBillsResult.error) {
        throw matchedBillsResult.error;
      }
      if (matchedTransactionsResult.error) {
        throw matchedTransactionsResult.error;
      }

      const billById = new Map(
        (matchedBillsResult.data || []).map(
          (bill: any) => [bill.id, bill],
        ),
      );
      const transactionById = new Map(
        (
          matchedTransactionsResult.data || []
        ).map((transaction: any) => [
          transaction.transaction_id,
          transaction,
        ]),
      );

      const batchByBillId = new Map<string, string>();
      const batchByTransactionId =
        new Map<string, string>();

      for (const batch of aiBatches) {
        for (const bill of batch.bills) {
          batchByBillId.set(
            bill.id,
            batch.batch_id,
          );
        }
        for (
          const transaction
          of batch.transactions
        ) {
          batchByTransactionId.set(
            transaction.id,
            batch.batch_id,
          );
        }
      }

      const usedTransactions =
        new Set<string>();
      const usedMonthlyBills =
        new Set<string>();

      const sortedMatches = [
        ...openAIResult.matches,
      ].sort(
        (left: any, right: any) =>
          Number(right.confidence || 0) -
          Number(left.confidence || 0),
      );

      for (const match of sortedMatches) {
        const confidence = Math.max(
          0,
          Math.min(
            1,
            Number(match.confidence) || 0,
          ),
        );

        if (confidence < 0.65) continue;

        const bill: any = billById.get(
          match.bill_id,
        );
        const transaction: any =
          transactionById.get(
            match.transaction_id,
          );

        if (
          !bill ||
          !transaction ||
          transaction.matched_bill_id ||
          transaction.suggested_bill_id ||
          bill.match_mode === 'off' ||
          usedTransactions.has(
            transaction.transaction_id,
          ) ||
          batchByBillId.get(bill.id) !==
            batchByTransactionId.get(
              transaction.transaction_id,
            )
        ) {
          continue;
        }

        if (
          bill.frequency !== 'weekly' &&
          usedMonthlyBills.has(bill.id)
        ) {
          continue;
        }

        const reason = String(
          match.reason ||
          'AI found similar bill wording, amount, and timing.',
        );

        if (
          await saveSuggestion(
            supabase,
            user.id,
            bill,
            transaction,
            confidence,
            reason,
            'openai',
          )
        ) {
          aiSuggestions += 1;
        }

        usedTransactions.add(
          transaction.transaction_id,
        );

        if (bill.frequency !== 'weekly') {
          usedMonthlyBills.add(bill.id);
        }
      }
    }

    const aiAvailable =
      openAIResult.available && !aiError;

    let message = 'Matching complete.';

    if (aiError) {
      message =
        `Local matching completed, but OpenAI could not run: ${aiError}`;
    } else if (!openAIResult.available) {
      message =
        'Local matching complete. Add the OPENAI_API_KEY Supabase secret to enable AI matching.';
    }

    return json({
      ok: true,
      month: month.text,
      mappings_processed: mappings.length,
      local_suggestions: localSuggestions,
      ai_suggestions: aiSuggestions,
      automatic_matches: automaticMatches,
      ai_available: aiAvailable,
      model:
        aiAvailable
          ? openAIResult.model
          : null,
      message,
    });
  } catch (error) {
    return json(
      {
        error: String(error?.message || error),
      },
      400,
    );
  }
});
