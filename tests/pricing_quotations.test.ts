/**
 * Phase 3 Integration Tests: Price Lists, Customer Tiers, Quotations & Proforma Invoices.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { seedUsers, signIn, resetBusinessData, header } from './helpers';
import { one, all } from '../server/db';

beforeAll(seedUsers);
beforeEach(resetBusinessData);

describe('Phase 3: Pricing, Customer Tiers, and Quotations', () => {
  it('supports creating custom price lists and tiered product pricing', async () => {
    const admin = await signIn('admin@test.local');

    // Create a product
    const prodRes = await admin.post('/api/products').set(header).send({
      sku: 'PRC-001',
      name: 'شاشة سامسونج 27 بوصة',
      category: 'إلكترونيات',
      unit: 'قطعة',
      sale_price: 500000, // 5,000 EGP
      cost_price: 350000, // 3,500 EGP
      min_stock: 5,
    });
    expect(prodRes.status).toBe(201);
    const prodId = prodRes.body.id;

    // Check pre-seeded price lists exist (retail, wholesale, distributor)
    const listRes = await admin.get('/api/price-lists').set(header);
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBeGreaterThanOrEqual(3);

    const wholesalePl = listRes.body.find((p: any) => p.code === 'WHOLESALE');
    expect(wholesalePl).toBeDefined();

    // Set tiered price for wholesale: min_quantity 10 -> 4,200 EGP (420000 piasters)
    const itemRes = await admin.post(`/api/price-lists/${wholesalePl.id}/items`).set(header).send({
      product_id: prodId,
      min_quantity: 10,
      price: 420000,
    });
    expect(itemRes.status).toBe(201);
    expect(itemRes.body.price).toBe(420000);

    // Resolve price for 1 unit without customer tier (should use standard retail or list discount)
    const resolve1 = await admin
      .get(`/api/pricing/resolve?product_id=${prodId}&quantity=1`)
      .set(header);
    expect(resolve1.status).toBe(200);
    expect(resolve1.body.unitPrice).toBe(500000);

    // Resolve price explicitly with wholesale list for 5 units (below 10, fallback to 10% discount: 450,000)
    const resolveWholesale5 = await admin
      .get(`/api/pricing/resolve?product_id=${prodId}&quantity=5&price_list_id=${wholesalePl.id}`)
      .set(header);
    expect(resolveWholesale5.status).toBe(200);
    expect(resolveWholesale5.body.unitPrice).toBe(450000);

    // Resolve price with wholesale list for 10 units (matches 10+ tier: 420,000)
    const resolveWholesale10 = await admin
      .get(`/api/pricing/resolve?product_id=${prodId}&quantity=10&price_list_id=${wholesalePl.id}`)
      .set(header);
    expect(resolveWholesale10.status).toBe(200);
    expect(resolveWholesale10.body.unitPrice).toBe(420000);
  });

  it('assigns customer to a price tier and resolves price automatically', async () => {
    const admin = await signIn('admin@test.local');

    const customerRes = await admin.post('/api/parties').set(header).send({
      type: 'CUSTOMER',
      name: 'شركة النور للتجارة والتوزيع',
      email: 'nour@example.com',
      phone: '01012345678',
      address: 'القاهرة',
    });
    const customerId = customerRes.body.id;

    const prodRes = await admin.post('/api/products').set(header).send({
      sku: 'PRC-002',
      name: 'طابعة ليزر HP',
      category: 'طابعات',
      unit: 'قطعة',
      sale_price: 300000, // 3,000 EGP
      cost_price: 200000,
      min_stock: 2,
    });
    const prodId = prodRes.body.id;

    // Assign customer to DISTRIBUTOR tier (15% discount)
    const listRes = await admin.get('/api/price-lists').set(header);
    const distPl = listRes.body.find((p: any) => p.code === 'DISTRIBUTOR');

    const assignRes = await admin
      .post(`/api/parties/${customerId}/price-list`)
      .set(header)
      .send({ price_list_id: distPl.id });
    expect(assignRes.status).toBe(200);

    // Resolve price for this customer: 3000 * (1 - 0.15) = 2550 EGP (255000 piasters)
    const resolveCust = await admin
      .get(`/api/pricing/resolve?product_id=${prodId}&quantity=2&party_id=${customerId}`)
      .set(header);
    expect(resolveCust.status).toBe(200);
    expect(resolveCust.body.unitPrice).toBe(255000);
    expect(resolveCust.body.priceListId).toBe(distPl.id);
  });

  it('creates a quotation, confirms it, and converts it to a sales invoice', async () => {
    const admin = await signIn('admin@test.local');

    const customerRes = await admin.post('/api/parties').set(header).send({
      type: 'CUSTOMER',
      name: 'مؤسسة الأهرام الهندسية',
      email: 'ahram@example.com',
      phone: '01198765432',
      address: 'الجيزة',
    });
    const customerId = customerRes.body.id;

    const prodRes = await admin.post('/api/products').set(header).send({
      sku: 'QUO-PRD-1',
      name: 'راوتر سيسكو احترافي',
      category: 'شبكات',
      unit: 'قطعة',
      sale_price: 800000, // 8,000 EGP
      cost_price: 500000,
      min_stock: 1,
    });
    const prodId = prodRes.body.id;

    // Create a Quotation
    const quoRes = await admin
      .post('/api/quotations')
      .set(header)
      .send({
        type: 'QUOTATION',
        branch_id: 'main',
        party_id: customerId,
        date: '2026-10-23',
        valid_until: '2026-11-23',
        tax_rate: 1400, // 14%
        discount: 50000, // 500 EGP discount
        notes: 'عرض سعر توريد معدات شبكات',
        lines: [
          {
            product_id: prodId,
            quantity: 2,
            unit_price: 800000,
            notes: 'شامل التركيب والضمان',
          },
        ],
      });
    expect(quoRes.status).toBe(201);
    const quo = quoRes.body;
    expect(quo.number).toMatch(/^QUO-\d{4}-\d{4}$/);
    expect(quo.subtotal).toBe(1600000); // 16,000 EGP
    expect(quo.discount).toBe(50000);
    // tax-free mode: total = 1,600,000 - 50,000 = 1,550,000
    expect(quo.tax).toBe(0);
    expect(quo.total).toBe(1550000); // 15,500 EGP
    expect(quo.status).toBe('DRAFT');

    // Confirm quotation
    const confirmRes = await admin.post(`/api/quotations/${quo.id}/confirm`).set(header).send({});
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe('CONFIRMED');

    // Convert quotation to SALE invoice
    const convRes = await admin.post(`/api/quotations/${quo.id}/convert`).set(header).send({});
    expect(convRes.status).toBe(200);
    expect(convRes.body.quotation.status).toBe('CONVERTED');
    expect(convRes.body.documentId).toBeDefined();

    // Check generated sales document
    const saleDoc = one<any>('SELECT * FROM documents WHERE id=?', convRes.body.documentId);
    expect(saleDoc).toBeDefined();
    expect(saleDoc.type).toBe('SALE');
    expect(saleDoc.status).toBe('DRAFT');
    expect(saleDoc.party_id).toBe(customerId);
    expect(saleDoc.subtotal).toBe(1600000);
    expect(saleDoc.total).toBe(1550000);

    const docLines = all<any>('SELECT * FROM document_lines WHERE document_id=?', saleDoc.id);
    expect(docLines).toHaveLength(1);
    expect(docLines[0].product_id).toBe(prodId);
    expect(docLines[0].quantity).toBe(2);
    expect(docLines[0].unit_price).toBe(800000);
  });
});
