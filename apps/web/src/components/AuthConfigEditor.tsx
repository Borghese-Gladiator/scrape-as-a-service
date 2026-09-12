'use client';

import type { AuthConfig, Step } from '@/lib/types';
import { AUTH_MODES, createAuth, withOptional, type AuthMode } from '@/lib/steps';
import { StepTree } from './StepList';

const SECRET_HINT = 'This is the name of a stored secret, not the secret itself.';

function StorageStateFields({
  auth,
  onChange,
}: {
  auth: Extract<AuthConfig, { mode: 'storageState' }>;
  onChange: (auth: AuthConfig) => void;
}) {
  return (
    <div className="field-row">
      <label htmlFor="auth-secretref">Secret name</label>
      <input
        id="auth-secretref"
        value={auth.secretRef}
        onChange={(e) => onChange({ ...auth, secretRef: e.target.value })}
        placeholder="courtreserve-session"
      />
      <p className="muted">{SECRET_HINT}</p>
    </div>
  );
}

function CdpFields({
  auth,
  onChange,
}: {
  auth: Extract<AuthConfig, { mode: 'cdp' }>;
  onChange: (auth: AuthConfig) => void;
}) {
  return (
    <div className="field-row">
      <label htmlFor="auth-endpoint">CDP endpoint URL</label>
      <input
        id="auth-endpoint"
        value={auth.endpointUrl}
        onChange={(e) => onChange({ ...auth, endpointUrl: e.target.value })}
        placeholder="http://localhost:9222"
      />
    </div>
  );
}

function LoginFields({
  auth,
  onChange,
}: {
  auth: Extract<AuthConfig, { mode: 'login' }>;
  onChange: (auth: AuthConfig) => void;
}) {
  return (
    <>
      <div className="field-row">
        <label htmlFor="auth-secretref">Secret name</label>
        <input
          id="auth-secretref"
          value={auth.secretRef ?? ''}
          onChange={(e) => onChange(withOptional(auth, 'secretRef', e.target.value))}
          placeholder="courtreserve-login"
        />
        <p className="muted">{SECRET_HINT}</p>
      </div>
      <div className="field-row">
        <label>Login steps</label>
        <StepTree
          steps={auth.steps}
          onChange={(steps: Step[]) => onChange({ ...auth, steps })}
          idScope="auth-step"
          namePrefix="Login step"
          addLabel="Add login step"
        />
      </div>
    </>
  );
}

export function AuthConfigEditor({
  auth,
  onChange,
}: {
  auth: AuthConfig;
  onChange: (auth: AuthConfig) => void;
}) {
  return (
    <div>
      <div className="field-row">
        <label htmlFor="auth-mode">Auth mode</label>
        <select
          id="auth-mode"
          value={auth.mode}
          onChange={(e) => onChange(createAuth(e.target.value as AuthMode))}
        >
          {AUTH_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </div>

      {auth.mode === 'none' ? <p className="muted">The scrape runs with no session.</p> : null}
      {auth.mode === 'storageState' ? (
        <StorageStateFields auth={auth} onChange={onChange} />
      ) : null}
      {auth.mode === 'cdp' ? <CdpFields auth={auth} onChange={onChange} /> : null}
      {auth.mode === 'login' ? <LoginFields auth={auth} onChange={onChange} /> : null}
    </div>
  );
}
