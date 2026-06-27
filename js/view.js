// view.js — SVG 描画と操作（選択 / パネル / パン・ズーム・フィット / ドラッグ / 子ノード切替）
import { buildGraph, hopColor } from './parser.js';
import { seed, step, boundary } from './layout.js';

const SVGNS = 'http://www.w3.org/2000/svg';

export class Viewer {
  constructor(root = document) {
    this.$ = id => root.getElementById(id);
    this.NS = this.$('nodes'); this.ES = this.$('edges');
    this.CN = this.$('children'); this.CL = this.$('clinks');
    this.WORLD = this.$('world'); this.SVG = this.$('svg'); this.STAGE = this.$('stage');

    this.g = null;                                   // 現在のグラフ
    this.mode = 'panel';                             // 'panel' | 'subnode'
    this.view = { x: 0, y: 0, k: 1 };
    this.W = 900; this.H = 560;
    this.alpha = 1; this.running = false;
    this.drag = null;

    this._wireGlobalInput();
    this._wireToolbar();
  }

  applyView() {
    this.WORLD.setAttribute('transform', `translate(${this.view.x},${this.view.y}) scale(${this.view.k})`);
  }

  // 中立データを受け取って描画開始。
  load(data) {
    this.NS.innerHTML = ''; this.ES.innerHTML = ''; this.CN.innerHTML = ''; this.CL.innerHTML = '';
    this.g = buildGraph(data);
    this._buildLegend(); this._buildAreas(); this._buildAreaEdges(); this._buildChildren();
    this.setMode('panel'); this._seed(); this.applyView(); this.render(); this.fit();
    if (!this.running) { this.running = true; requestAnimationFrame(() => this._tick()); }
  }

  _seed() {
    this.W = this.STAGE.clientWidth || 900;
    this.H = this.STAGE.clientHeight || 560;
    seed(this.g, this.W, this.H);
  }

  _buildLegend() {
    let h = `<span class="sw"><i style="background:var(--start)"></i>開始</span>`;
    for (let i = 1; i <= this.g.maxHop; i++)
      h += `<span class="sw"><i style="background:${hopColor(i, this.g.maxHop)}"></i>${i}ホップ</span>`;
    h += `<span class="sw"><i style="background:#6b7280"></i>到達不能</span>`;
    h += `<span class="sw"><i style="background:var(--fac);border-radius:2px"></i>施設</span>`;
    h += `<span class="sw"><i class="di" style="background:var(--dun)"></i>ダンジョン</span>`;
    h += `<span class="sw">↔ 双方向</span>`;
    this.$('legend').innerHTML = h;
  }

  _buildAreas() {
    const { areas } = this.g;
    areas.forEach(n => {
      const g = document.createElementNS(SVGNS, 'g'); g.setAttribute('class', 'node');
      const rect = document.createElementNS(SVGNS, 'rect');
      rect.setAttribute('class', 'pill'); rect.setAttribute('rx', '9'); rect.setAttribute('fill', n.col);
      const lab = document.createElementNS(SVGNS, 'text'); lab.setAttribute('class', 'lab'); lab.textContent = n.label;
      const idt = document.createElementNS(SVGNS, 'text'); idt.setAttribute('class', 'id'); idt.textContent = '#' + n.id;
      g.append(rect, lab, idt); this.NS.append(g);
      n.el = { g, rect, lab, idt };
    });
    areas.forEach(n => {
      const tw = n.el.lab.getComputedTextLength();
      const padX = 14, idW = 22, h = 30, MAXW = 240;
      let w = Math.max(74, tw + padX * 2 + idW);
      if (w > MAXW) w = MAXW;                      // 極端に長い場合のみ最大幅で省略
      n.hw = w / 2; n.hh = h / 2;
      n.el.rect.setAttribute('width', w); n.el.rect.setAttribute('height', h);
      n.el.rect.setAttribute('x', -n.hw); n.el.rect.setAttribute('y', -n.hh);
      n.el.lab.setAttribute('x', -n.hw + padX - 2); n.el.lab.setAttribute('text-anchor', 'start'); n.el.lab.setAttribute('y', 0);
      n.el.idt.setAttribute('x', n.hw - padX + 4); n.el.idt.setAttribute('text-anchor', 'end'); n.el.idt.setAttribute('y', 0);
      // 開始ノード強調: リング + バッジ
      if (n.start) {
        const ring = document.createElementNS(SVGNS, 'rect'); ring.setAttribute('class', 'startring');
        ring.setAttribute('x', -n.hw - 5); ring.setAttribute('y', -n.hh - 5);
        ring.setAttribute('width', w + 10); ring.setAttribute('height', h + 10); ring.setAttribute('rx', '13');
        const bg = document.createElementNS(SVGNS, 'text'); bg.setAttribute('class', 'startbadge');
        bg.setAttribute('x', 0); bg.setAttribute('y', -n.hh - 12); bg.textContent = '▶ 開始地点';
        n.el.g.append(ring, bg);
      }
      n.el.g.addEventListener('pointerdown', e => this._startDragNode(e, n));
      // 選択/フォーカスは pointerup 側で判定する（SVG がポインタキャプチャ中は
      // click / dblclick がノードではなく SVG に飛ぶため、ここでは拾えない）。
    });
  }

