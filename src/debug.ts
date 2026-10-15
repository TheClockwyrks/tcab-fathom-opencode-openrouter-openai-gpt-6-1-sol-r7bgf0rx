import * as C from "./constants";
import type {
  Direction,
  FathomDebugApi,
  FathomState,
  Predator,
  ReadState,
  Rect,
  Screen,
  Snapshot,
} from "./model";
import {
  center,
  clone,
  initial,
  layer,
  menuItems,
  open,
  predator,
  put,
  reconcile,
  roster,
  setScreen,
  tile,
} from "./world";

function assert(valid: boolean, message: string): asserts valid {
  if (!valid) throw new RangeError(`Fathom: ${message}`);
}
function number(n: number, min = 0, max = Infinity, integer = false): void {
  assert(
    Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (!integer || Number.isInteger(n)),
    `invalid number ${n}`,
  );
}
function direction(d: Direction): void {
  assert(["up", "down", "left", "right"].includes(d), "invalid direction");
}
function position(s: ReadState, x: number, y: number, den = false): void {
  number(x, 0, C.GRID_COLS - 1, true);
  number(y, 0, C.GRID_ROWS - 1, true);
  assert(open(s, x, y, den), "tile is closed");
}
function pose(s: ReadState, fn: (n: FathomState) => void): FathomState {
  const n = clone(s);
  fn(n);
  return reconcile(n);
}
function hunter(
  s: ReadState,
  index: number,
  fn: (p: Predator, n: FathomState) => void,
): FathomState {
  number(index, 0, s.predators.length - 1, true);
  return pose(s, (n) => fn(n.predators[index], n));
}
function drifter(
  s: ReadState,
  index: number,
  key: "mind" | "travel",
  enabled: boolean,
): FathomState {
  number(index, 0, s.drifters.length - 1, true);
  assert(typeof enabled === "boolean", "invalid boolean");
  return pose(s, (n) => {
    n.drifters[index][key] = enabled;
  });
}
export function menuItemRect(s: ReadState, index: number): Rect | null {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= menuItems(s.screen).length
  )
    return null;
  return {
    x: s.screen === "title" ? 140 : 460,
    y: (s.screen === "title" ? 430 : 350) + index * 62,
    w: 360,
    h: 50,
  };
}
export function snapshot(s: ReadState): Snapshot {
  const n = reconcile(s);
  return {
    version: n.version,
    screen: n.screen,
    menuIndex: n.menuIndex,
    titleIndex: n.titleIndex,
    depth: n.depth,
    score: n.score,
    lives: n.lives,
    muted: n.muted,
    planktonRemaining: n.planktonRemaining,
    drifterIn: n.drifterIn,
    brightness: n.brightness,
    brightHold: n.brightHold,
    visionRadius: n.visionRadius,
    windowRadius: n.windowRadius,
    sonar: n.sonar,
    ink: n.ink,
    grid: n.grid,
    tiles: n.tiles,
    plankton: n.plankton,
    visibility: n.visibility,
    forager: n.forager,
    drifters: n.drifters.map((d) => ({
      x: d.x,
      y: d.y,
      tx: d.tx,
      ty: d.ty,
      lit: d.lit,
      mind: d.mind,
      travel: d.travel,
    })),
    predators: n.predators.map((p) => ({
      kind: p.kind,
      x: p.x,
      y: p.y,
      tx: p.tx,
      ty: p.ty,
      dir: p.dir,
      state: p.state,
      released: p.released,
      mind: p.mind,
      travel: p.travel,
      speed: p.speed,
      alert: p.alert,
      lit: p.lit,
      detectRange: p.detectRange,
      hearingRange: p.hearingRange,
      hearingLock: p.hearingLock,
      flareCharging: p.flareCharging,
      flaring: p.flaring,
      flareRadius: p.flareRadius,
    })),
    pulses: n.pulses.map((p) => ({
      source: p.source,
      tint: p.tint,
      ox: p.ox,
      oy: p.oy,
      front: p.front,
      range: p.range,
    })),
    inkClouds: n.inkClouds,
    simTime: n.simTime,
  };
}
export const debug: FathomDebugApi = {
  version: C.FATHOM_DEBUG_VERSION,
  reset: (s) => initial(clone(s).art, s.muted),
  snapshot,
  reconcile,
  menuItemRect,
  setScreen: (s, screen) => {
    assert(
      [
        "title",
        "howto",
        "countdown",
        "playing",
        "paused",
        "cleared",
        "gameover",
      ].includes(screen),
      "invalid screen",
    );
    return pose(s, (n) => setScreen(n, screen as Screen));
  },
  setMenuIndex: (s, i) => {
    number(i, 0, menuItems(s.screen).length - 1, true);
    return pose(s, (n) => {
      n.menuIndex = i;
    });
  },
  setTitleIndex: (s, i) => {
    number(i, 0, C.TITLE_ITEMS.length - 1, true);
    return pose(s, (n) => {
      n.titleIndex = i;
    });
  },
  setScore: (s, v) => {
    number(v, 0, Infinity, true);
    return pose(s, (n) => {
      n.score = v;
    });
  },
  setLives: (s, v) => {
    number(v, 0, Infinity, true);
    return pose(s, (n) => {
      n.lives = v;
    });
  },
  setDepth: (s, v) => {
    number(v, 1, Infinity, true);
    return pose(s, (n) => {
      n.depth = v;
      n.predators = roster(n, v);
    });
  },
  setMaze: (s, rows) => {
    assert(
      rows.length === C.GRID_ROWS &&
        rows.every((r) => r.length === C.GRID_COLS && /^[#.gd]+$/.test(r)),
      "invalid maze",
    );
    const g = rows.join("").split("g").length - 1;
    assert(
      !rows.some((r) => /[dg]/.test(r)) || g === 1,
      "maze needs exactly one gate",
    );
    return pose(s, (n) => {
      n.tiles = [...rows];
    });
  },
  setPlankton: (s, x, y, present) => {
    position(s, x, y);
    assert(typeof present === "boolean", "invalid boolean");
    return pose(s, (n) => put(n.plankton, x, y, present ? "*" : "-"));
  },
  clearPlankton: (s) =>
    pose(s, (n) => {
      n.plankton = layer("-");
    }),
  clearFog: (s) =>
    pose(s, (n) => {
      n.visibility = layer("u");
    }),
  setForagerTile: (s, x, y) => {
    position(s, x, y);
    return pose(s, (n) => {
      Object.assign(n.forager, center(x, y), { moving: false });
    });
  },
  setForagerDir: (s, d) => {
    direction(d);
    return pose(s, (n) => {
      n.forager.dir = d;
      n.forager.moving = false;
      n.desired = d;
    });
  },
  setBrightness: (s, v) => {
    number(v, 0, 1);
    return pose(s, (n) => {
      n.brightness = v;
    });
  },
  setBrightHold: (s, v) => {
    number(v, 0, C.BRIGHT_HOLD);
    return pose(s, (n) => {
      n.brightHold = v;
    });
  },
  clearPredators: (s) =>
    pose(s, (n) => {
      n.predators = [];
    }),
  addPredator: (s, kind, x, y) => {
    assert(C.DEN_ORDER.includes(kind), "invalid predator kind");
    position(s, x, y);
    return pose(s, (n) => {
      n.predators.push(predator(kind, x, y, null));
    });
  },
  setPredatorTile: (s, i, x, y) => {
    position(s, x, y, true);
    return hunter(s, i, (p) => Object.assign(p, center(x, y)));
  },
  setPredatorDir: (s, i, d) => {
    direction(d);
    return hunter(s, i, (p) => {
      p.dir = d;
    });
  },
  setPredatorState: (s, i, value) => {
    assert(
      ["den", "wander", "chase"].includes(value),
      "invalid predator state",
    );
    return hunter(s, i, (p, n) => {
      assert(
        value === "den"
          ? ["d", "g"].includes(tile(n, p.tx, p.ty))
          : tile(n, p.tx, p.ty) === ".",
        "predator on invalid tile for state",
      );
      p.state = value;
      p.fix = value === "chase" ? { tx: n.forager.tx, ty: n.forager.ty } : null;
      p.linger = value === "chase" ? C.LINGER_TIME : 0;
      p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
      p.alert = false;
      p.alertLeft = 0;
      p.hearingLock = p.kind === "gloamfin" ? false : null;
      if (p.kind === "flarefish") {
        p.flareIn = C.FLARE_INTERVAL;
        p.flareTime = 0;
        p.flaring = false;
        p.flareCharging = false;
        p.flareRadius = 0;
      }
    });
  },
  setPredatorReleased: (s, i, v) => {
    assert(typeof v === "boolean", "invalid boolean");
    return hunter(s, i, (p) => {
      p.released = v;
    });
  },
  setPredatorMind: (s, i, v) => {
    assert(typeof v === "boolean", "invalid boolean");
    return hunter(s, i, (p) => {
      p.mind = v;
    });
  },
  setPredatorTravel: (s, i, v) => {
    assert(typeof v === "boolean", "invalid boolean");
    return hunter(s, i, (p) => {
      p.travel = v;
    });
  },
  spawnDrifter: (s, x, y) => {
    position(s, x, y);
    return pose(s, (n) => {
      n.drifters.push({
        ...center(x, y),
        dir: "up",
        lit: false,
        mind: true,
        travel: true,
      });
    });
  },
  clearDrifters: (s) =>
    pose(s, (n) => {
      n.drifters = [];
    }),
  setDrifterMind: (s, i, v) => drifter(s, i, "mind", v),
  setDrifterTravel: (s, i, v) => drifter(s, i, "travel", v),
  setDrifterIn: (s, v) => {
    number(v, 0, C.DRIFTER_INTERVAL);
    return pose(s, (n) => {
      n.drifterIn = v;
    });
  },
  setSonarCooldown: (s, v) => {
    number(v);
    return pose(s, (n) => {
      n.sonar.cooldown = v;
    });
  },
  setInkCooldown: (s, v) => {
    number(v);
    return pose(s, (n) => {
      n.ink.cooldown = v;
    });
  },
};
