// Sim calendar: integer day index from 1 Jan 1936. No JS Date in the sim.
export type SimDate = number;
export const START_YEAR = 1936;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const yearDays = (y: number) => (isLeap(y) ? 366 : 365);

export interface Ymd { year: number; month: number; day: number }

export function toYmd(d: SimDate): Ymd {
  let year = START_YEAR;
  while (d >= yearDays(year)) { d -= yearDays(year); year++; }
  let month = 0;
  for (;;) {
    const md = MONTH_DAYS[month]! + (month === 1 && isLeap(year) ? 1 : 0);
    if (d < md) break;
    d -= md; month++;
  }
  return { year, month: month + 1, day: d + 1 };
}

export function fromYmd(year: number, month: number, day: number): SimDate {
  let d = 0;
  for (let y = START_YEAR; y < year; y++) d += yearDays(y);
  for (let y = year; y < START_YEAR; y++) d -= yearDays(y); // dates before 1936 are negative
  for (let m = 0; m < month - 1; m++) d += MONTH_DAYS[m]! + (m === 1 && isLeap(year) ? 1 : 0);
  return d + day - 1;
}

export function formatDate(d: SimDate): string {
  const { year, month, day } = toYmd(d);
  return `${day} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][month - 1]} ${year}`;
}
