import { describe, expect, it } from 'vitest';
import { buildCron, buildDisplay, detectFrequencyFromCron, formatHour24ToDisplay, parseTimeTo24 } from '@/lib/cron-utils';

describe('parseTimeTo24', () => {
  it.each([
    ['09:00 AM', { hour: 9, minute: 0 }],
    ['12:00 AM', { hour: 0, minute: 0 }],
    ['12:00 PM', { hour: 12, minute: 0 }],
    ['11:45 PM', { hour: 23, minute: 45 }],
    ['01:15 PM', { hour: 13, minute: 15 }],
    ['9:30 am', { hour: 9, minute: 30 }],
  ])('parses %s', (input, expected) => {
    expect(parseTimeTo24(input)).toEqual(expected);
  });

  it('falls back to 9:00 for invalid input', () => {
    expect(parseTimeTo24('not a time')).toEqual({ hour: 9, minute: 0 });
  });
});

describe('formatHour24ToDisplay', () => {
  it.each([
    [0, 0, '12:00 AM'],
    [9, 0, '09:00 AM'],
    [12, 0, '12:00 PM'],
    [23, 45, '11:45 PM'],
    [13, 15, '01:15 PM'],
  ])('formats %i:%i', (hour, minute, expected) => {
    expect(formatHour24ToDisplay(hour, minute)).toBe(expected);
  });
});

describe('buildCron', () => {
  it.each([
    ['Hourly', '09:00 AM', '1', '0 * * * *'],
    ['Daily', '09:00 AM', '1', '0 9 * * *'],
    ['Weekdays', '05:30 PM', '1', '30 17 * * 1-5'],
    ['Weekly', '09:00 AM', '1', '0 9 * * 1'],
    // Unix 0-indexed weekday convention: Sunday = '0'
    ['Weekly', '09:00 AM', '0', '0 9 * * 0'],
    ['Weekly', '11:45 PM', '6', '45 23 * * 6'],
  ])('%s at %s (weekday %s)', (frequency, time, weekday, expected) => {
    expect(buildCron(frequency, time, weekday)).toBe(expected);
  });
});

describe('detectFrequencyFromCron', () => {
  it.each([
    ['0 * * * *', 'Hourly'],
    ['0 9 * * *', 'Daily'],
    ['30 17 * * 1-5', 'Weekdays'],
    ['0 9 * * 1', 'Weekly'],
    ['0 9 * * 0', 'Weekly'],
    ['*/5 * * * *', 'Hourly'],
    ['0 9 1 * *', 'Daily'],
    ['not a cron', 'Custom'],
    ['0 9 * * 1,3,5', 'Custom'],
  ])('detects %s as %s', (cron, expected) => {
    expect(detectFrequencyFromCron(cron).frequency).toBe(expected);
  });

  it('extracts weekday and time for Weekly', () => {
    expect(detectFrequencyFromCron('45 23 * * 6')).toEqual({ frequency: 'Weekly', weekday: '6', time: '11:45 PM' });
  });

  it.each([
    ['Daily', '09:00 AM', '1'],
    ['Weekdays', '05:30 PM', '1'],
    ['Weekly', '09:00 AM', '0'],
    ['Weekly', '11:45 PM', '6'],
    ['Hourly', '09:00 AM', '1'],
  ])('round-trips buildCron(%s, %s, %s)', (frequency, time, weekday) => {
    const parsed = detectFrequencyFromCron(buildCron(frequency, time, weekday));
    expect(parsed.frequency).toBe(frequency);
    if (frequency === 'Weekly') {
      expect(parsed.weekday).toBe(weekday);
      expect(parsed.time).toBe(time);
    }
  });
});

describe('buildDisplay', () => {
  it.each([
    ['Hourly', '09:00 AM', '1', 'Every hour'],
    ['Daily', '09:00 AM', '1', 'Daily at 09:00 AM'],
    ['Weekdays', '05:30 PM', '1', 'Weekdays at 05:30 PM'],
    ['Weekly', '09:00 AM', '1', 'Mondays at 09:00 AM'],
    ['Weekly', '09:00 AM', '0', 'Sundays at 09:00 AM'],
  ])('%s at %s (weekday %s)', (frequency, time, weekday, expected) => {
    expect(buildDisplay(frequency, time, weekday)).toBe(expected);
  });
});
