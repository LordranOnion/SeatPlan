import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Inspector } from "../canvas/Inspector";
import { PlanCanvas } from "../canvas/PlanCanvas";
import { assignGuest, fillGroup, seatAtTable, unassignGuest } from "../lib/seating";
import { loadLocalUser, saveLocalUser, setPresence } from "../presence/presence";
import { GuestDialog } from "../sidebar/GuestDialog";
import { ImportDialog } from "../sidebar/ImportDialog";
import { Sidebar } from "../sidebar/Sidebar";
import { deleteFixture, deleteTable, duplicateFixture, duplicateTable } from "../store/actions";
import { SessionContext, useAwareness, usePlan, useSession, useStatus } from "../store/hooks";
import { copyToLocalPlan, PlanSession } from "../store/session";
import { ExportDialog } from "../toolbar/ExportDialog";
import { PrintArea } from "../toolbar/PrintArea";
import { SettingsDialog } from "../toolbar/SettingsDialog";
import { ShareDialog } from "../toolbar/ShareDialog";
import { Toolbar } from "../toolbar/Toolbar";
import { Dialog } from "./Dialog";
import { dnd, setDropHandler } from "./dnd";
import { isRoomHash, routeKey, useRoute } from "./route";
import { sharingEnabled } from "../lib/sync";
import { toast, ui } from "./uiStore";

