import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ui } from "../app/uiStore";
import { MAX_SEATS, TABLE_DEFAULTS, barWidthOf } from "../lib/geometry";
import { seatKey, tableStats, unassignGuest } from "../lib/seating";
import {
  deleteFixture,
  deleteTable,
  duplicateFixture,
  duplicateTable,
  updateFixture,
  updateTable,
} from "../store/actions";
import { usePlan, useSeating, useSession } from "../store/hooks";
import type { Fixture, Table, TableShape } from "../types";

/** Number input that commits on blur or Enter, so typing "12" never passes through "1". */
export function NumberField(props: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  testId?: string;
  onCommit(value: number): void;
}) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  const commit = () => {
    const n = Number(text.replace(",", "."));
    if (!Number.isFinite(n)) return setText(String(props.value));
    const clamped = Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, n));
    setText(String(clamped));
    if (clamped !== props.value) props.onCommit(clamped);
  };
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={text}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        disabled={props.disabled}
        data-testid={props.testId}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

export function Inspector({ editable }: { editable: boolean }) {
  const selection = ui.use((s) => s.selection);
  const plan = usePlan();
  if (!selection) return null;
  if (selection.kind === "table") {
    const table = plan.tables[selection.id];
    return table ? <TableInspector table={table} editable={editable} /> : null;
  }
  const fixture = plan.fixtures[selection.id];
  return fixture ? <FixtureInspector fixture={fixture} editable={editable} /> : null;
}

