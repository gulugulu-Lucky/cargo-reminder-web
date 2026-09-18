const UPSTREAM = "https://cargo-reminder-pwa.k995680983-3fb.workers.dev";

export default async (request, context) => {
  const incoming = new URL(request.url);
  const prefix = "/api/";
  const idx = incoming.pathname.indexOf(prefix);
  const apiPath = idx >= 0 ? incoming.pathname.slice(idx) : "/api/health";
  const upstreamUrl = new URL(apiPath + incoming.search, UPSTREAM);

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (!["GET", "HEAD"].includes(request.method)) {
    init.body = await request.arrayBuffer();
  }

  try {
    const response = await fetch(upstreamUrl, init);
    const outHeaders = new Headers();
    const responseType = response.headers.get("content-type");
    if (responseType) outHeaders.set("content-type", responseType);
    outHeaders.set("cache-control", "no-store");

    return new Response(response.body, {
      status: response.status,
      headers: outHeaders,
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: "Netlify proxy could not reach Cloudflare",
      detail: error?.message || String(error),
    }, { status: 502 });
  }
};
