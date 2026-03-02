import problems from "@/data/catalog.json";
import curriculums from "@/data/curriculums.json";
import type { LC75Problem, LocalProfile } from "@/lib/types";

export const leetcode75 = problems as LC75Problem[];
const curriculumData = curriculums as Record<string, { problemIds: number[] }>;

export function getProblemById(id: number): LC75Problem | undefined {
  return leetcode75.find((problem) => problem.id === id);
}

export function createInitialProfile(): LocalProfile {
  const now = new Date().toISOString();
  const defaultProblemId = curriculumData.l33?.problemIds?.[0] ?? leetcode75[0]?.id ?? 1;
  return {
    startedAt: now,
    updatedAt: now,
    activeProblemId: defaultProblemId,
    problems: leetcode75.map((problem) => ({
      id: problem.id,
      status: "unseen",
      confidence: 0,
      attempts: 0,
      lastAssessment: "",
      lastCode: "",
      lastPracticedAt: null,
      masteredAt: null,
    })),
  };
}

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
