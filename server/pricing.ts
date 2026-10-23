/**
 * Pricing Engine: Price Lists, Customer Tiers, and Tiered Volume Discounts (Phase 3.2).
 */

import { all, one, run, transaction, id, now } from './db';
import { AppError } from './errors';
import { PriceList, PriceListItem } from '../src/types';

export function listPriceLists(): PriceList[] {
  return all<PriceList>(`
    SELECT pl.*, 
      (SELECT COUNT(*) FROM price_list_items pli WHERE pli.price_list_id = pl.id) AS items_count
    FROM price_lists pl
    ORDER BY pl.is_default DESC, pl.name ASC
  `);
}

export function getPriceList(id: string): (PriceList & { items: PriceListItem[] }) | null {
  const pl = one<PriceList>('SELECT * FROM price_lists WHERE id=?', id);
  if (!pl) return null;
  const items = all<PriceListItem>(
    `SELECT pli.*, p.name AS product_name, p.sku
     FROM price_list_items pli
     JOIN products p ON p.id = pli.product_id
     WHERE pli.price_list_id=?
     ORDER BY p.name ASC, pli.min_quantity ASC`,
    id,
  );
  return { ...pl, items };
}

export function createPriceList(data: {
  name: string;
  code: string;
  discount_basis_pts?: number;
  is_default?: boolean;
  notes?: string;
}): PriceList {
  const existing = one<{ id: string }>('SELECT id FROM price_lists WHERE code=?', data.code);
  if (existing) throw new AppError(400, 'كود قائمة الأسعار مستخدم بالفعل');

  const plId = id();
  const ts = now();

  transaction(() => {
    if (data.is_default) {
      run('UPDATE price_lists SET is_default=0');
    }
    run(
      `INSERT INTO price_lists(id, name, code, discount_basis_pts, is_active, is_default, notes, created_at)
       VALUES(?,?,?,?,?, ?,?,?)`,
      plId,
      data.name,
      data.code,
      data.discount_basis_pts || 0,
      1,
      data.is_default ? 1 : 0,
      data.notes || null,
      ts,
    );
  });

  return one<PriceList>('SELECT * FROM price_lists WHERE id=?', plId)!;
}

export function updatePriceList(
  id: string,
  data: {
    name?: string;
    discount_basis_pts?: number;
    is_active?: boolean;
    is_default?: boolean;
    notes?: string;
  },
): PriceList {
  const current = one<PriceList>('SELECT * FROM price_lists WHERE id=?', id);
  if (!current) throw new AppError(404, 'قائمة الأسعار غير موجودة');

  transaction(() => {
    if (data.is_default) {
      run('UPDATE price_lists SET is_default=0 WHERE id<>?', id);
    }
    run(
      `UPDATE price_lists SET
        name = COALESCE(?, name),
        discount_basis_pts = COALESCE(?, discount_basis_pts),
        is_active = COALESCE(?, is_active),
        is_default = COALESCE(?, is_default),
        notes = COALESCE(?, notes)
       WHERE id=?`,
      data.name ?? null,
      data.discount_basis_pts !== undefined ? data.discount_basis_pts : null,
      data.is_active !== undefined ? (data.is_active ? 1 : 0) : null,
      data.is_default !== undefined ? (data.is_default ? 1 : 0) : null,
      data.notes !== undefined ? data.notes : null,
      id,
    );
  });

  return one<PriceList>('SELECT * FROM price_lists WHERE id=?', id)!;
}

