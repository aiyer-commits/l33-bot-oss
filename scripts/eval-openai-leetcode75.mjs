import OpenAI from "openai";
import { randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const MODELS = ["gpt-4.1-nano", "gpt-4.1-mini", "gpt-4.1"];
const LEETCODE_75_URL = "https://raw.githubusercontent.com/brprojects/Leetcode_75/main/README.md";

const NEGATIVE_TITLES = [
  "Two Sum",
  "Add Two Numbers",
  "Valid Parentheses",
  "Roman to Integer",
  "Longest Palindromic Substring",
  "Word Break",
  "Course Schedule II",
  "Top K Frequent Elements",
  "Merge Two Sorted Lists",
  "Climbing Stairs",
  "3Sum",
  "LRU Cache",
  "Palindrome Number",
  "Binary Tree Inorder Traversal",
  "Group Anagrams",
];

const JUDGE_CASES = [
  {
    id: "two_sum_correct",
    title: "Two Sum",
    functionName: "twoSum",
    expectedVerdict: "correct",
    candidateCode: `def twoSum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n    return []`,
    tests: [
      { args: [[2, 7, 11, 15], 9], expected: [0, 1], comparator: "set_eq" },
      { args: [[3, 2, 4], 6], expected: [1, 2], comparator: "set_eq" },
      { args: [[3, 3], 6], expected: [0, 1], comparator: "set_eq" },
    ],
  },
  {
    id: "two_sum_wrong_values",
    title: "Two Sum",
    functionName: "twoSum",
    expectedVerdict: "incorrect",
    candidateCode: `def twoSum(nums, target):\n    for i in range(len(nums)):\n        for j in range(i+1, len(nums)):\n            if nums[i] + nums[j] == target:\n                return [nums[i], nums[j]]\n    return []`,
    tests: [
      { args: [[2, 7, 11, 15], 9], expected: [0, 1], comparator: "set_eq" },
      { args: [[3, 2, 4], 6], expected: [1, 2], comparator: "set_eq" },
      { args: [[3, 3], 6], expected: [0, 1], comparator: "set_eq" },
    ],
  },
  {
    id: "product_except_self_division",
    title: "Product of Array Except Self",
    functionName: "productExceptSelf",
    expectedVerdict: "incorrect",
    candidateCode: `def productExceptSelf(nums):\n    total = 1\n    for n in nums:\n        total *= n\n    return [total // n for n in nums]`,
    tests: [
      { args: [[1, 2, 3, 4]], expected: [24, 12, 8, 6] },
      { args: [[-1, 1, 0, -3, 3]], expected: [0, 0, 9, 0, 0] },
      { args: [[0, 0]], expected: [0, 0] },
    ],
  },
  {
    id: "max_subarray_quadratic",
    title: "Maximum Subarray",
    functionName: "maxSubArray",
    expectedVerdict: "tle",
    candidateCode: `def maxSubArray(nums):\n    best = -10**18\n    for i in range(len(nums)):\n        s = 0\n        for j in range(i, len(nums)):\n            s += nums[j]\n            if s > best:\n                best = s\n    return best`,
    tests: [
      { args: [[-2,1,-3,4,-1,2,1,-5,4]], expected: 6 },
      { args: [[1]], expected: 1 },
      { args: [[5,4,-1,7,8]], expected: 23 },
    ],
  },
  {
    id: "container_bruteforce",
    title: "Container With Most Water",
    functionName: "maxArea",
    expectedVerdict: "tle",
    candidateCode: `def maxArea(height):\n    ans = 0\n    n = len(height)\n    for i in range(n):\n        for j in range(i+1, n):\n            ans = max(ans, (j - i) * min(height[i], height[j]))\n    return ans`,
    tests: [
      { args: [[1,8,6,2,5,4,8,3,7]], expected: 49 },
      { args: [[1,1]], expected: 1 },
      { args: [[4,3,2,1,4]], expected: 16 },
    ],
  },
  {
    id: "pivot_index_wrong",
    title: "Find Pivot Index",
    functionName: "pivotIndex",
    expectedVerdict: "incorrect",
    candidateCode: `def pivotIndex(nums):\n    left = 0\n    right = sum(nums)\n    for i, n in enumerate(nums):\n        right -= n\n        if left >= right:\n            return i\n        left += n\n    return -1`,
    tests: [
      { args: [[1,7,3,6,5,6]], expected: 3 },
      { args: [[1,2,3]], expected: -1 },
      { args: [[2,1,-1]], expected: 0 },
    ],
  },
  {
    id: "is_subsequence_correct",
    title: "Is Subsequence",
    functionName: "isSubsequence",
    expectedVerdict: "correct",
    candidateCode: `def isSubsequence(s, t):\n    i = 0\n    for ch in t:\n        if i < len(s) and s[i] == ch:\n            i += 1\n    return i == len(s)`,
    tests: [
      { args: ["abc", "ahbgdc"], expected: true },
      { args: ["axc", "ahbgdc"], expected: false },
      { args: ["", "ahbgdc"], expected: true },
    ],
  },
  {
    id: "longest_ones_wrong_edge",
    title: "Longest Subarray of 1's After Deleting One Element",
    functionName: "longestSubarray",
    expectedVerdict: "incorrect",
    candidateCode: `def longestSubarray(nums):\n    best = 0\n    cur = 0\n    for n in nums:\n        if n == 1:\n            cur += 1\n            best = max(best, cur)\n        else:\n            cur = 0\n    return best`,
    tests: [
      { args: [[1,1,0,1]], expected: 3 },
      { args: [[0,1,1,1,0,1,1,0,1]], expected: 5 },
      { args: [[1,1,1]], expected: 2 },
    ],
  },
  {
    id: "rotting_oranges_correct",
    title: "Rotting Oranges",
    functionName: "orangesRotting",
    expectedVerdict: "correct",
    candidateCode: `from collections import deque\n\ndef orangesRotting(grid):\n    rows, cols = len(grid), len(grid[0])\n    q = deque()\n    fresh = 0\n    for r in range(rows):\n        for c in range(cols):\n            if grid[r][c] == 2:\n                q.append((r, c))\n            elif grid[r][c] == 1:\n                fresh += 1\n\n    minutes = 0\n    dirs = [(1,0),(-1,0),(0,1),(0,-1)]\n    while q and fresh:\n        for _ in range(len(q)):\n            r, c = q.popleft()\n            for dr, dc in dirs:\n                nr, nc = r + dr, c + dc\n                if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] == 1:\n                    grid[nr][nc] = 2\n                    fresh -= 1\n                    q.append((nr, nc))\n        minutes += 1\n\n    return minutes if fresh == 0 else -1`,
    tests: [
      { args: [[[2,1,1],[1,1,0],[0,1,1]]], expected: 4 },
      { args: [[[2,1,1],[0,1,1],[1,0,1]]], expected: -1 },
      { args: [[[0,2]]], expected: 0 },
    ],
  },
  {
    id: "stock_wrong_order",
    title: "Best Time to Buy and Sell Stock",
    functionName: "maxProfit",
    expectedVerdict: "incorrect",
    candidateCode: `def maxProfit(prices):\n    return max(prices) - min(prices)`,
    tests: [
      { args: [[7,1,5,3,6,4]], expected: 5 },
      { args: [[7,6,4,3,1]], expected: 0 },
      { args: [[2,4,1]], expected: 2 },
    ],
  },
];

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function seededSample(arr, count, seed = 1337) {
  const out = [...arr];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, count);
}

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

