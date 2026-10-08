import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { memo, useMemo } from "react";
import { Circle, Group, Line, Rect, Text } from "react-konva";
import { SEAT_RADIUS, barWidthOf, rotate, seatPositions, uOutline } from "../lib/geometry";
import type { Group as GuestGroup, Guest, Table } from "../types";
import { COLORS, initials, radialLabel } from "./style";

const NAME_WIDTH = 110;

export interface SeatOccupant {
  guest: Guest;
  group?: GuestGroup;
}

interface Props {
  table: Table;
  occupants: (SeatOccupant | null)[];
  stats: { seated: number };
  selected: boolean;
  editable: boolean;
  /** Seat index under the dragged guest. */
  dropSeat: number | null;
  /** Whole table is the drop target (group drag). */
  dropTable: boolean;
  /** Seat of the guest picked in the list. */
  pickedSeat: number | null;
  /** Color of a collaborator who is dragging this table, or one of its guests. */
  remoteColor: string | null;
  showNames: boolean;
  gridSize: number;
  snap: boolean;
  onSelect(id: string): void;
  onMoved(id: string, x: number, y: number): void;
  onDragState(id: string, dragging: boolean): void;
  onSeatPointerDown(tableId: string, index: number, e: KonvaEventObject<PointerEvent>): void;
  onSeatTap(tableId: string, index: number): void;
  registerBody(id: string, node: Konva.Shape | null): void;
}

