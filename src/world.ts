import * as C from "./constants";
import type {
  Body,
  Direction,
  FathomState,
  Predator,
  ReadState,
  Screen,
} from "./model";

export const DIRS: Direction[] = ["up", "right", "down", "left"];
export const VECTOR: Record<Direction, [number, number]> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};
export const opposite = (d: Direction): Direction =>
  DIRS[(DIRS.indexOf(d) + 2) % 4];
export const center = (tx: number, ty: number) => ({
  x: C.GRID_ORIGIN_X + (tx + 0.5) * C.TILE,
  y: C.GRID_ORIGIN_Y + (ty + 0.5) * C.TILE,
  tx,
  ty,
});
export const layer = (char: string): string[] =>
  Array.from({ length: C.GRID_ROWS }, () => char.repeat(C.GRID_COLS));
export function put(rows: string[], x: number, y: number, char: string): void {
  rows[y] = rows[y].slice(0, x) + char + rows[y].slice(x + 1);
}
export const tile = (s: ReadState, x: number, y: number): string =>
  s.tiles[y]?.[x] ?? "#";
export function maze(): string[] {
  const rows = layer("#");
  for (const y of [1, 5, 11, 16])
    for (let x = 1; x < C.GRID_COLS - 1; x++) put(rows, x, y, ".");
  for (const x of [1, 5, 9, 13, 22, 26, 30, 34])
    for (let y = 1; y < C.GRID_ROWS - 1; y++) put(rows, x, y, ".");
  for (const x of [16, 19]) for (let y = 1; y <= 5; y++) put(rows, x, y, ".");
  for (let x = 0; x < C.GRID_COLS; x++)
    if (x <= 13 || x >= 22) put(rows, x, 8, ".");
  for (let y = 7; y <= 9; y++)
    for (let x = 16; x <= 19; x++) put(rows, x, y, "d");
  put(rows, 17, 6, "g");
  return rows;
}
export function locate(
  s: ReadState,
  char: string,
): { tx: number; ty: number } | null {
  for (let y = 0; y < C.GRID_ROWS; y++) {
    const x = s.tiles[y].indexOf(char);
    if (x >= 0) return { tx: x, ty: y };
  }
  return null;
}
export function neighbor(
  s: ReadState,
  x: number,
  y: number,
  dir: Direction,
): { tx: number; ty: number } | null {
  const [dx, dy] = VECTOR[dir];
  let tx = x + dx;
  const ty = y + dy;
  const wrap = s.tiles.findIndex(
    (r) => r[0] === "." && r[C.GRID_COLS - 1] === ".",
  );
  if (y === wrap) tx = (tx + C.GRID_COLS) % C.GRID_COLS;
  if (tx < 0 || tx >= C.GRID_COLS || ty < 0 || ty >= C.GRID_ROWS) return null;
  return { tx, ty };
}
export function open(s: ReadState, x: number, y: number, den = false): boolean {
  const t = tile(s, x, y);
  return t === "." || (den && (t === "g" || t === "d"));
}
export function options(
  s: ReadState,
  b: { tx: number; ty: number },
  den = false,
): Direction[] {
  return DIRS.filter((d) => {
    const n = neighbor(s, b.tx, b.ty, d);
    return n && open(s, n.tx, n.ty, den);
  });
}
export function distances(
  s: ReadState,
  ox: number,
  oy: number,
  den = false,
): number[] {
  const ds = Array<number>(C.GRID_COLS * C.GRID_ROWS).fill(Infinity);
  if (!open(s, ox, oy, den)) return ds;
  const queue = [{ tx: ox, ty: oy }];
  ds[oy * C.GRID_COLS + ox] = 0;
  for (let i = 0; i < queue.length; i++) {
    const b = queue[i];
    for (const d of options(s, b, den)) {
      const n = neighbor(s, b.tx, b.ty, d)!;
      const k = n.ty * C.GRID_COLS + n.tx;
      if (ds[k] !== Infinity) continue;
      ds[k] = ds[b.ty * C.GRID_COLS + b.tx] + 1;
      queue.push(n);
    }
  }
  return ds;
}
export function route(
  s: ReadState,
  b: Body,
  target: { tx: number; ty: number },
  den = false,
): Direction | null {
  const ds = distances(s, target.tx, target.ty, den);
  let best = Infinity;
  let dir: Direction | null = null;
  for (const d of options(s, b, den)) {
    const n = neighbor(s, b.tx, b.ty, d)!;
    const v = ds[n.ty * C.GRID_COLS + n.tx];
    if (v < best) {
      best = v;
      dir = d;
    }
  }
  return dir;
}
export function random(s: FathomState): number {
  s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
  return s.rng / 4294967296;
}
export function wander(s: FathomState, b: Body): Direction | null {
  const all = options(s, b);
  const forward = all.filter((d) => d !== opposite(b.dir));
  const choices = forward.length ? forward : all;
  return choices.length
    ? choices[Math.floor(random(s) * choices.length)]
    : null;
}
export function coordinates(b: Body): void {
  b.tx = Math.max(
    0,
    Math.min(C.GRID_COLS - 1, Math.floor((b.x - C.GRID_ORIGIN_X) / C.TILE)),
  );
  b.ty = Math.max(
    0,
    Math.min(C.GRID_ROWS - 1, Math.floor((b.y - C.GRID_ORIGIN_Y) / C.TILE)),
  );
}
export const atCenter = (b: Body): boolean => {
  const c = center(b.tx, b.ty);
  return Math.abs(c.x - b.x) < 1e-6 && Math.abs(c.y - b.y) < 1e-6;
};
/** Consume distance up to each center so a tick never skips a buffered turn. */
export function move(
  s: FathomState,
  b: Body,
  speed: number | (() => number),
  choose: () => Direction | null,
  den = false,
): boolean {
  if (!open(s, b.tx, b.ty, den)) return false;
  let time = C.TICK_DT;
  let moved = false;
  while (time > 1e-10) {
    if (atCenter(b)) {
      const d = choose();
      if (!d) break;
      b.dir = d;
      const n = neighbor(s, b.tx, b.ty, d);
      if (!n || !open(s, n.tx, n.ty, den)) break;
    }
    const [dx, dy] = VECTOR[b.dir];
    const c = center(b.tx, b.ty);
    let distance = dx ? (c.x - b.x) * dx : (c.y - b.y) * dy;
    if (distance < 1e-7) {
      const n = neighbor(s, b.tx, b.ty, b.dir);
      if (!n || !open(s, n.tx, n.ty, den)) break;
      distance += C.TILE;
    }
    const rate = typeof speed === "number" ? speed : speed();
    const step = Math.min(time * rate, distance);
    b.x += dx * step;
    b.y += dy * step;
    const width = C.GRID_COLS * C.TILE;
    if (b.x < C.GRID_ORIGIN_X) b.x += width;
    if (b.x >= C.GRID_ORIGIN_X + width) b.x -= width;
    coordinates(b);
    time -= step / rate;
    moved = true;
  }
  return moved;
}
export function speed(
  p: Pick<Predator, "kind" | "state" | "chaseSpeed">,
): number {
  if (p.kind === "lanternjaw" && p.state !== "chase") return C.DRIFTER_SPEED;
  if (p.kind === "gloamfin" && p.state === "chase") return p.chaseSpeed;
  return C.PREDATOR_SPEED;
}
export function predator(
  kind: C.PredatorKind,
  tx: number,
  ty: number,
  slot: number | null,
): Predator {
  return {
    ...center(tx, ty),
    dir: "up",
    kind,
    state: slot === null ? "wander" : "den",
    released: slot === null,
    mind: true,
    travel: true,
    speed: kind === "lanternjaw" ? C.DRIFTER_SPEED : C.PREDATOR_SPEED,
    alert: false,
    lit: false,
    detectRange: kind === "gloamfin" ? null : C.LANTERN_RANGE_BASE,
    hearingRange: kind === "gloamfin" ? C.GLOAMFIN_HEAR : null,
    hearingLock: kind === "gloamfin" ? false : null,
    flareCharging: kind === "flarefish" ? false : null,
    flaring: kind === "flarefish" ? false : null,
    flareRadius: kind === "flarefish" ? 0 : null,
    fix: null,
    linger: 0,
    alertLeft: 0,
    mark: 0,
    chaseSpeed: C.GLOAMFIN_CHASE_SPEED,
    pingIn: C.GLOAMFIN_PING_INTERVAL,
    pingGap: C.GLOAMFIN_PING_MIN_GAP,
    searchTime: 0,
    searchPing: false,
    flareIn: C.FLARE_INTERVAL,
    flareTime: 0,
    fade: 0,
    slot,
  };
}
export function roster(s: ReadState, depth: number): Predator[] {
  const kinds = [
    ...C.DEN_ORDER,
    ...C.ROSTER_ADD_ORDER.slice(0, Math.min(depth, C.ROSTER_CAP_DEPTH) - 1),
  ];
  const dens: { tx: number; ty: number }[] = [];
  for (let y = 0; y < C.GRID_ROWS; y++)
    for (let x = 0; x < C.GRID_COLS; x++)
      if (tile(s, x, y) === "d") dens.push({ tx: x, ty: y });
  return kinds.map((k, i) => {
    const pos = dens[i % dens.length] ?? { tx: 17, ty: 8 };
    return predator(k, pos.tx, pos.ty, i);
  });
}
export function clone(s: ReadState): FathomState {
  return {
    ...s,
    grid: { ...s.grid },
    sonar: { ...s.sonar },
    ink: { ...s.ink },
    tiles: [...s.tiles],
    plankton: [...s.plankton],
    visibility: [...s.visibility],
    forager: { ...s.forager },
    predators: s.predators.map((p) => ({
      ...p,
      fix: p.fix ? { ...p.fix } : null,
    })),
    drifters: s.drifters.map((d) => ({ ...d })),
    pulses: s.pulses.map((p) => ({ ...p })),
    inkClouds: s.inkClouds.map((c) => ({ ...c })),
    start: { ...s.start },
    pointerStarts: { ...s.pointerStarts },
    pending: { ...s.pending },
    art: Object.fromEntries(Object.entries(s.art).map(([k, v]) => [k, [...v]])),
  };
}
export function reconcile(s: ReadState): FathomState {
  const n = clone(s);
  coordinates(n.forager);
  n.drifters.forEach(coordinates);
  n.predators.forEach((p) => {
    coordinates(p);
    p.speed = speed(p);
    p.detectRange =
      p.kind === "gloamfin"
        ? null
        : C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * n.brightness;
    p.hearingRange = p.kind === "gloamfin" ? C.GLOAMFIN_HEAR : null;
  });
  n.visionRadius = C.VISION_MIN + C.VISION_GAIN * n.brightness;
  n.windowRadius = C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * n.brightness;
  n.sonar.ready = n.sonar.cooldown === 0;
  n.sonar.range = Math.max(
    C.SONAR_RANGE_MIN,
    C.SONAR_RANGE_BASE - (n.depth - 1),
  );
  n.ink.ready = n.ink.cooldown === 0;
  n.planktonRemaining = n.plankton.reduce(
    (a, r) => a + [...r].filter((c) => c === "*").length,
    0,
  );
  return n;
}
export function initial(
  art: Record<string, ImageBitmap[]>,
  muted = false,
): FathomState {
  const tiles = maze();
  const s: FathomState = {
    version: C.FATHOM_DEBUG_VERSION,
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,
    depth: 1,
    score: 0,
    lives: C.START_LIVES,
    muted,
    planktonRemaining: 0,
    drifterIn: C.DRIFTER_INTERVAL,
    brightness: 0,
    brightHold: 0,
    visionRadius: C.VISION_MIN,
    windowRadius: C.KINDLE_VISION_MIN,
    sonar: { ready: true, cooldown: 0, range: C.SONAR_RANGE_BASE },
    ink: { ready: true, cooldown: 0 },
    grid: {
      cols: C.GRID_COLS,
      rows: C.GRID_ROWS,
      tile: C.TILE,
      originX: C.GRID_ORIGIN_X,
      originY: C.GRID_ORIGIN_Y,
    },
    tiles,
    plankton: tiles.map((r) =>
      [...r].map((c) => (c === "." ? "*" : "-")).join(""),
    ),
    visibility: layer("u"),
    forager: { ...center(17, 16), dir: "left", moving: false },
    drifters: [],
    predators: [],
    pulses: [],
    inkClouds: [],
    simTime: 0,
    accumulator: 0,
    screenTime: 0,
    playTime: 0,
    desired: "left",
    rng: 0xfade123,
    start: { tx: 17, ty: 16 },
    pointerStarts: {},
    pending: { sonar: false, ink: false },
    art,
  };
  s.predators = roster(s, 1);
  return reconcile(s);
}
export function menuItems(screen: Screen): readonly string[] {
  return screen === "title"
    ? C.TITLE_ITEMS
    : screen === "paused"
      ? C.PAUSE_ITEMS
      : screen === "gameover"
        ? C.GAMEOVER_ITEMS
        : [];
}
export function setScreen(s: FathomState, screen: Screen): void {
  const previous = s.screen;
  s.screen = screen;
  s.menuIndex =
    screen === "title" ? s.titleIndex : menuItems(screen).length ? 0 : null;
  if (screen !== previous) {
    s.screenTime = 0;
    s.pointerStarts = {};
    if (screen === "playing" && previous !== "paused") s.playTime = 0;
  }
}
export function fresh(s: ReadState, screen: Screen): FathomState {
  const n = initial(
    Object.fromEntries(Object.entries(s.art).map(([k, v]) => [k, [...v]])),
    s.muted,
  );
  n.titleIndex = s.titleIndex;
  n.simTime = s.simTime;
  n.accumulator = s.accumulator;
  setScreen(n, screen);
  return n;
}
