"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Arena Nimbus · simulação visual de um RPG cooperativo (canvas 2D, sem assets externos).
 * Não é um jogo jogável: heróis agem sozinhos contra o Guardião de Cristal. A cena é neutra e
 * NÃO reage ao risco da conversa (decisão de produto: a tensão vive nos painéis, não no jogo).
 */
export interface GamePlayer {
  id: string;
  name: string;
  isMe: boolean;
  online: boolean;
  typing: boolean;
  /** última mensagem enviada (aparece em balão por alguns segundos) */
  bubble?: { text: string; at: number } | null;
  /** "A" = arqueira teal, "B" = mago laranja */
  slot: "A" | "B";
}

interface Props {
  players: GamePlayer[];
  roomName: string;
  className?: string;
  /** reduz partículas/efeitos (mobile) */
  lite?: boolean;
}

type Vec = { x: number; y: number };

interface Projectile {
  from: Vec;
  to: Vec;
  t: number;
  speed: number;
  color: string;
  kind: "arrow" | "bolt";
}
interface FloatText {
  p: Vec;
  text: string;
  t: number;
  color: string;
}
interface Particle {
  p: Vec;
  v: Vec;
  life: number;
  max: number;
  size: number;
  color: string;
}
interface Ring {
  p: Vec;
  t: number;
  color: string;
}

interface Sim {
  time: number;
  bossHp: number;
  bossMax: number;
  bossPhase: "alive" | "dying" | "respawn";
  bossTimer: number;
  kills: number;
  projectiles: Projectile[];
  floats: FloatText[];
  particles: Particle[];
  rings: Ring[];
  heroes: { slot: "A" | "B"; x: number; y: number; hp: number; mp: number; cooldown: number; bob: number; face: number; moveT: number; targetX: number }[];
  skillCd: number[];
  lootTimer: number;
  camera: Vec;
}

const COLORS = {
  A: { main: "#17c3b2", light: "#8fe8de", dark: "#0a6b62", glow: "rgba(23,195,178,0.55)" },
  B: { main: "#f2801e", light: "#fbc38f", dark: "#8f4a0f", glow: "rgba(242,128,30,0.55)" },
};

export function GameScene({ players, roomName, className, lite = false }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const playersRef = React.useRef(players);
  playersRef.current = players;
  const [fps, setFps] = React.useState(0);
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const h = () => setReduced(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const maybeCtx = canvas.getContext("2d");
    if (!maybeCtx) return;
    const ctx: CanvasRenderingContext2D = maybeCtx;

    const sim: Sim = {
      time: 0,
      bossHp: 1,
      bossMax: 1,
      bossPhase: "alive",
      bossTimer: 0,
      kills: 0,
      projectiles: [],
      floats: [],
      particles: [],
      rings: [],
      heroes: [
        { slot: "A", x: 0.24, y: 0.78, hp: 0.92, mp: 0.7, cooldown: 1.2, bob: 0, face: 1, moveT: 0, targetX: 0.24 },
        { slot: "B", x: 0.4, y: 0.86, hp: 0.78, mp: 0.55, cooldown: 2.1, bob: 1.7, face: 1, moveT: 0, targetX: 0.4 },
      ],
      skillCd: [0, 0, 0, 0],
      lootTimer: 0,
      camera: { x: 0, y: 0 },
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
      bg = buildBackground(W, H, dpr);
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
      update(sim, dt, reduced ? 0.35 : 1, lite);
      draw(ctx, sim, W, H, bg, playersRef.current, roomName, lite, now);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [roomName, lite, reduced]);

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-navy-950", className)} role="img" aria-label={`Simulação visual do jogo ${roomName}: dois heróis enfrentam o Guardião de Cristal. Não é interativa.`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/40 px-2 py-0.5 font-mono text-[10px] text-white/60">
        {fps} fps · simulação
      </div>
    </div>
  );
}

