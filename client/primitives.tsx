import { useEffect, useState, type ReactNode } from "react";
import { AppShell, Burger, Button, Drawer, MantineProvider, Menu, createTheme } from "@mantine/core";
import { useColorScheme } from "@mantine/hooks";

const portalTheme = createTheme({
  fontFamily: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  primaryColor: "red",
  autoContrast: true,
  primaryShade: { light: 8, dark: 3 },
  colors: { red: ["#fff2ef", "#f8ddd7", "#edb9af", "#e08a80", "#cd6256", "#b83e32", "#a52e23", "#96251c", "#8a1c16", "#701710"] },
  defaultRadius: "sm",
  breakpoints: { xs: "32.5em", sm: "48em", md: "62em", lg: "68.75em", xl: "88em" },
  components: { Button: Button.extend({ defaultProps: { size: "compact-sm", variant: "default" } }) },
});

/** Mantine owns overlay focus, Escape, scroll locking and responsive shell offsets. */
export function PortalShell(props: {
  home: boolean; route: string; theme: string;
  brand: ReactNode; search: ReactNode; navigation: ReactNode; tools: ReactNode;
  topics: ReactNode; catalog: ReactNode; children: ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  const systemTheme = useColorScheme("light");
  useEffect(() => { setOpened(false); }, [props.route]);
  return (
    <MantineProvider theme={portalTheme} cssVariablesResolver={() => ({ variables: { "--mantine-color-body": "var(--ground)", "--mantine-color-text": "var(--ink)", "--mantine-color-dimmed": "var(--muted)" }, light: {}, dark: {} })} forceColorScheme={props.theme === "dark" || props.theme === "light" ? props.theme : systemTheme}>
      <AppShell header={{ height: { base: props.home ? 64 : 108, xs: 64, lg: 104 } }} className="portal-shell">
        <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); const main = document.getElementById("main"); main?.focus(); main?.scrollIntoView(); }}>Skip to content</a>
        <AppShell.Header className="portal-header">
          <div className={`portal-topbar${props.home ? " portal-topbar-home" : ""}`}>
            <Burger size="sm" opened={opened} onClick={() => setOpened(value => !value)} aria-label="Open navigation" aria-expanded={opened} className="portal-burger" />
            {props.brand}
            <div className="portal-search">{props.search}</div>
            <div className="desktop-navigation">{props.navigation}</div>
            {props.tools}
          </div>
          <div className="desktop-topics">{props.topics}</div>
        </AppShell.Header>
        <Drawer opened={opened} onClose={() => setOpened(false)} title="Explore China data" size={360} closeButtonProps={{ "aria-label": "Close navigation" }} classNames={{ content: "portal-drawer", header: "portal-drawer-header", body: "portal-drawer-body" }}>
          <div className="drawer-navigation">{props.navigation}</div>
          <div className="drawer-topics"><h2>Topics</h2>{props.topics}</div>
          {props.catalog}
        </Drawer>
        <AppShell.Main component="div" className="portal-content">{props.children}</AppShell.Main>
      </AppShell>
    </MantineProvider>
  );
}

export function PageHeader(props: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return <header className="page-header"><div className="page-header-copy"><h1>{props.title}</h1>{props.subtitle}</div>{props.actions && <div className="page-actions">{props.actions}</div>}</header>;
}

export interface ActionMenuItem { label: string; disabled?: boolean; onSelect: () => void; }
export function ActionMenu(props: { label: string; items: ActionMenuItem[]; primary?: boolean }) {
  return <Menu position="bottom-end" width={224} withinPortal shadow="md">
    <Menu.Target><Button className={props.primary ? "portal-primary-action" : undefined} variant={props.primary ? "filled" : "subtle"} rightSection={<span aria-hidden="true">⌄</span>}>{props.label}</Button></Menu.Target>
    <Menu.Dropdown>{props.items.map(item => <Menu.Item key={item.label} disabled={item.disabled} onClick={item.onSelect}>{item.label}</Menu.Item>)}</Menu.Dropdown>
  </Menu>;
}

export function ChartPanelHeader(props: { views: ReactNode; controls: ReactNode }) {
  return <div className="chart-panel-header"><div className="chart-panel-views">{props.views}</div><div className="chart-panel-controls">{props.controls}</div></div>;
}
