export type Role = 'ADMIN' | 'STAFF';
export type DocType = 'SALE' | 'PURCHASE';
export type PartyType = 'CUSTOMER' | 'SUPPLIER';
export type PaymentMethod = 'CASH' | 'BANK' | 'CARD';
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: number;
  created_at: string;
}
export interface Company {
  id: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  tax_number: string;
  currency: string;
  tax_rate: number;
  invoice_note: string;
}
export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  sale_price: number;
  cost_price: number;
  stock: number;
  min_stock: number;
  active: number;
  created_at: string;
}
export interface Party {
  id: string;
  type: PartyType;
  name: string;
  email: string;
  phone: string;
  address: string;
  tax_number: string;
  notes: string;
  active: number;
  created_at: string;
  balance: number;
  documents_count: number;
}
export interface DocLine {
  id: string;
  document_id: string;
  product_id: string;
  name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  cost_price: number;
  total: number;
}
export interface Payment {
  id: string;
  document_id: string;
  amount: number;
  method: PaymentMethod;
  date: string;
  reference: string;
  created_by: string;
  created_at: string;
  number?: string;
  party_name?: string;
  type?: DocType;
}
export interface Document {
  id: string;
  number: string;
  type: DocType;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  party_id: string;
  party_name: string;
  party_phone?: string;
  party_address?: string;
  party_tax_number?: string;
  date: string;
  due_date: string;
  subtotal: number;
  discount: number;
  tax_rate: number;
  tax: number;
  total: number;
  paid: number;
  notes: string;
  created_by: string;
  created_at: string;
  lines?: DocLine[];
  payments?: Payment[];
}
export interface Expense {
  id: string;
  title: string;
  category: string;
  amount: number;
  date: string;
  method: PaymentMethod;
  notes: string;
  created_at: string;
}
export interface Movement {
  id: string;
  product_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  reason: string;
  number: string | null;
  user_name: string;
  created_at: string;
}
export interface Audit {
  id: string;
  user_name: string;
  action: string;
  entity: string;
  details: string;
  created_at: string;
}
export interface Dashboard {
  sales: number;
  purchases: number;
  expenses: number;
  grossProfit: number;
  netProfit: number;
  salesGrowth: number;
  receivables: number;
  payables: number;
  collected: number;
  disbursed: number;
  cashFlow: number;
  stockValue: number;
  productCount: number;
  customerCount: number;
  invoiceCount: number;
  overdueCount: number;
  series: { date: string; sales: number; purchases: number }[];
  recentDocuments: Document[];
  lowStock: Product[];
  topProducts: { name: string; sku: string; quantity: number; revenue: number }[];
  expenseCategories: { category: string; amount: number }[];
  activities: Audit[];
}
