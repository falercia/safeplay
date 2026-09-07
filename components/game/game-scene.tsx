"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Arena Nimbus · simulação visual de um RPG cooperativo (canvas 2D).
 * Personagens, inimigos, itens e bordas: Kenney (CC0). Cenário, luz e partículas: desenhados em código.
 * Não é jogável: os heróis agem sozinhos. A cena é neutra e NÃO reage ao risco do chat.
 */
export interface GamePlayer {
  id: string;
  name: string;
  isMe: boolean;
  online: boolean;
  typing: boolean;
  bubble?: { text: string; at: number } | null;
  /** A = quem criou o mundo (aventureira), B = quem entrou depois (aventureiro) */
  slot: "A" | "B";
}

interface Props {
  players: GamePlayer[];
  roomName: string;
  className?: string;
  lite?: boolean;
  /** cenário de fundo para menus: sem HUD, etiquetas, balões e contador de fps */
  backdrop?: boolean;
}

type Vec = { x: number; y: number };
type Pose = "idle" | "run0" | "run1" | "run2" | "attack0" | "attack1" | "attack2" | "hit" | "cheer0" | "cheer1" | "jump";

const HERO_KEYS = { A: "femaleAdventurer", B: "maleAdventurer" } as const;
const HERO_POSES: Pose[] = ["idle", "run0", "run1", "run2", "attack0", "attack1", "attack2", "hit", "cheer0", "cheer1", "jump"];
const BOSS_POSES = ["idle", "attack0", "attack1", "hit", "walk0", "walk1", "fall"] as const;
const ENEMY_SPRITES = ["bat", "bat_fly", "bat_hit", "ghost", "ghost_normal", "ghost_dead", "slimeWalk1", "slimeWalk2", "slimeDead", "fireball"] as const;
const ITEM_SPRITES = ["gemBlue", "gemGreen", "gemRed", "gemYellow", "coinGold", "bush", "rock", "mushroomRed", "plant", "bg_tree03", "bg_tree05", "bg_tree08", "bg_tree12", "bg_tree19", "bg_tree22", "bg_tree27", "bg_tower_grey", "bg_castle_grey", "bg_temple", "bg_cloud1", "bg_cloud2", "bg_cloud3", "bg_moon_full", "bg_grass1", "bg_grass3", "bg_grass5"] as const;

interface Assets {
  heroes: Record<"A" | "B", Partial<Record<Pose, HTMLImageElement>>>;
  boss: Partial<Record<(typeof BOSS_POSES)[number], HTMLImageElement>>;
  enemies: Partial<Record<(typeof ENEMY_SPRITES)[number], HTMLImageElement>>;
  items: Partial<Record<(typeof ITEM_SPRITES)[number], HTMLImageElement>>;
  ready: boolean;
}

interface Hero {
  slot: "A" | "B";
  x: number; // 0..1 (mundo)
  baseY: number;
  hp: number;
  mp: number;
  state: "idle" | "run" | "attack" | "hit" | "cheer";
  stateT: number;
  targetX: number;
  face: 1 | -1;
  cooldown: number;
  anim: number;
}
interface Enemy {
  kind: "bat" | "ghost" | "slime";
  x: number;
  y: number;
  hp: number;
  t: number;
  dead: number; // >0 morrendo
  seed: number;
}
interface Boss {
  x: number;
  hp: number;
  phase: "idle" | "attack" | "hit" | "dying" | "gone";
  t: number;
  timer: number;
}
interface Fx {
  kind: "text" | "ring" | "spark" | "loot";
  p: Vec;
  v?: Vec;
  t: number;
  max: number;
  text?: string;
  color: string;
  size?: number;
  sprite?: HTMLImageElement | undefined;
}

interface Sim {
  time: number;
  heroes: Hero[];
  enemies: Enemy[];
  boss: Boss;
  fx: Fx[];
  camera: number; // deslocamento -1..1
  gems: number;
  coins: number;
  kills: number;
  wave: number;
  spawnT: number;
  skillCd: number[];
  banner: { text: string; t: number } | null;
}

const COLORS = {
  A: { main: "#17c3b2", light: "#8fe8de", glow: "rgba(23,195,178,0.55)" },
  B: { main: "#f2801e", light: "#fbc38f", glow: "rgba(242,128,30,0.55)" },
};

