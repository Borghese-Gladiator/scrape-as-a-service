import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunDetail } from '../RunDetail';
import type { RunDetail as RunDetailType } from '@/lib/types';

const artifactDownloadUrl = (artifactId: string) =>
  `http://api.test/artifacts/${artifactId}/download`;

function buildRun(overrides: Partial<RunDetailType> = {}): RunDetailType {
  return {
    id: 'run-123456789',
    definition_id: 'def-1',
    schedule_id: null,
    status: 'SUCCEEDED',
    trigger: 'MANUAL',
    created_at: '2026-01-01T00:00:00.000Z',
    started_at: '2026-01-01T00:00:01.000Z',
    finished_at: '2026-01-01T00:00:05.000Z',
    attempts: [
      {
        id: 'att-1',
        run_id: 'run-123456789',
        attempt_number: 1,
        status: 'FAILED',
        worker_id: 'worker-a',
        error_code: 'TIMEOUT',
        error_message: 'page load timed out',
        started_at: '2026-01-01T00:00:01.000Z',
        finished_at: '2026-01-01T00:00:03.000Z',
      },
      {
        id: 'att-2',
        run_id: 'run-123456789',
        attempt_number: 2,
        status: 'SUCCEEDED',
        worker_id: 'worker-b',
        error_code: null,
        error_message: null,
        started_at: '2026-01-01T00:00:04.000Z',
        finished_at: '2026-01-01T00:00:05.000Z',
      },
    ],
    artifacts: [
      {
        id: 'art-1',
        run_id: 'run-123456789',
        type: 'JSON',
        name: 'data.json',
        step_index: 2,
        object_key: 'runs/run-123456789/data.json',
        content_type: 'application/json',
        size_bytes: 2048,
        created_at: '2026-01-01T00:00:05.000Z',
      },
      {
        id: 'art-2',
        run_id: 'run-123456789',
        type: 'PNG',
        name: 'screenshot.png',
        step_index: 3,
        object_key: 'runs/run-123456789/screenshot.png',
        content_type: 'image/png',
        size_bytes: 51200,
        created_at: '2026-01-01T00:00:05.000Z',
      },
    ],
    ...overrides,
  };
}

describe('RunDetail', () => {
  it('renders status, attempts and per-attempt failure info', () => {
    render(<RunDetail run={buildRun()} artifactDownloadUrl={artifactDownloadUrl} />);

    expect(screen.getByRole('heading', { name: 'Status' })).toBeInTheDocument();

    expect(screen.getByText('TIMEOUT:')).toBeInTheDocument();
    expect(screen.getByText('page load timed out')).toBeInTheDocument();
    expect(screen.getByText('worker-a')).toBeInTheDocument();
    expect(screen.getByText('worker-b')).toBeInTheDocument();
  });

  it('renders working artifact download links for a completed run', () => {
    render(<RunDetail run={buildRun()} artifactDownloadUrl={artifactDownloadUrl} />);

    const jsonLink = screen.getByRole('link', { name: 'Download JSON' });
    const pngLink = screen.getByRole('link', { name: 'Download PNG' });

    expect(jsonLink).toHaveAttribute('href', 'http://api.test/artifacts/art-1/download');
    expect(pngLink).toHaveAttribute('href', 'http://api.test/artifacts/art-2/download');
  });

  it('does not show artifacts for an in-progress run', () => {
    render(
      <RunDetail
        run={buildRun({ status: 'RUNNING', artifacts: [] })}
        artifactDownloadUrl={artifactDownloadUrl}
      />,
    );

    expect(screen.queryByRole('link', { name: /Download/ })).not.toBeInTheDocument();
    expect(
      screen.getByText('Artifacts will be available once the run completes.'),
    ).toBeInTheDocument();
  });
});
