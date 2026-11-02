export interface ProjectGroupMember {
  user_id: string | null;
  role: number | null;
}

/**
 * Mirror get-entries project-role visibility. Admins can see every event,
 * managers see admin/manager-owned events, and limited users see their own
 * events plus entries explicitly shared with them. For notifications, limited
 * members are notified only when explicitly included in visibleUserIds.
 */
export function selectEventNotificationRecipients(
  groupMembers: ProjectGroupMember[],
  visibleUserIds: string[],
  eventOwnerId: string,
): string[] {
  const firstRoleByUser = new Map<string, number>();
  const allRolesByUser = new Map<string, Set<number>>();
  for (const member of groupMembers) {
    if (!member.user_id || member.role == null) continue;
    if (!firstRoleByUser.has(member.user_id)) {
      firstRoleByUser.set(member.user_id, member.role);
    }
    const roles = allRolesByUser.get(member.user_id) ?? new Set<number>();
    roles.add(member.role);
    allRolesByUser.set(member.user_id, roles);
  }

  const eventOwnerRoles = allRolesByUser.get(eventOwnerId) ?? new Set<number>();
  const visibleIds = new Set(visibleUserIds);
  const recipients = new Set<string>();

  for (const [userId, role] of firstRoleByUser) {
    // Match get-entries: it uses the first membership role to decide what this
    // recipient can see, while manager feeds include owners with any 0/1 role.
    if (role === 0) {
      recipients.add(userId);
    } else if (
      role === 1 &&
      (eventOwnerRoles.has(0) || eventOwnerRoles.has(1) || visibleIds.has(userId))
    ) {
      recipients.add(userId);
    } else if (
      role === 2 &&
      (userId === eventOwnerId || visibleIds.has(userId))
    ) {
      recipients.add(userId);
    }
  }

  return [...recipients];
}

export async function getProjectEventNotificationRecipients(
  adminClient: any,
  projectId: string | number,
  visibleUserIds: string[] = [],
  eventOwnerId: string,
): Promise<string[]> {
  const { data: projectGroups, error } = await adminClient
    .from('groups')
    .select('id, group_users(user_id, role)')
    .eq('project_id', projectId);

  if (error) {
    console.error('Error fetching event notification recipients:', error);
    return [];
  }

  const groupMembers = (projectGroups ?? []).flatMap((group: any) => group.group_users ?? []);
  return selectEventNotificationRecipients(
    groupMembers,
    visibleUserIds,
    eventOwnerId,
  );
}
