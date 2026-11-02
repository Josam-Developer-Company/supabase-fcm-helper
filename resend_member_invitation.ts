import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(status === 429
        ? { "Retry-After": String(body.retryAfterSeconds) }
        : {}),
    },
  });

export async function handleResendInvitation(req: Request, deps: {
  client: SupabaseClient;
  admin: SupabaseClient;
  redirectTo: string;
}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { code: "method_not_allowed" });
  try {
    const { data: { user }, error: authError } = await deps.client.auth
      .getUser();
    if (authError || !user) return reply(401, { code: "unauthorized" });
    let body;
    try {
      body = await req.json();
    } catch {
      return reply(400, { code: "invalid_request" });
    }
    if (
      !body || typeof body.projectId !== "string" ||
      !uuid.test(body.projectId) ||
      typeof body.userId !== "string" || !uuid.test(body.userId)
    ) {
      return reply(400, { code: "invalid_request" });
    }
    const { admin } = deps;
    const { data: project, error: projectError } = await admin.from("projects")
      .select("id, name").eq("id", body.projectId).eq("owner_id", user.id)
      .maybeSingle();
    if (projectError) throw projectError;
    if (!project || body.userId === user.id) {
      return reply(403, { code: "forbidden" });
    }

    // Resolve membership through the stored group, never trust a client email or group.
    const { data: membership, error: membershipError } = await admin.from(
      "group_users",
    )
      .select("group_id, groups!inner(id, name, project_id)")
      .eq("user_id", body.userId).eq("groups.project_id", project.id).limit(1)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return reply(404, { code: "member_not_found" });

    const { data: { user: target }, error: targetError } = await admin.auth
      .admin.getUserById(body.userId);
    if (targetError && targetError.status !== 404) throw targetError;
    if (targetError || !target?.email) {
      return reply(404, { code: "member_not_found" });
    }
    if (target.email_confirmed_at) {
      return reply(200, { status: "already_confirmed" });
    }

    // Fail before reserving an attempt if the existing auth redirect is misconfigured.
    const redirect = new URL(deps.redirectTo);
    if (!["https:", "http:"].includes(redirect.protocol)) {
      throw new Error("Invalid invite redirect");
    }
    const { data: retryAfter, error: reserveError } = await admin.rpc(
      "reserve_member_invitation_resend",
      {
        p_user_id: target.id,
      },
    );
    if (reserveError) throw reserveError;
    if (typeof retryAfter !== "number" || retryAfter < 0) {
      throw new Error("Invalid resend reservation");
    }
    if (retryAfter > 0) {
      return reply(429, {
        code: "rate_limited",
        retryAfterSeconds: retryAfter,
      });
    }

    const group = Array.isArray(membership.groups)
      ? membership.groups[0]
      : membership.groups;
    const { data: invited, error: inviteError } = await admin.auth.admin
      .inviteUserByEmail(target.email, {
        redirectTo: deps.redirectTo,
        data: {
          project_id: project.id,
          project_name: project.name,
          group_id: membership.group_id,
          group_name: group?.name ?? "",
        },
      });
    if (inviteError) {
      // The member may confirm the email while this request is in flight.
      const { data: refreshed } = await admin.auth.admin.getUserById(target.id);
      if (refreshed.user?.email_confirmed_at) {
        return reply(200, { status: "already_confirmed" });
      }
      if (inviteError.status === 429) {
        return reply(429, { code: "rate_limited", retryAfterSeconds: 60 });
      }
      // Do not return provider messages or tokens to the client or logs.
      console.error(
        "resend-member-invitation: mail provider failure",
        inviteError.code,
      );
      return reply(502, { code: "send_failed", retryAfterSeconds: 60 });
    }
    if (invited.user?.id !== target.id) {
      throw new Error("Invitation user mismatch");
    }
    return reply(200, { status: "sent", retryAfterSeconds: 60 });
  } catch {
    console.error("resend-member-invitation: request failed");
    return reply(500, { code: "send_failed" });
  }
}
