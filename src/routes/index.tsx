import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Plus, Printer, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  STORAGE_KEY, VAT_RATES, YEAR, buildCsv, calc, defaultPeriod, fiDate, isInPeriod, isValidBusinessId,
  money, parseSaved, periodOptions, summarize, validateEntry,
  type EntryErrors, type Item, type Kind, type PeriodType, type PriceType,
} from "@/lib/vat";

const TITLE = "ALV-vähennys & Raporttilaskuri 2026 – Laske ja tulosta ALV-erittely";
const DESC = "ALV-laskuri pienyrittäjälle: myynnit, vähennyskelpoiset ostot ja tulostettava raportti vuoden 2026 verokannoilla.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE }, { name: "description", content: DESC },
      { property: "og:title", content: TITLE }, { property: "og:description", content: DESC },
      { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

const today = () => {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return iso.startsWith(String(YEAR)) ? iso : "";
};
const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

function Index() {
  const [items, setItems] = useState<Item[]>([]);
  const [periodType, setPeriodType] = useState<PeriodType>("year");
  const [periodValue, setPeriodValue] = useState(String(YEAR));
  const [businessName, setBusinessName] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [kind, setKind] = useState<Kind>("sale");
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState(25.5);
  const [priceType, setPriceType] = useState<PriceType>("gross");
  const [errors, setErrors] = useState<EntryErrors>({});
  const [confirmClear, setConfirmClear] = useState(false);
  const [printedAt, setPrintedAt] = useState("");
  const refs = { date: useRef<HTMLInputElement>(null), description: useRef<HTMLInputElement>(null), amount: useRef<HTMLInputElement>(null) };

  useEffect(() => {
    setDate(today());
    setPrintedAt(new Date().toLocaleDateString("fi-FI"));
    let raw: string | null = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch { /* yksityistila */ }
    const { state, skipped } = parseSaved(raw);
    if (state) {
      setItems(state.items); setPeriodType(state.periodType); setPeriodValue(state.periodValue);
      setBusinessName(state.businessName); setBusinessId(state.businessId);
    }
    if (skipped) toast.warning(`${skipped} virheellistä tallennettua riviä ohitettiin.`);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, periodType, periodValue, businessName, businessId }));
    } catch { toast.error("Selaimeen tallennus ei onnistunut. Tiedot säilyvät vain tämän välilehden ajan."); }
  }, [loaded, items, periodType, periodValue, businessName, businessId]);

  const options = useMemo(() => periodOptions(periodType), [periodType]);
  const periodLabel = options.find((o) => o.value === periodValue)?.label ?? "";
  const visible = useMemo(
    () => items.filter((x) => isInPeriod(x.date, periodType, periodValue)).sort((a, b) => a.date.localeCompare(b.date)),
    [items, periodType, periodValue],
  );
  const sum = useMemo(() => summarize(visible), [visible]);
  const idInvalid = businessId.trim() !== "" && !isValidBusinessId(businessId);

  function add() {
    const r = validateEntry({ date, description, amount, rate, kind, priceType });
    if (!r.ok) {
      setErrors(r.errors);
      const first = (["date", "description", "amount"] as const).find((k) => r.errors[k]);
      if (first) refs[first].current?.focus();
      return;
    }
    setErrors({});
    setItems((p) => [...p, { id: newId(), ...r.value }]);
    setDescription(""); setAmount("");
    if (!isInPeriod(r.value.date, periodType, periodValue)) toast.success("Tapahtuma tallennettu. Se ei kuulu valittuun jaksoon, joten se ei näy listalla.");
    else toast.success("Tapahtuma lisätty ja tallennettu.");
  }

  function exportCsv() {
    if (!visible.length) { toast.error("Valitulla jaksolla ei ole vietäviä tapahtumia."); return; }
    const url = URL.createObjectURL(new Blob([buildCsv(visible)], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url; a.download = `alv-raportti-${periodValue}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function printReport() {
    setPrintedAt(new Date().toLocaleDateString("fi-FI"));
    setTimeout(() => window.print(), 50);
  }

  const err = (k: keyof EntryErrors) => errors[k] && <p id={`${k}-err`} className="field-error" role="alert">{errors[k]}</p>;

  return (
    <div className="min-h-screen">
      <header className="app-header px-4 pb-10 pt-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-bold uppercase tracking-[0.13em] text-on-navy-accent">Pienyrittäjän taloustyökalu</p>
          <h1 className="my-2 text-3xl font-bold leading-tight sm:text-4xl">ALV-vähennys &amp; Raporttilaskuri 2026</h1>
          <p className="max-w-2xl text-on-navy-muted">Kokoa myynnit ja vähennyskelpoiset ostot, tarkista arvonlisävero ja tulosta selkeä kausiraportti.</p>
        </div>
      </header>

      <main className="mx-auto -mt-5 max-w-5xl space-y-4 px-3 pb-10 sm:px-4">
        <section className="panel no-print">
          <h2 className="panel-title">1. Kauden ja raportin tiedot</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="field-label" htmlFor="periodType">Tarkastelujakso</label>
              <select id="periodType" className="control" value={periodType}
                onChange={(e) => { const t = e.target.value as PeriodType; setPeriodType(t); setPeriodValue(defaultPeriod(t)); }}>
                <option value="month">Kuukausi</option><option value="quarter">Neljännesvuosi</option><option value="year">Vuosi</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label" htmlFor="periodValue">Valitse jakso</label>
              <select id="periodValue" className="control" value={periodValue} onChange={(e) => setPeriodValue(e.target.value)}>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label" htmlFor="businessName">Yrityksen / toiminimen nimi (vapaaehtoinen)</label>
              <input id="businessName" className="control" maxLength={100} placeholder="Yrityksen nimi" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label" htmlFor="businessId">Y-tunnus (vapaaehtoinen)</label>
              <input id="businessId" className="control" maxLength={9} placeholder="1234567-8" value={businessId}
                aria-invalid={idInvalid} aria-describedby={idInvalid ? "bid-err" : undefined} onChange={(e) => setBusinessId(e.target.value)} />
              {idInvalid && <p id="bid-err" className="field-error">Y-tunnus näyttää virheelliseltä (muoto 1234567-8, tarkistusmerkki ei täsmää). Tarkista se ennen tulostusta.</p>}
            </div>
          </div>
        </section>

        <section className="panel no-print">
          <h2 className="panel-title">2. Lisää tapahtuma</h2>
          <form noValidate onSubmit={(e) => { e.preventDefault(); add(); }} className="grid gap-3 sm:grid-cols-2">
            <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
              <legend className="field-label mb-1.5">Tapahtuman tyyppi</legend>
              <div className="flex flex-wrap gap-2">
                <label className="seg"><input type="radio" name="kind" checked={kind === "sale"} onChange={() => setKind("sale")} /> Myynti (suoritettava ALV)</label>
                <label className="seg"><input type="radio" name="kind" checked={kind === "purchase"} onChange={() => setKind("purchase")} /> Osto / kulu (vähennettävä ALV)</label>
              </div>
            </fieldset>
            <div className="flex flex-col gap-1.5">
              <label className="field-label" htmlFor="eventDate">Päivämäärä</label>
              <input ref={refs.date} id="eventDate" type="date" className="control" min={`${YEAR}-01-01`} max={`${YEAR}-12-31`} value={date}
                aria-invalid={!!errors.date} aria-describedby={errors.date ? "date-err" : undefined}
                onChange={(e) => { setDate(e.target.value); setErrors((p) => ({ ...p, date: undefined })); }} />
              {err("date")}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label" htmlFor="description">Kuvaus</label>
              <input ref={refs.description} id="description" className="control" maxLength={120} placeholder="Esim. asiakastyö tai tietokoneen näyttö" value={description}
                aria-invalid={!!errors.description} aria-describedby={errors.description ? "description-err" : undefined}
                onChange={(e) => { setDescription(e.target.value); setErrors((p) => ({ ...p, description: undefined })); }} />
              {err("description")}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label" htmlFor="amount">Summa (€)</label>
              <input ref={refs.amount} id="amount" className="control" inputMode="decimal" autoComplete="off" placeholder="0,00" value={amount}
                aria-invalid={!!errors.amount} aria-describedby={errors.amount ? "amount-err" : undefined}
                onChange={(e) => { setAmount(e.target.value); setErrors((p) => ({ ...p, amount: undefined })); }} />
              {err("amount")}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label" htmlFor="vatRate">ALV-kanta</label>
              <select id="vatRate" className="control" value={rate} onChange={(e) => setRate(Number(e.target.value))}>
                {VAT_RATES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              {err("rate")}
            </div>
            <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
              <legend className="field-label mb-1.5">Syötetyn summan tyyppi</legend>
              <div className="flex flex-wrap gap-2">
                <label className="seg"><input type="radio" name="priceType" checked={priceType === "gross"} onChange={() => setPriceType("gross")} /> Sisältää ALV:n</label>
                <label className="seg"><input type="radio" name="priceType" checked={priceType === "net"} onChange={() => setPriceType("net")} /> Veroton hinta</label>
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button type="submit" className="btn btn-primary"><Plus className="size-4" /> Lisää listalle</button>
              <button type="button" className="btn btn-secondary" onClick={() => items.length ? setConfirmClear(true) : toast("Ei poistettavia rivejä.")}>Tyhjennä kaikki rivit</button>
            </div>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">Ostojen ALV käsitellään kokonaan vähennettävänä. Lisää ostoksi vain sellaiset kulut, joiden ALV on yrityksesi toiminnassa vähennyskelpoinen.</p>
        </section>

        <section className="panel">
          <div className="print-only mb-3">
            <h2 className="panel-title">ALV-erittely {YEAR}</h2>
            {(businessName || businessId) && <p>{[businessName, businessId && `Y-tunnus: ${businessId}`].filter(Boolean).join(" · ")}</p>}
            <p>Tarkastelujakso: {periodLabel}</p>
            <p>Tulostettu: {printedAt}</p>
          </div>
          <h2 className="panel-title">3. Tapahtumien erittely</h2>
          <div className="overflow-x-auto">
            <table className="data-table w-full border-collapse text-sm">
              <thead><tr><th>Päivä</th><th>Tyyppi</th><th>Kuvaus</th><th className="num">Veroton (€)</th><th className="num">ALV %</th><th className="num">ALV (€)</th><th className="num">Yhteensä (€)</th><th className="no-print"><span className="sr-only">Toiminnot</span></th></tr></thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={8} className="wide py-6 text-center text-muted-foreground">Ei tapahtumia valitulla kaudella.</td></tr>
                ) : visible.map((x) => {
                  const c = calc(x);
                  return (
                    <tr key={x.id}>
                      <td data-label="Päivä">{fiDate(x.date)}</td>
                      <td data-label="Tyyppi">{x.kind === "sale" ? "Myynti" : "Osto"}</td>
                      <td data-label="Kuvaus" className="wide break-words">{x.description}</td>
                      <td data-label="Veroton" className="num">{money(c.net)}</td>
                      <td data-label="ALV %" className="num">{x.rate.toLocaleString("fi-FI")} %</td>
                      <td data-label="ALV" className="num">{money(c.vat)}</td>
                      <td data-label="Yhteensä" className="num font-semibold">{money(c.total)}</td>
                      <td className="no-print"><button className="btn btn-danger" aria-label={`Poista ${x.description}`}
                        onClick={() => { setItems((p) => p.filter((i) => i.id !== x.id)); toast("Rivi poistettu."); }}><Trash2 className="size-3.5" /> Poista</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground no-print">{visible.length} tapahtumaa valitulla kaudella · {items.length} tallennettua tapahtumaa yhteensä</p>
        </section>

        <section className="panel">
          <h2 className="panel-title">4. ALV-yhteenveto</h2>
          <div className="summary-grid grid gap-3 sm:grid-cols-3">
            <div className="metric"><span className="block text-xs font-semibold text-muted-foreground">Myyntien ALV yhteensä</span><strong className="mt-1 block text-2xl text-navy tabular-nums">{money(sum.salesVat)}</strong></div>
            <div className="metric"><span className="block text-xs font-semibold text-muted-foreground">Vähennettävien ostojen ALV</span><strong className="mt-1 block text-2xl text-navy tabular-nums">{money(sum.purchaseVat)}</strong></div>
            <div className={`metric ${sum.payable ? "metric-good" : "metric-refund"}`} aria-live="polite">
              <span className="block text-xs font-semibold">{sum.payable ? "Maksettava ALV" : "Palautukseen oikeuttava ALV"}</span>
              <strong className="mt-1 block text-2xl tabular-nums">{money(Math.abs(sum.balance))}</strong>
            </div>
          </div>
          <p className="notice mt-3">Yksinkertaistettu laskelma: ei huomioi esimerkiksi käännettyä verovelvollisuutta, yhteisöhankintoja, marginaaliverotusta, osittaista vähennysoikeutta tai vähennysrajoituksia. ALV pyöristetään riveittäin senttiin.</p>
          <div className="no-print mt-4 flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={printReport}><Printer className="size-4" /> Tulosta raportti / Tallenna PDF</button>
            <button className="btn btn-secondary" onClick={exportCsv}><Download className="size-4" /> Lataa CSV (Excel)</button>
          </div>
          <p className="no-print mt-2 text-xs text-muted-foreground">PDF-tiedoston saat valitsemalla tulostusikkunassa tulostimeksi “Tallenna PDF”.</p>
        </section>

        <section className="panel no-print">
          <h2 className="panel-title">Usein kysytyt kysymykset (2026)</h2>
          {[
            ["Mitkä ovat Suomen ALV-kannat vuonna 2026?", "Yleinen verokanta on 25,5 %. Alennettu verokanta on 1.1.2026 alkaen 13,5 % (aiemmin 14 %) esimerkiksi elintarvikkeille, ravintolapalveluille, kirjoille, henkilökuljetuksille ja yleisradiotoiminnalle. 10 % koskee sanoma- ja aikakauslehtiä. Nollaverokantaa sovelletaan vain laissa määriteltyihin tilanteisiin. Tarkista oikea verokanta Verohallinnon ohjeista."],
            ["Mitä ostojen ALV:stä saa vähentää?", "Yleensä vähennyksen voi tehdä arvonlisäverollista liiketoimintaa varten tehdyistä hankinnoista asianmukaisen laskun perusteella. Yksityiskäyttöön ja vähennysrajoitusten alaisiin hankintoihin liittyy poikkeuksia. Tämä laskuri olettaa ostorivin ALV:n kokonaan vähennyskelpoiseksi."],
            ["Milloin ALV-ilmoitus tehdään OmaVerossa?", "Ilmoitus- ja maksupäivä riippuu verokaudesta. Kuukausiverokaudella määräpäivä on yleensä verokautta seuraavan toisen kuukauden 12. päivä. Tarkista oma määräpäivä OmaVerosta."],
          ].map(([q, a]) => (
            <details key={q} className="border-t border-border py-3">
              <summary className="cursor-pointer font-semibold text-navy">{q}</summary>
              <p className="mt-2 text-muted-foreground">{a}</p>
            </details>
          ))}
          <p className="mt-2 text-xs text-muted-foreground">Viralliset ohjeet:{" "}
            <a className="underline" href="https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/arvonlisaverotus/arvonlisaveroprosentit/" target="_blank" rel="noopener noreferrer">Verohallinnon ALV-prosentit</a> ·{" "}
            <a className="underline" href="https://www.vero.fi/omavero" target="_blank" rel="noopener noreferrer">OmaVero</a></p>
        </section>

        <section className="panel no-print">
          <h2 className="panel-title">Hyödylliset työkalut</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {[["https://www.vero.fi/omavero", "OmaVero ↗", "ALV-ilmoituksen lähetys"], ["https://www.ukko.fi/", "UKKO Yrittäjä ↗", "Toiminimen helppo kirjanpito"], ["https://www.holvi.com/fi/", "Holvi ↗", "Yritystili ja kuittien hallinta"]].map(([h, t, s]) => (
              <a key={h} href={h} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-border p-3.5 hover:bg-muted">
                <b className="block text-navy">{t}</b><span className="text-sm text-muted-foreground">{s}</span>
              </a>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Kumppanuuslinkki-ilmoitus: linkit ovat informatiivisia. Linkkien käyttö voi mahdollistaa kaupallisen yhteistyön; laskuri ei ole Verohallinnon palvelu.</p>
        </section>
      </main>

      <footer className="no-print px-4 pb-7 text-center text-xs text-muted-foreground">Laskuri on suuntaa-antava apuväline eikä korvaa virallista kirjanpitoa. Kaikki tiedot tallentuvat vain omaan selaimeesi.</footer>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Poistetaanko kaikki rivit?</AlertDialogTitle>
            <AlertDialogDescription>Kaikki {items.length} tallennettua tapahtumaa poistetaan kaikilta jaksoilta. Toimintoa ei voi perua.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Peruuta</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setItems([]); toast.success("Kaikki rivit tyhjennetty."); }}>Poista kaikki</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
