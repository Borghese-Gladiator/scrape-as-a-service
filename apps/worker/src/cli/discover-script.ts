export interface DiscoveredGrid {
  tag: string;
  id: string;
  classes: string[];
  headers: string[];
  rowSelector: string;
  rowCount: number;
}

export interface DiscoveredControl {
  gridIndex: number;
  tag: string;
  text: string;
  id: string;
  classes: string[];
  href: string | null;
  target: string | null;
  hasHandler: boolean;
  newTab: boolean;
}

export interface DiscoveredPagerControl {
  tag: string;
  text: string;
  id: string;
  classes: string[];
  title: string | null;
  ariaLabel: string | null;
  disabled: boolean;
}

export interface DiscoveredPager {
  tag: string;
  id: string;
  classes: string[];
  controls: DiscoveredPagerControl[];
}

export interface DiscoveredTabStrip {
  tag: string;
  id: string;
  classes: string[];
  items: { text: string; classes: string[]; active: boolean }[];
}

export interface DiscoveredDateInput {
  tag: string;
  type: string;
  id: string;
  name: string;
  classes: string[];
  value: string;
  placeholder: string;
}

export interface DiscoveryReport {
  url: string;
  title: string;
  grids: DiscoveredGrid[];
  rowControls: DiscoveredControl[];
  pagers: DiscoveredPager[];
  tabStrips: DiscoveredTabStrip[];
  dateInputs: DiscoveredDateInput[];
}

/**
 * A constant this repository owns, in the same sense as the Phase 2
 * `SCROLL_TO_BOTTOM`. It takes no input and reads no configuration, so no
 * user-supplied JavaScript can reach the page through it.
 *
 * Playwright serializes this function's source and runs it in the page, so it
 * must stay self-contained: no imports and no reference to anything outside
 * its own body.
 */
