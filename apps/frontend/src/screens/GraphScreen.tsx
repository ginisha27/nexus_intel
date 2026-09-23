/**
 * GraphScreen — sigma.js + graphology port
 * ─────────────────────────────────────────────────────────────────────────
 * This is a direct port of the original hand-rolled <svg> implementation.
 * Everything that was pure data/layout logic (deterministic FR simulation,
 * connected-component packing, focus-mode radial layout, fetch/filter
 * state, side panels) is UNCHANGED — only the render target moved from
 * manual SVG elements + manual viewBox math to a Sigma WebGL renderer.
 *
 * Deps this file assumes are installed:
 *   npm install sigma graphology @sigma/node-border @sigma/utils
 *
 * Version note: sigma's addon packages (@sigma/node-border, @sigma/utils)
 * have shifted API shape across sigma v2 → v3 releases. The shapes used
 * below match sigma ^3.0's public API as documented; if your installed
 * version differs, `createNodeBorderProgram`'s config shape and
 * `fitViewportToNodes`'s signature are the two spots most likely to need
 * a small adjustment — everything else (reducers, events, camera.animate)
 * has been stable across v3 minor versions. I was not able to compile or
 * run this in a live project here (no network / no access to your actual
 * `../data`, `../components/shared`, `@/lib/api` modules), so please run
 * a type-check after installing before trusting it wholesale.
 *
 * Known visual trade-offs vs. the original SVG version (see comments at
 * each spot below for why):
 *   - The gaussian-blur glow halo is replaced with a crisp WebGL border
 *     ring (via @sigma/node-border). True blur glow would need a hand
 *     written WebGL fragment shader; not worth it for the payoff.
 *   - Animated dashed "flowing" edges are replaced with static edges at
 *     reduced opacity. WebGL edges don't support CSS-style dashoffset
 *     animation out of the box.
 *   - The selection ring's dash animation is likewise a static ring now.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import type { NodeDisplayData, EdgeDisplayData } from "sigma/types";
import { createNodeBorderProgram } from "@sigma/node-border";
import { fitViewportToNodes } from "@sigma/utils";

import { riskColorLight } from "../data";
import { RingScore, RiskBadge } from "../components/shared";
import { apiGet } from "@/lib/api";

const typeColors: Record<string, string> = { entity: "#6366f1", market: "#8b5cf6", wallet: "#06b6d4", comm: "#16a34a" };
const typeIcons: Record<string, string> = { entity: "◈", market: "▤", wallet: "◇", comm: "◉" };
const ALL_TYPES = Object.keys(typeColors);
const toolbarIconStyle: React.CSSProperties = {
  background: "none", border: "none", color: "var(--text-3)", cursor: "pointer",
  padding: "5px 8px", borderRadius: 5, fontSize: 16, transition: "color 0.12s",
};

// ─────────────────────────────────────────────────────────────────────────
// Deterministic force-directed layout — UNCHANGED from the original file.
//
// This is a plain, dependency-free Fruchterman-Reingold-style simulation
// (attraction along real edges + global repulsion + a final collision
// pass). It is kept exactly as-is rather than swapped for
// graphology-layout-forceatlas2 because the determinism guarantee (same
// graph data -> byte-identical layout, no Math.random anywhere) is a
// deliberate product requirement, not an implementation detail — a
// generic forceatlas2 run won't reproduce that without the same care.
// The only thing that changes below is where the computed {x,y} values
// get written: into graphology node attributes instead of a local Map
// consumed by SVG <circle> elements.
// ─────────────────────────────────────────────────────────────────────────

const LAYOUT_LINK_DISTANCE = 70;
const LAYOUT_MIN_GAP = 56;
const LAYOUT_COMPONENT_GAP = 40;
const LAYOUT_MAX_ITERATIONS = 300;
const LAYOUT_CONVERGENCE_EPSILON = 0.03;
const LAYOUT_PADDING = 70;
const FOCUS_MIN_VIEWBOX_SIZE = 420;
const FOCUS_PADDING = 110;

type LayoutPoint = { x: number; y: number };
type LayoutEdge = { from: string; to: string };

function layoutHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 10000) / 10000;
}

function findConnectedComponents(nodeIds: string[], edges: LayoutEdge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  nodeIds.forEach((id) => adjacency.set(id, []));
  edges.forEach((e) => {
    if (!adjacency.has(e.from) || !adjacency.has(e.to)) return;
    adjacency.get(e.from)!.push(e.to);
    adjacency.get(e.to)!.push(e.from);
  });

  const visited = new Set<string>();
  const components: string[][] = [];
  const orderedIds = [...nodeIds].sort();

  for (const id of orderedIds) {
    if (visited.has(id)) continue;
    const queue = [id];
    visited.add(id);
    const comp: string[] = [];
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      comp.push(current);
      for (const n of adjacency.get(current) ?? []) {
        if (!visited.has(n)) { visited.add(n); queue.push(n); }
      }
    }
    comp.sort();
    components.push(comp);
  }

  components.sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
  return components;
}

function layoutComponent(ids: string[], edges: LayoutEdge[]): Map<string, LayoutPoint> {
  const positions = new Map<string, LayoutPoint>();
  if (ids.length === 1) {
    positions.set(ids[0], { x: 0, y: 0 });
    return positions;
  }

  const initialRadius =
    LAYOUT_LINK_DISTANCE * Math.max(0.8, Math.sqrt(ids.length) * 0.55);
  ids.forEach((id) => {
    const angle = layoutHash(id) * 2 * Math.PI;
    positions.set(id, { x: initialRadius * Math.cos(angle), y: initialRadius * Math.sin(angle) });
  });

  const k = LAYOUT_LINK_DISTANCE;
  let temperature = LAYOUT_LINK_DISTANCE * 0.6;
  const cooling = temperature / LAYOUT_MAX_ITERATIONS;

  for (let iter = 0; iter < LAYOUT_MAX_ITERATIONS; iter++) {
    const disp = new Map<string, LayoutPoint>();
    ids.forEach((id) => disp.set(id, { x: 0, y: 0 }));

    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const pa = positions.get(ids[a])!;
        const pb = positions.get(ids[b])!;
        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (k * k) / dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const da = disp.get(ids[a])!; da.x += fx; da.y += fy;
        const db = disp.get(ids[b])!; db.x -= fx; db.y -= fy;
      }
    }

    for (const e of edges) {
      const pa = positions.get(e.from);
      const pb = positions.get(e.to);
      if (!pa || !pb) continue;
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist * dist) / k;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const da = disp.get(e.from)!; da.x -= fx; da.y -= fy;
      const db = disp.get(e.to)!; db.x += fx; db.y += fy;
    }

    let maxDisp = 0;
    ids.forEach((id) => {
      const d = disp.get(id)!;
      const dist = Math.sqrt(d.x * d.x + d.y * d.y) || 0.0001;
      const capped = Math.min(dist, temperature);
      const p = positions.get(id)!;
      p.x += (d.x / dist) * capped;
      p.y += (d.y / dist) * capped;
      maxDisp = Math.max(maxDisp, capped);
    });
    temperature = Math.max(0.01, temperature - cooling);

    if (maxDisp < LAYOUT_CONVERGENCE_EPSILON) break;
  }

  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const pa = positions.get(ids[a])!;
        const pb = positions.get(ids[b])!;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        if (dist < LAYOUT_MIN_GAP) {
          const push = (LAYOUT_MIN_GAP - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          pa.x -= ux * push; pa.y -= uy * push;
          pb.x += ux * push; pb.y += uy * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  return positions;
}

function arrangeComponents(
  components: string[][],
  edgesByComponent: Map<number, LayoutEdge[]>
): { positions: Map<string, LayoutPoint>; bounds: { minX: number; minY: number; maxX: number; maxY: number } } {
  const positions = new Map<string, LayoutPoint>();
  if (components.length === 0) return { positions, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };

  const items = components.map((comp, idx) => {
    const local = layoutComponent(comp, edgesByComponent.get(idx) ?? []);
    let cx = 0, cy = 0;
    local.forEach((p) => { cx += p.x; cy += p.y; });
    cx /= local.size; cy /= local.size;
    let radius = LAYOUT_MIN_GAP / 2;
    local.forEach((p) => { radius = Math.max(radius, Math.hypot(p.x - cx, p.y - cy)); });
    const centered = new Map<string, LayoutPoint>();
    local.forEach((p, id) => centered.set(id, { x: p.x - cx, y: p.y - cy }));
    return { idx, ids: comp, local: centered, radius, isIsolated: comp.length === 1 };
  });

  const main = items[0];
  const satellites = items.slice(1).filter((it) => !it.isIsolated);
  const isolates = items.slice(1).filter((it) => it.isIsolated);

  const centers = new Map<number, LayoutPoint>();
  centers.set(main.idx, { x: 0, y: 0 });

  const ringGap = LAYOUT_COMPONENT_GAP;
  const satelliteRingRadius = main.radius + ringGap;

  satellites.forEach((item, i) => {
    const angle = (i / satellites.length) * 2 * Math.PI;
    const dist = satelliteRingRadius + item.radius;
    centers.set(item.idx, { x: dist * Math.cos(angle), y: dist * Math.sin(angle) });
  });

  const satelliteOuterReach = satellites.reduce((max, item) => {
    const c = centers.get(item.idx)!;
    return Math.max(max, Math.hypot(c.x, c.y) + item.radius);
  }, main.radius);
  const isolateRingRadius = satelliteOuterReach + ringGap;

  isolates.forEach((item, i) => {
    const angle = ((i + 0.5) / isolates.length) * 2 * Math.PI;
    const dist = isolateRingRadius + item.radius;
    centers.set(item.idx, { x: dist * Math.cos(angle), y: dist * Math.sin(angle) });
  });

  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (let a = 0; a < items.length; a++) {
      for (let b = a + 1; b < items.length; b++) {
        const ca = centers.get(items[a].idx)!;
        const cb = centers.get(items[b].idx)!;
        const dx = cb.x - ca.x;
        const dy = cb.y - ca.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const minDist = items[a].radius + items[b].radius + ringGap;
        if (dist < minDist) {
          const push = (minDist - dist) / 2;
          const ux = dx / dist, uy = dy / dist;
          if (a === 0) {
            cb.x += ux * push * 2; cb.y += uy * push * 2;
          } else {
            ca.x -= ux * push; ca.y -= uy * push;
            cb.x += ux * push; cb.y += uy * push;
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  items.forEach((item) => {
    const c = centers.get(item.idx)!;
    item.local.forEach((p, id) => {
      const gx = p.x + c.x;
      const gy = p.y + c.y;
      positions.set(id, { x: gx, y: gy });
      minX = Math.min(minX, gx); maxX = Math.max(maxX, gx);
      minY = Math.min(minY, gy); maxY = Math.max(maxY, gy);
    });
  });

  if (!isFinite(minX)) { minX = minY = maxX = maxY = 0; }
  return { positions, bounds: { minX, minY, maxX, maxY } };
}

function computeGraphLayout(
  nodes: { id: string; x?: number; y?: number }[],
  edges: LayoutEdge[]
): {
  positions: Map<string, LayoutPoint>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
} {
  if (nodes.length === 0) return { positions: new Map(), bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };

  const LARGE_GRAPH_THRESHOLD = 250;

  if (nodes.length > LARGE_GRAPH_THRESHOLD) {
    const positions = new Map<string, LayoutPoint>();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    nodes.forEach((node, index) => {
      const x = Number.isFinite(node.x) ? node.x! : (index % 20) * 80;
      const y = Number.isFinite(node.y) ? node.y! : Math.floor(index / 20) * 80;
      positions.set(node.id, { x, y });
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    });

    return { positions, bounds: { minX, minY, maxX, maxY } };
  }

  const nodeIds = nodes.map((n) => n.id);
  const validEdges = edges.filter((e) => e.from && e.to && e.from !== e.to);
  const components = findConnectedComponents(nodeIds, validEdges);
  const edgesByComponent = new Map<number, LayoutEdge[]>();
  components.forEach((comp, i) => {
    const compSet = new Set(comp);
    edgesByComponent.set(i, validEdges.filter((e) => compSet.has(e.from) && compSet.has(e.to)));
  });
  return arrangeComponents(components, edgesByComponent);
}

function computeFocusLayout(centerId: string, neighborIds: string[]): Map<string, LayoutPoint> {
  const positions = new Map<string, LayoutPoint>();
  positions.set(centerId, { x: 0, y: 0 });
  const n = neighborIds.length;
  if (n === 0) return positions;
  const radius = Math.max(LAYOUT_MIN_GAP, LAYOUT_LINK_DISTANCE);
  const angleOffset = layoutHash(centerId) * 2 * Math.PI;
  neighborIds.forEach((id, i) => {
    const angle = angleOffset + (i / n) * 2 * Math.PI;
    positions.set(id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  });
  return positions;
}

// ─────────────────────────────────────────────────────────────────────────
// graphology / sigma glue
// ─────────────────────────────────────────────────────────────────────────

// Bordered node program used for: selection ring, Network Risk mode's risk
// ring, and the investigation-scoped entity ring. Priority between the
// three (when more than one could apply to the same node) is resolved in
// the nodeReducer below, not here — this program just draws whatever
// borderColor/borderSize it's given.
const BorderedNodeProgram = createNodeBorderProgram({
  borders: [
    { size: { attribute: "borderSize", defaultValue: 0.08 }, color: { attribute: "borderColor" } },
    { size: { fill: true }, color: { attribute: "color" } },
  ],
});

function normalizeNode(n: any) {
  return { ...n, type: (n.type ?? "").toLowerCase() };
}

function normalizeEdge(e: any) {
  return { ...e, from: e.from ?? e.fromId, to: e.to ?? e.toId, label: e.label ?? e.type ?? "" };
}

function edgeKey(edge: any, index: number) {
  return edge.id ?? `${edge.from}-${edge.to}-${index}`;
}

function fadeColor(hex: string, opacity = 0.25): string {
  // typeColors are plain 6-digit hex — append an alpha channel rather than
  // requiring a color library dependency just for this.
  const clean = hex.replace("#", "");
  const alpha = Math.round(opacity * 255).toString(16).padStart(2, "0");
  return `#${clean}${alpha}`;
}

interface GraphScreenProps {
  navigate: (s: string, d?: any) => void;
  investigationId?: string | null;
  focusEntityDisplayId?: string | null;
}

export function GraphScreen({ navigate, investigationId, focusEntityDisplayId }: GraphScreenProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [riskOverlay, setRiskOverlay] = useState(true);
  const [focusMode, setFocusMode] = useState(true);
  const [mode, setMode] = useState<"entity" | "network">("entity");
  const [liveNodes, setLiveNodes] = useState<any[]>([]);
  const [liveEdges, setLiveEdges] = useState<any[]>([]);
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set(ALL_TYPES));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<any | null>(null);

  // ─── Fetch (unchanged from the SVG version) ─────────────────────────────
  useEffect(() => {
    setSelected(null);
    setSelectedEdgeKey(null);
    setError(null);
    setMeta(null);
    setLoading(true);

    if (investigationId) {
      apiGet<any>(`/api/investigations/${investigationId}/graph`)
        .then((data) => {
          setMeta(data);
          setLiveNodes((data.nodes ?? []).map(normalizeNode));
          setLiveEdges((data.edges ?? []).map(normalizeEdge));
        })
        .catch((err) => {
          setError(err.message ?? "Unable to load investigation graph.");
          setLiveNodes([]);
          setLiveEdges([]);
        })
        .finally(() => setLoading(false));
      return;
    }

    apiGet<any>("/api/graph")
      .then(({ nodes, edges }) => {
        const filteredNodes = (nodes ?? [])
          .filter((n: any) => (n.type ?? "").toLowerCase() !== "listing" && (n.type ?? "").toLowerCase() !== "txn")
          .map(normalizeNode);

        const allowedNodeIds = new Set(filteredNodes.map((n: any) => n.id));

        const filteredEdges = (edges ?? [])
          .filter((e: any) => allowedNodeIds.has(e.from ?? e.fromId) && allowedNodeIds.has(e.to ?? e.toId))
          .map(normalizeEdge);

        setLiveNodes(filteredNodes);
        setLiveEdges(filteredEdges);
      })
      .catch((err) => {
        setError(err.message ?? "Unable to load graph.");
        setLiveNodes([]);
        setLiveEdges([]);
      })
      .finally(() => setLoading(false));
  }, [investigationId]);

  useEffect(() => {
    if (!focusEntityDisplayId || liveNodes.length === 0) return;
    const match = liveNodes.find((n: any) => n.displayId === focusEntityDisplayId);
    if (match) setSelected(match.id);
  }, [liveNodes, focusEntityDisplayId]);

  // ─── Type filter, applied before layout (unchanged) ─────────────────────
  const typeFilteredNodes = useMemo(
    () => liveNodes.filter((n) => visibleTypes.has(n.type)),
    [liveNodes, visibleTypes]
  );
  const typeFilteredNodeIds = useMemo(
    () => new Set(typeFilteredNodes.map((n) => n.id)),
    [typeFilteredNodes]
  );
  const typeFilteredEdges = useMemo(
    () =>
      liveEdges.filter(
        (e) => typeFilteredNodeIds.has(e.from ?? e.fromId) && typeFilteredNodeIds.has(e.to ?? e.toId)
      ),
    [liveEdges, typeFilteredNodeIds]
  );

  // ─── Deterministic layout (unchanged) ────────────────────────────────────
  const { positions: layoutPositions, bounds: layoutBounds } = useMemo(
    () =>
      computeGraphLayout(
        typeFilteredNodes,
        typeFilteredEdges.map((e) => ({ from: e.from ?? e.fromId, to: e.to ?? e.toId }))
      ),
    [typeFilteredNodes, typeFilteredEdges]
  );

  const positionedNodes = useMemo(
    () =>
      typeFilteredNodes.map((n) => {
        const p = layoutPositions.get(n.id);
        return p ? { ...n, x: p.x, y: p.y } : n;
      }),
    [typeFilteredNodes, layoutPositions]
  );

  const toggleType = (type: string) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  const filteredNodes = positionedNodes;
  const filteredEdges = typeFilteredEdges;

  const selNode = filteredNodes.find((n) => n.id === selected);

  const connectedEdges = filteredEdges.filter((e) => e.from === selected || e.to === selected);
  const connectedIds = new Set(connectedEdges.flatMap((e) => [e.from, e.to]));

  const selEdge = selectedEdgeKey
    ? filteredEdges.find((e, i) => edgeKey(e, i) === selectedEdgeKey)
    : null;

  const isFocused = focusMode && !!selected;

  const renderedNodes = isFocused
    ? filteredNodes.filter((n) => n.id === selected || connectedIds.has(n.id))
    : filteredNodes;
  const renderedEdges = isFocused ? connectedEdges : filteredEdges;

  const focusNeighborIds = isFocused
    ? Array.from(connectedIds).filter((id) => id !== selected).sort()
    : [];
  const focusPositions =
    isFocused && selected ? computeFocusLayout(selected, focusNeighborIds) : null;

  const displayNodes = renderedNodes.map((n) => {
    const p = focusPositions?.get(n.id);
    return p ? { ...n, x: p.x, y: p.y } : n;
  });

  const getPos = (id: string) =>
    focusPositions?.get(id) ?? positionedNodes.find((n) => n.id === id) ?? { x: 0, y: 0 };

  const investigationScoped = !!investigationId;

  // ─── Sigma: instance lifecycle ───────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph>(new Graph({ multi: true }));
  const rendererRef = useRef<Sigma | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const renderer = new Sigma(graphRef.current, containerRef.current, {
      renderEdgeLabels: true,
      defaultEdgeType: "line",
      labelFont: "Inter, sans-serif",
      labelColor: { color: "rgba(255,255,255,0.82)" },
      labelSize: 10.5,
      edgeLabelFont: "Inter, sans-serif",
      edgeLabelSize: 7.5,
      edgeLabelColor: { color: "rgba(255,255,255,0.75)" },
      minCameraRatio: 0.12,
      maxCameraRatio: 3.5,
      nodeProgramClasses: { border: BorderedNodeProgram },
      allowInvalidContainer: true,
      // Same problem as the edge hover box, but on the node side: sigma
      // has its own separate built-in hover decoration for nodes
      // (drawNodeHover — a background box meant to frame the hover label)
      // that fires independently of, and paints over, the label our own
      // nodeReducer already draws via forceLabel on hover. That's the
      // white box sitting next to the selected/hovered node. Same fix as
      // the edge one: we already handle "this node is hovered" ourselves
      // (forceLabel + the icon/name/risk label text in the nodeReducer
      // above), so disable sigma's separate hover drawing here too.
      defaultDrawEdgeHover: () => {},
      defaultDrawNodeHover: () => {},
      // Base labels are governed by sigma's built-in label-density/grid
      // system below: as you zoom in, less-crowded nodes get more room and
      // more labels appear automatically (standard behavior in graph tools
      // like Gephi). The nodeReducer below additionally force-shows a label
      // for whatever's selected, hovered, or (in Focus Mode) a neighbor of
      // the selection — those never get culled regardless of zoom. Density
      // is tuned to actually use that room now that forceLabel is scoped
      // to just the selected/hovered node (see nodeReducer) instead of
      // forcing on an entire focus cluster — a smaller grid cell and
      // higher density means most nodes in a view like a focused wallet
      // cluster get labeled instead of only about half.
      labelDensity: 1,
      labelGridCellSize: 90,
      labelRenderedSizeThreshold: 5,
    });
    rendererRef.current = renderer;

    renderer.on("clickNode", ({ node }) => {
      setSelected((prev) => (prev === node ? null : node));
      setSelectedEdgeKey(null);
    });
    renderer.on("clickEdge", ({ edge }) => {
      setSelectedEdgeKey((prev) => (prev === edge ? null : edge));
      setSelected(null);
    });
    renderer.on("clickStage", () => {
      setSelected(null);
      setSelectedEdgeKey(null);
    });
    // Hover reveals a node's label on demand instead of it being permanently
    // on — this is the main fix for the "every node's icon+name+risk drawn
    // at once" clutter. See the nodeReducer's `showLabel` condition below.
    renderer.on("enterNode", ({ node }) => setHoveredNode(node));
    renderer.on("leaveNode", () => setHoveredNode(null));

    return () => {
      renderer.kill();
      rendererRef.current = null;
    };
    // Renderer is created once per mount; graph mutations below happen via
    // graphRef + renderer.refresh(), not by recreating the instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Sigma: sync graphology graph from displayNodes/renderedEdges ───────
  // Replaces the SVG version's per-frame JSX mapping over displayNodes/
  // renderedEdges. Rebuilds node/edge sets to match exactly what should be
  // visible (same isFocused filtering the SVG version did via
  // renderedNodes/renderedEdges), then lets the reducers below (which run
  // on every sigma paint) handle selection/dim/ring styling without
  // needing to rebuild the graph for those.
  useEffect(() => {
    const graph = graphRef.current;
    graph.clear();

    displayNodes.forEach((n) => {
      const modeRisk = mode === "network" ? n.networkRisk : n.risk;
      const safeRisk = Number.isFinite(modeRisk) ? Math.min(100, Math.max(0, modeRisk)) : null;
      const r = riskOverlay && safeRisk !== null ? 12 + (safeRisk / 100) * 6 : 14;

      graph.addNode(n.id, {
        x: n.x,
        y: n.y,
        size: r,
        color: typeColors[n.type],
        label: n.label,
        type: undefined, // set per-frame by the reducer when a border ring applies
        nodeType: n.type,
        icon: typeIcons[n.type],
        safeRisk,
        isInvestigationEntity: !!n.isInvestigationEntity,
      });
    });

    renderedEdges.forEach((e, i) => {
      const key = edgeKey(e, filteredEdges.indexOf(e) >= 0 ? filteredEdges.indexOf(e) : i);
      const from = getPos(e.from) ? e.from : null;
      if (!from || !graph.hasNode(e.from) || !graph.hasNode(e.to)) return;
      if (graph.hasEdge(key)) return;
      graph.addEdgeWithKey(key, e.from, e.to, {
        label: e.label,
        size: 1,
        color: "rgba(255,255,255,0.20)",
      });
    });

    rendererRef.current?.refresh();
  }, [displayNodes, renderedEdges, mode, riskOverlay, filteredEdges]);

  // ─── Sigma: reducers — selection dimming, focus hiding, rings, labels ───
  // This is the direct replacement for the isDimmed/isHighlighted/isFocused
  // conditionals that lived inline in the original JSX.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    renderer.setSetting("nodeReducer", (id: string, attrs: any): Partial<NodeDisplayData> => {
      const res: any = { ...attrs };
      const isSel = id === selected;
      const isDimmed = !isFocused && !!selected && !connectedIds.has(id) && id !== selected;
      const isInvestigationRing = investigationScoped && attrs.isInvestigationEntity && !isSel;
      const isNetworkRing = mode === "network" && attrs.safeRisk !== null;

      if (isDimmed) res.color = fadeColor(attrs.color, 0.35);

      // Priority when more than one ring condition applies to the same
      // node: selection > network-risk ring > investigation ring — same
      // precedence the original SVG version rendered in (selection ring
      // was drawn last / on top).
      if (isSel) {
        res.type = "border";
        res.borderColor = "rgba(255,255,255,0.6)";
        res.borderSize = 0.16;
      } else if (isNetworkRing) {
        res.type = "border";
        res.borderColor = riskColorLight(attrs.safeRisk);
        res.borderSize = 0.1;
      } else if (isInvestigationRing) {
        res.type = "border";
        res.borderColor = attrs.color;
        res.borderSize = 0.06;
      }

      // Label strategy: don't force every label on (that's the original
      // clutter) and don't force them all off either (then you can't tell
      // nodes apart, fair complaint). Instead give every node a plain
      // short label — just the name, no icon, no risk — and let sigma's
      // built-in label-density/grid-collision system (labelDensity /
      // labelGridCellSize set on the Sigma instance above) decide which
      // ones actually fit without overlapping at the current zoom level.
      // That's what those settings are for: as you zoom out it thins
      // labels automatically by node size, as you zoom in more of them
      // fit and reappear. The selected node and whatever's hovered get the
      // full detail label AND bypass collision (forceLabel) — those are
      // the ones you actually asked about, and there's only ever one or
      // two of them so there's nothing for them to collide with. Focus
      // Mode neighbors get the same full detail label content, but do NOT
      // force past collision detection — with several neighbors packed
      // close together (e.g. a WALLET cluster), forcing all of them on
      // draws their labels directly on top of each other. Letting them go
      // through the normal density system means the ones that fit still
      // show — Focus Mode's tight zoom means that's usually most of
      // them — just without literally overlapping.
      const isForcedDetail = isSel || id === hoveredNode;
      const isHighlighted = isForcedDetail || (isFocused && connectedIds.has(id));
      res.label = isHighlighted
        ? `${attrs.icon}  ${attrs.label}${riskOverlay ? `  ·  ${attrs.safeRisk !== null ? attrs.safeRisk : "—"}` : ""}`
        : attrs.label;
      res.forceLabel = isForcedDetail;

      return res;
    });

    renderer.setSetting("edgeReducer", (id: string, attrs: any): Partial<EdgeDisplayData> => {
      const edge = graphRef.current.hasEdge(id) ? graphRef.current.getEdgeAttributes(id) : null;
      const [s, t] = graphRef.current.extremities(id);
      const isHighlighted = (!!selected && (s === selected || t === selected)) || id === selectedEdgeKey;
      const showLabel = isFocused || id === selectedEdgeKey;
      return {
        ...attrs,
        color: isHighlighted ? "rgba(99,102,241,0.65)" : "rgba(255,255,255,0.20)",
        size: isHighlighted ? 1.5 : 1,
        label: showLabel ? (edge?.label ?? "") : "",
      };
    });

    renderer.refresh();
  }, [selected, selectedEdgeKey, hoveredNode, isFocused, connectedIds, mode, riskOverlay, investigationScoped]);

  // ─── Sigma: camera fit ───────────────────────────────────────────────────
  // Replaces fitViewBox + the useEffect that called setViewBox(fitViewBox(...))
  // on new graph data, and the separate focus-mode refit effect.
  const focusedRef = useRef(false);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || liveNodes.length === 0) return;

    if (isFocused && focusPositions) {
      fitViewportToNodes(renderer, Array.from(focusPositions.keys()), {
        animate: false,
        padding: FOCUS_PADDING,
      });
      focusedRef.current = true;
    } else if (!isFocused && (focusedRef.current || renderer.getGraph().order > 0)) {
      fitViewportToNodes(
        renderer,
        renderedNodes.map((n) => n.id),
        { animate: focusedRef.current, padding: LAYOUT_PADDING }
      );
      focusedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused, selected, layoutBounds]);

  const zoomBy = useCallback((factor: number) => {
    const camera = rendererRef.current?.getCamera();
    if (!camera) return;
    camera.animate({ ratio: camera.ratio * factor }, { duration: 150 });
  }, []);

  const resetView = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    fitViewportToNodes(renderer, renderedNodes.map((n) => n.id), { animate: true, padding: LAYOUT_PADDING });
  }, [renderedNodes]);

  // NOTE: the original SVG version early-returned here for loading/error/
  // empty states, replacing the whole component tree with a plain message.
  // That's not safe with Sigma: the graph container below needs to stay
  // mounted continuously so the one-time `new Sigma(...)` effect above ever
  // gets a real DOM node to attach to. If this component early-returns on
  // the first render (loading === true, as it always is on mount), the
  // effect fires against `containerRef.current === null`, no-ops silently
  // (no thrown error — nothing to see in the console), and never runs
  // again once `loading` flips to false and the "real" JSX finally mounts.
  // That produces exactly the symptom of an empty canvas with a working
  // toolbar and no console errors. So instead: keep the container mounted
  // unconditionally, and render loading/error/empty as overlays on top of
  // it, the same pattern already used below for the investigation-scoped
  // states.
  return (
    <div style={{ display: "flex", height: "calc(100vh - 52px)", overflow: "hidden" }}>
      <div
        className="graph-root"
        style={{ position: "relative", flex: 1, background: "radial-gradient(ellipse at 40% 45%, rgba(99,102,241,0.04) 0%, transparent 65%)" }}
      >
        {investigationScoped && (
          <div style={{ position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 10 }}>
            <div className="glass" style={{ borderRadius: 9, padding: "6px 14px", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent-hi)" }}>
                Investigation Graph — {investigationId}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate("graph")}>View Full Graph</button>
            </div>
          </div>
        )}

        <div style={{ position: "absolute", top: 14, left: 14, zIndex: 10, display: "flex", gap: 8 }}>
          <div className="glass" style={{ borderRadius: 9, padding: "5px 8px", display: "flex", gap: 4 }}>
            <button title="Zoom in" onClick={() => zoomBy(1 / 1.25)} style={toolbarIconStyle}>⊕</button>
            <button title="Zoom out" onClick={() => zoomBy(1.25)} style={toolbarIconStyle}>⊖</button>
            <button title="Reset view" onClick={resetView} style={toolbarIconStyle}>⊡</button>
          </div>
          <div className="glass" style={{ borderRadius: 9, padding: "5px 12px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>Risk Overlay</span>
            <div className={`toggle-track ${riskOverlay ? "on" : "off"}`} onClick={() => setRiskOverlay(!riskOverlay)} style={{ cursor: "pointer" }}>
              <div className="toggle-thumb" />
            </div>
          </div>
          <div className="glass" style={{ borderRadius: 9, padding: "5px 12px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "var(--text-3)" }} title="When on, selecting a node shows only that node and its direct connections instead of the entire graph">Focus Mode</span>
            <div className={`toggle-track ${focusMode ? "on" : "off"}`} onClick={() => setFocusMode(!focusMode)} style={{ cursor: "pointer" }}>
              <div className="toggle-thumb" />
            </div>
          </div>
          <div className="glass" style={{ borderRadius: 9, padding: "4px", display: "flex" }}>
            {(["entity", "network"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  background: mode === m ? "rgba(99,102,241,0.2)" : "none",
                  border: "none",
                  color: mode === m ? "var(--accent-hi)" : "var(--text-3)",
                  cursor: "pointer", padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 500,
                  fontFamily: "Inter,sans-serif", transition: "all 0.13s",
                }}
              >
                {m === "entity" ? "Entity Risk" : "Network Risk"}
              </button>
            ))}
          </div>
        </div>

        <div style={{ position: "absolute", top: 62, left: 14, zIndex: 10 }}>
          <div className="glass" style={{ borderRadius: 9, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ fontSize: 9, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>Filter by type</div>
            {ALL_TYPES.map((type) => (
              <label key={type} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "var(--text-3)", cursor: "pointer" }}>
                <input type="checkbox" checked={visibleTypes.has(type)} onChange={() => toggleType(type)} style={{ accentColor: typeColors[type], cursor: "pointer" }} />
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: typeColors[type], flexShrink: 0 }} />
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </label>
            ))}
          </div>
        </div>

        <div style={{ position: "absolute", bottom: 14, left: 14, zIndex: 10 }}>
          <div className="glass" style={{ borderRadius: 9, padding: "10px 14px" }}>
            <div style={{ fontSize: 9.5, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Node Types</div>
            {Object.entries(typeColors).map(([type, color]) => (
              <div key={type} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>
                <div style={{ width: 9, height: 9, borderRadius: "50%", background: color, boxShadow: `0 0 5px ${color}70`, flexShrink: 0 }} />
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </div>
            ))}
          </div>
        </div>

        {investigationScoped && loading && (
          <CenteredMessage title="Loading investigation graph…" />
        )}
        {investigationScoped && !loading && error && (
          <CenteredMessage title="Unable to load investigation graph." detail={error} />
        )}
        {investigationScoped && !loading && !error && meta && meta.calculable === false && (
          <CenteredMessage title="No investigation-specific graph available yet." detail={meta.explanation} />
        )}

        {/* Global graph equivalents of the three states the original file
            handled with a full early-return. Only shown for the non-scoped
            graph — investigationScoped has its own copy above. */}
        {!investigationScoped && loading && (
          <CenteredMessage title="Loading network graph…" />
        )}
        {!investigationScoped && !loading && error && (
          <CenteredMessage title="Couldn't reach the API." detail={error} />
        )}
        {!investigationScoped && !loading && !error && liveNodes.length === 0 && (
          <CenteredMessage title="No graph data available yet." />
        )}

        {/* Sigma mounts into this div — replaces the <svg ref={svgRef}> block */}
        <div
          ref={containerRef}
          className="graph-svg"
          style={{ position: "absolute", inset: 0, cursor: "grab" }}
        />
      </div>

      {/* Right panel — node details (unchanged) */}
      {selNode && (
        <div className="anim-slide-r" style={{ width: 288, background: "var(--panel)", borderLeft: "1px solid var(--border)", padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: 9.5, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 6 }}>{selNode.type.toUpperCase()} NODE</div>
            <div className="display" style={{ fontSize: 17, fontWeight: 700, color: "var(--text-1)", marginBottom: 8 }}>{selNode.label}</div>
            <RiskBadge score={selNode.risk} />
            {mode === "network" && Number.isFinite(selNode.networkRisk) && (
              <div style={{ fontSize: 10.5, color: "var(--text-4)", marginTop: 6 }}>
                Network risk: <span style={{ color: "var(--text-1)", fontWeight: 600 }}>{selNode.networkRisk}</span>
              </div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "center" }}>
            <RingScore score={selNode.risk} size={110} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {(() => {
              const others = connectedEdges
                .map((e) => liveNodes.find((n) => n.id === (e.from === selNode.id ? e.to : e.from)))
                .filter(Boolean) as any[];
              const txnCount = others.filter((n) => n.type === "txn").length;
              const associatedCount = connectedEdges.filter((e) => (e.label ?? "").toLowerCase().includes("associated")).length;
              const riskiest = others.length
                ? others.reduce((a, b) => ((b.risk ?? 0) > (a.risk ?? 0) ? b : a))
                : null;

              const stats = [
                { label: "Connections", val: String(connectedEdges.length) },
                { label: "Transactions", val: String(txnCount) },
                { label: "Associated", val: String(associatedCount) },
                {
                  label: "Riskiest Link",
                  val: riskiest ? String(riskiest.risk) : "—",
                  color: riskiest ? riskColorLight(riskiest.risk) : undefined,
                  title: riskiest ? riskiest.label : undefined,
                },
              ];

              return stats.map((item) => (
                <div key={item.label} title={item.title} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
                  <div className="display" style={{ fontSize: 19, fontWeight: 700, color: item.color ?? "var(--text-1)" }}>{item.val}</div>
                  <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 2 }}>{item.label}</div>
                </div>
              ));
            })()}
          </div>

          <div>
            <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Connected To</div>
            {connectedEdges.map((e, i) => {
              const otherId = e.from === selNode.id ? e.to : e.from;
              const other = liveNodes.find((n) => n.id === otherId);
              if (!other) return null;
              const color = typeColors[other.type];
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 0", borderBottom: "1px solid var(--border)", cursor: "pointer" }} onClick={() => setSelected(otherId)}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0, boxShadow: `0 0 5px ${color}70` }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "var(--text-1)", fontWeight: 500 }}>{other.label}</div>
                    <div style={{ fontSize: 10, color: "var(--text-4)" }}>{e.label}</div>
                  </div>
                  <RiskBadge score={other.risk} />
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <button
              className="btn btn-primary"
              style={{
                justifyContent: "center",
                opacity: selNode.type === "entity" ? 1 : 0.5,
                cursor: selNode.type === "entity" ? "pointer" : "not-allowed",
              }}
              disabled={selNode.type !== "entity"}
              title={selNode.type === "entity" ? undefined : "Full profile is only available for entity nodes"}
              onClick={() => { if (selNode.type === "entity") navigate("entity", selNode); }}
            >
              View Full Profile
            </button>
            <button className="btn btn-ghost" style={{ justifyContent: "center" }} onClick={() => navigate("network-risk")}>
              Network Risk Analysis
            </button>
            <button className="btn btn-ghost" style={{ justifyContent: "center" }} onClick={() => navigate("workspace")}>
              Add to Investigation
            </button>
          </div>
        </div>
      )}

      {/* Right panel — edge details (unchanged) */}
      {!selNode && selEdge && (
        <div className="anim-slide-r" style={{ width: 288, background: "var(--panel)", borderLeft: "1px solid var(--border)", padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: 9.5, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 6 }}>RELATIONSHIP</div>
            <div className="display" style={{ fontSize: 17, fontWeight: 700, color: "var(--text-1)", marginBottom: 8 }}>{selEdge.label || "Unlabeled relationship"}</div>
          </div>

          {(() => {
            const fromNode = liveNodes.find((n) => n.id === selEdge.from);
            const toNode = liveNodes.find((n) => n.id === selEdge.to);
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <RelRow label="From" node={fromNode} onClick={() => { setSelected(fromNode?.id ?? null); setSelectedEdgeKey(null); }} />
                <RelRow label="To" node={toNode} onClick={() => { setSelected(toNode?.id ?? null); setSelectedEdgeKey(null); }} />
              </div>
            );
          })()}

          <div style={{ fontSize: 10.5, color: "var(--text-4)", lineHeight: 1.5 }}>
            No separate evidence/source record is persisted for this relationship. The relationship is derived from the graph data.
          </div>
        </div>
      )}
    </div>
  );
}

function RelRow({ label, node, onClick }: { label: string; node: any; onClick: () => void }) {
  if (!node) return null;
  const color = typeColors[node.type];
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 9px", background: "rgba(255,255,255,0.03)", borderRadius: 7, cursor: "pointer" }}>
      <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0, boxShadow: `0 0 5px ${color}70` }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 9.5, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--text-1)", fontWeight: 500 }}>{node.label}</div>
      </div>
      <RiskBadge score={node.risk} />
    </div>
  );
}

function CenteredMessage({ title, detail }: { title: string; detail?: string }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 5 }}>
      <div className="glass" style={{ borderRadius: 12, padding: "20px 26px", maxWidth: 360, textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", marginBottom: detail ? 6 : 0 }}>{title}</div>
        {detail && <div style={{ fontSize: 11.5, color: "var(--text-4)", lineHeight: 1.5 }}>{detail}</div>}
      </div>
    </div>
  );
}
