export type LeaveProjectBackend = {
  auth: {
    getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }>;
  };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

export function createLeaveProjectHandler(
  auth: LeaveProjectBackend['auth'],
  admin: Pick<LeaveProjectBackend, 'rpc'>,
) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization,x-client-info,apikey,content-type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json',
  };
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers });
    if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    try {
      const { data: { user }, error } = await auth.getUser();
      if (error || !user) return reply({ error: 'unauthorized' }, 401);
      let body;
      try { body = await req.json(); } catch { return reply({ error: 'invalid_request' }, 400); }
      if (typeof body?.projectId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.projectId)) {
        return reply({ error: 'invalid_project' }, 400);
      }
      const result = await admin.rpc('leave_project', {
        p_actor: user.id, // Never trust a caller-supplied userId, actor or role.
        p_project_id: body.projectId,
      });
      if (result.error) {
        if (result.error.code === 'P0001' && result.error.message === 'owner_must_transfer') {
          return reply({ error: 'owner_must_transfer' }, 409);
        }
        if (result.error.code === '42501') return reply({ error: 'forbidden' }, 403);
        return reply({ error: 'leave_failed' }, 503);
      }
      return reply(result.data);
    } catch {
      return reply({ error: 'leave_failed' }, 503);
    }
  };
}
