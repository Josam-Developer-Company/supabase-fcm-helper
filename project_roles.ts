export type Invite = { email: string; role?: number };

export function validateRole(role: unknown): asserts role is number {
  if (!Number.isInteger(role) || ![0, 1, 2].includes(role as number)) {
    throw new Error('Role must be 0, 1 or 2');
  }
}

// Legacy string invitations inherit an existing project role, or default to normal.
export function normalizeProjectGroups(groups: any[]): void {
  if (!Array.isArray(groups)) throw new Error('Groups must be an array');
  const byUser = new Map<string, number>();
  const byEmail = new Map<string, number>();
  for (const group of groups) {
    if (!group || typeof group !== 'object') throw new Error('Invalid group');
    if (group.members !== undefined && !Array.isArray(group.members)) throw new Error('Invalid members');
    for (const member of group.members ?? []) {
      if (!member || typeof member.user_id !== 'string' || !member.user_id) throw new Error('Invalid member identity');
      validateRole(member.role);
      if (byUser.has(member.user_id) && byUser.get(member.user_id) !== member.role) {
        throw new Error('A user must have one role across the project');
      }
      byUser.set(member.user_id, member.role);
    }
    if (group.newMembers !== undefined && !Array.isArray(group.newMembers)) throw new Error('Invalid invitations');
    group.newMembers = (group.newMembers ?? []).map((value: unknown): Invite => {
      const invite = typeof value === 'string' ? { email: value } : value as Invite;
      if (!invite || typeof invite.email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(invite.email.trim())) {
        throw new Error('Invalid invitation email');
      }
      const email = invite.email.trim().toLowerCase();
      if (invite.role !== undefined) {
        validateRole(invite.role);
        if (byEmail.has(email) && byEmail.get(email) !== invite.role) throw new Error('Conflicting invitation roles');
        byEmail.set(email, invite.role);
      }
      return { email, ...(invite.role !== undefined ? { role: invite.role } : {}) };
    });
  }
  // Propagate explicit choices to legacy invitations for the same address.
  for (const group of groups) for (const invite of group.newMembers) {
    if (byEmail.has(invite.email)) invite.role = byEmail.get(invite.email);
  }
}

export type ProjectMembership = { user_id: string; group_id: string; role: number };

export async function getProjectMemberships(client: any, projectId: string): Promise<ProjectMembership[]> {
  const { data: groups, error: groupsError } = await client.from('groups')
    .select('id').eq('project_id', projectId);
  if (groupsError) throw groupsError;
  if (!groups?.length) return [];
  const { data, error } = await client.from('group_users').select('user_id, group_id, role')
    .in('group_id', groups.map((group: { id: string }) => group.id));
  if (error) throw error;
  return data ?? [];
}

export async function setProjectRole(client: any, projectId: string, userId: string, role: number) {
  validateRole(role);
  const { data: groups, error: groupsError } = await client.from('groups')
    .select('id').eq('project_id', projectId);
  if (groupsError) throw groupsError;
  if (!groups?.length) return;
  // One UPDATE changes every existing association for this user atomically.
  const { error } = await client.from('group_users').update({ role })
    .eq('user_id', userId).in('group_id', groups.map((group: { id: string }) => group.id));
  if (error) throw error;
}

export async function inviteProjectRole(client: any, projectId: string, userId: string, requested?: number) {
  if (requested !== undefined) validateRole(requested);
  const memberships = (await getProjectMemberships(client, projectId))
    .filter((member) => member.user_id === userId);
  // New members use the chosen role. Adding another group inherits the existing
  // role; a defensive fallback resolves historical disagreements restrictively.
  if (!memberships.length) return requested ?? 1;
  for (const member of memberships) validateRole(member.role);
  const role = Math.max(...memberships.map((member) => member.role));
  validateRole(role);
  if (memberships.some((member) => member.role !== role)) {
    await setProjectRole(client, projectId, userId, role);
  }
  return role;
}
