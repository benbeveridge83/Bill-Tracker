import { corsHeaders, getUser, json, plaidOptionalSettings, plaidPost } from '../_shared.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await getUser(req);
    const data = await plaidPost('/link/token/create', {
      user: { client_user_id: user.id },
      client_name: 'Bills & Budget',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
      ...plaidOptionalSettings()
    });
    return json({ link_token: data.link_token, expiration: data.expiration });
  } catch (e) {
    return json({ error: String(e.message || e) }, 400);
  }
});
