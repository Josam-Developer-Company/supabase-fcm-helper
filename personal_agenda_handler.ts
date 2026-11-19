const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class AgendaError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
function day(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AgendaError("Invalid date");
  }
  const parsed = new Date(`${value}T12:00:00Z`);
  if (
    !Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== value
  ) throw new AgendaError("Invalid date");
  return value;
}
// Read every database page, including deployments with a row cap below 200.
// A large result fails explicitly instead of presenting a truncated agenda.
async function readAll(query: () => any): Promise<any[]> {
  const rows: any[] = [];
  for (;;) {
    const { data, error, count } = await query().range(
      rows.length,
      rows.length + 199,
    );
    if (error) throw new AgendaError("Agenda unavailable", 503);
    if (count == null) throw new AgendaError("Agenda count unavailable", 503);
    rows.push(...(data ?? []));
    if (rows.length >= count) return rows;
    if (!data?.length || rows.length >= 20000) {
      throw new AgendaError("Agenda result too large", 503);
    }
  }
}
function role(value: unknown): number {
  return [0, 1, 2].includes(value as number) ? value as number : 3;
}
export function canReadAgendaEvent(
  entry: any,
  actor: string,
  actorRole: number,
  authorRole: number,
): boolean {
  return actorRole <= 2 && (actorRole === 0 || entry.user_id === actor ||
    (entry.entries_visibility ?? []).some((v: any) => v.user_id === actor) ||
    (actorRole === 1 && authorRole <= 1));
}

