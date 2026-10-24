import { useMemo, useState } from 'react';
import { Calendar, Kanban, List, Plus, RefreshCw, Target, Clock, Search, X } from 'lucide-react';
import {
  Button,
  Loading,
  PageHeader,
  today,
  useAction,
  useData,
  useDebounced,
  useSession,
} from '../lib';
import { useBranch } from '../branch';
import { can } from '../auth';
import type { ActivityStatus, CrmActivity, CrmAssignee, CrmDeal, CrmStage } from '../types';
import { useCrmData } from '../features/crm/useCrmData';
import { crmApi, crmUrls, type DealFilters } from '../features/crm/api';
import { CrmStats } from '../features/crm/CrmStats';
import { KanbanBoard } from '../features/crm/KanbanBoard';
import { DealsTable } from '../features/crm/DealsTable';
import { ActivitiesTable } from '../features/crm/ActivitiesTable';
import { TargetsPanel } from '../features/crm/TargetsPanel';
import { DealFormModal } from '../features/crm/DealFormModal';
import { ActivityFormModal } from '../features/crm/ActivityFormModal';
import { TargetFormModal } from '../features/crm/TargetFormModal';
import { DealDetailModal } from '../features/crm/DealDetailModal';
import { CompleteActivityModal } from '../features/crm/CompleteActivityModal';
import { LostStageModal } from '../features/crm/LostStageModal';

type Tab = 'pipeline' | 'deals_list' | 'activities' | 'targets';

