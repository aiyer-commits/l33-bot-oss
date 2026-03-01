import OpenAI from "openai";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const MODELS = ["gpt-4.1-mini", "gpt-4.1"];

// Standard text pricing per 1M tokens (OpenAI pricing docs)
const PRICING = {
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1": { input: 2.0, cachedInput: 0.5, output: 8.0 },
};

const SOLVE_CASES = [
  {
    id: "merge_alternately",
    title: "Merge Strings Alternately",
    functionName: "mergeAlternately",
    prompt: "Given strings word1 and word2, merge them by alternating letters, then append any remainder.",
    tests: [
      { args: ["abc", "pqr"], expected: "apbqcr" },
      { args: ["ab", "pqrs"], expected: "apbqrs" },
      { args: ["abcd", "pq"], expected: "apbqcd" },
    ],
  },
  {
    id: "gcd_of_strings",
    title: "Greatest Common Divisor of Strings",
    functionName: "gcdOfStrings",
    prompt: "Return the largest string x that can be repeated to form both str1 and str2.",
    tests: [
      { args: ["ABCABC", "ABC"], expected: "ABC" },
      { args: ["ABABAB", "ABAB"], expected: "AB" },
      { args: ["LEET", "CODE"], expected: "" },
    ],
  },
  {
    id: "kids_with_candies",
    title: "Kids With the Greatest Number of Candies",
    functionName: "kidsWithCandies",
    prompt: "For each kid, return whether candies[i] + extraCandies is at least the current maximum.",
    tests: [
      { args: [[2, 3, 5, 1, 3], 3], expected: [true, true, true, false, true] },
      { args: [[4, 2, 1, 1, 2], 1], expected: [true, false, false, false, false] },
    ],
  },
  {
    id: "can_place_flowers",
    title: "Can Place Flowers",
    functionName: "canPlaceFlowers",
    prompt: "Given flowerbed (0 empty,1 planted), determine if n new flowers can be planted with no adjacent flowers.",
    tests: [
      { args: [[1, 0, 0, 0, 1], 1], expected: true },
      { args: [[1, 0, 0, 0, 1], 2], expected: false },
      { args: [[0, 0, 1, 0, 0], 2], expected: true },
    ],
  },
  {
    id: "reverse_vowels",
    title: "Reverse Vowels of a String",
    functionName: "reverseVowels",
    prompt: "Reverse only vowels in the string.",
    tests: [
      { args: ["hello"], expected: "holle" },
      { args: ["leetcode"], expected: "leotcede" },
      { args: ["aA"], expected: "Aa" },
    ],
  },
  {
    id: "product_except_self",
    title: "Product of Array Except Self",
    functionName: "productExceptSelf",
    prompt: "Return an array where answer[i] is the product of all nums except nums[i], without division.",
    tests: [
      { args: [[1, 2, 3, 4]], expected: [24, 12, 8, 6] },
      { args: [[-1, 1, 0, -3, 3]], expected: [0, 0, 9, 0, 0] },
      { args: [[0, 0]], expected: [0, 0] },
    ],
  },
  {
    id: "increasing_triplet",
    title: "Increasing Triplet Subsequence",
    functionName: "increasingTriplet",
    prompt: "Return true if there exists i<j<k with nums[i] < nums[j] < nums[k].",
    tests: [
      { args: [[1, 2, 3, 4, 5]], expected: true },
      { args: [[5, 4, 3, 2, 1]], expected: false },
      { args: [[2, 1, 5, 0, 4, 6]], expected: true },
    ],
  },
  {
    id: "max_k_sum_pairs",
    title: "Max Number of K-Sum Pairs",
    functionName: "maxOperations",
    prompt: "Given nums and k, return max number of operations removing pairs summing to k.",
    tests: [
      { args: [[1, 2, 3, 4], 5], expected: 2 },
      { args: [[3, 1, 3, 4, 3], 6], expected: 1 },
      { args: [[2, 2, 2, 3, 1, 1, 4, 1], 4], expected: 2 },
    ],
  },
  {
    id: "max_average_subarray",
    title: "Maximum Average Subarray I",
    functionName: "findMaxAverage",
    prompt: "Return the maximum average value of any contiguous subarray of length k.",
    tests: [
      { args: [[1, 12, -5, -6, 50, 3], 4], expected: 12.75, comparator: "float_eps" },
      { args: [[5], 1], expected: 5.0, comparator: "float_eps" },
    ],
  },
  {
    id: "max_vowels_substring",
    title: "Maximum Number of Vowels in a Substring of Given Length",
    functionName: "maxVowels",
    prompt: "Return max number of vowels in any substring of s with length k.",
    tests: [
      { args: ["abciiidef", 3], expected: 3 },
      { args: ["aeiou", 2], expected: 2 },
      { args: ["leetcode", 3], expected: 2 },
    ],
  },
  {
    id: "longest_subarray_after_delete",
    title: "Longest Subarray of 1's After Deleting One Element",
    functionName: "longestSubarray",
    prompt: "Delete exactly one element and return longest non-empty subarray of only 1s.",
    tests: [
      { args: [[1, 1, 0, 1]], expected: 3 },
      { args: [[0, 1, 1, 1, 0, 1, 1, 0, 1]], expected: 5 },
      { args: [[1, 1, 1]], expected: 2 },
    ],
  },
  {
    id: "highest_altitude",
    title: "Find the Highest Altitude",
    functionName: "largestAltitude",
    prompt: "Given net gain between points, starting altitude 0, return highest altitude reached.",
    tests: [
      { args: [[-5, 1, 5, 0, -7]], expected: 1 },
      { args: [[-4, -3, -2, -1, 4, 3, 2]], expected: 0 },
    ],
  },
  {
    id: "pivot_index",
    title: "Find Pivot Index",
    functionName: "pivotIndex",
    prompt: "Return leftmost index where left sum equals right sum, else -1.",
    tests: [
      { args: [[1, 7, 3, 6, 5, 6]], expected: 3 },
      { args: [[1, 2, 3]], expected: -1 },
      { args: [[2, 1, -1]], expected: 0 },
    ],
  },
  {
    id: "unique_occurrences",
    title: "Unique Number of Occurrences",
    functionName: "uniqueOccurrences",
    prompt: "Return true if occurrence count of each distinct value is unique.",
    tests: [
      { args: [[1, 2, 2, 1, 1, 3]], expected: true },
      { args: [[1, 2]], expected: false },
      { args: [[-3, 0, 1, -3, 1, 1, 1, -3, 10, 0]], expected: true },
    ],
  },
  {
    id: "close_strings",
    title: "Determine if Two Strings Are Close",
    functionName: "closeStrings",
    prompt: "Return true if you can transform word1 to word2 by swaps and bulk char-renaming operations.",
    tests: [
      { args: ["abc", "bca"], expected: true },
      { args: ["a", "aa"], expected: false },
      { args: ["cabbba", "abbccc"], expected: true },
    ],
  },
  {
    id: "remove_stars",
    title: "Removing Stars From a String",
    functionName: "removeStars",
    prompt: "Each '*' removes itself and closest non-star character to the left. Return final string.",
    tests: [
      { args: ["leet**cod*e"], expected: "lecoe" },
      { args: ["erase*****"], expected: "" },
    ],
  },
  {
    id: "decode_string",
    title: "Decode String",
    functionName: "decodeString",
    prompt: "Decode patterns like k[encoded_string], nested allowed.",
    tests: [
      { args: ["3[a]2[bc]"], expected: "aaabcbc" },
      { args: ["3[a2[c]]"], expected: "accaccacc" },
      { args: ["2[abc]3[cd]ef"], expected: "abcabccdcdcdef" },
    ],
  },
  {
    id: "container_with_most_water",
    title: "Container With Most Water",
    functionName: "maxArea",
    prompt: "Given heights, return max area of water container formed by two lines.",
    tests: [
      { args: [[1, 8, 6, 2, 5, 4, 8, 3, 7]], expected: 49 },
      { args: [[1, 1]], expected: 1 },
      { args: [[4, 3, 2, 1, 4]], expected: 16 },
    ],
  },
  {
    id: "keys_and_rooms",
    title: "Keys and Rooms",
    functionName: "canVisitAllRooms",
    prompt: "Rooms[i] has keys. Starting from room 0, return true if all rooms can be visited.",
    tests: [
      { args: [[[1], [2], [3], []]], expected: true },
      { args: [[[1, 3], [3, 0, 1], [2], [0]]], expected: false },
    ],
  },
  {
    id: "rotting_oranges",
    title: "Rotting Oranges",
    functionName: "orangesRotting",
    prompt: "Return minimum minutes to rot all fresh oranges in grid or -1 if impossible.",
    tests: [
      { args: [[[2, 1, 1], [1, 1, 0], [0, 1, 1]]], expected: 4 },
      { args: [[[2, 1, 1], [0, 1, 1], [1, 0, 1]]], expected: -1 },
      { args: [[[0, 2]]], expected: 0 },
    ],
  },
  {
    id: "kth_largest",
    title: "Kth Largest Element in an Array",
    functionName: "findKthLargest",
    prompt: "Return kth largest element in array.",
    tests: [
      { args: [[3, 2, 1, 5, 6, 4], 2], expected: 5 },
      { args: [[3, 2, 3, 1, 2, 4, 5, 5, 6], 4], expected: 4 },
    ],
  },
  {
    id: "koko",
    title: "Koko Eating Bananas",
    functionName: "minEatingSpeed",
    prompt: "Return minimum integer speed k so Koko eats all piles within h hours.",
    tests: [
      { args: [[3, 6, 7, 11], 8], expected: 4 },
      { args: [[30, 11, 23, 4, 20], 5], expected: 30 },
      { args: [[30, 11, 23, 4, 20], 6], expected: 23 },
    ],
  },
  {
    id: "letter_combinations",
    title: "Letter Combinations of a Phone Number",
    functionName: "letterCombinations",
    prompt: "Given digit string 2-9, return all possible letter combinations.",
    tests: [
      { args: ["23"], expected: ["ad", "ae", "af", "bd", "be", "bf", "cd", "ce", "cf"], comparator: "sorted_eq" },
      { args: [""], expected: [] },
      { args: ["2"], expected: ["a", "b", "c"], comparator: "sorted_eq" },
    ],
  },
  {
    id: "min_cost_climbing_stairs",
    title: "Min Cost Climbing Stairs",
    functionName: "minCostClimbingStairs",
    prompt: "You can climb 1 or 2 steps; return minimum cost to reach top.",
    tests: [
      { args: [[10, 15, 20]], expected: 15 },
      { args: [[1, 100, 1, 1, 1, 100, 1, 1, 100, 1]], expected: 6 },
    ],
  },
  {
    id: "house_robber",
    title: "House Robber",
    functionName: "rob",
    prompt: "Return max amount that can be robbed from non-adjacent houses.",
    tests: [
      { args: [[1, 2, 3, 1]], expected: 4 },
      { args: [[2, 7, 9, 3, 1]], expected: 12 },
      { args: [[2, 1, 1, 2]], expected: 4 },
    ],
  },
  {
    id: "longest_common_subsequence",
    title: "Longest Common Subsequence",
    functionName: "longestCommonSubsequence",
    prompt: "Return length of the longest common subsequence between two strings.",
    tests: [
      { args: ["abcde", "ace"], expected: 3 },
      { args: ["abc", "abc"], expected: 3 },
      { args: ["abc", "def"], expected: 0 },
    ],
  },
  {
    id: "counting_bits",
    title: "Counting Bits",
    functionName: "countBits",
    prompt: "Return array ans where ans[i] is number of 1 bits in i for i=0..n.",
    tests: [
      { args: [2], expected: [0, 1, 1] },
      { args: [5], expected: [0, 1, 1, 2, 1, 2] },
    ],
  },
  {
    id: "minimum_flips",
    title: "Minimum Flips to Make a OR b Equal to c",
    functionName: "minFlips",
    prompt: "Return min bit flips on a or b so (a OR b) == c.",
    tests: [
      { args: [2, 6, 5], expected: 3 },
      { args: [4, 2, 7], expected: 1 },
      { args: [1, 2, 3], expected: 0 },
    ],
  },
  {
    id: "non_overlapping_intervals",
    title: "Non-overlapping Intervals",
    functionName: "eraseOverlapIntervals",
    prompt: "Given intervals, return minimum number to remove so remaining intervals are non-overlapping.",
    tests: [
      { args: [[[1, 2], [2, 3], [3, 4], [1, 3]]], expected: 1 },
      { args: [[[1, 2], [1, 2], [1, 2]]], expected: 2 },
      { args: [[[1, 2], [2, 3]]], expected: 0 },
    ],
  },
  {
    id: "arrows_balloons",
    title: "Minimum Number of Arrows to Burst Balloons",
    functionName: "findMinArrowShots",
    prompt: "Given balloon intervals, return minimum arrows to burst all.",
    tests: [
      { args: [[[10, 16], [2, 8], [1, 6], [7, 12]]], expected: 2 },
      { args: [[[1, 2], [3, 4], [5, 6], [7, 8]]], expected: 4 },
      { args: [[[1, 2], [2, 3], [3, 4], [4, 5]]], expected: 2 },
    ],
  },
  {
    id: "daily_temperatures",
    title: "Daily Temperatures",
    functionName: "dailyTemperatures",
    prompt: "For each day, return days until warmer temp, or 0 if none.",
    tests: [
      { args: [[73, 74, 75, 71, 69, 72, 76, 73]], expected: [1, 1, 4, 2, 1, 1, 0, 0] },
      { args: [[30, 40, 50, 60]], expected: [1, 1, 1, 0] },
      { args: [[30, 60, 90]], expected: [1, 1, 0] },
    ],
  },
];

