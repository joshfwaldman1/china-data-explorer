import { useEffect, useRef, type ReactNode } from "react";

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

/** Every open action menu on the page other than `except` is closed. */
function closeOtherMenus(except: HTMLDetailsElement | null): void {
  for (const other of document.querySelectorAll<HTMLDetailsElement>("details.action-menu[open]")) {
    if (other !== except) other.open = false;
  }
}

export function ActionMenu(props: { label: string; items: ActionMenuItem[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  // A click anywhere outside an open menu closes it. The Download and Share
  // menus sat open side by side, one over the other, until 15 September 2026:
  // a details element stays open until something closes it.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const details = ref.current;
      if (!details?.open || (event.target instanceof Node && details.contains(event.target))) return;
      details.open = false;
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);
  return (
    <details
      ref={ref}
      className="action-menu"
      onToggle={(event) => { if (event.currentTarget.open) closeOtherMenus(event.currentTarget); }}
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
