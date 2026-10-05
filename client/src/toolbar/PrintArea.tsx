import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ui } from "../app/uiStore";
import { alphabeticalList, byInitial, tableLists } from "../lib/export";
import { usePlan, usePlanStats, useSeating } from "../store/hooks";

/** Hidden on screen; the only thing visible when printing (see @media print in styles.css). */
export function PrintArea() {
  const { t, i18n } = useTranslation();
  const job = ui.use((s) => s.printJob);
  const plan = usePlan();
  const seating = useSeating();
  const stats = usePlanStats();

  useEffect(() => {
    if (!job) return;
    const done = () => ui.set({ printJob: null });
    window.addEventListener("afterprint", done, { once: true });
    // Let React paint the print content (and the image decode) before opening the dialog.
    const timer = setTimeout(() => window.print(), 150);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("afterprint", done);
    };
  }, [job]);

  if (!job) return null;
  const title = plan.name || t("defaults.planName");
  const date = plan.date ? new Date(plan.date + "T00:00:00").toLocaleDateString(i18n.language, { dateStyle: "long" }) : "";

  return (
    <div className="print-area" data-testid="print-area">
      <header className="print-header">
        <h1>{title}</h1>
        <p>
          {date && <>{date} · </>}
          {t("print.summary", { seated: stats.seated, guests: stats.guests, tables: Object.keys(plan.tables).length })}
        </p>
      </header>

      {job.kind === "plan" && <img className="print-plan" src={job.image} alt={t("print.floorPlan")} />}

      {job.kind === "alphabetical" && (
        <div className="print-alpha">
          {byInitial(alphabeticalList(plan, seating, i18n.language)).map(({ letter, entries }) => (
            <section key={letter}>
              <h2>{letter}</h2>
              <ul>
                {entries.map((e) => (
                  <li key={e.guest.id}>
                    <span className="name">{e.guest.name}</span>
                    <span className="leader" />
                    <span className="table">{e.table ? e.table.label : t("print.noTable")}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {job.kind === "tables" && (
        <div className="print-tables">
          {tableLists(plan, seating, i18n.language).map(({ table, stats: s, seats }) => (
            <section key={table.id}>
              <h2>
                {table.label}
                <small>
                  {t("print.tableStats", { seated: s.seated, total: table.seatCount, adults: s.adults, children: s.children })}
                </small>
              </h2>
              <ol>
                {seats.map(({ index, guest }) => (
                  <li key={index} className={guest ? "" : "empty"}>
                    <span className="seat-no">{index + 1}.</span>
                    <span>
                      {guest ? guest.name : "—"}
                      {guest?.isChild && <em> ({t("guest.child")})</em>}
                      {guest?.note && <span className="note"> · {guest.note}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
