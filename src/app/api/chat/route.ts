import { chatRequestSchema } from "@/server/chat/contract";
import { jsonError } from "@/server/chat/errors";
import { requireDeepSeekApiKey } from "@/server/chat/environment";
import { streamChat } from "@/server/chat/stream";
import { getRequestContext } from "@/server/http/context";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = chatRequestSchema.parse(await request.json());
    requireDeepSeekApiKey();
    return await streamChat(body, request.signal, getRequestContext(request as never));
  } catch (error) {
    return jsonError(error);
  }
}
