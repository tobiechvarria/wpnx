// Cloudflare Pages Function — step 1 of Decap CMS's GitHub OAuth handshake.
// Redirects the editor to GitHub's authorize screen.
// Requires env vars (set in Cloudflare Pages → Settings → Environment Variables):
//   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  const provider = params.provider?.[0] || url.searchParams.get("provider");
  if (provider !== "github") {
    return new Response("Unsupported provider", { status: 400 });
  }
  if (!env.GITHUB_CLIENT_ID) {
    return new Response("Missing GITHUB_CLIENT_ID env var", { status: 500 });
  }

  const redirectUri = `${url.origin}/callback/github`;
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "repo,user");

  return Response.redirect(authorizeUrl.toString(), 302);
}
