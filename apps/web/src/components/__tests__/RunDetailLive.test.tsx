import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { RunDetailLive } from '../RunDetailLive';
import type { RunDetail as RunDetailType } from '@/lib/types';

const getRun = vi.fn();

vi.mock('@/lib/api', () => ({
  getApiClient: () => ({
    getRun,
    artifactDownloadUrl: (id: string) => `http://api.test/artifacts/${id}/download`,
  }),
}));

function buildRun(overrides: Partial<RunDetailType> = {}): RunDetailType {
  return {
    id: 'run-123456789',
    definition_id: 'def-1',
    schedule_id: null,
    status: 'RUNNING',
    trigger: 'MANUAL',
    created_at: '2026-01-01T00:00:00.000Z',
    started_at: '2026-01-01T00:00:01.000Z',
    finished_at: null,
    attempts: [],
    artifacts: [],
    ...overrides,
  };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  getRun.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RunDetailLive', () => {
  it('polls a RUNNING run and stops once it reaches SUCCEEDED', async () => {
    getRun.mockResolvedValue(buildRun({ status: 'SUCCEEDED', finished_at: '2026-01-01T00:00:05.000Z' }));

    render(<RunDetailLive initialRun={buildRun()} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('RUNNING')).toBeInTheDocument();

    await advance(2000);

    expect(getRun).toHaveBeenCalledTimes(1);
    expect(screen.getByText('SUCCEEDED')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await advance(6000);

    expect(getRun).toHaveBeenCalledTimes(1);
  });

  it('never polls a run that is already terminal', async () => {
    render(<RunDetailLive initialRun={buildRun({ status: 'SUCCEEDED' })} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await advance(10_000);

    expect(getRun).not.toHaveBeenCalled();
  });
});
