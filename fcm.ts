/**
 * Modulo condiviso per l'invio di push notification via Firebase Cloud
 * Messaging (API HTTP v1) dalle Edge Functions.
 *
 * Autenticazione: service account Google (JWT RS256 → access token OAuth2),
 * firmato con crypto.subtle di Deno. Il JSON del service account viene letto
 * dalla variabile d'ambiente FIREBASE_SERVICE_ACCOUNT_JSON:
 *
 *   supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON "$(cat service-account.json)"
 *
 * Messaggi "data-only": il payload contiene chiavi di traduzione (titleKey,
 * bodyKey) e parametri; i testi localizzati it/en vivono nel service worker
 * web/firebase-messaging-sw.js e in lib/services/push_strings.dart.
 * La lingua arriva da fcm_tokens.lang (preferenza salvata alla registrazione).
 */

import * as Sentry from "https://deno.land/x/sentry/index.mjs";
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { classifyReminderFcmResponse } from 'https://esm.sh/gh/Giupy93/supabase-fcm-helper/reminder_validation.ts';

const FCM_ENDPOINT = 'https://fcm.googleapis.com/v1/projects/{projectId}/messages:send';
const OAUTH_ENDPOINT = 'https://oauth2.googleapis.com/token';
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

// Cache dell'access token OAuth2 (validità ~1h, rinnoviamo con margine).
let cachedToken: { value: string; expiresAt: number } | null = null;

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

interface PushPayload {
  titleKey: string;
  bodyKey: string;
  params?: Record<string, string>;
  link?: string;
  tag?: string;
  ttlSeconds?: number;
}

interface ServiceAccountResult {
  account: ServiceAccount | null;
  missing: boolean;
}

function getServiceAccount(): ServiceAccountResult {
  const raw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (!raw) {
    return { account: null, missing: true };
  }
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
      return { account: null, missing: false };
    }
    return { account: parsed, missing: false };
  } catch (_) {
    return { account: null, missing: false };
  }
}

