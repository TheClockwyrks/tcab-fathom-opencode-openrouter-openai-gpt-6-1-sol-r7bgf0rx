import * as C from "./constants";
import type {
  Body,
  Direction,
  FathomState,
  Predator,
  ReadState,
} from "./model";
import {
  atCenter,
  center,
  coordinates,
  distances,
  fresh,
  locate,
  move,
  neighbor,
  open,
  opposite,
  options,
  put,
  roster,
  route,
  setScreen,
  speed,
  tile,
  wander,
} from "./world";

export type Events = Set<C.CueName>;
const down = (value: number): number =>
  value <= C.TICK_DT + 1e-10 ? 0 : value - C.TICK_DT;
export const distance = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => Math.hypot(a.x - b.x, a.y - b.y);
export const sameTile = (
  a: { tx: number; ty: number },
  b: { tx: number; ty: number },
): boolean => a.tx === b.tx && a.ty === b.ty;
/** Grid traversal tests every cell crossed, including the rock the ray lands on. */
export function sight(
  s: ReadState,
  a: { x: number; y: number },
  b: { x: number; y: number },
  landOnRock = false,
): boolean {
  let x = Math.floor((a.x - C.GRID_ORIGIN_X) / C.TILE),
    y = Math.floor((a.y - C.GRID_ORIGIN_Y) / C.TILE);
  const ex = Math.floor((b.x - C.GRID_ORIGIN_X) / C.TILE),
    ey = Math.floor((b.y - C.GRID_ORIGIN_Y) / C.TILE);
  const dx = b.x - a.x,
    dy = b.y - a.y,
    sx = Math.sign(dx),
    sy = Math.sign(dy);
  let mx =
    dx === 0
      ? Infinity
      : (C.GRID_ORIGIN_X + (x + (sx > 0 ? 1 : 0)) * C.TILE - a.x) / dx;
  let my =
    dy === 0
      ? Infinity
      : (C.GRID_ORIGIN_Y + (y + (sy > 0 ? 1 : 0)) * C.TILE - a.y) / dy;
  for (let i = 0; i < C.GRID_COLS + C.GRID_ROWS + 2; i++) {
    if (x === ex && y === ey) return landOnRock || tile(s, x, y) !== "#";
    if (tile(s, x, y) === "#") return false;
    if (mx < my) {
      x += sx;
      mx += C.TILE / Math.abs(dx);
    } else if (my < mx) {
      y += sy;
      my += C.TILE / Math.abs(dy);
    } else {
      x += sx;
      y += sy;
      mx += C.TILE / Math.abs(dx);
      my += C.TILE / Math.abs(dy);
    }
  }
  return false;
}
export function blinded(s: ReadState, p: { x: number; y: number }): boolean {
  const f = s.forager,
    dx = f.x - p.x,
    dy = f.y - p.y;
  return s.inkClouds.some((c) => {
    const t = Math.max(
      0,
      Math.min(
        1,
        ((c.x - p.x) * dx + (c.y - p.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
    return Math.hypot(c.x - p.x - t * dx, c.y - p.y - t * dy) <= c.radius;
  });
}
function acquire(s: FathomState, p: Predator): void {
  if (p.state !== "chase") {
    if (p.kind !== "lanternjaw") p.alertLeft = C.ALERT_TIME;
    p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
  }
  p.state = "chase";
  p.fix = { tx: s.forager.tx, ty: s.forager.ty };
  p.linger = C.LINGER_TIME;
  if (p.kind === "flarefish") {
    if (p.flareTime > 0) p.fade = 0.35;
    p.flareTime = 0;
    p.flaring = false;
    p.flareCharging = false;
    p.flareRadius = 0;
  }
  const dir = route(s, p, p.fix);
  if (dir === opposite(p.dir)) p.dir = dir;
}
function patrol(p: Predator): void {
  p.state = "wander";
  p.fix = null;
  p.linger = 0;
  if (p.kind === "flarefish") {
    p.flareIn = C.FLARE_INTERVAL;
    p.flareTime = 0;
    p.flareCharging = false;
    p.flaring = false;
    p.flareRadius = 0;
  }
}
function ping(
  s: FathomState,
  p: Predator,
  index: number,
  orange: boolean,
  events: Events,
): void {
  s.pulses.push({
    source: "gloamfin",
    tint: orange ? "orange" : "violet",
    ox: p.tx,
    oy: p.ty,
    front: 0,
    range: C.GLOAMFIN_PING_RANGE,
    owner: index,
    caught: false,
  });
  p.pingIn = C.GLOAMFIN_PING_INTERVAL;
  p.pingGap = 0;
  events.add(C.CUES.predatorPing);
}
function mind(
  s: FathomState,
  p: Predator,
  index: number,
  events: Events,
): void {
  if (!p.mind || p.state === "den") return;
  const dt = C.TICK_DT;
  p.alertLeft = down(p.alertLeft);
  p.fade = down(p.fade);
  if (p.kind === "gloamfin") {
    const locked = distance(p, s.forager) <= C.GLOAMFIN_HEAR;
    const broke = p.hearingLock && !locked;
    p.hearingLock = locked;
    p.pingIn = down(p.pingIn);
    p.pingGap += dt;
    if (locked) acquire(s, p);
    else if (
      p.state === "chase" &&
      p.fix &&
      sameTile(p, p.fix) &&
      atCenter(p) &&
      !sameTile(p, s.forager)
    ) {
      p.state = "search";
      p.searchTime = 0;
      p.searchPing = false;
    }
    if (p.state === "search") {
      p.searchTime += dt;
      if (p.searchTime >= C.GLOAMFIN_GIVEUP) patrol(p);
    }
    const orange =
      p.state === "search" &&
      !p.searchPing &&
      p.searchTime >= C.GLOAMFIN_SEARCH_DELAY;
    if (
      !locked &&
      p.pingGap + 1e-8 >= C.GLOAMFIN_PING_MIN_GAP &&
      (orange || p.pingIn === 0 || broke)
    ) {
      ping(s, p, index, orange, events);
      if (orange) p.searchPing = true;
    }
    if (p.state === "chase")
      p.chaseSpeed = Math.min(
        C.GLOAMFIN_CHASE_SPEED,
        p.chaseSpeed +
          ((C.GLOAMFIN_CHASE_SPEED - C.GLOAMFIN_CORNER_SPEED) * dt) /
            C.GLOAMFIN_RAMP_TIME,
      );
  } else {
    const blind = blinded(s, p);
    const sensed =
      !blind &&
      distance(p, s.forager) <=
        C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * s.brightness &&
      sight(s, p, s.forager);
    if (blind) {
      if (p.state === "chase") patrol(p);
    } else if (sensed) acquire(s, p);
    else if (p.state === "chase") {
      p.linger = down(p.linger);
      if (p.linger === 0) patrol(p);
    }
    if (p.kind === "flarefish" && p.state === "wander") {
      if (p.flareTime > 0) {
        const before = p.flareTime;
        p.flareTime += dt;
        if (before < C.FLARE_CHARGE && p.flareTime >= C.FLARE_CHARGE)
          events.add(C.CUES.flare);
        if (p.flareTime >= C.FLARE_CHARGE + C.FLARE_BLOOM) {
          p.flareTime = 0;
          p.flareIn = C.FLARE_INTERVAL;
          p.fade = 0.35;
        }
      } else {
        p.flareIn = down(p.flareIn);
        if (p.flareIn === 0) p.flareTime = dt;
      }
      p.flareCharging = p.flareTime > 0 && p.flareTime < C.FLARE_CHARGE;
      p.flaring = p.flareTime >= C.FLARE_CHARGE;
      p.flareRadius = p.flaring ? C.FLARE_RADIUS : 0;
      if (p.flaring && !blind && distance(p, s.forager) <= C.FLARE_RADIUS)
        acquire(s, p);
    }
  }
  p.alert = p.kind !== "lanternjaw" && p.alertLeft > 0;
  p.speed = speed(p);
}
function travel(s: FathomState, p: Predator): void {
  if (!p.mind || !p.travel) return;
  if (p.state === "den") {
    if (!p.released || !locate(s, "d")) return;
    const gate = locate(s, "g");
    if (!gate) return;
    const exit = options(s, gate, true)
      .map((d) => neighbor(s, gate.tx, gate.ty, d)!)
      .find((n) => tile(s, n.tx, n.ty) === ".");
    if (!exit) return;
    move(
      s,
      p,
      p.speed,
      () => (sameTile(p, exit) ? null : route(s, p, exit, true)),
      true,
    );
    if (tile(s, p.tx, p.ty) === "." && atCenter(p)) p.state = "wander";
    return;
  }
  move(
    s,
    p,
    () => p.speed,
    () => {
      let dir: Direction | null;
      if (p.state === "chase" && p.fix)
        dir = sameTile(p, p.fix) ? null : route(s, p, p.fix);
      else if (p.state === "search" && p.fix) {
        const ds = distances(s, p.fix.tx, p.fix.ty);
        const valid = options(s, p).filter((d) => {
          const n = neighbor(s, p.tx, p.ty, d)!;
          return ds[n.ty * C.GRID_COLS + n.tx] <= C.GLOAMFIN_SEARCH_ROAM;
        });
        const ordinary = wander(s, p);
        dir =
          ordinary && valid.includes(ordinary) ? ordinary : route(s, p, p.fix);
      } else dir = wander(s, p);
      if (
        dir &&
        p.kind === "gloamfin" &&
        p.state === "chase" &&
        dir !== p.dir &&
        dir !== opposite(p.dir)
      ) {
        p.chaseSpeed = C.GLOAMFIN_CORNER_SPEED;
        p.speed = p.chaseSpeed;
      }
      return dir;
    },
  );
}
export function illuminate(s: FathomState): void {
  s.visibility = s.visibility.map((r) => r.replace(/l/g, "r"));
  const flares = s.predators.filter((p) => p.flaring && p.state !== "den");
  for (let y = 0; y < C.GRID_ROWS; y++)
    for (let x = 0; x < C.GRID_COLS; x++) {
      const c = center(x, y);
      if (
        (distance(c, s.forager) <= s.visionRadius &&
          sight(s, s.forager, c, true)) ||
        flares.some((p) => distance(p, c) <= C.FLARE_RADIUS)
      )
        put(s.visibility, x, y, "l");
    }
  const passive = (b: Body) =>
    distance(center(b.tx, b.ty), s.forager) <= s.visionRadius &&
    sight(s, s.forager, center(b.tx, b.ty), true);
  const flare = (b: Body) =>
    flares.some((p) => distance(p, b) <= C.FLARE_RADIUS);
  for (const p of s.predators)
    p.lit =
      p.state !== "den" &&
      (passive(p) ||
        flare(p) ||
        p.alert ||
        (p.kind !== "lanternjaw" && p.mark > 0));
  for (const d of s.drifters) d.lit = passive(d) || flare(d);
}
function waves(s: FathomState): void {
  for (const pulse of s.pulses) {
    const before = pulse.front;
    pulse.front += C.SONAR_WAVE_SPEED * C.TICK_DT;
    const ds = distances(s, pulse.ox, pulse.oy);
    const reached = (tx: number, ty: number) => {
      const v = ds[ty * C.GRID_COLS + tx];
      return (
        v <= pulse.range &&
        v <= pulse.front &&
        (v > before || (before === 0 && v === 0))
      );
    };
    if (pulse.source === "forager") {
      for (let y = 0; y < C.GRID_ROWS; y++)
        for (let x = 0; x < C.GRID_COLS; x++)
          if (reached(x, y)) {
            put(s.visibility, x, y, "l");
            for (const d of ["up", "down", "left", "right"] as Direction[]) {
              const n = neighbor(s, x, y, d);
              if (n && tile(s, n.tx, n.ty) === "#")
                put(s.visibility, n.tx, n.ty, "l");
            }
          }
      for (const p of s.predators)
        if (p.state !== "den" && reached(p.tx, p.ty)) {
          if (p.kind !== "lanternjaw") p.mark = C.SONAR_MARK_TIME;
          if (p.kind === "gloamfin" && p.mind) acquire(s, p);
        }
    } else if (!pulse.caught && reached(s.forager.tx, s.forager.ty)) {
      const p = pulse.owner === null ? null : s.predators[pulse.owner];
      if (p?.mind && p.state !== "den") acquire(s, p);
      pulse.caught = true;
    }
  }
  s.pulses = s.pulses.filter((p) => p.front <= p.range);
}
function resetAttempt(s: FathomState): void {
  s.forager = { ...center(s.start.tx, s.start.ty), dir: "left", moving: false };
  s.desired = "left";
  s.brightness = 0;
  s.brightHold = 0;
  s.predators = roster(s, s.depth);
  s.drifters = [];
  s.drifterIn = C.DRIFTER_INTERVAL;
  s.pulses = [];
  s.inkClouds = [];
  s.sonar.cooldown = 0;
  s.ink.cooldown = 0;
  s.pending = { sonar: false, ink: false };
  setScreen(s, "countdown");
}
export interface TickInput {
  held: Direction[];
}
/** The only simulation clock: all systems run here on a freshly owned state. */
export function tick(
  s: FathomState,
  input: TickInput,
  events: Events,
): FathomState {
  s.simTime += C.TICK_DT;
  s.screenTime += C.TICK_DT;
  if (s.screen === "countdown") {
    illuminate(s);
    if (s.screenTime + 1e-8 >= 2) {
      setScreen(s, "playing");
      if (input.held.length) s.desired = input.held[input.held.length - 1];
      for (const p of s.predators) if (p.slot === 0) p.released = true;
    }
    return s;
  }
  if (s.screen === "cleared") {
    if (s.screenTime + 1e-8 >= 2) {
      const n = fresh(s, "countdown");
      n.depth = s.depth + 1;
      n.score = s.score;
      n.lives = s.lives;
      n.predators = roster(n, n.depth);
      return n;
    }
    return s;
  }
  if (s.screen !== "playing") return s;
  const dt = C.TICK_DT;
  s.playTime += dt;
  s.sonar.cooldown = down(s.sonar.cooldown);
  s.ink.cooldown = down(s.ink.cooldown);
  const decay = Math.max(0, dt - s.brightHold);
  s.brightHold = down(s.brightHold);
  s.brightness *= Math.pow(0.5, decay / C.BRIGHT_HALFLIFE);
  s.inkClouds = s.inkClouds
    .map((c) => ({ ...c, remaining: c.remaining - dt }))
    .filter((c) => c.remaining > 1e-8);
  if (s.pending.sonar && s.sonar.cooldown === 0) {
    s.pulses.push({
      source: "forager",
      tint: "cyan",
      ox: s.forager.tx,
      oy: s.forager.ty,
      front: 0,
      range: s.sonar.range,
      owner: null,
      caught: false,
    });
    s.sonar.cooldown = C.SONAR_COOLDOWN;
    events.add(C.CUES.sonar);
  }
  if (s.pending.ink && s.ink.cooldown === 0) {
    s.inkClouds.push({
      x: s.forager.x,
      y: s.forager.y,
      radius: C.INK_RADIUS,
      remaining: C.INK_LIFE,
    });
    s.ink.cooldown = C.INK_COOLDOWN;
    events.add(C.CUES.ink);
  }
  s.pending = { sonar: false, ink: false };
  const f = s.forager;
  if (input.held.length) {
    if (s.desired === opposite(f.dir)) f.dir = s.desired;
    f.moving = move(s, f, C.FORAGER_SPEED, () => {
      const opts = options(s, f);
      return opts.includes(s.desired)
        ? s.desired
        : opts.includes(f.dir)
          ? f.dir
          : null;
    });
  } else f.moving = false;
  if (open(s, f.tx, f.ty) && s.plankton[f.ty][f.tx] === "*") {
    put(s.plankton, f.tx, f.ty, "-");
    s.planktonRemaining--;
    s.score += C.SCORE_PLANKTON;
    s.brightness = Math.min(1, s.brightness + C.BRIGHT_PER_EAT);
    s.brightHold = C.BRIGHT_HOLD;
    events.add(C.CUES.eat);
    if (s.planktonRemaining === 0) {
      s.score += C.SCORE_CLEAR;
      setScreen(s, "cleared");
      events.add(C.CUES.descend);
      return s;
    }
  }
  s.visionRadius = C.VISION_MIN + C.VISION_GAIN * s.brightness;
  s.windowRadius = C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * s.brightness;
  for (let i = 0; i < s.predators.length; i++) {
    const p = s.predators[i];
    if (p.slot !== null && s.playTime + 1e-8 >= p.slot * C.DEN_RELEASE_GAP)
      p.released = true;
    p.mark = down(p.mark);
    mind(s, p, i, events);
    travel(s, p);
  }
  s.drifterIn = down(s.drifterIn);
  if (
    s.drifterIn === 0 &&
    s.planktonRemaining > 0 &&
    s.drifters.length < C.DRIFTER_MAX
  ) {
    const gate = locate(s, "g");
    if (gate) {
      const exit = options(s, gate, true)
        .map((d) => neighbor(s, gate.tx, gate.ty, d)!)
        .find((n) => open(s, n.tx, n.ty));
      if (exit) {
        s.drifters.push({
          ...center(gate.tx, gate.ty),
          dir: "up",
          lit: false,
          mind: true,
          travel: true,
        });
        s.drifterIn = C.DRIFTER_INTERVAL;
      }
    }
  }
  for (const d of s.drifters)
    if (d.mind && d.travel) {
      const atGate = tile(s, d.tx, d.ty) === "g";
      move(
        s,
        d,
        C.DRIFTER_SPEED,
        () => {
          if (!atGate) return wander(s, d);
          return (
            options(s, d, true).find((dir) => {
              const next = neighbor(s, d.tx, d.ty, dir)!;
              return open(s, next.tx, next.ty);
            }) ?? null
          );
        },
        atGate,
      );
    }
  s.drifters = s.drifters.filter((d) => {
    if (sameTile(d, f)) {
      s.score += C.SCORE_DRIFTER;
      return false;
    }
    return true;
  });
  illuminate(s);
  waves(s);
  for (const p of s.predators) {
    p.alert = p.kind !== "lanternjaw" && p.alertLeft > 0;
    p.lit =
      p.state !== "den" &&
      (p.lit || p.alert || (p.kind !== "lanternjaw" && p.mark > 0));
    p.speed = speed(p);
  }
  if (s.predators.some((p) => p.state !== "den" && sameTile(p, f))) {
    events.add(C.CUES.caught);
    if (s.lives === 0) setScreen(s, "gameover");
    else {
      s.lives--;
      resetAttempt(s);
    }
  }
  coordinates(f);
  return s;
}
