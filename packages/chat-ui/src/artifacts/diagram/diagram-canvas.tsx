"use client";

import "@xyflow/react/dist/base.css";

import { useLingui } from "@lingui/react/macro";
import type { Diagram } from "@workspace/artifacts-kit/kinds/diagram/schema";
import { cn } from "@workspace/ui/lib/utils";
import {
  applyNodeChanges,
  Background,
  type Connection,
  Controls,
  type Edge,
  getNodesBounds,
  getViewportForBounds,
  Handle,
  MarkerType,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnNodeDrag,
  Position,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import {
  type CSSProperties,
  createContext,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import type { DiagramPicture } from "./export";
import {
  connectNodes,
  type DiagramFlowNode,
  deleteParts,
  diagramToFlow,
  type GroupNodeData,
  handleSides,
  moveNodes,
  relabelNode,
  type ShapeNodeData,
  type Side,
} from "./flow";

// The diagram canvas (165), on React Flow (MIT): the kit lays the graph
// out, and a person may drag nodes (their places save), rename one (double
// click, or Enter on it), draw an edge from one node's handle to another's,
// and delete what's selected (Delete or Backspace). Every edit is a new
// diagram handed to `onChange`, which saves it as a version. React Flow's
// own colours are replaced by the theme's tokens.

type ShapeFlowNode = Node<ShapeNodeData, "shape">;
type GroupFlowNode = Node<GroupNodeData, "group">;
type CanvasNode = GroupFlowNode | ShapeFlowNode;

/** How a node renames itself, and whether it may. */
interface CanvasActions {
  readonly editable: boolean;
  readonly rename: (id: string, label: string) => void;
  readonly sides: { readonly source: Side; readonly target: Side };
}

const CanvasContext = createContext<CanvasActions>({
  editable: false,
  rename: () => undefined,
  sides: { source: "bottom", target: "top" },
});

const POSITIONS: Readonly<Record<Side, Position>> = {
  bottom: Position.Bottom,
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
};

/** React Flow's colours, as the theme's tokens. */
const THEME = {
  "--xy-background-color": "var(--background)",
  "--xy-background-pattern-color": "var(--border)",
  "--xy-connectionline-stroke": "var(--ring)",
  "--xy-edge-stroke": "var(--muted-foreground)",
  "--xy-edge-stroke-selected": "var(--foreground)",
  "--xy-handle-background-color": "var(--muted-foreground)",
  "--xy-node-border": "0",
  "--xy-node-border-selected": "0",
  "--xy-node-color": "var(--foreground)",
  "--xy-selection-background-color": "var(--accent)",
  "--xy-selection-border": "1px dotted var(--ring)",
} as CSSProperties;

const EDGE_LABEL_STYLE: CSSProperties = {
  fill: "var(--foreground)",
  fontSize: 12,
};
const EDGE_LABEL_BG_STYLE: CSSProperties = { fill: "var(--background)" };

const SHAPE_CLASS: Readonly<Record<ShapeNodeData["shape"], string>> = {
  circle: "rounded-full border",
  // The diamond is drawn by its SVG, so the box itself has no border.
  diamond: "",
  rect: "rounded-sm border",
  rounded: "rounded-xl border",
  stadium: "rounded-full border",
};

function ShapeNode({ data, id, selected }: NodeProps<ShapeFlowNode>) {
  const { t } = useLingui();
  const { editable, rename, sides } = useContext(CanvasContext);
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      input.current?.select();
    }
  }, [editing]);
  const start = useCallback(() => {
    if (editable) {
      setEditing(true);
    }
  }, [editable]);
  const finish = useCallback(
    (save: boolean) => {
      if (save && input.current) {
        rename(id, input.current.value);
      }
      setEditing(false);
    },
    [id, rename]
  );
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!editing && (event.key === "Enter" || event.key === "F2")) {
        event.preventDefault();
        start();
      }
    },
    [editing, start]
  );
  const onInputKey = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      // Keys typed into the label aren't the canvas's shortcuts.
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    },
    [finish]
  );
  const onBlur = useCallback(() => finish(true), [finish]);
  const isDiamond = data.shape === "diamond";
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: React Flow makes the node wrapper focusable and announces it; this only adds rename on Enter and double click.
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: see above.
    <div
      className={cn(
        "relative flex size-full items-center justify-center bg-card px-3 text-center text-card-foreground text-sm transition-colors duration-(--motion-fast)",
        isDiamond ? "bg-transparent" : "border-border",
        SHAPE_CLASS[data.shape],
        selected && !isDiamond && "border-ring ring-2 ring-ring/50"
      )}
      data-diagram-node={id}
      data-shape={data.shape}
      onDoubleClick={start}
      onKeyDown={onKeyDown}
    >
      {isDiamond ? (
        <svg
          aria-hidden
          className="absolute inset-0 size-full overflow-visible"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          <polygon
            className={cn("fill-card stroke-border", selected && "stroke-ring")}
            points="50,0 100,50 50,100 0,50"
            strokeWidth={selected ? 2 : 1}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}
      <Handle
        className={cn(!editable && "invisible")}
        isConnectable={editable}
        position={POSITIONS[sides.target]}
        type="target"
      />
      {editing ? (
        <input
          aria-label={t`Node label`}
          className="nodrag relative w-full min-w-0 rounded-sm border border-input bg-background px-1 text-center text-foreground text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          defaultValue={data.label}
          maxLength={200}
          onBlur={onBlur}
          onKeyDown={onInputKey}
          ref={input}
        />
      ) : (
        <span className="relative line-clamp-3 break-words">{data.label}</span>
      )}
      <Handle
        className={cn(!editable && "invisible")}
        isConnectable={editable}
        position={POSITIONS[sides.source]}
        type="source"
      />
    </div>
  );
}