const JUDGE_CASES = [
  {
    id: "product_correct",
    title: "Product of Array Except Self",
    functionName: "productExceptSelf",
    expectedVerdict: "correct",
    candidateCode: `def productExceptSelf(nums):\n    n = len(nums)\n    ans = [1] * n\n    pref = 1\n    for i in range(n):\n        ans[i] = pref\n        pref *= nums[i]\n    suff = 1\n    for i in range(n-1, -1, -1):\n        ans[i] *= suff\n        suff *= nums[i]\n    return ans`,
    tests: [
      { args: [[1, 2, 3, 4]], expected: [24, 12, 8, 6] },
      { args: [[-1, 1, 0, -3, 3]], expected: [0, 0, 9, 0, 0] },
    ],
  },
  {
    id: "product_wrong_division",
    title: "Product of Array Except Self",
    functionName: "productExceptSelf",
    expectedVerdict: "incorrect",
    candidateCode: `def productExceptSelf(nums):\n    total = 1\n    for n in nums:\n        total *= n\n    return [total // n for n in nums]`,
    tests: [
      { args: [[1, 2, 3, 4]], expected: [24, 12, 8, 6] },
      { args: [[-1, 1, 0, -3, 3]], expected: [0, 0, 9, 0, 0] },
    ],
  },
  {
    id: "container_tle",
    title: "Container With Most Water",
    functionName: "maxArea",
    expectedVerdict: "tle",
    candidateCode: `def maxArea(height):\n    ans = 0\n    for i in range(len(height)):\n        for j in range(i+1, len(height)):\n            ans = max(ans, (j-i) * min(height[i], height[j]))\n    return ans`,
    tests: [
      { args: [[1, 8, 6, 2, 5, 4, 8, 3, 7]], expected: 49 },
      { args: [[1, 1]], expected: 1 },
    ],
  },
  {
    id: "container_correct",
    title: "Container With Most Water",
    functionName: "maxArea",
    expectedVerdict: "correct",
    candidateCode: `def maxArea(height):\n    l, r = 0, len(height)-1\n    ans = 0\n    while l < r:\n        ans = max(ans, (r-l) * min(height[l], height[r]))\n        if height[l] < height[r]:\n            l += 1\n        else:\n            r -= 1\n    return ans`,
    tests: [
      { args: [[1, 8, 6, 2, 5, 4, 8, 3, 7]], expected: 49 },
      { args: [[1, 1]], expected: 1 },
    ],
  },
  {
    id: "pivot_wrong",
    title: "Find Pivot Index",
    functionName: "pivotIndex",
    expectedVerdict: "incorrect",
    candidateCode: `def pivotIndex(nums):\n    left = 0\n    right = sum(nums)\n    for i, n in enumerate(nums):\n        right -= n\n        if left >= right:\n            return i\n        left += n\n    return -1`,
    tests: [
      { args: [[1, 7, 3, 6, 5, 6]], expected: 3 },
      { args: [[1, 2, 3]], expected: -1 },
    ],
  },
  {
    id: "max_vowels_correct",
    title: "Maximum Number of Vowels in a Substring of Given Length",
    functionName: "maxVowels",
    expectedVerdict: "correct",
    candidateCode: `def maxVowels(s, k):\n    vow = set('aeiou')\n    curr = sum(1 for ch in s[:k] if ch in vow)\n    best = curr\n    for i in range(k, len(s)):\n        if s[i-k] in vow:\n            curr -= 1\n        if s[i] in vow:\n            curr += 1\n        best = max(best, curr)\n    return best`,
    tests: [
      { args: ["abciiidef", 3], expected: 3 },
      { args: ["leetcode", 3], expected: 2 },
    ],
  },
  {
    id: "lsubarray_wrong",
    title: "Longest Subarray of 1's After Deleting One Element",
    functionName: "longestSubarray",
    expectedVerdict: "incorrect",
    candidateCode: `def longestSubarray(nums):\n    best = 0\n    cur = 0\n    for n in nums:\n        if n == 1:\n            cur += 1\n            best = max(best, cur)\n        else:\n            cur = 0\n    return best`,
    tests: [
      { args: [[1, 1, 0, 1]], expected: 3 },
      { args: [[1, 1, 1]], expected: 2 },
    ],
  },
  {
    id: "rotting_wrong_minutes",
    title: "Rotting Oranges",
    functionName: "orangesRotting",
    expectedVerdict: "incorrect",
    candidateCode: `from collections import deque\n\ndef orangesRotting(grid):\n    rows, cols = len(grid), len(grid[0])\n    q = deque()\n    fresh = 0\n    for r in range(rows):\n        for c in range(cols):\n            if grid[r][c] == 2:\n                q.append((r, c))\n            elif grid[r][c] == 1:\n                fresh += 1\n\n    dirs = [(1,0),(-1,0),(0,1),(0,-1)]\n    minutes = 0\n    while q:\n        r, c = q.popleft()\n        for dr, dc in dirs:\n            nr, nc = r+dr, c+dc\n            if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] == 1:\n                grid[nr][nc] = 2\n                fresh -= 1\n                q.append((nr, nc))\n                minutes += 1\n    return -1 if fresh else minutes`,
    tests: [
      { args: [[[2, 1, 1], [1, 1, 0], [0, 1, 1]]], expected: 4 },
      { args: [[[0, 2]]], expected: 0 },
    ],
  },
  {
    id: "koko_tle",
    title: "Koko Eating Bananas",
    functionName: "minEatingSpeed",
    expectedVerdict: "tle",
    candidateCode: `import math\n\ndef minEatingSpeed(piles, h):\n    for k in range(1, max(piles)+1):\n        hours = 0\n        for p in piles:\n            hours += math.ceil(p / k)\n        if hours <= h:\n            return k\n    return max(piles)`,
    tests: [
      { args: [[3, 6, 7, 11], 8], expected: 4 },
      { args: [[30, 11, 23, 4, 20], 6], expected: 23 },
    ],
  },
  {
    id: "house_robber_correct",
    title: "House Robber",
    functionName: "rob",
    expectedVerdict: "correct",
    candidateCode: `def rob(nums):\n    prev2, prev1 = 0, 0\n    for n in nums:\n        prev2, prev1 = prev1, max(prev1, prev2 + n)\n    return prev1`,
    tests: [
      { args: [[1, 2, 3, 1]], expected: 4 },
      { args: [[2, 7, 9, 3, 1]], expected: 12 },
    ],
  },
  {
    id: "lcs_wrong",
    title: "Longest Common Subsequence",
    functionName: "longestCommonSubsequence",
    expectedVerdict: "incorrect",
    candidateCode: `def longestCommonSubsequence(text1, text2):\n    i = j = ans = 0\n    while i < len(text1) and j < len(text2):\n        if text1[i] == text2[j]:\n            ans += 1\n            i += 1\n            j += 1\n        elif text1[i] < text2[j]:\n            i += 1\n        else:\n            j += 1\n    return ans`,
    tests: [
      { args: ["abcde", "ace"], expected: 3 },
      { args: ["ezupkr", "ubmrapg"], expected: 2 },
    ],
  },
  {
    id: "daily_temp_wrong",
    title: "Daily Temperatures",
    functionName: "dailyTemperatures",
    expectedVerdict: "incorrect",
    candidateCode: `def dailyTemperatures(temperatures):\n    ans = [0] * len(temperatures)\n    for i in range(len(temperatures)-1):\n        if temperatures[i+1] > temperatures[i]:\n            ans[i] = 1\n    return ans`,
    tests: [
      { args: [[73, 74, 75, 71, 69, 72, 76, 73]], expected: [1, 1, 4, 2, 1, 1, 0, 0] },
      { args: [[30, 40, 50, 60]], expected: [1, 1, 1, 0] },
    ],
  },
];

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function getUsage(response) {
  const usage = response.usage || {};
  const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
  const cachedInputTokens =
    usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;
  return { inputTokens, outputTokens, cachedInputTokens };
}

