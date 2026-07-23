import type { MemoryIdentity } from "@/server/chat/contract";

const THREAD_KEY = "money-whisperer.thread";
const RESOURCE_KEY = "money-whisperer.resource";

function getOrCreate(key: string) {
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;

  const value = crypto.randomUUID();
  sessionStorage.setItem(key, value);
  return value;
}

export function getSessionIdentity(): MemoryIdentity {
  return {
    thread: getOrCreate(THREAD_KEY),
    resource: getOrCreate(RESOURCE_KEY),
  };
}