function GroupNode({ data }: NodeProps<GroupFlowNode>) {
  return (
    <div className="pointer-events-none size-full rounded-xl border border-border border-dashed bg-muted/40">
      <span className="absolute start-3 top-1.5 text-muted-foreground text-xs">
        {data.label}
      </span>
    </div>
  );
}

const NODE_TYPES = { group: GroupNode, shape: ShapeNode };

const toCanvasNodes = (nodes: readonly DiagramFlowNode[]): CanvasNode[] =>
  nodes.map((node) => ({ ...node }) as CanvasNode);

/** What the view asks of the canvas: a picture of it, for export. */
export interface DiagramCanvasHandle {
  readonly picture: () => DiagramPicture | null;
}

export interface DiagramCanvasProps {
  readonly diagram: Diagram;
  readonly editable: boolean;
  readonly handle?: Ref<DiagramCanvasHandle>;
  readonly label: string;
  readonly onChange: (next: Diagram) => void;
  /** Extra controls over the canvas (Add node). */
  readonly toolbar?: ReactNode;
}

const PICTURE_PADDING = 0.05;

// React Flow fills its parent; in a short panel the canvas still needs room
// to drag in. Inline, so it holds wherever the canvas is mounted.
const CANVAS_STYLE: CSSProperties = { minHeight: 320 };