/* ---------------------------------- simulação ---------------------------------- */

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function update(sim: Sim, dt: number, motion: number, lite: boolean): void {
  sim.time += dt;
  const bossPos = { x: 0.74, y: 0.7 };

  // heróis: bob, pequenos deslocamentos, ataques
  for (const h of sim.heroes) {
    h.bob += dt * 2.2 * motion;
    h.moveT -= dt;
    if (h.moveT <= 0) {
      h.moveT = rand(2.5, 6);
      h.targetX = h.slot === "A" ? rand(0.18, 0.32) : rand(0.34, 0.5);
    }
    h.x += (h.targetX - h.x) * Math.min(1, dt * 1.2 * motion);
    h.mp = Math.min(1, h.mp + dt * 0.03);
    h.hp = Math.min(1, h.hp + dt * 0.01);
    h.cooldown -= dt * motion;
    if (h.cooldown <= 0 && sim.bossPhase === "alive") {
      h.cooldown = h.slot === "A" ? rand(1.1, 1.9) : rand(1.8, 2.8);
      if (h.slot === "B" && h.mp < 0.15) h.cooldown = 1;
      else {
        if (h.slot === "B") h.mp -= 0.12;
        sim.projectiles.push({
          from: { x: h.x + 0.02, y: h.y - 0.1 },
          to: { x: bossPos.x + rand(-0.03, 0.03), y: bossPos.y - rand(0.05, 0.2) },
          t: 0,
          speed: h.slot === "A" ? 2.6 : 1.6,
          color: COLORS[h.slot].light,
          kind: h.slot === "A" ? "arrow" : "bolt",
        });
      }
    }
  }

  // boss: ataque ocasional (dano leve nos heróis), morte e respawn
  sim.bossTimer -= dt * motion;
  if (sim.bossPhase === "alive" && sim.bossTimer <= 0) {
    sim.bossTimer = rand(3, 5);
    const target = sim.heroes[Math.floor(Math.random() * sim.heroes.length)]!;
    target.hp = Math.max(0.35, target.hp - rand(0.08, 0.18));
    sim.rings.push({ p: { x: target.x, y: target.y - 0.05 }, t: 0, color: "rgba(229,72,77,0.8)" });
    sim.floats.push({ p: { x: target.x, y: target.y - 0.2 }, text: `-${Math.round(rand(80, 220))}`, t: 0, color: "#f0666a" });
    spawnParticles(sim, { x: bossPos.x - 0.06, y: bossPos.y - 0.2 }, 10, "#c084fc", lite);
  }
  if (sim.bossPhase === "dying") {
    sim.bossTimer -= dt;
    if (Math.random() < 0.5) spawnParticles(sim, { x: bossPos.x + rand(-0.08, 0.08), y: bossPos.y - rand(0, 0.3) }, 3, "#e9d5ff", lite);
    if (sim.bossTimer <= 0) {
      sim.bossPhase = "respawn";
      sim.bossTimer = 4;
      sim.kills++;
      sim.lootTimer = 3.5;
      for (let i = 0; i < 3; i++) sim.floats.push({ p: { x: bossPos.x + rand(-0.1, 0.1), y: bossPos.y - rand(0.1, 0.3) }, text: ["+ Espada de Gelo", "+ 320 xp", "+ Poção"][i]!, t: -i * 0.4, color: "#fde68a" });
    }
  } else if (sim.bossPhase === "respawn") {
    if (sim.bossTimer <= 0) {
      sim.bossPhase = "alive";
      sim.bossHp = 1;
      sim.bossTimer = 3;
      sim.rings.push({ p: { x: bossPos.x, y: bossPos.y - 0.15 }, t: 0, color: "rgba(192,132,252,0.9)" });
    }
  }

  // projéteis
  for (const p of sim.projectiles) {
    p.t += dt * p.speed * motion;
    if (p.t >= 1) {
      if (sim.bossPhase === "alive") {
        const dmg = p.kind === "arrow" ? rand(0.03, 0.05) : rand(0.06, 0.1);
        sim.bossHp = Math.max(0, sim.bossHp - dmg);
        sim.floats.push({ p: { x: p.to.x, y: p.to.y - 0.04 }, text: `${Math.round(dmg * 4200)}`, t: 0, color: p.color });
        sim.rings.push({ p: { ...p.to }, t: 0, color: p.color });
        spawnParticles(sim, p.to, p.kind === "arrow" ? 5 : 9, p.color, lite);
        if (sim.bossHp <= 0) {
          sim.bossPhase = "dying";
          sim.bossTimer = 1.6;
        }
      }
    }
  }
  sim.projectiles = sim.projectiles.filter((p) => p.t < 1);

  // textos flutuantes, anéis, partículas
  for (const f of sim.floats) f.t += dt;
  sim.floats = sim.floats.filter((f) => f.t < 1.4);
  for (const r of sim.rings) r.t += dt * 1.8;
  sim.rings = sim.rings.filter((r) => r.t < 1);
  for (const q of sim.particles) {
    q.life += dt;
    q.p.x += q.v.x * dt;
    q.p.y += q.v.y * dt;
    q.v.y += 0.12 * dt;
  }
  sim.particles = sim.particles.filter((q) => q.life < q.max);
  // vagalumes ambientes
  if (!lite && sim.particles.length < 70 && Math.random() < 0.3) {
    sim.particles.push({ p: { x: Math.random(), y: rand(0.35, 0.95) }, v: { x: rand(-0.02, 0.02), y: rand(-0.03, -0.005) }, life: 0, max: rand(3, 6), size: rand(1, 2.2), color: Math.random() < 0.5 ? "#8fe8de" : "#fbc38f" });
  }

  // cooldowns da barra de habilidades (decorativos)
  sim.skillCd = sim.skillCd.map((c, i) => (c <= 0 ? (Math.random() < 0.004 ? [4, 7, 12, 20][i]! : 0) : c - dt));
  sim.lootTimer = Math.max(0, sim.lootTimer - dt);
  sim.camera.x = Math.sin(sim.time * 0.25) * 0.004 * motion;
  sim.camera.y = Math.cos(sim.time * 0.31) * 0.003 * motion;
}

