// Классическая эра · выдача ролей в Discord-сервере проекта.
// Вызывается только из базы (триггер на v1_discord), по общему секрету.
// Секрет функции: DISCORD_BOT_TOKEN. Секрет вызова сверяется с Vault (discord_hook_secret).

const TOKEN = Deno.env.get('DISCORD_BOT_TOKEN') ?? '';
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ID = /^\d{5,25}$/;

async function discord(method: string, path: string): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`https://discord.com/api/v10${path}`, {
      method,
      headers: {
        Authorization: `Bot ${TOKEN}`,
        'User-Agent': 'DiscordBot (https://purpleglock.github.io/Classic-Era-1.0, 1.0)',
        'X-Audit-Log-Reason': encodeURIComponent('Классическая эра: привязка аккаунта на сайте'),
      },
    });
    if (r.status !== 429) return r;
    const j = await r.json().catch(() => ({}));
    await new Promise((ok) => setTimeout(ok, Math.min(5000, 1000 * Number(j.retry_after ?? 1))));
  }
  return new Response(null, { status: 429 });
}

async function fail(r: Response): Promise<string> {
  const j = await r.json().catch(() => ({}));
  if (j.code === 10007) return 'not_in_guild';
  if (j.code === 10011) return 'bad_role';
  if (j.code === 10004) return 'bad_guild';
  if (r.status === 401) return 'bad_token';
  if (r.status === 403) return 'no_permission';
  return `error_${r.status}`;
}

Deno.serve(async (req) => {
  const secret = req.headers.get('x-hook-secret') ?? '';
  const chk = secret && SB_URL && SB_KEY ? await fetch(`${SB_URL}/rest/v1/rpc/v1_discord_hook_check`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_secret: secret }),
  }).then((r) => r.json()).catch(() => false) : false;
  if (chk !== true) return new Response('forbidden', { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b || !ID.test(String(b.discord_id)) || !ID.test(String(b.guild))) return Response.json({ status: 'bad_request' }, { status: 400 });

  let status = 'ok';
  if (!TOKEN) status = 'no_token';
  else {
    const base = `/guilds/${b.guild}/members/${b.discord_id}/roles/`;
    if (b.add && ID.test(String(b.add))) {
      const r = await discord('PUT', base + b.add);
      if (!r.ok) status = await fail(r);
    }
    if (status === 'ok' && b.remove && ID.test(String(b.remove))) {
      const r = await discord('DELETE', base + b.remove);
      if (!r.ok) status = await fail(r);
    }
  }

  if (b.linked && b.user_id && SB_URL && SB_KEY) {
    await fetch(`${SB_URL}/rest/v1/v1_discord?user_id=eq.${encodeURIComponent(b.user_id)}`, {
      method: 'PATCH',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ role_status: status, role_at: new Date().toISOString() }),
    }).catch(() => {});
  }
  return Response.json({ status });
});
