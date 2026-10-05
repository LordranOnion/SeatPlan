import type Konva from "konva";
import { memo } from "react";
import { Group, Rect, Text } from "react-konva";
import type { Fixture } from "../types";
import { COLORS } from "./style";

interface Props {
  fixture: Fixture;
  selected: boolean;
  editable: boolean;
  remoteColor: string | null;
  gridSize: number;
  snap: boolean;
  onSelect(id: string): void;
  onMoved(id: string, x: number, y: number): void;
  onDragState(id: string, dragging: boolean): void;
  registerBody(id: string, node: Konva.Shape | null): void;
}

/** Fixed non-seat object (dance floor, buffet, stage, entrance): a labeled rectangle. */
function FixtureNodeImpl({ fixture, selected, editable, remoteColor, ...props }: Props) {
  return (
    <Group
      id={`fixture-${fixture.id}`}
      x={fixture.x}
      y={fixture.y}
      rotation={fixture.rotation}
      draggable={editable}
      onMouseDown={() => props.onSelect(fixture.id)}
      onTap={() => props.onSelect(fixture.id)}
      onDragStart={() => props.onDragState(fixture.id, true)}
      onDragMove={(e) => {
        if (!props.snap || e.target !== e.currentTarget) return;
        const g = props.gridSize;
        e.target.position({ x: Math.round(e.target.x() / g) * g, y: Math.round(e.target.y() / g) * g });
      }}
      onDragEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        props.onDragState(fixture.id, false);
        props.onMoved(fixture.id, e.target.x(), e.target.y());
      }}
    >
      <Rect
        ref={(n) => props.registerBody(fixture.id, n)}
        width={fixture.width}
        height={fixture.height}
        offsetX={fixture.width / 2}
        offsetY={fixture.height / 2}
        fill={COLORS.fixtureFill}
        stroke={selected ? COLORS.selected : (remoteColor ?? COLORS.fixtureStroke)}
        strokeWidth={selected || remoteColor ? 3 : 1.5}
        dash={[8, 4]}
        cornerRadius={4}
      />
      <Text
        text={fixture.label}
        width={Math.max(40, fixture.width - 8)}
        height={30}
        offsetX={Math.max(40, fixture.width - 8) / 2}
        offsetY={15}
        rotation={-fixture.rotation}
        align="center"
        verticalAlign="middle"
        fontSize={14}
        fontStyle="bold"
        fill={COLORS.fixtureText}
        ellipsis
        wrap="none"
        listening={false}
      />
    </Group>
  );
}

export const FixtureNode = memo(FixtureNodeImpl);
