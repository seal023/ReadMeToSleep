/**
 * Supabase Edge Function — bailian-proxy
 * ===========================================================================
 * 作用：把「百炼（DashScope）请求」从客户端挪到服务端，Key 只存在函数环境变量里，
 *      从此不进 IPA / APK 包。客户端只带自己的 Supabase JWT。
 *
 * 客户端契约（见 services/cloudFetch.ts）：
 *   POST {FUNCTIONS_URL}/bailian-proxy?u=<encodeURIComponent(上游完整URL)>
 *   Authorization: Bearer <supabase access_token>
 *   body / content-type 原样透传（JSON、multipart 录音上传都支持）
 *
 * 安全措施：
 *   1. 必须登录：用 JWT 调 auth.getUser() 校验，未登录 401；
 *   2. SSRF 白名单：只允许转发到 dashscope.aliyuncs.com 与 *.maas.aliyuncs.com，且必须 https；
 *   3. 不把上游响应头原样回传：只透出 content-type，避免泄露服务端信息。
 *
 * 部署（三种方式任选）：
 *   A. 仪表盘：Supabase Dashboard → Edge Functions → New function → 名字填 bailian-proxy
 *      → 粘贴本文件 → Deploy → Settings 里加 Secret：DASHSCOPE_API_KEY
 *   B. CLI： supabase functions deploy bailian-proxy --project-ref <ref>
 *           supabase secrets set DASHSCOPE_API_KEY=sk-xxxx --project-ref <ref>
 *   C. 本地： supabase start && supabase functions serve bailian-proxy
 *
 * 部署完成后：
 *   1. 在 Xcode Cloud 环境变量里加 EXPO_PUBLIC_AI_PROXY_URL=https://<ref>.functions.supabase.co/bailian-proxy
 *   2. 确认生成故事 / 语音克隆都正常后，**删除** EXPO_PUBLIC_AI_API_KEY —— Key 从此不在包里
 *   3. 建议同时在阿里云控制台给这把 Key 设「按天额度上限」，作为最后一道保险
 */

const ALLOWED_HOSTS = [
  /(^|\.)dashscope\.aliyuncs\.com$/i,
  /(^|\.)maas\.aliyuncs\.com$/i,
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  const upstream = url.searchParams.get('u');
  if (!upstream) return json({ error: 'missing_upstream' }, 400);

  let target: URL;
  try {
    target = new URL(upstream);
  } catch {
    return json({ error: 'bad_upstream' }, 400);
  }
  if (target.protocol !== 'https:') return json({ error: 'https_required' }, 403);
  if (!ALLOWED_HOSTS.some((re) => re.test(target.hostname))) {
    return json({ error: 'host_not_allowed', host: target.hostname }, 403);
  }

  // ---- 1. 校验用户身份 ----
  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'not_authenticated' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  let userId = '';
  try {
    const meRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey },
    });
    if (!meRes.ok) return json({ error: 'invalid_token' }, 401);
    const me = await meRes.json();
    userId = me?.id || '';
    if (!userId) return json({ error: 'invalid_token' }, 401);
  } catch {
    return json({ error: 'auth_check_failed' }, 401);
  }

  // ---- 2. 转发到上游（Key 只在服务端出现）----
  const apiKey = Deno.env.get('DASHSCOPE_API_KEY');
  if (!apiKey) return json({ error: 'server_key_missing' }, 500);

  const headers = new Headers();
  const contentType = req.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  headers.set('authorization', `Bearer ${apiKey}`);

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const body = hasBody ? await req.arrayBuffer() : undefined;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(target.toString(), {
      method: req.method,
      headers,
      body,
    });
  } catch (err) {
    console.error('[bailian-proxy] upstream failed', { userId, host: target.hostname, err: String(err) });
    return json({ error: 'upstream_unreachable' }, 502);
  }

  // 只透出 content-type，别把上游的头原样泄给客户端
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: {
      ...CORS,
      'content-type': upstreamRes.headers.get('content-type') || 'application/json',
      'x-proxy-user': userId.slice(0, 8),
    },
  });
});
