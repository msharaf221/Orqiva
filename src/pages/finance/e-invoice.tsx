import { useState } from 'react';
import { RefreshCw, Send, RotateCcw, FileJson } from 'lucide-react';
import { api, useData, useAction, Button, Loading, ErrorState, Empty, money } from '../../lib';
import type { EInvoiceSubmission } from '../../types';

const STATUS_LABELS: Record<EInvoiceSubmission['status'], string> = {
  PENDING: 'بانتظار الإرسال',
  SUBMITTED: 'تم الإرسال',
  VALID: 'مقبولة',
  INVALID: 'مرفوضة',
  FAILED: 'فشلت',
  CANCELLED: 'ملغاة',
};

const DOC_TYPE_LABELS: Record<EInvoiceSubmission['document_type'], string> = {
  INVOICE: 'فاتورة',
  CREDIT_NOTE: 'إشعار دائن',
  DEBIT_NOTE: 'إشعار مدين',
};

function statusTone(status: EInvoiceSubmission['status']): string {
  if (status === 'VALID') return 'paid';
  if (status === 'FAILED' || status === 'INVALID') return 'overdue';
  if (status === 'PENDING' || status === 'SUBMITTED') return 'pending';
  return 'cancelled';
}
/**
 * Egyptian Tax Authority (ETA) e-invoicing panel.
 *
 * Shows the submission outbox and lets an authorised user drain the queue on demand or
 * retry a permanently-failed submission. Until ETA sandbox credentials are configured the
 * pipeline runs in stub mode and validates payloads locally.
 */
export function EInvoicePanel() {
  const submissions = useData<EInvoiceSubmission[]>('/eta/submissions');
  const status = useData<{ configured: boolean; summary: Record<string, number> }>('/eta/status');
  const [payload, setPayload] = useState<{ doc: EInvoiceSubmission; json: unknown } | null>(null);
  const { busy, act } = useAction();

  const refresh = () => {
    submissions.reload();
    status.reload();
  };

  const process = () =>
    void act(async () => {
      await api('/eta/process', 'POST', {});
      refresh();
    }, 'تمت معالجة الإرسالات المستحقة');

  const retry = (id: string) =>
    void act(async () => {
      await api(`/eta/submissions/${id}/retry`, 'POST', {});
      await api('/eta/process', 'POST', {});
      refresh();
    }, 'تمت إعادة المحاولة');

  const viewPayload = (doc: EInvoiceSubmission) =>
    void act(async () => {
      const json = await api<unknown>(`/eta/documents/${doc.document_id}/payload`);
      setPayload({ doc, json });
    });

  const rows = submissions.data || [];
  const configured = status.data?.configured ?? false;

  return (
    <section className="card settings-card">
      <div className="card-heading">
        <div>
          <h2>الفاتورة الإلكترونية (هيئة الضرائب)</h2>
          <p>
            {configured
              ? 'مفاتيح الإرسال مُهيّأة. تتم مزامنة الفواتير المعتمدة مع بوابة الضرائب.'
              : 'النظام يعمل في الوضع التجريبي: تُبنى الحمولة ويُتحقق منها محلياً دون إرسال فعلي حتى تركيب مفاتيح sandbox.'}
          </p>
        </div>
        <Button variant="secondary" busy={busy} onClick={process}>
          <Send size={16} /> معالجة المستحق الآن
        </Button>
      </div>

      {status.data && (
        <div className="eta-summary-row">
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <span key={key} className="category-tag">
              {label}: {status.data?.summary[key] ?? 0}
            </span>
          ))}
        </div>
      )}

      {submissions.loading ? (
        <Loading />
      ) : submissions.error ? (
        <ErrorState message={submissions.error} retry={submissions.reload} />
      ) : !rows.length ? (
        <Empty
          title="لا توجد فواتير إلكترونية بعد"
          description="تُضاف تلقائياً عند اعتماد فاتورة بيع."
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>الفاتورة</th>
                <th>العميل</th>
                <th>النوع</th>
                <th>القيمة</th>
                <th>الحالة</th>
                <th>المحاولات</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td dir="ltr">{s.document_number}</td>
                  <td>{s.party_name}</td>
                  <td>{DOC_TYPE_LABELS[s.document_type]}</td>
                  <td>{money(s.document_total ?? 0)} ج.م</td>
                  <td>
                    <span className={'badge ' + statusTone(s.status)}>
                      <i />
                      {STATUS_LABELS[s.status]}
                    </span>
                  </td>
                  <td className="muted">
                    {s.attempt}/{s.max_attempts}
                    {s.last_error ? <div className="muted small">{s.last_error}</div> : null}
                  </td>
                  <td>
                    <div className="row-actions">
                      <Button
                        variant="secondary"
                        onClick={() => viewPayload(s)}
                        aria-label="عرض حمولة UBL"
                      >
                        <FileJson size={15} />
                      </Button>
                      {(s.status === 'FAILED' || s.status === 'PENDING') && (
                        <Button variant="secondary" onClick={() => retry(s.id)} aria-label="إعادة">
                          <RotateCcw size={15} />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="table-footer">
            <Button variant="secondary" onClick={refresh} busy={submissions.loading}>
              <RefreshCw size={15} /> تحديث
            </Button>
          </div>
        </div>
      )}

      {payload && (
        <div className="eta-payload">
          <h3>حمولة UBL 2.1 — {payload.doc.document_number}</h3>
          <pre dir="ltr">{JSON.stringify(payload.json, null, 2)}</pre>
          <Button variant="secondary" onClick={() => setPayload(null)}>
            إغلاق
          </Button>
        </div>
      )}
    </section>
  );
}
