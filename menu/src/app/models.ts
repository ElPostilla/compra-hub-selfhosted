export type Slot = 'comida' | 'cena';

export interface Meal {
  id: string;
  date: string;
  slot: Slot;
  title: string;
  ingredients: string[];
}

export interface GroupAccount {
  id: string;
  name: string;
  ownerId: string;
  listId: string;
  memberCount: number;
  isOwner: boolean;
}

export type OwnerMode = 'personal' | 'group';

export const SLOTS: Slot[] = ['comida', 'cena'];
export const SLOT_LABELS: Record<Slot, string> = { comida: 'Comida', cena: 'Cena' };

export function mealKey(date: string, slot: Slot): string {
  return date + '|' + slot;
}

export interface Profile {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  accountConsoleUrl: string;
}
