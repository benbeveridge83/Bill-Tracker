import React from 'react';

export function SectionTitle({ children }) {
  return <h2 className="sectionTitle">{children}</h2>;
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}) {
  return (
    <div
      className="dialogBackdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={`dialog ${wide ? 'dialogWide' : ''}`}
      >
        <SectionTitle>{title}</SectionTitle>
        <div className="pad">{children}</div>
      </div>
    </div>
  );
}

export function Kpi({ label, value, detail }) {
  return (
    <div className="k">
      <div className="muted">{label}</div>
      <strong>{value}</strong>
      {detail && <div className="help">{detail}</div>}
    </div>
  );
}

export function StatusChip({ status, label }) {
  const css =
    status === 'overdue'
      ? 'over'
      : status === 'due'
        ? 'due'
        : status === 'cancel'
          ? 'pend'
          : 'ok';

  return <span className={`chip ${css}`}>{label}</span>;
}

export function MatchModeLabel({
  mode,
  compact = false,
}) {
  const settings =
    mode === 'automatic'
      ? ['Automatic', 'autoMatch']
      : mode === 'off'
        ? ['Matching off', 'neutral']
        : ['Review', 'review'];

  return (
    <span
      className={
        `chip ${settings[1]} ` +
        `${compact ? 'compactChip' : ''}`
      }
    >
      {settings[0]}
    </span>
  );
}