export function CRM() {
  const { user } = useSession();
  const { activeId, isGroup, defaultBranchId } = useBranch();
  const canManage = can(user, 'crm:manage');
  const scopeId = activeId || defaultBranchId;

  const [tab, setTab] = useState<Tab>('pipeline');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search);
  const [stageFilter, setStageFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [activityStatus, setActivityStatus] = useState<ActivityStatus | ''>('PENDING');
  const [selectedMonth, setSelectedMonth] = useState(today().slice(0, 7));

  const [addingDeal, setAddingDeal] = useState(false);
  const [addingActivity, setAddingActivity] = useState(false);
  const [addingTarget, setAddingTarget] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [editingDeal, setEditingDeal] = useState<CrmDeal | null>(null);
  const [completingActivity, setCompletingActivity] = useState<CrmActivity | null>(null);
  const [pendingLost, setPendingLost] = useState<{ deal: CrmDeal; stage: CrmStage } | null>(null);
  const [busyActivity, setBusyActivity] = useState<string | null>(null);
  const [movingDeal, setMovingDeal] = useState<string | null>(null);

  const filters = useMemo<DealFilters>(
    () => ({
      search: debouncedSearch || undefined,
      stageId: stageFilter || undefined,
      assignedTo: assigneeFilter || undefined,
    }),
    [debouncedSearch, stageFilter, assigneeFilter],
  );

  const {
    stages,
    deals,
    activities,
    targets,
    overview,
    loading,
    error,
    reloadAll,
    reloadDeals,
    reloadActivities,
    reloadOverview,
    reloadTargets,
  } = useCrmData(scopeId, selectedMonth, filters, activityStatus || undefined);

  const assignees = useData<CrmAssignee[]>(crmUrls.assignees(scopeId));
  const { act } = useAction();

  const visibleStages = stageFilter ? stages.filter((stage) => stage.id === stageFilter) : stages;

  const visibleActivities = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return activities.filter((activity) => {
      if (assigneeFilter && activity.assigned_to_user_id !== assigneeFilter) return false;
      if (!term) return true;
      return [activity.title, activity.deal_title, activity.customer_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [activities, assigneeFilter, debouncedSearch]);

  const moveDeal = (deal: CrmDeal, stageId: string) => {
    const stage = stages.find((item) => item.id === stageId);
    if (!stage) return;
    if (stage.is_lost) {
      setPendingLost({ deal, stage });
      return;
    }
    setMovingDeal(deal.id);
    void act(async () => {
      try {
        await crmApi.changeStage(deal.id, stageId, scopeId);
        reloadDeals();
        reloadOverview();
      } finally {
        setMovingDeal(null);
      }
    }, 'تم تحديث مرحلة الصفقة');
  };

  const cancelActivity = (activity: CrmActivity) => {
    setBusyActivity(activity.id);
    void act(async () => {
      try {
        await crmApi.updateActivity(activity.id, { status: 'CANCELLED' }, scopeId);
        reloadActivities();
        reloadOverview();
      } finally {
        setBusyActivity(null);
      }
    }, 'تم إلغاء المتابعة');
  };

  const openDeal = (deal: CrmDeal) => setSelectedDealId(deal.id);

  return (
    <>
      <PageHeader
        eyebrow="إدارة الأعمال والمبيعات"
        title="إدارة علاقات العملاء (CRM)"
        description="مسار صفقات تفاعلي، متابعات لا تُنسى، وتحويل فوري إلى عميل أو عرض سعر."
        actions={
          canManage ? (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <Button onClick={() => setAddingDeal(true)}>
                <Plus size={18} /> صفقة جديدة
              </Button>
              <Button variant="secondary" onClick={() => setAddingActivity(true)}>
                <Calendar size={18} /> نشاط متابعة
              </Button>
              <Button variant="secondary" onClick={() => setAddingTarget(true)}>
                <Target size={18} /> مستهدف بيعي
              </Button>
            </div>
          ) : undefined
        }
      />

      <CrmStats overview={overview} targets={targets} month={selectedMonth} />

      <div className="crm-toolbar">
        <label className="crm-search">
          <Search size={16} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث بالاسم أو الكود أو جهة الاتصال..."
            aria-label="بحث في الصفقات"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="مسح البحث">
              <X size={15} />
            </button>
          )}
        </label>

        {(tab === 'pipeline' || tab === 'deals_list') && (
          <label className="crm-toolbar-field">
            <span>المرحلة</span>
            <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}>
              <option value="">كل المراحل</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {tab !== 'targets' && (
          <label className="crm-toolbar-field">
            <span>المسؤول</span>
            <select
              value={assigneeFilter}
              onChange={(event) => setAssigneeFilter(event.target.value)}
            >
              <option value="">كل المسؤولين</option>
              {(assignees.data || []).map((assignee) => (
                <option key={assignee.id} value={assignee.id}>
                  {assignee.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {tab === 'activities' && (
          <label className="crm-toolbar-field">
            <span>الحالة</span>
            <select
              value={activityStatus}
              onChange={(event) => setActivityStatus(event.target.value as ActivityStatus | '')}
            >
              <option value="">الكل</option>
              <option value="PENDING">قيد الانتظار</option>
              <option value="COMPLETED">تم الإنجاز</option>
              <option value="CANCELLED">ملغاة</option>
            </select>
          </label>
        )}

        <Button variant="ghost" onClick={reloadAll} busy={loading} aria-label="تحديث بيانات CRM">
          <RefreshCw size={16} /> تحديث
        </Button>
      </div>

      {error && (
        <div className="crm-error" role="alert">
          <span>{error}</span>
          <Button variant="secondary" onClick={reloadAll}>
            إعادة المحاولة
          </Button>
        </div>
      )}

      <div className="tabs crm-tabs">
        <button className={tab === 'pipeline' ? 'active' : ''} onClick={() => setTab('pipeline')}>
          <Kanban size={16} />
          مسار الصفقات
          <span>{deals.length}</span>
        </button>
        <button
          className={tab === 'deals_list' ? 'active' : ''}
          onClick={() => setTab('deals_list')}
        >
          <List size={16} />
          قائمة الصفقات
        </button>
        <button
          className={tab === 'activities' ? 'active' : ''}
          onClick={() => setTab('activities')}
        >
          <Clock size={16} />
          الأنشطة والمتابعات
          <span>{visibleActivities.length}</span>
        </button>
        <button className={tab === 'targets' ? 'active' : ''} onClick={() => setTab('targets')}>
          <Target size={16} />
          المستهدفات والعمولات
          <span>{targets.length}</span>
        </button>
      </div>

      {loading && !deals.length && !activities.length ? (
        <Loading />
      ) : tab === 'pipeline' ? (
        <KanbanBoard
          stages={visibleStages}
          deals={deals}
          canManage={canManage}
          movingId={movingDeal}
          onOpen={openDeal}
          onMove={moveDeal}
        />
      ) : tab === 'deals_list' ? (
        <DealsTable
          deals={deals}
          showBranch={isGroup || scopeId === 'all'}
          canManage={canManage}
          onOpen={openDeal}
          onEdit={setEditingDeal}
        />
      ) : tab === 'activities' ? (
        <ActivitiesTable
          activities={visibleActivities}
          canManage={canManage}
          busyId={busyActivity}
          onOpenDeal={(dealId) => setSelectedDealId(dealId)}
          onComplete={setCompletingActivity}
          onCancel={cancelActivity}
        />
      ) : (
        <TargetsPanel
          targets={targets}
          month={selectedMonth}
          canManage={canManage}
          onMonthChange={setSelectedMonth}
          onAdd={() => setAddingTarget(true)}
        />
      )}

      {addingDeal && (
        <DealFormModal
          stages={stages}
          scopeId={scopeId}
          onClose={() => setAddingDeal(false)}
          onSaved={() => {
            setAddingDeal(false);
            reloadAll();
          }}
        />
      )}

      {editingDeal && (
        <DealFormModal
          deal={editingDeal}
          stages={stages}
          scopeId={scopeId}
          onClose={() => setEditingDeal(null)}
          onSaved={() => {
            setEditingDeal(null);
            reloadAll();
          }}
        />
      )}

      {addingActivity && (
        <ActivityFormModal
          deals={deals}
          scopeId={scopeId}
          onClose={() => setAddingActivity(false)}
          onSaved={() => {
            setAddingActivity(false);
            reloadActivities();
            reloadOverview();
          }}
        />
      )}

      {addingTarget && (
        <TargetFormModal
          month={selectedMonth}
          scopeId={scopeId}
          onClose={() => setAddingTarget(false)}
          onSaved={() => {
            setAddingTarget(false);
            reloadTargets();
          }}
        />
      )}

      {selectedDealId && (
        <DealDetailModal
          dealId={selectedDealId}
          scopeId={scopeId}
          stages={stages}
          canManage={canManage}
          onClose={() => setSelectedDealId(null)}
          onChanged={reloadAll}
        />
      )}

      {completingActivity && (
        <CompleteActivityModal
          activity={completingActivity}
          scopeId={scopeId}
          onClose={() => setCompletingActivity(null)}
          onSaved={() => {
            setCompletingActivity(null);
            reloadActivities();
            reloadDeals();
            reloadOverview();
          }}
        />
      )}

      {pendingLost && (
        <LostStageModal
          deal={pendingLost.deal}
          stage={pendingLost.stage}
          scopeId={scopeId}
          onClose={() => setPendingLost(null)}
          onSaved={() => {
            setPendingLost(null);
            reloadDeals();
            reloadOverview();
          }}
        />
      )}
    </>
  );
}
