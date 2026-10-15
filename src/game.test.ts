/// <reference types="node" />
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import {
  createEngine,
  ConstantClock,
  SequenceClock,
} from "@clockwyrks/simple-2d";
import type { Engine } from "@clockwyrks/simple-2d";
import { game, BACKGROUND } from "./game";
import type { FathomDebugApi, FathomState } from "./game";
import * as C from "./constants";
import { center, distances, layer, options, put } from "./world";

beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    async (path: string) =>
      new Response(await readFile(new URL(`../${path}`, import.meta.url))),
  );
  vi.stubGlobal("createImageBitmap", async (blob: Blob) =>
    loadImage(Buffer.from(await blob.arrayBuffer())),
  );
});
const engines: Engine<FathomState, FathomDebugApi>[] = [];
afterEach(() => {
  engines.splice(0).forEach((e) => e.destroy());
});
async function setup(step = 1000 / C.TICK_HZ) {
  const target = new EventTarget();
  const canvas = createCanvas(C.STAGE_W, C.STAGE_H);
  const e = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: C.STAGE_W,
    height: C.STAGE_H,
    game,
    background: BACKGROUND,
    layout: C.LAYOUT,
    clock: new ConstantClock(step),
    surface: {
      cssWidth: () => C.STAGE_W,
      cssHeight: () => C.STAGE_H,
      dpr: () => 1,
      events: () => target,
    },
  });
  engines.push(e);
  await e.initialize();
  const key = (code: string, down = true) =>
    target.dispatchEvent(
      Object.assign(new Event(down ? "keydown" : "keyup"), {
        code,
        repeat: false,
      }),
    );
  const pointer = (type: string, x: number, y: number) =>
    target.dispatchEvent(
      Object.assign(new Event(`pointer${type}`), {
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: type === "up" ? 0 : 1,
      }),
    );
  return { e, d: e.debug, key, pointer, canvas };
}
async function fixture() {
  const h = await setup();
  h.e.apply((s) => h.d.setScreen(s, "playing"));
  h.e.apply(h.d.clearPredators);
  h.e.apply(h.d.clearPlankton);
  return h;
}
function hallway(): string[] {
  const rows = layer("#");
  for (let x = 1; x < 35; x++) put(rows, x, 12, ".");
  return rows;
}