export function collectDiscovery(): DiscoveryReport {
  const GRID_SELECTOR = 'table, .k-grid, [role="grid"]';
  const PAGER_SELECTOR =
    '.k-pager-wrap, .k-pager, .pager, .pagination, [role="navigation"]';
  const TAB_SELECTOR = '.k-tabstrip, [role="tablist"], ul.nav-tabs, .nav-tabs';
  const CONTROL_SELECTOR = 'a, button, input[type="button"], input[type="submit"]';
  const DATE_HINT = /date|from|to|start|end|begin|until/i;
  const MAX_TEXT = 120;

  function classesOf(element: Element): string[] {
    const raw = element.getAttribute('class') ?? '';
    return raw.split(/\s+/).filter((token) => token.length > 0);
  }

  function textOf(node: Element | null): string {
    if (node === null) return '';
    const raw = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    return raw.length > MAX_TEXT ? `${raw.slice(0, MAX_TEXT)}…` : raw;
  }

  function looksDisabled(element: Element): boolean {
    if (element.hasAttribute('disabled')) return true;
    if (element.getAttribute('aria-disabled') === 'true') return true;
    return (element.getAttribute('class') ?? '').indexOf('disabled') !== -1;
  }

  /**
   * A Kendo grid splits its header and its body into two tables, so the rows
   * of interest are the ones that carry data cells. Prefer the Kendo master
   * row when the grid has one, and fall back to any row with a `td`.
   */
  function rowsOf(grid: Element): { selector: string; rows: Element[] } {
    const master = Array.from(grid.querySelectorAll('tr.k-master-row'));
    if (master.length > 0) {
      return { selector: 'tr.k-master-row', rows: master };
    }
    const dataRows = Array.from(grid.querySelectorAll('tr')).filter(
      (row) => row.querySelectorAll('td').length > 0,
    );
    return { selector: 'tr', rows: dataRows };
  }

  function headersOf(grid: Element): string[] {
    const cells = Array.from(grid.querySelectorAll('th'));
    if (cells.length > 0) return cells.map((cell) => textOf(cell));
    const firstRow = grid.querySelector('tr');
    if (firstRow === null) return [];
    return Array.from(firstRow.querySelectorAll('td')).map((cell) => textOf(cell));
  }

  /**
   * A Kendo widget matches more than once: the outer `.k-grid` and the table
   * inside it, the outer `.k-tabstrip` and its `[role=tablist]`. Keep only the
   * outermost hit of each nest, so one widget produces one entry.
   */
  function outermost(selector: string): Element[] {
    const all = Array.from(document.querySelectorAll(selector));
    return all.filter(
      (element) => !all.some((other) => other !== element && other.contains(element)),
    );
  }

  const grids: DiscoveredGrid[] = [];
  const rowControls: DiscoveredControl[] = [];

  const gridElements = outermost(GRID_SELECTOR);

  for (let i = 0; i < gridElements.length; i += 1) {
    const grid = gridElements[i] as Element;
    const found = rowsOf(grid);
    grids.push({
      tag: grid.tagName.toLowerCase(),
      id: grid.id,
      classes: classesOf(grid),
      headers: headersOf(grid),
      rowSelector: found.selector,
      rowCount: found.rows.length,
    });

    const firstRow = found.rows[0];
    if (firstRow === undefined) continue;
    for (const control of Array.from(firstRow.querySelectorAll(CONTROL_SELECTOR))) {
      const href = control.getAttribute('href');
      const target = control.getAttribute('target');
      rowControls.push({
        gridIndex: i,
        tag: control.tagName.toLowerCase(),
        text: textOf(control) || (control.getAttribute('value') ?? ''),
        id: control.id,
        classes: classesOf(control),
        href,
        target,
        hasHandler: control.hasAttribute('onclick') || control.hasAttribute('data-url'),
        newTab: target === '_blank',
      });
    }
  }

  const pagers: DiscoveredPager[] = outermost(PAGER_SELECTOR).map((pager) => ({
    tag: pager.tagName.toLowerCase(),
    id: pager.id,
    classes: classesOf(pager),
    controls: Array.from(pager.querySelectorAll(CONTROL_SELECTOR)).map((control) => ({
      tag: control.tagName.toLowerCase(),
      text: textOf(control),
      id: control.id,
      classes: classesOf(control),
      title: control.getAttribute('title'),
      ariaLabel: control.getAttribute('aria-label'),
      disabled: looksDisabled(control),
    })),
  }));

  const tabStrips: DiscoveredTabStrip[] = outermost(TAB_SELECTOR).map((strip) => ({
    tag: strip.tagName.toLowerCase(),
    id: strip.id,
    classes: classesOf(strip),
    items: Array.from(strip.querySelectorAll('li, [role="tab"]')).map((item) => ({
      text: textOf(item),
      classes: classesOf(item),
      active:
        (item.getAttribute('class') ?? '').indexOf('active') !== -1 ||
        item.getAttribute('aria-selected') === 'true',
    })),
  }));

  const dateInputs: DiscoveredDateInput[] = Array.from(document.querySelectorAll('input'))
    .filter((input) => {
      const type = (input.getAttribute('type') ?? 'text').toLowerCase();
      if (type === 'date') return true;
      if (type !== 'text' && type !== 'tel' && type !== '') return false;
      const haystack = [
        input.id,
        input.getAttribute('name') ?? '',
        input.getAttribute('class') ?? '',
        input.getAttribute('placeholder') ?? '',
      ].join(' ');
      return DATE_HINT.test(haystack);
    })
    .map((input) => ({
      tag: input.tagName.toLowerCase(),
      type: (input.getAttribute('type') ?? 'text').toLowerCase(),
      id: input.id,
      name: input.getAttribute('name') ?? '',
      classes: classesOf(input),
      value: (input as HTMLInputElement).value ?? '',
      placeholder: input.getAttribute('placeholder') ?? '',
    }));

  return {
    url: document.location === null ? '' : document.location.href,
    title: document.title,
    grids,
    rowControls,
    pagers,
    tabStrips,
    dateInputs,
  };
}
