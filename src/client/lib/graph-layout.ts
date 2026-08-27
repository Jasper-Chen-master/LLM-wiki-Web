import type { WikiNode, ProjectSnapshot } from "../../shared/contracts";

/** Palette used by the graph legend and node circles, indexed by node type order. */
export const TYPE_COLORS = [
  "#6c5ce7",
  "#e17055",
  "#00b894",
  "#f39c12",
  "#0984e3",
  "#e84393",
  "#00cec9",
  "#a29bfe",
  "#d63031",
  "#636e72",
];

export type GraphLayout = {
  positions: Map<string, { x: number; y: number }>;
  center: { x: number; y: number };
  maxOuterRadius: number;
  width: number;
  height: number;
};

export function layoutNodes(nodes: WikiNode[], _edges: ProjectSnapshot["edges"]): GraphLayout {
  const count = nodes.length;
  const positions = new Map<string, { x: number; y: number }>();
  if (!count) {
    return { positions, center: { x: 400, y: 300 }, maxOuterRadius: 0, width: 800, height: 600 };
  }

  // The layout grows with the data set. Labels are capped at the same 24
  // characters used by the renderer, so the arc budget remains predictable.
  const labelWidth = 24 * 7;
  const typeCount = new Set(nodes.map((node) => node.type.trim())).size;
  const maxPerLayer = Math.max(
    10,
    Math.min(
      14,
      Math.floor((2 * Math.PI * (220 + Math.sqrt(count) * 18 + typeCount * 18)) / (labelWidth + 28)),
    ),
  );
  const radialLayerSpacing = Math.max(16, Math.min(22, 14 + Math.sqrt(count)));
  const innerRadius = Math.max(64, Math.min(120, 54 + typeCount * 4 + Math.sqrt(count) * 2));
  const gap = Math.max(12, Math.min(24, 10 + Math.sqrt(count) * 0.6));

  if (count === 1) {
    const center = { x: 120, y: 100 };
    positions.set(nodes[0].id, center);
    return { positions, center, maxOuterRadius: 0, width: 240, height: 200 };
  }

  // One concentric band per type; first appearance still determines inner-to-outer order.
  const groups = new Map<string, WikiNode[]>();
  for (const node of nodes) {
    const type = node.type.trim();
    const list = groups.get(type) ?? [];
    list.push(node);
    groups.set(type, list);
  }
  const typeOrder = [...groups.keys()];
  const layerCounts = typeOrder.map((type) => Math.max(1, Math.ceil(groups.get(type)!.length / maxPerLayer)));
  const bandWidth = Math.max(28, Math.max(...layerCounts) * radialLayerSpacing);
  const maxOuterRadius = innerRadius + typeOrder.length * bandWidth + (typeOrder.length - 1) * gap;
  const padding = labelWidth + 36;
  const center = { x: maxOuterRadius + padding, y: maxOuterRadius + padding };
  typeOrder.forEach((type, g) => {
    const group = groups.get(type)!;
    const bandStart = innerRadius + g * (bandWidth + gap);
    const layers = layerCounts[g];
    group.forEach((node, j) => {
      const layer = Math.floor(j / maxPerLayer);
      const layerNodes = group.slice(layer * maxPerLayer, Math.min(group.length, (layer + 1) * maxPerLayer));
      const indexInLayer = j - layer * maxPerLayer;
      const radius = bandStart + (bandWidth * (layer + 0.5)) / layers;
      const angle = (Math.PI * 2 * indexInLayer) / layerNodes.length +
        (layer % 2 ? Math.PI / layerNodes.length : 0);
      positions.set(node.id, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      });
    });
  });
  return {
    positions,
    center,
    maxOuterRadius,
    width: center.x * 2,
    height: center.y * 2,
  };
}
