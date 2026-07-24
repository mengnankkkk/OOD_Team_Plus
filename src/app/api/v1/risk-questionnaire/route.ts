import { NextResponse } from "next/server";
import { meta } from "@/server/http/context";
import { RISK_QUESTIONNAIRE_VERSION, RISK_QUESTIONS } from "@/lib/risk-assessment";

export async function GET() {
  return NextResponse.json({
    data: {
      version: RISK_QUESTIONNAIRE_VERSION,
      questions: RISK_QUESTIONS.map(({ id, dimension, prompt, helper, options }) => ({
        id,
        type: dimension,
        prompt,
        helper,
        options: options.map(({ value, label }) => ({ value, label })),
      })),
    },
    meta: meta(),
  });
}
