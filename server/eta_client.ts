/**
 * HTTP transport for the Egyptian Tax Authority (ETA) invoicing API.
 *
 * Flow: client-credentials token from the identity service, then POST the signed
 * document batch to `/api/v1/documentsubmissions`. The ETA answers per document with
 * accepted (uuid + longId) or rejected (error details). Network failures and 5xx/429
 * answers are transient (the outbox retries with backoff); other 4xx answers and
 * rejected documents are permanent.
 *
 * This code is written against the public ETA integration guide and tested against a
 * mocked transport only. It has NOT been run against the real ETA preprod, which needs
 * the taxpayer's registered ERP credentials. Run a preprod pass before going live.
 *
 * ETA requires every document to carry a CAdES-BES digital signature made with the
 * taxpayer's certificate (usually on a USB token). Orqiva does not hold that key, so a
 * signer must be registered with `setEtaSigner` (for example a call to a local signing
 * service). Without one, real submission is refused with a clear error.
 */
import type { EtaInvoiceJson } from './eta';

export type EtaEnv = 'preprod' | 'production';

export interface EtaSignature {
  signatureType: 'I';
  value: string;
}
export type EtaSigner = (invoice: EtaInvoiceJson) => Promise<EtaSignature[]>;

export interface EtaHttp {
  (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ): Promise<{
    status: number;
    text: () => Promise<string>;
  }>;
}

export class EtaTransientError extends Error {}
export class EtaPermanentError extends Error {}

const URLS: Record<EtaEnv, { id: string; api: string }> = {
  preprod: {
    id: 'https://id.preprod.eta.gov.eg',
    api: 'https://api.preprod.invoicing.eta.gov.eg',
  },
  production: { id: 'https://id.eta.gov.eg', api: 'https://api.invoicing.eta.gov.eg' },
};

let signer: EtaSigner | null = null;
let http: EtaHttp = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  return { status: res.status, text: () => res.text() };
};
const tokens = new Map<string, { token: string; expiresAt: number }>();

export function setEtaSigner(s: EtaSigner | null): void {
  signer = s;
}
/** Test hook: replace the HTTP layer. Pass null to restore the real one. */
export function setEtaHttp(h: EtaHttp | null): void {
  tokens.clear();
  http =
    h ??
    (async (url, init) => {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
      return { status: res.status, text: () => res.text() };
    });
}

function classify(status: number, body: string): Error {
  const msg = `ETA ${status}: ${body.slice(0, 300)}`;
  return status === 429 || status >= 500 ? new EtaTransientError(msg) : new EtaPermanentError(msg);
}

async function call(url: string, init: Parameters<EtaHttp>[1]) {
  try {
    return await http(url, init);
  } catch (e) {
    throw new EtaTransientError(`تعذر الاتصال بهيئة الضرائب: ${(e as Error).message}`);
  }
}

async function token(env: EtaEnv, clientId: string, clientSecret: string): Promise<string> {
  const key = `${env}:${clientId}`;
  const cached = tokens.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const res = await call(`${URLS[env].id}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'InvoicingAPI',
    }).toString(),
  });
  const text = await res.text();
  if (res.status !== 200) {
    // A bad client id/secret is permanent for this attempt but fixable by the user.
    throw classify(res.status, text);
  }
  const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new EtaPermanentError('رد غير متوقع من خدمة الهوية');
  tokens.set(key, {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  });
  return json.access_token;
}

export interface EtaSubmitResult {
  longId: string;
  response: string;
}

export async function submitToEta(
  env: EtaEnv,
  creds: { clientId: string; clientSecret: string },
  invoice: EtaInvoiceJson,
): Promise<EtaSubmitResult> {
  if (!signer) {
    throw new EtaPermanentError(
      'التوقيع الرقمي غير مُعدّ: هيئة الضرائب تشترط توقيع كل فاتورة بشهادة المُمول',
    );
  }
  const signatures = await signer(invoice);
  const doc = { ...invoice, signatures };
  const jwt = await token(env, creds.clientId, creds.clientSecret);
  const res = await call(`${URLS[env].api}/api/v1/documentsubmissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ documents: [doc] }),
  });
  const text = await res.text();
  if (res.status === 401) tokens.clear();
  if (res.status !== 200 && res.status !== 202)
    throw classify(res.status === 401 ? 503 : res.status, text);
  const json = JSON.parse(text) as {
    acceptedDocuments?: Array<{ uuid: string; longId: string }>;
    rejectedDocuments?: Array<{ uuid?: string; error?: unknown }>;
  };
  const accepted =
    json.acceptedDocuments?.find((d) => d.uuid === invoice.uuid) ?? json.acceptedDocuments?.[0];
  if (accepted) return { longId: accepted.longId, response: text };
  if (json.rejectedDocuments?.length) {
    const detail = JSON.stringify(json.rejectedDocuments[0].error ?? {});
    if (/duplicate/i.test(detail)) {
      // The invoice may already be accepted (for example after a timeout). Never retry blindly.
      throw new EtaPermanentError(
        'ETA يفيد بأن الفاتورة مرسلة من قبل: راجع حالتها في بوابة الهيئة قبل إعادة المحاولة',
      );
    }
    throw new EtaPermanentError(
      `رفضت هيئة الضرائب الفاتورة: ${JSON.stringify(json.rejectedDocuments[0].error ?? {}).slice(0, 400)}`,
    );
  }
  throw new EtaTransientError('رد غير مفهوم من هيئة الضرائب');
}
