import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { header, seedUsers, signIn, resetBusinessData } from './helpers';
import { one, run, now } from '../server/db';
import { enqueueEtaSubmission, processPendingSubmissionsAsync, etaConfigured } from '../server/eta';
import { setEtaHttp, setEtaSigner } from '../server/eta_client';

type Call = { url: string; body: string; headers: Record<string, string> };

describe('ETA real transport (mocked HTTP)', () => {
  let calls: Call[];
  let submitStatus = 200;
  let submitBody: unknown;
  let docId: string;

  beforeEach(async () => {
    resetBusinessData();
    run('DELETE FROM user_branches');
    run('DELETE FROM users');
    await seedUsers();
    run(
      "UPDATE company SET tax_mode='VAT', eta_enabled=1, eta_environment='preprod', tax_rate=1400, tax_number='100', tax_registration_number='100', activity_code='4690' WHERE id=1",
    );
    run(
      'INSERT OR REPLACE INTO parties VALUES(?,?,?,?,?,?,?,?,?,?)',
      'customer',
      'CUSTOMER',
      'عميل',
      '',
      '',
      '',
      '',
      '',
      1,
      now(),
    );
    run(
      'INSERT OR REPLACE INTO products VALUES(?,?,?,?,?,?,?,?,?,?)',
      'product',
      'SKU-01',
      'منتج',
      'عام',
      'قطعة',
      10000,
      6000,
      3,
      1,
      now(),
    );
    run(
      "INSERT OR IGNORE INTO branch_products(branch_id,product_id,active) VALUES('main','product',1)",
    );
    const admin = await signIn('admin@test.local');
    const res = await admin
      .post('/api/documents')
      .set(header)
      .send({
        type: 'SALE',
        branch_id: 'main',
        party_id: 'customer',
        date: '2026-10-01',
        due_date: '2026-10-15',
        discount: 0,
        tax_rate: 1400,
        notes: '',
        lines: [{ product_id: 'product', quantity: 1, unit_price: 10000 }],
      })
      .expect(201);
    docId = res.body.id;
    enqueueEtaSubmission(docId);
    process.env.ETA_CLIENT_ID = 'cid';
    process.env.ETA_CLIENT_SECRET = 'secret';
    calls = [];
    submitStatus = 200;
    submitBody = undefined;
    setEtaSigner(async () => [{ signatureType: 'I', value: 'SIG' }]);
    setEtaHttp(async (url, init) => {
      calls.push({ url, body: init.body, headers: init.headers });
      if (url.endsWith('/connect/token'))
        return {
          status: 200,
          text: async () => JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
        };
      return { status: submitStatus, text: async () => JSON.stringify(submitBody ?? {}) };
    });
  });
  afterEach(() => {
    delete process.env.ETA_CLIENT_ID;
    delete process.env.ETA_CLIENT_SECRET;
    setEtaSigner(null);
    setEtaHttp(null);
  });

  const submission = () =>
    one<{ status: string; attempt: number; last_error: string; eta_long_id: string }>(
      'SELECT * FROM e_invoice_submissions WHERE document_id=?',
      docId,
    )!;

  it('is real only with credentials and a non-stub environment', () => {
    expect(etaConfigured()).toBe(true);
    run("UPDATE company SET eta_environment='stub' WHERE id=1");
    expect(etaConfigured()).toBe(false);
  });

  it('gets a token, posts a signed document and records the accepted long id', async () => {
    const uuid = one<{ uuid: string }>('SELECT uuid FROM e_invoice_submissions')!.uuid;
    submitBody = { acceptedDocuments: [{ uuid, longId: 'LONG123' }], rejectedDocuments: [] };
    expect(await processPendingSubmissionsAsync()).toEqual({ processed: 1, succeeded: 1 });
    expect(calls[0].url).toBe('https://id.preprod.eta.gov.eg/connect/token');
    expect(calls[1].url).toBe(
      'https://api.preprod.invoicing.eta.gov.eg/api/v1/documentsubmissions',
    );
    expect(calls[1].headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[1].body).documents[0].signatures[0].value).toBe('SIG');
    expect(submission()).toMatchObject({ status: 'VALID', eta_long_id: 'LONG123' });
  });

  it('retries transient failures and keeps the submission pending', async () => {
    submitStatus = 503;
    await processPendingSubmissionsAsync();
    expect(submission()).toMatchObject({ status: 'PENDING', attempt: 1 });
    expect(submission().last_error).toContain('503');
  });

  it('fails permanently when ETA rejects the document', async () => {
    submitBody = { acceptedDocuments: [], rejectedDocuments: [{ error: { message: 'bad' } }] };
    await processPendingSubmissionsAsync();
    expect(submission().status).toBe('FAILED');
    expect(submission().last_error).toContain('رفضت');
  });

  it('refuses to submit without a registered signer', async () => {
    setEtaSigner(null);
    await processPendingSubmissionsAsync();
    expect(submission().status).toBe('FAILED');
    expect(calls).toHaveLength(0);
    expect(submission().last_error).toContain('التوقيع');
  });

  it('uses the production hosts when the company is in production', async () => {
    run("UPDATE company SET eta_environment='production' WHERE id=1");
    submitBody = { acceptedDocuments: [{ uuid: 'x', longId: 'L' }] };
    await processPendingSubmissionsAsync();
    expect(calls[0].url).toBe('https://id.eta.gov.eg/connect/token');
  });

  it('never sends one invoice twice when runs overlap', async () => {
    const uuid = one<{ uuid: string }>('SELECT uuid FROM e_invoice_submissions')!.uuid;
    submitBody = { acceptedDocuments: [{ uuid, longId: 'LONGX' }] };
    const [a, b] = await Promise.all([
      processPendingSubmissionsAsync(),
      processPendingSubmissionsAsync(),
    ]);
    expect(a.processed + b.processed).toBe(1);
    expect(calls.filter((c) => c.url.includes('documentsubmissions'))).toHaveLength(1);
    expect(submission().status).toBe('VALID');
  });

  it('does not downgrade an accepted invoice on a late failure', async () => {
    setEtaHttp(async (url) => {
      if (url.endsWith('/connect/token'))
        return { status: 200, text: async () => JSON.stringify({ access_token: 't' }) };
      // Another run accepted the invoice while this request was in flight.
      run("UPDATE e_invoice_submissions SET status='VALID' WHERE document_id=?", docId);
      return { status: 400, text: async () => '{}' };
    });
    await processPendingSubmissionsAsync();
    expect(submission().status).toBe('VALID');
  });

  it('marks a duplicate rejection as needing a manual check, not a blind retry', async () => {
    submitBody = { rejectedDocuments: [{ error: { code: 'Duplicate', message: 'duplicated' } }] };
    await processPendingSubmissionsAsync();
    expect(submission().status).toBe('FAILED');
    expect(submission().last_error).toContain('راجع حالتها');
  });
});
