import OpenAI from "openai";
import { NextResponse } from "next/server";
import { getProblemById, leetcode75 } from "@/lib/leetcode75";
import type { ChatApiRequest, ChatApiResponse } from "@/lib/types";

const MODEL = "gpt-4.1-mini";

function isChatApiRequest(value: unknown): value is ChatApiRequest {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.message === "string" &&
    typeof data.code === "string" &&
    typeof data.activeProblemId === "number" &&
    Array.isArray(data.conversation) &&
    typeof data.profile === "object" &&
    data.profile !== null
  );
}

function compactProfileSummary(input: ChatApiRequest): string {
  const mastered = input.profile.problems.filter((p) => p.status === "mastered").length;
  const learning = input.profile.problems.filter(
    (p) => p.status === "learning" || p.status === "approaching" || p.status === "review",
  ).length;
  const current = input.profile.problems.find((p) => p.id === input.activeProblemId);

  return [
    `Mastered: ${mastered}/75`,
    `In progress: ${learning}`,
    `Current problem id: ${input.activeProblemId}`,
    `Current status: ${current?.status ?? "unseen"}`,
    `Current confidence: ${current?.confidence ?? 0}`,
    `Current attempts: ${current?.attempts ?? 0}`,
    `Current assessment: ${current?.lastAssessment ?? ""}`,
  ].join("\n");
}

function compactCatalog() {
  return leetcode75
    .map((problem) => `${problem.id}. ${problem.title} | ${problem.difficulty} | ${problem.category}`)
    .join("\n");
}

function schema() {
  return {
    type: "json_schema" as const,
    name: "l33tsp33k_response",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["assistantMessage", "assessment", "quickActions"],
      properties: {
        assistantMessage: { type: "string" },
        assessment: {
          type: "object",
          additionalProperties: false,
          required: [
            "status",
            "confidence",
            "attemptsDelta",
            "markMastered",
            "moveToProblemId",
            "summaryNote",
            "nextStep",
          ],
          properties: {
            status: {
              type: "string",
              enum: ["learning", "approaching", "review", "mastered"],
            },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            attemptsDelta: { type: "integer", minimum: 0, maximum: 2 },
            markMastered: { type: "boolean" },
            moveToProblemId: { type: "integer", minimum: 1, maximum: 75 },
            summaryNote: { type: "string" },
            nextStep: { type: "string" },
          },
        },
        quickActions: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: { type: "string" },
        },
      },
    },
  };
}

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 500 });
  }

  const body: unknown = await request.json();
  if (!isChatApiRequest(body)) {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const currentProblem = getProblemById(body.activeProblemId);
  if (!currentProblem) {
    return NextResponse.json({ error: "Invalid activeProblemId" }, { status: 400 });
  }

  const nextProblem = getProblemById(Math.min(75, body.activeProblemId + 1));

  const recentConversation = body.conversation.slice(-10);

  const systemPrompt = [
    "You are L33tSp33k, a mobile-first LeetCode tutor focused on skill building.",
    "You are helping the learner complete LeetCode 75 in order from #1 to #75.",
    "Track learner mastery conversationally. The app stores your tracking locally.",
    "Do not ask the user to manually mark progress.",
    "Be concise and practical. Keep assistantMessage <= 140 words.",
    "Always evaluate correctness, edge cases, and complexity, especially TLE risk.",
    "When user code is wrong, explain the key bug and give a targeted correction path.",
    "Only mark mastery when the learner demonstrates understanding and a viable solution.",
    "Set moveToProblemId > current id only when markMastered is true or user explicitly asks to move.",
    "If the learner asks for a specific type (e.g. medium monotonic stack), choose the best matching problem id from the catalog.",
  ].join("\n");

  const userPrompt = [
    `Current problem (${currentProblem.id}/75): ${currentProblem.title}`,
    `Difficulty: ${currentProblem.difficulty}`,
    `Category: ${currentProblem.category}`,
    `Statement: ${currentProblem.statement}`,
    `LeetCode URL: ${currentProblem.leetcodeUrl}`,
    nextProblem ? `Next problem in order: #${nextProblem.id} ${nextProblem.title}` : "",
    "",
    "Full LC75 catalog (id | title | difficulty | category):",
    compactCatalog(),
    "",
    "Profile summary:",
    compactProfileSummary(body),
    "",
    "Recent conversation:",
    JSON.stringify(recentConversation),
    "",
    `Latest learner message: ${body.message}`,
    body.code.trim() ? `Latest learner code:\n${body.code}` : "Latest learner code: (none)",
    "",
    "Return JSON only with assistantMessage + assessment + quickActions.",
  ].join("\n");

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: MODEL,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: userPrompt }],
        },
      ],
      text: {
        format: schema(),
      },
      max_output_tokens: 500,
    });

    const text = response.output_text ?? "";
    const parsed = JSON.parse(text) as ChatApiResponse;

    if (!parsed.assessment.markMastered && parsed.assessment.moveToProblemId > body.activeProblemId) {
      parsed.assessment.moveToProblemId = body.activeProblemId;
    }

    if (parsed.assessment.moveToProblemId < 1 || parsed.assessment.moveToProblemId > leetcode75.length) {
      parsed.assessment.moveToProblemId = body.activeProblemId;
    }

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("chat api error", error);
    return NextResponse.json(
      {
        error:
          "Tutor call failed. Verify OPENAI_API_KEY and retry. If this repeats, reduce message length and try again.",
      },
      { status: 500 },
    );
  }
}
