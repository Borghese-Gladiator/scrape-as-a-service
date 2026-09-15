# Retrieve your CourtReserve receipts

This guide gets every payment receipt from your own CourtReserve account onto
your disk, as a PNG and a PDF for each one.

Target page:
`https://app.courtreserve.com/Online/MyBalance/Index/13140?page=details`

**Read this first.** The page is behind a login, and behind Cloudflare. Nobody
who wrote this code has seen its markup: an anonymous request returns the login
page at best, and a Cloudflare challenge at worst. Every CSS selector in
`definitions/courtreserve-receipts.json` is therefore an **unverified default**,
taken from Kendo UI for jQuery 2022.1.301, which the page is known to load.
Step 3 below confirms each one against your own session. Do not skip it.

## The site is behind Cloudflare

Verified on 2026-09-13, against the live URL:

| Browser | What the page returns |
| --- | --- |
| Headless Chromium | `Attention Required! \| Cloudflare` |
| Headed Chromium | `Login \| powered by CourtReserve` |

Cloudflare serves a headless browser a challenge page instead of the site. Two
consequences follow, and both are already handled:

- The `--profile` mode opens a **visible** Chrome window. Playwright launches a
  persistent profile headless by default, which would always hit the challenge.
- The `--cdp` mode reuses the window you opened yourself, which Cloudflare has
  already cleared. This is the mode to prefer.

Do not run the job headless against this site. It will not work.

## Step 0 — build once

```bash
npm install
npm run build
```

## Step 1 — give the platform your logged-in browser

The job never asks for your password. It drives the browser session you already
have. There are two ways to hand it over. Try the first; use the second if the
first is inconvenient.

### Option A — Chrome DevTools Protocol (`--cdp`), preferred

**Quit Chrome completely before you start.** Press `Cmd+Q`, or open the Chrome
menu and choose **Quit Google Chrome**. Closing every window is not enough.

A `--remote-debugging-port` flag passed while Chrome already runs opens a new
window inside the running process and does **not** open the port. That is the
single most common reason this step fails.

```bash
# 1. Quit Chrome, then confirm that no process is left.
pgrep -x "Google Chrome"        # it must print nothing

# 2. Start Chrome with the debug port open.
open -a "Google Chrome" --args --remote-debugging-port=9222

# 3. Confirm the port answers.
curl -s http://localhost:9222/json/version
```

Step 3 must print a JSON object with a `webSocketDebuggerUrl`. If it prints
nothing, Chrome was still running at step 2. Go back to step 1.

Now log in to CourtReserve in that Chrome window and open the balance page.

### Option B — a copy of your Chrome profile (`--profile`)

This needs no restart. It copies

```
~/Library/Application Support/Google/Chrome
```

to a temporary folder and drives the copy, so your live profile is never
touched. Chrome holds a lock on a live profile, which is why the copy exists.

Pass `--profile` in place of `--cdp` in every command below. Add
`--profile "Profile 1"` to name a profile other than `Default`.

The window is visible on purpose. See the Cloudflare section above.

A caveat: Chrome writes some session state only when it closes, so a copy taken
while Chrome runs can come out logged out. If that happens, use Option A.

## Step 2 — run discovery

This is the step that turns the guessed selectors into facts. It opens the page
in your session, reads the DOM, and reports what is really there. It changes
nothing on the page.

```bash
npm run discover -- \
  --url "https://app.courtreserve.com/Online/MyBalance/Index/13140?page=details" \
  --cdp http://localhost:9222
```

Add `--wait ".k-grid-content tbody tr"` if the table loads after the page does.
It writes `discovery-report.json` beside the readable report.

## Step 3 — read the report

The report ends with a **suggested selectors** block. Each line names a
selector and the evidence behind it.

| Report section | What to take from it |
| --- | --- |
| `grids` | The grid whose headers read `Date · Amount · Paid Date · Payment Type` is the transactions table. Note its `id` and its `rows:` line. |
| `controls in the first data row` | The **Receipt** control. `href=` decides which definition to run. See below. |
| `pagers` | The control whose title says "next". Note its `title` and its classes. |
| `tab strips` | The item labelled `Payments`, and which item is active. |
| `date inputs` | The `id` of the start input and the end input. |

### Which definition file to run

Look at the Receipt control in `controls in the first data row`.

| What the report shows | Run |
| --- | --- |
| `href="/Online/Receipt/…"` — a real path | `definitions/courtreserve-receipts.json` (the default) |
| `href="(none)"`, or `href="javascript:void(0)"`, with `handler=true` | `definitions/courtreserve-receipts-newtab.json` |

