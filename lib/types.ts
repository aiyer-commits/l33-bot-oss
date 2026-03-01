export type LC75Problem = {
  id: number;
  title: string;
  difficulty: "Easy" | "Medium";
  category: string;
  statement: string;
  sourceRepo: string;
  sourceFile: string | null;
  leetcodeUrl: string;
};

export type ProblemLearningStatus = "unseen" | "learning" | "approaching" | "review" | "mastered";

export type ProblemProgress = {
  id: number;
  status: ProblemLearningStatus;
  confidence: number;
  attempts: number;
  lastAssessment: string;
  lastCode: string;
  lastPracticedAt: string | null;
  masteredAt: string | null;
};

export type LocalProfile = {
  startedAt: string;
  updatedAt: string;
  activeProblemId: number;
  problems: ProblemProgress[];
};

export type ChatMessage = {
  role: "assistant" | "user";
  content: string;
  createdAt: string;
};

export type ChatApiRequest = {
  message: string;
  code: string;
  activeProblemId: number;
  profile: LocalProfile;
  conversation: ChatMessage[];
};

export type ChatApiResponse = {
  assistantMessage: string;
  assessment: {
    status: Exclude<ProblemLearningStatus, "unseen">;
    confidence: number;
    attemptsDelta: number;
    markMastered: boolean;
    moveToProblemId: number;
    summaryNote: string;
    nextStep: string;
  };
  quickActions: string[];
};
