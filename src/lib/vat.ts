// Puhdas ALV-logiikka: laskenta, jaksot, validointi, tallennus ja CSV.
import { z } from "zod";

export const YEAR = 2026;
export const STORAGE_KEY = "alv-report-2026-v1";

/** Verohallinto, voimassa 1.1.2026 alkaen. */
export const VAT_RATES = [
  { value: 25.5, label: "25,5 % – yleinen" },
  { value: 13.5, label: "13,5 % – alennettu" },
  { value: 10, label: "10 % – sanoma- ja aikakauslehdet" },
  { value: 0, label: "0 % – veroton / nollaverokanta" },
] as const;
export const ALLOWED_RATES: number[] = VAT_RATES.map((r) => r.value);

export type Kind = "sale" | "purchase";
export type PriceType = "gross" | "net";
export type PeriodType = "month" | "quarter" | "year";

export interface Item {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // euroa, syötetty summa
  rate: number;
  kind: Kind;
  priceType: PriceType;
}

export interface Calc { net: number; vat: number; total: number }

const toCents = (eur: number) => Math.round(eur * 100 + Number.EPSILON * Math.sign(eur));
const fromCents = (c: number) => c / 100;

/** Rivikohtainen laskenta senttien tarkkuudella. Verollisesta summasta veroton + ALV = syötetty summa. */
export function calcCents(x: Pick<Item, "amount" | "rate" | "priceType">) {
  const a = toCents(x.amount);
  const r = x.rate / 100;
  if (x.priceType === "gross") {
    const net = Math.round(a / (1 + r));
    return { net, vat: a - net, total: a };
  }
  const vat = Math.round(a * r);
  return { net: a, vat, total: a + vat };
}

export function calc(x: Pick<Item, "amount" | "rate" | "priceType">): Calc {
  const c = calcCents(x);
  return { net: fromCents(c.net), vat: fromCents(c.vat), total: fromCents(c.total) };
}

export function summarize(items: Item[]) {
  let sales = 0, purchases = 0;
  for (const x of items) {
    const c = calcCents(x);
    if (x.kind === "sale") sales += c.vat; else purchases += c.vat;
  }
  const balance = sales - purchases;
  return { salesVat: fromCents(sales), purchaseVat: fromCents(purchases), balance: fromCents(balance), payable: balance >= 0 };
}

export function periodOptions(type: PeriodType): { value: string; label: string }[] {
  if (type === "month")
    return Array.from({ length: 12 }, (_, i) => ({
      value: `${YEAR}-${String(i + 1).padStart(2, "0")}`,
      label: new Date(YEAR, i, 1).toLocaleDateString("fi-FI", { month: "long", year: "numeric" }),
    }));
  if (type === "quarter")
    return [1, 2, 3, 4].map((q) => ({ value: `${YEAR}-Q${q}`, label: `${q}. neljännes ${YEAR}` }));
  return [{ value: String(YEAR), label: `Vuosi ${YEAR}` }];
}

export function defaultPeriod(type: PeriodType) { return periodOptions(type)[0]?.value ?? String(YEAR); }

export function isInPeriod(date: string, type: PeriodType, value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.slice(0, 4) !== String(YEAR)) return false;
  const m = Number(date.slice(5, 7));
  if (type === "year") return true;
  if (type === "month") return date.slice(0, 7) === value;
  return value === `${YEAR}-Q${Math.ceil(m / 3)}`;
}

