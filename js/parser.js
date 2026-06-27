// parser.js — 復号済みセーブ JSON → グラフ構造 {areas, edges, children}
//
// 実フィールド名は実データ（復号済みセーブ）から確定済み:
//   ルート.areas … エリア辞書（キー = id 文字列）。各エリア:
//     - id          : 文字列の数値（キーと一致）
//     - name        : 表示名
//     - size        : "town" | "village" | "city" | "dungeon"
//     - connections : 接続先エリア id 文字列の配列（実データは完全対称＝双方向）
//     - nodes       : ノード辞書。各ノード .facilities … 施設辞書
//         施設: { name, id, facility_type, ... }
//             facility_type === "dungeon_location" → ダンジョン(◇)、それ以外 → 施設(□)
//
// 互換: 既に {areas:[{id,label}],edges,children} へ整形済みの JSON もそのまま受け付ける。

const FIXED_START_ID = 0; // 開始ノード = 固定 id:0（無ければ最小 id）
const DUNGEON_FACILITY_TYPE = 'dungeon_location';

// 値が「辞書（キー=id）」でも「配列」でも、要素オブジェクトの配列にして返す。
function values(container) {
  if (Array.isArray(container)) return container;
  if (container && typeof container === 'object') return Object.values(container);
  return [];
}

// ノード内の施設を、entrance_facility を根として connections を辿った
// 階層（pre-order DFS）に並べ、各施設へ depth を付けて返す。
// 施設は辞書（キー=id）想定。connections は同一ノード内の施設 id 配列（双方向）。
function facilityHierarchy(node) {
  const facs = node && node.facilities;
  if (!facs || typeof facs !== 'object' || Array.isArray(facs)) {
    // 想定外（配列など）はフラット扱い（depth=0）。
    return values(facs).map(f => ({ f, depth: 0 }));
  }
  const out = [];
  const visited = new Set();
  const visit = (fid, depth) => {
    const f = facs[fid];
    if (!f || visited.has(fid)) return;
    visited.add(fid);
    out.push({ f, depth });
    (f.connections || []).forEach(c => visit(String(c), depth + 1));
  };
  const ids = Object.keys(facs);
  const root = node.entrance_facility != null ? String(node.entrance_facility) : ids[0];
  visit(root, 0);
  ids.forEach(id => { if (!visited.has(id)) visit(id, 0); }); // 孤立施設は根として追加
  return out;
}

// 既に整形済み（areas が配列で label を持つ）かどうか。
function isPreparsed(obj) {
  return Array.isArray(obj?.areas) && Array.isArray(obj?.edges) &&
    (obj.areas.length === 0 || obj.areas[0]?.label !== undefined);
}

// 復号済みセーブ（または整形済み）JSON → {areas, edges, children}。
export function parseWorld(json) {
  const obj = typeof json === 'string' ? JSON.parse(json) : json;
  if (isPreparsed(obj)) {
    return {
      areas: obj.areas.map(a => ({ id: Number(a.id), label: String(a.label ?? '#' + a.id), start: !!a.start })),
      edges: obj.edges.map(e => ({ a: Number(e.a), b: Number(e.b), ...(e.directed !== undefined ? { directed: !!e.directed } : {}) })),
      children: (obj.children || []).map(c => ({ name: String(c.name ?? '?'), parent: Number(c.parent), kind: c.kind === 'd' ? 'd' : 'f', depth: Number(c.depth) || 0 })),
    };
  }

  const rawAreas = values(obj.areas);
  const areas = [];
  const children = [];
  const seen = new Set();       // エッジ重複除去（"min-max"）
  const edges = [];

  // size==="dungeon" のエリアは非表示。エッジ・子ノードからも除外するため id 集合を先に作る。
  const hidden = new Set(
    rawAreas.filter(a => a.size === 'dungeon')
      .map(a => Number(a.id)).filter(Number.isFinite)
  );

  rawAreas.forEach(a => {
    const id = Number(a.id);
    if (!Number.isFinite(id) || hidden.has(id)) return;
    areas.push({ id, label: String(a.name ?? '#' + id), size: a.size });

    // 接続（双方向・重複除去・非表示エリアは除外）。
    (a.connections || []).forEach(c => {
      const b = Number(c);
      if (!Number.isFinite(b) || hidden.has(b)) return;
      const key = id < b ? id + '-' + b : b + '-' + id;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ a: id, b });
    });

    // 施設 / ダンジョン（nodes[*] の facilities を階層化）。
    values(a.nodes).forEach(node => {
      facilityHierarchy(node).forEach(({ f, depth }) => {
        children.push({
          name: String(f.name ?? '?'),
          parent: id,
          kind: f.facility_type === DUNGEON_FACILITY_TYPE ? 'd' : 'f',
          ftype: f.facility_type,
          depth,
        });
      });
    });
  });

  return { areas, edges, children };
}

// 中立データ → 表示用グラフ（hop/arm/col 付与, byId, adj, START, maxHop）。
export function buildGraph(data) {
  const areas = data.areas.map(a => ({ ...a }));
  const edges = data.edges.map(e => ({ ...e }));
  const children = (data.children || []).map(c => ({ ...c }));
  const byId = Object.fromEntries(areas.map(n => [n.id, n]));

  const START = byId[FIXED_START_ID] ? FIXED_START_ID : Math.min(...areas.map(a => a.id));
  areas.forEach(a => { a.start = (a.id === START); });

  const adj = {};
  areas.forEach(n => (adj[n.id] = []));
  edges.forEach(e => { adj[e.a]?.push(e.b); adj[e.b]?.push(e.a); });

  // BFS: 開始からのホップ数と、開始直結ノードごとの「腕角度」。
  const dist = {}, arm = {};
  dist[START] = 0;
  const roots = adj[START] || [];
  const q = [START];
  while (q.length) {
    const u = q.shift();
    (adj[u] || []).forEach(v => {
      if (dist[v] === undefined) {
        dist[v] = dist[u] + 1;
        arm[v] = (u === START)
          ? (-Math.PI / 2 + roots.indexOf(v) * (2 * Math.PI / Math.max(1, roots.length)))
          : arm[u];
        q.push(v);
      }
    });
  }

  let maxHop = 0;
  Object.values(dist).forEach(h => { if (h > maxHop) maxHop = h; });
  areas.forEach(n => {
    n.hop = dist[n.id];                 // undefined = 到達不能（灰）
    n.arm = arm[n.id] ?? Math.random() * 6.28;
    n.col = hopColor(n.hop, maxHop);
  });

  let cseq = 0;
  children.forEach(c => (c.cid = 'c' + (cseq++)));

  return { areas, edges, children, byId, adj, START, maxHop };
}

// ホップ数 → 色。開始は専用色、到達不能は灰、それ以外は色相ランプ。
export function hopColor(h, maxHop) {
  if (h === undefined) return '#6b7280';        // 到達不能
  if (h === 0) return 'var(--start)';           // 開始（専用色）
  const t = maxHop ? h / maxHop : 0;
  return `hsl(${(158 + t * 180).toFixed(0)},52%,52%)`;
}
