"use client";

import NextImage from "next/image";
import { useEffect, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type DebateCharacterRole = "moderator" | "user" | "bull" | "bear";

type Drift = {
  x: number;
  y: number;
  rotation: number;
  duration: number;
};

type CharacterDefinition = {
  role: DebateCharacterRole;
  label: string;
  detail: string;
  image: string;
};

const CHARACTERS: CharacterDefinition[] = [
  {
    role: "moderator",
    label: "主持顾问",
    detail: "控制议程",
    image: "/unity-characters/hisa-teacher.png",
  },
  {
    role: "bull",
    label: "看多 agent",
    detail: "寻找增长机会",
    image: "/unity-characters/hisa-student.png",
  },
  {
    role: "bear",
    label: "看空 agent",
    detail: "审视下行风险",
    image: "/unity-characters/hisa-shark.png",
  },
  {
    role: "user",
    label: "你的席位",
    detail: "提出决策问题",
    image: "/unity-characters/hisa.png",
  },
];

const STILL_DRIFT: Record<DebateCharacterRole, Drift> = {
  moderator: { x: 0, y: 0, rotation: 0, duration: 3.4 },
  bull: { x: 0, y: 0, rotation: 0, duration: 3.7 },
  bear: { x: 0, y: 0, rotation: 0, duration: 3.9 },
  user: { x: 0, y: 0, rotation: 0, duration: 4.1 },
};

function nextDrift(index: number): Drift {
  const horizontalDirection = index % 2 === 0 ? 1 : -1;
  return {
    x: Math.round((4 + Math.random() * 8) * horizontalDirection * (Math.random() > 0.5 ? 1 : -1)),
    y: Math.round(-5 + Math.random() * 10),
    rotation: Number((-1.8 + Math.random() * 3.6).toFixed(2)),
    duration: Number((3.2 + Math.random() * 1.8).toFixed(2)),
  };
}

export default function DebateCharacterStage({
  activeRole,
  motion,
  status,
  userMessage,
  bullMessage,
  bearMessage,
  judgeMessage,
}: {
  activeRole: DebateCharacterRole;
  motion?: string | null;
  status?: string | null;
  userMessage?: string | null;
  bullMessage?: string | null;
  bearMessage?: string | null;
  judgeMessage?: string | null;
}) {
  const [drifts, setDrifts] = useState(STILL_DRIFT);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;

    const move = () => {
      setDrifts({
        moderator: nextDrift(0),
        bull: nextDrift(1),
        bear: nextDrift(2),
        user: nextDrift(3),
      });
    };

    move();
    const intervalId = window.setInterval(move, 3600);
    return () => window.clearInterval(intervalId);
  }, []);

  const clashRole = activeRole === "bull" || activeRole === "bear" ? activeRole : null;
  const activeRoleSet = new Set([activeRole]);
  const activityText = status?.trim() || "主持顾问正在等待下一步";
  const bullBubble = bullMessage ?? (activeRole === "bull" ? activityText : null);
  const bearBubble = bearMessage ?? (activeRole === "bear" ? activityText : null);
  const judgeBubble = judgeMessage ?? (activeRole === "moderator" ? activityText : null);

  return (
    <div className="debate-room debate-character-stage">
      <div className="debate-stage relative min-h-[520px] overflow-hidden rounded-lg border border-border bg-white" aria-label="多空 Battle 实时圆桌">
        <NextImage
          className="roundtable-scene"
          src="/debate-roundtable.jpg"
          alt=""
          width={1329}
          height={1183}
          priority
        />
        <div className="absolute left-4 top-4 z-10 max-w-[min(70%,680px)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">Live Debate</div>
          <div className="mt-1 truncate text-sm font-semibold text-neutral-950">{motion || "等待你提出本轮辩题"}</div>
          <div className="mt-1 text-xs text-neutral-500">{activityText}</div>
        </div>
        <div className="debate-character-layer" aria-label="圆桌角色">
          {CHARACTERS.map((character) => {
            const drift = drifts[character.role];
            const isActive = activeRoleSet.has(character.role);
            const isShoving = clashRole === character.role;
            const isPushed = clashRole !== null && clashRole !== character.role
              && (character.role === "bull" || character.role === "bear");
            const impactDirection = clashRole === "bear" ? -1 : 1;
            const impactX = isShoving ? 30 * impactDirection : isPushed ? 18 * impactDirection : 0;
            const impactY = isShoving ? -4 : isPushed ? 4 : 0;
            const style = {
              "--character-x": `${drift.x}px`,
              "--character-y": `${drift.y}px`,
              "--character-rotation": `${drift.rotation}deg`,
              "--character-duration": `${drift.duration}s`,
              "--impact-x": `${impactX}px`,
              "--impact-y": `${impactY}px`,
            } as CSSProperties;

            return (
              <div
                key={character.role}
                className={cn(
                  "debate-character",
                  `debate-character-${character.role}`,
                  isActive && "debate-character-active",
                  isShoving && "debate-character-shoving",
                  isPushed && "debate-character-pushed",
                )}
                style={style}
                aria-label={`${character.label}，${character.detail}${isActive ? "，正在发言" : ""}`}
              >
                <span className="debate-character-body">
                  <span className="debate-character-portrait">
                    <NextImage
                      src={character.image}
                      alt=""
                      fill
                      sizes="(max-width: 767px) 74px, 104px"
                      className="debate-character-image"
                    />
                  </span>
                  <span className="debate-character-caption">
                    <strong>{character.label}</strong>
                    <small>{isActive ? "正在发言" : character.detail}</small>
                  </span>
                </span>
              </div>
            );
          })}
        </div>
        {userMessage ? <DebateBubble role="user" message={userMessage} /> : null}
        {bullBubble ? <DebateBubble role="bull" message={bullBubble} muted={!bullMessage} /> : null}
        {bearBubble ? <DebateBubble role="bear" message={bearBubble} muted={!bearMessage} /> : null}
        {judgeBubble ? <DebateBubble role="judge" message={judgeBubble} muted={!judgeMessage} /> : null}
      </div>
    </div>
  );
}

function DebateBubble({
  role,
  message,
  muted = false,
}: {
  role: "user" | "bull" | "bear" | "judge";
  message: string;
  muted?: boolean;
}) {
  return (
    <div className={cn("debate-bubble", `debate-bubble-${role}`, muted && "debate-bubble-muted")}>
      <span>{message}</span>
    </div>
  );
}
