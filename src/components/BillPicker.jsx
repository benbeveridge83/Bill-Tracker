import React, { useEffect, useId, useRef, useState } from 'react';
import { fmtMoney } from '../lib/dates';
import { searchBills } from '../lib/billMatching';

export default function BillPicker({ bills, value, onChange, preferences, onPreferences, accountCategory = 'all', disabled = false }) {
  const id = useId();
  const root = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const selected = bills.find((bill) => bill.id === value);
  const results = searchBills(bills, query, preferences.sort);

  useEffect(() => {
    if (open && typeof document !== 'undefined') document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, id]);

  function choose(bill) {
    onChange(bill.id);
    setQuery('');
    setOpen(false);
  }

  return (
    <div className="billPicker" ref={root} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <div className="billPickerControls">
        <div>
          <label htmlFor={`${id}-category`}>Bill category</label>
          <select id={`${id}-category`} disabled={disabled} value={preferences.category} onChange={(event) => { onPreferences({ category: event.target.value }); setQuery(''); setActive(0); }}>
            <option value="account">Account default ({accountCategory === 'all' ? 'all bills' : accountCategory})</option>
            <option value="Business">Business</option>
            <option value="Household">Household</option>
            <option value="all">All bills</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-sort`}>Bill order</label>
          <select id={`${id}-sort`} disabled={disabled} value={preferences.sort} onChange={(event) => { onPreferences({ sort: event.target.value }); setActive(0); }}>
            <option value="amount-desc">Amount: greatest to least</option>
            <option value="amount-asc">Amount: least to greatest</option>
            <option value="alpha">Alphabetical</option>
          </select>
        </div>
      </div>
      <div className="billSearchField">
      <label htmlFor={`${id}-search`}>Search or choose a bill</label>
      <input id={`${id}-search`} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-results`} aria-activedescendant={open && results[active] ? `${id}-option-${active}` : undefined}
        autoComplete="off" disabled={disabled} placeholder="Type a bill name, or click to browse..." value={open ? query : selected?.name || query}
        onFocus={() => { setOpen(true); setQuery(''); setActive(0); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); onChange(''); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true);
            setActive((previous) => results.length ? (previous + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : 0);
          } else if (event.key === 'Enter' && open && results[active]) { event.preventDefault(); choose(results[active]); }
          else if (event.key === 'Escape') { setOpen(false); setQuery(''); }
        }} />
      </div>
      {open && (
        <div className="billSearchResults" id={`${id}-results`} role="listbox" aria-label="Matching bills">
          {results.length ? results.map((bill, index) => (
            <button type="button" role="option" aria-selected={bill.id === value} id={`${id}-option-${index}`} className={`billSearchOption ${index === active ? 'activeBillOption' : ''}`}
              key={bill.id} onClick={() => choose(bill)} onMouseMove={() => setActive(index)}>
              <span><strong>{bill.name}</strong><span className="help">{bill.category}{bill.subcategory ? ` · ${bill.subcategory}` : ''}</span></span>
              <span className="mono">{fmtMoney(Math.abs(Number(bill.amount) || 0))}</span>
            </button>
          )) : <p className="help">No bills match your search and category. Change the category or add a new bill.</p>}
        </div>
      )}
    </div>
  );
}
