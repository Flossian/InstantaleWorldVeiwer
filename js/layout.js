// layout.js — 自前の力指向レイアウト（外部グラフライブラリ非依存）
// 開始ノードを中心に「ホップ数 × 腕角度」で放射状に初期配置 → 反発/バネ/中心引力で自動収束。

const P = {
  kRep: 10000,      // ノード間反発
  kSpring: 0.033,   // エッジのバネ係数
  rest: 150,        // エッジ自然長
  damp: 0.86,       // 速度減衰
  kCenter: 0.004,   // 通常ノードの中心引力
  kStart: 0.05,     // 開始ノードの中心引力（強め＝中央固定気味）
  cRest: 52,        // 子ノードの親からの自然距離
  cK: 0.07,         // 子ノードのバネ係数
  sepGap: 28,       // 矩形どうしが保つ最小すき間（重なり防止）
};

// 矩形（AABB）の重なりを解消し、最小すき間 P.sepGap を保つ。
// 毎フレーム位置を直接補正するハード制約。alpha に依らず常に効かせる。
function separate(list) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const minX = (a.hw || 14) + (b.hw || 14) + P.sepGap;
      const minY = (a.hh || 14) + (b.hh || 14) + P.sepGap;
      const dx = b.x - a.x, dy = b.y - a.y;
      const ox = minX - Math.abs(dx);   // x 方向の重なり量
      const oy = minY - Math.abs(dy);   // y 方向の重なり量
      if (ox <= 0 || oy <= 0) continue; // どちらかで離れていれば重なっていない
      // 貫通の浅い軸に沿って押し離す。
      let px = 0, py = 0;
      if (ox < oy) px = (dx < 0 ? -1 : 1) * ox;
      else py = (dy < 0 ? -1 : 1) * oy;
      // ピン留めされた側は動かさず、相手に全量を寄せる。
      if (a.pin && b.pin) continue;
      if (a.pin) { b.x += px; b.y += py; }
      else if (b.pin) { a.x -= px; a.y -= py; }
      else { a.x -= px / 2; a.y -= py / 2; b.x += px / 2; b.y += py / 2; }
    }
  }
}

// エッジをノード矩形の境界でクリップするための交点係数。
export function boundary(dx, dy, hw, hh) {
  const ax = Math.abs(dx) || 1e-6, ay = Math.abs(dy) || 1e-6;
  const t = Math.min(hw / ax, hh / ay);
  return [dx * t, dy * t];
}

// エリア相関図の初期配置（開始ノード中心の放射状）。
export function seed(graph, W, H) {
  const { areas } = graph;
  const cx = W / 2, cy = H / 2, gap = 150;
  areas.forEach(n => {
    if (n.start) { n.x = cx; n.y = cy; }
    else {
      const r = (n.hop || 1) * gap;
      n.x = cx + Math.cos(n.arm) * r + (Math.random() - 0.5) * 26;
      n.y = cy + Math.sin(n.arm) * r + (Math.random() - 0.5) * 26;
    }
    n.vx = 0; n.vy = 0; n.pin = false;
  });
}

// サブノード相関図の初期配置。対象エリアを中心に固定し、子施設を周囲に並べる。
export function seedFocus(graph, area, W, H) {
  const cx = W / 2, cy = H / 2;
  area.x = cx; area.y = cy; area.vx = 0; area.vy = 0; area.pin = true;
  const kids = graph.children.filter(c => c.parent === area.id);
  kids.forEach((c, i) => {
    const ang = (i / Math.max(1, kids.length)) * 6.28 + 0.4;
    const r = 110 + (c.depth || 0) * 56;
    c.x = cx + Math.cos(ang) * r + (Math.random() - 0.5) * 22;
    c.y = cy + Math.sin(ang) * r + (Math.random() - 0.5) * 22;
    c.vx = 0; c.vy = 0; c.pin = false;
  });
}

