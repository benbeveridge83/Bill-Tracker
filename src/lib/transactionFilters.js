export function filterIncludes(selection, value) {
  if (selection == null || selection === 'all') return true;
  return Array.isArray(selection) ? selection.includes(value) : selection === value;
}

function matchesAny(selection, choices) {
  if (selection == null || selection === 'all') return true;
  return Object.entries(choices).some(([key, matches]) => filterIncludes(selection, key) && matches);
}

export function matchesTransactionFilters(tx, filters) {
  return filterIncludes(filters.account, tx.account_id)
    && matchesAny(filters.billState, {
      confirmed: Boolean(tx.matched_bill_id) && ['approved', 'automatic'].includes(tx.match_status),
      suggested: Boolean(tx.suggested_bill_id) && tx.match_status === 'suggested',
      'not-bill': !tx.matched_bill_id && !tx.suggested_bill_id,
    })
    && matchesAny(filters.classification, {
      characterized: tx.classification_status !== 'uncharacterized',
      uncharacterized: tx.classification_status === 'uncharacterized',
    })
    && matchesAny(filters.flow, {
      in: Number(tx.amount) < 0,
      out: Number(tx.amount) > 0,
      checks: Boolean(tx.is_check),
      transfers: Boolean(tx.is_transfer),
    });
}
