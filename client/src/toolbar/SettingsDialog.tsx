import { useTranslation } from "react-i18next";
import { Dialog } from "../app/Dialog";
import { getCanvasApi, ui } from "../app/uiStore";
import { NumberField } from "../canvas/Inspector";
import { newId } from "../lib/ids";
import { setPlanInfo, setRoom } from "../store/actions";
import { usePlan, useSession } from "../store/hooks";
import { DEFAULT_ROOM, SCHEMA_VERSION } from "../store/schema";

export function SettingsDialog({ editable }: { editable: boolean }) {
  const { t } = useTranslation();
  const session = useSession();
  const plan = usePlan();
  const room = plan.room;
  const close = () => ui.set({ dialog: null });

  const newPlan = () => {
    if (!confirm(t("settings.confirmNew"))) return;
    session.replacePlan({
      id: newId(),
      name: t("defaults.planName"),
      room: DEFAULT_ROOM,
      tables: {},
      fixtures: {},
      guests: {},
      groups: {},
      assignments: {},
      version: SCHEMA_VERSION,
    });
    ui.set({ selection: null, pickedGuestId: null });
    getCanvasApi()?.fitToContent();
    close();
  };

  return (
    <Dialog title={t("settings.title")} onClose={close}>
      <div className="form">
        <label className="field">
          <span>{t("settings.name")}</span>
          <input value={plan.name} disabled={!editable} onChange={(e) => setPlanInfo(session.doc, { name: e.target.value })} data-testid="plan-name" />
        </label>
        <label className="field">
          <span>{t("settings.date")}</span>
          <input type="date" value={plan.date ?? ""} disabled={!editable} onChange={(e) => setPlanInfo(session.doc, { date: e.target.value })} />
        </label>
        <h3>{t("settings.room")}</h3>
        <div className="field-row">
          <NumberField label={t("settings.width")} value={room.width} min={200} max={10000} step={10} disabled={!editable} onCommit={(width) => setRoom(session.doc, { width })} />
          <NumberField label={t("settings.height")} value={room.height} min={200} max={10000} step={10} disabled={!editable} onCommit={(height) => setRoom(session.doc, { height })} />
          <NumberField label={t("settings.gridSize")} value={room.gridSize} min={5} max={200} disabled={!editable} onCommit={(gridSize) => setRoom(session.doc, { gridSize })} />
        </div>
        <p className="hint">{t("settings.unitsHint")}</p>
        <label className="checkbox">
          <input type="checkbox" checked={room.showOutline} disabled={!editable} onChange={(e) => setRoom(session.doc, { showOutline: e.target.checked })} />
          {t("settings.showOutline")}
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={room.showGrid} disabled={!editable} onChange={(e) => setRoom(session.doc, { showGrid: e.target.checked })} />
          {t("settings.showGrid")}
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={room.snap} disabled={!editable} onChange={(e) => setRoom(session.doc, { snap: e.target.checked })} />
          {t("settings.snap")}
        </label>
        {editable && session.target.kind === "local" && (
          <>
            <h3>{t("settings.planTitle")}</h3>
            <p className="hint">{t("settings.newHint")}</p>
            <div className="dialog-actions">
              <button className="danger" onClick={newPlan}>
                {t("settings.newPlan")}
              </button>
            </div>
          </>
        )}
        <div className="dialog-actions">
          <span className="spacer" />
          <button className="primary" onClick={close}>
            {t("common.done")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
