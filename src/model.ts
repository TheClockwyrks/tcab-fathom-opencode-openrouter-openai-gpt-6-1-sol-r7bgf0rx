import type { DeepReadonly } from "ts-essentials";
import type { PredatorKind } from "./constants";

export type Direction = "up" | "down" | "left" | "right";
export type Screen =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "cleared"
  | "gameover";
export interface Body {
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Direction;
}
export interface Forager extends Body {
  moving: boolean;
}
export interface Drifter extends Body {
  lit: boolean;
  mind: boolean;
  travel: boolean;
}
export interface Predator extends Body {
  kind: PredatorKind;
  state: "den" | "wander" | "chase" | "search";
  released: boolean;
  mind: boolean;
  travel: boolean;
  speed: number;
  alert: boolean;
  lit: boolean;
  detectRange: number | null;
  hearingRange: number | null;
  hearingLock: boolean | null;
  flareCharging: boolean | null;
  flaring: boolean | null;
  flareRadius: number | null;
  fix: { tx: number; ty: number } | null;
  linger: number;
  alertLeft: number;
  mark: number;
  chaseSpeed: number;
  pingIn: number;
  pingGap: number;
  searchTime: number;
  searchPing: boolean;
  flareIn: number;
  flareTime: number;
  fade: number;
  slot: number | null;
}
export interface Pulse {
  source: "forager" | "gloamfin";
  tint: "cyan" | "violet" | "orange";
  ox: number;
  oy: number;
  front: number;
  range: number;
  owner: number | null;
  caught: boolean;
}
export interface InkCloud {
  x: number;
  y: number;
  radius: number;
  remaining: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface FathomState {
  version: number;
  screen: Screen;
  menuIndex: number | null;
  titleIndex: number;
  depth: number;
  score: number;
  lives: number;
  muted: boolean;
  planktonRemaining: number;
  drifterIn: number;
  brightness: number;
  brightHold: number;
  visionRadius: number;
  windowRadius: number;
  sonar: { ready: boolean; cooldown: number; range: number };
  ink: { ready: boolean; cooldown: number };
  grid: {
    cols: number;
    rows: number;
    tile: number;
    originX: number;
    originY: number;
  };
  tiles: string[];
  plankton: string[];
  visibility: string[];
  forager: Forager;
  drifters: Drifter[];
  predators: Predator[];
  pulses: Pulse[];
  inkClouds: InkCloud[];
  simTime: number;
  accumulator: number;
  screenTime: number;
  playTime: number;
  desired: Direction;
  rng: number;
  start: { tx: number; ty: number };
  pointerStarts: Record<number, number>;
  pending: { sonar: boolean; ink: boolean };
  art: Record<string, ImageBitmap[]>;
}
export type ReadState = DeepReadonly<FathomState>;
export type Snapshot = Omit<
  FathomState,
  | "art"
  | "accumulator"
  | "screenTime"
  | "playTime"
  | "desired"
  | "rng"
  | "start"
  | "pointerStarts"
  | "pending"
  | "predators"
  | "drifters"
  | "pulses"
> & {
  predators: Omit<
    Predator,
    | "fix"
    | "linger"
    | "alertLeft"
    | "mark"
    | "chaseSpeed"
    | "pingIn"
    | "pingGap"
    | "searchTime"
    | "searchPing"
    | "flareIn"
    | "flareTime"
    | "fade"
    | "slot"
  >[];
  drifters: Omit<Drifter, "dir">[];
  pulses: Omit<Pulse, "owner" | "caught">[];
};
export interface FathomDebugApi {
  version: number;
  reset(s: ReadState): FathomState;
  snapshot(s: ReadState): Snapshot;
  reconcile(s: ReadState): FathomState;
  setScreen(s: ReadState, screen: Screen): FathomState;
  setMenuIndex(s: ReadState, index: number): FathomState;
  setTitleIndex(s: ReadState, index: number): FathomState;
  menuItemRect(s: ReadState, index: number): Rect | null;
  setScore(s: ReadState, points: number): FathomState;
  setLives(s: ReadState, n: number): FathomState;
  setDepth(s: ReadState, d: number): FathomState;
  setMaze(s: ReadState, rows: string[]): FathomState;
  setPlankton(
    s: ReadState,
    tx: number,
    ty: number,
    present: boolean,
  ): FathomState;
  clearPlankton(s: ReadState): FathomState;
  clearFog(s: ReadState): FathomState;
  setForagerTile(s: ReadState, tx: number, ty: number): FathomState;
  setForagerDir(s: ReadState, dir: Direction): FathomState;
  setBrightness(s: ReadState, g: number): FathomState;
  setBrightHold(s: ReadState, seconds: number): FathomState;
  clearPredators(s: ReadState): FathomState;
  addPredator(
    s: ReadState,
    kind: PredatorKind,
    tx: number,
    ty: number,
  ): FathomState;
  setPredatorTile(
    s: ReadState,
    index: number,
    tx: number,
    ty: number,
  ): FathomState;
  setPredatorDir(s: ReadState, index: number, dir: Direction): FathomState;
  setPredatorState(
    s: ReadState,
    index: number,
    value: "den" | "wander" | "chase",
  ): FathomState;
  setPredatorReleased(
    s: ReadState,
    index: number,
    released: boolean,
  ): FathomState;
  setPredatorMind(s: ReadState, index: number, enabled: boolean): FathomState;
  setPredatorTravel(s: ReadState, index: number, enabled: boolean): FathomState;
  spawnDrifter(s: ReadState, tx: number, ty: number): FathomState;
  clearDrifters(s: ReadState): FathomState;
  setDrifterMind(s: ReadState, index: number, enabled: boolean): FathomState;
  setDrifterTravel(s: ReadState, index: number, enabled: boolean): FathomState;
  setDrifterIn(s: ReadState, seconds: number): FathomState;
  setSonarCooldown(s: ReadState, seconds: number): FathomState;
  setInkCooldown(s: ReadState, seconds: number): FathomState;
}
