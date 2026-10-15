import { IconName } from './icon.component';

export type Recurrence = 'none' | 'monthly';

export interface Expense {
  id: string;
  description: string;
  amountCents: number;
  category: string | null;
  date: string;
  recurrence: Recurrence;
  paidBy?: string; // solo en gastos de grupo
  shares?: ExpenseShare[]; // solo en gastos de grupo: entre quien se reparte
}

// Parte de un gasto de grupo que le toca a una persona. settled: ya se la
// ha devuelto a quien pago (la de quien pago siempre viene a true).
export interface ExpenseShare {
  userId: string;
  shareCents: number;
  settled: boolean;
}

// Deuda pendiente persona a persona (ya compensada entre cada pareja).
export interface Debt {
  fromUserId: string;
  fromUsername: string | null;
  toUserId: string;
  toUsername: string | null;
  amountCents: number;
}

export interface Category {
  key: string;
  label: string;
  icon: IconName;
}

// Conjunto fijo (no libre): permite un desglose por categoria fiable en
// vez de agrupar por texto suelto, que nunca coincidiria entre "Comida" y
// "comida".
export const CATEGORIES: Category[] = [
  { key: 'comida', label: 'Comida', icon: 'plate' },
  { key: 'casa', label: 'Casa', icon: 'home' },
  { key: 'ocio', label: 'Ocio', icon: 'party' },
  { key: 'transporte', label: 'Transporte', icon: 'car' },
  { key: 'salud', label: 'Salud', icon: 'pill' },
  { key: 'otros', label: 'Otros', icon: 'box' },
];

export function categoryOf(key: string | null): Category {
  return CATEGORIES.find((c) => c.key === key) ?? CATEGORIES[CATEGORIES.length - 1];
}

export interface CategoryTotal {
  category: Category;
  totalCents: number;
  budgetCents: number | null;
}

export interface Budget {
  category: string;
  amountCents: number;
}

export interface MonthTotal {
  month: string; // YYYY-MM
  totalCents: number;
}

export interface GroupAccount {
  id: string;
  name: string;
  ownerId: string;
  listId: string;
  memberCount: number;
  isOwner: boolean;
}

export interface Balance {
  userId: string;
  username: string;
  balanceCents: number;
}

export type OwnerMode = 'personal' | 'group';

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

export interface Profile {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  accountConsoleUrl: string;
}
