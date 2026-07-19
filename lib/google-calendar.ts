// This module must only be imported in API routes or Server Actions.
// It uses the 'googleapis' package which requires Node.js built-ins.

import { google } from 'googleapis';
import { createAdminClient } from './supabase';

function getOAuth2Client(redirectUri?: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri || process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'
  );
}

export interface CalendarEvent {
  summary: string;
  description?: string;
  start: string; // ISO datetime
  end: string; // ISO datetime
  attendees: string[]; // email addresses
  conferenceData?: boolean; // create Google Meet link
}

// `state` must be an unguessable, single-use nonce that the caller also stores
// (we put it in an httpOnly cookie) and re-checks on the callback. It carries no
// identity: the user is re-derived from their Privy session in the callback.
// Encoding userId/companyId here instead — as this used to — let an attacker
// replay their own consent code with a victim's id in state, binding the
// attacker's Google account to the victim's workspace.
export async function getAuthUrl(state: string, redirectUri?: string) {
  const oauth2Client = getOAuth2Client(redirectUri);
  // calendar.events only — it covers insert/patch/delete AND events.list, which is
  // everything we do (always on calendarId 'primary'; we never enumerate calendars).
  // Asking for calendar.readonly on top added a second sensitive scope to Google's
  // verification review and a scarier consent prompt, for no capability we use.
  const scopes = ['https://www.googleapis.com/auth/calendar.events'];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    state,
    prompt: 'consent' // Force refresh token
  });
}

// userId/companyId come from the caller, which derives them from the verified
// Privy session on the callback request — never from anything Google echoed back.
export async function handleOAuthCallback(code: string, userId: string, companyId: string, redirectUri?: string) {
  const oauth2Client = getOAuth2Client(redirectUri);

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  const supabase = createAdminClient();

  // Resolve the internal Database ID from the Privy User ID
  const { data: userData } = await supabase
    .from('company_users')
    .select('id')
    .eq('privy_user_id', userId)
    .single();

  if (!userData) throw new Error(`User not found for ID: ${userId}`);

  await supabase.from('integration_tokens').upsert({
    company_id: companyId,
    user_id: userData.id,
    provider: 'google',
    access_token: tokens.access_token!,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    scope: ['calendar.events'],
  });

  return tokens;
}

// Resolve a Privy user id → an authenticated Calendar client. Central because
// the token is keyed by the INTERNAL company_users.id, not the Privy id — the
// update/cancel paths used to query it wrong (by Privy id) and silently no-op.
// Returns null when the user has no Google integration connected.
async function getCalendarClient(userId: string) {
  const supabase = createAdminClient();
  const oauth2Client = getOAuth2Client();

  const { data: userData } = await supabase
    .from('company_users')
    .select('id')
    .eq('privy_user_id', userId)
    .single();
  if (!userData) return null;

  const { data: tokenData } = await supabase
    .from('integration_tokens')
    .select('*')
    .eq('user_id', userData.id)
    .eq('provider', 'google')
    .single();
  if (!tokenData) return null;

  if (tokenData.expires_at && new Date(tokenData.expires_at) < new Date()) {
    oauth2Client.setCredentials({ refresh_token: tokenData.refresh_token });
    let credentials;
    try {
      ({ credentials } = await oauth2Client.refreshAccessToken());
    } catch (err: any) {
      // Google refused the refresh token. The common causes are permanent: the
      // user revoked access, or the grant aged out (unverified apps in Testing
      // have their refresh tokens expire after 7 days). Drop our dead copy so
      // hr_google_connected reports false and the UI offers Connect again —
      // otherwise the card keeps claiming "Connected" while every interview is
      // silently scheduled without a Meet link.
      const reason = err?.response?.data?.error || err?.message || '';
      if (/invalid_grant|invalid_request|unauthorized/i.test(reason)) {
        await supabase.from('integration_tokens').delete().eq('id', tokenData.id);
        console.warn(`google-calendar: refresh rejected (${reason}); cleared the stale connection`);
      } else {
        console.error('google-calendar: refresh failed (transient, keeping token):', reason);
      }
      return null;
    }
    await supabase
      .from('integration_tokens')
      .update({
        access_token: credentials.access_token!,
        expires_at: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
      })
      .eq('id', tokenData.id);
    oauth2Client.setCredentials(credentials);
  } else {
    oauth2Client.setCredentials({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
    });
  }

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

export async function createCalendarEvent(
  userId: string,
  event: CalendarEvent
): Promise<{ eventId: string; meetLink?: string } | null> {
  try {
    const calendar = await getCalendarClient(userId);
    if (!calendar) throw new Error('No Google integration found');

    const eventPayload: Record<string, unknown> = {
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.start, timeZone: 'UTC' },
      end: { dateTime: event.end, timeZone: 'UTC' },
      attendees: event.attendees.map((email) => ({ email })),
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 30 },
        ],
      },
    };

    if (event.conferenceData) {
      eventPayload.conferenceData = {
        createRequest: {
          requestId: `${userId}-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    }

    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: eventPayload,
      conferenceDataVersion: event.conferenceData ? 1 : 0,
      sendUpdates: 'all',
    });

    return {
      eventId: response.data.id!,
      meetLink: response.data.conferenceData?.entryPoints?.[0]?.uri ?? undefined,
    };
  } catch (error) {
    console.error('Error creating calendar event:', error);
    return null;
  }
}

export async function updateCalendarEvent(
  userId: string,
  eventId: string,
  updates: Partial<CalendarEvent>
): Promise<boolean> {
  try {
    const calendar = await getCalendarClient(userId);
    if (!calendar) return false;

    const eventPayload: Record<string, unknown> = {};
    if (updates.summary) eventPayload.summary = updates.summary;
    if (updates.description) eventPayload.description = updates.description;
    if (updates.start) eventPayload.start = { dateTime: updates.start, timeZone: 'UTC' };
    if (updates.end) eventPayload.end = { dateTime: updates.end, timeZone: 'UTC' };
    if (updates.attendees) {
      eventPayload.attendees = updates.attendees.map((email) => ({ email }));
    }

    await calendar.events.patch({
      calendarId: 'primary',
      eventId,
      requestBody: eventPayload,
      sendUpdates: 'all',
    });

    return true;
  } catch (error) {
    console.error('Error updating calendar event:', error);
    return false;
  }
}

export async function cancelCalendarEvent(userId: string, eventId: string): Promise<boolean> {
  try {
    const calendar = await getCalendarClient(userId);
    if (!calendar) return false;

    await calendar.events.delete({
      calendarId: 'primary',
      eventId,
      sendUpdates: 'all',
    });

    return true;
  } catch (error) {
    console.error('Error cancelling calendar event:', error);
    return false;
  }
}

// NOTE: deliberately no read/list helper here. The upcoming-interviews list is
// served from our own `interviews` table, so the only Google Calendar calls we
// make are insert/patch/delete on events this app created. That keeps the
// promise in our privacy policy — we never read the rest of a user's calendar —
// true by construction rather than by convention.
