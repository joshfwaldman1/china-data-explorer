# UI foundation

The portal uses [Mantine](https://mantine.dev/) 9.6.3 for its application shell,
navigation drawer, action menus, buttons and chart/table tabs. `@mantine/core`
and its matching `@mantine/hooks` peer are MIT licensed. These dependencies
replace custom overlay positioning, keyboard interactions and responsive shell
offsets. They are bundled locally; no external UI service or runtime CDN is used.

`client/primitives.tsx` owns the shared theme and reusable components. Prefer
these components when adding common controls, rather than another bespoke menu,
dialog or tab implementation. Other existing form controls remain native HTML;
this is an incremental adoption, not a claim that every control has migrated.

`client/ui-foundation.css` imports only the used components and their style
dependencies. It loads before portal CSS through the JavaScript entry point;
do not also link portal CSS from the HTML entry, which reverses the cascade
when Bun deduplicates it.

`client/styles.css` keeps the portal's warm neutral palette, red accent, typography
and chart colors. Mantine follows the existing system/light/dark preference.
The catalogue is available in the navigation drawer at all widths. Desktop
primary navigation and topic links remain visible at 1100px and above. Search
shares the header row at 520px and above and has a second row on phones.

Series pages give the title, latest observation and chart priority. Tabs and
chart actions share a toolbar; legends precede multi-line charts; secondary
options remain collapsed. Methodology, source notes, adjustment labels, date
filters and data/export arithmetic are independent of the component library.

Home keeps the title and search side by side from 700px, with four aligned
headline cards; smaller screens stack search and use two card columns. Each
card keeps the observation period, publisher, available adjustment label and
history range visible. Changes name their comparison period. The key-indicator
list retains source context and explicit year-to-date spans at every width.

The browser suite checks the reported 740 by 687 viewport, plot visibility,
360/390/740/900/1280px layouts, tab arrow keys, menu focus return, drawer focus
containment and navigation, plus the existing data, retry and export journeys.
Warnings and long catalogue titles can legitimately require more space than a
simple headline chart; they must not be hidden to satisfy a layout target.
