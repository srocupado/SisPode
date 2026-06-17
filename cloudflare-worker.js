/**
 * SisPode CORS Proxy — Cloudflare Worker
 *
 * Endpoint: GET https://[seu-worker].workers.dev/?url=<URL_ENCODED>
 * Permite somente URLs cujo host termine em .camara.leg.br (defesa contra
 * abuso de open-proxy).
 *
 * Deploy:
 *   1. Em https://dash.cloudflare.com → Workers & Pages → Create → Worker
 *   2. Apague o conteúdo padrão e cole este arquivo
 *   3. Deploy. Anote a URL (ex.: https://sispode-proxy.<conta>.workers.dev)
 *   4. Cole essa URL no campo "Proxy CORS" da versão mobile, salve.
 *
 * Free tier: 100.000 requisições por dia (mais que suficiente).
 */

const ALLOWED_HOST_SUFFIX = '.camara.leg.br';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');
    if (!target) {
      return new Response('Parâmetro ?url= obrigatório', {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    let parsed;
    try { parsed = new URL(target); }
    catch { return text('URL inválida', 400); }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return text('Protocolo não permitido', 400);
    }
    if (!parsed.hostname.endsWith(ALLOWED_HOST_SUFFIX)) {
      return text('Domínio não permitido (somente *' + ALLOWED_HOST_SUFFIX + ')', 403);
    }

    const upstream = await fetch(parsed.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (SisPode-Proxy)',
        'Accept': request.headers.get('Accept') || '*/*',
      },
      redirect: 'follow',
    });

    const body = await upstream.arrayBuffer();
    const headers = new Headers(CORS_HEADERS);
    const ct = upstream.headers.get('Content-Type');
    if (ct) headers.set('Content-Type', ct);
    return new Response(body, { status: upstream.status, headers });
  },
};

function text(msg, status) {
  return new Response(msg, {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