  _buildAreaEdges() {
    this.g.edges.forEach(ed => {
      const p = document.createElementNS(SVGNS, 'line'); p.setAttribute('class', 'edge');
      // 双方向 ↔（両端矢印）。方向フラグ付きエッジは片端のみ。
      const oneWay = ed.directed === true;
      p.setAttribute('marker-end', 'url(#arrow)');
      if (!oneWay) p.setAttribute('marker-start', 'url(#arrow)');
      this.ES.append(p); ed.el = p; ed.oneWay = oneWay;
    });
  }

  _buildChildren() {
    this.g.children.forEach(c => {
      const g = document.createElementNS(SVGNS, 'g'); g.setAttribute('class', 'child');
      let mk;
      if (c.kind === 'f') {
        mk = document.createElementNS(SVGNS, 'rect');
        mk.setAttribute('x', -8); mk.setAttribute('y', -8); mk.setAttribute('width', 16); mk.setAttribute('height', 16);
        mk.setAttribute('rx', 3); mk.setAttribute('fill', 'var(--fac)');
      } else {
        mk = document.createElementNS(SVGNS, 'rect');
        mk.setAttribute('x', -7.5); mk.setAttribute('y', -7.5); mk.setAttribute('width', 15); mk.setAttribute('height', 15);
        mk.setAttribute('transform', 'rotate(45)'); mk.setAttribute('fill', 'var(--dun)');
      }
      mk.setAttribute('class', 'mk');
      const lab = document.createElementNS(SVGNS, 'text'); lab.setAttribute('class', 'clab');
      lab.setAttribute('x', 12); lab.setAttribute('y', 0); lab.textContent = c.name;
      g.append(mk, lab); this.CN.append(g); c.el = { g };
      const ln = document.createElementNS(SVGNS, 'line'); ln.setAttribute('class', 'clink'); this.CL.append(ln); c.link = ln;
      g.style.display = 'none'; ln.style.display = 'none';
    });
  }

  _tick() {
    if (this.g) { this.alpha = step(this.g, this.mode, this.alpha, this.W, this.H); this.render(); }
    requestAnimationFrame(() => this._tick());
  }

  render() {
    const { areas, edges, children, byId } = this.g;
    areas.forEach(n => n.el.g.setAttribute('transform', `translate(${n.x},${n.y})`));
    edges.forEach(ed => {
      const a = byId[ed.a], b = byId[ed.b]; if (!a || !b) return;
      let dx = b.x - a.x, dy = b.y - a.y;
      const [oax, oay] = boundary(dx, dy, a.hw, a.hh);
      const [obx, oby] = boundary(-dx, -dy, b.hw, b.hh);
      ed.el.setAttribute('x1', a.x + oax); ed.el.setAttribute('y1', a.y + oay);
      ed.el.setAttribute('x2', b.x + obx); ed.el.setAttribute('y2', b.y + oby);
    });
    if (this.mode === 'subnode') children.forEach(c => {
      const p = byId[c.parent]; if (!p) return;
      c.el.g.setAttribute('transform', `translate(${c.x},${c.y})`);
      c.link.setAttribute('x1', p.x); c.link.setAttribute('y1', p.y);
      c.link.setAttribute('x2', c.x); c.link.setAttribute('y2', c.y);
    });
  }