export function DiagramCanvas({
  diagram,
  editable,
  handle,
  label,
  onChange,
  toolbar,
}: DiagramCanvasProps) {
  const { t } = useLingui();
  const flow = useMemo(() => diagramToFlow(diagram), [diagram]);
  // React Flow moves nodes while they're dragged; the diagram changes when
  // they're dropped.
  const [nodes, setNodes] = useState<CanvasNode[]>(() =>
    toCanvasNodes(flow.nodes)
  );
  useEffect(() => {
    setNodes(toCanvasNodes(flow.nodes));
  }, [flow.nodes]);
  const edges = useMemo(
    (): Edge[] =>
      flow.edges.map((edge) => ({
        ...edge,
        labelBgPadding: [4, 2],
        labelBgStyle: EDGE_LABEL_BG_STYLE,
        labelStyle: EDGE_LABEL_STYLE,
        markerEnd: {
          color: "var(--muted-foreground)",
          type: MarkerType.ArrowClosed,
        },
        type: "smoothstep",
      })),
    [flow.edges]
  );

  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(diagram);
  latest.current = diagram;
  const commit = useCallback(
    (next: Diagram) => {
      if (next !== latest.current) {
        onChange(next);
      }
    },
    [onChange]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) =>
      setNodes((current) =>
        applyNodeChanges(
          // Removing goes through the diagram (`onDelete`), not here.
          changes.filter((change) => change.type !== "remove"),
          current
        )
      ),
    []
  );
  const onNodeDragStop: OnNodeDrag<CanvasNode> = useCallback(
    (_event, _node, dragged) =>
      commit(
        moveNodes(
          latest.current,
          dragged.map((each) => ({ id: each.id, position: each.position }))
        )
      ),
    [commit]
  );
  const onConnect = useCallback(
    (connection: Connection) =>
      commit(
        connectNodes(latest.current, connection.source, connection.target)
      ),
    [commit]
  );
  const onDelete = useCallback(
    ({
      edges: gone,
      nodes: removed,
    }: {
      readonly edges: readonly Edge[];
      readonly nodes: readonly Node[];
    }) =>
      commit(
        deleteParts(
          latest.current,
          removed.map((node) => node.id),
          gone.map((edge) => edge.id)
        )
      ),
    [commit]
  );
  const actions = useMemo(
    (): CanvasActions => ({
      editable,
      rename: (id, text) => commit(relabelNode(latest.current, id, text)),
      sides: handleSides(diagram.direction),
    }),
    [commit, diagram.direction, editable]
  );

  return (
    <CanvasContext.Provider value={actions}>
      <div
        className="relative min-h-0 flex-1"
        data-artifact-kind="diagram"
        data-editable={editable}
        ref={root}
        style={CANVAS_STYLE}
      >
        <ReactFlow<CanvasNode>
          aria-label={label}
          deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
          edges={edges}
          edgesFocusable={editable}
          elementsSelectable
          fitView
          maxZoom={2}
          minZoom={0.2}
          nodes={nodes}
          nodesConnectable={editable}
          nodesDraggable={editable}
          nodeTypes={NODE_TYPES}
          onConnect={onConnect}
          onDelete={onDelete}
          onNodeDragStop={onNodeDragStop}
          onNodesChange={onNodesChange}
          proOptions={{ hideAttribution: true }}
          style={THEME}
        >
          <Background gap={20} size={1} />
          <Controls
            aria-label={t`Zoom`}
            className="overflow-hidden rounded-md border border-border bg-card [&_button:hover]:bg-accent [&_button]:border-border [&_button]:bg-card [&_button]:text-foreground [&_svg]:fill-current"
            data-export-ignore="true"
            showInteractive={false}
          />
          <PictureHandle handle={handle} root={root} />
        </ReactFlow>
        {toolbar ? (
          <div
            className="absolute end-3 top-3 z-10 flex items-center gap-1"
            data-export-ignore="true"
          >
            {toolbar}
          </div>
        ) : null}
      </div>
    </CanvasContext.Provider>
  );
}

/** Inside React Flow's provider: measures the nodes for a picture. */
function PictureHandle({
  handle,
  root,
}: {
  readonly handle?: Ref<DiagramCanvasHandle>;
  readonly root: RefObject<HTMLDivElement | null>;
}) {
  const { getNodes } = useReactFlow();
  useImperativeHandle(
    handle,
    () => ({
      picture: () => {
        const viewport =
          root.current?.querySelector<HTMLElement>(".react-flow__viewport") ??
          null;
        const all = getNodes();
        if (!viewport || all.length === 0) {
          return null;
        }
        const bounds = getNodesBounds(all);
        const width = Math.ceil(bounds.width * (1 + PICTURE_PADDING * 2));
        const height = Math.ceil(bounds.height * (1 + PICTURE_PADDING * 2));
        const view = getViewportForBounds(
          bounds,
          width,
          height,
          1,
          1,
          PICTURE_PADDING
        );
        const pane = viewport.closest<HTMLElement>(".react-flow");
        return {
          background: pane ? getComputedStyle(pane).backgroundColor : "",
          height,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          viewport,
          width,
        };
      },
    }),
    [getNodes, root]
  );
  return null;
}
