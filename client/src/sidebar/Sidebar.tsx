import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { beginDrag, justDropped } from "../app/dnd";
import { ui } from "../app/uiStore";
import { compareNames } from "../lib/seating";
import { useRemoteParticipants } from "../presence/presence";
import { addGuest, deleteGroup, updateGroup } from "../store/actions";
import { useAwareness, usePlan, usePlanStats, useSeating, useSession } from "../store/hooks";
import type { Group, Guest, ID } from "../types";

type Filter = "all" | "unseated" | "seated";

/** Starts a drag from a list row: anywhere with a mouse, from the grip handle on touch. */
function onRowPointerDown(e: React.PointerEvent, start: () => void) {
  const fromHandle = (e.target as HTMLElement).closest(".grip");
  if (e.pointerType === "mouse" ? e.button !== 0 : !fromHandle) return;
  if ((e.target as HTMLElement).closest("button, input, select")) return;
  if (e.pointerType !== "mouse") e.preventDefault();
  start();
}

export function Sidebar({ editable }: { editable: boolean }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"guests" | "groups">("guests");
  const stats = usePlanStats();
  return (
    <section className="sidebar" data-dropzone="list" data-testid="sidebar" aria-label={t("sidebar.title")}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "guests"} className={tab === "guests" ? "active" : ""} onClick={() => setTab("guests")}>
          {t("sidebar.guests")} <span className="count">{stats.guests}</span>
        </button>
        <button role="tab" aria-selected={tab === "groups"} className={tab === "groups" ? "active" : ""} onClick={() => setTab("groups")} data-testid="groups-tab">
          {t("sidebar.groups")}
        </button>
      </div>
      {tab === "guests" ? <GuestsTab editable={editable} /> : <GroupsTab editable={editable} />}
    </section>
  );
}