function estimateCostUSD(model, usageTotals) {
  const price = PRICING[model];
  if (!price) return null;

  const nonCachedInput = Math.max(usageTotals.inputTokens - usageTotals.cachedInputTokens, 0);
  const cost =
    (nonCachedInput / 1_000_000) * price.input +
    (usageTotals.cachedInputTokens / 1_000_000) * price.cachedInput +
    (usageTotals.outputTokens / 1_000_000) * price.output;
  return cost;
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
    if comparator == "float_eps":
        try:
            return abs(float(got) - float(expected)) < 1e-6
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

  const proc = spawnSync("python3", ["-c", py], { encoding: "utf8", timeout: 12000 });
  if (proc.error) return { ok: false, error: proc.error.message };
  if (proc.status !== 0) return { ok: false, error: proc.stderr || `python exit ${proc.status}` };
  try {
    return JSON.parse(proc.stdout.trim());
  } catch {
    return { ok: false, error: `invalid python output: ${proc.stdout.slice(0, 250)}` };
  }
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

async function askSolve(model, c) {
  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "You are solving a LeetCode problem in Python. Return only valid Python code. No markdown. Implement exactly the requested function name.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              `Problem: ${c.title}\n` +
              `${c.prompt}\n` +
              `Required function: ${c.functionName}\n` +
              `Return only Python code implementing this function.`,
          },
        ],
      },
    ],
    max_output_tokens: 900,
  });

  return { text: response.output_text || "", usage: getUsage(response) };
}

