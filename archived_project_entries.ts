import {
  entryQueryResult,
  type EntryReadOptions,
  EntryRequestError,
  filterEntryResults,
} from "./entry_reader.ts";

export async function readArchivedProjectEntries(
  admin: any,
  userId: string,
  projectId: string,
  options: EntryReadOptions,
  groups: any[],
) {
  if (options.groupId && !groups.some((g) => g.id === options.groupId)) {
    throw new EntryRequestError("Invalid group for project");
  }
  const { data: ids, error } = await admin.rpc("archived_project_entry_ids", {
    p_actor: userId,
    p_project: projectId,
  });
  if (error) {
    throw new EntryRequestError(
      "Archive not accessible",
      error.code === "42501" ? 403 : 503,
    );
  }
  const rows: any[] = [];
  for (let i = 0; i < (ids ?? []).length; i += 100) {
    const result = await entryQueryResult(() => {
      let query = admin.from("entries").select(
        "*, projects(id, nome:name, id_owner:owner_id, created_at, lifecycle_status, archived_at), profili:profiles(*), entry_exclusions(user_id)",
        { count: "exact" },
      )
        .eq("project_id", projectId).in("id", ids.slice(i, i + 100));
      if (options.startDate) query = query.gte("start_date", options.startDate);
      if (options.endDate) query = query.lt("start_date", options.endDate);
      return query;
    }, true);
    if (result.error) throw new EntryRequestError("Archive unavailable", 503);
    for (
      const {
        private_note,
        entry_private_notes,
        entries_visibility,
        entry_exclusions,
        ...row
      } of result.data ?? []
    ) {
      rows.push({
        ...row,
        user_id: row.user_id ?? "",
        projects: row.projects
          ? { ...row.projects, id_owner: row.projects.id_owner ?? "" }
          : null,
        not_participating: (entry_exclusions ?? []).some((e: any) =>
          e.user_id === userId
        ),
      });
    }
  }
  const roles = groups.flatMap((g) => g.groupUser ?? []).filter((m) =>
    m.user_id === userId
  ).map((m) => m.role);
  return filterEntryResults(rows, options, {
    userId,
    projectId,
    currentRole: roles.length ? Math.max(...roles) : 2,
    groups,
  });
}