export function GameScene({ players, roomName, className, lite = false, backdrop = false }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const playersRef = React.useRef(players);
  playersRef.current = players;
  const [fps, setFps] = React.useState(0);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const maybeCtx = canvas.getContext("2d");
    if (!maybeCtx) return;
    const ctx: CanvasRenderingContext2D = maybeCtx;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const assets: Assets = { heroes: { A: {}, B: {} }, boss: {}, enemies: {}, items: {}, ready: false };
    let cancelled = false;
    void loadAssets(assets).then(() => {
      if (cancelled) return;
      assets.ready = true;
      setLoaded(true);
    });

    const sim: Sim = {
      time: 0,
      heroes: [
        { slot: "A", x: 0.22, baseY: 0.8, hp: 0.9, mp: 0.7, state: "idle", stateT: 0, targetX: 0.22, face: 1, cooldown: 1.5, anim: 0 },
        { slot: "B", x: 0.34, baseY: 0.86, hp: 0.8, mp: 0.6, state: "idle", stateT: 0, targetX: 0.34, face: 1, cooldown: 2.5, anim: 1.3 },
      ],
      enemies: [],
      boss: { x: 0.78, hp: 1, phase: "idle", t: 0, timer: 4 },
      fx: [],
      camera: 0,
      gems: 12,
      coins: 340,
      kills: 0,
      wave: 1,
      spawnT: 1.5,
      skillCd: [0, 0, 0, 0],
      banner: { text: "Dungeon do Vulcão · Onda 1", t: 0 },
    };

    let W = 0;
    let H = 0;
    let dpr = 1;
    let bg: HTMLCanvasElement | null = null;
    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let fpsAcc = 0;
    let running = true;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, lite ? 1.5 : 2);
      W = Math.max(1, Math.floor(rect.width));
      H = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bg = buildSky(W, H, dpr);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const onVis = () => {
      running = document.visibilityState === "visible";
      if (running) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    function frame(now: number) {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      frames++;
      fpsAcc += dt;
      if (fpsAcc >= 1) {
        setFps(frames);
        frames = 0;
        fpsAcc = 0;
      }
      update(sim, dt, reduced ? 0.4 : 1, lite, assets);
      draw(ctx, sim, W, H, bg, assets, playersRef.current, roomName, lite, now, backdrop);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [roomName, lite, backdrop]);

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-[#0a1230]", className)} role="img" aria-label={`Simulação visual do jogo ${roomName}. Não é interativa.`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
      {!loaded ? <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60">Carregando o mundo…</div> : null}
      {backdrop ? null : <div className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/40 px-2 py-0.5 font-mono text-[10px] text-white/50">{fps} fps · simulação</div>}
    </div>
  );
}

/* ---------------------------------- assets ---------------------------------- */

function img(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = src;
  });
}

async function loadAssets(a: Assets): Promise<void> {
  const tasks: Promise<void>[] = [];
  for (const slot of ["A", "B"] as const) {
    for (const pose of HERO_POSES) tasks.push(img(`/game/chars/${HERO_KEYS[slot]}_${pose}.png`).then((i) => void (i && (a.heroes[slot][pose] = i))));
  }
  for (const pose of BOSS_POSES) tasks.push(img(`/game/chars/robot_${pose}.png`).then((i) => void (i && (a.boss[pose] = i))));
  for (const e of ENEMY_SPRITES) tasks.push(img(`/game/enemies/${e}.png`).then((i) => void (i && (a.enemies[e] = i))));
  for (const it of ITEM_SPRITES) tasks.push(img(`/game/items/${it}.png`).then((i) => void (i && (a.items[it] = i))));
  await Promise.all(tasks);
}

const tintCache = new Map<string, HTMLCanvasElement>();
/** Cópia do sprite tingida (para profundidade/entardecer). */
function tinted(image: HTMLImageElement, color: string, alpha: number, key: string): HTMLCanvasElement {
  const k = `${key}:${color}:${alpha}`;
  const hit = tintCache.get(k);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = image.width;
  c.height = image.height;
  const g = c.getContext("2d");
  if (g) {
    g.drawImage(image, 0, 0);
    g.globalCompositeOperation = "source-atop";
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
  }
  tintCache.set(k, c);
  return c;
}

