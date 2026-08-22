import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server secret: ${name}`);
  return value;
}

function namedKey(jsonName: string, legacyName: string) {
  const namedKeys = Deno.env.get(jsonName);
  if (namedKeys) {
    const parsed = JSON.parse(namedKeys);
    if (parsed.default) return parsed.default;
  }
  return requiredEnv(legacyName);
}

export async function getUser(req: Request) {
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) throw new Error('Not authenticated');
  const supabaseUrl = requiredEnv('SUPABASE_URL');
  const publishableKey = namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
  const client = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: authHeader } } });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('Not authenticated');
  return data.user;
}

export function serviceClient() {
  return createClient(
    requiredEnv('SUPABASE_URL'),
    namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export function plaidBaseUrl() {
  const env = Deno.env.get('PLAID_ENV') || 'sandbox';
  if (env === 'production') return 'https://production.plaid.com';
  if (env === 'development') return 'https://development.plaid.com';
  return 'https://sandbox.plaid.com';
}

export async function plaidPost(path: string, body: Record<string, unknown>) {
  const payload = {
    client_id: requiredEnv('PLAID_CLIENT_ID'),
    secret: requiredEnv('PLAID_SECRET'),
    ...body
  };
  const res = await fetch(`${plaidBaseUrl()}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data.error_code ? `${data.error_code}: ` : '';
    throw new Error(`${code}${data.error_message || `Plaid error ${res.status}`}`);
  }
  return data;
}

export function plaidOptionalSettings() {
  const settings: Record<string, string> = {};
  const redirectUri = Deno.env.get('PLAID_REDIRECT_URI');
  const webhook = Deno.env.get('PLAID_WEBHOOK_URL');
  if (redirectUri) settings.redirect_uri = redirectUri;
  if (webhook) settings.webhook = webhook;
  return settings;
}