export function setPriceListItem(data: {
  price_list_id: string;
  product_id: string;
  min_quantity: number;
  price: number;
}): PriceListItem {
  const pl = one<PriceList>('SELECT id FROM price_lists WHERE id=?', data.price_list_id);
  if (!pl) throw new AppError(404, 'قائمة الأسعار غير موجودة');

  const prod = one<{ id: string }>('SELECT id FROM products WHERE id=?', data.product_id);
  if (!prod) throw new AppError(404, 'المنتج غير موجود');

  const existing = one<PriceListItem>(
    'SELECT * FROM price_list_items WHERE price_list_id=? AND product_id=? AND min_quantity=?',
    data.price_list_id,
    data.product_id,
    data.min_quantity,
  );

  if (existing) {
    run('UPDATE price_list_items SET price=? WHERE id=?', data.price, existing.id);
    return one<PriceListItem>('SELECT * FROM price_list_items WHERE id=?', existing.id)!;
  }

  const itemId = id();
  const ts = now();
  run(
    `INSERT INTO price_list_items(id, price_list_id, product_id, min_quantity, price, created_at)
     VALUES(?,?,?,?,?,?)`,
    itemId,
    data.price_list_id,
    data.product_id,
    data.min_quantity,
    data.price,
    ts,
  );

  return one<PriceListItem>('SELECT * FROM price_list_items WHERE id=?', itemId)!;
}

export function deletePriceListItem(itemId: string): void {
  run('DELETE FROM price_list_items WHERE id=?', itemId);
}

export function assignPartyPriceList(partyId: string, priceListId: string | null): void {
  const party = one<{ id: string }>('SELECT id FROM parties WHERE id=?', partyId);
  if (!party) throw new AppError(404, 'العميل / الطرف غير موجود');

  if (!priceListId) {
    run('DELETE FROM party_price_tiers WHERE party_id=?', partyId);
    return;
  }

  const pl = one<{ id: string }>('SELECT id FROM price_lists WHERE id=?', priceListId);
  if (!pl) throw new AppError(404, 'قائمة الأسعار غير موجودة');

  run(
    'INSERT OR REPLACE INTO party_price_tiers(party_id, price_list_id) VALUES(?,?)',
    partyId,
    priceListId,
  );
}

export function getPartyPriceList(partyId: string): PriceList | null {
  return (
    one<PriceList>(
      `SELECT pl.* FROM price_lists pl
       JOIN party_price_tiers ppt ON ppt.price_list_id = pl.id
       WHERE ppt.party_id=?`,
      partyId,
    ) || null
  );
}

/**
 * Resolves the unit price in piasters for a given product and quantity,
 * respecting customer tier, specific product volume tiers, or fallback list discount.
 */
export function resolveProductPrice(
  productId: string,
  quantity: number = 1,
  partyId?: string,
  overridePriceListId?: string,
): { unitPrice: number; priceListId: string | null; discountApplied: number } {
  const prod = one<{ id: string; sale_price: number }>(
    'SELECT id, sale_price FROM products WHERE id=?',
    productId,
  );
  if (!prod) throw new AppError(404, 'المنتج غير موجود');

  let activePriceList: PriceList | null = null;

  if (overridePriceListId) {
    activePriceList =
      one<PriceList>('SELECT * FROM price_lists WHERE id=? AND is_active=1', overridePriceListId) ||
      null;
  } else if (partyId) {
    activePriceList = getPartyPriceList(partyId);
  }

  if (!activePriceList) {
    activePriceList =
      one<PriceList>('SELECT * FROM price_lists WHERE is_default=1 AND is_active=1') || null;
  }

  if (!activePriceList) {
    return { unitPrice: prod.sale_price, priceListId: null, discountApplied: 0 };
  }

  // 1. Check if there's a specific tiered item price in the active price list
  const itemTier = one<{ price: number }>(
    `SELECT price FROM price_list_items 
     WHERE price_list_id=? AND product_id=? AND min_quantity <= ?
     ORDER BY min_quantity DESC LIMIT 1`,
    activePriceList.id,
    productId,
    quantity,
  );

  if (itemTier) {
    return {
      unitPrice: itemTier.price,
      priceListId: activePriceList.id,
      discountApplied: Math.max(0, prod.sale_price - itemTier.price),
    };
  }

  // 2. If no item price, apply list default discount basis points if any (e.g. 1000 = 10%)
  if (activePriceList.discount_basis_pts > 0) {
    const discounted = Math.round(
      prod.sale_price * (1 - activePriceList.discount_basis_pts / 10000),
    );
    return {
      unitPrice: discounted,
      priceListId: activePriceList.id,
      discountApplied: prod.sale_price - discounted,
    };
  }

  return { unitPrice: prod.sale_price, priceListId: activePriceList.id, discountApplied: 0 };
}
