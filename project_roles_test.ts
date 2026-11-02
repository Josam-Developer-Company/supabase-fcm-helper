import { normalizeProjectGroups, inviteProjectRole, setProjectRole } from './project_roles.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
function rejects(fn: () => void) {
  let failed = false;
  try { fn(); } catch { failed = true; }
  if (!failed) throw new Error('Expected rejection');
}
Deno.test('normalizes legacy and explicit invitations, including repeated addresses across groups', () => {
  const groups = [{ newMembers: [' NEW@Example.com '] }, { newMembers: [{ email: 'new@example.com', role: 2 }] }];
  normalizeProjectGroups(groups);
  equal(groups[0].newMembers, [{ email: 'new@example.com', role: 2 }]);
});
Deno.test('rejects invalid or conflicting roles before mutation', () => {
  for (const role of [-1, 3, '1', 1.5, null]) rejects(() => normalizeProjectGroups([{ members: [{user_id:'u', role}] }]));
  rejects(() => normalizeProjectGroups([{ members: [{ user_id: 'u', role: 1 }] }, { members: [{ user_id: 'u', role: 2 }] }]));
  rejects(() => normalizeProjectGroups([{ newMembers: [{email:'a@b.it',role:0}] }, { newMembers: [{email:'A@b.it',role:2}] }]));
});
type Row = Record<string, string | number>;
function memoryClient() {
  const tables: Record<string, Row[]> = {
    groups: [{ id: 'g1', project_id: 'p' }, { id: 'g2', project_id: 'p' }, { id: 'g3', project_id: 'other' }],
    group_users: [
      { group_id: 'g1', user_id: 'u', role: 2 },
      { group_id: 'g2', user_id: 'u', role: 2 },
      { group_id: 'g3', user_id: 'u', role: 0 },
      { group_id: 'g1', user_id: 'someone-else', role: 0 },
    ],
  };
  let writes = 0;
  const client = { from(table: string) {
    if (!(table in tables)) throw new Error('Unexpected table: ' + table);
    const predicates: ((row: Row) => boolean)[] = [];
    let patch: Row | undefined;
    const query = {
      select(_columns: string) { return query; },
      update(values: Row) { patch = values; return query; },
      eq(column: string, value: string | number) { predicates.push(row => row[column] === value); return query; },
      in(column: string, values: string[]) { predicates.push(row => values.includes(String(row[column]))); return query; },
      then(resolve: (value: { data: Row[]; error: null }) => void) {
        const selected = tables[table].filter(row => predicates.every(predicate => predicate(row)));
        if (patch) { writes++; for (const row of selected) Object.assign(row, patch); }
        resolve({ data: selected.map(row => ({ ...row })), error: null });
      },
    };
    return query;
  } };
  return { client, tables, get writes() { return writes; } };
}

Deno.test('adding an existing user to another group inherits the project role without writing', async () => {
  const db = memoryClient();
  equal(await inviteProjectRole(db.client, 'p', 'u', 0), 2);
  equal(db.writes, 0);
});
Deno.test('new user gets requested role or normal, with no schema writes', async () => {
  const db = memoryClient();
  equal(await inviteProjectRole(db.client, 'p', 'new', 2), 2);
  equal(await inviteProjectRole(db.client, 'p', 'new'), 1);
  equal(db.writes, 0);
});
Deno.test('a role change updates all groups in the project in a single statement', async () => {
  const db = memoryClient();
  await setProjectRole(db.client, 'p', 'u', 1);
  equal(db.tables.group_users, [
    {group_id:'g1',user_id:'u',role:1}, {group_id:'g2',user_id:'u',role:1},
    {group_id:'g3',user_id:'u',role:0}, {group_id:'g1',user_id:'someone-else',role:0},
  ]);
  equal(db.writes, 1);
});
Deno.test('conflicting historical roles resolve restrictively when inheriting', async () => {
  const db = memoryClient();
  db.tables.group_users[0].role = 0;
  equal(await inviteProjectRole(db.client, 'p', 'u', 1), 2);
  equal(db.tables.group_users[0].role, 2);
  equal(db.writes, 1);
});
Deno.test('invalid role is rejected before any update', async () => {
  const db = memoryClient();
  let failed = false;
  try { await setProjectRole(db.client, 'p', 'u', 5); } catch { failed = true; }
  equal(failed, true);
  equal(db.writes, 0);
});
Deno.test('empty projects do not read or change memberships from other projects', async () => {
  const db = memoryClient();
  equal(await inviteProjectRole(db.client, 'empty', 'u', 1), 1);
  await setProjectRole(db.client, 'empty', 'u', 2);
  equal(db.writes, 0);
});

Deno.test('invalid persisted roles cannot become admin through numeric coercion', async () => {
  const db = memoryClient();
  db.tables.group_users[0].role = '';
  let failed = false;
  try { await inviteProjectRole(db.client, 'p', 'u', 0); } catch { failed = true; }
  equal(failed, true);
  equal(db.writes, 0);
});
