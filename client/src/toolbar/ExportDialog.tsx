import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../app/Dialog";
import { getCanvasApi, toast, ui } from "../app/uiStore";
import {
  alphabeticalList,
  composeFloorPlan,
  downloadBlob,
  downloadFloorPlanPdf,
  downloadPlanJson,
  fileSafe,
  tableLists,
  toCsv,
} from "../lib/export";
import { migratePlan, PlanFormatError } from "../lib/migrate";
import { usePlan, usePlanStats, useSeating, useSession } from "../store/hooks";

export function ExportDialog({ editable }: { editable: boolean }) {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const plan = usePlan();
  const seating = useSeating();
  const stats = usePlanStats();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const close = () => ui.set({ dialog: null });
  const title = plan.name || t("defaults.planName");

  /** Clears selection highlights, waits until that is drawn, then captures the plan. */
  const planImage = async () => {
    ui.set({ selection: null, pickedGuestId: null });
    await new Promise((r) => setTimeout(() => requestAnimationFrame(() => r(null)), 30));
    return getCanvasApi()?.renderImage(2) ?? null;
  };

  const pdf = async () => {
    setBusy(true);
    try {
      const image = await planImage();
      if (!image) return;
      const date = plan.date ? new Date(plan.date + "T00:00:00").toLocaleDateString(i18n.language, { dateStyle: "long" }) : "";
      const subtitle = [date, t("print.summary", { seated: stats.seated, guests: stats.guests, tables: Object.keys(plan.tables).length })]
        .filter(Boolean)
        .join(" · ");
      const canvas = await composeFloorPlan(image, title, subtitle);
      await downloadFloorPlanPdf(canvas, `${fileSafe(title)}-${t("export.floorPlanFile")}.pdf`);
    } catch (err) {
      console.error(err);
      toast(t("export.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const printPlan = async () => {
    const image = await planImage();
    if (image) ui.set({ dialog: null, printJob: { kind: "plan", image: image.url } });
  };

  const csvAlphabetical = () => {
    const rows = [[t("guest.name"), t("print.table"), t("print.seat"), t("guest.group"), t("guest.child"), t("guest.note")]];
    for (const e of alphabeticalList(plan, seating, i18n.language)) {
      rows.push([e.guest.name, e.table?.label ?? "", e.seat ? String(e.seat) : "", e.groupName ?? "", e.guest.isChild ? "✓" : "", e.guest.note ?? ""]);
    }
    downloadBlob(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }), `${fileSafe(title)}-${t("export.guestsFile")}.csv`);
  };

  const csvTables = () => {
    const rows = [[t("print.table"), t("print.seat"), t("guest.name"), t("guest.child"), t("guest.note")]];
    for (const { table, seats } of tableLists(plan, seating, i18n.language)) {
      for (const { index, guest } of seats) {
        rows.push([table.label, String(index + 1), guest?.name ?? "", guest?.isChild ? "✓" : "", guest?.note ?? ""]);
      }
    }
    downloadBlob(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }), `${fileSafe(title)}-${t("export.tablesFile")}.csv`);
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const plan = migratePlan(JSON.parse(await file.text()));
      if (!confirm(t("export.confirmImport"))) return;
      session.replacePlan(plan);
      toast(t("export.imported"));
      getCanvasApi()?.fitToContent();
      close();
    } catch (err) {
      toast(err instanceof PlanFormatError && err.message === "newer_version" ? t("export.newerVersion") : t("export.badFile"), "error", 8000);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Dialog title={t("export.title")} onClose={close}>
      <div className="export-grid">
        <h3>{t("export.floorPlan")}</h3>
        <button className="primary" onClick={pdf} disabled={busy} data-testid="export-pdf">
          {busy ? t("export.working") : t("export.pdf")}
        </button>
        <button onClick={printPlan}>{t("export.printPlan")}</button>

        <h3>{t("export.lists")}</h3>
        <button onClick={() => ui.set({ dialog: null, printJob: { kind: "alphabetical" } })} data-testid="print-alpha">
          {t("export.printAlpha")}
        </button>
        <button onClick={() => ui.set({ dialog: null, printJob: { kind: "tables" } })} data-testid="print-tables">
          {t("export.printTables")}
        </button>
        <button onClick={csvAlphabetical}>{t("export.csvAlpha")}</button>
        <button onClick={csvTables}>{t("export.csvTables")}</button>
        <p className="hint">{t("export.printHint")}</p>

        <h3>{t("export.planFile")}</h3>
        <button onClick={() => downloadPlanJson(plan)} data-testid="export-json">
          {t("export.json")}
        </button>
        {editable && (
          <label className="button file-button">
            {t("export.importJson")}
            <input ref={fileRef} type="file" accept=".json,application/json" onChange={(e) => importJson(e.target.files?.[0])} data-testid="import-json" />
          </label>
        )}
      </div>
    </Dialog>
  );
}
