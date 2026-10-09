import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let client: typeof import('../src/api');
const fetchMock = vi.fn<typeof fetch>();
const expiry = vi.fn();
const json = (status: number) =>
  new Response(JSON.stringify(status === 401 ? { error: 'Unauthorized' } : { id: 'user' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
beforeEach(async () => {
  vi.resetModules();
  fetchMock.mockReset();
  expiry.mockClear();
  const events = new EventTarget();
  events.addEventListener('session-expired', expiry);
  vi.stubGlobal('window', events);
  vi.stubGlobal('fetch', fetchMock);
  client = await import('../src/api');
});
afterEach(() => vi.unstubAllGlobals());
describe('client session failures', () => {
  it('dispatches only one expiry event for concurrent unauthorized requests', async () => {
    fetchMock.mockImplementation(async () => json(401));
    const results = await Promise.allSettled([
      client.api('/company'),
      client.api('/dashboard'),
      client.api('/products'),
    ]);
    expect(expiry).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected')
        expect(result.reason).toBeInstanceOf(client.SessionExpiredError);
    }
  });
  it('does not classify invalid credentials or a blocked cookie check as expiry', async () => {
    fetchMock.mockImplementation(async () => json(401));
    await expect(client.api('/auth/login', 'POST', {})).rejects.toMatchObject({ status: 401 });
    await expect(client.api('/auth/me')).rejects.toBeInstanceOf(client.ApiError);
    expect(expiry).not.toHaveBeenCalled();
  });
  it('allows a new expiry notification after a new successful login', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401))
      .mockResolvedValueOnce(json(200))
      .mockResolvedValueOnce(json(401));
    await expect(client.api('/company')).rejects.toThrow();
    await client.api('/auth/login', 'POST', {});
    await expect(client.api('/company')).rejects.toThrow();
    expect(expiry).toHaveBeenCalledTimes(2);
  });
  it('ignores a late 401 from the previous login generation', async () => {
    let reply: (value: Response) => void = () => {
      throw new Error('Request not started');
    };
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          reply = resolve;
        }),
    );
    const previous = client.api('/company').catch((error) => error);
    fetchMock.mockResolvedValueOnce(json(200));
    await client.api('/auth/login', 'POST', {});
    reply(json(401));
    await previous;
    expect(expiry).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(json(401));
    await expect(client.api('/company')).rejects.toThrow();
    expect(expiry).toHaveBeenCalledTimes(1);
  });
  it('suppresses late unauthorized replies after an explicit logout', async () => {
    fetchMock.mockResolvedValueOnce(json(200)).mockResolvedValueOnce(json(401));
    await client.api('/auth/logout', 'POST');
    await expect(client.api('/company')).rejects.toThrow();
    expect(expiry).not.toHaveBeenCalled();
  });
  it('keeps cookie credentials, CSRF and idempotency headers on API requests', async () => {
    fetchMock.mockResolvedValueOnce(json(200));
    await client.api('/documents/id/payments', 'POST', { amount: 100 }, 'request-id');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/documents/id/payments',
      expect.objectContaining({
        credentials: 'same-origin',
        headers: expect.objectContaining({
          'X-Orqiva-Request': '1',
          'Idempotency-Key': 'request-id',
        }),
      }),
    );
  });
});