async function askJudge(model, c) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      verdict: { type: "string", enum: ["correct", "incorrect", "tle"] },
      why: { type: "string" },
      edge_cases: { type: "array", items: { type: "string" } },
      corrected_code: { type: ["string", "null"] },
    },
    required: ["verdict", "why", "edge_cases", "corrected_code"],
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
              "You are grading a Python LeetCode submission. Label only correct / incorrect / tle. Mark tle when asymptotic complexity is too slow for LeetCode-scale constraints. Provide at least 2 edge cases. If verdict is incorrect or tle, include corrected Python code for the same function.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              `Problem: ${c.title}\n` +
              `Function: ${c.functionName}\n` +
              `Submission:\n${c.candidateCode}\n\n` +
              `Return JSON only.`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "judge_response",
        schema,
        strict: true,
      },
    },
    max_output_tokens: 900,
  });

  const parsed = extractJson(response.output_text || "");
  if (!parsed) {
    throw new Error(`JSON parse failure in judge for ${model}/${c.id}`);
  }
  return { data: parsed, usage: getUsage(response) };
}

async function evalSolve(model) {
  const details = [];
  const usageTotals = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

  for (let i = 0; i < SOLVE_CASES.length; i++) {
    const c = SOLVE_CASES[i];
    const { text, usage } = await askSolve(model, c);
    usageTotals.inputTokens += usage.inputTokens;
    usageTotals.outputTokens += usage.outputTokens;
    usageTotals.cachedInputTokens += usage.cachedInputTokens;

    const code = cleanCode(text);
    const run = runPythonTests({ code, functionName: c.functionName, tests: c.tests });
    const pass = !!run.ok;

    details.push({
      id: c.id,
      title: c.title,
      pass,
      error: pass ? null : run.error || JSON.stringify(run.details || []).slice(0, 250),
    });

    process.stdout.write(`solve ${model} ${i + 1}/${SOLVE_CASES.length} pass=${pass}\n`);
  }

  const passCount = details.filter((d) => d.pass).length;
  return {
    details,
    passCount,
    total: SOLVE_CASES.length,
    passRate: passCount / SOLVE_CASES.length,
    usageTotals,
  };
}