/* ---------------------------------- simulação ---------------------------------- */

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function update(sim: Sim, dt: number, motion: number, lite: boolean, assets: Assets): void {
  sim.time += dt;
  sim.camera = Math.sin(sim.time * 0.12) * motion;
  if (sim.banner) {
    sim.banner.t += dt;
    if (sim.banner.t > 3.5) sim.banner = null;
  }

  // ondas de inimigos
  sim.spawnT -= dt * motion;
  const alive = sim.enemies.filter((e) => e.dead === 0).length;
  if (sim.spawnT <= 0 && alive < (lite ? 2 : 3) && sim.boss.phase !== "dying") {
    sim.spawnT = rand(2.5, 5);
    const kinds: Enemy["kind"][] = ["bat", "ghost", "slime"];
    const kind = kinds[Math.floor(Math.random() * kinds.length)]!;
    sim.enemies.push({ kind, x: rand(0.62, 0.9), y: kind === "slime" ? 0.86 : rand(0.45, 0.62), hp: kind === "slime" ? 3 : 2, t: 0, dead: 0, seed: Math.random() * 10 });
  }
  for (const e of sim.enemies) {
    e.t += dt * motion;
    if (e.dead > 0) {
      e.dead += dt;
      continue;
    }
    if (e.kind === "slime") e.x -= dt * 0.012 * motion;
    else {
      e.x -= dt * 0.006 * motion;
      e.y += Math.sin(e.t * 2 + e.seed) * dt * 0.02;
    }
    if (e.x < 0.42) e.x = 0.42;
  }
  sim.enemies = sim.enemies.filter((e) => e.dead < 0.9);

  // heróis
  for (const h of sim.heroes) {
    h.anim += dt * motion;
    h.stateT += dt;
    h.cooldown -= dt * motion;
    h.mp = Math.min(1, h.mp + dt * 0.02);
    h.hp = Math.min(1, h.hp + dt * 0.008);
    if (h.state === "attack" && h.stateT > 0.55) h.state = "idle";
    if (h.state === "hit" && h.stateT > 0.4) h.state = "idle";
    if (h.state === "cheer" && h.stateT > 1.6) h.state = "idle";
    if (h.state === "run") {
      const dir = Math.sign(h.targetX - h.x) as 1 | -1 | 0;
      if (dir !== 0) h.face = dir;
      h.x += dir * dt * 0.08 * motion;
      if (Math.abs(h.targetX - h.x) < 0.01) {
        h.x = h.targetX;
        h.state = "idle";
        h.stateT = 0;
      }
    }
    if (h.state === "idle" && h.cooldown <= 0) {
      // escolhe alvo: inimigo vivo mais próximo ou o chefe
      const target = sim.enemies.filter((e) => e.dead === 0).sort((p, q) => Math.abs(p.x - h.x) - Math.abs(q.x - h.x))[0];
      const bossAlive = sim.boss.phase !== "dying" && sim.boss.phase !== "gone";
      if (target || bossAlive) {
        const tx = target ? target.x - (h.slot === "A" ? 0.06 : 0.09) : sim.boss.x - (h.slot === "A" ? 0.12 : 0.16);
        if (Math.abs(tx - h.x) > 0.03 && Math.random() < 0.7) {
          h.targetX = Math.max(0.12, Math.min(0.66, tx));
          h.state = "run";
          h.stateT = 0;
          h.cooldown = 0.2;
        } else {
          h.state = "attack";
          h.stateT = 0;
          h.face = 1;
          h.cooldown = h.slot === "A" ? rand(1.2, 2) : rand(1.6, 2.6);
          if (h.slot === "B") h.mp = Math.max(0, h.mp - 0.15);
          // aplica dano após um pequeno atraso (no meio da animação)
          const dmg = h.slot === "A" ? rand(60, 120) : rand(90, 180);
          const color = COLORS[h.slot].light;
          sim.fx.push({ kind: "spark", p: { x: h.x + 0.05 * h.face, y: h.baseY - 0.16 }, t: -0.25, max: 0.5, color });
          if (target && Math.abs(target.x - h.x) < 0.14) {
            target.hp -= 1;
            sim.fx.push({ kind: "text", p: { x: target.x, y: target.y - 0.06 }, t: -0.25, max: 1.2, text: `${Math.round(dmg)}`, color });
            if (target.hp <= 0) {
              target.dead = 0.01;
              sim.kills++;
              sim.fx.push({ kind: "loot", p: { x: target.x, y: target.y }, v: { x: rand(-0.05, 0.05), y: -0.25 }, t: 0, max: 1.4, color, sprite: Math.random() < 0.5 ? assets.items.coinGold : assets.items.gemBlue });
              if (Math.random() < 0.5) sim.coins += 15;
              else sim.gems += 1;
              if (sim.kills % 6 === 0) {
                sim.wave++;
                sim.banner = { text: `Onda ${sim.wave} · continuem juntos`, t: 0 };
                for (const hh of sim.heroes) {
                  hh.state = "cheer";
                  hh.stateT = 0;
                }
              }
            }
          } else if (bossAlive && Math.abs(sim.boss.x - h.x) < 0.22) {
            const d = h.slot === "A" ? 0.035 : 0.055;
            sim.boss.hp = Math.max(0, sim.boss.hp - d);
            sim.boss.phase = "hit";
            sim.boss.t = 0;
            sim.fx.push({ kind: "text", p: { x: sim.boss.x - 0.02, y: 0.52 }, t: -0.25, max: 1.2, text: `${Math.round(dmg * 1.6)}`, color });
            sim.fx.push({ kind: "ring", p: { x: sim.boss.x, y: 0.72 }, t: 0, max: 0.6, color });
            if (sim.boss.hp <= 0) {
              sim.boss.phase = "dying";
              sim.boss.t = 0;
              sim.banner = { text: "Sentinela derrotada! Tesouro liberado", t: 0 };
              for (let i = 0; i < 6; i++) sim.fx.push({ kind: "loot", p: { x: sim.boss.x + rand(-0.05, 0.05), y: 0.6 }, v: { x: rand(-0.12, 0.12), y: rand(-0.35, -0.15) }, t: 0, max: 1.6, color: "#fde68a", sprite: [assets.items.gemRed, assets.items.gemYellow, assets.items.gemGreen, assets.items.coinGold][i % 4] });
              sim.gems += 5;
              sim.coins += 120;
              for (const hh of sim.heroes) {
                hh.state = "cheer";
                hh.stateT = 0;
              }
            }
          }
        }
      }
    }
  }

  // chefe
  const b = sim.boss;
  b.t += dt * motion;
  b.timer -= dt * motion;
  if (b.phase === "hit" && b.t > 0.35) b.phase = "idle";
  if (b.phase === "attack" && b.t > 0.7) b.phase = "idle";
  if (b.phase === "idle" && b.timer <= 0) {
    b.timer = rand(4, 7);
    b.phase = "attack";
    b.t = 0;
    const target = sim.heroes[Math.floor(Math.random() * sim.heroes.length)]!;
    target.hp = Math.max(0.3, target.hp - rand(0.08, 0.16));
    target.state = "hit";
    target.stateT = 0;
    sim.fx.push({ kind: "text", p: { x: target.x, y: target.baseY - 0.3 }, t: 0.2, max: 1.2, text: `-${Math.round(rand(70, 160))}`, color: "#f87171" });
    sim.fx.push({ kind: "spark", p: { x: target.x, y: target.baseY - 0.15 }, t: 0.2, max: 0.5, color: "#fca5a5" });
  }
  if (b.phase === "dying" && b.t > 2.2) {
    b.phase = "gone";
    b.timer = 6;
  }
  if (b.phase === "gone" && b.timer <= 0) {
    b.phase = "idle";
    b.hp = 1;
    b.timer = 5;
    sim.banner = { text: "Uma nova Sentinela se aproxima", t: 0 };
  }

  // efeitos
  for (const f of sim.fx) {
    f.t += dt;
    if (f.kind === "loot" && f.v) {
      f.p.x += f.v.x * dt;
      f.p.y += f.v.y * dt;
      f.v.y += 0.6 * dt;
      if (f.p.y > 0.9) {
        f.p.y = 0.9;
        f.v.y *= -0.35;
      }
    }
  }
  sim.fx = sim.fx.filter((f) => f.t < f.max);
  sim.skillCd = sim.skillCd.map((c, i) => (c <= 0 ? (Math.random() < 0.003 ? [4, 7, 12, 20][i]! : 0) : c - dt));
}

