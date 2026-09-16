'use client';

import { useParams, useRouter } from 'next/navigation';
import { DefinitionEditor } from '@/components/DefinitionEditor';

export default function EditDefinitionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  return (
    <div>
      <h1>Edit definition</h1>
      <DefinitionEditor
        id={params.id}
        onSaved={(definition) => router.push(`/definitions/${definition.id}`)}
      />
    </div>
  );
}
