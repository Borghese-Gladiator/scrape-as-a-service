# Phase 7 — The step editor

## Brief

Phase 2 replaced the single scrape pass with a v2 step program. The frontend did
not follow. `DefinitionForm` still builds a flat v1 config from flat inputs, so
the browser cannot express a click, a pagination loop, a row walk, or an auth
mode. The only way to author a v2 program today is a hand-written API call.

This phase gives the browser a step program editor:

- A step list. Add a step, remove a step, and move a step up or down.
- Verb-specific fields. Each verb renders only its own inputs.
- Nested lists for `forEach`, `openLink`, and `paginate`, to a visual depth of 3.
- A raw JSON editor as the escape hatch, with an inline validation error.
- An auth config editor that names a secret and never shows a secret value.
- A definition edit page at `/definitions/[id]/edit`.

The acceptance case is the CourtReserve program: a `goto`, a `click` on a tab,
two `fill` steps for a date range, then a `paginate` that wraps a `forEach` that
wraps an `openLink` and a `capture`.

## Changes

### `apps/web/src/lib/types.ts`

- Add `UpdateDefinitionInput` (`name`, `url`, `config`). `PUT /definitions/:id`
  replaces the whole definition.
- Add `getDefinition`, `updateDefinition`, and `deleteDefinition` to the
  `ApiClient` interface.

### `apps/web/src/lib/api.ts`

- `getDefinition` calls `GET /definitions/:id`. It no longer lists every
  definition and filters in memory (TODO 4.2).
- `updateDefinition` calls `PUT /definitions/:id`.
- `deleteDefinition` calls `DELETE /definitions/:id`.

**Dependency:** the branch `phase-5-delivery` adds those three routes. Phase 5
must merge before the edit page works against a live API. Every test here mocks
the client, so the suite passes without the routes.

### `apps/web/src/lib/steps.ts` (new)

The step verb metadata and the tree helpers that the editor needs.

- `STEP_OPS`, `NESTING_OPS`, `MAX_NESTING_DEPTH = 3`.
- `createStep(op)` returns an empty step of that verb.
- `childStepsOf(step)` returns the nested list, or `null` for a leaf verb.
- `insertStep`, `removeStep`, `moveStep`, `updateStep`. Each takes a path (an
  array of indexes) and returns a new `Step[]`. One private `transformList`
  walker serves all four.
- `stepLabel(path)` renders a path as `1.2.1`. The UI and the tests name every
  control with it.

### `apps/web/src/lib/program-validation.ts` (new)

`validateProgram(input)` returns `{ ok: true, config }` or
`{ ok: false, error }`. It mirrors the v2 half of `validateScrapeConfig` in
`packages/shared/src/scrape-config.ts`, and it reports the same paths and the
same messages. The web app does not import the shared package, so this file
mirrors it the way `apps/web/src/lib/types.ts` already mirrors the types.

The editor never authors a v1 config, so this validator rejects a config with
no `version: 2`. The API stays the authority; this validator only keeps a bad
program out of a save.

### `apps/web/src/components/StepFields.tsx` (new)

One component per verb group. Each renders only the inputs that its verb owns.
`StepFields` switches on `step.op` and returns an explicit JSX branch. There is
no dynamic field table and no generated prop object.

### `apps/web/src/components/StepList.tsx` (new)

`StepEditor` and `StepList` recurse into each other, so they share one file. Two
files would form an import cycle.

`StepEditor` renders one step: a `<fieldset>` whose `<legend>` is `Step 1.2`, a
verb `<select>`, the move and remove buttons, `StepFields`, and — for a nesting
verb — a child `StepList`.

At depth 3 a nesting verb does not render a child list. It renders a note that
states the 3 level cap and points at the JSON editor. The cap is visual only;
the JSON editor still edits a deeper program, and a save keeps it.

`StepList` renders an ordered list of `StepEditor` and an `Add step` control.

`StepTree` is the exported entry point. It owns the add, remove, move, and
update wiring over one root list. The program editor and the login step editor
each mount one. A tree takes an id scope and a name prefix, so two trees on one
page never share an element id or an accessible name.

### `apps/web/src/components/AuthConfigEditor.tsx` (new)

A mode `<select>` and one explicit branch per mode:

| Mode | Fields |
| --- | --- |
| `none` | none |
| `storageState` | Secret name |
| `cdp` | CDP endpoint URL |
| `login` | Secret name (optional), and a login step list |

A `secretRef` is the name of a secret. The editor never renders a secret value
and never fetches one.

### `apps/web/src/components/JsonProgramEditor.tsx` (new)

A textarea that holds `JSON.stringify(config, null, 2)`. On blur it parses and
validates. A valid program calls `onChange`. An invalid program calls `onError`
with the message, and the form reports it inline and blocks the save.

### `apps/web/src/components/StepProgramEditor.tsx` (new)

The program surface: an editor mode toggle (`Form` or `JSON`), the auth editor,
the record toggle, and either the step list or the JSON editor.

### `apps/web/src/components/DefinitionForm.tsx` (rewrite)

It now edits a v2 definition: a name, a URL, and a `StepProgramEditor`. It takes
an optional initial value and a submit label, so the create page and the edit
page share it. On submit it runs `validateProgram` and reports the error inline.

### `apps/web/src/app/definitions/new/page.tsx`

Adapt to the new form output.

### `apps/web/src/components/DefinitionEditor.tsx` (new)

Load the definition, render the form with it, and call `updateDefinition`. It
takes the API client and an `onSaved` callback as props, so a test drives it
with no router mock and no module mock.

### `apps/web/src/app/definitions/[id]/edit/page.tsx` (new)

A thin page. It reads the id from the route and pushes the detail route after a
save.

### `apps/web/src/app/definitions/[id]/page.tsx`

Add an `Edit definition` link.

### `apps/web/src/app/globals.css`

Add the step editor classes: `.step`, `.step-children`, `.step-toolbar`,
`.json-editor`.

### `apps/web/vitest.config.ts`

Widen `include` to `*.test.ts` as well as `*.test.tsx`, so a non-React test can
live beside the React tests.

### `README.md`

Add a walkthrough of the editor to the web frontend section.

## Decisions

### The editor state is the real `Step[]`

The editor holds the step program in its own shape, not in a parallel form
model. A text input writes the value onto the step. An optional input that the
user clears deletes its key. A round trip through the JSON editor is therefore
the identity function on the state, and no field can be lost in the mapping.

### A required field keeps an empty string

A new `click` step is `{ op: 'click', selector: '' }`. The step is invalid until
the user fills it, and `validateProgram` says so on save. This keeps the state
one shape, instead of a partial shape that a submit must complete.

### A new nesting verb starts with no children

`createStep('forEach')` returns `steps: []`. The shared validator demands a
non-empty nested list, so a save fails until the user adds a child. That message
comes from the mirrored validator, so it matches what the API would say.

### The nesting cap is visual

`MAX_NESTING_DEPTH` is 3. The form editor stops rendering child lists below it
and says so. It does not delete or rewrite a deeper program. The JSON editor is
the escape hatch for depth 4 and deeper.

### An invalid JSON program blocks the save and the mode switch

The form editor reads the last valid program. A switch back to the form while
the JSON is broken would hide the error and save stale steps. The `Form` button
is therefore disabled while the JSON editor reports an error, and so is the
submit button. The error stays next to the textarea that holds it.

### The `goto` step names its field `Navigate to URL`

The definition has a `URL` field, and a `goto` step has one too. Two controls
with the same label are ambiguous for a screen reader and for a test. The step
field carries the longer name.

## Tests

### Unit

`apps/web/src/components/__tests__/DefinitionForm.test.tsx`

- Add a step, remove a step, and move a step up and down.
- A `forEach` inside a `paginate` renders its child controls, and the submit
  carries the nested shape.
- The form editor stops at 3 levels. It offers no add control below the cap and
  it shows the note.
- The JSON editor reports an invalid program inline and blocks the save.
- A form to JSON to form round trip preserves every field.

`apps/web/src/components/__tests__/AuthConfigEditor.test.tsx`

- Each auth mode renders its own fields. Parametrized over the four modes.
- A `secretRef` input holds a name and carries no value from the server.

`apps/web/src/components/__tests__/DefinitionEditor.test.tsx`

- The editor loads a definition through a mocked client, edits the name, and
  calls `updateDefinition` with the whole definition.

