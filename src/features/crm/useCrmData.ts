import { useCallback } from 'react';
import { useData } from '../../lib';
import type {
  ActivityStatus,
  CrmActivity,
  CrmDeal,
  CrmOverview,
  CrmStage,
  SalesTarget,
} from '../../types';
import { crmUrls, type DealFilters } from './api';

export function useCrmData(
  scopeId: string | undefined,
  month: string,
  filters: DealFilters,
  activityStatus: ActivityStatus | undefined,
) {
  const stages = useData<CrmStage[]>('/crm/stages');
  const overview = useData<CrmOverview>(crmUrls.overview(scopeId));
  const deals = useData<CrmDeal[]>(crmUrls.deals(scopeId, filters));
  const activities = useData<CrmActivity[]>(
    crmUrls.activities(scopeId, { status: activityStatus }),
  );
  const targets = useData<SalesTarget[]>(crmUrls.targets(month, scopeId));

  const reloadDeals = deals.reload;
  const reloadActivities = activities.reload;
  const reloadTargets = targets.reload;
  const reloadOverview = overview.reload;
  const reloadStages = stages.reload;

  const reloadAll = useCallback(() => {
    reloadDeals();
    reloadActivities();
    reloadTargets();
    reloadOverview();
    reloadStages();
  }, [reloadDeals, reloadActivities, reloadTargets, reloadOverview, reloadStages]);

  return {
    stages: stages.data ?? [],
    deals: deals.data ?? [],
    activities: activities.data ?? [],
    targets: targets.data ?? [],
    overview: overview.data,
    loading:
      stages.loading || deals.loading || activities.loading || targets.loading || overview.loading,
    error: deals.error || stages.error || activities.error || targets.error || overview.error || '',
    reloadAll,
    reloadDeals,
    reloadActivities,
    reloadTargets,
    reloadOverview,
  };
}