  setMode(m) {
    this.mode = m;
    const sub = (m === 'subnode');
    this.g.children.forEach(c => { c.el.g.style.display = sub ? '' : 'none'; c.link.style.display = sub ? '' : 'none'; });
    this.$('toggle').textContent = 'facility表示: ' + (sub ? 'サブノード' : 'パネル');
  }

  childrenOf(id) { return this.g.children.filter(c => c.parent === id); }

  selectNode(n, clientX, clientY) {
    const { areas, edges, adj, byId } = this.g;
    const nb = new Set([n.id]); (adj[n.id] || []).forEach(v => nb.add(v));
    areas.forEach(m => { m.el.g.classList.toggle('dim', !nb.has(m.id)); m.el.g.classList.toggle('sel', m.id === n.id); });
    edges.forEach(ed => {
      const on = (ed.a === n.id || ed.b === n.id);
      ed.el.classList.toggle('hi', on); ed.el.classList.toggle('dim', !on);
      ed.el.setAttribute('marker-end', on ? 'url(#arrowhi)' : 'url(#arrow)');
      if (!ed.oneWay) ed.el.setAttribute('marker-start', on ? 'url(#arrowhi)' : 'url(#arrow)');
    });
    if (this.mode === 'subnode') this.g.children.forEach(c => c.el.g.classList.toggle('dim', c.parent !== n.id));
    // 詳細パネル（ホップ数は出さない）
    this.$('i-name').textContent = n.label;
    this.$('i-id').textContent = 'id ' + n.id;
    this.$('i-adj').textContent = (adj[n.id] || []).map(v => byId[v].label).join('、') || 'なし';
    const cs = this.childrenOf(n.id);
    this.$('i-subh').textContent = `施設 / ダンジョン（${cs.length}）`;
    this.$('i-sub').innerHTML = cs.length
      ? cs.map(c => {
          const d = c.depth || 0;
          const guide = d ? `<span class="tg">└ </span>` : '';
          return `<div class="it" style="padding-left:${d * 14}px">${guide}<span class="mk ${c.kind}"></span>${c.name}</div>`;
        }).join('')
      : '<div class="it" style="color:var(--ink-dim)">なし</div>';
    const insp = this.$('inspect');
    insp.classList.add('on');
    if (clientX != null && clientY != null) this._placePanel(insp, clientX, clientY);
  }

  // パネルをクリック地点の近くに表示（画面端ではなく）。ステージ内に収める。
  _placePanel(insp, clientX, clientY) {
    const s = this.STAGE.getBoundingClientRect();
    const off = 14, pad = 8;
    const w = insp.offsetWidth, h = insp.offsetHeight;
    let x = clientX - s.left + off;
    if (x + w > s.width - pad) x = clientX - s.left - off - w;   // 右に入らなければカーソル左へ
    x = Math.max(pad, Math.min(x, s.width - w - pad));
    let y = clientY - s.top + off;
    y = Math.max(pad, Math.min(y, s.height - h - pad));
    insp.style.right = 'auto';
    insp.style.left = x + 'px';
    insp.style.top = y + 'px';
  }

  clearSel() {
    this.g.areas.forEach(m => m.el.g.classList.remove('dim', 'sel'));
    this.g.edges.forEach(ed => {
      ed.el.classList.remove('hi', 'dim');
      ed.el.setAttribute('marker-end', 'url(#arrow)');
      if (!ed.oneWay) ed.el.setAttribute('marker-start', 'url(#arrow)');
    });
    this.g.children.forEach(c => c.el.g.classList.remove('dim'));
    this.$('inspect').classList.remove('on');
  }