async function evalJudge(model) {
  const details = [];
  const usageTotals = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

  for (let i = 0; i < JUDGE_CASES.length; i++) {
    const c = JUDGE_CASES[i];
    const { data, usage } = await askJudge(model, c);
    usageTotals.inputTokens += usage.inputTokens;
    usageTotals.outputTokens += usage.outputTokens;
    usageTotals.cachedInputTokens += usage.cachedInputTokens;

    const verdictMatch = data.verdict === c.expectedVerdict;
    const edgeCaseOk = Array.isArray(data.edge_cases) && data.edge_cases.length >= 2;

    let correctionPass = null;
    if (c.expectedVerdict !== "correct") {
      const corrected = cleanCode(data.corrected_code || "");
      if (!corrected) {
        correctionPass = false;
      } else {
        const run = runPythonTests({ code: corrected, functionName: c.functionName, tests: c.tests });
        correctionPass = !!run.ok;
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
      predictedVerdict: data.verdict,
      verdictMatch,
      edgeCaseOk,
      correctionPass,
      pass,
    });

    process.stdout.write(`judge ${model} ${i + 1}/${JUDGE_CASES.length} pass=${pass}\n`);
  }

  const passCount = details.filter((d) => d.pass).length;
  const verdictAccuracy = details.filter((d) => d.verdictMatch).length / details.length;
  const correctionCases = details.filter((d) => d.expectedVerdict !== "correct");
  const correctionPassRate =
    correctionCases.filter((d) => d.correctionPass === true).length / Math.max(correctionCases.length, 1);

  return {
    details,
    passCount,
    total: JUDGE_CASES.length,
    passRate: passCount / JUDGE_CASES.length,
    verdictAccuracy,
    correctionPassRate,
    usageTotals,
  };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY missing");
  }

  const report = {
    generatedAt: new Date().toISOString(),
    benchmark: {
      solveCases: SOLVE_CASES.length,
      judgeCases: JUDGE_CASES.length,
    },
    pricingAssumptions: PRICING,
    models: {},
  };

  for (const model of MODELS) {
    console.log(`\\n=== Evaluating ${model} ===`);

    const solve = await evalSolve(model);
    const judge = await evalJudge(model);

    const totalUsage = {
      inputTokens: solve.usageTotals.inputTokens + judge.usageTotals.inputTokens,
      outputTokens: solve.usageTotals.outputTokens + judge.usageTotals.outputTokens,
      cachedInputTokens: solve.usageTotals.cachedInputTokens + judge.usageTotals.cachedInputTokens,
    };

    const estimatedCostUSD = estimateCostUSD(model, totalUsage);

    report.models[model] = {
      solve,
      judge,
      totalUsage,
      estimatedCostUSD,
    };

    console.log(
      `Summary ${model}: solve ${(solve.passRate * 100).toFixed(1)}% (${solve.passCount}/${solve.total}), ` +
        `judge ${(judge.passRate * 100).toFixed(1)}% (${judge.passCount}/${judge.total}), ` +
        `verdictAcc ${(judge.verdictAccuracy * 100).toFixed(1)}%, correction ${(judge.correctionPassRate * 100).toFixed(1)}%, ` +
        `estCost $${estimatedCostUSD?.toFixed(4)}`,
    );
  }

  writeFileSync("./eval-mini-vs-41-thorough-report.json", JSON.stringify(report, null, 2));
  console.log("\\nSaved report: eval-mini-vs-41-thorough-report.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
