// Calendar days use the same Europe/Rome convention as project reminders.
import { civilDate } from "./entry_reader.ts";
export function todayInRome(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function isPastEntry(value: unknown, now = new Date()): boolean {
  return civilDate(value) < todayInRome(now);
}
