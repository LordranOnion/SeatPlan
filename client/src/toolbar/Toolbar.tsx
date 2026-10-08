import { useTranslation } from "react-i18next";
import { Menu } from "../app/Dialog";
import { getCanvasApi, ui } from "../app/uiStore";
import { sharingEnabled } from "../lib/sync";
import { OnlineList } from "../presence/OnlineList";
import { addFixture, addTable } from "../store/actions";
import { usePlan, usePlanStats, useSession, useStatus } from "../store/hooks";
import type { TableShape } from "../types";

const FIXTURES: { key: string; width: number; height: number }[] = [
  { key: "danceFloor", width: 300, height: 240 },
  { key: "buffet", width: 320, height: 80 },
  { key: "stage", width: 360, height: 140 },
  { key: "entrance", width: 140, height: 40 },
  { key: "bar", width: 220, height: 70 },
  { key: "dj", width: 120, height: 80 },
];

export function Toolbar({ editable }: { editable: boolean }) {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const plan = usePlan();
  const status = useStatus();
  const stats = usePlanStats();

  const center = () => getCanvasApi()?.viewCenter() ?? { x: plan.room.width / 2, y: plan.room.height / 2 };
  const newTable = (shape: TableShape) => {
    const id = addTable(session.doc, shape, center(), t("defaults.table"));
    ui.set({ selection: { kind: "table", id } });
  };
  const newFixture = (key: string, width: number, height: number) => {
    const id = addFixture(session.doc, t(`fixtures.${key}`), center(), { width, height });
    ui.set({ selection: { kind: "fixture", id } });
  };
  const shared = !!status.share || session.target.kind === "room";

  return (
    <header className="toolbar">
      <button className="icon-btn" onClick={() => ui.set((s) => ({ sidebarOpen: !s.sidebarOpen }))} aria-label={t("toolbar.toggleList")} title={t("toolbar.toggleList")}>
        ☰
      </button>
      <button className="plan-name" onClick={() => ui.set({ dialog: { type: "settings" } })} title={t("toolbar.planSettings")}>
        <strong>{plan.name || t("defaults.planName")}</strong>
        {plan.date && <small>{new Date(plan.date + "T00:00:00").toLocaleDateString(i18n.language)}</small>}
      </button>

      {editable && (
        <div className="group">
          <Menu label={t("toolbar.addTable")} testId="add-table">
            <button role="menuitem" onClick={() => newTable("round")} data-testid="add-round">
              ◯ {t("shapes.round")}
            </button>
            <button role="menuitem" onClick={() => newTable("rect")} data-testid="add-rect">
              ▭ {t("shapes.rect")}
            </button>
            <button role="menuitem" onClick={() => newTable("banquet")} data-testid="add-banquet">
              ▬ {t("shapes.banquet")}
            </button>
            <button role="menuitem" onClick={() => newTable("u")} data-testid="add-u">
              Π {t("shapes.u")}
            </button>
          </Menu>
          <Menu label={t("toolbar.addObject")} testId="add-object">
            {FIXTURES.map((f) => (
              <button key={f.key} role="menuitem" onClick={() => newFixture(f.key, f.width, f.height)}>
                {t(`fixtures.${f.key}`)}
              </button>
            ))}
          </Menu>
          <button onClick={() => session.undo.undo()} disabled={!status.canUndo} title={t("toolbar.undo")} aria-label={t("toolbar.undo")} data-testid="undo">
            ↶
          </button>
          <button onClick={() => session.undo.redo()} disabled={!status.canRedo} title={t("toolbar.redo")} aria-label={t("toolbar.redo")} data-testid="redo">
            ↷
          </button>
        </div>
      )}

      <div className="group zoom">
        <button onClick={() => getCanvasApi()?.zoomBy(1 / 1.25)} aria-label={t("toolbar.zoomOut")} title={t("toolbar.zoomOut")}>
          −
        </button>
        <button onClick={() => getCanvasApi()?.fitToContent()} title={t("toolbar.fit")}>
          {t("toolbar.fitShort")}
        </button>
        <button onClick={() => getCanvasApi()?.zoomBy(1.25)} aria-label={t("toolbar.zoomIn")} title={t("toolbar.zoomIn")}>
          +
        </button>
      </div>

      <div className="counters" data-testid="counters">
        <span title={t("toolbar.seatedTitle")}>
          {t("toolbar.seated")} <strong data-testid="seated-count">{stats.seated}/{stats.guests}</strong>
        </span>
        <span title={t("toolbar.freeTitle")}>
          {t("toolbar.free")} <strong>{stats.freeSeats}</strong>
        </span>
      </div>

      <span className="spacer" />
      <OnlineList />

      {(shared || sharingEnabled()) && (
        <button className={`share-btn ${shared ? "shared" : ""}`} onClick={() => ui.set({ dialog: { type: "share" } })} data-testid="share">
          {shared && <span className={`status-dot ${status.connection}`} aria-hidden="true" />}
          {shared ? t("toolbar.shared") : t("toolbar.share")}
        </button>
      )}
      <button onClick={() => ui.set({ dialog: { type: "export" } })} data-testid="export">
        {t("toolbar.export")}
      </button>
      <button
        className="lang"
        onClick={() => void i18n.changeLanguage(i18n.language.startsWith("el") ? "en" : "el")}
        title={t("toolbar.language")}
        data-testid="lang"
      >
        {i18n.language.startsWith("el") ? "EN" : "ΕΛ"}
      </button>
    </header>
  );
}
