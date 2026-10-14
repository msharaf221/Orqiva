import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { all, one } from './db';
import { AppError, requireRow } from './service';
import { date } from './validation';
import { hasPermission } from './rbac';
import { canSee } from './scope';
import { transferDetail } from './transfers';
import type { Document, User } from '../src/types';

export const tokenHash = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const admin = (req: Request, _res: Response, next: NextFunction): void => {
  if (
    req.user.role !== 'ADMIN' &&
    !req.user.permissions?.includes('admin:all') &&
    !req.user.permissions?.includes('users:manage')
  ) {
    throw new AppError(403, 'هذه العملية متاحة لمدير النظام فقط');
  }
  next();
};

export const authorizeDoc = (req: Request, _res: Response, next: NextFunction): void => {
  const type = req.params.id
    ? requireRow(one<Document>('SELECT * FROM documents WHERE id=?', String(req.params.id))).type
    : req.body?.type;

  if (type === 'PURCHASE' || type === 'PURCHASE_RETURN') {
    if (!hasPermission(req.user, 'documents:create_purchase')) {
      throw new AppError(
        403,
        'التعامل مع المشتريات متاح لمدير النظام أو من لديه صلاحية المشتريات فقط',
      );
    }
  } else {
    if (!hasPermission(req.user, 'documents:create_sale')) {
      throw new AppError(
        403,
        'التعامل مع المبيعات متاح لمدير النظام أو من لديه صلاحية المبيعات فقط',
      );
    }
  }
  next();
};

export const authorizePost = (req: Request, _res: Response, next: NextFunction): void => {
  if (!hasPermission(req.user, 'documents:post')) {
    throw new AppError(403, 'اعتماد المستندات يتطلب صلاحية الاعتماد');
  }
  const type = requireRow(
    one<Document>('SELECT * FROM documents WHERE id=?', String(req.params.id)),
  ).type;
  if (
    (type === 'PURCHASE' || type === 'PURCHASE_RETURN') &&
    !hasPermission(req.user, 'documents:create_purchase')
  ) {
    throw new AppError(403, 'اعتماد المشتريات متاح لمدير النظام أو من لديه صلاحية المشتريات فقط');
  }
  next();
};

export const authorizePayment = (req: Request, _res: Response, next: NextFunction): void => {
  if (!hasPermission(req.user, 'finance:payments')) {
    throw new AppError(403, 'تسجيل الدفعات يتطلب صلاحية المقبوضات والمدفوعات');
  }
  next();
};

/** Period filter shared by reports (optional branch); ranges are capped at one year. */
export const period = z
  .object({ from: date, to: date, branch_id: z.string().max(100).optional() })
  .refine(
    (d) => d.to >= d.from && Date.parse(d.to) - Date.parse(d.from) <= 365 * 86400000,
    'الفترة يجب أن تكون بين يوم و٣٦٦ يوماً',
  );

export const visibleTransfer = (user: User, transferId: string) => {
  const transfer = transferDetail(transferId);
  if (!canSee(user, transfer.from_branch_id) && !canSee(user, transfer.to_branch_id)) {
    throw new AppError(403, 'ليس لديك صلاحية على هذا التحويل');
  }
  return transfer;
};

export const assignedBranches = (userId: string): string[] =>
  all<{ branch_id: string }>('SELECT branch_id FROM user_branches WHERE user_id=?', userId).map(
    (r) => r.branch_id,
  );
