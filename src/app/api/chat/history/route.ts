import { parseHistoryIdentity } from "@/server/chat/contract";
import { jsonError } from "@/server/chat/errors";
import { getDisplayHistory } from "@/server/chat/history";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const identity = parseHistoryIdentity(request.url);
    const messages = await getDisplayHistory(identity);
    return Response.json({ messages });
  } catch (error) {
    return jsonError(error);
  }
}
