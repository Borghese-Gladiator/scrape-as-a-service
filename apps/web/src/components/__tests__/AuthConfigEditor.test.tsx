import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthConfigEditor } from '../AuthConfigEditor';
import type { AuthConfig } from '@/lib/types';

function Harness({ initial }: { initial: AuthConfig }) {
  const [auth, setAuth] = useState<AuthConfig>(initial);
  return <AuthConfigEditor auth={auth} onChange={setAuth} />;
}

const ALL_LABELS = ['Secret name', 'CDP endpoint URL'];

describe('AuthConfigEditor', () => {
  it.each([
    ['none', [] as string[]],
    ['storageState', ['Secret name']],
    ['cdp', ['CDP endpoint URL']],
    ['login', ['Secret name']],
  ])('renders only the fields of the %s mode', async (mode, expected) => {
    const user = userEvent.setup();
    render(<Harness initial={{ mode: 'none' }} />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Auth mode' }), mode);

    for (const label of ALL_LABELS) {
      const field = screen.queryByRole('textbox', { name: label });
      if (expected.includes(label)) expect(field).toBeInTheDocument();
      else expect(field).not.toBeInTheDocument();
    }

    const loginSteps = screen.queryByRole('button', { name: 'Add login step' });
    if (mode === 'login') expect(loginSteps).toBeInTheDocument();
    else expect(loginSteps).not.toBeInTheDocument();
  });

  it('holds the name of a secret, never a secret value', () => {
    render(<Harness initial={{ mode: 'storageState', secretRef: 'courtreserve-session' }} />);

    expect(screen.getByRole('textbox', { name: 'Secret name' })).toHaveValue(
      'courtreserve-session',
    );
    expect(
      screen.getByText('This is the name of a stored secret, not the secret itself.'),
    ).toBeInTheDocument();
  });
});
