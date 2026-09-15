// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { collectDiscovery } from '../cli/discover-script.js';

/** The Kendo UI 2022.1 markup that CourtReserve is expected to serve. */
function kendoPage(
  options: { nextDisabledClass?: string; receiptHref?: string } = {},
): string {
  const disabled =
    options.nextDisabledClass === undefined ? '' : ` ${options.nextDisabledClass}`;
  const href =
    options.receiptHref === undefined
      ? ' href="/receipt/8DX6T13140"'
      : options.receiptHref;
  return `
  <div class="k-widget k-tabstrip" id="detail-tabs">
    <ul class="k-tabstrip-items" role="tablist">
      <li class="k-item" role="tab" aria-selected="false"><span class="k-link">Unpaid</span></li>
      <li class="k-item k-state-active" role="tab" aria-selected="true"><span class="k-link">Payments</span></li>
    </ul>
  </div>

  <input id="StartDate" name="StartDate" class="k-input" value="05/02/2026" placeholder="Start Date" />
  <input id="EndDate" name="EndDate" class="k-input" value="07/31/2026" placeholder="End Date" />
  <input id="Search" name="Search" class="k-input" value="" placeholder="Search" />

  <div class="k-widget k-grid" id="transactions-grid">
    <div class="k-grid-header"><table><thead><tr>
      <th class="k-header">Date</th>
      <th class="k-header">Amount</th>
      <th class="k-header">Paid Date</th>
      <th class="k-header">Payment Type</th>
      <th class="k-header">&nbsp;</th>
    </tr></thead></table></div>
    <div class="k-grid-content"><table><tbody>
      <tr class="k-master-row">
        <td>01/12/2024</td><td>$40.00</td><td>01/12/2024</td><td>Card</td>
        <td><a class="k-button"${href} target="_blank">Receipt</a></td>
      </tr>
      <tr class="k-master-row k-alt">
        <td>02/19/2024</td><td>$50.00</td><td>02/19/2024</td><td>Card</td>
        <td><a class="k-button" href="/receipt/9KL2P13141">Receipt</a></td>
      </tr>
    </tbody></table></div>
    <div class="k-pager-wrap" id="transactions-pager">
      <a class="k-pager-nav k-state-disabled" title="Go to the previous page">&lt;</a>
      <span class="k-link k-state-selected">1</span>
      <a class="k-pager-nav${disabled}" title="Go to the next page" href="?page=2">&gt;</a>
    </div>
  </div>`;
}

describe('collectDiscovery', () => {
  beforeEach(() => {
    document.title = 'Transaction(s)';
    document.body.innerHTML = kendoPage();
  });

  it('reports the Kendo grid with its headers, its row selector, and its row count', () => {
    const report = collectDiscovery();

    expect(report.title).toBe('Transaction(s)');
    expect(report.grids).toHaveLength(1);
    expect(report.grids[0]).toMatchObject({
      tag: 'div',
      id: 'transactions-grid',
      headers: ['Date', 'Amount', 'Paid Date', 'Payment Type', ''],
      rowSelector: 'tr.k-master-row',
      rowCount: 2,
    });
    expect(report.grids[0]?.classes).toContain('k-grid');
  });

  it('reports every control of the first data row only', () => {
    const report = collectDiscovery();

    expect(report.rowControls).toHaveLength(1);
    expect(report.rowControls[0]).toMatchObject({
      gridIndex: 0,
      tag: 'a',
      text: 'Receipt',
      classes: ['k-button'],
      href: '/receipt/8DX6T13140',
      target: '_blank',
      newTab: true,
      hasHandler: false,
    });
  });

  it('reports a handler control that carries no usable href', () => {
    document.body.innerHTML = kendoPage({
      receiptHref: ' href="javascript:void(0)" onclick="openReceipt(1)"',
    });
    const report = collectDiscovery();

    expect(report.rowControls[0]).toMatchObject({
      href: 'javascript:void(0)',
      hasHandler: true,
    });
  });

  it.each([
    { desc: 'the Kendo 2022.1 spelling', className: 'k-state-disabled' },
    { desc: 'the later spelling', className: 'k-disabled' },
  ])('marks the next arrow disabled with $desc', ({ className }) => {
    document.body.innerHTML = kendoPage({ nextDisabledClass: className });
    const report = collectDiscovery();

    const next = report.pagers[0]?.controls.find(
      (c) => c.title === 'Go to the next page',
    );
    expect(next?.disabled).toBe(true);
  });

  it('leaves a live next arrow enabled and reports its title', () => {
    const report = collectDiscovery();
    const controls = report.pagers[0]?.controls ?? [];

    expect(controls.find((c) => c.title === 'Go to the previous page')?.disabled).toBe(
      true,
    );
    expect(controls.find((c) => c.title === 'Go to the next page')).toMatchObject({
      disabled: false,
      text: '>',
    });
  });

  it('reports the tab strip items and which one is active', () => {
    const report = collectDiscovery();

    expect(report.tabStrips).toHaveLength(1);
    expect(report.tabStrips[0]?.items.map((item) => item.text)).toEqual([
      'Unpaid',
      'Payments',
    ]);
    expect(
      report.tabStrips[0]?.items.find((item) => item.text === 'Payments')?.active,
    ).toBe(true);
  });

  it('reports the date inputs and skips an unrelated text input', () => {
    const report = collectDiscovery();

    expect(report.dateInputs.map((input) => input.id)).toEqual(['StartDate', 'EndDate']);
    expect(report.dateInputs[0]).toMatchObject({
      name: 'StartDate',
      value: '05/02/2026',
      placeholder: 'Start Date',
    });
  });

  it('keeps the outer .k-grid and drops the tables nested inside it', () => {
    const report = collectDiscovery();

    expect(report.grids.map((grid) => grid.id)).toEqual(['transactions-grid']);
  });

  it('reports an empty page without throwing', () => {
    document.body.innerHTML = '<p>Please log in.</p>';
    const report = collectDiscovery();

    expect(report.grids).toEqual([]);
    expect(report.rowControls).toEqual([]);
    expect(report.pagers).toEqual([]);
    expect(report.dateInputs).toEqual([]);
  });
});
