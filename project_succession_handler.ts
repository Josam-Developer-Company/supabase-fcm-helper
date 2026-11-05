export type SuccessionBackend = {
  auth: {
    getUser(): PromiseLike<
      { data: { user: { id: string } | null }; error: unknown }
    >;
  };
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: any }>;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function createSuccessionHandler(
  auth: SuccessionBackend["auth"],
  admin: Pick<SuccessionBackend, "rpc">,
) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization,x-client-info,apikey,content-type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Content-Type": "application/json",
  };
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST") {
      return reply({ error: "method_not_allowed" }, 405);
    }
    try {
      const { data: { user }, error } = await auth.getUser();
      if (error || !user) return reply({ error: "unauthorized" }, 401);
      let body: any;
      try {
        body = await req.json();
      } catch {
        return reply({ error: "invalid_request" }, 400);
      }
      if (
        !body ||
        ![
          "list",
          "account",
          "keep_account",
          "project",
          "restore",
          "offer",
          "accept",
          "decline",
        ].includes(body.action)
      ) return reply({ error: "invalid_request" }, 400);
      if (
        ["offer", "accept", "decline"].includes(body.action) &&
        !uuid(body.offer)
      ) return reply({ error: "invalid_offer" }, 400);
      if (["project", "restore"].includes(body.action) && !uuid(body.project)) {
        return reply({ error: "invalid_project" }, 400);
      }
      // Body-supplied actor/role/email fields are deliberately never forwarded.
      const result = await admin.rpc("project_succession_request", {
        p_actor: user.id,
        p_action: body.action,
        p_offer: uuid(body.offer) ? body.offer : null,
        p_project: uuid(body.project) ? body.project : null,
      });
      if (result.error) {
        return reply(
          {
            error: result.error.code === "42501"
              ? "forbidden"
              : result.error.code === "55000"
              ? "unavailable"
              : "processing_failed",
          },
          result.error.code === "42501"
            ? 403
            : result.error.code === "55000"
            ? 409
            : 503,
        );
      }
      return reply(result.data);
    } catch {
      return reply({ error: "processing_failed" }, 503);
    }
  };
}
