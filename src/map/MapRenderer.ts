// PixiJS province map: one Graphics per province, tinted per map mode; pan/zoom/hover/select.
import { Application, Container, Graphics } from "pixi.js";
import { lighten } from "./colors";

export interface MapCallbacks { onHover(p: number | null): void; onSelect(p: number | null): void }

export class MapRenderer {
  private app = new Application();
  private world = new Container();
  private shapes: Graphics[] = [];
  private outline = new Graphics();
  private colors: number[] = [];
  private hovered: number | null = null;
  private selected: number | null = null;

  constructor(private rings: number[][][], private cb: MapCallbacks) {}

  async mount(el: HTMLElement): Promise<void> {
    await this.app.init({ autoStart: false, resizeTo: el, background: 0x1d3557, antialias: true, autoDensity: true, resolution: devicePixelRatio });
    el.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    this.rings.forEach((polys, id) => {
      const g = new Graphics();
      for (const pts of polys) g.poly(pts).fill(0xffffff);
      for (const pts of polys) g.poly(pts).stroke({ color: 0x202020, width: 1, pixelLine: true, alpha: 0.6 });
      g.eventMode = "static";
      g.cursor = "pointer";
      g.on("pointerover", () => this.setHover(id));
      g.on("pointerout", () => this.hovered === id && this.setHover(null));
      g.on("pointertap", (e) => { if (!this.dragged) { e.stopPropagation(); this.select(id); } });
      this.world.addChild(g);
      this.shapes.push(g);
    });
    this.world.addChild(this.outline);
    this.installPanZoom();
    this.fit();
    this.app.renderer.on("resize", () => this.requestRender());
    this.requestRender();
  }

  /** Render on demand: the map is static between interactions and snapshots. */
  private frame = 0;
  requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const t0 = performance.now();
      this.app.render();
      this.lastRenderMs = performance.now() - t0;
    });
  }
  lastRenderMs = 0;

  setColors(colors: number[]): void {
    this.colors = colors;
    this.shapes.forEach((g, i) => (g.tint = i === this.hovered ? lighten(colors[i]!, 0.35) : colors[i]!));
    this.requestRender();
  }

  select(id: number | null): void {
    this.selected = id;
    this.outline.clear();
    if (id !== null) for (const pts of this.rings[id]!) this.outline.poly(pts).stroke({ color: 0xffd60a, width: 2.5 / this.world.scale.x });
    this.requestRender();
    this.cb.onSelect(id);
  }

  centerOn(id: number): void {
    const b = this.shapes[id]!.getLocalBounds();
    const s = this.world.scale.x;
    this.world.position.set(this.app.screen.width / 2 - (b.x + b.width / 2) * s, this.app.screen.height / 2 - (b.y + b.height / 2) * s);
  }

  destroy(): void { cancelAnimationFrame(this.frame); this.app.destroy(true, { children: true }); }

  private setHover(id: number | null) {
    const prev = this.hovered;
    this.hovered = id;
    if (prev !== null) this.shapes[prev]!.tint = this.colors[prev] ?? 0xffffff;
    if (id !== null) this.shapes[id]!.tint = lighten(this.colors[id] ?? 0xffffff, 0.35);
    this.requestRender();
    this.cb.onHover(id);
  }

  private dragged = false;
  private installPanZoom() {
    const stage = this.app.stage;
    stage.eventMode = "static";
    stage.hitArea = this.app.screen;
    let start: { x: number; y: number; wx: number; wy: number } | null = null;
    stage.on("pointerdown", (e) => { start = { x: e.global.x, y: e.global.y, wx: this.world.x, wy: this.world.y }; this.dragged = false; });
    stage.on("pointermove", (e) => {
      if (!start) return;
      const dx = e.global.x - start.x, dy = e.global.y - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.dragged = true;
      if (this.dragged) { this.world.position.set(start.wx + dx, start.wy + dy); this.requestRender(); }
    });
    const end = () => { start = null; };
    stage.on("pointerup", end);
    stage.on("pointerupoutside", end);
    stage.on("pointertap", () => { if (!this.dragged) this.select(null); });
    this.app.canvas.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const r = this.app.canvas.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      const old = this.world.scale.x;
      const next = Math.max(0.3, Math.min(40, old * Math.exp(-ev.deltaY * 0.0015)));
      this.world.position.set(mx - ((mx - this.world.x) * next) / old, my - ((my - this.world.y) * next) / old);
      this.world.scale.set(next);
      if (this.selected !== null) this.select(this.selected);
      this.requestRender();
    }, { passive: false });
  }

  private fit() {
    const b = this.world.getLocalBounds();
    const s = Math.min(this.app.screen.width / b.width, this.app.screen.height / b.height) * 0.95;
    this.world.scale.set(s);
    this.world.position.set((this.app.screen.width - b.width * s) / 2 - b.x * s, (this.app.screen.height - b.height * s) / 2 - b.y * s);
  }
}
