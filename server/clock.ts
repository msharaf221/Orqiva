/** Business date in Egypt (YYYY-MM-DD), the reference for "today" in reports and closures. */
export function businessToday(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