/** Hyväksyy muodot 1234,56 · 1 234,56 · 1234.56 · 1.234,56 */
export function parseAmount(raw: string): number | null {
  let s = raw.trim().replace(/[\s\u00a0€]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Y-tunnuksen muoto ja tarkistusmerkki (painot 7,9,10,5,8,4,2; mod 11). */
export function isValidBusinessId(id: string) {
  const m = /^(\d{7})-(\d)$/.exec(id.trim());
  if (!m) return false;
  const w = [7, 9, 10, 5, 8, 4, 2];
  const sum = (m[1] ?? "").split("").reduce((s, d, i) => s + Number(d) * (w[i] ?? 0), 0);
  const r = sum % 11;
  if (r === 1) return false;
  return (r === 0 ? 0 : 11 - r) === Number(m[2]);
}

function isRealDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const MAX_AMOUNT = 999_999_999.99;

export interface EntryInput { date: string; description: string; amount: string; rate: number; kind: Kind; priceType: PriceType }
export type EntryErrors = Partial<Record<"date" | "description" | "amount" | "rate", string | undefined>>;

export function validateEntry(input: EntryInput): { ok: true; value: Omit<Item, "id"> } | { ok: false; errors: EntryErrors } {
  const errors: EntryErrors = {};
  if (!input.date) errors.date = "Valitse päivämäärä.";
  else if (!isRealDate(input.date)) errors.date = "Päivämäärä ei ole kelvollinen.";
  else if (input.date.slice(0, 4) !== String(YEAR)) errors.date = `Laskuri on vuodelle ${YEAR}. Valitse päivä väliltä 1.1.–31.12.${YEAR}.`;
  const desc = input.description.trim();
  if (!desc) errors.description = "Kirjoita lyhyt kuvaus.";
  else if (desc.length > 120) errors.description = "Kuvaus saa olla enintään 120 merkkiä.";
  const amount = parseAmount(input.amount);
  if (!input.amount.trim()) errors.amount = "Syötä summa.";
  else if (/^-/.test(input.amount.trim())) errors.amount = "Summa ei voi olla negatiivinen. Hyvityksen voit kirjata vastakkaisena tapahtumana.";
  else if (amount === null) errors.amount = "Syötä summa numeroina, enintään kaksi desimaalia (esim. 1 234,50).";
  else if (amount > MAX_AMOUNT) errors.amount = "Summa on liian suuri.";
  if (!ALLOWED_RATES.includes(input.rate)) errors.rate = "Valitse ALV-kanta listasta.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { date: input.date, description: desc, amount: amount!, rate: input.rate, kind: input.kind, priceType: input.priceType } };
}

const itemSchema = z.object({
  id: z.string().min(1).max(100),
  date: z.string().refine(isRealDate),
  description: z.string().max(500),
  amount: z.number().finite().min(0).max(MAX_AMOUNT),
  rate: z.number().refine((r) => ALLOWED_RATES.includes(r)),
  kind: z.enum(["sale", "purchase"]),
  priceType: z.enum(["gross", "net"]),
});

export interface SavedState { items: Item[]; periodType: PeriodType; periodValue: string; businessName: string; businessId: string }

/** Lukee tallennetun tilan; virheelliset rivit ohitetaan eikä koko tallennus katoa. */
export function parseSaved(raw: string | null): { state: SavedState | null; skipped: number } {
  if (!raw) return { state: null, skipped: 0 };
  let s: any;
  try { s = JSON.parse(raw); } catch { return { state: null, skipped: 0 }; }
  if (!s || typeof s !== "object") return { state: null, skipped: 0 };
  const rawItems: unknown[] = Array.isArray(s.items) ? s.items : [];
  const items: Item[] = [];
  for (const r of rawItems) {
    const p = itemSchema.safeParse(r);
    if (p.success) items.push(p.data as Item);
  }
  const periodType: PeriodType = ["month", "quarter", "year"].includes(s.periodType) ? s.periodType : "year";
  const opts = periodOptions(periodType).map((o) => o.value);
  return {
    state: {
      items, periodType,
      periodValue: opts.includes(s.periodValue) ? s.periodValue : (opts[0] ?? String(YEAR)),
      businessName: typeof s.businessName === "string" ? s.businessName.slice(0, 100) : "",
      businessId: typeof s.businessId === "string" ? s.businessId.slice(0, 20) : "",
    },
    skipped: rawItems.length - items.length,
  };
}

const fiNum = (n: number) => n.toFixed(2).replace(".", ",");
/** Excel (suomi): BOM, puolipiste-erotin, desimaalipilkku, CRLF. Kaavoiksi tulkittavat solut suojataan. */
export function buildCsv(items: Item[]) {
  const rows: string[][] = [["Päivämäärä", "Tyyppi", "Kuvaus", "Veroton hinta (€)", "ALV-kanta (%)", "ALV (€)", "Yhteensä (€)"]];
  for (const x of items) {
    const c = calc(x);
    const desc = /^[=+\-@\t\r]/.test(x.description) ? "'" + x.description : x.description;
    rows.push([x.date, x.kind === "sale" ? "Myynti" : "Osto", desc, fiNum(c.net), String(x.rate).replace(".", ","), fiNum(c.vat), fiNum(c.total)]);
  }
  const s = summarize(items);
  rows.push([], ["Myyntien ALV yhteensä", "", "", "", "", fiNum(s.salesVat), ""],
    ["Vähennettävien ostojen ALV", "", "", "", "", fiNum(s.purchaseVat), ""],
    [s.payable ? "Maksettava ALV" : "Palautukseen oikeuttava ALV", "", "", "", "", fiNum(Math.abs(s.balance)), ""]);
  return "\uFEFF" + rows.map((r) => r.map((v) => '"' + v.replace(/"/g, '""') + '"').join(";")).join("\r\n");
}

export const money = (n: number) => new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR" }).format(n || 0);
export const fiDate = (iso: string) => { const [y, m, d] = iso.split("-"); return `${Number(d)}.${Number(m)}.${y}`; };