/* ---------------------------------- desenho ---------------------------------- */

function buildSky(W: number, H: number, dpr: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.floor(W * dpr);
  c.height = Math.floor(H * dpr);
  const g = c.getContext("2d");
  if (!g) return c;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#070f2b");
  sky.addColorStop(0.4, "#132a63");
  sky.addColorStop(0.68, "#4a3170");
  sky.addColorStop(0.82, "#9a4a3a");
  sky.addColorStop(1, "#c46a3a");
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(255,255,255,${rand(0.2, 0.9)})`;
    g.beginPath();
    g.arc(Math.random() * W, Math.random() * H * 0.55, Math.random() * 1.4 + 0.2, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

function draw(ctx: CanvasRenderingContext2D, sim: Sim, W: number, H: number, bg: HTMLCanvasElement | null, a: Assets, players: GamePlayer[], roomName: string, lite: boolean, now: number, backdrop = false): void {
  ctx.clearRect(0, 0, W, H);
  if (bg) ctx.drawImage(bg, 0, 0, W, H);
  const cam = sim.camera; // -1..1
  const horizon = H * 0.72;
  const s = Math.max(0.45, Math.min(1, Math.min(W / 1200, H / 720)));

  // lua e nuvens (camada mais distante)
  if (a.items.bg_moon_full) {
    const m = a.items.bg_moon_full;
    const mw = 90 * s;
    ctx.globalAlpha = 0.95;
    ctx.drawImage(m, W * 0.8 - cam * W * 0.01, H * 0.12, mw, mw);
    const glow = ctx.createRadialGradient(W * 0.8 + mw / 2, H * 0.12 + mw / 2, mw * 0.4, W * 0.8 + mw / 2, H * 0.12 + mw / 2, mw * 2.2);
    glow.addColorStop(0, "rgba(255,240,200,0.25)");
    glow.addColorStop(1, "rgba(255,240,200,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H * 0.6);
    ctx.globalAlpha = 1;
  }
  const clouds = [a.items.bg_cloud1, a.items.bg_cloud2, a.items.bg_cloud3];
  for (let i = 0; i < 5; i++) {
    const c = clouds[i % 3];
    if (!c) continue;
    const speed = 0.004 + i * 0.002;
    const x = (((i * 0.23 + sim.time * speed) % 1.3) - 0.15) * W - cam * W * 0.02 * (i + 1);
    const y = H * (0.12 + i * 0.07);
    const w = (160 + i * 40) * s;
    ctx.globalAlpha = 0.18 + i * 0.03;
    ctx.drawImage(tinted(c, "#1a2a5a", 0.85, `cloud${i % 3}`), x, y, w, w * (c.height / c.width));
  }
  ctx.globalAlpha = 1;

  // montanhas (procedurais)
  drawMountains(ctx, W, H, horizon, cam);

  // castelo e templo distantes
  drawBackSprite(ctx, a.items.bg_castle_grey, "#1c2a55", 0.9, W * 0.62 - cam * W * 0.03, horizon - 150 * s, 190 * s, "castle");
  drawBackSprite(ctx, a.items.bg_tower_grey, "#1c2a55", 0.9, W * 0.88 - cam * W * 0.03, horizon - 165 * s, 60 * s, "tower");
  drawBackSprite(ctx, a.items.bg_temple, "#1c2a55", 0.9, W * 0.1 - cam * W * 0.03, horizon - 110 * s, 220 * s, "temple");

  // linha de árvores distante (tingida) e próxima
  const treesFar = [a.items.bg_tree03, a.items.bg_tree08, a.items.bg_tree12, a.items.bg_tree19, a.items.bg_tree22];
  for (let i = 0; i < 14; i++) {
    const t = treesFar[i % treesFar.length];
    if (!t) continue;
    const x = ((i * 0.083 + 0.02) % 1) * W - cam * W * 0.05;
    const h = (90 + (i % 3) * 30) * s;
    drawBackSprite(ctx, t, "#16244d", 0.8, x, horizon - h + 6, h * (t.width / t.height), `tf${i % 5}`);
  }
  // chão
  const ground = ctx.createLinearGradient(0, horizon, 0, H);
  ground.addColorStop(0, "#3b5a3a");
  ground.addColorStop(0.15, "#2e4a32");
  ground.addColorStop(1, "#14231f");
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, W, H - horizon);
  // faixa de luz quente do horizonte
  const rim = ctx.createLinearGradient(0, horizon - 6, 0, horizon + 18);
  rim.addColorStop(0, "rgba(255,180,120,0.35)");
  rim.addColorStop(1, "rgba(255,180,120,0)");
  ctx.fillStyle = rim;
  ctx.fillRect(0, horizon - 6, W, 24);
  // caminho de pedra
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(W * 0.55, H * 0.9, W * 0.5, H * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();

  // vegetação próxima (paralaxe maior)
  const near = [a.items.bg_tree05, a.items.bg_tree27, a.items.bush, a.items.rock, a.items.mushroomRed, a.items.plant, a.items.bg_grass1, a.items.bg_grass3, a.items.bg_grass5];
  const nearSpec: [number, number, number, number][] = [
    [0.02, 0, 150, 0.995],
    [0.95, 1, 170, 0.995],
    [0.1, 2, 44, 0.9],
    [0.5, 3, 40, 0.88],
    [0.63, 4, 28, 0.92],
    [0.3, 5, 34, 0.91],
    [0.18, 6, 30, 0.95],
    [0.72, 7, 30, 0.95],
    [0.86, 8, 30, 0.95],
    [0.42, 6, 26, 0.99],
  ];
  for (const [nx, idx, size, ny] of nearSpec) {
    const im = near[idx];
    if (!im) continue;
    const w = size * s * (im.width / im.height);
    const h = size * s;
    const x = nx * W - cam * W * 0.09 - w / 2;
    const y = H * ny - h;
    ctx.globalAlpha = 0.95;
    ctx.drawImage(tinted(im, "#0c1a2a", 0.35, `near${idx}`), x, y, w, h);
    ctx.globalAlpha = 1;
  }

  // tochas
  drawTorch(ctx, W * 0.06 - cam * W * 0.09, horizon + 10, sim.time, s);
  drawTorch(ctx, W * 0.94 - cam * W * 0.09, horizon + 10, sim.time + 1.7, s);

  // entidades ordenadas por profundidade (y)
  type Drawable = { y: number; fn: () => void };
  const list: Drawable[] = [];
  for (const e of sim.enemies) list.push({ y: e.kind === "slime" ? e.y : e.y + 0.2, fn: () => drawEnemy(ctx, e, a, W, H, s, cam, sim.time) });
  list.push({ y: 0.86, fn: () => drawBoss(ctx, sim, a, W, H, s, cam, backdrop) });
  for (const h of sim.heroes) {
    const p = players.find((pp) => pp.slot === h.slot);
    list.push({ y: h.baseY, fn: () => drawHero(ctx, h, a, W, H, s, cam, p, now, backdrop) });
  }
  list.sort((p, q) => p.y - q.y).forEach((d) => d.fn());

  // efeitos
  for (const f of sim.fx) {
    if (f.t < 0) continue;
    const x = f.p.x * W - cam * W * 0.09;
    const y = f.p.y * H;
    const life = f.t / f.max;
    if (f.kind === "text") {
      ctx.globalAlpha = 1 - life;
      ctx.font = `800 ${(f.text?.startsWith("-") ? 15 : 17) * s + 4}px Sora, Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.fillStyle = f.color;
      ctx.strokeText(f.text ?? "", x, y - life * 50);
      ctx.fillText(f.text ?? "", x, y - life * 50);
      ctx.textAlign = "left";
    } else if (f.kind === "ring") {
      ctx.globalAlpha = 1 - life;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x, y, 10 + life * 90 * s, 4 + life * 30 * s, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (f.kind === "spark") {
      ctx.globalAlpha = 1 - life;
      for (let i = 0; i < (lite ? 4 : 7); i++) {
        const ang = (i / 7) * Math.PI * 2 + f.t * 3;
        const r = life * 40 * s;
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(x + Math.cos(ang) * r, y + Math.sin(ang) * r * 0.6, 3 * s * (1 - life) + 1, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (f.kind === "loot" && f.sprite) {
      ctx.globalAlpha = life > 0.75 ? (1 - life) * 4 : 1;
      const sz = 28 * s;
      ctx.drawImage(f.sprite, x - sz / 2, y - sz, sz, sz);
    }
    ctx.globalAlpha = 1;
  }

  // luz ambiente e vinheta
  const vig = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.35, W / 2, H * 0.55, H * 0.95);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(3,8,24,0.55)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  if (!backdrop) drawHud(ctx, sim, a, W, H, s, players, roomName, lite);
}

function drawMountains(ctx: CanvasRenderingContext2D, W: number, H: number, horizon: number, cam: number): void {
  const layers = [
    { amp: 0.16, color: "#0f1f4a", speed: 0.01, seed: 1.3 },
    { amp: 0.12, color: "#16295a", speed: 0.02, seed: 4.1 },
    { amp: 0.08, color: "#213768", speed: 0.03, seed: 7.7 },
  ];
  for (const L of layers) {
    ctx.fillStyle = L.color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) {
      const t = (x + cam * W * L.speed) / W;
      const y = horizon - Math.abs(Math.sin(t * 4.2 + L.seed)) * H * L.amp - Math.abs(Math.sin(t * 11 + L.seed * 2)) * H * L.amp * 0.3 + 4;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }
  // neblina baixa
  const fog = ctx.createLinearGradient(0, horizon - 40, 0, horizon + 10);
  fog.addColorStop(0, "rgba(140,160,220,0)");
  fog.addColorStop(1, "rgba(140,160,220,0.18)");
  ctx.fillStyle = fog;
  ctx.fillRect(0, horizon - 40, W, 50);
}

function drawBackSprite(ctx: CanvasRenderingContext2D, im: HTMLImageElement | undefined, color: string, alpha: number, x: number, y: number, w: number, key: string): void {
  if (!im) return;
  const h = w * (im.height / im.width);
  ctx.drawImage(tinted(im, color, alpha, key), x - w / 2, y, w, h);
}

function drawTorch(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, s: number): void {
  const flicker = 0.85 + Math.sin(t * 9) * 0.08 + Math.sin(t * 23) * 0.05;
  const r = 130 * s * flicker;
  const g = ctx.createRadialGradient(x, y - 40 * s, 0, x, y - 40 * s, r);
  g.addColorStop(0, "rgba(255,170,60,0.32)");
  g.addColorStop(1, "rgba(255,120,30,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - 40 * s - r, r * 2, r * 2);
  ctx.fillStyle = "#3b2a1a";
  ctx.fillRect(x - 3 * s, y - 40 * s, 6 * s, 60 * s);
  ctx.fillStyle = "#ffb347";
  ctx.beginPath();
  ctx.ellipse(x, y - 46 * s, 7 * s, 12 * s * flicker, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff3c4";
  ctx.beginPath();
  ctx.ellipse(x, y - 44 * s, 3.5 * s, 6 * s * flicker, 0, 0, Math.PI * 2);
  ctx.fill();
}

function heroPose(h: Hero): Pose {
  if (h.state === "run") return (["run0", "run1", "run2"] as Pose[])[Math.floor(h.anim * 9) % 3]!;
  if (h.state === "attack") return h.stateT < 0.2 ? "attack0" : h.stateT < 0.4 ? "attack1" : "attack2";
  if (h.state === "hit") return "hit";
  if (h.state === "cheer") return Math.floor(h.stateT * 4) % 2 === 0 ? "cheer0" : "cheer1";
  return "idle";
}

function drawHero(ctx: CanvasRenderingContext2D, h: Hero, a: Assets, W: number, H: number, s: number, cam: number, p: GamePlayer | undefined, now: number, backdrop = false): void {
  const x = h.x * W - cam * W * 0.09;
  const y = h.baseY * H;
  const c = COLORS[h.slot];
  const im = a.heroes[h.slot][heroPose(h)] ?? a.heroes[h.slot].idle;
  const hh = 190 * s;
  const ww = hh * 0.75;
  const bob = h.state === "idle" ? Math.sin(h.anim * 2.2) * 3 * s : 0;

  // sombra e aura
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(x, y + 2, ww * 0.4, 9 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  const aura = ctx.createRadialGradient(x, y - hh * 0.4, 4, x, y - hh * 0.4, hh * 0.55);
  aura.addColorStop(0, c.glow);
  aura.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = aura;
  ctx.fillRect(x - hh, y - hh, hh * 2, hh * 1.4);

  if (im) {
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.scale(h.face, 1);
    ctx.drawImage(im, -ww / 2, -hh, ww, hh);
    ctx.restore();
  }

  if (backdrop) return;
  // etiqueta e barras
  const label = (p?.name ?? (h.slot === "A" ? "Jogador 1" : "Jogador 2")) + (p?.isMe ? " (você)" : "");
  ctx.font = `700 ${12 * Math.max(0.9, s)}px Inter, sans-serif`;
  const nameY = y - hh - 10 * s;
  const tw = ctx.measureText(label).width + 26;
  ctx.fillStyle = "rgba(5,15,38,0.78)";
  roundRect(ctx, x - tw / 2, nameY - 13, tw, 20, 10);
  ctx.fill();
  ctx.fillStyle = p?.online === false ? "#6b7a99" : "#3fd6c6";
  ctx.beginPath();
  ctx.arc(x - tw / 2 + 10, nameY - 3, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f4f7fb";
  ctx.fillText(label, x - tw / 2 + 18, nameY + 1);
  const bw = 64 * Math.max(0.9, s);
  bar(ctx, x - bw / 2, nameY + 10, bw, 4, h.hp, "#4ade80");
  bar(ctx, x - bw / 2, nameY + 15, bw, 3, h.mp, "#60a5fa");

  // balão
  const bubble = p?.bubble && now - p.bubble.at < 6000 ? p.bubble.text : null;
  if (bubble || p?.typing) {
    const text = bubble ?? "…";
    ctx.font = "500 13px Inter, sans-serif";
    const maxW = Math.min(240, W * 0.42);
    const lines = wrap(ctx, text, maxW - 22).slice(0, 3);
    const bwid = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 22);
    const bh = lines.length * 16 + 14;
    const bx = Math.min(W - bwid - 6, Math.max(6, x - bwid / 2));
    const byy = nameY - 26 - bh;
    ctx.fillStyle = "rgba(255,255,255,0.97)";
    roundRect(ctx, bx, byy, bwid, bh, 12);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 7, byy + bh);
    ctx.lineTo(x + 7, byy + bh);
    ctx.lineTo(x, byy + bh + 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#10192c";
    if (p?.typing && !bubble) {
      const dots = Math.floor(now / 350) % 4;
      ctx.fillText(".".repeat(dots) || " ", bx + bwid / 2 - 8, byy + 19);
    } else lines.forEach((l, i) => ctx.fillText(l, bx + 11, byy + 19 + i * 16));
  }
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, a: Assets, W: number, H: number, s: number, cam: number, time: number): void {
  const x = e.x * W - cam * W * 0.09;
  const y = e.y * H;
  let im: HTMLImageElement | undefined;
  if (e.kind === "bat") im = e.dead ? a.enemies.bat_hit : Math.floor(e.t * 6) % 2 ? a.enemies.bat_fly : a.enemies.bat;
  else if (e.kind === "ghost") im = e.dead ? a.enemies.ghost_dead : Math.floor(e.t * 4) % 2 ? a.enemies.ghost_normal : a.enemies.ghost;
  else im = e.dead ? a.enemies.slimeDead : Math.floor(e.t * 5) % 2 ? a.enemies.slimeWalk1 : a.enemies.slimeWalk2;
  if (!im) return;
  const size = (e.kind === "slime" ? 54 : 60) * s;
  const w = size;
  const h = size * (im.height / im.width);
  ctx.save();
  ctx.globalAlpha = e.dead ? Math.max(0, 1 - e.dead) : 1;
  if (e.kind !== "slime") {
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.ellipse(x, H * 0.86, w * 0.3, 5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.translate(x, y + (e.kind === "slime" ? 0 : Math.sin(time * 3 + e.seed) * 4 * s));
  ctx.drawImage(im, -w / 2, -h, w, h);
  ctx.restore();
  if (!e.dead) {
    const max = e.kind === "slime" ? 3 : 2;
    bar(ctx, x - 18 * s, y - h - 8 * s, 36 * s, 3, e.hp / max, "#f87171");
  }
}

function drawBoss(ctx: CanvasRenderingContext2D, sim: Sim, a: Assets, W: number, H: number, s: number, cam: number, backdrop = false): void {
  const b = sim.boss;
  if (b.phase === "gone") return;
  const x = b.x * W - cam * W * 0.09;
  const y = H * 0.86;
  const pose = b.phase === "attack" ? (b.t < 0.35 ? "attack0" : "attack1") : b.phase === "hit" ? "hit" : b.phase === "dying" ? "fall" : Math.floor(b.t * 2) % 2 ? "walk0" : "idle";
  const im = a.boss[pose] ?? a.boss.idle;
  if (!im) return;
  const hh = 300 * s;
  const ww = hh * 0.75;
  const alpha = b.phase === "dying" ? Math.max(0, 1 - b.t / 2.2) : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.beginPath();
  ctx.ellipse(x, y + 4, ww * 0.42, 14 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  const aura = ctx.createRadialGradient(x, y - hh * 0.45, 10, x, y - hh * 0.45, hh * 0.6);
  aura.addColorStop(0, "rgba(96,165,250,0.35)");
  aura.addColorStop(1, "rgba(96,165,250,0)");
  ctx.fillStyle = aura;
  ctx.fillRect(x - hh, y - hh * 1.2, hh * 2, hh * 1.6);
  ctx.translate(x, y + (b.phase === "dying" ? b.t * 20 * s : Math.sin(b.t * 1.5) * 3 * s));
  ctx.scale(-1, 1);
  ctx.drawImage(im, -ww / 2, -hh, ww, hh);
  ctx.restore();

  // barra do chefe
  if (backdrop) return;
  const w = Math.min(W * 0.4, 400);
  const bx = W / 2 - w / 2;
  const by = 12;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  roundRect(ctx, bx - 8, by - 6, w + 16, 32, 8);
  ctx.fill();
  bar(ctx, bx, by, w, 10, b.hp, "#a78bfa");
  ctx.font = "600 11px Inter, sans-serif";
  ctx.fillStyle = "#e9d5ff";
  ctx.textAlign = "center";
  ctx.fillText(`Sentinela de Ferro · Nv. 42 · ${Math.round(b.hp * 100)}%`, W / 2, by + 24);
  ctx.textAlign = "left";
}

function drawHud(ctx: CanvasRenderingContext2D, sim: Sim, a: Assets, W: number, H: number, s: number, players: GamePlayer[], roomName: string, lite: boolean): void {
  const pad = 10;
  const narrow = W < 700;
  // grupo
  const rows = sim.heroes.map((h) => ({ h, p: players.find((p) => p.slot === h.slot) }));
  const pw = narrow ? 150 : 190;
  const rowH = 34;
  const ph = 14 + rows.length * rowH;
  const gy = narrow ? 48 : pad;
  ctx.fillStyle = "rgba(5,12,32,0.66)";
  roundRect(ctx, pad, gy, pw, ph, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  roundRect(ctx, pad, gy, pw, ph, 12);
  ctx.stroke();
  rows.forEach(({ h, p }, i) => {
    const y = gy + 10 + i * rowH;
    const face = a.heroes[h.slot].idle;
    ctx.save();
    ctx.beginPath();
    ctx.arc(pad + 22, y + 12, 12, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = COLORS[h.slot].main;
    ctx.fillRect(pad + 8, y, 30, 30);
    if (face) ctx.drawImage(face, pad + 5, y + 2, 34, 45);
    ctx.restore();
    ctx.fillStyle = "#f4f7fb";
    ctx.font = "700 11px Inter, sans-serif";
    ctx.fillText((p?.name ?? (h.slot === "A" ? "Jogador 1" : "Jogador 2")).slice(0, 16), pad + 42, y + 10);
    bar(ctx, pad + 42, y + 15, pw - 60, 5, h.hp, "#4ade80");
    bar(ctx, pad + 42, y + 22, pw - 60, 3, h.mp, "#60a5fa");
    ctx.fillStyle = p?.online ? "#3fd6c6" : "#5a6d8c";
    ctx.beginPath();
    ctx.arc(pad + pw - 10, y + 8, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // missão e recursos (topo direito)
  if (!narrow) {
    const qw = Math.min(230, W * 0.3);
    ctx.fillStyle = "rgba(5,12,32,0.66)";
    roundRect(ctx, W - qw - pad, pad, qw, 66, 12);
    ctx.fill();
    ctx.font = "700 10px Inter, sans-serif";
    ctx.fillStyle = "#fbc38f";
    ctx.fillText("MISSÃO · DUNGEON DO VULCÃO", W - qw - pad + 12, pad + 16);
    ctx.font = "500 11px Inter, sans-serif";
    ctx.fillStyle = "#f4f7fb";
    ctx.fillText(`Sobreviva às ondas · Onda ${sim.wave} · ${sim.kills} derrotados`, W - qw - pad + 12, pad + 32);
    const gem = a.items.gemBlue;
    const coin = a.items.coinGold;
    if (gem) ctx.drawImage(gem, W - qw - pad + 12, pad + 42, 16, 16);
    ctx.fillText(`${sim.gems}`, W - qw - pad + 32, pad + 55);
    if (coin) ctx.drawImage(coin, W - qw - pad + 70, pad + 42, 16, 16);
    ctx.fillText(`${sim.coins}`, W - qw - pad + 90, pad + 55);
    ctx.fillStyle = "#a3b3cc";
    ctx.font = "500 10px Inter, sans-serif";
    ctx.fillText(roomName.slice(0, 26), W - qw - pad + 140, pad + 55);
  }

  // barra de habilidades
  const n = 4;
  const size = lite ? 32 : 40;
  const gap = 8;
  const total = n * size + (n - 1) * gap;
  const sx = W / 2 - total / 2;
  const sy = H - size - 12;
  const icons = [a.items.gemBlue, a.items.gemRed, a.items.gemGreen, a.items.gemYellow];
  for (let i = 0; i < n; i++) {
    const x = sx + i * (size + gap);
    ctx.fillStyle = "rgba(5,12,32,0.72)";
    roundRect(ctx, x, sy, size, size, 9);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    roundRect(ctx, x, sy, size, size, 9);
    ctx.stroke();
    const ic = icons[i];
    if (ic) ctx.drawImage(ic, x + size * 0.2, sy + size * 0.2, size * 0.6, size * 0.6);
    const cd = sim.skillCd[i] ?? 0;
    if (cd > 0) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      roundRect(ctx, x, sy, size, size * Math.min(1, cd / [4, 7, 12, 20][i]!), 9);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "700 9px Inter, sans-serif";
    ctx.fillText(String(i + 1), x + 4, sy + 11);
  }

  // faixa de evento
  if (sim.banner) {
    const t = sim.banner.t;
    const alpha = t < 0.3 ? t / 0.3 : t > 2.8 ? Math.max(0, (3.5 - t) / 0.7) : 1;
    ctx.globalAlpha = alpha;
    ctx.font = `800 ${18 * Math.max(0.8, s)}px Sora, Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.fillStyle = "#fde68a";
    ctx.strokeText(sim.banner.text, W / 2, H * 0.3);
    ctx.fillText(sim.banner.text, W / 2, H * 0.3);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }

  ctx.font = "600 9px Inter, sans-serif";
  ctx.fillStyle = "rgba(244,247,251,0.45)";
  ctx.fillText("ARENA NIMBUS · simulação, não interativa", pad, H - 8);
}

/* ---------------------------------- utilitários ---------------------------------- */

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, v: number, color: string): void {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = color;
  roundRect(ctx, x, y, Math.max(0, w * Math.max(0, Math.min(1, v))), h, h / 2);
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}
