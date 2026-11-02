export function hasPrivateNote(input: Record<string, unknown>): boolean {
  return Object.hasOwn(input, 'private_note');
}

export function privateNoteError(input: Record<string, unknown>): string | null {
  if (!hasPrivateNote(input)) return null;
  const note = input.private_note;
  if (note !== null && typeof note !== 'string') return 'private_note must be a string or null';
  if (typeof note === 'string' && [...note.trim()].length > 500) return 'private_note cannot exceed 500 characters';
  return null;
}

// Use the authenticated client for both RPC and RLS-protected note reads.
export async function savePrivateUnavailability(client: any, input: Record<string, any>, headers: Record<string, string>): Promise<Response> {
  const invalid = privateNoteError(input);
  if (invalid) return Response.json({error: invalid}, {status: 400, headers});
  if ((input.type !== undefined && input.type !== 0) || input.project_id != null || input.id_progetto != null) {
    return Response.json({error: 'Private notes require a personal unavailability'}, {status: 400, headers});
  }
  const {data, error} = await client.rpc('save_personal_unavailability', {
    p_entry_id: input.entryId ?? null,
    p_start_date: input.start_date?.split('T')[0] ?? null,
    p_confirmed: input.confirmed ?? null,
    p_private_note: typeof input.private_note === 'string' ? input.private_note.trim() || null : null,
  });
  if (error) {
    const status = error.code === '42501' ? 403 : ['22023','23505','22P02'].includes(error.code) ? 400 : 500;
    return Response.json({error: status === 403 ? 'Personal unavailability not accessible' : 'Unable to save private note'}, {status, headers});
  }
  return Response.json(data, {headers});
}

export async function attachOwnPrivateNotes(client: any, entries: any[], userId: string): Promise<any[]> {
  // Discard any accidental note field before adding only authenticated own notes.
  const safe = entries.map(({private_note, entry_private_notes, ...entry}) => entry);
  const ids = safe.filter(e => e.user_id === userId && e.project_id == null && e.type === 0 && !String(e.id).startsWith('generated_')).map(e => e.id);
  if (!ids.length) return safe;
  const notes = new Map<string, string>();
  // Bound URL sizes when the future calendar includes many personal dates.
  for (let i = 0; i < ids.length; i += 100) {
    const {data, error} = await client.from('entry_private_notes').select('entry_id,note').eq('user_id', userId).in('entry_id', ids.slice(i, i + 100));
    if (error) throw new Error('Private notes unavailable');
    for (const row of data ?? []) notes.set(row.entry_id, row.note);
  }
  return safe.map(e => ids.includes(e.id) && notes.has(e.id) ? {...e, private_note: notes.get(e.id)} : e);
}
