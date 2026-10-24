import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { all } from '../server/db';
import { PASSWORD, header, resetBusinessData, seedUsers, signIn } from './helpers';

type Agent = Awaited<ReturnType<typeof signIn>>;

let admin: Agent;
let staff: Agent;

beforeAll(async () => {
  await seedUsers();
  admin = await signIn('admin@test.local');
  staff = await signIn('staff@test.local');
});
beforeEach(() => resetBusinessData());

async function openBranch(code: string) {
  const res = await admin
    .post('/api/branches')
    .set(header)
    .send({
      code,
      name: `فرع ${code}`,
      kind: 'STORE',
      phone: '',
      address: '',
      opened_on: '2026-01-01',
    })
    .expect(201);
  return res.body.id as string;
}

async function createDeal(branchId: string, title: string, expectedRevenue: number) {
  const res = await admin
    .post('/api/crm/deals')
    .set(header)
    .send({
      title,
      contact_name: 'أحمد إبراهيم',
      contact_phone: '01000000000',
      branch_id: branchId,
      expected_revenue: expectedRevenue,
    })
    .expect(201);
  return res.body;
}

/** A sales user assigned only to the given branch. */
async function createBranchSales(email: string, branchId: string) {
  const res = await admin
    .post('/api/users')
    .set(header)
    .send({
      name: 'مبيعات الفرع',
      email,
      password: PASSWORD,
      role: 'SALES',
      branch_ids: [branchId],
    })
    .expect(201);
  return res.body.id as string;
}

function auditsFor(entity: string, entityId: string): string[] {
  return all<{ action: string }>(
    'SELECT action FROM audit_logs WHERE entity=? AND entity_id=? ORDER BY created_at',
    entity,
    entityId,
  ).map((row) => row.action);
}