function GuestsTab({ editable }: { editable: boolean }) {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const plan = usePlan();
  const seating = useSeating();
  const stats = usePlanStats();
  const awareness = useAwareness();
  const remotes = useRemoteParticipants(awareness);
  const picked = ui.use((s) => s.pickedGuestId);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [byGroup, setByGroup] = useState(false);
  const [newName, setNewName] = useState("");

  const remoteDrag = useMemo(() => {
    const m = new Map<ID, string>();
    for (const r of remotes) {
      if (r.dragging?.guestId) m.set(r.dragging.guestId, r.user.color);
      if (r.dragging?.groupId) {
        for (const g of Object.values(plan.guests)) if (g.groupId === r.dragging.groupId) m.set(g.id, r.user.color);
      }
    }
    return m;
  }, [remotes, plan.guests]);

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
    const nq = norm(q);
    return Object.values(plan.guests)
      .filter((g) => {
        const seated = seating.seatOf.has(g.id);
        if (filter === "unseated" && seated) return false;
        if (filter === "seated" && !seated) return false;
        if (!nq) return true;
        const group = g.groupId ? plan.groups[g.groupId]?.name ?? "" : "";
        return norm(g.name).includes(nq) || norm(group).includes(nq) || norm(g.note ?? "").includes(nq);
      })
      .sort((a, b) => compareNames(a, b, i18n.language));
  }, [plan.guests, plan.groups, seating, query, filter, i18n.language]);

  const sections = useMemo(() => {
    if (!byGroup) return [{ key: "all", group: undefined as Group | undefined, guests: visible }];
    const map = new Map<string, Guest[]>();
    for (const g of visible) {
      const key = g.groupId && plan.groups[g.groupId] ? g.groupId : "";
      map.set(key, [...(map.get(key) ?? []), g]);
    }
    return [...map.entries()]
      .map(([key, guests]) => ({ key: key || "none", group: key ? plan.groups[key] : undefined, guests }))
      .sort((a, b) => (a.group ? (b.group ? a.group.name.localeCompare(b.group.name, i18n.language) : -1) : 1));
  }, [byGroup, visible, plan.groups, i18n.language]);

  const quickAdd = () => {
    const name = newName.trim();
    if (!name) return;
    addGuest(session.doc, { name });
    setNewName("");
  };

  return (
    <div className="tab-body">
      {editable && (
        <div className="quick-add">
          <input
            value={newName}
            placeholder={t("sidebar.addPlaceholder")}
            aria-label={t("sidebar.addPlaceholder")}
            data-testid="quick-add"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") quickAdd();
            }}
          />
          <button className="primary" onClick={quickAdd} disabled={!newName.trim()} data-testid="quick-add-btn" aria-label={t("common.add")} title={t("common.add")}>
            +
          </button>
        </div>
      )}
      {editable && (
        <div className="add-links">
          <button className="link-btn" onClick={() => ui.set({ dialog: { type: "guest" } })}>
            {t("sidebar.addDetailed")}
          </button>
          <button className="link-btn" onClick={() => ui.set({ dialog: { type: "import" } })} data-testid="open-import">
            {t("sidebar.import")}
          </button>
        </div>
      )}
      <input
        className="search"
        type="search"
        value={query}
        placeholder={t("sidebar.search")}
        aria-label={t("sidebar.search")}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="filters">
        {(["all", "unseated", "seated"] as Filter[]).map((f) => (
          <button key={f} className={`chip ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)} data-testid={`filter-${f}`}>
            {t(`sidebar.filter.${f}`)}{" "}
            <span className="count">{f === "all" ? stats.guests : f === "seated" ? stats.seated : stats.unseated}</span>
          </button>
        ))}
        <label className="toggle">
          <input type="checkbox" checked={byGroup} onChange={(e) => setByGroup(e.target.checked)} />
          {t("sidebar.byGroup")}
        </label>
      </div>
      {editable && picked && plan.guests[picked] && (
        <div className="pick-hint">
          {t("sidebar.pickHint", { name: plan.guests[picked].name })}
          <button className="link-btn" onClick={() => ui.set({ pickedGuestId: null })}>
            {t("common.cancel")}
          </button>
        </div>
      )}
      <div className="guest-list" data-testid="guest-list">
        {visible.length === 0 && (
          <p className="empty">
            {Object.keys(plan.guests).length === 0
              ? t("sidebar.noGuests")
              : filter === "unseated" && !query
                ? t("sidebar.allSeated")
                : t("sidebar.noMatches")}
          </p>
        )}
        {sections.map((section) => (
          <div key={section.key} className="guest-section">
            {byGroup && (
              <div className="section-head">
                <span className="dot" style={{ background: section.group?.color ?? "transparent" }} />
                {section.group?.name ?? t("sidebar.noGroup")}
              </div>
            )}
            <ul>
              {section.guests.map((guest) => (
                <GuestRow
                  key={guest.id}
                  guest={guest}
                  group={guest.groupId ? plan.groups[guest.groupId] : undefined}
                  seatLabel={(() => {
                    const seat = seating.seatOf.get(guest.id);
                    const table = seat ? plan.tables[seat.tableId] : undefined;
                    return seat && table ? `${table.label} · ${seat.index + 1}` : null;
                  })()}
                  picked={picked === guest.id}
                  remoteColor={remoteDrag.get(guest.id) ?? null}
                  editable={editable}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function GuestRow(props: {
  guest: Guest;
  group?: Group;
  seatLabel: string | null;
  picked: boolean;
  remoteColor: string | null;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const { guest, group, seatLabel, editable } = props;
  return (
    <li
      className={`guest-row ${props.picked ? "picked" : ""} ${seatLabel ? "seated" : "unseated"}`}
      style={props.remoteColor ? { outline: `2px solid ${props.remoteColor}` } : undefined}
      data-testid="guest-row"
      data-guest-name={guest.name}
      onPointerDown={(e) => {
        if (!editable) return;
        onRowPointerDown(e, () => beginDrag({ kind: "guest", guestId: guest.id }, e.nativeEvent));
      }}
      onClick={() => {
        if (justDropped() || !editable) return;
        ui.set((s) => ({ pickedGuestId: s.pickedGuestId === guest.id ? null : guest.id }));
      }}
    >
      {editable && (
        <span className="grip" aria-hidden="true">
          ⋮⋮
        </span>
      )}
      <span className="dot" style={{ background: group?.color ?? "transparent", borderColor: group ? group.color : undefined }} title={group?.name} />
      <span className="guest-main">
        <span className="guest-name">{guest.name}</span>
        <span className="guest-sub">
          <span className="seat-label">{seatLabel ?? t("sidebar.unseated")}</span>
          {guest.isChild && <span className="badge child">{t("guest.childShort")}</span>}
          {guest.note && (
            <span className="badge note" title={guest.note}>
              {guest.note}
            </span>
          )}
        </span>
      </span>
      {editable && (
        <button
          className="icon-btn"
          aria-label={t("common.edit")}
          title={t("common.edit")}
          onClick={(e) => {
            e.stopPropagation();
            ui.set({ dialog: { type: "guest", guestId: guest.id } });
          }}
        >
          ✎
        </button>
      )}
    </li>
  );
}

function GroupsTab({ editable }: { editable: boolean }) {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const plan = usePlan();
  const seating = useSeating();
  const groups = Object.values(plan.groups).sort((a, b) => a.name.localeCompare(b.name, i18n.language));
  const members = (id: ID) => Object.values(plan.guests).filter((g) => g.groupId === id);

  return (
    <div className="tab-body">
      <p className="hint">{editable ? t("groups.hint") : t("groups.hintReadOnly")}</p>
      {groups.length === 0 && <p className="empty">{t("groups.none")}</p>}
      <ul className="group-list">
        {groups.map((group) => {
          const list = members(group.id);
          const seated = list.filter((g) => seating.seatOf.has(g.id)).length;
          return (
            <li
              key={group.id}
              className="group-row"
              data-testid="group-row"
              onPointerDown={(e) => {
                if (!editable) return;
                onRowPointerDown(e, () => beginDrag({ kind: "group", groupId: group.id }, e.nativeEvent));
              }}
            >
              {editable && (
                <span className="grip" aria-hidden="true">
                  ⋮⋮
                </span>
              )}
              <input
                type="color"
                value={group.color}
                disabled={!editable}
                aria-label={t("groups.color")}
                onChange={(e) => updateGroup(session.doc, group.id, { color: e.target.value })}
              />
              <span className="guest-main">
                <input
                  className="inline-input"
                  value={group.name}
                  disabled={!editable}
                  aria-label={t("groups.name")}
                  onChange={(e) => updateGroup(session.doc, group.id, { name: e.target.value })}
                />
                <span className="guest-sub">{t("groups.counts", { seated, total: list.length })}</span>
              </span>
              {editable && (
                <button
                  className="icon-btn"
                  aria-label={t("common.delete")}
                  title={t("groups.deleteHint")}
                  onClick={() => {
                    if (confirm(t("groups.confirmDelete", { name: group.name }))) deleteGroup(session.doc, group.id);
                  }}
                >
                  🗑
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
