export type LC75Problem = {
  id: number;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  category: string;
  statement: string;
  source?: string | null;
  sourceRepo?: string;
  sourceFile?: string | null;
  leetcodeUrl?: string;
  slug?: string;
  tags?: string[];
  semanticKeywords?: string[];
  retrievalMeta?: Record<string, unknown>;
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
  kind: "text" | "code";
  createdAt: string;
};

export type ProgrammingLanguage = "python" | "javascript" | "typescript" | "java" | "cpp" | "go" | "rust" | "sql";
export type NaturalLanguage =
  | "english"
  | "indonesian"
  | "spanish"
  | "french"
  | "german"
  | "portuguese"
  | "italian"
  | "dutch"
  | "polish"
  | "turkish"
  | "filipino"
  | "vietnamese"
  | "hindi"
  | "bengali"
  | "urdu"
  | "arabic"
  | "russian"
  | "japanese"
  | "korean"
  | "chinese";
export type CoachingMode = "interviewer" | "tutor";
export type SuggestedComposerMode = "chat" | "code" | "test";

export type LanguageState = {
  selected: ProgrammingLanguage;
  effective: ProgrammingLanguage;
  mode: "explicit";
};

export type ChatApiRequest = {
  message: string;
  code: string;
  naturalLanguage?: NaturalLanguage;
  languageState?: LanguageState;
  coachingMode?: CoachingMode;
  activeProblemId?: number;
  profile?: LocalProfile;
  conversation?: ChatMessage[];
  anonId?: string;
  sessionId?: string;
};

export type ChatApiResponse = {
  assistantMessage: string;
  sessionId?: string;
  activeProblemId?: number;
  activeCurriculumKey?: string;
  composerSuggestion?: {
    mode: SuggestedComposerMode | null;
    reason: string;
  };
  assessment: {
    status: Exclude<ProblemLearningStatus, "unseen">;
    confidence: number;
    attemptsDelta: number;
    markMastered: boolean;
    moveToProblemId: number;
    moveToCurriculumKey?: string | null;
    summaryNote: string;
    nextStep: string;
  };
  quickActions: string[];
  usage?: {
    chargedFemtodollars: string;
    chargedDollars: number;
    remainingBalanceFemtodollars?: string;
    remainingBalanceDollars?: number;
  };
};