describe("maze and value contract", () => {
  it("opens with a complete, unrevealed title state and a conforming maze", async () => {
    const { e, d } = await setup();
    const s = d.snapshot(e.state);
    expect(s.screen).toBe("title");
    expect(s.lives).toBe(C.START_LIVES);
    expect(s.visibility.every((r) => /^u+$/.test(r))).toBe(true);
    let count = 0,
      total = 0;
    const degrees = new Map<number, number>();
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) {
        const t = s.tiles[y][x];
        if (!["g", "d"].includes(t) && !["g", "d"].includes(s.tiles[y][35 - x]))
          expect(t).toBe(s.tiles[y][35 - x]);
        if (t !== ".") continue;
        count++;
        const degree = options(e.state, { tx: x, ty: y }).length;
        total += degree;
        degrees.set(y * 36 + x, degree);
        expect(degree).toBeGreaterThanOrEqual(2);
        expect(
          !(
            t === "." &&
            s.tiles[y]?.[x + 1] === "." &&
            s.tiles[y + 1]?.[x] === "." &&
            s.tiles[y + 1]?.[x + 1] === "."
          ),
        ).toBe(true);
      }
    expect(count / 544).toBeGreaterThanOrEqual(C.MAZE_DENSITY_MIN);
    expect(total / count).toBeLessThanOrEqual(C.MAZE_OPENNESS_MAX);
    const ds = distances(e.state, s.forager.tx, s.forager.ty);
    expect(ds.filter(Number.isFinite)).toHaveLength(count);
    const visited = new Set<number>(),
      runs: number[] = [];
    for (const [k, degree] of degrees) {
      if (degree !== 2 || visited.has(k)) continue;
      const queue = [k];
      visited.add(k);
      for (let i = 0; i < queue.length; i++) {
        for (const dir of options(e.state, {
          tx: queue[i] % 36,
          ty: Math.floor(queue[i] / 36),
        })) {
          const [dx, dy] =
            dir === "up"
              ? [0, -1]
              : dir === "down"
                ? [0, 1]
                : dir === "left"
                  ? [-1, 0]
                  : [1, 0];
          const next =
            Math.floor(queue[i] / 36 + dy) * 36 +
            (((queue[i] % 36) + dx + 36) % 36);
          if (degrees.get(next) === 2 && !visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
        }
      }
      runs.push(queue.length);
    }
    const mean = runs.reduce((a, b) => a + b, 0) / runs.length;
    expect(mean).toBeGreaterThanOrEqual(C.MAZE_MAZING_MIN);
    expect(mean).toBeLessThanOrEqual(C.MAZE_MAZING_MAX);
    expect(s.planktonRemaining).toBe(count);
  });
  it("poses immutably, reconciles without sensing, and resets fully", async () => {
    const { e, d } = await setup();
    const before = d.snapshot(e.state);
    const changed = d.setBrightness(e.state, 1);
    expect(d.snapshot(e.state)).toEqual(before);
    expect(changed.windowRadius).toBe(
      C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN,
    );
    const fog = d.clearFog(changed);
    const reconciled = d.reconcile(fog);
    expect(reconciled.visibility).toEqual(fog.visibility);
    expect(d.reconcile(reconciled)).toEqual(reconciled);
    e.apply((s) => d.setScore(s, 900));
    e.apply((s) => d.setDepth(s, 9));
    e.apply(d.reset);
    expect(d.snapshot(e.state)).toEqual(before);
    expect(() => d.setBrightness(e.state, 2)).toThrow();
    expect(() => d.setForagerTile(e.state, 0, 0)).toThrow();
    expect(() => d.setPredatorMind(e.state, 99, false)).toThrow();
    expect(() => d.setMaze(e.state, ["."])).toThrow();
  });
  it("accepts disconnected, denless fixtures exactly as supplied", async () => {
    const { e, d } = await fixture();
    const rows = layer("#");
    put(rows, 3, 3, ".");
    e.apply((s) => d.setMaze(s, rows));
    e.apply((s) => d.setForagerTile(s, 3, 3));
    await e.advance(12);
    expect(e.state.tiles).toEqual(rows);
    expect(e.state.forager).toMatchObject(center(3, 3));
    expect(e.state.screen).toBe("playing");
  });
});
describe("screens and input", () => {
  it("remembers the title selection through how-to and supports pointer confirmation", async () => {
    const { e, d, key, pointer } = await setup();
    key("ArrowDown");
    await e.advance(1);
    key("ArrowDown", false);
    key("Enter");
    await e.advance(1);
    key("Enter", false);
    expect(e.state.screen).toBe("howto");
    expect(e.state.titleIndex).toBe(1);
    pointer("down", 400, 300);
    pointer("up", 400, 300);
    await e.advance(1);
    expect(e.state.screen).toBe("title");
    expect(e.state.menuIndex).toBe(1);
    const r = d.menuItemRect(e.state, 0)!;
    pointer("down", r.x + 20, r.y + 20);
    pointer("up", r.x + 20, r.y + 20);
    await e.advance(1);
    expect(e.state.screen).toBe("countdown");
    await e.advance(239);
    expect(e.state.screen).toBe("playing");
    expect(e.state.predators[0].released).toBe(true);
    expect(e.state.predators[1].released).toBe(false);
  });
  it("requires matching pointer edges and freezes the board while paused", async () => {
    const { e, d, key, pointer } = await fixture();
    e.apply((s) => d.setScreen(s, "title"));
    const a = d.menuItemRect(e.state, 0)!,
      b = d.menuItemRect(e.state, 1)!;
    pointer("down", a.x + 10, a.y + 10);
    pointer("up", b.x + 10, b.y + 10);
    await e.advance(1);
    expect(e.state.screen).toBe("title");
    e.apply((s) => d.setScreen(s, "playing"));
    key("Escape");
    await e.advance(1);
    expect(e.state.screen).toBe("paused");
    key("Escape", false);
    const state = d.snapshot(e.state);
    await e.advance(60);
    expect(e.state.forager).toEqual(state.forager);
    expect(e.state.brightness).toBe(state.brightness);
    expect(e.state.simTime).toBeGreaterThan(state.simTime);
    key("Escape");
    await e.advance(1);
    expect(e.state.screen).toBe("playing");
  });
  it("runs the same ticks across uneven frame deltas", async () => {
    const a = await fixture(),
      b = await fixture();
    a.e.setClock(new ConstantClock(20));
    b.e.setClock(new SequenceClock([3, 37]));
    for (const h of [a, b]) {
      h.e.apply((s) => h.d.setBrightness(s, 1));
      h.e.apply((s) => h.d.setForagerTile(s, 17, 16));
      h.key("ArrowLeft");
    }
    await a.e.advance(50);
    await b.e.advance(50);
    expect(a.d.snapshot(a.e.state)).toEqual(b.d.snapshot(b.e.state));
  });
});
describe("travel, food, and progression", () => {
  it("swims at exactly 128 units/sec, stops on release, and reverses between centers", async () => {
    const { e, d, key } = await fixture();
    e.apply((s) => d.setMaze(s, hallway()));
    e.apply((s) => d.setForagerTile(s, 10, 12));
    const x = e.state.forager.x;
    key("ArrowRight");
    await e.advance(45);
    expect(e.state.forager.x).toBeCloseTo(x + 48);
    key("ArrowRight", false);
    await e.advance(12);
    expect(e.state.forager.x).toBeCloseTo(x + 48);
    key("ArrowLeft");
    await e.advance(15);
    expect(e.state.forager.x).toBeCloseTo(x + 32);
  });
  it("buffers perpendicular turns and never cuts a wall", async () => {
    const { e, d, key } = await fixture();
    const rows = hallway();
    for (let y = 7; y < 12; y++) put(rows, 12, y, ".");
    e.apply((s) => d.setMaze(s, rows));
    e.apply((s) => d.setForagerTile(s, 10, 12));
    key("ArrowRight");
    await e.advance(15);
    key("ArrowUp");
    await e.advance(1);
    key("ArrowUp", false);
    await e.advance(59);
    expect(e.state.forager.x).toBeCloseTo(center(12, 12).x);
    expect(e.state.forager.y).toBeCloseTo(center(12, 12).y - 16);
    expect(e.state.forager.dir).toBe("up");
  });
  it("carries position continuously through the wrap tunnel", async () => {
    const { e, d, key } = await fixture();
    e.apply((s) => d.setForagerTile(s, 0, 8));
    key("ArrowLeft");
    await e.advance(30);
    expect(e.state.forager.x).toBeCloseTo(center(35, 8).x);
    expect(e.state.forager.tx).toBe(35);
  });
  it("eats, holds brightness, decays by half-life, and pays a drifter bonus", async () => {
    const { e, d } = await fixture();
    e.apply((s) => d.setPlankton(s, 17, 16, true));
    e.apply((s) => d.setPlankton(s, 1, 1, true));
    await e.advance(1);
    expect(e.state.score).toBe(C.SCORE_PLANKTON);
    expect(e.state.brightness).toBe(C.BRIGHT_PER_EAT);
    await e.advance(120);
    expect(e.state.brightness).toBeCloseTo(C.BRIGHT_PER_EAT);
    await e.advance(108);
    expect(e.state.brightness).toBeCloseTo(C.BRIGHT_PER_EAT / 2);
    e.apply((s) => d.spawnDrifter(s, 17, 16));
    e.apply((s) => d.setDrifterMind(s, 0, false));
    await e.advance(1);
    expect(e.state.score).toBe(C.SCORE_PLANKTON + C.SCORE_DRIFTER);
  });
  it("clears only by eating the last mote, descends, and preserves score and reserves", async () => {
    const { e, d } = await fixture();
    await e.advance(1);
    expect(e.state.screen).toBe("playing");
    e.apply((s) => d.setPlankton(s, 17, 16, true));
    await e.advance(1);
    expect(e.state.screen).toBe("cleared");
    expect(e.state.score).toBe(C.SCORE_PLANKTON + C.SCORE_CLEAR);
    await e.advance(240);
    expect(e.state.depth).toBe(2);
    expect(e.state.screen).toBe("countdown");
    expect(e.state.predators).toHaveLength(4);
    expect(e.state.sonar.range).toBe(8);
    expect(e.state.visibility.every((r) => /^u+$/.test(r))).toBe(true);
  });
  it("costs a reserve per catch, keeps eaten food and fog, then ends the last attempt", async () => {
    const { e, d } = await fixture();
    e.apply((s) => d.setPlankton(s, 1, 1, true));
    e.apply((s) => d.addPredator(s, "lanternjaw", 17, 16));
    e.apply((s) => d.setPredatorMind(s, 0, false));
    await e.advance(1);
    expect(e.state.lives).toBe(C.START_LIVES - 1);
    expect(e.state.screen).toBe("countdown");
    expect(e.state.planktonRemaining).toBe(1);
    expect(e.state.visibility.join("")).toContain("l");
    e.apply((s) => d.setScreen(s, "playing"));
    e.apply(d.clearPredators);
    e.apply((s) => d.setLives(s, 0));
    e.apply((s) => d.addPredator(s, "gloamfin", 17, 16));
    e.apply((s) => d.setPredatorMind(s, 0, false));
    await e.advance(1);
    expect(e.state.screen).toBe("gameover");
  });
  it("admits drifters on cadence and caps them at two", async () => {
    const { e, d } = await fixture();
    e.apply((s) => d.setPlankton(s, 1, 1, true));
    for (let i = 0; i < 3; i++) {
      e.apply((s) => d.setDrifterIn(s, 0));
      await e.advance(1);
    }
    expect(e.state.drifters).toHaveLength(C.DRIFTER_MAX);
  });
});
describe("senses and hunters", () => {
  it("remembers lit ground, stops light at rock, and does not let the outer window reveal", async () => {
    const { e, d } = await fixture();
    e.apply((s) => d.setMaze(s, hallway()));
    e.apply((s) => d.setForagerTile(s, 10, 12));
    e.apply(d.clearFog);
    await e.advance(1);
    expect(e.state.visibility[12][12]).toBe("l");
    expect(e.state.visibility[10][10]).toBe("u");
    expect(e.state.visibility[12][15]).toBe("u");
    e.apply((s) => d.setForagerTile(s, 30, 12));
    await e.advance(1);
    expect(e.state.visibility[12][12]).toBe("r");
  });
  it("propagates sonar around corners, marks non-amber hunters, and obeys cooldowns", async () => {
    const { e, d, key } = await fixture();
    e.apply((s) => d.setMaze(s, hallway()));
    e.apply((s) => d.setForagerTile(s, 10, 12));
    e.apply((s) => d.addPredator(s, "gloamfin", 15, 12));
    e.apply((s) => d.setPredatorMind(s, 0, false));
    key("Space");
    await e.advance(1);
    key("Space", false);
    expect(e.state.pulses[0].front).toBeCloseTo(C.SONAR_WAVE_SPEED * C.TICK_DT);
    expect(e.state.predators[0].lit).toBe(false);
    await e.advance(43);
    expect(e.state.predators[0].lit).toBe(true);
    expect(e.state.visibility[12][15]).not.toBe("u");
    expect(e.state.sonar.ready).toBe(false);
  });
  it("Lanternjaw hunts visible light without alert and ink breaks the fix immediately", async () => {
    const { e, d, key } = await fixture();
    e.apply((s) => d.setMaze(s, hallway()));
    e.apply((s) => d.setForagerTile(s, 10, 12));
    e.apply((s) => d.addPredator(s, "lanternjaw", 13, 12));
    e.apply((s) => d.setPredatorTravel(s, 0, false));
    await e.advance(1);
    expect(e.state.predators[0]).toMatchObject({
      state: "chase",
      speed: C.PREDATOR_SPEED,
      alert: false,
    });
    key("ShiftLeft");
    await e.advance(1);
    expect(e.state.predators[0].state).toBe("wander");
    expect(e.state.inkClouds[0].radius).toBe(C.INK_RADIUS);
    expect(e.state.ink.cooldown).toBe(C.INK_COOLDOWN);
  });
  it("Gloamfin hears through rock and ink while travel is disabled", async () => {
    const { e, d, key } = await fixture();
    const rows = hallway();
    put(rows, 10, 10, ".");
    e.apply((s) => d.setMaze(s, rows));
    e.apply((s) => d.setForagerTile(s, 10, 12));
    e.apply((s) => d.addPredator(s, "gloamfin", 10, 10));
    e.apply((s) => d.setPredatorTravel(s, 0, false));
    key("ShiftLeft");
    await e.advance(1);
    expect(e.state.predators[0]).toMatchObject({
      state: "chase",
      hearingLock: true,
      alert: true,
      speed: C.GLOAMFIN_CHASE_SPEED,
    });
  });
  it("Flarefish charges, blooms through walls, and expires without revealing on a ping", async () => {
    const { e, d } = await fixture();
    e.apply((s) => d.setForagerTile(s, 1, 16));
    e.apply((s) => d.addPredator(s, "flarefish", 26, 5));
    e.apply((s) => d.setPredatorTravel(s, 0, false));
    e.setClock(new ConstantClock(100));
    await e.advance(71);
    expect(e.state.predators[0].flareCharging).toBe(true);
    await e.advance(5);
    expect(e.state.predators[0].flaring).toBe(true);
    expect(e.state.visibility[6][26]).toBe("l");
    await e.advance(10);
    expect(e.state.predators[0].flaring).toBe(false);
    expect(e.state.visibility[6][26]).toBe("r");
  });
  it("pings without revealing and keeps minds-off hunters stationary and dangerous", async () => {
    const { e, d } = await fixture();
    e.apply((s) => d.addPredator(s, "gloamfin", 5, 1));
    e.apply((s) => d.setPredatorTravel(s, 0, false));
    e.setClock(new ConstantClock(100));
    await e.advance(41);
    expect(e.state.pulses.some((p) => p.source === "gloamfin")).toBe(true);
    expect(e.state.visibility[1][5]).toBe("u");
    expect(e.state.predators[0].lit).toBe(false);
  });
  it("mirrors mute and exposes live pure diagnostics", async () => {
    const { e, d, key } = await fixture();
    key("KeyM");
    await e.advance(1);
    expect(e.state.muted).toBe(true);
    e.apply((s) => d.setBrightness(s, 1));
    const before = d.snapshot(e.state);
    expect(e.diagnostics().find((r) => r.name === "windowRadius")?.value).toBe(
      C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN,
    );
    expect(d.snapshot(e.state)).toEqual(before);
  });
  it("returns both cooldowns to exactly ready and emits each cue only once per tick", async () => {
    const { e, key } = await fixture();
    const cues: string[] = [];
    e.events.on("cue:played", (event) => cues.push(event.cue));
    key("Space");
    key("ShiftLeft");
    await e.advance(1);
    key("Space", false);
    key("ShiftLeft", false);
    expect(cues.filter((c) => c === C.CUES.sonar)).toHaveLength(1);
    expect(cues.filter((c) => c === C.CUES.ink)).toHaveLength(1);
    e.setClock(new ConstantClock(100));
    await e.advance(15);
    expect(e.state.sonar).toMatchObject({ ready: true, cooldown: 0 });
    await e.advance(65);
    expect(e.state.ink).toEqual({ ready: true, cooldown: 0 });
    expect(e.state.inkClouds).toHaveLength(0);
  });
  it("keeps both amber entities unresolved by sonar and preserves an inactive mind", async () => {
    const { e, d, key } = await fixture();
    e.apply((s) => d.setMaze(s, hallway()));
    e.apply((s) => d.setForagerTile(s, 10, 12));
    e.apply((s) => d.addPredator(s, "lanternjaw", 15, 12));
    e.apply((s) => d.setPredatorMind(s, 0, false));
    e.apply((s) => d.spawnDrifter(s, 15, 12));
    e.apply((s) => d.setDrifterTravel(s, 0, false));
    const pos = { ...e.state.predators[0] };
    key("Space");
    await e.advance(45);
    expect(e.state.predators[0].lit).toBe(false);
    expect(e.state.drifters[0].lit).toBe(false);
    expect(e.state.predators[0].x).toBe(pos.x);
    expect(e.state.predators[0].state).toBe("wander");
  });
  it("holds a lapsed light fix for two seconds, then resumes wandering", async () => {
    const { e, d } = await fixture();
    e.apply((s) => d.setMaze(s, hallway()));
    e.apply((s) => d.setForagerTile(s, 10, 12));
    e.apply((s) => d.addPredator(s, "lanternjaw", 13, 12));
    e.apply((s) => d.setPredatorTravel(s, 0, false));
    await e.advance(1);
    e.apply((s) => d.setForagerTile(s, 30, 12));
    await e.advance(239);
    expect(e.state.predators[0].state).toBe("chase");
    await e.advance(1);
    expect(e.state.predators[0].state).toBe("wander");
  });
  it("paths around rock, pays a corner speed penalty, and searches with an orange ping", async () => {
    const { e, d } = await fixture();
    const rows = hallway();
    for (let y = 8; y < 12; y++) put(rows, 14, y, ".");
    e.apply((s) => d.setMaze(s, rows));
    e.apply((s) => d.setForagerTile(s, 14, 8));
    e.apply((s) => d.addPredator(s, "gloamfin", 10, 12));
    e.apply((s) => d.setPredatorState(s, 0, "chase"));
    e.apply((s) => d.setForagerTile(s, 30, 12));
    e.apply((s) => d.setPredatorDir(s, 0, "right"));
    let turns = 0;
    while (e.state.predators[0].dir !== "up" && turns++ < 200) {
      await e.advance(1);
      expect(
        e.state.tiles[e.state.predators[0].ty][e.state.predators[0].tx],
      ).toBe(".");
    }
    expect(e.state.predators[0].dir).toBe("up");
    expect(e.state.predators[0].speed).toBe(C.GLOAMFIN_CORNER_SPEED);
    let steps = 0;
    while (e.state.predators[0].state !== "search" && steps++ < 300)
      await e.advance(1);
    expect(e.state.predators[0].state).toBe("search");
    await e.advance(144);
    expect(e.state.pulses.some((p) => p.tint === "orange")).toBe(true);
  });
  it("a flare can lock through rock during the bloom and ends its own tell", async () => {
    const { e, d } = await fixture();
    e.apply((s) => d.setForagerTile(s, 26, 11));
    e.apply((s) => d.addPredator(s, "flarefish", 26, 5));
    e.apply((s) => d.setPredatorTravel(s, 0, false));
    e.setClock(new ConstantClock(100));
    await e.advance(76);
    expect(e.state.predators[0]).toMatchObject({
      state: "chase",
      alert: true,
      flaring: false,
      flareCharging: false,
      flareRadius: 0,
      speed: C.PREDATOR_SPEED,
    });
  });
});