function TableInspector({ table, editable }: { table: Table; editable: boolean }) {
  const { t } = useTranslation();
  const session = useSession();
  const plan = usePlan();
  const seating = useSeating();
  const stats = tableStats(plan, seating, table.id);
  const update = (patch: Partial<Table>) => updateTable(session.doc, table.id, patch);
  const seated = Array.from({ length: table.seatCount }, (_, i) => {
    const guestId = seating.occupant.get(seatKey({ tableId: table.id, index: i }));
    return { index: i, guest: guestId ? plan.guests[guestId] : undefined };
  });

  return (
    <aside className="inspector" data-testid="inspector" aria-label={t("inspector.table")}>
      <header>
        <h2>{t("inspector.table")}</h2>
        <button className="icon-btn" onClick={() => ui.set({ selection: null })} aria-label={t("common.close")}>
          ×
        </button>
      </header>
      <label className="field">
        <span>{t("inspector.label")}</span>
        <input
          value={table.label}
          disabled={!editable}
          data-testid="table-label"
          onChange={(e) => update({ label: e.target.value })}
        />
      </label>
      <div className="field-row">
        <label className="field">
          <span>{t("inspector.shape")}</span>
          <select
            value={table.shape}
            disabled={!editable}
            onChange={(e) => {
              const shape = e.target.value as TableShape;
              if (shape === "round") update({ shape, height: table.width });
              else if (shape === "u" && table.shape !== "u") {
                // A Π needs room for its arms: start from the default size unless the table is already larger.
                const d = TABLE_DEFAULTS.u;
                update({ shape, width: Math.max(table.width, d.width), height: Math.max(table.height, d.height) });
              } else update({ shape });
            }}
          >
            <option value="round">{t("shapes.round")}</option>
            <option value="rect">{t("shapes.rect")}</option>
            <option value="banquet">{t("shapes.banquet")}</option>
            <option value="u">{t("shapes.u")}</option>
          </select>
        </label>
        {(table.shape === "banquet" || table.shape === "u") && (
          <label className="field">
            <span>{t("inspector.sides")}</span>
            <select
              value={table.sides ?? 2}
              disabled={!editable}
              data-testid="table-sides"
              onChange={(e) => update({ sides: Number(e.target.value) === 1 ? 1 : 2 })}
            >
              <option value={2}>{table.shape === "u" ? t("inspector.outsideAndInside") : t("inspector.bothSides")}</option>
              <option value={1}>{table.shape === "u" ? t("inspector.outsideOnly") : t("inspector.oneSide")}</option>
            </select>
          </label>
        )}
      </div>
      <div className="field-row seats-row">
        <NumberField
          label={t("inspector.seats")}
          value={table.seatCount}
          min={0}
          max={MAX_SEATS}
          disabled={!editable}
          testId="seat-count"
          onCommit={(seatCount) => update({ seatCount })}
        />
        {editable && (
          <div className="stepper">
            <button onClick={() => update({ seatCount: Math.max(0, table.seatCount - 1) })} aria-label={t("inspector.fewerSeats")}>
              −
            </button>
            <button onClick={() => update({ seatCount: Math.min(MAX_SEATS, table.seatCount + 1) })} aria-label={t("inspector.moreSeats")}>
              +
            </button>
          </div>
        )}
      </div>
      <div className="field-row">
        <NumberField
          label={table.shape === "round" ? t("inspector.diameter") : t("inspector.width")}
          value={table.width}
          min={30}
          max={2000}
          disabled={!editable}
          onCommit={(width) => update(table.shape === "round" ? { width, height: width } : { width })}
        />
        {table.shape !== "round" && (
          <NumberField
            label={table.shape === "u" ? t("inspector.armLength") : t("inspector.depth")}
            value={table.height}
            min={30}
            max={2000}
            disabled={!editable}
            onCommit={(height) => update({ height })}
          />
        )}
        {table.shape === "u" && (
          <NumberField
            label={t("inspector.barWidth")}
            value={barWidthOf(table)}
            min={20}
            max={400}
            disabled={!editable}
            testId="bar-width"
            onCommit={(barWidth) => update({ barWidth })}
          />
        )}
        <NumberField
          label={t("inspector.rotation")}
          value={table.rotation}
          min={-360}
          max={360}
          disabled={!editable}
          onCommit={(rotation) => update({ rotation: ((rotation % 360) + 360) % 360 })}
        />
      </div>
      <p className="stats-line" data-testid="table-stats">
        {t("inspector.stats", { seated: stats.seated, total: table.seatCount, free: stats.free })}
        <br />
        {t("inspector.ages", { adults: stats.adults, children: stats.children })}
      </p>
      {editable && (
        <div className="button-row">
          <button onClick={() => update({ rotation: (table.rotation + 345) % 360 })}>⟲ 15°</button>
          <button onClick={() => update({ rotation: (table.rotation + 15) % 360 })}>⟳ 15°</button>
          <button
            onClick={() => {
              const id = duplicateTable(session.doc, table.id, t("defaults.table"));
              if (id) ui.set({ selection: { kind: "table", id } });
            }}
          >
            {t("common.duplicate")}
          </button>
          <button
            className="danger"
            data-testid="delete-table"
            onClick={() => {
              deleteTable(session.doc, table.id);
              ui.set({ selection: null });
            }}
          >
            {t("common.delete")}
          </button>
        </div>
      )}
      <ol className="seat-list">
        {seated.map(({ index, guest }) => (
          <li key={index} className={guest ? "" : "empty"}>
            <span className="seat-no">{index + 1}</span>
            <span className="seat-name">
              {guest ? guest.name : t("inspector.emptySeat")}
              {guest?.isChild && <span className="badge child">{t("guest.childShort")}</span>}
            </span>
            {guest && editable && (
              <button className="link-btn" onClick={() => unassignGuest(session.doc, guest.id)} aria-label={t("guest.unseat")}>
                {t("guest.unseat")}
              </button>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}

const FIXTURE_PRESETS = ["danceFloor", "buffet", "stage", "entrance", "bar", "dj"] as const;

function FixtureInspector({ fixture, editable }: { fixture: Fixture; editable: boolean }) {
  const { t } = useTranslation();
  const session = useSession();
  const update = (patch: Partial<Fixture>) => updateFixture(session.doc, fixture.id, patch);
  return (
    <aside className="inspector" data-testid="inspector" aria-label={t("inspector.fixture")}>
      <header>
        <h2>{t("inspector.fixture")}</h2>
        <button className="icon-btn" onClick={() => ui.set({ selection: null })} aria-label={t("common.close")}>
          ×
        </button>
      </header>
      <label className="field">
        <span>{t("inspector.label")}</span>
        <input
          value={fixture.label}
          list="fixture-presets"
          disabled={!editable}
          onChange={(e) => update({ label: e.target.value })}
        />
        <datalist id="fixture-presets">
          {FIXTURE_PRESETS.map((p) => (
            <option key={p} value={t(`fixtures.${p}`)} />
          ))}
        </datalist>
      </label>
      <div className="field-row">
        <NumberField label={t("inspector.width")} value={fixture.width} min={20} max={4000} disabled={!editable} onCommit={(width) => update({ width })} />
        <NumberField label={t("inspector.depth")} value={fixture.height} min={20} max={4000} disabled={!editable} onCommit={(height) => update({ height })} />
        <NumberField
          label={t("inspector.rotation")}
          value={fixture.rotation}
          min={-360}
          max={360}
          disabled={!editable}
          onCommit={(rotation) => update({ rotation: ((rotation % 360) + 360) % 360 })}
        />
      </div>
      {editable && (
        <div className="button-row">
          <button
            onClick={() => {
              const id = duplicateFixture(session.doc, fixture.id);
              if (id) ui.set({ selection: { kind: "fixture", id } });
            }}
          >
            {t("common.duplicate")}
          </button>
          <button
            className="danger"
            onClick={() => {
              deleteFixture(session.doc, fixture.id);
              ui.set({ selection: null });
            }}
          >
            {t("common.delete")}
          </button>
        </div>
      )}
    </aside>
  );
}
