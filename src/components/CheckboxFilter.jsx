import React, { useId } from 'react';
import { filterIncludes } from '../lib/transactionFilters';

export default function CheckboxFilter({ label, options, value, onChange }) {
  const id = useId();
  const selected = options.filter((option) => filterIncludes(value, option.value));
  const summary = selected.length === 0 ? 'None selected'
    : selected.length === options.length ? 'All selected'
      : selected.length === 1 ? selected[0].label : `${selected.length} selected`;

  function toggle(optionValue) {
    const next = options.filter((option) => option.value === optionValue
      ? !filterIncludes(value, option.value) : filterIncludes(value, option.value))
      .map((option) => option.value);
    onChange(next.length === options.length && options.length > 0 ? 'all' : next);
  }

  return (
    <div className="checkboxFilter">
      <div className="filterLabel" id={id}>{label}</div>
      <details>
        <summary aria-labelledby={`${id} ${id}-summary`}><span id={`${id}-summary`}>{summary}</span></summary>
        <div className="checkboxFilterOptions" role="group" aria-labelledby={id}>
          <div className="toolbar">
            <button type="button" className="ghost mini" onClick={() => onChange('all')}>Select all</button>
            <button type="button" className="ghost mini" onClick={() => onChange([])}>Clear</button>
          </div>
          {options.map((option) => (
            <label className="checkboxFilterOption" key={option.value}>
              <input type="checkbox" checked={filterIncludes(value, option.value)} onChange={() => toggle(option.value)} />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
