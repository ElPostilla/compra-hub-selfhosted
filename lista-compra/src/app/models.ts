export interface Item {
  id: string;
  name: string;
  qty: string;
  done: boolean;
  category: string;
  // Producto fijo (p.ej. leche): al vaciar los comprados no se borra, se
  // desmarca y se queda para la proxima compra.
  recurring: boolean;
  // Seccion de la lista a la que pertenece («Aldi», «Para mamá»...); '' o
  // ausente = sin seccion. Ver sections en PersonalList/CurrentList.
  section?: string;
}

export interface PersonalList {
  id: string;
  name: string;
  // Secciones definidas por el usuario, en su orden (ver lista-compra-api
  // sections.js). Ausente en la cache antigua de localStorage.
  sections?: string[];
  items: Item[];
}

export interface GroupList {
  id: string;
  name: string;
  ownerId: string;
  listId: string;
  memberCount: number;
  isOwner: boolean;
}

// Vista unificada que consumen los componentes, sea la lista personal
// actual o la de un grupo (ver ListStateService#currentList).
export interface CurrentList {
  id: string;
  name: string;
  items: Item[];
  sections: string[];
  remote: boolean;
}

export interface PriceResult {
  product: string;
  supermarket: string;
  price_eur: number | null;
  /** Producto de la tienda elegido para lo apuntado. */
  match_name: string | null;
  /** «0.96 €/L»: lo que permite comparar formatos distintos. */
  unit_price: string | null;
  unit_price_eur: number | null;
  unit: string | null;
  promo: boolean;
  /** Unidades que se suman al total (la cantidad, si es un número). */
  units: number;
  note: string;
  source_url: string | null;
}

export interface PriceTotal {
  supermarket: string;
  total_eur: number;
  found: number;
  of: number;
}

export interface PricesResponse {
  generated_at: string;
  disclaimer: string;
  totals: PriceTotal[];
  results: PriceResult[];
}

export interface Profile {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  accountConsoleUrl: string;
}
