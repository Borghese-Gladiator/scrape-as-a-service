// The fixture transactions site that the manual scripts serve.
// Phase 2 introduced it with two pages. Phase 5 extends it to three, so the
// pager and the artifact names are exercised over more than one boundary.

import { createServer } from 'node:http';

export const ROWS = [
  { page: 1, date: '12/19/2025', amount: '$40.00', type: 'Card', receipt: '8DX6T13140' },
  { page: 1, date: '12/20/2025', amount: '$50.00', type: 'Card', receipt: '9KL2P13141' },
  { page: 1, date: '01/04/2026', amount: '$60.00', type: 'Cash', receipt: '3QW8R13142' },
  { page: 2, date: '05/02/2026', amount: '$70.00', type: 'Card', receipt: '7ZY4M13143' },
  { page: 2, date: '06/11/2026', amount: '$80.00', type: 'Card', receipt: '1AB5N13144' },
  { page: 2, date: '07/31/2026', amount: '$90.00', type: 'Cash', receipt: '5CD9V13145' },
  { page: 3, date: '08/14/2026', amount: '$100.00', type: 'Card', receipt: '2EF7X13146' },
  { page: 3, date: '09/01/2026', amount: '$110.00', type: 'Cash', receipt: '6GH3Z13147' },
];

export const TOTAL_PAGES = 3;

function listPage(pageNumber) {
  const rows = ROWS.filter((row) => row.page === pageNumber)
    .map(
      (row) => `
        <tr>
          <td class="date">${row.date}</td>
          <td class="amount">${row.amount}</td>
          <td class="type">${row.type}</td>
          <td class="receipt-no">${row.receipt}</td>
          <td><a class="receipt" href="/receipt/${row.receipt}">Receipt</a></td>
        </tr>`,
    )
    .join('');

  const next =
    pageNumber < TOTAL_PAGES
      ? `<a class="next" href="/list?page=${pageNumber + 1}">Next</a>`
      : '<a class="next disabled" aria-disabled="true">Next</a>';

  return `<!doctype html>
<html><head><title>Transactions page ${pageNumber}</title></head>
<body>
  <h1>Transaction(s)</h1>
  <table><tbody>${rows}</tbody></table>
  <div class="pager">${next}</div>
</body></html>`;
}

function receiptPage(receipt) {
  const row = ROWS.find((candidate) => candidate.receipt === receipt);
  if (!row) return null;
  return `<!doctype html>
<html><head><title>Receipt ${receipt}</title></head>
<body>
  <div class="card">
    <h1>Receipt: #${receipt}</h1>
    <p class="date">${row.date}</p>
    <p class="total">${row.amount}</p>
    <p class="type">${row.type}</p>
  </div>
</body></html>`;
}

export function startFixtureServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/list') {
      const pageNumber = Number(url.searchParams.get('page') ?? '1');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(listPage(Number.isFinite(pageNumber) ? pageNumber : 1));
      return;
    }
    if (url.pathname.startsWith('/receipt/')) {
      const body = receiptPage(url.pathname.slice('/receipt/'.length));
      if (body) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(body);
        return;
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}