function TableNodeImpl(props: Props) {
  const { table, occupants, selected, editable } = props;
  const seats = useMemo(() => seatPositions(table), [table]);
  const isRound = table.shape === "round";
  const bodyHeight = isRound ? table.width : table.height;
  const stopBubble = (e: KonvaEventObject<Event>) => {
    e.cancelBubble = true;
  };

  const stroke = props.dropTable ? COLORS.drop : selected ? COLORS.selected : (props.remoteColor ?? COLORS.tableStroke);
  const strokeWidth = selected || props.dropTable || props.remoteColor ? 3 : 1.5;
  const isU = table.shape === "u";
  const barWidth = isU ? barWidthOf(table) : 0;
  const labelWidth = isU ? Math.max(60, table.width - 16) : Math.max(60, Math.min(table.width, bodyHeight * 2) - 8);
  // On a Π-shaped table the label sits on the head bar; elsewhere in the middle.
  const labelY = isU ? -table.height / 2 + barWidth / 2 : 0;
  const bodyStyle = {
    fill: COLORS.tableFill,
    stroke,
    strokeWidth,
    shadowColor: "black",
    shadowOpacity: 0.08,
    shadowBlur: 6,
    shadowOffsetY: 2,
  };

  return (
    <Group
      id={`table-${table.id}`}
      x={table.x}
      y={table.y}
      rotation={table.rotation}
      draggable={editable}
      onMouseDown={() => props.onSelect(table.id)}
      onTap={() => props.onSelect(table.id)}
      onDragStart={() => props.onDragState(table.id, true)}
      onDragMove={(e) => {
        if (!props.snap || e.target !== e.currentTarget) return;
        const g = props.gridSize;
        e.target.position({ x: Math.round(e.target.x() / g) * g, y: Math.round(e.target.y() / g) * g });
      }}
      onDragEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        props.onDragState(table.id, false);
        props.onMoved(table.id, e.target.x(), e.target.y());
      }}
    >
      {isRound ? (
        <Circle
          ref={(n) => props.registerBody(table.id, n)}
          radius={table.width / 2}
          fill={COLORS.tableFill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          shadowColor="black"
          shadowOpacity={0.08}
          shadowBlur={6}
          shadowOffsetY={2}
        />
      ) : isU ? (
        <Line
          ref={(n) => props.registerBody(table.id, n)}
          points={uOutline(table.width, table.height, barWidth)}
          closed
          lineJoin="round"
          {...bodyStyle}
        />
      ) : (
        <Rect
          ref={(n) => props.registerBody(table.id, n)}
          width={table.width}
          height={table.height}
          offsetX={table.width / 2}
          offsetY={table.height / 2}
          cornerRadius={6}
          fill={COLORS.tableFill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          shadowColor="black"
          shadowOpacity={0.08}
          shadowBlur={6}
          shadowOffsetY={2}
        />
      )}
      <Text
        text={`${table.label}\n${props.stats.seated}/${table.seatCount}`}
        y={labelY}
        width={labelWidth}
        height={40}
        offsetX={labelWidth / 2}
        offsetY={20}
        rotation={-table.rotation}
        align="center"
        verticalAlign="middle"
        fontSize={13}
        lineHeight={1.25}
        fontStyle="bold"
        fill={COLORS.tableText}
        ellipsis
        wrap="none"
        listening={false}
      />
      {seats.map((s, i) => {
        const occ = occupants[i];
        const isDrop = props.dropSeat === i;
        const isPicked = props.pickedSeat === i;
        const worldNormal = rotate({ x: s.nx, y: s.ny }, table.rotation);
        const label = radialLabel(worldNormal, NAME_WIDTH);
        return (
          <Group key={i} x={s.x} y={s.y}>
            <Circle
              name="seat"
              radius={SEAT_RADIUS}
              fill={occ ? (occ.group?.color ?? COLORS.seatTaken) : COLORS.seatFree}
              stroke={isDrop ? COLORS.drop : isPicked ? COLORS.selected : occ ? COLORS.seatTakenStroke : COLORS.seatFreeStroke}
              strokeWidth={isDrop || isPicked ? 3 : 1.2}
              dash={occ ? undefined : [3, 3]}
              hitStrokeWidth={8}
              onPointerDown={(e) => props.onSeatPointerDown(table.id, i, e)}
              onMouseDown={stopBubble}
              onTouchStart={stopBubble}
              onClick={() => props.onSeatTap(table.id, i)}
              onTap={() => props.onSeatTap(table.id, i)}
              onMouseEnter={(e) => {
                const c = e.target.getStage()?.container();
                if (c && editable) c.style.cursor = occ ? "grab" : "pointer";
              }}
              onMouseLeave={(e) => {
                const c = e.target.getStage()?.container();
                if (c) c.style.cursor = "";
              }}
            />
            {occ ? (
              <Text
                text={initials(occ.guest.name)}
                width={SEAT_RADIUS * 2}
                height={SEAT_RADIUS * 2}
                offsetX={SEAT_RADIUS}
                offsetY={SEAT_RADIUS}
                rotation={-table.rotation}
                align="center"
                verticalAlign="middle"
                fontSize={10}
                fontStyle="bold"
                fill={COLORS.seatText}
                listening={false}
              />
            ) : (
              <Text
                text={String(i + 1)}
                width={SEAT_RADIUS * 2}
                height={SEAT_RADIUS * 2}
                offsetX={SEAT_RADIUS}
                offsetY={SEAT_RADIUS}
                rotation={-table.rotation}
                align="center"
                verticalAlign="middle"
                fontSize={9}
                fill={COLORS.seatNumber}
                listening={false}
              />
            )}
            {occ?.guest.isChild && (
              <Circle x={SEAT_RADIUS * 0.72} y={-SEAT_RADIUS * 0.72} radius={4} fill={COLORS.child} stroke="#fff" strokeWidth={1} listening={false} />
            )}
            {occ && props.showNames && (
              <Text
                x={s.nx * (SEAT_RADIUS + 4)}
                y={s.ny * (SEAT_RADIUS + 4)}
                text={occ.guest.name}
                width={NAME_WIDTH}
                offsetX={label.offsetX}
                offsetY={6}
                align={label.align}
                rotation={label.rotation - table.rotation}
                fontSize={11}
                fill={COLORS.nameText}
                wrap="none"
                ellipsis
                listening={false}
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
}

export const TableNode = memo(TableNodeImpl);