export function createPersonalAgendaHandler(
  client: any,
  admin: any,
  now = () => new Date(),
) {
  const reply = (status: number, body: unknown) =>
    Response.json(body, {
      status,
      headers: { ...cors, "Cache-Control": "no-store" },
    });
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") {
      return reply(405, { error: "Method not allowed" });
    }
    try {
      const { data: { user }, error } = await client.auth.getUser();
      if (error || !user) return reply(401, { error: "Unauthorized" });
      let body;
      try {
        body = await req.json();
      } catch {
        throw new AgendaError("Invalid JSON");
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new AgendaError("Invalid request");
      }
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Rome",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now());
      const start = day(body.start_date), end = day(body.end_date);
      if (
        start < today || end <= start ||
        +new Date(end) - +new Date(start) > 366 * 86400000
      ) throw new AgendaError("Invalid agenda interval");
      if (
        body.project_id != null &&
        (typeof body.project_id !== "string" || !uuid.test(body.project_id))
      ) throw new AgendaError("Invalid project");
      if (body.type != null && ![1, 2].includes(body.type)) {
        throw new AgendaError("Invalid type");
      }
      for (const key of ["include_unavailability", "include_declined"]) {
        if (body[key] != null && typeof body[key] !== "boolean") {
          throw new AgendaError("Invalid option");
        }
      }
      const cursor = body.cursor;
      if (
        cursor != null &&
        (typeof cursor !== "object" || Array.isArray(cursor) ||
          typeof cursor.id !== "string" || !uuid.test(cursor.id) ||
          day(cursor.date) < start || cursor.date >= end)
      ) throw new AgendaError("Invalid cursor");

      // The actor always comes from the verified token, never from request data.
      const memberships = await readAll(() =>
        admin.from("group_users")
          .select(
            "id,role,group:groups!inner(id,project_id,project:projects!inner(id,name,owner_id,created_at,lifecycle_status))",
            { count: "exact" },
          )
          .eq("user_id", user.id).order("id")
      );
      const projects = new Map<string, any>(),
        ownRoles = new Map<string, number>();
      for (const membership of memberships) {
        const project = membership.group?.project;
        if (!project || project.lifecycle_status === "archived") continue;
        projects.set(project.id, project);
        ownRoles.set(
          project.id,
          Math.max(ownRoles.get(project.id) ?? 0, role(membership.role)),
        );
      }
      if (body.project_id && !projects.has(body.project_id)) {
        throw new AgendaError("Project not accessible", 403);
      }
      const projectIds = body.project_id
        ? [body.project_id]
        : [...projects.keys()];
      const authorRoles = new Map<string, number>();
      for (let i = 0; i < projectIds.length; i += 100) {
        const groups = await readAll(() =>
          admin.from("groups").select("id,project_id", { count: "exact" })
            .in("project_id", projectIds.slice(i, i + 100)).order("id")
        );
        const byGroup = new Map(groups.map((g: any) => [g.id, g.project_id]));
        for (let j = 0; j < groups.length; j += 100) {
          const members = await readAll(() =>
            admin.from("group_users").select("id,user_id,role,group_id", {
              count: "exact",
            })
              .in("group_id", groups.slice(j, j + 100).map((g: any) => g.id))
              .order("id")
          );
          for (const member of members) {
            const key = `${byGroup.get(member.group_id)}:${member.user_id}`;
            authorRoles.set(
              key,
              Math.max(authorRoles.get(key) ?? 0, role(member.role)),
            );
          }
        }
      }
      const columns =
        "id,created_at,start_date,user_id,project_id,description,city,google_place_id,place_address,type,confirmed,entries_visibility(user_id),entry_exclusions(user_id)";
      const events: any[] = [];
      for (let i = 0; i < projectIds.length; i += 100) {
        events.push(
          ...await readAll(() =>
            admin.from("entries").select(columns, { count: "exact" })
              .in("project_id", projectIds.slice(i, i + 100)).in("type", [1, 2])
              .gte("start_date", start).lt("start_date", end).order("id")
          ),
        );
      }
      // Orphan events are visible only if the existing preservation RPC grants access.
      const preserved = new Set<string>();
      for (
        const projectId of new Set(
          events.filter((e) => e.user_id == null).map((e) => e.project_id),
        )
      ) {
        const { data, error } = await admin.rpc("archived_project_entry_ids", {
          p_actor: user.id,
          p_project: projectId,
        });
        if (error) throw new AgendaError("Preserved events unavailable", 503);
        for (const id of data ?? []) preserved.add(id);
      }
      const authorized = events.filter((entry) =>
        entry.user_id == null ? preserved.has(entry.id) : canReadAgendaEvent(
          entry,
          user.id,
          ownRoles.get(entry.project_id) ?? 3,
          authorRoles.get(`${entry.project_id}:${entry.user_id}`) ?? 3,
        )
      );
      const sanitized = authorized.map((
        {
          entries_visibility,
          entry_exclusions,
          private_note,
          entry_private_notes,
          ...entry
        },
      ) => ({
        ...entry,
        user_id: entry.user_id ?? "",
        projects: projects.get(entry.project_id),
        not_participating: (entry_exclusions ?? []).some((e: any) =>
          e.user_id === user.id
        ),
      }));
      const bandDays = new Map<string, Set<string>>();
      for (const entry of sanitized.filter((e) => !e.not_participating)) {
        const date = entry.start_date.slice(0, 10);
        if (!bandDays.has(date)) bandDays.set(date, new Set());
        bandDays.get(date)!.add(entry.project_id);
      }
      let rows = sanitized.filter((e) =>
        (body.include_declined === true || !e.not_participating) &&
        (body.type == null || e.type === body.type)
      );
      // Personal days are independent of the selected band/type, as in the UI.
      if (body.include_unavailability === true) {
        const personal = await readAll(() =>
          admin.from("entries").select(
            "id,created_at,start_date,user_id,project_id,description,city,google_place_id,place_address,type,confirmed",
            { count: "exact" },
          )
            .eq("user_id", user.id).is("project_id", null).eq("type", 0)
            .gte("start_date", start).lt("start_date", end).order("id")
        );
        rows.push(...personal);
      }
      rows = [...new Map(rows.map((e) => [e.id, e])).values()].sort((a, b) =>
        a.start_date.slice(0, 10).localeCompare(b.start_date.slice(0, 10)) ||
        a.id.localeCompare(b.id)
      );
      if (cursor) {
        rows = rows.filter((e) =>
          e.start_date.slice(0, 10) > cursor.date ||
          (e.start_date.slice(0, 10) === cursor.date && e.id > cursor.id)
        );
      }
      const page = rows.slice(0, 50);
      const personalIds = page.filter((e) =>
        e.project_id == null && e.user_id === user.id && e.type === 0
      ).map((e) => e.id);
      if (personalIds.length) {
        // Notes are fetched with the actor's RLS client, never the service key.
        const { data: notes, error } = await client.from("entry_private_notes")
          .select("entry_id,note").eq("user_id", user.id).in(
            "entry_id",
            personalIds,
          );
        if (error) throw new AgendaError("Private notes unavailable", 503);
        const byId = new Map(
          (notes ?? []).map((n: any) => [n.entry_id, n.note]),
        );
        for (const entry of page) {
          if (byId.has(entry.id)) entry.private_note = byId.get(entry.id);
        }
      }
      const last = page.at(-1);
      return reply(200, {
        entries: page,
        projects: [...projects.values()].sort((a, b) =>
          a.name.localeCompare(b.name)
        ),
        conflict_dates: [...bandDays].filter(([, ids]) => ids.size > 1).map((
          [date],
        ) => date),
        next_cursor: rows.length > page.length && last
          ? { date: last.start_date.slice(0, 10), id: last.id }
          : null,
      });
    } catch (error) {
      // Do not log raw database errors or private event/note payloads.
      return reply(error instanceof AgendaError ? error.status : 503, {
        error: error instanceof AgendaError
          ? error.message
          : "Agenda unavailable",
      });
    }
  };
}
