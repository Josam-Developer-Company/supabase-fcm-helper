import assert from 'node:assert/strict';
import test from 'node:test';
import { selectEventNotificationRecipients } from './event_notification_recipients.ts';

test('admins receive all events; limited recipients require explicit visibility', () => {
  const recipients = selectEventNotificationRecipients(
    [
      { user_id: 'admin', role: 0 },
      { user_id: 'manager', role: 1 },
      { user_id: 'limited', role: 2 },
      { user_id: 'other-limited', role: 2 },
    ],
    ['limited'],
    'limited',
  );

  assert.deepEqual(recipients, ['admin', 'limited']);
});

test('managers receive events they can see and those owned by admins/managers', () => {
  const recipients = selectEventNotificationRecipients(
    [
      { user_id: 'manager', role: 1 },
      { user_id: 'admin', role: 0 },
      { user_id: 'event-manager', role: 1 },
      { user_id: 'event-limited', role: 2 },
    ],
    ['manager', 'event-limited'],
    'event-manager',
  );

  assert.deepEqual(recipients, ['manager', 'admin', 'event-manager', 'event-limited']);
});

test('limited users only receive own events or events explicitly shared with them', () => {
  const recipients = selectEventNotificationRecipients(
    [
      { user_id: 'limited-owner', role: 2 },
      { user_id: 'limited-selected', role: 2 },
      { user_id: 'limited-other', role: 2 },
      { user_id: 'manager', role: 1 },
    ],
    ['manager', 'limited-selected'],
    'limited-owner',
  );

  assert.deepEqual(recipients, ['limited-owner', 'limited-selected', 'manager']);
});

