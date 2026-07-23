import { z } from "zod";

export const chatMessageSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  role: z.literal("user"),
  parts: z
    .array(
      z.object({
        type: z.literal("text"),
        text: z.string().trim().min(1).max(4_000),
      }),
    )
    .length(1),
});

export const memoryIdentitySchema = z.object({
  thread: z.uuid(),
  resource: z.uuid(),
});

export const chatRequestSchema = z.object({
  message: chatMessageSchema,
  memory: memoryIdentitySchema,
}).transform(({ message, memory }) => ({
  message: { ...message, id: crypto.randomUUID() },
  memory,
}));

export type MemoryIdentity = z.infer<typeof memoryIdentitySchema>;

export function parseHistoryIdentity(url: string) {
  const searchParams = new URL(url).searchParams;
  return memoryIdentitySchema.parse({
    thread: searchParams.get("thread"),
    resource: searchParams.get("resource"),
  });
}
