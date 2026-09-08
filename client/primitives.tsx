import type { ReactNode } from "react";

export function PageHeader(props: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        <h1>{props.title}</h1>
        {props.subtitle}
      </div>
      {props.actions && <div className="page-actions">{props.actions}</div>}
    </header>
  );
}

export interface ActionMenuItem {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

export function ActionMenu(props: { label: string; items: ActionMenuItem[] }) {
  return (
    <details
      className="action-menu"
      onKeyDown={(event) => {
        // Escape closes the menu and returns focus to its button, as a menu should.
        if (event.key !== "Escape") return;
        const details = event.currentTarget;
        if (!details.open) return;
        details.open = false;
        details.querySelector("summary")?.focus();
      }}
    >
      <summary className="button" aria-haspopup="menu">{props.label}<span aria-hidden="true" className="chevron">⌄</span></summary>
      <div className="menu" role="menu">
        {props.items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={(event) => {
              item.onSelect();
              const details = event.currentTarget.closest("details");
              if (details) details.open = false;
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </details>
  );
}

export function ChartPanelHeader(props: { views: ReactNode; controls: ReactNode }) {
  return (
    <div className="chart-panel-header">
      <div className="chart-panel-views">{props.views}</div>
      <div className="chart-panel-controls">{props.controls}</div>
    </div>
  );
}
