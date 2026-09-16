import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DefinitionForm, type DefinitionFormValue } from '../DefinitionForm';

function renderForm() {
  const onSubmit = vi.fn<(value: DefinitionFormValue) => void>();
  const user = userEvent.setup();
  render(<DefinitionForm onSubmit={onSubmit} />);
  return { onSubmit, user };
}

function step(label: string) {
  return within(screen.getByRole('group', { name: label }));
}

async function fillHeader(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name'), 'Receipts');
  await user.type(screen.getByLabelText('URL'), 'https://example.com/transactions');
}

describe('DefinitionForm step list', () => {
  it('adds, removes, and reorders a step', async () => {
    const { onSubmit, user } = renderForm();

    await user.click(screen.getByRole('button', { name: 'Add step' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Step 2 verb' }), 'click');
    await user.type(step('Step 2').getByRole('textbox', { name: 'Selector' }), '.tab');

    await user.click(screen.getByRole('button', { name: 'Add step' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Step 3 verb' }), 'press');
    await user.type(step('Step 3').getByRole('textbox', { name: 'Key' }), 'Enter');

    await user.click(screen.getByRole('button', { name: 'Move step 3 up' }));
    await user.click(screen.getByRole('button', { name: 'Remove step 1' }));

    expect(screen.getAllByRole('group')).toHaveLength(2);

    await fillHeader(user);
    await user.click(screen.getByRole('button', { name: 'Create definition' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0].config.steps).toEqual([
      { op: 'press', key: 'Enter' },
      { op: 'click', selector: '.tab' },
    ]);
  });

  it('nests a forEach inside a paginate and submits the nested shape', async () => {
    const { onSubmit, user } = renderForm();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Step 1 verb' }), 'paginate');
    await user.type(step('Step 1').getByRole('textbox', { name: 'Next selector' }), 'a.next');
    await user.clear(step('Step 1').getByRole('textbox', { name: 'Max pages' }));
    await user.type(step('Step 1').getByRole('textbox', { name: 'Max pages' }), '2');

    await user.click(screen.getByRole('button', { name: 'Add step to step 1' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Step 1.1 verb' }), 'forEach');
    await user.type(step('Step 1.1').getByRole('textbox', { name: 'Row selector' }), 'tbody tr');

    await user.click(screen.getByRole('button', { name: 'Add step to step 1.1' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Step 1.1.1 verb' }), 'capture');
    await user.type(step('Step 1.1.1').getByRole('textbox', { name: 'Artifact name' }), 'receipt');

    await fillHeader(user);
    await user.click(screen.getByRole('button', { name: 'Create definition' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0].config.steps).toEqual([
      {
        op: 'paginate',
        nextSelector: 'a.next',
        maxPages: 2,
        steps: [
          {
            op: 'forEach',
            rowSelector: 'tbody tr',
            steps: [{ op: 'capture', as: ['PNG'], name: 'receipt' }],
          },
        ],
      },
    ]);
  });

  it('stops the form nesting at three levels and points at the JSON editor', async () => {
    const { user } = renderForm();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Step 1 verb' }), 'paginate');
    await user.click(screen.getByRole('button', { name: 'Add step to step 1' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Step 1.1 verb' }), 'forEach');
    await user.click(screen.getByRole('button', { name: 'Add step to step 1.1' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Step 1.1.1 verb' }), 'openLink');

    expect(screen.queryByRole('button', { name: 'Add step to step 1.1.1' })).not.toBeInTheDocument();
    expect(step('Step 1.1.1').getByText(/Nesting stops at 3 levels/)).toBeInTheDocument();
  });
});

describe('DefinitionForm JSON editor', () => {
  it('reports an invalid program inline and blocks the save', async () => {
    const { onSubmit, user } = renderForm();

    await user.click(screen.getByRole('button', { name: 'JSON' }));
    const editor = screen.getByRole('textbox', { name: 'Program JSON' });
    await user.clear(editor);
    await user.click(editor);
    await user.paste('{"steps":[{"op":"teleport"}]}');
    await user.tab();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'steps[0].op is not a supported step: teleport',
    );

    const submit = screen.getByRole('button', { name: 'Create definition' });
    expect(submit).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps every field on a round trip from the form to JSON and back', async () => {
    const { onSubmit, user } = renderForm();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Auth mode' }), 'storageState');
    await user.type(screen.getByLabelText('Secret name'), 'session-a');

    await user.type(
      step('Step 1').getByRole('textbox', { name: 'Navigate to URL' }),
      'https://a.example/list',
    );
    await user.selectOptions(step('Step 1').getByRole('combobox', { name: 'Wait until' }), 'networkidle');

    await user.click(screen.getByRole('button', { name: 'Add step' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Step 2 verb' }), 'click');
    await user.type(step('Step 2').getByRole('textbox', { name: 'Selector' }), 'a.receipt');
    await user.selectOptions(step('Step 2').getByRole('combobox', { name: 'Opens' }), 'newTab');
    await user.type(step('Step 2').getByRole('textbox', { name: 'Timeout (ms)' }), '2500');
    await user.click(step('Step 2').getByRole('checkbox', { name: 'Optional' }));

    await user.click(screen.getByRole('button', { name: 'Add step' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Step 3 verb' }), 'extract');
    await user.type(step('Step 3').getByRole('textbox', { name: 'Dataset name' }), 'rows');
    await user.type(step('Step 3').getByRole('textbox', { name: 'Row selector' }), 'tbody tr');
    await user.type(step('Step 3').getByRole('textbox', { name: 'Field 1 name' }), 'title');
    await user.type(step('Step 3').getByRole('textbox', { name: 'Field 1 selector' }), 'td.title');
    await user.type(step('Step 3').getByRole('textbox', { name: 'Field 1 attribute' }), 'data-id');
    await user.click(step('Step 3').getByRole('checkbox', { name: 'CSV' }));

    await user.click(screen.getByRole('checkbox', { name: 'Record the browser context as WEBM' }));

    await user.click(screen.getByRole('button', { name: 'JSON' }));
    const shown = JSON.parse(
      (screen.getByRole('textbox', { name: 'Program JSON' }) as HTMLTextAreaElement).value,
    );

    expect(shown).toEqual({
      auth: { mode: 'storageState', secretRef: 'session-a' },
      record: true,
      steps: [
        { op: 'goto', url: 'https://a.example/list', waitUntil: 'networkidle' },
        { op: 'click', selector: 'a.receipt', opens: 'newTab', timeoutMs: 2500, optional: true },
        {
          op: 'extract',
          name: 'rows',
          rowSelector: 'tbody tr',
          fields: [{ name: 'title', selector: 'td.title', attribute: 'data-id' }],
          emit: ['CSV'],
        },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Form' }));
    await fillHeader(user);
    await user.click(screen.getByRole('button', { name: 'Create definition' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0].config).toEqual(shown);
  });
});
