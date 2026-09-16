import { CronExpressionParser } from 'cron-parser';

/**
 * Compute the next fire time (as an absolute UTC Date) for a cron expression
 * interpreted in the given IANA timezone, strictly after `from`.
 */
export function computeNextRun(cron: string, timezone: string, from: Date): Date {
  const interval = CronExpressionParser.parse(cron, {
    currentDate: from,
    tz: timezone,
  });
  return interval.next().toDate();
}
