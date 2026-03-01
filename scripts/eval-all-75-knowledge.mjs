import OpenAI from "openai";
import { writeFileSync } from "node:fs";

const MODELS = ["gpt-4.1-nano", "gpt-4.1-mini"];
const LEETCODE_75_URL = "https://raw.githubusercontent.com/brprojects/Leetcode_75/main/README.md";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function parseLeetCode75(readme) {
  const lines = readme.split("\n");
  const problems = [];
  let category = "";
  for (const line of lines) {
    const heading = line.match(/^###\s+(.+?)\s+-\s+\[Notes\]/);
    if (heading) {
      category = heading[1].trim();
      continue;
    }
    const m = line.match(/<span style="color:darkblue">(\d+)\.<\/span>\s*([^\-<][^<]+?)\s*-\s*<span style="color:(green|orange)">/);
    if (m) {
      problems.push({
        index: Number(m[1]),
        title: m[2].trim(),
        difficulty: m[3] === "green" ? "Easy" : "Medium",
        category,
      });
    }
  }
  return problems;
}

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function askKnowledge(model, problem) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      in_leetcode_75: { type: "boolean" },
      knows_problem: { type: "boolean" },
      key_idea: { type: "string" },
      edge_case: { type: "string" },
    },
    required: ["in_leetcode_75", "knows_problem", "key_idea", "edge_case"],
  };

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are evaluating knowledge of LeetCode interview problems. Answer strictly and do not guess. 'knows_problem' should be true only if you can state a concrete solving idea and one relevant edge case.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Problem title: ${problem.title}\nExpected topic: ${problem.category}\nReturn JSON only.`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "lc75_knowledge_eval",
        schema,
        strict: true,
      },
    },
    max_output_tokens: 280,
  });

  const parsed = extractJson(response.output_text || "");
  if (!parsed) {
    throw new Error(`Failed JSON parse for ${model} / ${problem.title}`);
  }
  return parsed;
}

async function withRetry(fn, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  console.log("Fetching LeetCode 75 list...");
  const readme = await fetch(LEETCODE_75_URL).then((r) => {
    if (!r.ok) throw new Error(`Failed fetch: ${r.status}`);
    return r.text();
  });

  const problems = parseLeetCode75(readme);
  if (problems.length !== 75) {
    throw new Error(`Expected 75 problems, got ${problems.length}`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: LEETCODE_75_URL,
    models: {},
  };

  for (const model of MODELS) {
    console.log(`\\n=== ${model} ===`);
    const results = [];

    for (const p of problems) {
      const res = await withRetry(() => askKnowledge(model, p));
      const inSetPass = res.in_leetcode_75 === true;
      const knowsPass = res.knows_problem === true;
      results.push({
        index: p.index,
        title: p.title,
        category: p.category,
        difficulty: p.difficulty,
        in_leetcode_75: res.in_leetcode_75,
        knows_problem: res.knows_problem,
        key_idea: res.key_idea,
        edge_case: res.edge_case,
        inSetPass,
        knowsPass,
      });

      if (p.index % 10 === 0 || p.index === 75) {
        const passCount = results.filter((x) => x.inSetPass).length;
        process.stdout.write(`  progress ${p.index}/75 | in-set pass ${passCount}/` + results.length + "\\n");
      }
    }

    const inSetPassCount = results.filter((x) => x.inSetPass).length;
    const knowsPassCount = results.filter((x) => x.knowsPass).length;
    const missedInSet = results.filter((x) => !x.inSetPass).map((x) => ({ index: x.index, title: x.title }));
    const unknownProblems = results.filter((x) => !x.knowsPass).map((x) => ({ index: x.index, title: x.title }));

    report.models[model] = {
      inSetPassCount,
      knowsPassCount,
      total: 75,
      all75InSet: inSetPassCount === 75,
      all75Known: knowsPassCount === 75,
      missedInSet,
      unknownProblems,
      perProblem: results,
    };

    console.log(
      `Summary ${model}: in-set ${inSetPassCount}/75, knows ${knowsPassCount}/75, all75InSet=${inSetPassCount === 75}, all75Known=${knowsPassCount === 75}`,
    );
  }

  writeFileSync("./eval-all-75-knowledge-report.json", JSON.stringify(report, null, 2));
  console.log("\\nSaved report: eval-all-75-knowledge-report.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
