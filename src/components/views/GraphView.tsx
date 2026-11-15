import { memo, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { useSolution, maxBelt, maxPipe } from '../../lib/engine';
import { useStore } from '../../lib/store';
import { BUILDINGS, BELTS, PIPES, isLiquid, itemName, unitOf } from '../../lib/gamedata';
import { buildGraph, type Step } from '../../lib/analysis';
import { num, pct, mw } from '../../lib/format';
import { ItemIcon, BuildingIcon } from '../ItemIcon';

type StepData = { step: Step; decimals: number };
type ItemData = { item: string; amount: number; kind: string };
type FlowData = { item: string; amount: number; tier: number };

const StepNode = memo(({ data }: NodeProps<Node<StepData>>) => {
  const s = data.step;
  const b = BUILDINGS[s.recipe.building];
  const main = s.outputs[0];
  return (
    <div className={'gnode step' + (s.sloop ? ' sloop' : '') + (s.recipe.kind === 'power' ? ' gen' : '')}>
      <Handle type="target" position={Position.Left} />
      <div className="gnode-top">
        <BuildingIcon building={s.recipe.building} size={30} />
        <div>
          <div className="gnode-count">
            {s.count} × {b?.name}
            {s.sloop ? ' ✦' : ''}
          </div>
          <div className="gnode-clock">@ {pct(s.clock, data.decimals)}</div>
        </div>
      </div>
      <div className="gnode-recipe">{s.recipe.name}</div>
      <div className="gnode-out">
        {s.recipe.kind === 'power' ? (
          <span className="good-text">⚡ {mw(s.generated)}</span>
        ) : (
          main && (
            <span>
              <ItemIcon item={main[0]} size={16} /> {num(main[1])} {unitOf(main[0])}
            </span>
          )
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

const ItemNode = memo(({ data }: NodeProps<Node<ItemData>>) => {
  const label = { raw: 'Raw input', provided: 'Supplied', output: 'Output', waste: 'Surplus', missing: 'Can’t make' }[data.kind] ?? '';
  return (
    <div className={'gnode item ' + data.kind}>
      {data.kind !== 'raw' && data.kind !== 'provided' && data.kind !== 'missing' && <Handle type="target" position={Position.Left} />}
      <ItemIcon item={data.item} size={30} />
      <div>
        <div className="gnode-label">{label}</div>
        <div className="gnode-name">{itemName(data.item)}</div>
        <div className="gnode-amt">
          {num(data.amount)} {unitOf(data.item)}
        </div>
      </div>
      {(data.kind === 'raw' || data.kind === 'provided' || data.kind === 'missing') && <Handle type="source" position={Position.Right} />}
    </div>
  );
});

function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps<Edge<FlowData>>) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const d = data!;
  const liquid = isLiquid(d.item);
  const lanes = liquid ? PIPES.filter((p) => p.tier <= d.tier) : BELTS.filter((b) => b.tier <= d.tier);
  const best = lanes[lanes.length - 1];
  const fits = lanes.find((l) => l.rate >= d.amount - 1e-6);
  const over = !fits;
  const title = fits
    ? `${num(d.amount)} ${unitOf(d.item)} ${itemName(d.item)}: ${liquid ? 'pipe' : 'belt'} ${fits.name} or better`
    : `${num(d.amount)} ${unitOf(d.item)} ${itemName(d.item)}: needs ${Math.ceil(d.amount / best.rate)} × ${best.name} ${liquid ? 'pipes' : 'belts'}`;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={'flow-edge' + (liquid ? ' liquid' : '') + (over ? ' over' : '')} />
      <EdgeLabelRenderer>
        <div className={'edge-label' + (over ? ' over' : '')} style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }} title={title}>
          <ItemIcon item={d.item} size={14} />
          {num(d.amount)}
          {over ? ` ⚠${Math.ceil(d.amount / best.rate)}×` : ''}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { step: StepNode, item: ItemNode };
const edgeTypes = { flow: FlowEdge };

function layout(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 26, ranksep: 110, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.type === 'step' ? 230 : 190, height: n.type === 'step' ? 96 : 64 });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    const w = n.type === 'step' ? 230 : 190;
    const h = n.type === 'step' ? 96 : 64;
    return { ...n, position: { x: p.x - w / 2, y: p.y - h / 2 } };
  });
}

function GraphInner() {
  const { analysis, settings } = useSolution();
  const setUI = useStore((s) => s.setUI);
  const rf = useReactFlow();
  const tier = settings.tier;

  const { nodes, edges } = useMemo(() => {
    if (!analysis) return { nodes: [] as Node[], edges: [] as Edge[] };
    const g = buildGraph(analysis);
    const nodes: Node[] = g.nodes.map((n) =>
      n.kind === 'step'
        ? { id: n.id, type: 'step', position: { x: 0, y: 0 }, data: { step: analysis.stepByKey[n.stepKey!], decimals: settings.clockDecimals } }
        : { id: n.id, type: 'item', position: { x: 0, y: 0 }, data: { item: n.item!, amount: n.amount ?? 0, kind: n.kind } },
    );
    const edges: Edge[] = g.edges.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      type: 'flow',
      data: { item: e.item, amount: e.amount, tier },
    }));
    return { nodes: layout(nodes, edges), edges };
  }, [analysis, settings.clockDecimals, tier]);

  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: 0.08, duration: 200 }), 30);
    return () => clearTimeout(t);
  }, [nodes, rf]);

  // Re-fit when the pane changes size (split view, side panel drag)
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => rf.fitView({ padding: 0.08, duration: 150 }), 120);
    });
    ro.observe(el);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, [rf]);

  if (!analysis) return null;
  return (
    <div className="graph-wrap" ref={wrapRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => {
          if (n.type === 'step') {
            const st = (n.data as StepData).step;
            const item = st.recipe.kind === 'power' ? 'Power' : st.recipe.out[0][0];
            setUI({ sideTab: 'recipes', focusItem: item });
          } else {
            const d = n.data as ItemData;
            if (d.kind === 'waste') setUI({ sideTab: 'byproducts' });
            else if (d.kind === 'raw' || d.kind === 'provided') setUI({ sideTab: 'inputs' });
            else setUI({ sideTab: 'recipes', focusItem: d.item });
          }
        }}
      >
        <Background color="#3a3f46" gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div className="graph-legend">
        <span>
          Belts up to {maxBelt(tier).name} ({maxBelt(tier).rate}/min), pipes {maxPipe(tier).name} ({maxPipe(tier).rate} m³/min). ⚠ = needs more than one.
        </span>
      </div>
    </div>
  );
}

export function GraphView() {
  return (
    <ReactFlowProvider>
      <GraphInner />
    </ReactFlowProvider>
  );
}
