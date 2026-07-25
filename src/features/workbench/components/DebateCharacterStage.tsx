"use client";

import NextImage from "next/image";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type DebateCharacterRole = "moderator" | "user" | "bull" | "bear";

type Drift = {
  x: number;
  y: number;
  rotation: number;
  duration: number;
};

type Impact = {
  actor: DebateCharacterRole;
  target: DebateCharacterRole;
  direction: -1 | 1;
};

type CharacterDefinition = {
  role: DebateCharacterRole;
  label: string;
  detail: string;
  image: string;
  reactions: string[];
};

const CHARACTERS: CharacterDefinition[] = [
  {
    role: "moderator",
    label: "主持顾问",
    detail: "控制议程",
    image: "/unity-characters/hisa-teacher.png",
    reactions: ["先把分歧讲清楚。", "请用证据支持判断。", "我们继续下一轮。"],
  },
  {
    role: "bull",
    label: "看多 agent",
    detail: "寻找增长机会",
    image: "/unity-characters/hisa-student.png",
    reactions: ["我看到了上行空间。", "机会成本也要算进去。", "让我补一条正方证据。"],
  },
  {
    role: "bear",
    label: "看空 agent",
    detail: "审视下行风险",
    image: "/unity-characters/hisa-shark.png",
    reactions: ["先别忽略尾部风险。", "这个假设需要压力测试。", "我来检查最坏情形。"],
  },
  {
    role: "user",
    label: "你的席位",
    detail: "提出决策问题",
    image: "/unity-characters/hisa.png",
    reactions: ["我还想听听两边依据。", "请给我可执行的结论。", "这点和我的目标有关。"],
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
  activeRoles,
  clash,
}: {
  activeRoles: DebateCharacterRole[];
  clash: boolean;
}) {
  const [drifts, setDrifts] = useState(STILL_DRIFT);
  const [reaction, setReaction] = useState<{ role: DebateCharacterRole; text: string } | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const interactionCountRef = useRef(0);

  const activeRoleSet = useMemo(() => new Set(activeRoles), [activeRoles]);

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

  useEffect(() => {
    if (!reaction) return;
    const timeoutId = window.setTimeout(() => setReaction(null), 2400);
    return () => window.clearTimeout(timeoutId);
  }, [reaction]);

  useEffect(() => {
    if (!impact) return;
    const timeoutId = window.setTimeout(() => setImpact(null), 720);
    return () => window.clearTimeout(timeoutId);
  }, [impact]);

  useEffect(() => {
    if (!clash) return;
    let bullStarts = true;
    const shove = () => {
      setImpact({
        actor: bullStarts ? "bull" : "bear",
        target: bullStarts ? "bear" : "bull",
        direction: bullStarts ? 1 : -1,
      });
      bullStarts = !bullStarts;
    };

    shove();
    const intervalId = window.setInterval(shove, 1120);
    return () => window.clearInterval(intervalId);
  }, [clash]);

  const getInteractionTarget = (role: DebateCharacterRole, interactionCount: number): DebateCharacterRole => {
    if (role === "bull") return "bear";
    if (role === "bear") return "bull";
    if (role === "moderator") return activeRoleSet.has("bear") ? "bear" : "bull";
    return interactionCount % 2 === 0 ? "bull" : "bear";
  };

  const interact = (character: CharacterDefinition) => {
    const interactionCount = interactionCountRef.current;
    interactionCountRef.current += 1;
    const text = character.reactions[interactionCount % character.reactions.length];
    const target = getInteractionTarget(character.role, interactionCount);
    const direction: -1 | 1 = character.role === "bear" ? -1 : 1;
    setReaction({ role: character.role, text });
    setImpact({ actor: character.role, target, direction });
  };

  return (
    <div className="debate-character-layer" aria-label="圆桌角色">
      {CHARACTERS.map((character) => {
        const drift = drifts[character.role];
        const isActive = activeRoleSet.has(character.role);
        const isShoving = impact?.actor === character.role;
        const isPushed = impact?.target === character.role;
        const impactX = isShoving ? 34 * impact.direction : isPushed ? 24 * impact.direction : 0;
        const impactY = isShoving ? -4 : isPushed ? 5 : 0;
        const style = {
          "--character-x": `${drift.x}px`,
          "--character-y": `${drift.y}px`,
          "--character-rotation": `${drift.rotation}deg`,
          "--character-duration": `${drift.duration}s`,
          "--impact-x": `${impactX}px`,
          "--impact-y": `${impactY}px`,
        } as CSSProperties;

        return (
          <button
            type="button"
            key={character.role}
            className={cn(
              "debate-character",
              `debate-character-${character.role}`,
              isActive && "debate-character-active",
              isShoving && "debate-character-shoving",
              isPushed && "debate-character-pushed",
            )}
            style={style}
            onClick={() => interact(character)}
            aria-label={`${character.label}，${character.detail}${isActive ? "，正在发言" : ""}`}
          >
            {reaction?.role === character.role ? (
              <span className="debate-character-reaction" role="status">
                {reaction.text}
              </span>
            ) : null}
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
          </button>
        );
      })}
    </div>
  );
}
