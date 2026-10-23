import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { header, seedUsers, signIn, resetBusinessData } from './helpers';
import { one } from '../server/db';

beforeAll(seedUsers);
beforeEach(resetBusinessData);

describe('Enterprise CRM Module — Pipeline, Conversions, Activities, Targets', () => {
  it('manages sales pipeline stages, deal creation, and stage progression', async () => {
    const admin = await signIn('admin@test.local');

    // 1. Fetch CRM stages
    const stagesRes = await admin.get('/api/crm/stages').set(header);
    expect(stagesRes.status).toBe(200);
    expect(stagesRes.body.length).toBeGreaterThanOrEqual(5);
    const stageNew = stagesRes.body.find((s: any) => s.id === 'stage_new');
    const stageWon = stagesRes.body.find((s: any) => s.id === 'stage_won');
    expect(stageNew).toBeDefined();
    expect(stageWon).toBeDefined();

    // 2. Create a new Deal / Opportunity
    const dealRes = await admin.post('/api/crm/deals').set(header).send({
      title: 'توريد أجهزة حاسب آلي لشركة النيل',
      contact_name: 'م. حسام النجار',
      contact_phone: '01012345678',
      contact_email: 'hossam@nile-tech.com',
      expected_revenue: 5000000, // 50,000 EGP
      branch_id: 'main',
      notes: 'العميل مهتم بـ 10 أجهزة محمولة',
    });
    expect(dealRes.status).toBe(201);
    expect(dealRes.body.code).toMatch(/^DEAL-/);
    expect(dealRes.body.status).toBe('OPEN');
    expect(dealRes.body.expected_revenue).toBe(5000000);
    const dealId = dealRes.body.id;

    // 3. Update Deal stage (e.g. to won)
    const updateRes = await admin.patch(`/api/crm/deals/${dealId}/stage`).set(header).send({
      stage_id: 'stage_won',
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.stage_id).toBe('stage_won');
    expect(updateRes.body.status).toBe('WON');
    expect(updateRes.body.probability).toBe(100);
  });

  it('converts deals to customers and official quotations with 1-click', async () => {
    const admin = await signIn('admin@test.local');

    // 1. Create a deal without existing party
    const dealRes = await admin.post('/api/crm/deals').set(header).send({
      title: 'صفقة تجديد شبكات شركة الأهرام',
      contact_name: 'أ/ سامح شكري',
      contact_phone: '01122334455',
      contact_email: 'sameh@ahram.org',
      expected_revenue: 8000000, // 80,000 EGP
      branch_id: 'main',
    });
    const dealId = dealRes.body.id;

    // 2. Convert to Customer
    const custRes = await admin
      .post(`/api/crm/deals/${dealId}/convert-customer`)
      .set(header)
      .send({});
    expect(custRes.status).toBe(200);
    expect(custRes.body.party_id).toBeDefined();

    const party = one<any>('SELECT * FROM parties WHERE id=?', custRes.body.party_id);
    expect(party).toBeDefined();
    expect(party.name).toBe('أ/ سامح شكري');
    expect(party.type).toBe('CUSTOMER');

    // 3. Convert to Quotation
    const qtnRes = await admin
      .post(`/api/crm/deals/${dealId}/convert-quotation`)
      .set(header)
      .send({});
    expect(qtnRes.status).toBe(200);
    expect(qtnRes.body.quotation_id).toBeDefined();

    const qtn = one<any>('SELECT * FROM quotations WHERE id=?', qtnRes.body.quotation_id);
    expect(qtn).toBeDefined();
    expect(qtn.total).toBe(8000000);
    expect(qtn.status).toBe('DRAFT');
    expect(qtn.number).toMatch(/^QTN-/);

    // Verify deal updated with quotation_id
    const updatedDeal = one<any>('SELECT quotation_id, stage_id FROM crm_deals WHERE id=?', dealId);
    expect(updatedDeal.quotation_id).toBe(qtn.id);
    expect(updatedDeal.stage_id).toBe('stage_proposal');
  });

  it('manages follow-up activities and sales targets with commission calculation', async () => {
    const admin = await signIn('admin@test.local');

    // 1. Create an activity on a deal
    const dealRes = await admin.post('/api/crm/deals').set(header).send({
      title: 'صفقة متابعة أدوية صيدلية الشفاء',
      contact_name: 'د. كريم عبد الرحمن',
      branch_id: 'main',
    });
    const dealId = dealRes.body.id;

    const actRes = await admin.post('/api/crm/activities').set(header).send({
      deal_id: dealId,
      type: 'CALL',
      title: 'مكالمة هاتفية لمناقشة الخصم',
      due_date: '2026-10-25',
      due_time: '14:00',
    });
    expect(actRes.status).toBe(201);
    expect(actRes.body.status).toBe('PENDING');
    const actId = actRes.body.id;

    // 2. Complete the activity
    const completeRes = await admin.post(`/api/crm/activities/${actId}/complete`).set(header).send({
      outcome_notes: 'تم الاتفاق على موعد إرسال العرض',
    });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.status).toBe('COMPLETED');
    expect(completeRes.body.outcome_notes).toBe('تم الاتفاق على موعد إرسال العرض');

    // 3. Set a Sales Target for admin (2% commission = 200 bps)
    const targetRes = await admin.post('/api/crm/targets').set(header).send({
      user_id: 'admin',
      month: '2026-10',
      target_amount: 10000000, // 100,000 EGP target
      commission_bps: 200, // 2%
      notes: 'تارجت مبيعات الربع الأخير',
    });
    expect(targetRes.status).toBe(201);
    expect(targetRes.body.user_id).toBe('admin');
    expect(targetRes.body.target_amount).toBe(10000000);
    expect(targetRes.body.commission_bps).toBe(200);

    // 4. Fetch performance list
    const perfRes = await admin.get('/api/crm/targets?month=2026-10').set(header);
    expect(perfRes.status).toBe(200);
    expect(perfRes.body).toHaveLength(1);
    expect(perfRes.body[0].achieved_amount).toBe(0);
    expect(perfRes.body[0].earned_commission).toBe(0);
  });
});
