"use client";

import NextImage from "next/image";
import { cn } from "@/lib/utils";

export type DebateCharacterRole = "moderator" | "user" | "bull" | "bear";

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
    detail: "主持议程与裁判总结",
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

export default function DebateCharacterStage({
  activeRole,
  activePhase,
  motion,
  status,
  userMessage,
  bullMessage,
  bearMessage,
  judgeMessage,
}: {
  activeRole: DebateCharacterRole | null;
  activePhase?: "started" | "completed" | "blocked" | null;
  motion?: string | null;
  status?: string | null;
  userMessage?: string | null;
  bullMessage?: string | null;
  bearMessage?: string | null;
  judgeMessage?: string | null;
}) {
  const activityText = status?.trim() || "输入问题，主持顾问会安排本轮 Battle";
  const isBlocked = activityText.includes("受阻");
  const bubbles = [
    userMessage ? { role: "user" as const, message: userMessage, muted: false } : null,
    bullMessage ? { role: "bull" as const, message: bullMessage, muted: false } : null,
    bearMessage ? { role: "bear" as const, message: bearMessage, muted: false } : null,
    judgeMessage ? { role: "judge" as const, message: judgeMessage, muted: false } : null,
  ].filter((bubble): bubble is NonNullable<typeof bubble> => Boolean(bubble));

  return (
    <div className="debate-room debate-character-stage">
      <div className="debate-stage" aria-label="多空 Battle 圆桌">
        <header className="debate-stage-header">
          <div>
            <span className="debate-stage-kicker">Live Debate</span>
            <h2>{motion || "等待你提出本轮辩题"}</h2>
          </div>
          <span className={cn("debate-stage-status", isBlocked && "debate-stage-status-blocked")} aria-live="polite">
            <span className="debate-stage-status-dot" />
            {activityText}
          </span>
        </header>

        <div className="debate-table-scene">
          <div className="debate-table-shadow" aria-hidden="true" />
          <div className="debate-table-surface" aria-hidden="true">
            <span className="debate-table-label">共同证据 · 多空交锋 · 裁判总结</span>
          </div>

          <div className="debate-character-layer" aria-label="圆桌角色">
            {CHARACTERS.map((character) => {
              const isActive = activeRole === character.role;
              return (
                <div
                  key={character.role}
                  className={cn(
                    "debate-character",
                    `debate-character-${character.role}`,
                    isActive && "debate-character-active",
                  )}
                  aria-label={`${character.label}，${character.detail}${isActive ? `，${activePhase === "started" ? "正在思考" : "正在发言"}` : ""}`}
                >
                  <span className="debate-character-body">
                    <span className="debate-character-portrait">
                      <NextImage
                        src={character.image}
                        alt=""
                        fill
                        sizes="(max-width: 767px) 68px, 92px"
                        className="debate-character-image"
                      />
                    </span>
                    <span className="debate-character-caption">
                      <strong>{character.label}</strong>
                      <small>{isActive ? characterActivityLabel(activePhase) : character.detail}</small>
                    </span>
                  </span>
                </div>
              );
            })}
          </div>

          {bubbles.map((bubble) => (
            <DebateBubble key={bubble.role} role={bubble.role} message={bubble.message} muted={bubble.muted} />
          ))}
        </div>

        {!bubbles.length ? (
          <p className={cn("debate-stage-empty", isBlocked && "debate-stage-empty-blocked")}>
            {isBlocked
              ? "本轮尚未生成多空观点，请检查模型服务配置后重试。"
              : "Battle 会把共同证据、看多观点、看空观点和裁判总结放在这张桌上。"}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function characterActivityLabel(phase: "started" | "completed" | "blocked" | null | undefined): string {
  if (phase === "started") return "正在思考";
  if (phase === "blocked") return "暂时受阻";
  return "正在发言";
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
  const labels = {
    user: "你的问题",
    bull: "看多 agent",
    bear: "看空 agent",
    judge: "主持顾问 / 裁判",
  };

  return (
    <div className={cn("debate-bubble", `debate-bubble-${role}`, muted && "debate-bubble-muted")}>
      <strong>{labels[role]}</strong>
      <span>{message}</span>
    </div>
  );
}
