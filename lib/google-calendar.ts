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

export async function getAuthUrl(userId: string, companyId: string, redirectUri?: string) {
  const oauth2Client = getOAuth2Client(redirectUri);
  const scopes = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    state: JSON.stringify({ userId, companyId }),
    prompt: 'consent' // Force refresh token
  });
}

export async function handleOAuthCallback(code: string, state: string, redirectUri?: string) {
  const oauth2Client = getOAuth2Client(redirectUri);
  const { userId, companyId } = JSON.parse(state) as { userId: string; companyId: string };

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  const supabase = createAdminClient();
  await supabase.from('integration_tokens').upsert({
    company_id: companyId,
    user_id: userId,
    provider: 'google',
    access_token: tokens.access_token!,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    scope: ['calendar.events', 'calendar.readonly'],
  });

  return tokens;
}

export async function createCalendarEvent(
  userId: string,
  event: CalendarEvent
): Promise<{ eventId: string; meetLink?: string } | null> {
  try {
    const supabase = createAdminClient();
    const oauth2Client = getOAuth2Client();

    const { data: tokenData } = await supabase
      .from('integration_tokens')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .single();

    if (!tokenData) {
      throw new Error('No Google integration found');
    }

    if (tokenData.expires_at && new Date(tokenData.expires_at) < new Date()) {
      oauth2Client.setCredentials({ refresh_token: tokenData.refresh_token });
      const { credentials } = await oauth2Client.refreshAccessToken();

      await supabase
        .from('integration_tokens')
        .update({
          access_token: credentials.access_token!,
          expires_at: credentials.expiry_date
            ? new Date(credentials.expiry_date).toISOString()
            : null,
        })
        .eq('id', tokenData.id);

      oauth2Client.setCredentials(credentials);
    } else {
      oauth2Client.setCredentials({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
      });
    }

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

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
    const supabase = createAdminClient();
    const oauth2Client = getOAuth2Client();

    const { data: tokenData } = await supabase
      .from('integration_tokens')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .single();

    if (!tokenData) return false;

    oauth2Client.setCredentials({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

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
    const supabase = createAdminClient();
    const oauth2Client = getOAuth2Client();

    const { data: tokenData } = await supabase
      .from('integration_tokens')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .single();

    if (!tokenData) return false;

    oauth2Client.setCredentials({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

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

export async function getUpcomingInterviews(userId: string, days = 7) {
  try {
    const supabase = createAdminClient();
    const oauth2Client = getOAuth2Client();

    const { data: tokenData } = await supabase
      .from('integration_tokens')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .single();

    if (!tokenData) return [];

    oauth2Client.setCredentials({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const now = new Date();
    const future = new Date();
    future.setDate(future.getDate() + days);

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    return response.data.items ?? [];
  } catch (error) {
    console.error('Error fetching interviews:', error);
    return [];
  }
}
