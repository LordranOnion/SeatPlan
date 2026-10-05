import Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Group, Layer, Line, Rect, Shape, Stage, Text, Transformer } from "react-konva";
import { beginDrag, dnd, justDropped, setCanvasResolver, type DropTarget } from "../app/dnd";
import { setCanvasApi, ui } from "../app/uiStore";
import { seatAt, seatPositions, tableAt, tableBounds, toWorld } from "../lib/geometry";
import { assignGuest, seatKey } from "../lib/seating";
import { setPresence, useRemoteParticipants } from "../presence/presence";
import { updateFixture, updateTable } from "../store/actions";
import { useAwareness, usePlan, useSeating, useSession } from "../store/hooks";
import type { ID, Point, SeatRef } from "../types";
import { FixtureNode } from "./FixtureNode";
import { COLORS } from "./style";
import { TableNode, type SeatOccupant } from "./TableNode";

interface View {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.15;
const MAX_SCALE = 4;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export function PlanCanvas({ editable }: { editable: boolean }) {
  const { t } = useTranslation();
  const session = useSession();
  const plan = usePlan();
  const seating = useSeating();
  const awareness = useAwareness();
  const remotes = useRemoteParticipants(awareness);
  const selection = ui.use((s) => s.selection);
  const pickedGuestId = ui.use((s) => s.pickedGuestId);
  const drag = dnd.use((s) => s.drag);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const overlayRef = useRef<Konva.Layer>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const bodies = useRef(new Map<ID, Konva.Shape>());
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [view, setView] = useState<View>({ x: 40, y: 40, scale: 0.6 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const planRef = useRef(plan);
  planRef.current = plan;
  const fitted = useRef(false);

  // ---- Size and initial fit ----

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const contentBounds = useCallback(() => {
    const p = planRef.current;
    let minX = 0;
    let minY = 0;
    let maxX = p.room.width;
    let maxY = p.room.height;
    for (const table of Object.values(p.tables)) {
      const b = tableBounds(table);
      minX = Math.min(minX, b.minX - 60);
      minY = Math.min(minY, b.minY - 30);
      maxX = Math.max(maxX, b.maxX + 60);
      maxY = Math.max(maxY, b.maxY + 30);
    }
    for (const f of Object.values(p.fixtures)) {
      const r = Math.hypot(f.width, f.height) / 2;
      minX = Math.min(minX, f.x - r);
      minY = Math.min(minY, f.y - r);
      maxX = Math.max(maxX, f.x + r);
      maxY = Math.max(maxY, f.y + r);
    }
    return { minX, minY, maxX, maxY };
  }, []);

  const fitToContent = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const b = contentBounds();
    const pad = 32;
    const scale = clampScale(
      Math.min((el.clientWidth - pad * 2) / (b.maxX - b.minX), (el.clientHeight - pad * 2) / (b.maxY - b.minY)),
    );
    setView({
      scale,
      x: (el.clientWidth - (b.maxX - b.minX) * scale) / 2 - b.minX * scale,
      y: (el.clientHeight - (b.maxY - b.minY) * scale) / 2 - b.minY * scale,
    });
  }, [contentBounds]);

  useEffect(() => {
    if (fitted.current || !plan.id || size.width < 50) return;
    fitted.current = true;
    fitToContent();
  }, [plan.id, size.width, fitToContent]);

  // ---- Coordinates ----

  const clientToWorld = useCallback((clientX: number, clientY: number): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - rect.left - v.x) / v.scale, y: (clientY - rect.top - v.y) / v.scale };
  }, []);

  const zoomAt = useCallback((factor: number, screen: Point) => {
    setView((v) => {
      const scale = clampScale(v.scale * factor);
      const wx = (screen.x - v.x) / v.scale;
      const wy = (screen.y - v.y) / v.scale;
      return { scale, x: screen.x - wx * scale, y: screen.y - wy * scale };
    });
  }, []);

  // ---- API for toolbar / export ----

  useEffect(() => {
    setCanvasApi({
      viewCenter: () => {
        const el = containerRef.current!;
        const rect = el.getBoundingClientRect();
        return clientToWorld(rect.left + el.clientWidth / 2, rect.top + el.clientHeight / 2);
      },
      fitToContent,
      zoomBy: (factor) => {
        const el = containerRef.current!;
        zoomAt(factor, { x: el.clientWidth / 2, y: el.clientHeight / 2 });
      },
      renderImage: (pixelRatio = 2) => {
        const stage = stageRef.current;
        if (!stage) return null;
        const b = contentBounds();
        const saved = { x: stage.x(), y: stage.y(), sx: stage.scaleX(), sy: stage.scaleY() };
        const overlay = overlayRef.current;
        const grid = stage.findOne(".grid");
        overlay?.visible(false);
        grid?.visible(false);
        stage.position({ x: 0, y: 0 });
        stage.scale({ x: 1, y: 1 });
        const width = Math.ceil(b.maxX - b.minX);
        const height = Math.ceil(b.maxY - b.minY);
        const ratio = Math.min(pixelRatio, 8000 / Math.max(width, height));
        const url = stage.toDataURL({ x: b.minX, y: b.minY, width, height, pixelRatio: ratio });
        stage.position({ x: saved.x, y: saved.y });
        stage.scale({ x: saved.sx, y: saved.sy });
        overlay?.visible(true);
        grid?.visible(true);
        stage.batchDraw();
        return { url, width, height };
      },
    });
    return () => setCanvasApi(null);
  }, [clientToWorld, contentBounds, fitToContent, zoomAt]);

  // Dev-only hook so end-to-end tests can find seats on the canvas.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).seatplanTest = {
      seatClientPosition(tableLabel: string, index: number) {
        const table = Object.values(planRef.current.tables).find((t) => t.label === tableLabel);
        const rect = containerRef.current?.getBoundingClientRect();
        if (!table || !rect) return null;
        const seat = seatPositions(table)[index];
        const w = toWorld(table, seat);
        const v = viewRef.current;
        return { x: rect.left + v.x + w.x * v.scale, y: rect.top + v.y + w.y * v.scale };
      },
      plan: () => session.getPlan(),
    };
  }, [session]);

  // ---- Drop target resolution for guest / group drags ----

  useEffect(() => {
    setCanvasResolver((clientX, clientY, payload): DropTarget => {
      const world = clientToWorld(clientX, clientY);
      const tables = Object.values(planRef.current.tables);
      if (payload.kind === "guest") {
        const seat = seatAt(tables, world);
        if (seat) return { kind: "seat", seat };
      }
      const table = tableAt(tables, world);
      return table ? { kind: "table", tableId: table.id } : { kind: "none" };
    });
    return () => setCanvasResolver(null);
  }, [clientToWorld]);

  // ---- Wheel zoom and pinch zoom ----

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      // Trackpad pinch arrives as ctrl+wheel with small deltas.
      const intensity = e.ctrlKey ? 0.01 : 0.0015;
      const factor = Math.exp(-e.deltaY * intensity);
      zoomAt(factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    const pointers = new Map<number, Point>();
    let pinch: { dist: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
        stageRef.current?.stopDrag();
        stageRef.current?.draggable(false);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const rect = el.getBoundingClientRect();
        zoomAt(dist / pinch.dist, { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top });
        pinch.dist = dist;
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2 && pinch) {
        pinch = null;
        stageRef.current?.draggable(true);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [zoomAt]);

  // ---- Transformer (rotate / resize the selected table or fixture) ----

  const registerBody = useCallback((id: ID, node: Konva.Shape | null) => {
    if (node) bodies.current.set(id, node);
    else bodies.current.delete(id);
  }, []);

  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selection && editable ? bodies.current.get(selection.id) : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selection, editable, plan]);

  const onTransformEnd = useCallback(() => {
    const sel = ui.get().selection;
    const body = sel ? bodies.current.get(sel.id) : undefined;
    if (!sel || !body) return;
    const p = planRef.current;
    const item = sel.kind === "table" ? p.tables[sel.id] : p.fixtures[sel.id];
    if (!item) return;
    // The transformer changed the body inside its group; fold that back into the item.
    const center = toWorld(item, { x: body.x(), y: body.y() });
    const sx = body.scaleX();
    const sy = body.scaleY();
    const rotation = Math.round(((item.rotation + body.rotation()) % 360 + 360) % 360);
    body.position({ x: 0, y: 0 });
    body.rotation(0);
    body.scale({ x: 1, y: 1 });
    const isRound = sel.kind === "table" && p.tables[sel.id]?.shape === "round";
    const width = Math.max(30, Math.round(item.width * sx));
    const height = isRound ? width : Math.max(30, Math.round(item.height * sy));
    const patch = { x: Math.round(center.x), y: Math.round(center.y), rotation, width, height };
    if (sel.kind === "table") updateTable(session.doc, sel.id, patch);
    else updateFixture(session.doc, sel.id, patch);
  }, [session]);

  // ---- Table / fixture / seat callbacks ----

  const onSelectTable = useCallback((id: ID) => ui.set({ selection: { kind: "table", id } }), []);
  const onSelectFixture = useCallback((id: ID) => ui.set({ selection: { kind: "fixture", id } }), []);
  const onTableMoved = useCallback(
    (id: ID, x: number, y: number) => updateTable(session.doc, id, { x: Math.round(x), y: Math.round(y) }),
    [session],
  );
  const onFixtureMoved = useCallback(
    (id: ID, x: number, y: number) => updateFixture(session.doc, id, { x: Math.round(x), y: Math.round(y) }),
    [session],
  );
  const onTableDrag = useCallback(
    (id: ID, dragging: boolean) => setPresence(session.awareness, { dragging: dragging ? { tableId: id } : null }),
    [session],
  );
  const onFixtureDrag = useCallback(
    (id: ID, dragging: boolean) => setPresence(session.awareness, { dragging: dragging ? { fixtureId: id } : null }),
    [session],
  );

  const occupantAt = useCallback(
    (seat: SeatRef) => seating.occupant.get(seatKey(seat)) ?? null,
    [seating],
  );

  const onSeatPointerDown = useCallback(
    (tableId: ID, index: number, e: KonvaEventObject<PointerEvent>) => {
      e.cancelBubble = true;
      const guestId = occupantAt({ tableId, index });
      if (!editable || !guestId || (e.evt.button !== undefined && e.evt.button > 0)) return;
      beginDrag({ kind: "guest", guestId, fromSeat: { tableId, index } }, e.evt);
    },
    [editable, occupantAt],
  );

  const onSeatTap = useCallback(
    (tableId: ID, index: number) => {
      if (justDropped()) return;
      const picked = ui.get().pickedGuestId;
      const occupant = occupantAt({ tableId, index });
      if (picked && editable && planRef.current.guests[picked]) {
        assignGuest(session.doc, picked, { tableId, index });
        ui.set({ pickedGuestId: null });
      } else if (occupant) {
        ui.set({ pickedGuestId: occupant === picked ? null : occupant });
      } else {
        ui.set({ selection: { kind: "table", id: tableId } });
      }
    },
    [editable, occupantAt, session],
  );

  // ---- Derived render data ----

  const tables = useMemo(() => Object.values(plan.tables), [plan.tables]);
  const fixtures = useMemo(() => Object.values(plan.fixtures), [plan.fixtures]);

  const occupantsByTable = useMemo(() => {
    const out = new Map<ID, (SeatOccupant | null)[]>();
    for (const table of tables) {
      const list: (SeatOccupant | null)[] = [];
      for (let i = 0; i < table.seatCount; i++) {
        const guestId = seating.occupant.get(seatKey({ tableId: table.id, index: i }));
        const guest = guestId ? plan.guests[guestId] : undefined;
        list.push(guest ? { guest, group: guest.groupId ? plan.groups[guest.groupId] : undefined } : null);
      }
      out.set(table.id, list);
    }
    return out;
  }, [tables, seating, plan.guests, plan.groups]);

  const remoteColorFor = useMemo(() => {
    const byTable = new Map<ID, string>();
    const byFixture = new Map<ID, string>();
    for (const r of remotes) {
      const d = r.dragging;
      if (!d) continue;
      if (d.tableId) byTable.set(d.tableId, r.user.color);
      if (d.fixtureId) byFixture.set(d.fixtureId, r.user.color);
      if (d.guestId) {
        const seat = seating.seatOf.get(d.guestId);
        if (seat) byTable.set(seat.tableId, r.user.color);
      }
    }
    return { byTable, byFixture };
  }, [remotes, seating]);

  const dropTarget = drag?.target;
  const pickedSeat = pickedGuestId ? seating.seatOf.get(pickedGuestId) : undefined;
  const showNames = view.scale > 0.45;

  // ---- Presence: cursor ----

  const lastCursorSent = useRef(0);
  const onPointerMove = () => {
    if (!session.awareness) return;
    const now = performance.now();
    if (now - lastCursorSent.current < 50) return;
    lastCursorSent.current = now;
    const pos = stageRef.current?.getRelativePointerPosition();
    if (pos) setPresence(session.awareness, { cursor: { x: Math.round(pos.x), y: Math.round(pos.y) } });
  };

  const onStageDown = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const target = e.target;
    if (target === target.getStage() || target.name() === "room") {
      ui.set({ selection: null });
    }
  };

  const room = plan.room;

  return (
    <div
      ref={containerRef}
      className="canvas-container"
      data-dropzone="canvas"
      data-testid="canvas"
      onPointerLeave={() => setPresence(session.awareness, { cursor: null })}
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable
        onDragMove={(e) => {
          // Keep React's view in step while panning, so a re-render mid-pan does not jump back.
          if (e.target === e.target.getStage()) setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
        }}
        onDragEnd={(e) => {
          if (e.target === e.target.getStage()) setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
        }}
        onMouseDown={onStageDown}
        onTouchStart={onStageDown}
        onPointerMove={onPointerMove}
      >
        <Layer listening={true}>
          <Rect
            name="room"
            x={0}
            y={0}
            width={room.width}
            height={room.height}
            fill={COLORS.room}
            stroke={room.showOutline ? COLORS.roomStroke : undefined}
            strokeWidth={room.showOutline ? 3 : 0}
            shadowColor="black"
            shadowOpacity={room.showOutline ? 0.06 : 0}
            shadowBlur={12}
          />
          {room.showGrid && room.gridSize >= 5 && (
            <Shape
              name="grid"
              listening={false}
              sceneFunc={(ctx) => {
                const g = room.gridSize;
                ctx.beginPath();
                for (let x = g; x < room.width; x += g) {
                  ctx.moveTo(x, 0);
                  ctx.lineTo(x, room.height);
                }
                for (let y = g; y < room.height; y += g) {
                  ctx.moveTo(0, y);
                  ctx.lineTo(room.width, y);
                }
                ctx.strokeStyle = COLORS.grid;
                ctx.lineWidth = 1;
                ctx.stroke();
              }}
            />
          )}
        </Layer>
        <Layer>
          {fixtures.map((f) => (
            <FixtureNode
              key={f.id}
              fixture={f}
              selected={selection?.kind === "fixture" && selection.id === f.id}
              editable={editable}
              remoteColor={remoteColorFor.byFixture.get(f.id) ?? null}
              gridSize={room.gridSize}
              snap={room.snap}
              onSelect={onSelectFixture}
              onMoved={onFixtureMoved}
              onDragState={onFixtureDrag}
              registerBody={registerBody}
            />
          ))}
          {tables.map((table) => {
            const occupants = occupantsByTable.get(table.id) ?? [];
            return (
              <TableNode
                key={table.id}
                table={table}
                occupants={occupants}
                stats={{ seated: occupants.filter(Boolean).length }}
                selected={selection?.kind === "table" && selection.id === table.id}
                editable={editable}
                dropSeat={dropTarget?.kind === "seat" && dropTarget.seat.tableId === table.id ? dropTarget.seat.index : null}
                dropTable={dropTarget?.kind === "table" && dropTarget.tableId === table.id}
                pickedSeat={pickedSeat?.tableId === table.id ? pickedSeat.index : null}
                remoteColor={remoteColorFor.byTable.get(table.id) ?? null}
                showNames={showNames}
                gridSize={room.gridSize}
                snap={room.snap}
                onSelect={onSelectTable}
                onMoved={onTableMoved}
                onDragState={onTableDrag}
                onSeatPointerDown={onSeatPointerDown}
                onSeatTap={onSeatTap}
                registerBody={registerBody}
              />
            );
          })}
        </Layer>
        <Layer ref={overlayRef}>
          <Transformer
            ref={trRef}
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            rotationSnapTolerance={6}
            keepRatio={selection?.kind === "table" && plan.tables[selection.id]?.shape === "round"}
            enabledAnchors={
              selection?.kind === "table" && plan.tables[selection.id]?.shape === "round"
                ? ["top-left", "top-right", "bottom-left", "bottom-right"]
                : ["top-left", "top-right", "bottom-left", "bottom-right", "middle-left", "middle-right", "top-center", "bottom-center"]
            }
            anchorSize={12}
            borderStroke={COLORS.selected}
            anchorStroke={COLORS.selected}
            boundBoxFunc={(oldBox, newBox) => (newBox.width < 30 || newBox.height < 30 ? oldBox : newBox)}
            onTransformEnd={onTransformEnd}
          />
          {remotes.map((r) =>
            r.cursor ? (
              <Group key={r.clientId} x={r.cursor.x} y={r.cursor.y} scaleX={1 / view.scale} scaleY={1 / view.scale} listening={false}>
                <Line points={[0, 0, 0, 18, 5, 14, 9, 22, 12, 21, 8, 13, 14, 13]} closed fill={r.user.color} stroke="#fff" strokeWidth={1} />
                <Rect x={12} y={20} width={Math.min(160, r.user.name.length * 7 + 12)} height={18} cornerRadius={4} fill={r.user.color} />
                <Text x={18} y={23} text={r.user.name} fontSize={12} fill="#fff" />
              </Group>
            ) : null,
          )}
        </Layer>
      </Stage>
      {tables.length === 0 && fixtures.length === 0 && (
        <div className="canvas-hint" data-testid="canvas-hint">
          {editable ? t("canvas.hint") : t("canvas.emptyReadOnly")}
        </div>
      )}
    </div>
  );
}