// 1 ステップ進める。focus が null ならエリア相関図、エリアならそのサブノード相関図。
// alpha（温度）を受け取り、減衰後の alpha を返す。
export function step(graph, focus, alpha, W, H) {
  if (focus) return stepFocus(graph, focus, alpha, W, H);

  const { areas, edges, byId } = graph;
  // 反発（全ペア）
  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      const a = areas[i], b = areas[j];
      let dx = a.x - b.x, dy = a.y - b.y;
      let d2 = dx * dx + dy * dy; if (d2 < 1) d2 = 1;
      const f = P.kRep / d2, d = Math.sqrt(d2);
      a.vx += f * dx / d; a.vy += f * dy / d;
      b.vx -= f * dx / d; b.vy -= f * dy / d;
    }
  }
  // エッジのバネ
  edges.forEach(ed => {
    const a = byId[ed.a], b = byId[ed.b]; if (!a || !b) return;
    let dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const f = P.kSpring * (d - P.rest);
    a.vx += f * dx / d; a.vy += f * dy / d;
    b.vx -= f * dx / d; b.vy -= f * dy / d;
  });
  // 中心引力 + 速度反映
  areas.forEach(n => {
    const k = n.start ? P.kStart : P.kCenter;
    n.vx += (W / 2 - n.x) * k; n.vy += (H / 2 - n.y) * k;
    if (n.pin) { n.vx = 0; n.vy = 0; return; }
    n.vx *= P.damp; n.vy *= P.damp;
    n.x += n.vx * alpha * 0.16; n.y += n.vy * alpha * 0.16;
  });
  for (let it = 0; it < 2; it++) separate(areas);

  alpha *= 0.99;
  if (alpha < 0.03) alpha = 0.03;
  return alpha;
}

// サブノード相関図 1 ステップ。area を中心に固定し、その子施設のみを動かす。
function stepFocus(graph, area, alpha, W, H) {
  const { children, childEdges, childById } = graph;
  const kids = children.filter(c => c.parent === area.id);
  const list = [area, ...kids];

  // 反発（全ペア・area 含む）
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      let dx = a.x - b.x, dy = a.y - b.y;
      let d2 = dx * dx + dy * dy; if (d2 < 1) d2 = 1;
      const f = P.kRep * 0.5 / d2, d = Math.sqrt(d2);
      a.vx += f * dx / d; a.vy += f * dy / d;
      b.vx -= f * dx / d; b.vy -= f * dy / d;
    }
  }
  // 施設間エッジのバネ（このエリアの子のみ）
  childEdges.forEach(e => {
    const a = childById[e.a], b = childById[e.b];
    if (!a || !b || a.parent !== area.id || b.parent !== area.id) return;
    let dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const f = P.cK * (d - P.cRest * 1.6);
    a.vx += f * dx / d; a.vy += f * dy / d;
    b.vx -= f * dx / d; b.vy -= f * dy / d;
  });
  // 入口施設（depth 0）→ エリア中心のバネ
  kids.forEach(c => {
    if (c.depth) return;
    let dx = c.x - area.x, dy = c.y - area.y;
    const d = Math.hypot(dx, dy) || 1;
    const f = P.cK * (d - 100);
    c.vx -= f * dx / d; c.vy -= f * dy / d;
  });
  // 子の速度反映（area はドラッグ/アンカーのため積分対象外＝位置は据え置き）
  kids.forEach(n => {
    n.vx += (W / 2 - n.x) * 0.002; n.vy += (H / 2 - n.y) * 0.002;
    if (n.pin) { n.vx = 0; n.vy = 0; return; }
    n.vx *= P.damp; n.vy *= P.damp;
    n.x += n.vx * alpha * 0.16; n.y += n.vy * alpha * 0.16;
  });
  for (let it = 0; it < 2; it++) separate(list);

  alpha *= 0.99;
  if (alpha < 0.03) alpha = 0.03;
  return alpha;
}
