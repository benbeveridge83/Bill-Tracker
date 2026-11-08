import { useEffect, useRef, useState } from 'react';

export default function useAiBillSuggestions({ transactions, contextKey, category, enabled, request }) {
  const cache = useRef(new Map());
  const [version, setVersion] = useState(0);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const eligible = transactions.filter((tx) => !tx.matched_bill_id && !tx.pending && Number(tx.amount) > 0);
  const work = eligible.map((tx) => ({ id: tx.transaction_id, key: `${contextKey}:${JSON.stringify([tx.transaction_id, tx.account_id, tx.name, tx.merchant_name, tx.amount, tx.date, tx.suggested_bill_id])}` }));
  const workKey = JSON.stringify(work);

  useEffect(() => {
    if (!enabled) return;
    const items = JSON.parse(workKey);
    const missing = items.filter((item) => !cache.current.has(item.key));
    if (!missing.length) { setLoading(false); setStatus(items.length ? 'AI suggestions checked. Review and confirm any proposed matches.' : ''); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setStatus('ChatGPT is checking likely bills and categories...');
      try {
        for (let offset = 0; offset < missing.length; offset += 20) {
          if (cancelled) return;
          const batch = missing.slice(offset, offset + 20);
          const result = await request(batch.map((item) => item.id), category);
          if (cancelled) return;
          if (!result.ai_available) {
            setStatus(result.message || 'AI suggestions are unavailable. You can still search and confirm a bill.');
            return;
          }
          for (const item of batch) cache.current.set(item.key, result.matches?.find((match) => match.transaction_id === item.id) || null);
          setVersion((previous) => previous + 1);
        }
        setStatus('AI suggestions checked. Review and confirm any proposed matches.');
      } catch {
        if (!cancelled) setStatus('AI suggestions could not load. You can still search and confirm a bill, or retry.');
      } finally { if (!cancelled) setLoading(false); }
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [workKey, category, enabled, request, retry]);

  // Reading the cache on every render also reflects completed batches.
  void version;
  const matches = Object.fromEntries(work.map((item) => [item.id, cache.current.get(item.key)]).filter(([, match]) => match));
  return { matches, loading, status, retry: () => { cache.current.clear(); setRetry((previous) => previous + 1); } };
}
