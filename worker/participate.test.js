import { describe, expect, it, vi } from 'vitest';
import { buildEmail, handleParticipate, validateSubmission, verifyTurnstile } from './participate.js';

const good = { name: 'Ada Lovelace', email: 'ada@example.org', interest: 'show', message: 'I have a jazz show idea.' };

describe('validateSubmission', () => {
  it('accepts a real entry and trims it', () => {
    expect(validateSubmission({ ...good, name: '  Ada Lovelace ' })).toEqual({ ok: true, data: good });
  });
  it('requires a name and a real-looking email', () => {
    expect(validateSubmission({ ...good, name: ' ' }).ok).toBe(false);
    for (const email of ['', 'nope', 'a@b', 'a b@c.org', 'a@b.c']) expect(validateSubmission({ ...good, email }).ok).toBe(false);
  });
  it('only accepts the form\'s own interest options', () => {
    expect(validateSubmission({ ...good, interest: 'casino' }).ok).toBe(false);
    expect(validateSubmission({ ...good, interest: undefined }).ok).toBe(false);
  });
  it('rejects line breaks in one-line fields (they could inject email headers)', () => {
    expect(validateSubmission({ ...good, name: 'Ada\r\nBcc: x@y.org' }).ok).toBe(false);
    expect(validateSubmission({ ...good, email: 'ada@example.org\nBcc: x@y.org' }).ok).toBe(false);
  });
  it('limits field lengths', () => {
    expect(validateSubmission({ ...good, name: 'x'.repeat(101) }).ok).toBe(false);
    expect(validateSubmission({ ...good, message: 'x'.repeat(4001) }).ok).toBe(false);
  });
  it('allows an empty message', () => {
    expect(validateSubmission({ ...good, message: '' }).ok).toBe(true);
  });
});

describe('verifyTurnstile', () => {
  it('asks Cloudflare whether the token is valid', async () => {
    const fetchFn = vi.fn(async () => Response.json({ success: true }));
    expect(await verifyTurnstile('tok', 'sec', '1.2.3.4', fetchFn)).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({ secret: 'sec', response: 'tok', remoteip: '1.2.3.4' });
  });
  it('fails closed: no token, a rejected token, or Cloudflare unreachable', async () => {
    expect(await verifyTurnstile('', 'sec', null, vi.fn())).toBe(false);
    expect(await verifyTurnstile('tok', 'sec', null, async () => Response.json({ success: false }))).toBe(false);
    expect(await verifyTurnstile('tok', 'sec', null, async () => { throw new Error('down'); })).toBe(false);
  });
});

describe('buildEmail', () => {
  const opts = { from: 'website@wpnx.org', to: 'inbox@example.com', date: new Date('2026-10-13T15:00:00Z'), messageId: 'abc@wpnx.org' };
  const decodeBody = (raw) => Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');

  it('addresses the station inbox and lets you reply straight to the visitor', () => {
    const raw = buildEmail(good, opts);
    expect(raw).toContain('From: "WPNX website" <website@wpnx.org>\r\n');
    expect(raw).toContain('To: inbox@example.com\r\n');
    expect(raw).toContain('Reply-To: "Ada Lovelace" <ada@example.org>\r\n');
    expect(raw).toContain('Subject: New participate form entry: Proposing a show\r\n');
    expect(raw).toContain('Message-ID: <abc@wpnx.org>\r\n');
    expect(raw).toContain('Date: Tue, 13 Oct 2026 15:00:00 GMT\r\n');
  });
  it('carries every field in the body, including non-English text', () => {
    const body = decodeBody(buildEmail({ ...good, name: 'José Ñúñez', message: 'Hola — gracias' }, opts));
    expect(body).toContain('Name: José Ñúñez');
    expect(body).toContain('Email: ada@example.org');
    expect(body).toContain('Interested in: Proposing a show');
    expect(body).toContain('Hola — gracias');
  });
  it('encodes a non-English name safely in the Reply-To header', () => {
    expect(buildEmail({ ...good, name: 'José' }, opts)).toMatch(/Reply-To: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <ada@example\.org>\r\n/);
  });
});

describe('handleParticipate', () => {
  const env = { TURNSTILE_SECRET_KEY: 'sec', FORM_TO: 'inbox@example.com', FORM_FROM: 'website@wpnx.org' };
  const form = (fields) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return new Request('https://wpnx.org/api/participate', { method: 'POST', body: f, headers: { 'CF-Connecting-IP': '1.2.3.4' } });
  };
  const deps = (over = {}) => ({
    fetch: vi.fn(async () => Response.json({ success: true })),
    send: vi.fn(async () => {}),
    now: () => new Date('2026-10-13T15:00:00Z'),
    id: () => 'abc',
    ...over,
  });

  it('sends one email for a real, verified entry', async () => {
    const d = deps();
    const res = await handleParticipate(form({ ...good, 'cf-turnstile-response': 'tok' }), env, d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.send.mock.calls[0][0]).toMatchObject({ from: 'website@wpnx.org', to: 'inbox@example.com' });
    expect(d.send.mock.calls[0][0].raw).toContain('Reply-To: "Ada Lovelace" <ada@example.org>');
  });

  it('drops a bot that filled the hidden field, without telling it', async () => {
    const d = deps();
    const res = await handleParticipate(form({ ...good, _honey: 'gotcha', 'cf-turnstile-response': 'tok' }), env, d);
    expect(await res.json()).toEqual({ success: true });
    expect(d.send).not.toHaveBeenCalled();
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('refuses an entry without a valid verification token', async () => {
    const d = deps({ fetch: vi.fn(async () => Response.json({ success: false })) });
    const res = await handleParticipate(form({ ...good, 'cf-turnstile-response': 'forged' }), env, d);
    expect(res.status).toBe(403);
    expect(d.send).not.toHaveBeenCalled();
    const none = deps();
    expect((await handleParticipate(form(good), env, none)).status).toBe(403);
    expect(none.send).not.toHaveBeenCalled();
  });

  it('refuses invalid fields after verification, listing what to fix', async () => {
    const d = deps();
    const res = await handleParticipate(form({ ...good, email: 'nope', 'cf-turnstile-response': 'tok' }), env, d);
    expect(res.status).toBe(400);
    expect((await res.json()).errors.length).toBeGreaterThan(0);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('fails closed when the secret key is not configured', async () => {
    const d = deps();
    const res = await handleParticipate(form({ ...good, 'cf-turnstile-response': 'tok' }), { ...env, TURNSTILE_SECRET_KEY: '' }, d);
    expect(res.status).toBe(500);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('reports a sending failure instead of pretending it worked', async () => {
    const d = deps({ send: vi.fn(async () => { throw new Error('smtp'); }) });
    const res = await handleParticipate(form({ ...good, 'cf-turnstile-response': 'tok' }), env, d);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ success: false });
  });

  it('only accepts POST', async () => {
    const res = await handleParticipate(new Request('https://wpnx.org/api/participate'), env, deps());
    expect(res.status).toBe(405);
  });
});
