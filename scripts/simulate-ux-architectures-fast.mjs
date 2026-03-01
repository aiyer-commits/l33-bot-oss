import OpenAI from "openai";
import { writeFileSync } from "node:fs";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = "gpt-4.1-mini";

const PROBLEMS = [
  { id: 7, title: "Product of Array Except Self", tags: ["arrays", "prefix/suffix", "O(n)"] },
  { id: 48, title: "Rotting Oranges", tags: ["bfs"] },
  { id: 64, title: "Longest Common Subsequence", tags: ["dp"] },
];

const LEARNERS = [
  { id: "novice", profile: "Beginner in DSA, frequent confusion on complexity, writes buggy code." },
  { id: "advanced", profile: "Mostly strong, occasional slips on implementation details." },
];

const ARCHITECTURES = [
  {
    id: "single_call",
    description: "One tutor call handles guidance, grading, hints, and mastery decision.",
  },
  {
    id: "multi_call",
    description: "Planner + Tutor + Grader + Mastery calls with structured JSON state exchange.",
  },
];

function rubricPrompt() {
  return [
    "Score from 1-5 each:",
    "1) Pedagogy quality (Socratic, not giving away too early)",
    "2) Correctness quality (algorithm + edge cases)",
    "3) Conversation flow for mobile (short, actionable turns)",
    "4) Motivation/clarity for continued practice",
    "5) Mastery reliability (not falsely marking mastered)",
    "Return JSON with per-dimension score and short rationale.",
  ].join("\n");
}

async function textResponse({ system, user, max_output_tokens = 700, response_format = null }) {
  const payload = {
    model: MODEL,
    input: [
      { role: "system", content: [{ type: "input_text", text: system }] },
      { role: "user", content: [{ type: "input_text", text: user }] },
    ],
    max_output_tokens,
  };

  if (response_format) payload.text = response_format;

  const res = await client.responses.create(payload);
  return { text: res.output_text || "", usage: res.usage || {} };
}

async function planner(problem, learnerState) {
  const system = "You are a practice planner. Return compact JSON only.";
  const schema = {
    type: "json_schema",
    name: "plan",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["problem_focus", "goal", "hint_budget"],
      properties: {
        problem_focus: { type: "string" },
        goal: { type: "string" },
        hint_budget: { type: "integer", minimum: 0, maximum: 4 },
      },
    },
  };

  const { text } = await textResponse({
    system,
    user: `Problem: ${problem.title}\nLearner state: ${JSON.stringify(learnerState)}`,
    response_format: { format: schema },
    max_output_tokens: 180,
  });

  return JSON.parse(text);
}

async function tutorTurnSingle(problem, history, learnerState, submission) {
  const system = [
    "You are a mobile-first LeetCode tutor.",
    "Keep responses <= 120 words.",
    "Socratic first. Don't reveal full solution unless user asks directly or has failed repeatedly.",
    "Evaluate user's algorithm/code and identify correctness, complexity, edge-cases.",
    "At end, include one line `MASTERY_SIGNAL: yes|no`.",
  ].join("\n");

  const user = [
    `Problem: ${problem.title}`,
    `Learner state: ${JSON.stringify(learnerState)}`,
    `Conversation so far: ${JSON.stringify(history.slice(-6))}`,
    submission ? `Latest user submission:\n${submission}` : "No submission yet.",
  ].join("\n\n");

  const { text } = await textResponse({ system, user, max_output_tokens: 380 });
  return text;
}

