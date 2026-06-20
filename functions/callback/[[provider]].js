// Cloudflare Pages Function — step 2 of Decap CMS's GitHub OAuth handshake.
// GitHub redirects here with a ?code=, we exchange it for an access token,
// then hand the token back to the Decap admin UI via postMessage
// (this exact protocol is what decap-cms-app listens for in its popup).
export async function onRequestGet({ request, env, params }) {
  const provider = params.provider?.[0] || "github";
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return htmlResponse(renderScript(provider, "error", { message: "Missing code" }));
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const data = await tokenRes.json();

  if (data.error || !data.access_token) {
    return htmlResponse(renderScript(provider, "error", data));
  }

  return htmlResponse(renderScript(provider, "success", { token: data.access_token }));
}

function renderScript(provider, status, payload) {
  const message = `authorization:${provider}:${status}:${JSON.stringify(payload)}`;
  return `<!doctype html>
<script>
(function () {
  function receiveMessage(e) {
    window.opener.postMessage(${JSON.stringify(message)}, e.origin);
  }
  window.addEventListener("message", receiveMessage, false);
  window.opener.postMessage("authorizing:${provider}", "*");
})();
</script>`;
}

function htmlResponse(html) {
  return new Response(html, { headers: { "content-type": "text/html" } });
}
