import { NextRequest } from "next/server";

import { authError, localizedJson } from "@/server/auth/http";
import { getRequestContext, meta } from "@/server/http/context";

export async function GET(request: NextRequest) {
  try {
    const context = getRequestContext(request);
    return localizedJson({ data: { user: context.user }, meta: meta() }, 200, context.locale.locale);
  } catch (error) {
    return authError(error, request);
  }
}
