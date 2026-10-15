import { IconName } from './icon.component';

export interface Category {
  key: string;
  label: string;
  icon: IconName;
  kw: string[];
}

// Orden = recorrido tipico de supermercado.
export const CATS: Category[] = [
  { key: 'fruver', label: 'Frutas y verduras', icon: 'leaf', kw: ['manzana','platano','plátano','naranja','pera','uva','fresa','tomate','lechuga','cebolla','ajo','patata','papa','zanahoria','pepino','pimiento','aguacate','limon','limón','kiwi','melon','melón','sandia','sandía','brocoli','brócoli','espinaca','calabacin','calabacín','champiñon','champiñón','seta','fruta','verdura','ensalada'] },
  { key: 'pan', label: 'Panadería', icon: 'bread', kw: ['pan','baguette','barra de pan','bolleria','bollería','croissant','magdalena','tostada'] },
  { key: 'lacteos', label: 'Lácteos y huevos', icon: 'milk', kw: ['leche','yogur','yogurt','queso','mantequilla','nata','huevo','huevos','margarina','requeson','requesón','cuajada'] },
  { key: 'carne', label: 'Carnicería y pescadería', icon: 'meat', kw: ['pollo','carne','ternera','cerdo','jamon','jamón','chorizo','salchicha','pescado','salmon','salmón','atun','atún','merluza','gamba','langostino','bacon','panceta','filete','lomo','marisco'] },
  { key: 'despensa', label: 'Despensa', icon: 'jar', kw: ['arroz','pasta','macarrones','espagueti','harina','azucar','azúcar','sal','aceite','vinagre','legumbre','lenteja','garbanzo','alubia','conserva','salsa','especia','cafe','café',' te ','té','cereales','galleta','miel','chocolate'] },
  { key: 'congelados', label: 'Congelados', icon: 'snowflake', kw: ['congelado','helado','pizza'] },
  { key: 'bebidas', label: 'Bebidas', icon: 'cup', kw: ['agua','vino','cerveza','zumo','refresco','cola','bebida','licor'] },
  { key: 'limpieza', label: 'Limpieza y hogar', icon: 'bottle', kw: ['detergente','lejia','lejía','suavizante','friegasuelos','papel higienico','papel higiénico','servilleta','bolsa de basura','estropajo','fregona','limpiador'] },
  { key: 'higiene', label: 'Higiene y cuidado personal', icon: 'soap', kw: ['champu','champú','gel de ducha','jabon','jabón','pasta de dientes','dentifrico','dentífrico','desodorante','compresa','tampon','tampón','cuchilla','maquinilla'] },
  { key: 'otros', label: 'Otros', icon: 'cart', kw: [] },
];

// Rango Unicode de marcas diacriticas combinantes (usadas por
// String.normalize("NFD") para separar una letra con tilde en letra base +
// marca). Construido desde un string de escape, no como regex literal: en
// forma literal, los caracteres combinantes de verdad quedarian
// incrustados en el fichero fuente.
const DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g');

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(DIACRITICS_RE, '');
}

export function detectCategory(name: string): string {
  const n = normalize(name);
  for (const cat of CATS) {
    if (cat.kw.some((k) => n.includes(normalize(k)))) return cat.key;
  }
  return 'otros';
}