  focusNode(n) { // ダブルクリック: 中央寄せ + ズーム
    const k = 1.5; this.view.k = k;
    this.view.x = this.SVG.clientWidth / 2 - n.x * k;
    this.view.y = this.SVG.clientHeight / 2 - n.y * k;
    this.applyView();
  }

  _clientToWorld(cx, cy) {
    const r = this.SVG.getBoundingClientRect();
    return { x: (cx - r.left - this.view.x) / this.view.k, y: (cy - r.top - this.view.y) / this.view.k };
  }

  _startDragNode(e, n) {
    e.stopPropagation(); this.SVG.setPointerCapture(e.pointerId);
    const w = this._clientToWorld(e.clientX, e.clientY);
    this.drag = { type: 'node', n, dx: n.x - w.x, dy: n.y - w.y, sx: e.clientX, sy: e.clientY, moved: false };
    n.pin = true; this.alpha = Math.max(this.alpha, 0.5);
  }

  _wireGlobalInput() {
    const SVG = this.SVG;
    SVG.addEventListener('pointerdown', e => {
      SVG.setPointerCapture(e.pointerId);
      this.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: this.view.x, oy: this.view.y, moved: false };
      SVG.classList.add('panning');
    });
    SVG.addEventListener('pointermove', e => {
      const drag = this.drag; if (!drag) return;
      if (drag.type === 'node') {
        const w = this._clientToWorld(e.clientX, e.clientY);
        drag.n.x = w.x + drag.dx; drag.n.y = w.y + drag.dy;
        if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
      } else {
        this.view.x = drag.ox + (e.clientX - drag.sx);
        this.view.y = drag.oy + (e.clientY - drag.sy);
        drag.moved = true; this.applyView();
      }
    });
    SVG.addEventListener('pointerup', () => {
      const drag = this.drag;
      if (drag && drag.type === 'node') {
        drag.n.pin = false;
        if (!drag.moved) {                           // 動かしていなければクリック扱い
          const now = Date.now();
          if (this._lastTap && this._lastTap.n === drag.n && now - this._lastTap.t < 300) {
            this.focusNode(drag.n); this._lastTap = null;   // 連続タップ＝フォーカス
          } else {
            this.selectNode(drag.n, drag.sx, drag.sy); this._lastTap = { n: drag.n, t: now };
          }
        }
      }
      if (drag && drag.type === 'pan' && !drag.moved) this.clearSel();
      this.drag = null; SVG.classList.remove('panning');
    });
    SVG.addEventListener('wheel', e => {
      e.preventDefault();
      const r = SVG.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const nk = Math.min(2.6, Math.max(0.3, this.view.k * f));
      this.view.x = mx - (mx - this.view.x) * (nk / this.view.k);
      this.view.y = my - (my - this.view.y) * (nk / this.view.k);
      this.view.k = nk; this.applyView();
    }, { passive: false });
    window.addEventListener('resize', () => this.fit());
  }

  _wireToolbar() {
    this.$('fit').onclick = () => this.fit();
    this.$('relayout').onclick = () => { this._seed(); this.alpha = 1; setTimeout(() => this.fit(), 800); };
    this.$('toggle').onclick = () => {
      this.setMode(this.mode === 'panel' ? 'subnode' : 'panel');
      this._seed(); this.alpha = 1; setTimeout(() => this.fit(), 700);
    };
  }

  fit() {
    if (!this.g) return;
    const list = this.mode === 'subnode' ? [...this.g.areas, ...this.g.children] : this.g.areas;
    if (!list.length) return;
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    list.forEach(n => {
      const hw = n.hw || 14, hh = n.hh || 14;
      a = Math.min(a, n.x - hw); b = Math.min(b, n.y - hh);
      c = Math.max(c, n.x + hw); d = Math.max(d, n.y + hh);
    });
    const pad = 54, bw = c - a + pad * 2, bh = d - b + pad * 2;
    const k = Math.min(this.SVG.clientWidth / bw, this.SVG.clientHeight / bh, 1.6);
    this.view.k = k;
    this.view.x = (this.SVG.clientWidth - (a + c) * k) / 2;
    this.view.y = (this.SVG.clientHeight - (b + d) * k) / 2;
    this.applyView();
  }
}
