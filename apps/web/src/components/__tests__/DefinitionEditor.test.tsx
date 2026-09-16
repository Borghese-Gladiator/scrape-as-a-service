import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DefinitionEditor } from '../DefinitionEditor';
import type { ApiClient, ScrapeDefinition } from '@/lib/types';

const definition: ScrapeDefinition = {
  id: 'def-1',
  name: 'Receipts',
  url: 'https://example.com/transactions',
  config: {
    version: 2,
    steps: [{ op: 'goto' }, { op: 'click', selector: 'a.tab' }],
  },
  created_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
};

function buildApi(): ApiClient {
  return {
    getDefinition: vi.fn().mockResolvedValue(definition),
    updateDefinition: vi.fn().mockResolvedValue(definition),
  } as unknown as ApiClient;
}

describe('DefinitionEditor', () => {
  it('loads a definition, edits it, and saves the whole definition', async () => {
    const user = userEvent.setup();
    const api = buildApi();
    const onSaved = vi.fn();
    render(<DefinitionEditor id="def-1" api={api} onSaved={onSaved} />);

    const nameInput = await screen.findByLabelText('Name');
    expect(nameInput).toHaveValue('Receipts');
    expect(screen.getByRole('combobox', { name: 'Step 2 verb' })).toHaveValue('click');

    await user.clear(nameInput);
    await user.type(nameInput, 'Receipts (August)');
    await user.click(screen.getByRole('button', { name: 'Save definition' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(api.updateDefinition).toHaveBeenCalledWith('def-1', {
      name: 'Receipts (August)',
      url: 'https://example.com/transactions',
      config: definition.config,
    });
  });
});