async function askJson({ model, systemPrompt, userPrompt, schemaName, schema }) {
  const response = await client.responses.create({
    model,
    input: [
      { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
      { role: "user", content: [{ type: "input_text", text: userPrompt }] },
    ],
    text: {
      format: {
        type: "json_schema",
        name: schemaName,
        schema,
        strict: true,
      },
    },
    max_output_tokens: 900,
  });

  const text = response.output_text ?? "";
  const parsed = extractJson(text);
  if (!parsed) {
    throw new Error(`Failed to parse JSON for ${model}: ${text.slice(0, 300)}`);
  }
  return parsed;
}

function cleanCode(raw) {
  if (!raw) return "";
  const fenced = raw.match(/```(?:python)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : raw).trim();
}

function runPythonTests({ code, functionName, tests }) {
  const payload = JSON.stringify({ code, functionName, tests });
  const py = String.raw`
import json
import traceback

def cmp(got, expected, comparator):
    if comparator == "set_eq":
        try:
            return set(got) == set(expected)
        except Exception:
            return False
    if comparator == "sorted_eq":
        try:
            return sorted(got) == sorted(expected)
        except Exception:
            return False
    return got == expected

payload = json.loads(${JSON.stringify(payload)})
ns = {}
out = {"ok": False, "details": []}
try:
    exec(payload["code"], ns, ns)
    fn = ns.get(payload["functionName"])
    if fn is None and "Solution" in ns:
        obj = ns["Solution"]()
        fn = getattr(obj, payload["functionName"], None)
    if fn is None:
        raise Exception(f"Function not found: {payload['functionName']}")

    all_ok = True
    for i, t in enumerate(payload["tests"]):
        got = fn(*t["args"])
        ok = cmp(got, t["expected"], t.get("comparator"))
        out["details"].append({"idx": i, "ok": ok, "got": got, "expected": t["expected"]})
        if not ok:
            all_ok = False
    out["ok"] = all_ok
except Exception as e:
    out["error"] = str(e)
    out["traceback"] = traceback.format_exc()

print(json.dumps(out))
`;

  const proc = spawnSync("python3", ["-c", py], { encoding: "utf8", timeout: 10000 });
  if (proc.error) {
    return { ok: false, error: proc.error.message };
  }
  if (proc.status !== 0) {
    return { ok: false, error: proc.stderr || `python exit ${proc.status}` };
  }
  try {
    return JSON.parse(proc.stdout.trim());
  } catch {
    return { ok: false, error: `invalid python output: ${proc.stdout.slice(0, 200)}` };
  }
}

async function evalKnowledge(model, positives, negatives) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      in_leetcode_75: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      primary_topic: { type: "string" },
      one_sentence_recap: { type: "string" },
    },
    required: ["in_leetcode_75", "confidence", "primary_topic", "one_sentence_recap"],
  };

  const positiveResults = [];
  for (const p of positives) {
    const res = await askJson({
      model,
      systemPrompt:
        "You are a LeetCode curriculum assistant. Determine whether a problem belongs to the LeetCode 75 study plan and briefly recap it.",
      userPrompt: `Problem title: ${p.title}\nReturn your judgment and recap.`,
      schemaName: "lc75_knowledge_single",
      schema,
    });
    positiveResults.push({
      title: p.title,
      expectedInSet: true,
      predictedInSet: res.in_leetcode_75,
      recapLength: res.one_sentence_recap?.length ?? 0,
      topic: res.primary_topic,
      confidence: res.confidence,
      pass: res.in_leetcode_75 === true && (res.one_sentence_recap?.length ?? 0) >= 20,
    });
  }

  const negativeResults = [];
  for (const title of negatives) {
    const res = await askJson({
      model,
      systemPrompt:
        "You are a LeetCode curriculum assistant. Determine whether a problem belongs to the LeetCode 75 study plan and briefly recap it.",
      userPrompt: `Problem title: ${title}\nReturn your judgment and recap.`,
      schemaName: "lc75_knowledge_single",
      schema,
    });
    negativeResults.push({
      title,
      expectedInSet: false,
      predictedInSet: res.in_leetcode_75,
      confidence: res.confidence,
      pass: res.in_leetcode_75 === false,
    });
  }

  const posPass = positiveResults.filter((r) => r.pass).length;
  const negPass = negativeResults.filter((r) => r.pass).length;

  return {
    positiveResults,
    negativeResults,
    positivePassRate: posPass / positiveResults.length,
    negativePassRate: negPass / negativeResults.length,
    membershipAccuracy: (posPass + negPass) / (positiveResults.length + negativeResults.length),
  };
}

async function evalJudging(model) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      verdict: { type: "string", enum: ["correct", "incorrect", "tle"] },
      reasoning: { type: "string" },
      edge_cases: {
        type: "array",
        items: { type: "string" },
      },
      corrected_code: { type: ["string", "null"] },
    },
    required: ["verdict", "reasoning", "edge_cases", "corrected_code"],
  };

  const details = [];

  for (const c of JUDGE_CASES) {
    const res = await askJson({
      model,
      systemPrompt:
        "You are grading a student's Python LeetCode solution. Classify only as correct, incorrect, or tle. Use tle when time complexity is too slow for typical LeetCode constraints. Always list at least 2 edge cases. If verdict is incorrect or tle, include corrected Python code for the same function signature.",
      userPrompt: `Problem: ${c.title}\nFunction name: ${c.functionName}\nStudent code:\n\n${c.candidateCode}`,
      schemaName: "judge_solution",
      schema,
    });

    const verdictMatch = res.verdict === c.expectedVerdict;
    const edgeCaseOk = Array.isArray(res.edge_cases) && res.edge_cases.filter((x) => typeof x === "string" && x.trim().length > 0).length >= 2;

    let correctionPass = null;
    let correctionError = null;

    if (c.expectedVerdict !== "correct") {
      const code = cleanCode(res.corrected_code || "");
      if (!code) {
        correctionPass = false;
        correctionError = "missing corrected_code";
      } else {
        const run = runPythonTests({ code, functionName: c.functionName, tests: c.tests });
        correctionPass = !!run.ok;
        if (!run.ok) {
          correctionError = run.error || JSON.stringify(run.details || []).slice(0, 250);
        }
      }
    }

    const pass =
      c.expectedVerdict === "correct"
        ? verdictMatch && edgeCaseOk
        : verdictMatch && edgeCaseOk && correctionPass === true;

    details.push({
      id: c.id,
      title: c.title,
      expectedVerdict: c.expectedVerdict,
      predictedVerdict: res.verdict,
      verdictMatch,
      edgeCaseOk,
      correctionPass,
      correctionError,
      pass,
    });
  }

  const passCount = details.filter((d) => d.pass).length;
  const verdictAccuracy = details.filter((d) => d.verdictMatch).length / details.length;
  const edgeCaseCoverage = details.filter((d) => d.edgeCaseOk).length / details.length;
  const correctionCases = details.filter((d) => d.expectedVerdict !== "correct");
  const correctionSuccessRate =
    correctionCases.filter((d) => d.correctionPass === true).length / Math.max(correctionCases.length, 1);

  return {
    details,
    overallPassRate: passCount / details.length,
    verdictAccuracy,
    edgeCaseCoverage,
    correctionSuccessRate,
  };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  console.log("Fetching LeetCode 75 list from GitHub...");
  const readme = await fetch(LEETCODE_75_URL).then((r) => {
    if (!r.ok) throw new Error(`Failed to fetch LeetCode 75 list: ${r.status}`);
    return r.text();
  });

  const problems = parseLeetCode75(readme);
  if (problems.length < 75) {
    throw new Error(`Parsed only ${problems.length} problems; expected 75`);
  }

  const sampledPositives = seededSample(problems, 10, randomInt(1, 1_000_000));
  const negativePool = NEGATIVE_TITLES.filter(
    (t) => !problems.some((p) => p.title.toLowerCase() === t.toLowerCase()),
  );
  const sampledNegatives = seededSample(negativePool, 10, 42);

  const report = {
    generatedAt: new Date().toISOString(),
    leetcode75Source: LEETCODE_75_URL,
    models: {},
    sampledPositiveTitles: sampledPositives.map((p) => p.title),
    sampledNegativeTitles: sampledNegatives,
  };

  for (const model of MODELS) {
    console.log(`\\n=== Evaluating ${model} ===`);

    const knowledge = await evalKnowledge(model, sampledPositives, sampledNegatives);
    console.log(
      `Knowledge membership accuracy: ${(knowledge.membershipAccuracy * 100).toFixed(1)}% (pos ${(knowledge.positivePassRate * 100).toFixed(1)}%, neg ${(knowledge.negativePassRate * 100).toFixed(1)}%)`,
    );

    const judging = await evalJudging(model);
    console.log(
      `Judging: pass ${(judging.overallPassRate * 100).toFixed(1)}%, verdict ${(judging.verdictAccuracy * 100).toFixed(1)}%, edge-cases ${(judging.edgeCaseCoverage * 100).toFixed(1)}%, corrections ${(judging.correctionSuccessRate * 100).toFixed(1)}%`,
    );

    report.models[model] = { knowledge, judging };
  }

  const outPath = "./eval-report.json";
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\\nSaved full report to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