function spawnParticles(sim: Sim, at: Vec, n: number, color: string, lite: boolean): void {
  const count = lite ? Math.ceil(n / 2) : n;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = rand(0.04, 0.16);
    sim.particles.push({ p: { ...at }, v: { x: Math.cos(a) * s, y: Math.sin(a) * s - 0.05 }, life: 0, max: rand(0.5, 1.1), size: rand(1.5, 3.5), color });
  }
}

/* ---------------------------------- desenho ---------------------------------- */

function sceneScale(W: number, H: number): number {
  return Math.max(0.5, Math.min(1, Math.min(W, H * 1.5) / 1150));
}

function buildBackground(W: number, H: number, dpr: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.floor(W * dpr);
  c.height = Math.floor(H * dpr);
  const g = c.getContext("2d");
  if (!g) return c;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  // céu de entardecer
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#050f26");
  sky.addColorStop(0.45, "#0d2657");
  sky.addColorStop(0.72, "#3b2a5e");
  sky.addColorStop(1, "#7a3a2a");
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  // estrelas
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H * 0.55;
    const r = Math.random() * 1.3 + 0.2;
    g.fillStyle = `rgba(255,255,255,${rand(0.25, 0.9)})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  // lua
  const mx = W * 0.82;
  const my = H * 0.18;
  const moon = g.createRadialGradient(mx, my, 0, mx, my, H * 0.16);
  moon.addColorStop(0, "rgba(255,244,214,0.95)");
  moon.addColorStop(0.25, "rgba(255,236,190,0.35)");
  moon.addColorStop(1, "rgba(255,236,190,0)");
  g.fillStyle = moon;
  g.fillRect(0, 0, W, H);

  // montanhas em camadas (paralaxe estática)
  const layers = [
    { y: 0.5, amp: 0.12, color: "#0b1d45", seed: 1 },
    { y: 0.58, amp: 0.1, color: "#122a5c", seed: 7 },
    { y: 0.66, amp: 0.07, color: "#1c3a72", seed: 13 },
  ];
  for (const L of layers) {
    g.fillStyle = L.color;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) {
      const t = x / W;
      const y = H * (L.y - Math.abs(Math.sin(t * 5.3 + L.seed)) * L.amp - Math.abs(Math.sin(t * 13.1 + L.seed * 2)) * L.amp * 0.35);
      g.lineTo(x, y);
    }
    g.lineTo(W, H);
    g.closePath();
    g.fill();
  }

  // silhueta de castelo distante
  g.fillStyle = "#0f2350";
  const cx = W * 0.55;
  const cy = H * 0.6;
  g.fillRect(cx - 40, cy - 60, 80, 60);
  g.fillRect(cx - 55, cy - 90, 18, 90);
  g.fillRect(cx + 37, cy - 100, 18, 100);
  g.fillRect(cx - 8, cy - 120, 16, 120);
  for (let i = -55; i < 55; i += 12) g.fillRect(cx + i, cy - 130, 6, 10);
  // brilho do horizonte
  const hz = g.createLinearGradient(0, H * 0.55, 0, H * 0.7);
  hz.addColorStop(0, "rgba(255,150,90,0)");
  hz.addColorStop(1, "rgba(255,150,90,0.18)");
  g.fillStyle = hz;
  g.fillRect(0, H * 0.55, W, H * 0.15);

  // chão da arena
  const ground = g.createLinearGradient(0, H * 0.68, 0, H);
  ground.addColorStop(0, "#23305a");
  ground.addColorStop(1, "#0b1330");
  g.fillStyle = ground;
  g.fillRect(0, H * 0.68, W, H * 0.32);
  // pedras/linhas do chão
  g.strokeStyle = "rgba(143,232,222,0.08)";
  g.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    const y = H * (0.7 + i * 0.035);
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y + Math.sin(i) * 4);
    g.stroke();
  }
  // círculo rúnico
  g.strokeStyle = "rgba(192,132,252,0.35)";
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(W * 0.74, H * 0.74, W * 0.13, H * 0.05, 0, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = "rgba(192,132,252,0.18)";
  g.beginPath();
  g.ellipse(W * 0.74, H * 0.74, W * 0.17, H * 0.068, 0, 0, Math.PI * 2);
  g.stroke();
  // névoa
  const fog = g.createLinearGradient(0, H * 0.62, 0, H * 0.78);
  fog.addColorStop(0, "rgba(120,140,200,0)");
  fog.addColorStop(0.5, "rgba(120,140,200,0.14)");
  fog.addColorStop(1, "rgba(120,140,200,0)");
  g.fillStyle = fog;
  g.fillRect(0, H * 0.6, W, H * 0.2);
  return c;
}

function draw(ctx: CanvasRenderingContext2D, sim: Sim, W: number, H: number, bg: HTMLCanvasElement | null, players: GamePlayer[], roomName: string, lite: boolean, now: number): void {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(sim.camera.x * W, sim.camera.y * H);
  if (bg) ctx.drawImage(bg, 0, 0, W, H);

  // tochas
  drawTorch(ctx, W * 0.07, H * 0.6, sim.time, H);
  drawTorch(ctx, W * 0.95, H * 0.6, sim.time + 1.3, H);

  // boss
  drawBoss(ctx, sim, W, H);

  // heróis (ordenados por y)
  const byName = new Map(players.map((p) => [p.slot, p]));
  const heroes = [...sim.heroes].sort((a, b) => a.y - b.y);
  for (const h of heroes) {
    const p = byName.get(h.slot);
    drawHero(ctx, h, W, H, p, now);
  }

  // projéteis
  for (const p of sim.projectiles) {
    const x = (p.from.x + (p.to.x - p.from.x) * p.t) * W;
    const arc = Math.sin(p.t * Math.PI) * H * (p.kind === "arrow" ? 0.06 : 0.02);
    const y = (p.from.y + (p.to.y - p.from.y) * p.t) * H - arc;
    ctx.save();
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = p.color;
    if (p.kind === "arrow") {
      const ang = Math.atan2((p.to.y - p.from.y) * H, (p.to.x - p.from.x) * W) - Math.cos(p.t * Math.PI) * 0.4;
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.fillRect(-14, -1.2, 28, 2.4);
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(8, -4);
      ctx.lineTo(8, 4);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 6 + Math.sin(sim.time * 20) * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // anéis de impacto
  for (const r of sim.rings) {
    ctx.strokeStyle = r.color;
    ctx.globalAlpha = 1 - r.t;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(r.p.x * W, r.p.y * H, 8 + r.t * 40, 4 + r.t * 16, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // partículas
  for (const q of sim.particles) {
    const a = 1 - q.life / q.max;
    ctx.globalAlpha = a * 0.9;
    ctx.fillStyle = q.color;
    ctx.beginPath();
    ctx.arc(q.p.x * W, q.p.y * H, q.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // textos flutuantes
  for (const f of sim.floats) {
    if (f.t < 0) continue;
    const a = 1 - f.t / 1.4;
    ctx.globalAlpha = a;
    ctx.font = `700 ${f.text.startsWith("+") ? 13 : 15}px Sora, Inter, sans-serif`;
    ctx.fillStyle = f.color;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 3;
    const x = f.p.x * W;
    const y = f.p.y * H - f.t * 40;
    ctx.strokeText(f.text, x, y);
    ctx.fillText(f.text, x, y);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  drawHud(ctx, sim, W, H, players, roomName, lite);
}

function drawTorch(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, H: number): void {
  const flicker = 0.85 + Math.sin(t * 9) * 0.08 + Math.sin(t * 23) * 0.05;
  const r = H * 0.16 * flicker;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, "rgba(255,170,60,0.35)");
  g.addColorStop(1, "rgba(255,120,30,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.fillStyle = "#3b2a1a";
  ctx.fillRect(x - 3, y, 6, H * 0.14);
  ctx.fillStyle = "#ffb347";
  ctx.beginPath();
  ctx.ellipse(x, y - 4, 6, 10 * flicker, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff3c4";
  ctx.beginPath();
  ctx.ellipse(x, y - 2, 3, 5 * flicker, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBoss(ctx: CanvasRenderingContext2D, sim: Sim, W: number, H: number): void {
  const bx = W * 0.74;
  const by = H * 0.7;
  const breathe = 1 + Math.sin(sim.time * 1.4) * 0.025;
  const scale = sceneScale(W, H) * 1.15;
  const dying = sim.bossPhase === "dying";
  const gone = sim.bossPhase === "respawn";
  const alpha = dying ? Math.max(0, sim.bossTimer / 1.6) : gone ? Math.max(0, 1 - sim.bossTimer / 4) * 0.9 : 1;
  const hover = Math.sin(sim.time * 1.1) * 6;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(bx, by);
  ctx.scale(scale, scale);

  // aura no chão
  const aura = ctx.createRadialGradient(0, 10, 10, 0, 10, 170);
  aura.addColorStop(0, "rgba(192,132,252,0.32)");
  aura.addColorStop(1, "rgba(192,132,252,0)");
  ctx.fillStyle = aura;
  ctx.fillRect(-180, -140, 360, 200);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(0, 14, 96, 16, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(0, hover);
  ctx.scale(breathe, breathe);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(233,213,255,0.65)";

  // pernas de cristal
  const leg = ctx.createLinearGradient(0, -60, 0, 10);
  leg.addColorStop(0, "#6d28d9");
  leg.addColorStop(1, "#1e1b4b");
  ctx.fillStyle = leg;
  poly(ctx, [[-52, -70], [-24, -70], [-30, 0], [-62, 6]]);
  poly(ctx, [[24, -70], [52, -70], [62, 6], [30, 0]]);

  // torso
  const body = ctx.createLinearGradient(-70, -190, 70, -60);
  body.addColorStop(0, "#c4b5fd");
  body.addColorStop(0.45, "#7c3aed");
  body.addColorStop(1, "#312e81");
  ctx.fillStyle = body;
  poly(ctx, [[-60, -70], [-78, -150], [-50, -205], [50, -205], [78, -150], [60, -70]]);
  // facetas internas
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.moveTo(-50, -205); ctx.lineTo(0, -130); ctx.lineTo(50, -205);
  ctx.moveTo(-78, -150); ctx.lineTo(0, -130); ctx.lineTo(78, -150);
  ctx.moveTo(0, -130); ctx.lineTo(0, -70);
  ctx.stroke();
  ctx.strokeStyle = "rgba(233,213,255,0.65)";

  // ombreiras e braços
  const armSwing = Math.sin(sim.time * 1.4) * 8;
  const arm = ctx.createLinearGradient(0, -190, 0, -60);
  arm.addColorStop(0, "#a78bfa");
  arm.addColorStop(1, "#4c1d95");
  ctx.fillStyle = arm;
  poly(ctx, [[-78, -185], [-118, -170], [-132, -110 + armSwing], [-104, -60 + armSwing], [-84, -80 + armSwing], [-96, -140]]);
  poly(ctx, [[78, -185], [118, -170], [132, -110 - armSwing], [104, -60 - armSwing], [84, -80 - armSwing], [96, -140]]);
  // punhos brilhantes
  ctx.fillStyle = "#e9d5ff";
  ctx.beginPath(); ctx.arc(-108, -62 + armSwing, 9, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(108, -62 - armSwing, 9, 0, Math.PI * 2); ctx.fill();

  // cabeça
  const head = ctx.createLinearGradient(-30, -260, 30, -205);
  head.addColorStop(0, "#ddd6fe");
  head.addColorStop(1, "#5b21b6");
  ctx.fillStyle = head;
  poly(ctx, [[-30, -205], [-36, -240], [0, -268], [36, -240], [30, -205]]);
  // olhos
  ctx.fillStyle = "#fef3c7";
  ctx.shadowColor = "#fde68a";
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.ellipse(-12, -232, 6, 3.5, -0.35, 0, Math.PI * 2);
  ctx.ellipse(12, -232, 6, 3.5, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // núcleo
  const core = ctx.createRadialGradient(0, -135, 2, 0, -135, 34);
  core.addColorStop(0, "#ffffff");
  core.addColorStop(0.35, "#e9d5ff");
  core.addColorStop(1, "rgba(233,213,255,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, -135, 34 + Math.sin(sim.time * 4) * 3, 0, Math.PI * 2);
  ctx.fill();

  // fragmentos orbitando
  for (let i = 0; i < 6; i++) {
    const a = sim.time * 0.9 + (i * Math.PI * 2) / 6;
    const rx = 150;
    const ry = 40;
    const x = Math.cos(a) * rx;
    const y = -150 + Math.sin(a) * ry;
    const depth = (Math.sin(a) + 1) / 2;
    ctx.globalAlpha = alpha * (0.5 + depth * 0.5);
    ctx.fillStyle = depth > 0.5 ? "#c4b5fd" : "#6d28d9";
    const sz = 10 + depth * 8;
    poly(ctx, [[x, y - sz], [x + sz * 0.6, y], [x, y + sz], [x - sz * 0.6, y]], false);
  }
  ctx.restore();

  // barra de vida do chefe (topo central)
  if (!gone) {
    const w = Math.min(W * 0.42, 420);
    const x = W / 2 - w / 2;
    const y = 14;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(ctx, x - 6, y - 6, w + 12, 28, 8);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(ctx, x, y, w, 10, 5);
    ctx.fill();
    const hpg = ctx.createLinearGradient(x, 0, x + w, 0);
    hpg.addColorStop(0, "#a855f7");
    hpg.addColorStop(1, "#e879f9");
    ctx.fillStyle = hpg;
    roundRect(ctx, x, y, Math.max(0, w * sim.bossHp), 10, 5);
    ctx.fill();
    ctx.font = "600 11px Inter, sans-serif";
    ctx.fillStyle = "#e9d5ff";
    ctx.textAlign = "center";
    ctx.fillText(`Guardião de Cristal · Nv. 42 · ${Math.round(sim.bossHp * 100)}%`, W / 2, y + 22);
    ctx.textAlign = "left";
  }
}

function drawHero(ctx: CanvasRenderingContext2D, h: Sim["heroes"][number], W: number, H: number, p: GamePlayer | undefined, now: number): void {
  const x = h.x * W;
  const y = h.y * H;
  const c = COLORS[h.slot];
  const scale = sceneScale(W, H) * 0.9;
  const bob = Math.sin(h.bob) * 2.5;
  const step = Math.sin(h.bob * 2) * 3;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  // sombra e aura
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.beginPath();
  ctx.ellipse(0, 4, 24, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  const aura = ctx.createRadialGradient(0, -50, 4, 0, -50, 75);
  aura.addColorStop(0, c.glow);
  aura.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = aura;
  ctx.fillRect(-90, -140, 180, 180);

  ctx.translate(0, bob);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(5,15,38,0.7)";

  // capa
  const cape = ctx.createLinearGradient(0, -95, 0, -10);
  cape.addColorStop(0, c.main);
  cape.addColorStop(1, c.dark);
  ctx.fillStyle = cape;
  poly(ctx, [[-16, -92], [16, -92], [24, -12 + Math.sin(h.bob * 1.3) * 3], [-24, -12 + Math.cos(h.bob * 1.3) * 3]]);

  // pernas
  ctx.fillStyle = "#1e293b";
  roundRect(ctx, -13, -40, 11, 40 + step, 5); ctx.fill(); ctx.stroke();
  roundRect(ctx, 2, -40, 11, 40 - step, 5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#0f172a";
  roundRect(ctx, -15, -6 + step, 15, 8, 3); ctx.fill();
  roundRect(ctx, 0, -6 - step, 15, 8, 3); ctx.fill();

  // torso (armadura)
  const body = ctx.createLinearGradient(-16, -100, 16, -40);
  body.addColorStop(0, "#f8fafc");
  body.addColorStop(1, "#94a3b8");
  ctx.fillStyle = body;
  roundRect(ctx, -17, -98, 34, 60, 12); ctx.fill(); ctx.stroke();
  ctx.fillStyle = c.main;
  roundRect(ctx, -17, -60, 34, 7, 3); ctx.fill();
  // ombreiras
  ctx.fillStyle = c.dark;
  ctx.beginPath(); ctx.ellipse(-19, -92, 9, 6, -0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(19, -92, 9, 6, 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // braços
  ctx.fillStyle = "#e2e8f0";
  roundRect(ctx, -26, -88, 9, 34, 4); ctx.fill(); ctx.stroke();
  roundRect(ctx, 17, -88, 9, 34, 4); ctx.fill(); ctx.stroke();

  // cabeça
  ctx.fillStyle = "#fde7d3";
  ctx.beginPath(); ctx.arc(0, -114, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#1e293b";
  ctx.beginPath(); ctx.arc(-5, -115, 1.6, 0, Math.PI * 2); ctx.arc(5, -115, 1.6, 0, Math.PI * 2); ctx.fill();
  // cabelo / chapéu
  if (h.slot === "A") {
    ctx.fillStyle = "#7c2d12";
    ctx.beginPath(); ctx.arc(0, -118, 13.5, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
    ctx.beginPath(); ctx.moveTo(11, -120); ctx.quadraticCurveTo(20, -100, 12, -88); ctx.lineTo(9, -104); ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = c.dark;
    poly(ctx, [[-20, -124], [20, -124], [12, -128], [3, -165], [-8, -128]]);
    ctx.fillStyle = c.main;
    roundRect(ctx, -12, -130, 24, 5, 2); ctx.fill();
  }

  // arma
  if (h.slot === "A") {
    ctx.strokeStyle = "#d6b98c";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(28, -70, 24, -Math.PI / 2.1, Math.PI / 2.1); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(35, -92); ctx.lineTo(35, -48); ctx.stroke();
    // aljava
    ctx.fillStyle = "#5b3a1a";
    ctx.save(); ctx.translate(-18, -80); ctx.rotate(0.35); roundRect(ctx, -4, -14, 8, 30, 3); ctx.fill(); ctx.restore();
  } else {
    ctx.strokeStyle = "#7c5cff";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(26, -30); ctx.lineTo(26, -125); ctx.stroke();
    ctx.fillStyle = "#e9d5ff";
    ctx.shadowColor = "#c084fc";
    ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(26, -132, 7 + Math.sin(now / 200) * 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.restore();

  // nome e barras (em espaço de tela)
  const label = (p?.name ?? (h.slot === "A" ? "Jogador A" : "Jogador B")) + (p?.isMe ? " (você)" : "");
  ctx.font = "700 12px Inter, sans-serif";
  const nameY = y - 150 * scale - 8;
  const tw = ctx.measureText(label).width + 26;
  ctx.fillStyle = "rgba(5,15,38,0.75)";
  roundRect(ctx, x - tw / 2, nameY - 13, tw, 20, 10);
  ctx.fill();
  ctx.fillStyle = p?.online === false ? "#5a6d8c" : "#3fd6c6";
  ctx.beginPath();
  ctx.arc(x - tw / 2 + 10, nameY - 3, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f4f7fb";
  ctx.textAlign = "left";
  ctx.fillText(label, x - tw / 2 + 18, nameY + 1);
  const bw = 64;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  roundRect(ctx, x - bw / 2, nameY + 10, bw, 4, 2); ctx.fill();
  ctx.fillStyle = "#4ade80";
  roundRect(ctx, x - bw / 2, nameY + 10, bw * h.hp, 4, 2); ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  roundRect(ctx, x - bw / 2, nameY + 15, bw, 3, 1.5); ctx.fill();
  ctx.fillStyle = "#60a5fa";
  roundRect(ctx, x - bw / 2, nameY + 15, bw * h.mp, 3, 1.5); ctx.fill();

  // balão de fala / digitando
  const bubble = p?.bubble && now - p.bubble.at < 5000 ? p.bubble.text : null;
  if (bubble || p?.typing) {
    const text = bubble ?? "…";
    ctx.font = "500 12px Inter, sans-serif";
    const maxW = Math.min(220, W * 0.4);
    const lines = wrap(ctx, text, maxW - 20).slice(0, 3);
    const bwid = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20);
    const bh = lines.length * 15 + 12;
    const bx = Math.min(W - bwid - 6, Math.max(6, x - bwid / 2));
    const byy = nameY - 24 - bh;
    ctx.fillStyle = "rgba(244,247,251,0.96)";
    roundRect(ctx, bx, byy, bwid, bh, 10);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 6, byy + bh);
    ctx.lineTo(x + 6, byy + bh);
    ctx.lineTo(x, byy + bh + 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#10192c";
    if (p?.typing && !bubble) {
      const dots = Math.floor(now / 350) % 4;
      ctx.fillText(".".repeat(dots) || " ", bx + bwid / 2 - 8, byy + 18);
    } else {
      lines.forEach((l, i) => ctx.fillText(l, bx + 10, byy + 18 + i * 15));
    }
  }
}

function drawHud(ctx: CanvasRenderingContext2D, sim: Sim, W: number, H: number, players: GamePlayer[], roomName: string, lite: boolean): void {
  const pad = 10;
  const narrow = W < 700;
  // painel do grupo (topo esquerdo; em telas estreitas desce para não cobrir a barra do chefe)
  const rows = sim.heroes.map((h) => ({ h, p: players.find((p) => p.slot === h.slot) }));
  const pw = narrow ? 120 : 150;
  const ph = 16 + rows.length * 28;
  const gy = narrow ? 44 : pad;
  ctx.fillStyle = "rgba(5,15,38,0.62)";
  roundRect(ctx, pad, gy, pw, ph, 10);
  ctx.fill();
  ctx.font = "700 10px Inter, sans-serif";
  ctx.fillStyle = "#a3b3cc";
  ctx.fillText("GRUPO", pad + 10, gy + 13);
  rows.forEach(({ h, p }, i) => {
    const y = gy + 22 + i * 28;
    const c = COLORS[h.slot];
    ctx.fillStyle = c.main;
    ctx.beginPath();
    ctx.arc(pad + 16, y + 7, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f4f7fb";
    ctx.font = "600 11px Inter, sans-serif";
    ctx.fillText((p?.name ?? (h.slot === "A" ? "Jogador A" : "Jogador B")).slice(0, 14), pad + 28, y + 11);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(ctx, pad + 28, y + 15, pw - 40, 4, 2);
    ctx.fill();
    ctx.fillStyle = "#4ade80";
    roundRect(ctx, pad + 28, y + 15, (pw - 40) * h.hp, 4, 2);
    ctx.fill();
    ctx.fillStyle = p?.online ? "#3fd6c6" : "#5a6d8c";
    ctx.beginPath();
    ctx.arc(pad + pw - 12, y + 7, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // missão (topo direito)
  if (!narrow) {
    const qw = Math.min(200, W * 0.36);
    ctx.fillStyle = "rgba(5,15,38,0.62)";
    roundRect(ctx, W - qw - pad, pad, qw, 52, 10);
    ctx.fill();
    ctx.font = "700 10px Inter, sans-serif";
    ctx.fillStyle = "#fbc38f";
    ctx.fillText("MISSÃO · DUNGEON DO VULCÃO", W - qw - pad + 10, pad + 14);
    ctx.font = "500 11px Inter, sans-serif";
    ctx.fillStyle = "#f4f7fb";
    ctx.fillText(`Derrote o Guardião  ${Math.min(sim.kills, 3)}/3`, W - qw - pad + 10, pad + 30);
    ctx.fillStyle = "#a3b3cc";
    ctx.font = "500 10px Inter, sans-serif";
    ctx.fillText(roomName.slice(0, 28), W - qw - pad + 10, pad + 44);
  }

  // barra de habilidades (rodapé central)
  const n = 4;
  const size = lite ? 30 : 36;
  const gap = 8;
  const total = n * size + (n - 1) * gap;
  const sx = W / 2 - total / 2;
  const sy = H - size - 12;
  const icons = ["◆", "✦", "❖", "✚"];
  for (let i = 0; i < n; i++) {
    const x = sx + i * (size + gap);
    ctx.fillStyle = "rgba(5,15,38,0.7)";
    roundRect(ctx, x, sy, size, size, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(143,232,222,0.35)";
    ctx.lineWidth = 1;
    roundRect(ctx, x, sy, size, size, 8);
    ctx.stroke();
    ctx.font = `${size * 0.5}px serif`;
    ctx.fillStyle = ["#8fe8de", "#fbc38f", "#c4b5fd", "#86efac"][i]!;
    ctx.textAlign = "center";
    ctx.fillText(icons[i]!, x + size / 2, sy + size * 0.66);
    ctx.textAlign = "left";
    const cd = sim.skillCd[i] ?? 0;
    if (cd > 0) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      roundRect(ctx, x, sy, size, size * Math.min(1, cd / [4, 7, 12, 20][i]!), 8);
      ctx.fill();
    }
  }

  // loot
  if (sim.lootTimer > 0) {
    ctx.globalAlpha = Math.min(1, sim.lootTimer);
    ctx.font = "700 13px Sora, Inter, sans-serif";
    ctx.fillStyle = "#fde68a";
    ctx.textAlign = "center";
    ctx.fillText("Guardião derrotado! Espada de Gelo obtida", W / 2, H - size - 26);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }

  // selo de simulação
  ctx.font = "600 9px Inter, sans-serif";
  ctx.fillStyle = "rgba(244,247,251,0.45)";
  ctx.fillText("ARENA NIMBUS · simulação visual, não interativa", pad, H - 8);
}

/* ---------------------------------- utilitários ---------------------------------- */

function poly(ctx: CanvasRenderingContext2D, pts: [number, number][], stroke = true): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fill();
  if (stroke) ctx.stroke();
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
