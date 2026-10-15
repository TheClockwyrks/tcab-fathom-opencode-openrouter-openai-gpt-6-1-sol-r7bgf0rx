import type { Game, UpdateApi } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import type { Direction, FathomDebugApi, FathomState } from "./model";
import { debug, menuItemRect } from "./debug";
import {
  clone,
  fresh,
  initial,
  menuItems,
  reconcile,
  setScreen,
} from "./world";
import { tick } from "./simulation";
import { render, BACKGROUND } from "./render";
export type * from "./model";
export type { PredatorKind } from "./constants";
export { BACKGROUND };

function controls(s: FathomState, api: UpdateApi): FathomState {
  if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());
  s.muted = api.audio.muted();
  const screen = s.screen;
  if (screen === "playing") {
    if (api.input.pressed("pause")) {
      setScreen(s, "paused");
      return s;
    }
    for (const d of ["up", "down", "left", "right"] as Direction[])
      if (api.input.pressed(d)) s.desired = d;
    s.pending.sonar ||= api.input.pressed("a");
    s.pending.ink ||= api.input.pressed("b");
    return s;
  }
  if (
    screen === "paused" &&
    (api.input.pressed("pause") || api.input.pressed("back"))
  ) {
    setScreen(s, "playing");
    return s;
  }
  if (screen === "countdown" || screen === "cleared") return s;
  const items = menuItems(screen);
  let confirm = api.input.pressed("confirm");
  const back = api.input.pressed("back");
  if (items.length) {
    if (api.input.pressed("up"))
      s.menuIndex = ((s.menuIndex ?? 0) + items.length - 1) % items.length;
    if (api.input.pressed("down"))
      s.menuIndex = ((s.menuIndex ?? 0) + 1) % items.length;
  }
  for (const sample of api.input.pointerSamples()) {
    if (!sample.primary) continue;
    const hit = items.findIndex((_, i) => {
      const r = menuItemRect(s, i)!;
      return (
        sample.x >= r.x &&
        sample.x < r.x + r.w &&
        sample.y >= r.y &&
        sample.y < r.y + r.h
      );
    });
    if (hit >= 0) s.menuIndex = hit;
    if (
      sample.type === "down" &&
      (sample.button === "primary" || sample.device === "touch")
    )
      s.pointerStarts[sample.id] = screen === "howto" ? -2 : hit;
    if (sample.type === "up") {
      if (
        s.pointerStarts[sample.id] !== undefined &&
        (screen === "howto" || (hit >= 0 && hit === s.pointerStarts[sample.id]))
      )
        confirm = true;
      delete s.pointerStarts[sample.id];
    }
  }
  if (screen === "howto" && (confirm || back)) return fresh(s, "title");
  if (screen === "gameover" && back) return fresh(s, "title");
  if (!confirm) return s;
  if (screen === "title") {
    s.titleIndex = s.menuIndex ?? 0;
    if (s.menuIndex === 0) return fresh(s, "countdown");
    setScreen(s, "howto");
  } else if (screen === "paused") {
    if (s.menuIndex === 0) setScreen(s, "playing");
    else return fresh(s, s.menuIndex === 1 ? "countdown" : "title");
  } else if (screen === "gameover")
    return fresh(s, s.menuIndex === 0 ? "countdown" : "title");
  return s;
}
export const game: Game<FathomState, FathomDebugApi> = {
  async initialize(api) {
    for (const a of C.ACTIONS)
      api.input.register(a, { keys: [...C.BINDINGS[a]] });
    const sounds = [
      { freq: 760, freqTo: 1150, durationMs: 65, gain: 0.07 },
      { freq: 820, freqTo: 150, durationMs: 420, gain: 0.14 },
      { freq: 90, freqTo: 35, durationMs: 420, gain: 0.18 },
      { freq: 300, freqTo: 650, durationMs: 290, gain: 0.12 },
      { freq: 130, freqTo: 950, durationMs: 480, gain: 0.13 },
      { freq: 170, freqTo: 35, durationMs: 600, gain: 0.2 },
      { freq: 460, freqTo: 1200, durationMs: 650, gain: 0.15 },
    ];
    Object.values(C.CUES).forEach((cue, i) =>
      api.audio.define(cue, {
        ...sounds[i],
        wave: i === 2 ? "triangle" : "sine",
      }),
    );
    for (const field of [
      "screen",
      "depth",
      "score",
      "lives",
      "brightness",
      "visionRadius",
      "windowRadius",
      "planktonRemaining",
    ] as const)
      api.diagnostics.register(field, (s) => s[field]);
    api.diagnostics.register(
      "cooldowns",
      (s) =>
        `sonar ${s.sonar.cooldown.toFixed(2)} / ink ${s.ink.cooldown.toFixed(2)}`,
    );
    api.diagnostics.register(
      "forager",
      (s) => `${s.forager.tx},${s.forager.ty} ${s.forager.dir}`,
    );
    for (let i = 0; i < C.ROSTER_CAP * C.DEN_ORDER.length; i++)
      api.diagnostics.register(`hunter ${i}`, (s) => {
        const p = s.predators[i];
        return p
          ? `${p.kind} ${p.state} ${p.tx},${p.ty} ${p.speed.toFixed(1)} alert:${p.alert}`
          : "-";
      });
    const sheets: Record<string, number> = {
      glimmerfin: 8,
      lanternjaw: 16,
      gloamfin: 8,
      flarefish: 8,
      drifter: 8,
      "flare-bloom": 8,
      "trench-walls": 19,
    };
    const art = Object.fromEntries(
      await Promise.all(
        Object.entries(sheets).map(async ([name, count]) => [
          name,
          await Promise.all(
            Array.from({ length: count }, (_, i) =>
              api.assets.loadImage(`${name}/${i}.png`),
            ),
          ),
        ]),
      ),
    );
    return [initial(art), debug];
  },
  update(state, api, dt) {
    let s = controls(clone(state), api);
    s.accumulator += dt;
    const held = (["up", "down", "left", "right"] as Direction[]).filter(
      (d) => api.input.value(d) > 0,
    );
    while (s.accumulator + 1e-10 >= C.TICK_DT) {
      s.accumulator = Math.max(0, s.accumulator - C.TICK_DT);
      const events = new Set<C.CueName>();
      s = tick(s, { held }, events);
      for (const cue of events) api.audio.play(cue);
    }
    s = reconcile(s);
    return s;
  },
  render,
};