`apps/web/src/lib/__tests__/step-verbs.test.ts`

- The verb list in `apps/web/src/lib/types.ts`, the verb list in
  `packages/shared/src/scrape-config.ts`, and `STEP_OPS` all match. The test
  reads both source files and extracts every `op: '...'` in the `Step` union.

### Verification

```
npm run check-types --workspace @scraper/web
npm run lint --workspace @scraper/web
npm test
npm run typecheck
```

### Manual

Start the API on port 4000. Then start the web app:

```
npm run dev --workspace @scraper/web
```

Build the CourtReserve program in the browser.

1. Open `http://localhost:3000/definitions/new`.
2. Type `CourtReserve receipts` into **Name**.
3. Type `https://app.courtreserve.com/Online/Transactions` into **URL**.
4. Confirm that **Auth mode** is `none`.
5. Confirm that step 1 is a `goto`. Leave its **Navigate to URL** empty, so the
   step uses the definition URL.
6. Click **Add step**. Choose `click` in the **Step 2 verb** select.
7. Type `a[href="#transactions"]` into the **Selector** of step 2.
8. Click **Add step**. Choose `fill` in the **Step 3 verb** select.
9. Type `#StartDate` into the **Selector** of step 3. Type `2026-08-01` into
   its **Value**.
10. Click **Add step**. Choose `fill` in the **Step 4 verb** select.
11. Type `#EndDate` into the **Selector** of step 4. Type `2026-08-31` into its
    **Value**.
12. Click **Add step**. Choose `paginate` in the **Step 5 verb** select.
13. Type `a.pagination-next` into the **Next selector** of step 5. Type `2`
    into its **Max pages**.
14. Click **Add step to step 5**. Choose `forEach` in the **Step 5.1 verb**
    select.
15. Type `table#transactions tbody tr` into the **Row selector** of step 5.1.
16. Click **Add step to step 5.1**. Choose `openLink` in the **Step 5.1.1 verb**
    select.
17. Type `a.receipt-link` into the **Selector** of step 5.1.1.
18. Confirm that step 5.1.1 shows the depth note, and that it offers no
    **Add step** control. The visual nesting cap is 3.
19. Click **JSON**. Confirm that the textarea holds the program.
20. Inside the `openLink` step, replace `"steps": []` with
    `"steps": [{ "op": "capture", "as": ["PNG"], "name": "receipt-{{index}}" }]`.
21. Click outside the textarea. Confirm that no error appears.
22. Delete the closing `}` of the last step. Click outside the textarea.
    Confirm that the page shows a JSON error, and that **Create definition** is
    disabled.
23. Undo the deletion. Click outside the textarea. Confirm that the error
    clears.
24. Click **Form**. Confirm that steps 1 through 5 are unchanged, and that the
    `openLink` step now reports one nested step.
25. Click **Create definition**. Confirm that the browser opens the definition
    detail page, and that the page prints the program below.
26. Click **Edit definition**. Change **Name** to `CourtReserve receipts (Aug)`.
27. Click **Save definition**. Confirm that the detail page shows the new name.

The expected JSON after step 25:

```json
{
  "version": 2,
  "auth": { "mode": "none" },
  "steps": [
    { "op": "goto" },
    { "op": "click", "selector": "a[href=\"#transactions\"]" },
    { "op": "fill", "selector": "#StartDate", "value": "2026-08-01" },
    { "op": "fill", "selector": "#EndDate", "value": "2026-08-31" },
    {
      "op": "paginate",
      "nextSelector": "a.pagination-next",
      "maxPages": 2,
      "steps": [
        {
          "op": "forEach",
          "rowSelector": "table#transactions tbody tr",
          "steps": [
            {
              "op": "openLink",
              "selector": "a.receipt-link",
              "steps": [
                { "op": "capture", "as": ["PNG"], "name": "receipt-{{index}}" }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

Step 25 needs `POST /definitions`, which exists today. Step 26 and step 27 need
the Phase 5 routes `GET /definitions/:id` and `PUT /definitions/:id`. Merge
`phase-5-delivery` first.

Steps 1 through 19 ran against a dev server in Chromium during this phase. The
nesting cap, the verb fields, and the JSON view behaved as this document states.
Steps 20 through 27 stay a manual check.
