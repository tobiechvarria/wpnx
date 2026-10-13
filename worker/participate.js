// The participate form's backend. Before, the form posted straight to a
// FormSubmit address that sat in the page's HTML, so bots posted to it
// directly and every one became an email. Now the form posts here: the
// Worker checks a Cloudflare Turnstile token (bots can't get one), the
// honeypot and the fields, and only then emails the station through
// Cloudflare Email Routing. Everything that touches the network is passed in,
// so this file is plain logic that tests can run.

export const INTERESTS = {
  volunteer: 'Volunteering',
  show: 'Proposing a show',
  listen: 'Listener updates only',
};

const MAX = { name: 100, email: 254, message: 4000 };
const EMAIL = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[a-z]{2,}$/i;
const LINE_BREAK = /[\r\n]/;

/** Checks the visitor's fields. One-line fields may not contain line breaks, which could inject email headers. */
export function validateSubmission(fields) {
  const name = String(fields.name ?? '').trim();
  const email = String(fields.email ?? '').trim();
  const interest = String(fields.interest ?? '');
  const message = String(fields.message ?? '').trim();
  const errors = [];
  if (!name) errors.push('Name is required.');
  else if (name.length > MAX.name || LINE_BREAK.test(name)) errors.push('Name is too long or has line breaks.');
  if (!EMAIL.test(email) || email.length > MAX.email || LINE_BREAK.test(email)) errors.push('Enter a valid email address.');
  if (!Object.hasOwn(INTERESTS, interest)) errors.push('Choose what you are interested in.');
  if (message.length > MAX.message) errors.push(`Message is too long (${MAX.message} characters at most).`);
  return errors.length ? { ok: false, errors } : { ok: true, data: { name, email, interest, message } };
}

/** Asks Cloudflare whether a Turnstile token is genuine. Anything other than a clear yes is a no. */
export async function verifyTurnstile(token, secret, ip, fetchFn) {
  if (!token || !secret) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const json = await res.json();
    return json?.success === true;
  } catch {
    return false;
  }
}

function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A display name for an email header: quoted if plain ASCII, RFC 2047 encoded otherwise. */
function displayName(name) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(name)) return `"${name.replace(/["\\]/g, '\\$&')}"`;
  return `=?UTF-8?B?${base64Utf8(name)}?=`;
}

/** The raw email (RFC 5322) for one entry: plain text, UTF-8, base64 so any language survives. */
export function buildEmail(data, { from, to, date, messageId }) {
  const label = INTERESTS[data.interest];
  const text = [
    'New entry from the participate form on wpnx.org.',
    '',
    `Name: ${data.name}`,
    `Email: ${data.email}`,
    `Interested in: ${label}`,
    '',
    'Message:',
    data.message || '(none)',
    '',
    'Reply to this email to answer them directly.',
  ].join('\r\n');
  const body = base64Utf8(text).replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: "WPNX website" <${from}>`,
    `To: ${to}`,
    `Reply-To: ${displayName(data.name)} <${data.email}>`,
    `Subject: New participate form entry: ${label}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${messageId}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

const reply = (status, body) => Response.json(body, { status });

/**
 * POST /api/participate. `deps.send({ from, to, raw })` delivers the email; `deps.fetch` reaches Turnstile.
 * A filled honeypot gets a normal-looking success so the bot learns nothing, but nothing is sent.
 */
export async function handleParticipate(request, env, deps) {
  if (request.method !== 'POST') return reply(405, { success: false, error: 'Use POST.' });
  let form;
  try {
    form = await request.formData();
  } catch {
    return reply(400, { success: false, error: 'Could not read the form.' });
  }
  if (String(form.get('_honey') ?? '').trim()) return reply(200, { success: true });
  if (!env.TURNSTILE_SECRET_KEY || !env.FORM_TO || !env.FORM_FROM) {
    return reply(500, { success: false, error: 'The form is not set up yet.' });
  }

  const verified = await verifyTurnstile(
    String(form.get('cf-turnstile-response') ?? ''),
    env.TURNSTILE_SECRET_KEY,
    request.headers.get('CF-Connecting-IP'),
    deps.fetch,
  );
  if (!verified) return reply(403, { success: false, error: 'The verification check failed. Please try again.' });

  const checked = validateSubmission(Object.fromEntries(form));
  if (!checked.ok) return reply(400, { success: false, errors: checked.errors });

  const raw = buildEmail(checked.data, {
    from: env.FORM_FROM,
    to: env.FORM_TO,
    date: deps.now(),
    messageId: `${deps.id()}@wpnx.org`,
  });
  try {
    await deps.send({ from: env.FORM_FROM, to: env.FORM_TO, raw });
  } catch {
    return reply(502, { success: false, error: 'Could not send right now.' });
  }
  return reply(200, { success: true });
}
