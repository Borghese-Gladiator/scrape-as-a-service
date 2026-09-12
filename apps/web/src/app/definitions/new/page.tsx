'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DefinitionForm, type DefinitionFormValue } from '@/components/DefinitionForm';
import { getApiClient } from '@/lib/api';

export default function NewDefinitionPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(value: DefinitionFormValue) {
    setSubmitting(true);
    setError(null);
    try {
      const definition = await getApiClient().createDefinition(value);
      router.push(`/definitions/${definition.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1>New definition</h1>
      <div className="card">
        <DefinitionForm onSubmit={handleSubmit} submitting={submitting} />
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
