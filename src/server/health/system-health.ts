import { existsSync } from "node:fs";

import { getDatabase, isoNow } from "@/server/http/context";

export type HealthStatus = "READY" | "DEGRADED" | "NOT_READY";

type HealthCheck = {
  name: string;
  status: HealthStatus;
  detail: string;
};

export function getSystemHealth(): {
  status: HealthStatus;
  checkedAt: string;
  checks: HealthCheck[];
} {
  const checks = [databaseCheck(), skillCheck(), pythonCheck(), configurationCheck()];
  return {
    status: checks.some((check) => check.status === "NOT_READY")
      ? "NOT_READY"
      : checks.some((check) => check.status === "DEGRADED")
        ? "DEGRADED"
        : "READY",
    checkedAt: isoNow(),
    checks,
  };
}

function databaseCheck(): HealthCheck {
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT 1 AS ok").get() as { ok?: number };
    const foreignKeys = Number(db.pragma("foreign_keys", { simple: true }) ?? 0);
    const version = Number(db.pragma("user_version", { simple: true }) ?? 0);
    db.close();
    if (row.ok !== 1 || foreignKeys !== 1 || version < 1) {
      return { name: "sqlite", status: "NOT_READY", detail: "数据库校验未通过" };
    }
    return { name: "sqlite", status: "READY", detail: `迁移版本 ${version}，外键已启用` };
  } catch {
    return { name: "sqlite", status: "NOT_READY", detail: "数据库不可用" };
  }
}

function skillCheck(): HealthCheck {
  if (
    existsSync(".agents/skills/pandadata-api/SKILL.md")
    || existsSync(".codex/skills/pandadata-api/SKILL.md")
  ) {
    return { name: "pandadata-skill", status: "READY", detail: "仓库内 Skill 可读取" };
  }
  return { name: "pandadata-skill", status: "NOT_READY", detail: "仓库内 Skill 缺失" };
}

function pythonCheck(): HealthCheck {
  const python = process.env.PANDADATA_PYTHON?.trim();
  return python
    ? { name: "pandadata-runtime", status: "READY", detail: "Python 路径已配置，镜像依赖锁定 panda_data 0.0.12" }
    : { name: "pandadata-runtime", status: "DEGRADED", detail: "未配置 PANDADATA_PYTHON" };
}

function configurationCheck(): HealthCheck {
  const required = [
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_API_URL",
    "DEEPSEEK_MODEL",
    "DEFAULT_USERNAME",
    "DEFAULT_PASSWORD",
    "JAVA_SERVICE_BASE_URL",
    "APP_ORIGIN",
  ];
  const missing = required.filter((key) => !process.env[key]?.trim());
  return missing.length
    ? { name: "external-configuration", status: "DEGRADED", detail: `缺少 ${missing.length} 项外部服务配置` }
    : { name: "external-configuration", status: "READY", detail: "外部服务配置已提供" };
}
