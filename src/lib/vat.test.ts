import { describe, expect, it } from "vitest";
import { buildCsv, calc, isInPeriod, isValidBusinessId, parseAmount, parseSaved, summarize, validateEntry, type Item } from "./vat";

const item = (p: Partial<Item>): Item => ({ id: "1", date: "2026-05-10", description: "x", amount: 100, rate: 25.5, kind: "sale", priceType: "net", ...p });

describe("ALV-laskenta", () => {
  it("veroton 100 € @ 25,5 % → ALV 25,50, yhteensä 125,50", () => expect(calc(item({}))).toEqual({ net: 100, vat: 25.5, total: 125.5 }));
  it("verollinen 125,50 € @ 25,5 % → veroton 100,00", () => expect(calc(item({ amount: 125.5, priceType: "gross" }))).toEqual({ net: 100, vat: 25.5, total: 125.5 }));
  it("verollinen 100 € @ 13,5 % → 88,11 + 11,89", () => expect(calc(item({ rate: 13.5, priceType: "gross" }))).toEqual({ net: 88.11, vat: 11.89, total: 100 }));
  it("verollinen 10 € @ 10 % → 9,09 + 0,91", () => expect(calc(item({ amount: 10, rate: 10, priceType: "gross" }))).toEqual({ net: 9.09, vat: 0.91, total: 10 }));
  it("0 % → ei veroa", () => expect(calc(item({ rate: 0, amount: 50, priceType: "gross" }))).toEqual({ net: 50, vat: 0, total: 50 }));
  it("pyöristys puoli senttiä ylöspäin: 0,02 € @ 25,5 % → ALV 0,01", () => expect(calc(item({ amount: 0.02 })).vat).toBe(0.01));
  it("verollisen rivin osat summautuvat aina syötettyyn summaan", () => {
    for (const a of [0.01, 1.99, 12.34, 999.99]) for (const r of [25.5, 13.5, 10]) {
      const c = calc(item({ amount: a, rate: r, priceType: "gross" }));
      expect(Math.round((c.net + c.vat) * 100)).toBe(Math.round(a * 100));
    }
  });
  it("yhteenveto: myynti 25,50 − osto 11,89 = maksettava 13,61", () => {
    const s = summarize([item({}), item({ kind: "purchase", rate: 13.5, priceType: "gross" })]);
    expect(s).toEqual({ salesVat: 25.5, purchaseVat: 11.89, balance: 13.61, payable: true });
  });
  it("ei liukulukuvirhettä: 3 × 0,10 € @ 25,5 %", () => expect(summarize([0, 1, 2].map((i) => item({ id: String(i), amount: 0.1 }))).salesVat).toBe(0.09));
  it("ostot suuremmat → palautukseen oikeuttava", () => expect(summarize([item({ kind: "purchase" })]).payable).toBe(false));
});

describe("Tarkastelujaksot", () => {
  it("kuukausi", () => { expect(isInPeriod("2026-03-31", "month", "2026-03")).toBe(true); expect(isInPeriod("2026-04-01", "month", "2026-03")).toBe(false); });
  it("neljännes: maaliskuu Q1, huhtikuu Q2, joulukuu Q4", () => {
    expect(isInPeriod("2026-03-31", "quarter", "2026-Q1")).toBe(true);
    expect(isInPeriod("2026-04-01", "quarter", "2026-Q1")).toBe(false);
    expect(isInPeriod("2026-12-31", "quarter", "2026-Q4")).toBe(true);
  });
  it("vuosi sisältää vain 2026", () => { expect(isInPeriod("2026-01-01", "year", "2026")).toBe(true); expect(isInPeriod("2025-12-31", "year", "2026")).toBe(false); });
});

describe("Validointi", () => {
  const base = { date: "2026-02-01", description: "Työ", amount: "100", rate: 25.5, kind: "sale" as const, priceType: "net" as const };
  it("suomalaiset summamuodot", () => { expect(parseAmount("1 234,56")).toBe(1234.56); expect(parseAmount("1.234,56")).toBe(1234.56); expect(parseAmount("12.5")).toBe(12.5); expect(parseAmount("1,234")).toBeNull(); expect(parseAmount("abc")).toBeNull(); });
  it("hylkää negatiivisen summan", () => expect(validateEntry({ ...base, amount: "-5" }).ok).toBe(false));
  it("hylkää muun vuoden päivän", () => expect(validateEntry({ ...base, date: "2025-12-31" }).ok).toBe(false));
  it("hylkää tyhjän kuvauksen", () => expect(validateEntry({ ...base, description: "  " }).ok).toBe(false));
  it("hylkää tuntemattoman ALV-kannan (esim. vanha 14 %)", () => expect(validateEntry({ ...base, rate: 14 }).ok).toBe(false));
  it("hyväksyy kelvollisen", () => expect(validateEntry(base).ok).toBe(true));
  it("Y-tunnuksen tarkistusmerkki", () => { expect(isValidBusinessId("0201256-6")).toBe(true); expect(isValidBusinessId("0201256-5")).toBe(false); expect(isValidBusinessId("1234567")).toBe(false); });
});

describe("Tallennus ja CSV", () => {
  it("lukee vanhan tallennuksen ja ohittaa virheelliset rivit", () => {
    const r = parseSaved(JSON.stringify({ items: [item({}), { id: "bad" }], periodType: "quarter", periodValue: "2026-Q2" }));
    expect(r.state?.items).toHaveLength(1); expect(r.skipped).toBe(1); expect(r.state?.periodValue).toBe("2026-Q2");
  });
  it("rikkinäinen JSON ei kaada", () => expect(parseSaved("{").state).toBeNull());
  it("CSV: BOM, puolipiste, desimaalipilkku, kaavasuojaus", () => {
    const csv = buildCsv([item({ description: "=SUM(A1)" })]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"100,00";"25,5";"25,50";"125,50"');
    expect(csv).toContain(`"'=SUM(A1)"`);
  });
});
