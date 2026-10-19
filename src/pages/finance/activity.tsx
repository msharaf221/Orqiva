import { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import {
  useData,
  PageHeader,
  Button,
  SearchBox,
  Loading,
  ErrorState,
  Empty,
  Pagination,
  Initials,
  downloadCSV,
} from '../../lib';
import type { Audit } from '../../types';

export function ActivityPage() {
  const data = useData<Audit[]>('/audit');
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(1);
  useEffect(() => setPage(1), [query]);
  const items = (data.data || []).filter((a) =>
    (a.action + a.user_name + a.details).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        eyebrow="شفافية في كل خطوة"
        title="سجل النشاط"
        description="تتبّع من قام بالتغييرات ومتى. آخر ٥٠٠ عملية مسجلة في النظام."
        actions={
          <Button
            variant="secondary"
            onClick={() =>
              downloadCSV(
                'سجل-النشاط',
                ['المستخدم', 'العملية', 'التفاصيل', 'التاريخ'],
                items.map((a) => [a.user_name, a.action, a.details, a.created_at]),
              )
            }
          >
            <Download size={16} /> تصدير السجل
          </Button>
        }
      />
      <section className="card">
        <div className="table-toolbar">
          <h2>آخر العمليات</h2>
          <SearchBox value={query} onChange={setQuery} placeholder="بحث في النشاط..." />
        </div>
        {data.loading ? (
          <Loading />
        ) : data.error ? (
          <ErrorState message={data.error} retry={data.reload} />
        ) : !items.length ? (
          <Empty />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>المستخدم</th>
                    <th>العملية</th>
                    <th>التفاصيل</th>
                    <th>التاريخ والوقت</th>
                  </tr>
                </thead>
                <tbody>
                  {items.slice((page - 1) * 10, page * 10).map((a) => (
                    <tr key={a.id}>
                      <td>
                        <div className="person-cell">
                          <Initials name={a.user_name} />
                          <span>{a.user_name}</span>
                        </div>
                      </td>
                      <td>
                        <span className="category-tag">{a.action}</span>
                      </td>
                      <td className="muted">{a.details || '—'}</td>
                      <td className="muted">
                        {new Intl.DateTimeFormat('ar-EG', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          timeZone: 'Africa/Cairo',
                        }).format(new Date(a.created_at))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} setPage={setPage} total={items.length} size={10} />
          </>
        )}
      </section>
    </>
  );
}
