/** Derived fields: never typed by the user (PLAN.md §4). All dates are calendar dates, evaluated in UTC. */

function utc(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/** `weekday('2026-12-01', 'he')` → `יום שלישי`; `'en'` → `Tuesday`. */
export function weekday(isoDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(utc(isoDate));
}

/** `01.12` or `01.12.2026`: digit order is locale-independent so styles can animate each digit. */
export function numericDate(isoDate: string, withYear = false): string {
  const [y, m, d] = isoDate.split('-') as [string, string, string];
  return withYear ? `${d}.${m}.${y}` : `${d}.${m}`;
}

/** Whole days from `from` to `to`, for countdown sections. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);
}
