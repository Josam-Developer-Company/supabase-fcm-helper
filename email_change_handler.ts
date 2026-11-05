type VerifiedUser = {
  id: string;
  is_anonymous?: boolean;
  factors?: { status: string }[];
};
type Auth = {
  getUser(
    jwt: string,
  ): PromiseLike<{ data: { user: VerifiedUser | null }; error: unknown }>;
};
type Backend = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};
const email = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export function createEmailChangeHandler(auth: Auth, admin: Backend) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST") {
      return reply({ error: "method_not_allowed" }, 405);
    }
    const token = req.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)
      ?.[1];
    if (!token) return reply({ error: "unauthorized" }, 401);
    try {
      const { data: { user }, error } = await auth.getUser(token);
      if (error || !user || user.is_anonymous) {
        return reply({ error: "unauthorized" }, 401);
      }
      // Identity is already verified by getUser(token); never trust unverified claims.
      if (user.factors?.some((f) => f.status === "verified")) {
        let claims: any;
        try {
          claims = JSON.parse(
            atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
          );
        } catch {
          return reply({ error: "reauthentication_required" }, 403);
        }
        if (claims.aal !== "aal2") {
          return reply({ error: "reauthentication_required" }, 403);
        }
      }
      let body: any;
      try {
        body = await req.json();
      } catch {
        return reply({ error: "invalid_request" }, 400);
      }
      if (
        body?.action !== "cancel" || !email(body.current_email) ||
        !email(body.pending_email) ||
        !(body.sent_at === null ||
          (typeof body.sent_at === "string" && body.sent_at.length <= 40 &&
            /^\d{4}-\d{2}-\d{2}T/.test(body.sent_at) &&
            Number.isFinite(Date.parse(body.sent_at))))
      ) {
        return reply({ error: "invalid_request" }, 400);
      }
      const result = await admin.rpc("cancel_pending_email_change", {
        p_actor: user.id,
        p_current_email: body.current_email.trim().toLowerCase(),
        p_pending_email: body.pending_email.trim().toLowerCase(),
        p_sent_at: body.sent_at,
      });
      if (result.error) {
        const status = result.error.code === "42501"
          ? 403
          : result.error.code === "55000"
          ? 409
          : 503;
        return reply({
          error: status === 409
            ? "request_changed"
            : status === 403
            ? "forbidden"
            : "processing_failed",
        }, status);
      }
      return reply(result.data);
    } catch {
      return reply({ error: "processing_failed" }, 503);
    }
  };
}
