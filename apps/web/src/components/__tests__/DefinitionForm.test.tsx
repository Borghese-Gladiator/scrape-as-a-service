import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DefinitionForm } from '../DefinitionForm';
import type { CreateDefinitionInput } from '@/lib/types';

describe('DefinitionForm', () => {
  it('renders the core inputs and artifact toggles', () => {
    render(<DefinitionForm onSubmit={vi.fn()} />);

    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Field name')).toBeInTheDocument();
    expect(screen.getByLabelText('Selector')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'JSON' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'CSV' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create definition' })).toBeInTheDocument();
  });

  it('submits a parsed CreateDefinitionInput', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(input: CreateDefinitionInput) => void>();
    render(<DefinitionForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Name'), 'Products');
    await user.type(screen.getByLabelText('URL'), 'https://shop.example.com');
    await user.type(screen.getByLabelText('Field name'), 'title');
    await user.type(screen.getByLabelText('Selector'), 'h2.product');
    await user.type(screen.getByLabelText('Attribute (optional)'), 'data-id');
    await user.click(screen.getByRole('checkbox', { name: 'CSV' }));

    await user.click(screen.getByRole('button', { name: 'Create definition' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Products',
      url: 'https://shop.example.com',
      config: {
        fields: [{ name: 'title', selector: 'h2.product', attribute: 'data-id' }],
        artifacts: ['JSON', 'CSV'],
      },
    });
  });

  it('shows an error and does not submit when a field is incomplete', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<DefinitionForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Name'), 'Products');
    await user.type(screen.getByLabelText('URL'), 'https://shop.example.com');
    await user.type(screen.getByLabelText('Field name'), 'title');

    await user.click(screen.getByRole('button', { name: 'Create definition' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Each field needs both a name and a selector');
  });
});