describe('CRM hardening — branch isolation, lifecycle rules and audit trail', () => {
  it('hides another branch’s deals, activities and assignees from a sales user', async () => {
    const br2 = await openBranch('BR2');
    await createBranchSales('br2-sales@test.local', br2);

    const mainDeal = await createDeal('main', 'صفقة الفرع الرئيسي', 10_000);
    const otherDeal = await createDeal(br2, 'صفقة الفرع الثاني', 50_000);

    // Lists are scoped: the sales user only sees their own branch.
    const ownList = await staff.get('/api/crm/deals').set(header).expect(200);
    expect(ownList.body.map((deal: { id: string }) => deal.id)).toEqual([mainDeal.id]);

    // Direct reads and writes of a foreign deal are indistinguishable from a missing one.
    await staff.get(`/api/crm/deals/${otherDeal.id}`).set(header).expect(404);
    await staff
      .patch(`/api/crm/deals/${otherDeal.id}`)
      .set(header)
      .send({ title: 'محاولة تعديل' })
      .expect(404);
    await staff
      .patch(`/api/crm/deals/${otherDeal.id}/stage`)
      .set(header)
      .send({ stage_id: 'stage_qualified' })
      .expect(404);
    await staff
      .post('/api/crm/deals')
      .set(header)
      .send({
        title: 'صفقة في فرع غير مسند',
        contact_name: 'عميل',
        branch_id: br2,
        expected_revenue: 100,
      })
      .expect(403);

    // Activities inherit the deal branch and reject an unscoped write.
    const otherActivity = await admin
      .post('/api/crm/activities')
      .set(header)
      .send({
        deal_id: otherDeal.id,
        type: 'CALL',
        title: 'متابعة صفقة الفرع الثاني',
        due_date: '2026-10-30',
      })
      .expect(201);
    expect(otherActivity.body.branch_id).toBe(br2);

    const staffActivities = await staff.get('/api/crm/activities').set(header).expect(200);
    expect(staffActivities.body.map((activity: { id: string }) => activity.id)).not.toContain(
      otherActivity.body.id,
    );
    await staff
      .patch(`/api/crm/activities/${otherActivity.body.id}`)
      .set(header)
      .send({ status: 'CANCELLED' })
      .expect(404);

    // An activity that is not tied to a deal must state its branch.
    await staff
      .post('/api/crm/activities')
      .set(header)
      .send({ type: 'TASK', title: 'مهمة بلا فرع', due_date: '2026-10-30' })
      .expect(400);

    // Assignee lookup follows the same scope: the other branch’s salesperson is invisible,
    // while administrators remain valid assignees everywhere.
    const mainAssignees = await staff.get('/api/crm/assignees').set(header).expect(200);
    expect(mainAssignees.body.map((user: { id: string }) => user.id)).toContain('staff');
    expect(mainAssignees.body.map((user: { email: string }) => user.email)).not.toContain(
      'br2-sales@test.local',
    );
    const br2Assignees = await admin
      .get(`/api/crm/assignees?branch_id=${br2}`)
      .set(header)
      .expect(200);
    expect(br2Assignees.body.map((user: { email: string }) => user.email)).not.toContain(
      'staff@test.local',
    );
    expect(br2Assignees.body.map((user: { email: string }) => user.email)).toContain(
      'admin@test.local',
    );
  });

  it('requires a lost reason and maintains closed_at across close and reopen', async () => {
    const deal = await createDeal('main', 'صفقة قابلة للخسارة', 200_000);

    const rejected = await admin
      .patch(`/api/crm/deals/${deal.id}/stage`)
      .set(header)
      .send({ stage_id: 'stage_lost' })
      .expect(400);
    expect(rejected.body.error).toContain('سبب');

    const lost = await admin
      .patch(`/api/crm/deals/${deal.id}/stage`)
      .set(header)
      .send({ stage_id: 'stage_lost', lost_reason: 'السعر أعلى من المنافس' })
      .expect(200);
    expect(lost.body).toMatchObject({
      status: 'LOST',
      stage_id: 'stage_lost',
      probability: 0,
      lost_reason: 'السعر أعلى من المنافس',
    });
    expect(lost.body.closed_at).toBeTruthy();

    const reopened = await admin
      .patch(`/api/crm/deals/${deal.id}/stage`)
      .set(header)
      .send({ stage_id: 'stage_negotiation' })
      .expect(200);
    expect(reopened.body).toMatchObject({
      status: 'OPEN',
      stage_id: 'stage_negotiation',
      probability: 90,
      lost_reason: null,
      closed_at: null,
    });

    expect(auditsFor('CRM_DEAL', deal.id)).toEqual([
      'إنشاء صفقة',
      'تغيير مرحلة صفقة',
      'تغيير مرحلة صفقة',
    ]);
  });

  it('reschedules, completes and cancels activities through PATCH', async () => {
    const activity = await admin
      .post('/api/crm/activities')
      .set(header)
      .send({
        branch_id: 'main',
        type: 'MEETING',
        title: 'اجتماع أولي',
        due_date: '2026-10-28',
        due_time: '10:30',
        priority: 'NORMAL',
      })
      .expect(201);
    expect(activity.body).toMatchObject({
      branch_id: 'main',
      status: 'PENDING',
      priority: 'NORMAL',
      completed_at: null,
    });

    const rescheduled = await admin
      .patch(`/api/crm/activities/${activity.body.id}`)
      .set(header)
      .send({
        title: 'اجتماع لمناقشة العرض',
        due_date: '2026-11-02',
        due_time: '12:00',
        priority: 'URGENT',
      })
      .expect(200);
    expect(rescheduled.body).toMatchObject({
      title: 'اجتماع لمناقشة العرض',
      due_date: '2026-11-02',
      due_time: '12:00',
      priority: 'URGENT',
      status: 'PENDING',
    });

    const completed = await admin
      .patch(`/api/crm/activities/${activity.body.id}`)
      .set(header)
      .send({ status: 'COMPLETED', outcome_notes: 'تم الاتفاق على الخطوة التالية' })
      .expect(200);
    expect(completed.body.status).toBe('COMPLETED');
    expect(completed.body.outcome_notes).toBe('تم الاتفاق على الخطوة التالية');
    expect(completed.body.completed_at).toBeTruthy();

    const cancelled = await admin
      .patch(`/api/crm/activities/${activity.body.id}`)
      .set(header)
      .send({ status: 'CANCELLED' })
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(cancelled.body.completed_at).toBeNull();

    expect(auditsFor('CRM_ACTIVITY', activity.body.id)).toEqual([
      'جدولة متابعة',
      'تعديل متابعة',
      'إنجاز متابعة',
      'إلغاء متابعة',
    ]);
  });

  it('scopes dashboard totals and sales targets per branch', async () => {
    const br2 = await openBranch('BR2');
    const br2User = await createBranchSales('br2-target@test.local', br2);

    await createDeal('main', 'صفقة مفتوحة', 10_000);
    const won = await createDeal(br2, 'صفقة رابحة', 50_000);
    await admin
      .patch(`/api/crm/deals/${won.id}/stage`)
      .set(header)
      .send({ stage_id: 'stage_won' })
      .expect(200);

    const mainOverview = await admin
      .get('/api/crm/overview?branch_id=main')
      .set(header)
      .expect(200);
    expect(mainOverview.body).toMatchObject({ open_deals: 1, open_value: 10_000, won_value: 0 });

    const br2Overview = await admin
      .get(`/api/crm/overview?branch_id=${br2}`)
      .set(header)
      .expect(200);
    expect(br2Overview.body).toMatchObject({ open_deals: 0, won_deals: 1, won_value: 50_000 });

    const staffOverview = await staff.get('/api/crm/overview').set(header).expect(200);
    expect(staffOverview.body).toMatchObject({ open_deals: 1, open_value: 10_000, won_value: 0 });

    const groupOverview = await admin.get('/api/crm/overview').set(header).expect(200);
    expect(groupOverview.body).toMatchObject({
      open_deals: 1,
      open_value: 10_000,
      won_deals: 1,
      won_value: 50_000,
    });

    await admin
      .post('/api/crm/targets')
      .set(header)
      .send({ user_id: 'staff', month: '2026-10', target_amount: 1_000_000, commission_bps: 200 })
      .expect(201);
    await admin
      .post('/api/crm/targets')
      .set(header)
      .send({ user_id: br2User, month: '2026-10', target_amount: 2_000_000, commission_bps: 150 })
      .expect(201);

    const staffTargets = await staff.get('/api/crm/targets?month=2026-10').set(header).expect(200);
    expect(staffTargets.body.map((target: { user_id: string }) => target.user_id)).toEqual([
      'staff',
    ]);

    const br2Targets = await admin
      .get(`/api/crm/targets?month=2026-10&branch_id=${br2}`)
      .set(header)
      .expect(200);
    expect(br2Targets.body.map((target: { user_id: string }) => target.user_id)).toEqual([br2User]);

    // A sales user cannot set a target for somebody outside their branches.
    await staff
      .post('/api/crm/targets')
      .set(header)
      .send({ user_id: br2User, month: '2026-10', target_amount: 100, commission_bps: 100 })
      .expect(403);
  });
});