async function tutorTurnMulti(problem, history, learnerState, submission, plan) {
  const tutorSystem = [
    "You are a mobile-first LeetCode tutor.",
    "Keep responses <= 90 words.",
    "Use Socratic guidance and one concrete next step.",
  ].join("\n");

  const tutorUser = [
    `Problem: ${problem.title}`,
    `Plan: ${JSON.stringify(plan)}`,
    `Recent history: ${JSON.stringify(history.slice(-4))}`,
    submission ? `Latest user submission:\n${submission}` : "No submission yet.",
  ].join("\n\n");

  const tutor = await textResponse({ system: tutorSystem, user: tutorUser, max_output_tokens: 240 });

  const graderSystem = "Return strict JSON grading: verdict(correct|partial|incorrect|tle_risk), key_issue, next_test_case.";
  const graderSchema = {
    type: "json_schema",
    name: "grade",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["verdict", "key_issue", "next_test_case"],
      properties: {
        verdict: { type: "string", enum: ["correct", "partial", "incorrect", "tle_risk"] },
        key_issue: { type: "string" },
        next_test_case: { type: "string" },
      },
    },
  };

  const grader = await textResponse({
    system: graderSystem,
    user: `Problem: ${problem.title}\nSubmission:\n${submission || ""}`,
    response_format: { format: graderSchema },
    max_output_tokens: 180,
  });

  const grade = JSON.parse(grader.text);

  const masterySystem = "Return strict JSON: mastered(boolean), reason(string). Be conservative.";
  const masterySchema = {
    type: "json_schema",
    name: "mastery",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["mastered", "reason"],
      properties: {
        mastered: { type: "boolean" },
        reason: { type: "string" },
      },
    },
  };

  const mastery = await textResponse({
    system: masterySystem,
    user: `Problem: ${problem.title}\nGrade: ${JSON.stringify(grade)}\nRecent history: ${JSON.stringify(history.slice(-6))}`,
    response_format: { format: masterySchema },
    max_output_tokens: 120,
  });

  return {
    tutorText: tutor.text,
    grade,
    mastery: JSON.parse(mastery.text),
  };
}

async function learnerReply(learner, problem, tutorMessage, turn) {
  const system = [
    "You are simulating a real learner in a mobile chat coding app.",
    "Behave naturally, dynamically, and non-prescriptively.",
    "Sometimes ask clarifying questions. Sometimes send pseudocode or Python.",
    "Keep message <= 100 words.",
  ].join("\n");

  const user = [
    `Learner profile: ${learner.profile}`,
    `Problem: ${problem.title}`,
    `Tutor message: ${tutorMessage}`,
    `Turn number: ${turn}`,
    "Respond as the learner only.",
  ].join("\n\n");

  const { text } = await textResponse({ system, user, max_output_tokens: 220 });
  return text;
}

async function judgeTranscript(architectureId, transcript, outcomes) {
  const system = "You are evaluating tutoring UX quality for a mobile learning app.";
  const user = [
    `Architecture: ${architectureId}`,
    `Outcomes: ${JSON.stringify(outcomes)}`,
    `Transcript (trimmed): ${JSON.stringify(transcript.slice(-18))}`,
    rubricPrompt(),
    "Return strict JSON with fields: pedagogy, correctness, flow, motivation, mastery_reliability, summary.",
  ].join("\n\n");

  const schema = {
    type: "json_schema",
    name: "rubric",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["pedagogy", "correctness", "flow", "motivation", "mastery_reliability", "summary"],
      properties: {
        pedagogy: { type: "integer", minimum: 1, maximum: 5 },
        correctness: { type: "integer", minimum: 1, maximum: 5 },
        flow: { type: "integer", minimum: 1, maximum: 5 },
        motivation: { type: "integer", minimum: 1, maximum: 5 },
        mastery_reliability: { type: "integer", minimum: 1, maximum: 5 },
        summary: { type: "string" },
      },
    },
  };

  const { text } = await textResponse({ system, user, response_format: { format: schema }, max_output_tokens: 280 });
  return JSON.parse(text);
}

function aggregateScores(entries) {
  const init = { pedagogy: 0, correctness: 0, flow: 0, motivation: 0, mastery_reliability: 0 };
  for (const e of entries) {
    init.pedagogy += e.pedagogy;
    init.correctness += e.correctness;
    init.flow += e.flow;
    init.motivation += e.motivation;
    init.mastery_reliability += e.mastery_reliability;
  }
  const n = Math.max(entries.length, 1);
  for (const k of Object.keys(init)) init[k] = Number((init[k] / n).toFixed(2));
  init.composite = Number(((init.pedagogy + init.correctness + init.flow + init.motivation + init.mastery_reliability) / 5).toFixed(2));
  return init;
}

