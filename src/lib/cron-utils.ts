export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const WEEKDAY_OPTIONS = [
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '0', label: 'Sunday' },
] as const;

export function formatHour24ToDisplay(hour: number, minute: number): string {
  const hour12 = hour % 12 || 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${hour12.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} ${ampm}`;
}

export function detectFrequencyFromCron(cron: string): { frequency: string; weekday: string; time: string } {
  const defaults = { frequency: 'Custom', weekday: '1', time: '09:00 AM' } as const;
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return { ...defaults };

  const [minField, hourField, , , dowField] = fields;
  const numericPattern = /^\d+$/;

  if (hourField === '*' && dowField === '*') {
    return { frequency: 'Hourly', weekday: '1', time: '09:00 AM' };
  }

  if (!(numericPattern.test(minField) && numericPattern.test(hourField))) {
    return { ...defaults };
  }

  const time = formatHour24ToDisplay(Number.parseInt(hourField, 10), Number.parseInt(minField, 10));

  if (dowField === '*') return { frequency: 'Daily', weekday: '1', time };
  if (dowField === '1-5') return { frequency: 'Weekdays', weekday: '1', time };
  if (numericPattern.test(dowField)) return { frequency: 'Weekly', weekday: dowField, time };

  return { ...defaults };
}

export function parseTimeTo24(time: string): { hour: number; minute: number } {
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return { hour: 9, minute: 0 };
  let hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === 'AM' && hour === 12) hour = 0;
  if (period === 'PM' && hour !== 12) hour += 12;
  return { hour, minute };
}

export function buildCron(frequency: string, time: string, weekday: string): string {
  const { hour, minute } = parseTimeTo24(time);
  switch (frequency) {
    case 'Hourly':
      return `${minute} * * * *`;
    case 'Daily':
      return `${minute} ${hour} * * *`;
    case 'Weekdays':
      return `${minute} ${hour} * * 1-5`;
    case 'Weekly':
      return `${minute} ${hour} * * ${weekday}`;
    default:
      return `${minute} ${hour} * * *`;
  }
}

export function buildDisplay(frequency: string, time: string, weekday: string): string {
  const dayName = WEEKDAY_OPTIONS.find((d) => d.value === weekday)?.label ?? 'Monday';
  switch (frequency) {
    case 'Hourly':
      return 'Every hour';
    case 'Daily':
      return `Daily at ${time}`;
    case 'Weekdays':
      return `Weekdays at ${time}`;
    case 'Weekly':
      return `${dayName}s at ${time}`;
    default:
      return `${frequency} at ${time}`;
  }
}