function base64UrlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let accessTokenRequest: Promise<string | null> | null = null;
async function getAccessToken(account: ServiceAccount): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt - 60 > Math.floor(Date.now()/1000)) return cachedToken.value;
  if (accessTokenRequest) return accessTokenRequest;
  accessTokenRequest = requestAccessToken(account);
  try { return await accessTokenRequest; } finally { accessTokenRequest = null; }
}
async function requestAccessToken(account: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) {
    return cachedToken.value;
  }

  try {
    const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64UrlEncode(JSON.stringify({
      iss: account.client_email,
      scope: OAUTH_SCOPE,
      aud: OAUTH_ENDPOINT,
      iat: now,
      exp: now + 3600,
    }));
    const unsigned = `${header}.${claims}`;

    // crypto.subtle non accetta chiavi PEM: convertiamo PKCS#8 → raw.
    const pkcs8 = base64UrlDecodeToBytes(account.private_key);
    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8 as unknown as ArrayBuffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      new TextEncoder().encode(unsigned),
    );

    const jwt = `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;

    const response = await fetch(OAUTH_ENDPOINT, {
      signal: AbortSignal.timeout(15000),
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    if (!response.ok) {
      console.error('FCM OAuth token request failed:', await response.text());
      return null;
    }

    const data = await response.json();
    cachedToken = { value: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
    return cachedToken!.value;
  } catch (error) {
    console.error('FCM OAuth error:', error);
    return null;
  }
}

function base64UrlDecodeToBytes(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const normalized = body.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * True se FCM ha rifiutato il messaggio perché il token non è più valido.
 *
 * La cancellazione va SEMPRE confermata dal body di errore:
 * - 404/410 con errorCode UNREGISTERED → token morto (o SENDER_ID_MISMATCH,
 *   token appartenente a un altro sender: inutilizzabile per noi);
 * - 404 generico SENZA quel dettaglio (es. project_id errato nel service
 *   account → "Requested entity was not found" a livello endpoint) NON dice
 *   nulla sul token: cancellare in quel caso svuoterebbe la tabella ad ogni invio;
 * - 400 con messaggio che cita il registration token → token malformato,
 *   definitivo (un INVALID_ARGUMENT sul payload non c'entra: il payload lo
 *   costruiamo noi).
 */
export function isFcmTokenDead(status: number, errorText: string): boolean {
  if (status === 404 || status === 410) {
    try {
      const parsed = JSON.parse(errorText) as {
        error?: { details?: Array<{ errorCode?: string }> };
      };
      const details = parsed?.error?.details;
      if (!Array.isArray(details)) return false;
      return details.some(
        (d) => d?.errorCode === 'UNREGISTERED' || d?.errorCode === 'SENDER_ID_MISMATCH',
      );
    } catch (_) {
      return false; // body non JSON: meglio non cancellare che cancellare male.
    }
  }
  if (status === 400) {
    return /registration token/i.test(errorText);
  }
  return false;
}

/** Invia una push data-only a tutti i token FCM di un utente. */
export async function sendPushToUser(
  adminClient: SupabaseClient,
  userId: string,
  payload: PushPayload,
): Promise<boolean> {
  const { account, missing } = getServiceAccount();
  if (missing) {
    console.warn('FIREBASE_SERVICE_ACCOUNT_JSON non configurata: push disabilitate.');
    return false;
  }
  if (!account) {
    console.error('FIREBASE_SERVICE_ACCOUNT_JSON non valida.');
    return false;
  }

  const accessToken = await getAccessToken(account);
  if (!accessToken) return false;

  try {
    const { data: tokens, error } = await adminClient
      .from('fcm_tokens')
      .select('token, lang')
      .eq('user_id', userId);

    if (error) {
      console.error('Error fetching FCM tokens:', error);
      return false;
    }
    if (!tokens || tokens.length === 0) {
      return false; // L'utente non ha notifiche attive: silenziosamente ok.
    }

    let sentAtLeastOne = false;
    await Promise.all(tokens.map(async ({ token, lang }) => {
      const message = {
        message: {
          token,
          // Data-only Android delivery must wake the background handler promptly.
          android: { priority: 'high' },
          data: {
            recipientId: userId,
            titleKey: payload.titleKey,
            bodyKey: payload.bodyKey,
            ...(payload.params ?? {}),
            lang: lang === 'en' ? 'en' : 'it',
            ...(payload.link ? { link: payload.link } : {}),
            ...(payload.tag ? { tag: payload.tag } : {}),
          },
        },
      };

      try {
        const response = await fetch(
          FCM_ENDPOINT.replace('{projectId}', account.project_id),
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
          },
        );

        if (response.ok) {
          sentAtLeastOne = true;
          return;
        }

        const errorText = await response.text();
        console.error(`FCM send failed (${response.status}):`, errorText);

        // Token non più valido: rimuoviamolo per non riprovare all'infinito.
        // Solo con conferma UNREGISTERED dal body (vedi isFcmTokenDead).
        if (isFcmTokenDead(response.status, errorText)) {
          await adminClient.from('fcm_tokens').delete().eq('token', token);
        }
      } catch (sendError) {
        console.error('FCM send error:', sendError);
      }
    }));

    return sentAtLeastOne;
  } catch (error) {
    console.error('sendPushToUser error:', error);
    if (typeof Sentry !== 'undefined' && Sentry?.captureException) {
      Sentry.captureException(error);
    }
    return false;
  }
}

/**
 * Invia una push a tutti i membri (user_id) di un progetto, escluso l'utente
 * che ha compiuto l'azione. La membership è data dai gruppi del progetto
 * (tabella group_users), come in delete-project.
 *
 * Restituisce la lista degli userId notificati (per il logging nelle funzioni).
 */
export async function sendPushToProjectMembers(
  adminClient: SupabaseClient,
  projectId: string | number,
  excludeUserId: string,
  payload: PushPayload,
): Promise<string[]> {
  try {
    // 1. Gruppi del progetto.
    const { data: projectGroups, error: groupsError } = await adminClient
      .from('groups')
      .select('id')
      .eq('project_id', projectId);

    if (groupsError) {
      console.error('Error fetching project groups for push:', groupsError);
      return [];
    }

    const groupIds = (projectGroups ?? []).map((g) => g.id);
    if (groupIds.length === 0) return [];

    // 2. Membri dai gruppi (dedup, escluso l'autore dell'azione).
    const { data: groupMembers, error: membersError } = await adminClient
      .from('group_users')
      .select('user_id')
      .in('group_id', groupIds)
      .neq('user_id', excludeUserId);

    if (membersError) {
      console.error('Error fetching group members for push:', membersError);
      return [];
    }

    const userIds = [...new Set((groupMembers ?? []).map((m) => m.user_id as string))]
      .filter(Boolean);

    await Promise.all(userIds.map((userId) => sendPushToUser(adminClient, userId, payload)));
    return userIds;
  } catch (error) {
    console.error('sendPushToProjectMembers error:', error);
    return [];
  }
}

export const WEB_APP_URL = () => Deno.env.get('WEB_APP_URL');

/** Per-device result for durable reminder retries. Existing callers keep the
 * boolean sendPushToUser API. Token cleanup remains the worker's responsibility. */
export async function sendReminderPushToDevice(
  token: string,
  lang: string,
  payload: PushPayload,
): Promise<ReturnType<typeof classifyReminderFcmResponse>> {
  const { account } = getServiceAccount();
  if (!account) {
    return { status: 'retry', error: 'Firebase service account unavailable' };
  }
  const accessToken = await getAccessToken(account);
  if (!accessToken) {
    return { status: 'retry', error: 'Firebase authentication unavailable' };
  }
  try {
    const response = await fetch(
      FCM_ENDPOINT.replace('{projectId}', account.project_id),
      {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            android: {
              priority: 'high',
              ttl: `${Math.max(0, Math.min(payload.ttlSeconds ?? 3600, 3600))}s`,
            },
            data: {
              titleKey: payload.titleKey,
              bodyKey: payload.bodyKey,
              ...payload.params,
              lang: lang === 'en' ? 'en' : 'it',
              link: payload.link ?? '/calendar',
              tag: payload.tag ?? '',
            },
            webpush: {
              headers: {
                TTL: String(Math.max(0, Math.min(payload.ttlSeconds ?? 3600, 3600))),
                Urgency: 'normal',
              },
            },
          },
        }),
      },
    );
    return classifyReminderFcmResponse(response.status, await response.text());
  } catch {
    return { status: 'retry', error: 'FCM network or timeout error' };
  }
}
