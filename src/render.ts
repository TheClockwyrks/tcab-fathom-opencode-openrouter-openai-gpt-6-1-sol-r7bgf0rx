import type { RenderApi } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import type { Direction, ReadState } from "./model";
import { menuItemRect } from "./debug";
import { center, distances, menuItems, neighbor, tile } from "./world";
import { distance } from "./simulation";

export const BACKGROUND = "#03090f";
const CYAN = "#7cf9e5",
  DIM = "#698d98",
  WHITE = "#def5ed",
  AMBER = "#ff935a";
const FONT = '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
type Context = CanvasRenderingContext2D;
function text(
  c: Context,
  str: string,
  x: number,
  y: number,
  size = 14,
  color = DIM,
  align: CanvasTextAlign = "left",
): void {
  c.font = `${size}px ${FONT}`;
  c.fillStyle = color;
  c.textAlign = align;
  c.fillText(str, x, y);
}
function line(
  c: Context,
  x: number,
  y: number,
  x2: number,
  y2: number,
  color = "#17313b",
): void {
  c.strokeStyle = color;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x2, y2);
  c.stroke();
}
function circle(
  c: Context,
  x: number,
  y: number,
  r: number,
  color: string,
  width = 1,
): void {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.stroke();
}
function glow(
  c: Context,
  x: number,
  y: number,
  r: number,
  color: string,
): void {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "transparent");
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
}
function sprite(
  c: Context,
  s: ReadState,
  sheet: string,
  frame: number,
  x: number,
  y: number,
  size = C.TILE,
): void {
  const image = s.art[sheet]?.[frame];
  if (image) c.drawImage(image, x - size / 2, y - size / 2, size, size);
}
const facing: Record<Direction, number> = { down: 0, up: 2, left: 4, right: 6 };
function amber(c: Context, x: number, y: number): void {
  glow(c, x, y, 17, "#ff79364a");
  c.fillStyle = AMBER;
  c.beginPath();
  c.arc(x, y, 3, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#ffe3ae";
  c.fillRect(x - 1, y - 1, 2, 2);
}
function terrain(
  c: Context,
  s: ReadState,
  x: number,
  y: number,
  visibility: string,
): void {
  const b = center(x, y),
    t = tile(s, x, y);
  let frame = 16;
  if (t === "#")
    frame =
      (tile(s, x, y - 1) === "#" ? 1 : 0) +
      (tile(s, x + 1, y) === "#" ? 2 : 0) +
      (tile(s, x, y + 1) === "#" ? 4 : 0) +
      (tile(s, x - 1, y) === "#" ? 8 : 0);
  if (t === "g") frame = 18;
  c.globalAlpha = visibility === "r" ? 0.25 : 1;
  sprite(c, s, "trench-walls", frame, b.x, b.y);
  if (s.plankton[y][x] === "*" && t === ".") {
    c.fillStyle = visibility === "r" ? "#82aba7" : "#a1f2cd";
    c.shadowColor = CYAN;
    c.shadowBlur = visibility === "r" ? 0 : 8;
    c.beginPath();
    c.arc(b.x, b.y, C.PLANKTON_DOT / 2, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
  }
  c.globalAlpha = 1;
}
function mazeView(c: Context, s: ReadState): void {
  c.fillStyle = BACKGROUND;
  c.fillRect(
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  const fog = s.art["trench-walls"][17];
  c.drawImage(
    fog,
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  c.save();
  c.beginPath();
  c.arc(s.forager.x, s.forager.y, s.windowRadius, 0, Math.PI * 2);
  c.clip();
  for (let y = 0; y < C.GRID_ROWS; y++)
    for (let x = 0; x < C.GRID_COLS; x++)
      if (s.visibility[y][x] !== "u") terrain(c, s, x, y, s.visibility[y][x]);
  glow(c, s.forager.x, s.forager.y, s.windowRadius, "#2eead50b");
  for (const p of s.predators)
    if (p.kind === "lanternjaw" && p.state !== "den") amber(c, p.x, p.y);
  for (const d of s.drifters) amber(c, d.x, d.y);
  c.restore();
  for (const p of s.predators)
    if (p.flaring) {
      c.save();
      c.beginPath();
      c.arc(p.x, p.y, C.FLARE_RADIUS, 0, Math.PI * 2);
      c.clip();
      for (let y = 0; y < C.GRID_ROWS; y++)
        for (let x = 0; x < C.GRID_COLS; x++)
          if (distance(center(x, y), p) <= C.FLARE_RADIUS)
            terrain(c, s, x, y, "l");
      c.restore();
    }
  c.save();
  c.beginPath();
  c.rect(
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  c.clip();
  for (const cloud of s.inkClouds) {
    glow(c, cloud.x, cloud.y, cloud.radius, "#000009f5");
    circle(c, cloud.x, cloud.y, cloud.radius, "#1d253747");
  }
  for (const pulse of s.pulses) {
    const ds = distances(s, pulse.ox, pulse.oy);
    const color =
      pulse.tint === "cyan"
        ? CYAN
        : pulse.tint === "violet"
          ? "#b598ff"
          : "#ffac65";
    c.strokeStyle = color;
    c.lineWidth = 3;
    c.shadowColor = color;
    c.shadowBlur = 12;
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) {
        const d = ds[y * C.GRID_COLS + x];
        if (d > pulse.range || Math.abs(d - pulse.front) > 1) continue;
        const b = center(x, y);
        c.globalAlpha = Math.max(0, 1 - Math.abs(d - pulse.front));
        for (const dir of ["up", "right", "down", "left"] as Direction[]) {
          const n = neighbor(s, x, y, dir);
          if (!n || ds[n.ty * C.GRID_COLS + n.tx] === Infinity) continue;
          const next = center(n.tx, n.ty);
          if (Math.abs(next.x - b.x) > C.TILE) continue;
          c.beginPath();
          c.moveTo(b.x, b.y);
          c.lineTo((next.x + b.x) / 2, (next.y + b.y) / 2);
          c.stroke();
        }
      }
    c.globalAlpha = 1;
    c.shadowBlur = 0;
  }
  for (const d of s.drifters)
    if (d.lit) sprite(c, s, "drifter", Math.floor(s.simTime * 8) % 8, d.x, d.y);
  for (const p of s.predators) {
    if (p.state === "den") continue;
    if (p.lit) {
      const frame =
        p.kind === "lanternjaw" && p.state === "wander"
          ? 8 + (Math.floor(s.simTime * 8) % 8)
          : facing[p.dir] + (Math.floor(s.simTime * 7) % 2);
      c.globalAlpha =
        p.mark > 0 && !p.alert ? Math.max(0.35, Math.min(1, p.mark / 0.5)) : 1;
      sprite(c, s, p.kind, frame, p.x, p.y);
      c.globalAlpha = 1;
    }
    if (p.alert) {
      const progress = 1 - p.alertLeft / C.ALERT_TIME;
      const color = p.kind === "gloamfin" ? "#b598ff" : AMBER;
      circle(c, p.x, p.y, 18 + progress * 30, color, 2);
      text(c, "!", p.x, p.y - 25, 22, color, "center");
    }
    if (
      p.kind === "flarefish" &&
      (p.flareCharging || p.flaring || p.fade > 0)
    ) {
      const frame = p.flareCharging
        ? Math.min(2, Math.floor((p.flareTime / C.FLARE_CHARGE) * 3))
        : p.flaring
          ? 3 +
            Math.min(
              2,
              Math.floor(((p.flareTime - C.FLARE_CHARGE) / C.FLARE_BLOOM) * 3),
            )
          : p.fade > 0.17
            ? 6
            : 7;
      c.globalCompositeOperation = "screen";
      sprite(c, s, "flare-bloom", frame, p.x, p.y, C.FLARE_RADIUS * 2);
      c.globalCompositeOperation = "source-over";
    }
  }
  glow(c, s.forager.x, s.forager.y, 44, "#58ffd736");
  sprite(
    c,
    s,
    "glimmerfin",
    facing[s.forager.dir] +
      (s.forager.moving ? Math.floor(s.simTime * 9) % 2 : 0),
    s.forager.x,
    s.forager.y,
  );
  c.restore();
  // Sparse registration marks frame the otherwise featureless abyss.
  for (const x of [C.GRID_ORIGIN_X, C.GRID_ORIGIN_X + C.GRID_COLS * C.TILE])
    for (const y of [C.GRID_ORIGIN_Y, C.GRID_ORIGIN_Y + C.GRID_ROWS * C.TILE]) {
      line(c, x, y, x + (x < 640 ? 12 : -12), y);
      line(c, x, y, x, y + (y < 360 ? 12 : -12));
    }
}
function gauge(
  c: Context,
  label: string,
  key: string,
  x: number,
  y: number,
  amount: number,
  color: string,
): void {
  text(c, key, x, y, 12, color);
  text(c, label, x + 60, y, 12, DIM);
  c.fillStyle = "#12232d";
  c.fillRect(x, y + 10, 190, 3);
  c.fillStyle = color;
  c.fillRect(x, y + 10, 190 * Math.max(0, Math.min(1, amount)), 3);
}
function hud(c: Context, s: ReadState): void {
  text(c, C.TITLE_TEXT, 64, 35, 18, CYAN);
  text(c, C.DIVE_LABEL, 64, 57, 10, DIM);
  text(c, String(s.score).padStart(6, "0"), 640, 57, 48, WHITE, "center");
  text(c, "PLANKTON", 1216, 28, 10, DIM, "right");
  text(
    c,
    String(s.planktonRemaining).padStart(3, "0"),
    1216,
    54,
    22,
    CYAN,
    "right",
  );
  line(c, 64, 69, 1216, 69);
  line(c, 64, 667, 1216, 667);
  text(c, `DEPTH ${String(s.depth).padStart(2, "0")}`, 64, 700, 16, WHITE);
  for (let i = 0; i < s.lives; i++)
    sprite(c, s, "glimmerfin", 6, 245 + i * 27, 694, 24);
  gauge(
    c,
    "SONAR",
    "SPACE",
    425,
    690,
    1 - s.sonar.cooldown / C.SONAR_COOLDOWN,
    CYAN,
  );
  gauge(
    c,
    "INK",
    "SHIFT",
    680,
    690,
    1 - s.ink.cooldown / C.INK_COOLDOWN,
    "#b2a5d9",
  );
  text(
    c,
    `P  PAUSE   M  ${s.muted ? "SOUND OFF" : "SOUND ON"}`,
    1216,
    699,
    11,
    DIM,
    "right",
  );
}
function menus(c: Context, s: ReadState): void {
  menuItems(s.screen).forEach((item, i) => {
    const r = menuItemRect(s, i)!;
    const active = s.menuIndex === i;
    c.fillStyle = active ? "#102c31" : "#07121a";
    c.fillRect(r.x, r.y, r.w, r.h);
    c.strokeStyle = active ? "#4dbaaa" : "#18303a";
    c.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    text(c, active ? ">" : "·", r.x + 18, r.y + 32, 18, active ? CYAN : DIM);
    text(c, item, r.x + 53, r.y + 32, 17, active ? WHITE : DIM);
    if (active) text(c, "↵", r.x + r.w - 20, r.y + 31, 18, CYAN, "right");
  });
}
function title(c: Context, s: ReadState): void {
  const x = 911,
    y = 344;
  glow(c, x, y, 355, "#0a536b35");
  for (let i = 0; i < 80; i++) {
    const px = (i * 157 + 47) % C.STAGE_W,
      py = (i * 83 + 29) % C.STAGE_H;
    c.fillStyle = i % 5 === 0 ? "#377b784b" : "#23445250";
    c.fillRect(px, py, 1 + (i % 2), 1 + (i % 2));
  }
  c.save();
  c.beginPath();
  c.arc(x, y, 233, 0, Math.PI * 2);
  c.clip();
  for (let ty = 0; ty < C.GRID_ROWS; ty++)
    for (let tx = 0; tx < C.GRID_COLS; tx++) {
      const pos = center(tx, ty);
      if (distance(pos, { x, y }) < 233)
        terrain(c, s, tx, ty, distance(pos, { x, y }) < 120 ? "l" : "r");
    }
  glow(c, x, y, 235, "#36d5b018");
  c.restore();
  for (const r of [116, 176, 237]) circle(c, x, y, r, "#3aa7a22f");
  circle(c, x, y, 245, "#3aa7a23a");
  line(c, x - 268, y, x - 248, y, "#3aa7a2");
  line(c, x + 248, y, x + 268, y, "#3aa7a2");
  line(c, x, y - 268, x, y - 248, "#3aa7a2");
  line(c, x, y + 248, x, y + 268, "#3aa7a2");
  glow(c, x, y, 65, "#55ffcc45");
  sprite(c, s, "glimmerfin", 6 + (Math.floor(s.simTime * 4) % 2), x, y, 64);
  amber(c, 1039, 280);
  amber(c, 813, 438);
  sprite(c, s, "gloamfin", 4, 948, 193, 40);
  text(c, "SIGNAL / UNKNOWN", x, 620, 11, DIM, "center");
  text(c, "36° N  /  NO DAYLIGHT", x, 641, 10, "#3c616f", "center");
  text(
    c,
    "A B I O L U M I N E S C E N T   M A Z E   C H A S E",
    140,
    180,
    11,
    DIM,
  );
  c.shadowColor = "#60dfcd";
  c.shadowBlur = 24;
  text(c, C.TITLE_TEXT, 133, 291, 102, WHITE);
  c.shadowBlur = 0;
  text(c, C.TAGLINE_TEXT.split("").join(" "), 140, 333, 15, CYAN);
  text(c, "A little light. A long way down.", 140, 383, 15, DIM);
  menus(c, s);
  text(c, "↑ ↓  SELECT     ENTER  DIVE", 140, 584, 11, DIM);
  text(c, `01 / ${C.DIVE_LABEL}`, 64, 55, 12, CYAN);
  text(c, "THE ABYSS IS LISTENING", 1216, 55, 11, DIM, "right");
  line(c, 64, 78, 1216, 78);
  line(c, 64, 665, 1216, 665);
  text(c, "GO QUIETLY. GLOW CAREFULLY.", 64, 698, 11, DIM);
  text(
    c,
    `M  ${s.muted ? "SOUND OFF" : "SOUND ON"}`,
    1216,
    698,
    11,
    DIM,
    "right",
  );
}
function howto(c: Context, s: ReadState): void {
  text(c, "FIELD GUIDE / 01", 80, 70, 13, CYAN);
  text(c, "SURVIVE YOUR OWN LIGHT.", 80, 132, 40, WHITE);
  line(c, 80, 164, 1200, 164);
  text(c, "FIND YOUR WAY", 80, 214, 16, CYAN);
  [
    "Arrow keys / WASD — swim. Release to stop.",
    "Eat every plankton mote to descend. Eating grows",
    "your window into the dark — and makes you easier to hunt.",
    "Your light stops at rock. Explored paths stay in memory,",
    "but disappear beyond your circular window.",
  ].forEach((t, i) => text(c, t, 80, 247 + i * 27, 15, WHITE));
  text(c, "MAKE SOME NOISE. THEN DISAPPEAR.", 80, 421, 16, CYAN);
  [
    "SPACE — sonar. Follow its crest around corners.",
    "It maps passages and marks hunters, but sound cuts both ways.",
    "SHIFT — ink. Break a light-hunter's fix for a quick escape.",
    "P / ESC — pause.    M — toggle sound.",
  ].forEach((t, i) => text(c, t, 80, 454 + i * 27, 15, WHITE));
  const creatures = [
    {
      kind: "lanternjaw",
      title: "LANTERNJAW",
      copy: [
        "Follows your light.",
        "An amber glimmer could be dinner.",
        "Or teeth.",
      ],
    },
    {
      kind: "gloamfin",
      title: "GLOAMFIN",
      copy: [
        "Hears through rock and ink.",
        "Your sonar gives you away.",
        "Turn corners to shake its speed.",
      ],
    },
    {
      kind: "flarefish",
      title: "FLAREFISH",
      copy: [
        "Hunts light. Casts a blinding flare.",
        "Its bloom sees through stone.",
        "Leave before the charge breaks.",
      ],
    },
  ];
  creatures.forEach((p, i) => {
    const y = 215 + i * 135;
    sprite(c, s, p.kind, 6, 835, y, 48);
    text(c, p.title, 880, y - 6, 16, i === 1 ? "#b598ff" : AMBER);
    p.copy.forEach((t, j) => text(c, t, 810, y + 37 + j * 21, 12, DIM));
  });
  line(c, 80, 630, 1200, 630);
  text(
    c,
    "ENTER / ESC / TAP ANYWHERE  —  BACK TO THE SURFACE",
    640,
    676,
    13,
    CYAN,
    "center",
  );
}
export function render(s: ReadState, api: RenderApi): void {
  const c = api.ctx;
  c.save();
  c.imageSmoothingEnabled = false;
  c.fillStyle = BACKGROUND;
  c.fillRect(0, 0, C.STAGE_W, C.STAGE_H);
  if (s.screen === "title") title(c, s);
  else if (s.screen === "howto") howto(c, s);
  else {
    mazeView(c, s);
    if (s.screen !== "gameover") hud(c, s);
    if (s.screen === "paused" || s.screen === "gameover") {
      c.fillStyle = "#030910d9";
      c.fillRect(0, 80, C.STAGE_W, 576);
      text(
        c,
        s.screen === "paused" ? "HOLD YOUR BREATH" : "THE DARK TAKES ITS DUE",
        640,
        233,
        14,
        CYAN,
        "center",
      );
      text(
        c,
        s.screen === "paused" ? "PAUSED" : "DIVE ENDED",
        640,
        295,
        52,
        WHITE,
        "center",
      );
      if (s.screen === "gameover")
        text(
          c,
          `${String(s.score).padStart(6, "0")} POINTS   /   DEPTH ${s.depth}`,
          640,
          325,
          15,
          DIM,
          "center",
        );
      menus(c, s);
    } else if (s.screen === "countdown" || s.screen === "cleared") {
      c.fillStyle = "#030910cf";
      c.fillRect(400, 255, 480, 170);
      line(c, 440, 255, 840, 255, "#326961");
      text(
        c,
        s.screen === "cleared" ? `DEPTH ${s.depth} CLEARED` : C.TITLE_ITEMS[0],
        640,
        315,
        32,
        WHITE,
        "center",
      );
      text(
        c,
        s.screen === "cleared"
          ? `+${C.SCORE_CLEAR}  /  DESCENDING`
          : `${Math.max(1, Math.ceil(2 - s.screenTime))}  /  INTO THE ABYSS`,
        640,
        368,
        18,
        CYAN,
        "center",
      );
    }
  }
  c.restore();
}