async function runScenario(architecture, learner, problem) {
  const transcript = [];
  let learnerState = { confidence: 0.4, failedAttempts: 0, hintsUsed: 0 };
  let mastered = false;

  let userMsg = `Can we practice ${problem.title}?`;
  transcript.push({ role: "user", content: userMsg });

  for (let turn = 1; turn <= 7; turn++) {
    if (architecture.id === "single_call") {
      const tutorText = await tutorTurnSingle(problem, transcript, learnerState, userMsg);
      transcript.push({ role: "assistant", content: tutorText });
      const m = /MASTERY_SIGNAL:\s*(yes|no)/i.exec(tutorText);
      mastered = m ? m[1].toLowerCase() === "yes" : false;
      if (mastered) break;
      userMsg = await learnerReply(learner, problem, tutorText, turn);
      if (/hint/i.test(userMsg)) learnerState.hintsUsed += 1;
      if (/wrong|don't get|confus/i.test(userMsg)) learnerState.failedAttempts += 1;
      transcript.push({ role: "user", content: userMsg });
    } else {
      const plan = await planner(problem, learnerState);
      const out = await tutorTurnMulti(problem, transcript, learnerState, userMsg, plan);
      const combined = `${out.tutorText}\n\n[grade=${out.grade.verdict}; issue=${out.grade.key_issue}; next=${out.grade.next_test_case}]`;
      transcript.push({ role: "assistant", content: combined });
      mastered = out.mastery.mastered;
      if (out.grade.verdict !== "correct") learnerState.failedAttempts += 1;
      if (out.grade.verdict === "correct") learnerState.confidence = Math.min(1, learnerState.confidence + 0.2);
      if (mastered) break;
      userMsg = await learnerReply(learner, problem, combined, turn);
      transcript.push({ role: "user", content: userMsg });
    }
  }

  const outcomes = {
    mastered,
    turns: transcript.length,
    failedAttempts: learnerState.failedAttempts,
    hintsUsed: learnerState.hintsUsed,
  };
  const rubric = await judgeTranscript(architecture.id, transcript, outcomes);

  return { architecture: architecture.id, learner: learner.id, problem: problem.title, outcomes, rubric, transcript };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");

  const scenarios = [];

  for (const architecture of ARCHITECTURES) {
    for (const learner of LEARNERS) {
      for (const problem of PROBLEMS) {
        process.stdout.write(`running ${architecture.id} | ${learner.id} | ${problem.title}\n`);
        const scenario = await runScenario(architecture, learner, problem);
        scenarios.push(scenario);
      }
    }
  }

  const byArch = {};
  for (const arch of ARCHITECTURES) {
    const rows = scenarios.filter((s) => s.architecture === arch.id);
    byArch[arch.id] = {
      rubricAverages: aggregateScores(rows.map((r) => r.rubric)),
      masteryRate: Number((rows.filter((r) => r.outcomes.mastered).length / rows.length).toFixed(2)),
      avgTurns: Number((rows.reduce((a, r) => a + r.outcomes.turns, 0) / rows.length).toFixed(2)),
      avgFailedAttempts: Number((rows.reduce((a, r) => a + r.outcomes.failedAttempts, 0) / rows.length).toFixed(2)),
      count: rows.length,
    };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    problems: PROBLEMS.map((p) => p.title),
    learners: LEARNERS.map((l) => l.id),
    architectures: ARCHITECTURES,
    aggregate: byArch,
    scenarios,
  };

  writeFileSync("./simulation-ux-architectures-report.json", JSON.stringify(report, null, 2));
  console.log("saved ./simulation-ux-architectures-report.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