function useIsPhone(): boolean {
  const query = "(max-width: 640px)";
  const [phone, setPhone] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

export function App() {
  const { t } = useTranslation();
  const target = useRoute();
  const key = routeKey(target);
  const [open, setOpen] = useState<{ key: string; session: PlanSession } | null>(null);

  useEffect(() => {
    if (!sharingEnabled() && isRoomHash(location.hash)) {
      history.replaceState(null, "", location.pathname + location.search);
      toast(t("banner.noSharing"), "warn", 10000);
    }
  }, [t]);

  // One session per route. The default plan name is only read when a new plan is created.
  useEffect(() => {
    const session = new PlanSession(target, t("defaults.planName"));
    setOpen({ key, session });
    ui.set({ selection: null, pickedGuestId: null, dialog: null });
    return () => session.destroy();
  }, [key]);

  if (!open || open.key !== key) return null;
  return (
    <SessionContext.Provider value={open.session}>
      <Workspace key={key} />
    </SessionContext.Provider>
  );
}

function Workspace() {
  const { t } = useTranslation();
  const session = useSession();
  const status = useStatus();
  const plan = usePlan();
  const awareness = useAwareness();
  const isPhone = useIsPhone();
  const sidebarOpen = ui.use((s) => s.sidebarOpen);
  const dialog = ui.use((s) => s.dialog);
  const [askName, setAskName] = useState(false);

  const editable = session.canWrite && !isPhone && status.loaded;

  // Conflict notices after merges.
  useEffect(
    () =>
      session.onConflicts((conflicts) => {
        const p = session.getPlan();
        for (const c of conflicts) {
          const table = p.tables[c.seat.tableId]?.label ?? "?";
          for (const loser of c.losers) {
            toast(
              t("conflict.notice", {
                table,
                seat: c.seat.index + 1,
                winner: p.guests[c.winner]?.name ?? "?",
                loser: p.guests[loser]?.name ?? "?",
              }),
              "warn",
              9000,
            );
          }
        }
      }),
    [session, t],
  );

  // Drops from the guest list or from seats.
  useEffect(() => {
    setDropHandler((payload, target) => {
      if (!session.canWrite) return;
      const doc = session.doc;
      if (payload.kind === "guest") {
        if (target.kind === "seat") assignGuest(doc, payload.guestId, target.seat);
        else if (target.kind === "table") {
          if (!seatAtTable(doc, payload.guestId, target.tableId)) toast(t("seating.tableFull"), "warn");
        } else if (target.kind === "list" && payload.fromSeat) unassignGuest(doc, payload.guestId);
        ui.set({ pickedGuestId: null });
      } else if (payload.kind === "group" && target.kind === "table") {
        const result = fillGroup(doc, payload.groupId, target.tableId);
        const group = session.getPlan().groups[payload.groupId]?.name ?? "";
        if (result.notPlaced.length > 0) {
          toast(t("seating.groupPartial", { group, placed: result.placed.length, left: result.notPlaced.length }), "warn");
        } else if (result.placed.length > 0) {
          toast(t("seating.groupPlaced", { group, count: result.placed.length }));
        }
      }
    });
    return () => setDropHandler(null);
  }, [session, t]);

  // Where the guest list overlays the canvas (tablet portrait), move it aside once a drag starts.
  useEffect(
    () =>
      dnd.subscribe(() => {
        if (dnd.get().drag && ui.get().sidebarOpen && matchMedia("(max-width: 820px)").matches) {
          ui.set({ sidebarOpen: false });
        }
      }),
    [],
  );

  // Presence: nickname, color, and what we are dragging.
  useEffect(() => {
    if (!awareness) return;
    const user = loadLocalUser();
    if (user) setPresence(awareness, { user });
    else if (session.target.kind === "room") setAskName(true);
    return dnd.subscribe(() => {
      const drag = dnd.get().drag;
      const current = (awareness.getLocalState() as { dragging?: unknown } | null)?.dragging ?? null;
      const next = drag ? (drag.payload.kind === "guest" ? { guestId: drag.payload.guestId } : { groupId: drag.payload.groupId }) : null;
      if (JSON.stringify(current) !== JSON.stringify(next)) setPresence(awareness, { dragging: next });
    });
  }, [awareness, session]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]") || ui.get().dialog) return;
      const mod = e.ctrlKey || e.metaKey;
      const sel = ui.get().selection;
      if (mod && e.key.toLowerCase() === "z" && editable) {
        e.preventDefault();
        if (e.shiftKey) session.undo.redo();
        else session.undo.undo();
      } else if (mod && e.key.toLowerCase() === "y" && editable) {
        e.preventDefault();
        session.undo.redo();
      } else if (mod && e.key.toLowerCase() === "d" && sel && editable) {
        e.preventDefault();
        const id = sel.kind === "table" ? duplicateTable(session.doc, sel.id, t("defaults.table")) : duplicateFixture(session.doc, sel.id);
        if (id) ui.set({ selection: { kind: sel.kind, id } });
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel && editable) {
        e.preventDefault();
        if (sel.kind === "table") deleteTable(session.doc, sel.id);
        else deleteFixture(session.doc, sel.id);
        ui.set({ selection: null });
      } else if (e.key === "Escape") {
        ui.set({ selection: null, pickedGuestId: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable, session, t]);

  const keepCopy = async () => {
    if (!confirm(t("banner.confirmKeep"))) return;
    await copyToLocalPlan(session.getPlan());
    location.hash = "#/";
  };

  return (
    <div className={`app ${sidebarOpen ? "" : "sidebar-closed"}`}>
      <Toolbar editable={editable} />
      <Banners isPhone={isPhone} onKeepCopy={keepCopy} />
      <main className="workspace">
        {sidebarOpen && <Sidebar editable={editable} />}
        <div className="stage-wrap">
          {status.loaded ? (
            <PlanCanvas editable={editable} />
          ) : (
            <div className="loading" data-testid="loading">
              {session.target.kind === "room" ? t("banner.connecting") : t("banner.loading")}
            </div>
          )}
          <Inspector editable={editable} />
        </div>
      </main>
      {dialog?.type === "guest" && <GuestDialog guestId={dialog.guestId} />}
      {dialog?.type === "import" && <ImportDialog />}
      {dialog?.type === "share" && <ShareDialog />}
      {dialog?.type === "export" && <ExportDialog editable={editable} />}
      {dialog?.type === "settings" && <SettingsDialog editable={editable} />}
      {askName && <NicknameDialog onDone={() => setAskName(false)} />}
      <DragGhost />
      <Toasts />
      <PrintArea />
      <title>{plan.name ? `${plan.name} · SeatPlan` : "SeatPlan"}</title>
    </div>
  );
}

function Banners({ isPhone, onKeepCopy }: { isPhone: boolean; onKeepCopy(): void }) {
  const { t } = useTranslation();
  const session = useSession();
  const status = useStatus();
  const isRoom = session.target.kind === "room";
  const banners: { key: string; tone: string; text: string; action?: React.ReactNode }[] = [];

  if (status.unauthorized) banners.push({ key: "unauth", tone: "error", text: t("banner.unauthorized") });
  if (status.roomGone && isRoom) {
    banners.push({
      key: "gone",
      tone: "warn",
      text: t("banner.roomGone"),
      action: (
        <button onClick={onKeepCopy} data-testid="keep-copy">
          {t("banner.keepCopy")}
        </button>
      ),
    });
  }
  if (status.roomGone && !isRoom) banners.push({ key: "ended", tone: "info", text: t("banner.sharingEnded") });
  if (status.roomFull) banners.push({ key: "full", tone: "warn", text: t("banner.roomFull") });
  if (isRoom && session.target.kind === "room" && session.target.role === "view" && !status.roomGone) {
    banners.push({ key: "view", tone: "info", text: t("banner.viewOnly") });
  }
  if (isPhone) banners.push({ key: "phone", tone: "info", text: t("banner.phone") });
  if ((status.connection === "offline" || status.connection === "connecting") && status.loaded && !status.roomGone) {
    banners.push({ key: "offline", tone: "muted", text: t("banner.offline") });
  }
  if (banners.length === 0) return null;
  return (
    <div className="banners">
      {banners.map((b) => (
        <div key={b.key} className={`banner ${b.tone}`} data-testid={`banner-${b.key}`}>
          <span>{b.text}</span>
          {b.action}
          {isRoom && b.key !== "offline" && (
            <a className="link-btn" href="#/">
              {t("share.backToMine")}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function NicknameDialog({ onDone }: { onDone(): void }) {
  const { t } = useTranslation();
  const session = useSession();
  const [name, setName] = useState("");
  const save = () => {
    const user = saveLocalUser(name.trim() || t("presence.anonymous"));
    setPresence(session.awareness, { user });
    onDone();
  };
  return (
    <Dialog title={t("presence.nameTitle")} onClose={save}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p>{t("presence.nameHelp")}</p>
        <label className="field">
          <span>{t("share.nickname")}</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} data-testid="join-nickname" />
        </label>
        <div className="dialog-actions">
          <span className="spacer" />
          <button type="submit" className="primary" data-testid="join-nickname-save">
            {t("common.continue")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function DragGhost() {
  const { t } = useTranslation();
  const drag = dnd.use((s) => s.drag);
  const plan = usePlan();
  if (!drag) return null;
  let label = "";
  if (drag.payload.kind === "guest") label = plan.guests[drag.payload.guestId]?.name ?? "";
  else {
    const groupId = drag.payload.groupId;
    const count = Object.values(plan.guests).filter((g) => g.groupId === groupId).length;
    label = `${plan.groups[groupId]?.name ?? ""} (${count})`;
  }
  const hint =
    drag.target.kind === "list" && drag.payload.kind === "guest" && drag.payload.fromSeat
      ? t("seating.dropToUnseat")
      : drag.target.kind === "table" && drag.payload.kind === "group"
        ? t("seating.dropGroup")
        : "";
  return (
    <div className="drag-ghost" style={{ transform: `translate(${drag.x + 12}px, ${drag.y + 12}px)` }}>
      {label}
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Toasts() {
  const toasts = ui.use((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`} data-testid="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}
