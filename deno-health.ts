Deno.serve((request) => {
  const url = new URL(request.url);

  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }

  if (url.pathname === "/" || url.pathname === "/health") {
    return new Response(JSON.stringify({
      ok: true,
      provider: "Deno Deploy",
      test: "cargo-reminder-direct-access",
      time: new Date().toISOString(),
    }), { headers });
  }

  return new Response(JSON.stringify({ ok: false, error: "Not found" }), {
    status: 404,
    headers,
  });
});
