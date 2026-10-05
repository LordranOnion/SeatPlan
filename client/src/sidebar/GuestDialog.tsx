import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../app/Dialog";
import { ui } from "../app/uiStore";
import { unassignGuest } from "../lib/seating";
import { addGroup, addGuest, deleteGuests, updateGuest } from "../store/actions";
import { usePlan, useSeating, useSession } from "../store/hooks";
import type { ID } from "../types";

const NEW_GROUP = "__new__";

export function GuestDialog({ guestId }: { guestId?: ID }) {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const plan = usePlan();
  const seating = useSeating();
  const existing = guestId ? plan.guests[guestId] : undefined;
  const [name, setName] = useState(existing?.name ?? "");
  const [groupId, setGroupId] = useState(existing?.groupId ?? "");
  const [newGroup, setNewGroup] = useState("");
  const [isChild, setIsChild] = useState(!!existing?.isChild);
  const [note, setNote] = useState(existing?.note ?? "");
  const close = () => ui.set({ dialog: null });
  const seat = guestId ? seating.seatOf.get(guestId) : undefined;
  const groups = Object.values(plan.groups).sort((a, b) => a.name.localeCompare(b.name, i18n.language));

  const save = (another: boolean) => {
    if (!name.trim()) return;
    let gid: string | undefined = groupId || undefined;
    if (groupId === NEW_GROUP) gid = newGroup.trim() ? addGroup(session.doc, newGroup) : undefined;
    const data = { name, groupId: gid, isChild, note };
    if (existing) updateGuest(session.doc, existing.id, data);
    else addGuest(session.doc, data);
    if (another) {
      setName("");
      setNote("");
      setIsChild(false);
      if (gid) setGroupId(gid);
      setNewGroup("");
    } else {
      close();
    }
  };

  return (
    <Dialog title={existing ? t("guest.editTitle") : t("guest.addTitle")} onClose={close}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save(false);
        }}
      >
        <label className="field">
          <span>{t("guest.name")}</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} required data-testid="guest-name" />
        </label>
        <label className="field">
          <span>{t("guest.group")}</span>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">{t("guest.noGroup")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value={NEW_GROUP}>{t("guest.newGroup")}</option>
          </select>
        </label>
        {groupId === NEW_GROUP && (
          <label className="field">
            <span>{t("guest.newGroupName")}</span>
            <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder={t("guest.newGroupPlaceholder")} />
          </label>
        )}
        <label className="checkbox">
          <input type="checkbox" checked={isChild} onChange={(e) => setIsChild(e.target.checked)} />
          {t("guest.isChild")}
        </label>
        <label className="field">
          <span>{t("guest.note")}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("guest.notePlaceholder")} />
        </label>
        {existing && (
          <p className="stats-line">
            {seat && plan.tables[seat.tableId]
              ? t("guest.seatedAt", { table: plan.tables[seat.tableId].label, seat: seat.index + 1 })
              : t("sidebar.unseated")}
            {seat && (
              <button type="button" className="link-btn" onClick={() => unassignGuest(session.doc, existing.id)}>
                {t("guest.unseat")}
              </button>
            )}
          </p>
        )}
        <div className="dialog-actions">
          {existing && (
            <button
              type="button"
              className="danger"
              onClick={() => {
                deleteGuests(session.doc, [existing.id]);
                close();
              }}
            >
              {t("common.delete")}
            </button>
          )}
          <span className="spacer" />
          {!existing && (
            <button type="button" onClick={() => save(true)} disabled={!name.trim()}>
              {t("guest.saveAndAdd")}
            </button>
          )}
          <button type="submit" className="primary" disabled={!name.trim()} data-testid="guest-save">
            {t("common.save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
