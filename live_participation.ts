/** Project membership remains implicit participation unless this live or rehearsal is declined. */
export function blockingProjectUserIds(
  entry: { type: number; entry_exclusions?: { user_id: string }[] },
  projectUserIds: string[],
): string[] {
  const excluded = new Set((entry.type === 1 || entry.type === 2)
    ? (entry.entry_exclusions ?? []).map((row) => row.user_id) : []);
  return [...new Set(projectUserIds)].filter((id) => !excluded.has(id));
}