The suggested-selectors block names the file for you, in the `receipt control`
line.

The first file reads the `href` and opens it in a fresh tab. That is the more
reliable of the two, because it never depends on popup timing. The second
clicks the control, waits for the tab that the click opens, captures it, and
closes it.

## Step 4 — edit the definition

Open `definitions/courtreserve-receipts.json`.

**Set the date range.** The two dates sit near the top, in `_dates`, and again
in the two `fill` steps. Change both places. The default range is `01/01/2020`
to `12/31/2026`, which covers the whole history.

```json
{ "op": "fill", "selector": "#StartDate", "value": "01/01/2020" },
{ "op": "fill", "selector": "#EndDate",   "value": "12/31/2026" },
```

**Replace each selector with the one the report named.** These are the six that
matter:

| In the file | Replace with |
| --- | --- |
| `.k-tabstrip .k-item > .k-link:has-text('Payments')` | the Payments tab item |
| `#StartDate` / `#EndDate` | the two date input ids |
| `.k-grid .k-grid-content tbody tr.k-master-row` | the suggested `rowSelector`, in both places |
| `.k-pager-wrap a.k-pager-nav[title="Go to the next page"]` | the suggested `nextSelector` |
| `a.k-button` | the suggested receipt control |
| `td:nth-child(1)` … `td:nth-child(4)` | the column order the report shows |

The column numbers matter. The report prints the headers in order; if `Paid
Date` is the fourth header rather than the third, move the field.

## Step 5 — run the job

```bash
npm run job:receipts -- --out ./exports/receipts
```

With the profile option:

```bash
npm run job:receipts -- --out ./exports/receipts --profile
```

With the other definition file:

```bash
npm run job:receipts -- --out ./exports/receipts \
  --definition definitions/courtreserve-receipts-newtab.json
```

It writes one PNG and one PDF per receipt, named
`receipt-<page>-<index>-<date>.png`, plus `receipts.json` and `receipts.csv`
with the four row fields. It needs no Postgres, no Redis and no MinIO.

With `--cdp` the work happens in your own Chrome window, so you can watch it.
With `--profile` a second Chrome window opens and the work happens there.

## When a selector does not match

The job stops on the first step whose selector finds nothing, and names the
step. Work through these in order.

**1. Did Cloudflare answer instead of the site?** The discovery report prints
the page title first. If it reads `Attention Required! | Cloudflare`, the
browser was treated as a robot. Use `--cdp` with the Chrome window you opened
yourself.

**2. Are you logged in?** Run discovery again. If the report says
`no grid on the page holds a data row` and the title reads `Login | powered by
CourtReserve`, the session did not carry over. With `--cdp`, check that you
logged in *inside the Chrome that you started with the debug port*. With
`--profile`, use Option A instead.

**3. Did the grid load late?** Add `--wait` to the discovery command, and raise
`timeoutMs` on the `waitFor` step in the definition.

**4. Did the Payments tab click do nothing?** That step carries
`"optional": true`, so a miss is silent by design and the run continues on
whichever tab was open. Check the `tab strips` section of the report and fix
the selector.

**5. Did the date range fail to apply?** The definition presses `Enter` after
the second date. Some pages need a Search or Filter button instead. Look for it
in the report and add a step after the two fills:

```json
{ "op": "click", "selector": "<the search button>" }
```

**6. Is the pager looping or stopping early?** The runner stops when the next
control is missing, is disabled, or when the page content does not change. It
treats any class containing `disabled` as disabled, which covers both the
Kendo 2022.1 `k-state-disabled` and the later `k-disabled`. If it stops after
one page, confirm the `nextSelector` matches the next arrow and not the
previous one — they share the class `k-pager-nav`.

**7. Are the receipts blank?** The site loads `pdf.js`, so a receipt may render
inside a PDF viewer rather than as HTML. Run with `--headed` to see what the
page shows. A viewer needs a longer wait before the capture; add a `waitFor`
step inside the `openLink` steps.

## Prove the plumbing without the live site

This runs the shipped definition against a local fixture that carries the same
Kendo markup, and checks every file it produces:

```bash
node scripts/manual/phase-9-courtreserve-fixture.mjs
```

It needs only Chromium. It proves the definition's structure, the pager, the
per-row loop and the file names. It cannot prove the selectors, because only
the live page can do that.
