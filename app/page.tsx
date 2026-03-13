"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Delete } from "lucide-react";
import { clampConfidence, createInitialProfile, getProblemById } from "@/lib/leetcode75";
import type { ChatApiResponse, ChatMessage, CoachingMode, LocalProfile, ProgrammingLanguage } from "@/lib/types";

const PROFILE_KEY = "l33tsp33k.profile.v2";
const CHAT_KEY = "l33tsp33k.chat.v2";
const CODE_KEY = "l33tsp33k.code.v2";
const TEXT_KEY = "l33tsp33k.text.v2";
const TEST_KEY = "l33tsp33k.test.v1";
const ANON_ID_KEY = "l33tsp33k.anon-id.v1";
const THEME_KEY = "l33tsp33k.theme.v1";
const LANGUAGE_KEY = "l33tsp33k.language.v1";
const HOLD_DELAY_MS = 320;
const REPEAT_DELAY_MS = 260;
const REPEAT_INTERVAL_MS = 42;
const INDENT_TOKEN = "\t";

type TargetField = "chat" | "code" | "test";
type ComposerMode = "chat" | "code" | "test";
type ThemeMode = "light" | "dark";
type PyodideStatus = "idle" | "loading" | "ready" | "error";
type PyodideInterface = {
  runPythonAsync: (code: string) => Promise<unknown>;
};
type WindowWithPyodide = Window & {
  loadPyodide?: (options: { indexURL: string }) => Promise<PyodideInterface>;
};

type Cursor = { start: number; end: number };
type CurriculumMeta = {
  key: string;
  name: string;
  description?: string | null;
  is_premium?: boolean;
  total_count?: number;
};
type CurriculumProblem = {
  id: number;
  title: string;
  difficulty: string;
  category: string;
  position: number;
  statement?: string;
};

type KeySpec = { token: string; units?: number };
type KeyboardRow = { offsetUnits?: number; heightUnits?: number; keys: KeySpec[] };
type FuzzyKeyMeta = { token: string; rowIndex: number; keyIndex: number; el: HTMLButtonElement };
const BASE_KEY_HEIGHT = "clamp(44px, 9.6vw, 58px)";

const LANGUAGE_OPTIONS: Array<{ value: ProgrammingLanguage; label: string }> = [
  { value: "python", label: "Py" },
  { value: "javascript", label: "JS" },
  { value: "typescript", label: "TS" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C++" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "sql", label: "SQL" },
];

const SYMBOL_ROWS_BY_LANGUAGE: Record<ProgrammingLanguage, string[][]> = {
  python: [
    ["<", ">", "1", "2", "3", "for", "while", "if", "^", "~", "#"],
    ["[", "]", "4", "5", "6", "elif", "else", "in", '"', "?", "@"],
    ["{", "}", "7", "8", "9", "&", "|", "!", "/", "%", "="],
    ["(", ")", "_", "0", ":", ",", ".", "'", "+", "-", "*"],
  ],
  javascript: [
    ["<", ">", "1", "2", "3", "for", "while", "if", ";", "=>", "#"],
    ["[", "]", "4", "5", "6", "else", "in", "fn", '"', "?", "const"],
    ["{", "}", "7", "8", "9", "&", "|", "!", "/", "%", "="],
    ["(", ")", "_", "0", ":", ",", ".", "'", "+", "-", "*"],
  ],
  typescript: [
    ["<", ">", "1", "2", "3", "for", "while", "if", ";", "=>", "#"],
    ["[", "]", "4", "5", "6", "else", "in", "type", '"', "?", "const"],
    ["{", "}", "7", "8", "9", "&", "|", "!", "/", "%", "="],
    ["(", ")", "_", "0", ":", ",", ".", "'", "+", "-", "*"],
  ],
  java: [
    ["<", ">", "1", "2", "3", "for", "while", "if", ";", "new", "#"],
    ["[", "]", "4", "5", "6", "else", "class", "void", '"', "?", "public"],
    ["{", "}", "7", "8", "9", "&", "|", "!", "/", "%", "="],
    ["(", ")", "_", "0", ":", ",", ".", "'", "+", "-", "*"],
  ],
  cpp: [
    ["<", ">", "1", "2", "3", "for", "while", "if", ";", "::", "#"],
    ["[", "]", "4", "5", "6", "else", "auto", "std", '"', "?", "->"],
    ["{", "}", "7", "8", "9", "&", "|", "!", "/", "%", "="],
    ["(", ")", "_", "0", ":", ",", ".", "'", "+", "-", "*"],
  ],
  go: [
    ["<", ">", "1", "2", "3", "for", "if", "func", ";", ":=", "#"],
    ["[", "]", "4", "5", "6", "else", "range", "var", '"', "?", "go"],
    ["{", "}", "7", "8", "9", "&", "|", "!", "/", "%", "="],
    ["(", ")", "_", "0", ":", ",", ".", "'", "+", "-", "*"],
  ],
  rust: [
    ["<", ">", "1", "2", "3", "for", "while", "if", ";", "->", "#"],
    ["[", "]", "4", "5", "6", "else", "let", "fn", '"', "?", "mut"],
    ["{", "}", "7", "8", "9", "&", "|", "!", "/", "%", "="],
    ["(", ")", "_", "0", ":", ",", ".", "'", "+", "-", "*"],
  ],
  sql: [
    ["<", ">", "1", "2", "3", "SELECT", "FROM", "WHERE", ";", "AND", "#"],
    ["[", "]", "4", "5", "6", "JOIN", "GROUP", "ORDER", '"', "?", "LIMIT"],
    ["{", "}", "7", "8", "9", "&", "|", "!", "/", "%", "="],
    ["(", ")", "_", "0", ":", ",", ".", "'", "+", "-", "*"],
  ],
};

const TAP_OUTPUT_BY_LANGUAGE: Record<ProgrammingLanguage, Record<string, string>> = {
  python: { "&": "and ", "|": "or ", "!": "not ", "@": "@lru_cache(None)\ndef ", for: "for ", while: "while ", if: "if ", elif: "elif ", else: "else ", in: "in " },
  javascript: { for: "for ", while: "while ", if: "if ", else: "else ", fn: "function ", const: "const ", "=>": "() => " },
  typescript: { for: "for ", while: "while ", if: "if ", else: "else ", type: "type ", const: "const ", "=>": "() => " },
  java: { for: "for ", while: "while ", if: "if ", else: "else ", class: "class ", public: "public ", new: "new " },
  cpp: { for: "for ", while: "while ", if: "if ", else: "else ", auto: "auto ", std: "std::", "::": "::", "->": "->" },
  go: { for: "for ", if: "if ", else: "else ", func: "func ", var: "var ", ":=": ":= ", range: "range " },
  rust: { for: "for ", while: "while ", if: "if ", else: "else ", let: "let ", fn: "fn ", mut: "mut " },
  sql: { SELECT: "SELECT ", FROM: "FROM ", WHERE: "WHERE ", JOIN: "JOIN ", GROUP: "GROUP BY ", ORDER: "ORDER BY ", LIMIT: "LIMIT ", AND: "AND " },
};

const HOLD_OUTPUT_BY_LANGUAGE: Record<ProgrammingLanguage, Record<string, string>> = {
  python: { "&": "&", "|": "|", "!": "!", "<": "<<", ">": ">>", "1": "True", "0": "False", "@": "@" },
  javascript: { "&": "&&", "|": "||", "!": "!", "<": "<<", ">": ">>", "1": "true", "0": "false" },
  typescript: { "&": "&&", "|": "||", "!": "!", "<": "<<", ">": ">>", "1": "true", "0": "false" },
  java: { "&": "&&", "|": "||", "!": "!", "<": "<<", ">": ">>", "1": "true", "0": "false" },
  cpp: { "&": "&&", "|": "||", "!": "!", "<": "<<", ">": ">>", "1": "true", "0": "false" },
  go: { "&": "&&", "|": "||", "!": "!", "<": "<<", ">": ">>", "1": "true", "0": "false" },
  rust: { "&": "&&", "|": "||", "!": "!", "<": "<<", ">": ">>", "1": "true", "0": "false" },
  sql: { "&": "AND ", "|": "OR ", "!": "NOT ", "<": "<=", ">": ">=", "1": "TRUE", "0": "FALSE" },
};

function buildKeyboardLayout(language: ProgrammingLanguage): KeyboardRow[] {
  const symbolRows = SYMBOL_ROWS_BY_LANGUAGE[language] ?? SYMBOL_ROWS_BY_LANGUAGE.python;
  return [
    { heightUnits: 0.92, keys: symbolRows[0].map((token) => ({ token })) },
    { heightUnits: 0.92, keys: symbolRows[1].map((token) => ({ token })) },
    { heightUnits: 0.92, keys: symbolRows[2].map((token) => ({ token })) },
    { heightUnits: 0.92, keys: symbolRows[3].map((token) => ({ token })) },
    { heightUnits: 1.0, keys: ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"].map((token) => ({ token })) },
    { offsetUnits: 0.5, heightUnits: 1.0, keys: ["a", "s", "d", "f", "g", "h", "j", "k", "l"].map((token) => ({ token })) },
    { heightUnits: 1.0, keys: [{ token: "SHIFT", units: 1.5 }, ...["z", "x", "c", "v", "b", "n", "m"].map((token) => ({ token })), { token: "BACKSPACE", units: 1.5 }] },
    { heightUnits: 1.08, keys: [{ token: "TAB", units: 1.8 }, { token: "ARROWS", units: 1.8 }, { token: "SPACE", units: 4 }, { token: "ENTER", units: 3.6 }] },
  ];
}

function nowIso() {
  return new Date().toISOString();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function formatProblemStatement(raw: string) {
  return decodeHtmlEntities(
    raw
      .replace(/\r/g, "")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\s*\/p\s*>/gi, "\n\n")
      .replace(/<\s*p[^>]*>/gi, "")
      .replace(/<\s*\/pre\s*>/gi, "\n\n")
      .replace(/<\s*pre[^>]*>/gi, "\n")
      .replace(/<\s*li[^>]*>/gi, "- ")
      .replace(/<\s*\/li\s*>/gi, "\n")
      .replace(/<\s*\/?(ul|ol)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function splitProblemSections(statementText: string) {
  const lines = statementText.split("\n");
  const sections: string[] = [];
  let current: string[] = [];

  const isSectionBoundary = (line: string) =>
    /^Example \d+:/i.test(line) || /^Constraints:/i.test(line) || /^Follow[ -]?up:/i.test(line);

  for (const line of lines) {
    if (isSectionBoundary(line.trim()) && current.join("\n").trim().length > 0) {
      sections.push(current.join("\n").trim());
      current = [line];
      continue;
    }
    current.push(line);
  }

  const tail = current.join("\n").trim();
  if (tail) sections.push(tail);
  return sections;
}

function looksLikeHtmlMarkup(value: string) {
  return /<\/?(p|pre|code|strong|em|ul|ol|li|br|h[1-6]|div|span)\b/i.test(value) || /&nbsp;|&lt;|&gt;|&amp;/.test(value);
}

function sanitizeHtmlForRender(raw: string) {
  const allowed = new Set(["p", "pre", "code", "strong", "em", "ul", "ol", "li", "br", "u"]);
  return raw
    .replace(/<\s*(script|style|iframe|object|embed)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(\/?)\s*([a-z0-9]+)([^>]*)>/gi, (_, slash: string, tag: string) => {
      const normalized = String(tag).toLowerCase();
      if (!allowed.has(normalized)) return "";
      return `<${slash ? "/" : ""}${normalized}>`;
    })
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

function splitAssistantBubbleContent(content: string) {
  const normalized = content.trim();
  if (!normalized) {
    return { primary: "", note: "", nextStep: "" };
  }

  const nextMatch = normalized.match(/\nNext:\s*([\s\S]+)$/);
  const nextStep = nextMatch?.[1]?.trim() ?? "";
  const withoutNext = nextMatch ? normalized.slice(0, nextMatch.index).trimEnd() : normalized;

  const blocks = withoutNext.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  if (blocks.length <= 1) {
    return { primary: withoutNext, note: "", nextStep };
  }

  const note = blocks[blocks.length - 1] ?? "";
  const primary = blocks.slice(0, -1).join("\n\n").trim();
  return { primary: primary || withoutNext, note, nextStep };
}

function asMessage(role: "assistant" | "user", content: string, kind: "text" | "code"): ChatMessage {
  return { role, content, kind, createdAt: nowIso() };
}

function normalizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const data = entry as Partial<ChatMessage>;
      if (data.role !== "assistant" && data.role !== "user") return null;
      if (typeof data.content !== "string") return null;
      const kind = data.kind === "code" ? "code" : "text";
      if (
        data.role === "assistant" &&
        kind === "text" &&
        (/Current problem #\d+:/.test(data.content) || /Switched to #\d+:/.test(data.content))
      ) {
        return null;
      }
      return {
        role: data.role,
        content: data.content,
        kind,
        createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
      } satisfies ChatMessage;
    })
    .filter((entry): entry is ChatMessage => entry !== null);
}

function bootstrapIntro(problemId: number): ChatMessage[] {
  const problem = getProblemById(problemId);
  if (!problem) return [asMessage("assistant", "Session started. Problem data is missing.", "text")];
  return [asMessage("assistant", "Use this flow: read the problem above, write code in the lower bubble, then hold Enter to submit. Tap the T/<> toggle to switch chat vs code, and use the language picker in the header to match your solution language. Ask for a hint or explanation anytime.", "text"), ...buildProblemMessages(problem.id)];
}

function buildProblemMessages(problemId: number): ChatMessage[] {
  const problem = getProblemById(problemId);
  if (!problem) return [];
  const statementSections = splitProblemSections(formatProblemStatement(problem.statement));
  const messages: ChatMessage[] = [
    asMessage("assistant", `Problem #${problem.id}: ${problem.title}\n\n${statementSections[0] ?? ""}`.trim(), "text"),
  ];
  for (let i = 1; i < statementSections.length; i += 1) {
    messages.push(asMessage("assistant", statementSections[i], "text"));
  }
  return messages;
}

function extractProblemMessageId(message: ChatMessage): number | null {
  if (message.role !== "assistant" || message.kind !== "text") return null;
  const currentMatch = message.content.match(/Problem #(\d+):/);
  if (currentMatch) return Number(currentMatch[1]);
  return null;
}

function updateProblem(
  existing: LocalProfile["problems"][number],
  data: ChatApiResponse["assessment"],
  code: string,
): LocalProfile["problems"][number] {
  const nextStatus = data.markMastered ? "mastered" : data.status;
  return {
    ...existing,
    status: nextStatus,
    confidence: clampConfidence(data.confidence),
    attempts: existing.attempts + data.attemptsDelta,
    lastAssessment: data.summaryNote,
    lastCode: code.trim().slice(0, 2400),
    lastPracticedAt: nowIso(),
    masteredAt: data.markMastered ? nowIso() : existing.masteredAt,
  };
}

function applyInsert(source: string, cursor: Cursor, insert: string): { value: string; cursor: Cursor } {
  const before = source.slice(0, cursor.start);
  const after = source.slice(cursor.end);
  const value = `${before}${insert}${after}`;
  const next = cursor.start + insert.length;
  return { value, cursor: { start: next, end: next } };
}

function applyBackspace(source: string, cursor: Cursor): { value: string; cursor: Cursor } {
  if (cursor.start !== cursor.end) {
    const value = `${source.slice(0, cursor.start)}${source.slice(cursor.end)}`;
    return { value, cursor: { start: cursor.start, end: cursor.start } };
  }
  if (cursor.start === 0) return { value: source, cursor };
  const value = `${source.slice(0, cursor.start - 1)}${source.slice(cursor.end)}`;
  const next = cursor.start - 1;
  return { value, cursor: { start: next, end: next } };
}

function clampPos(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

function moveVertical(source: string, cursor: Cursor, direction: "UP" | "DOWN"): Cursor {
  const point = cursor.start;
  const lines = source.split("\n");
  let running = 0;
  let row = 0;
  let col = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const lineLen = lines[i].length;
    const lineEnd = running + lineLen;
    if (point <= lineEnd) {
      row = i;
      col = point - running;
      break;
    }
    running = lineEnd + 1;
  }

  const targetRow = direction === "UP" ? Math.max(0, row - 1) : Math.min(lines.length - 1, row + 1);
  let targetPos = 0;
  for (let i = 0; i < targetRow; i += 1) {
    targetPos += lines[i].length + 1;
  }
  const targetCol = Math.min(col, lines[targetRow].length);
  targetPos += targetCol;
  return { start: targetPos, end: targetPos };
}

function lineBounds(source: string, index: number) {
  const clamped = clampPos(index, source.length);
  const start = source.lastIndexOf("\n", Math.max(0, clamped - 1)) + 1;
  const nextNl = source.indexOf("\n", clamped);
  const end = nextNl === -1 ? source.length : nextNl;
  return { start, end };
}

function selectedLineRange(source: string, cursor: Cursor) {
  const startBounds = lineBounds(source, cursor.start);
  const endIndex = cursor.end > cursor.start ? cursor.end - 1 : cursor.end;
  const endBounds = lineBounds(source, endIndex);
  return { start: startBounds.start, end: endBounds.end };
}

function applyIndent(source: string, cursor: Cursor): { value: string; cursor: Cursor } {
  if (cursor.start === cursor.end) {
    return applyInsert(source, cursor, INDENT_TOKEN);
  }

  const range = selectedLineRange(source, cursor);
  const selected = source.slice(range.start, range.end);
  const lines = selected.split("\n");
  const indented = lines.map((line) => `${INDENT_TOKEN}${line}`).join("\n");
  const value = `${source.slice(0, range.start)}${indented}${source.slice(range.end)}`;
  const nextStart = cursor.start + INDENT_TOKEN.length;
  const nextEnd = cursor.end + lines.length * INDENT_TOKEN.length;
  return { value, cursor: { start: nextStart, end: nextEnd } };
}

function applyOutdent(source: string, cursor: Cursor): { value: string; cursor: Cursor } {
  const range = selectedLineRange(source, cursor);
  const selected = source.slice(range.start, range.end);
  const lines = selected.split("\n");

  let removedBeforeStart = 0;
  let removedTotal = 0;
  const outdentedLines = lines.map((line, lineIndex) => {
    if (line.startsWith(INDENT_TOKEN)) {
      removedTotal += INDENT_TOKEN.length;
      if (lineIndex === 0) removedBeforeStart += INDENT_TOKEN.length;
      return line.slice(INDENT_TOKEN.length);
    }
    return line;
  });

  const outdented = outdentedLines.join("\n");
  const value = `${source.slice(0, range.start)}${outdented}${source.slice(range.end)}`;

  if (cursor.start === cursor.end) {
    const pos = clampPos(cursor.start - removedBeforeStart, value.length);
    return { value, cursor: { start: pos, end: pos } };
  }

  const nextStart = clampPos(cursor.start - removedBeforeStart, value.length);
  const nextEnd = clampPos(cursor.end - removedTotal, value.length);
  return { value, cursor: { start: nextStart, end: nextEnd } };
}

function normalizeLanguage(value: string | null | undefined): ProgrammingLanguage {
  const normalized = String(value ?? "").toLowerCase();
  if (
    normalized === "python" ||
    normalized === "javascript" ||
    normalized === "typescript" ||
    normalized === "java" ||
    normalized === "cpp" ||
    normalized === "go" ||
    normalized === "rust" ||
    normalized === "sql"
  ) {
    return normalized;
  }
  return "python";
}

function applySmartEnterForLanguage(source: string, cursor: Cursor, language: ProgrammingLanguage): { value: string; cursor: Cursor } {
  const resolved = language;
  const currentLine = lineBounds(source, cursor.start);
  const linePrefix = source.slice(currentLine.start, cursor.start);
  const indentMatch = linePrefix.match(/^\t*/);
  const baseIndent = indentMatch ? indentMatch[0] : "";
  const trimmedPrefix = linePrefix.trimEnd();

  if (resolved === "python") {
    if (trimmedPrefix.endsWith(":")) return applyInsert(source, cursor, `\n${baseIndent}${INDENT_TOKEN}`);
    const dedentMatch = trimmedPrefix.match(/^\t*(return|pass|break|continue|raise)\b/);
    if (dedentMatch && baseIndent.length > 0) return applyInsert(source, cursor, `\n${baseIndent.slice(0, -INDENT_TOKEN.length)}`);
    return applyInsert(source, cursor, `\n${baseIndent}`);
  }

  if (["javascript", "typescript", "java", "cpp", "go", "rust"].includes(resolved)) {
    if (trimmedPrefix.endsWith("{")) return applyInsert(source, cursor, `\n${baseIndent}${INDENT_TOKEN}`);
    if (trimmedPrefix === "}" && baseIndent.length > 0) return applyInsert(source, cursor, `\n${baseIndent.slice(0, -INDENT_TOKEN.length)}`);
    return applyInsert(source, cursor, `\n${baseIndent}`);
  }

  return applyInsert(source, cursor, `\n${baseIndent}`);
}

export default function Home() {
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [code, setCode] = useState("");
  const [testInput, setTestInput] = useState("");
  const [pyodideStatus, setPyodideStatus] = useState<PyodideStatus>("idle");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState<string>("");
  const [anonId, setAnonId] = useState<string>("");
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [activeCurriculumKey, setActiveCurriculumKey] = useState("l33");
  const [selectedLanguage, setSelectedLanguage] = useState<ProgrammingLanguage>("python");
  const [hasPhysicalKeyboard, setHasPhysicalKeyboard] = useState(false);
  const [showTouchKeyboard, setShowTouchKeyboard] = useState(true);
  const [coachingMode, setCoachingMode] = useState<CoachingMode>("interviewer");
  const [isCurriculumDrawerOpen, setIsCurriculumDrawerOpen] = useState(false);
  const [curriculumTab, setCurriculumTab] = useState("l33");
  const [curriculums, setCurriculums] = useState<CurriculumMeta[]>([]);
  const [curriculumProblems, setCurriculumProblems] = useState<CurriculumProblem[]>([]);
  const [curriculumLoading, setCurriculumLoading] = useState(false);
  const [curriculumError, setCurriculumError] = useState("");
  const [curriculumSwitchingProblemId, setCurriculumSwitchingProblemId] = useState<number | null>(null);
  const [expandedCurriculumProblemId, setExpandedCurriculumProblemId] = useState<number | null>(null);

  const [composerMode, setComposerMode] = useState<ComposerMode>("code");
  const [shiftOn, setShiftOn] = useState(false);
  const [capsOn, setCapsOn] = useState(false);

  const [chatCursor, setChatCursor] = useState<Cursor>({ start: 0, end: 0 });
  const [codeCursor, setCodeCursor] = useState<Cursor>({ start: 0, end: 0 });
  const [testCursor, setTestCursor] = useState<Cursor>({ start: 0, end: 0 });
  const [assistantHasMore, setAssistantHasMore] = useState(false);
  const [userHasMore, setUserHasMore] = useState(false);
  const [assistantHasPrev, setAssistantHasPrev] = useState(false);
  const [userHasPrev, setUserHasPrev] = useState(false);
  const [assistantFabFlash, setAssistantFabFlash] = useState(false);
  const [userFabFlash, setUserFabFlash] = useState(false);
  const [assistantActiveIndex, setAssistantActiveIndex] = useState(0);
  const [userActiveIndex, setUserActiveIndex] = useState(0);

  const activeProblemMessageRef = useRef<HTMLElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const assistantScrollRef = useRef<HTMLDivElement | null>(null);
  const userScrollRef = useRef<HTMLDivElement | null>(null);
  const repeatTimeoutRef = useRef<number | null>(null);
  const repeatIntervalRef = useRef<number | null>(null);
  const holdTimeoutRef = useRef<number | null>(null);
  const holdTriggeredRef = useRef(false);
  const lastShiftTapRef = useRef<number>(0);
  const assistantFabHoldRef = useRef<number | null>(null);
  const userFabHoldRef = useRef<number | null>(null);
  const assistantFabLongPressedRef = useRef(false);
  const userFabLongPressedRef = useRef(false);
  const assistantFabDirectionRef = useRef<"next" | "prev">("next");
  const userFabDirectionRef = useRef<"next" | "prev">("next");
  const assistantFabActionHandledRef = useRef(false);
  const userFabActionHandledRef = useRef(false);
  const assistantScrollRafRef = useRef<number | null>(null);
  const userScrollRafRef = useRef<number | null>(null);
  const assistantFlashTimeoutRef = useRef<number | null>(null);
  const userFlashTimeoutRef = useRef<number | null>(null);
  const prevAssistantCountRef = useRef<number>(0);
  const prevUserCountRef = useRef<number>(0);
  const didInitMessageCountsRef = useRef(false);
  const userPrevScrollWidthRef = useRef<number>(0);
  const userWasPinnedRightRef = useRef<boolean>(false);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const codeInputRef = useRef<HTMLTextAreaElement | null>(null);
  const testInputRef = useRef<HTMLTextAreaElement | null>(null);
  const pyodideRef = useRef<PyodideInterface | null>(null);
  const pyodideLoadPromiseRef = useRef<Promise<PyodideInterface> | null>(null);
  const fuzzyKeyMapRef = useRef<Map<string, FuzzyKeyMeta>>(new Map());
  const activeFuzzyPointerRef = useRef<{ pointerId: number; token: string; rowIndex: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const profileRaw = localStorage.getItem(PROFILE_KEY);
    const chatRaw = localStorage.getItem(CHAT_KEY);
    const textRaw = localStorage.getItem(TEXT_KEY);
    const codeRaw = localStorage.getItem(CODE_KEY);
    const testRaw = localStorage.getItem(TEST_KEY);
    const themeRaw = localStorage.getItem(THEME_KEY);
    const languageRaw = localStorage.getItem(LANGUAGE_KEY);

    let loadedProfile: LocalProfile;
    if (profileRaw) {
      try {
        loadedProfile = JSON.parse(profileRaw) as LocalProfile;
      } catch {
        loadedProfile = createInitialProfile();
      }
    } else {
      loadedProfile = createInitialProfile();
    }

    setProfile(loadedProfile);

    let localAnonId = localStorage.getItem(ANON_ID_KEY);
    if (!localAnonId) {
      localAnonId = crypto.randomUUID();
      localStorage.setItem(ANON_ID_KEY, localAnonId);
    }
    setAnonId(localAnonId);

    if (chatRaw) {
      try {
        const normalized = normalizeMessages(JSON.parse(chatRaw));
        setMessages(normalized.length ? normalized : bootstrapIntro(loadedProfile.activeProblemId));
      } catch {
        setMessages(bootstrapIntro(loadedProfile.activeProblemId));
      }
    } else {
      setMessages(bootstrapIntro(loadedProfile.activeProblemId));
    }

    if (typeof textRaw === "string") setDraft(textRaw);
    if (typeof codeRaw === "string") setCode(codeRaw);
    if (typeof testRaw === "string") setTestInput(testRaw);
    if (themeRaw === "dark" || themeRaw === "light") setTheme(themeRaw);
    setSelectedLanguage(normalizeLanguage(languageRaw));
    const hydrateCurriculum = async () => {
      try {
        const response = await fetch(`/api/curriculum?anonId=${encodeURIComponent(localAnonId ?? "")}`);
        if (!response.ok) return;
        const payload = await response.json();
        if (typeof payload.activeCurriculumKey === "string") {
          setActiveCurriculumKey(payload.activeCurriculumKey);
          setCurriculumTab(payload.activeCurriculumKey);
        }
        if (Array.isArray(payload.curriculums)) setCurriculums(payload.curriculums as CurriculumMeta[]);
        if (typeof payload.activeProblemId === "number") {
          setProfile((prev) =>
            prev
              ? {
                  ...prev,
                  activeProblemId: payload.activeProblemId,
                }
              : prev,
          );
        }
      } catch {
        // Ignore hydration failures; app still works local-first.
      }
    };
    void hydrateCurriculum();
  }, []);

  useEffect(() => {
    if (!profile) return;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    localStorage.setItem(CHAT_KEY, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (!profile || messages.length === 0) return;
    const hasProblemMessages = messages.some((message) => extractProblemMessageId(message) === profile.activeProblemId);
    if (hasProblemMessages) return;
    setMessages((prev) => [...prev, ...buildProblemMessages(profile.activeProblemId)]);
  }, [profile, messages]);

  useEffect(() => {
    localStorage.setItem(TEXT_KEY, draft);
  }, [draft]);

  useEffect(() => {
    localStorage.setItem(CODE_KEY, code);
  }, [code]);

  useEffect(() => {
    localStorage.setItem(TEST_KEY, testInput);
  }, [testInput]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(LANGUAGE_KEY, selectedLanguage);
  }, [selectedLanguage]);

  useEffect(() => {
    if (selectedLanguage !== "python" && composerMode === "test") {
      setComposerMode("code");
    }
  }, [selectedLanguage, composerMode]);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (composerMode === "chat") chatInputRef.current?.focus();
      else if (composerMode === "code") codeInputRef.current?.focus();
      else testInputRef.current?.focus();
    });
  }, [composerMode]);

  useEffect(() => {
    if (selectedLanguage !== "python") return;
    const win = window as WindowWithPyodide;
    if (pyodideRef.current) {
      setPyodideStatus("ready");
      return;
    }
    if (typeof win.loadPyodide === "function") {
      setPyodideStatus((prev) => (prev === "ready" ? prev : "idle"));
    }
  }, [selectedLanguage]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === "Unidentified") return;
      setHasPhysicalKeyboard(true);
      setShowTouchKeyboard((prev) => (prev ? false : prev));
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => () => {
    stopKeyRepeat();
    clearHoldTimer();
    if (assistantScrollRafRef.current != null) window.cancelAnimationFrame(assistantScrollRafRef.current);
    if (userScrollRafRef.current != null) window.cancelAnimationFrame(userScrollRafRef.current);
    if (assistantFlashTimeoutRef.current != null) window.clearTimeout(assistantFlashTimeoutRef.current);
    if (userFlashTimeoutRef.current != null) window.clearTimeout(userFlashTimeoutRef.current);
  }, []);

  useEffect(() => {
    const stopRepeat = () => stopKeyRepeat();
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") stopKeyRepeat();
    };
    window.addEventListener("pointerup", stopRepeat, { passive: true });
    window.addEventListener("touchend", stopRepeat, { passive: true });
    window.addEventListener("touchcancel", stopRepeat, { passive: true });
    window.addEventListener("blur", stopRepeat);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pointerup", stopRepeat);
      window.removeEventListener("touchend", stopRepeat);
      window.removeEventListener("touchcancel", stopRepeat);
      window.removeEventListener("blur", stopRepeat);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  function getPaneCards(el: HTMLDivElement) {
    const track = el.firstElementChild as HTMLElement | null;
    if (!track) return [] as HTMLElement[];
    return Array.from(track.children) as HTMLElement[];
  }

  function centeredCardIndex(el: HTMLDivElement, cards: HTMLElement[]) {
    if (cards.length === 0) return 0;
    const viewportCenter = el.scrollLeft + el.clientWidth / 2;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < cards.length; i += 1) {
      const card = cards[i];
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const d = Math.abs(cardCenter - viewportCenter);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  function targetLeftForCenteredCard(el: HTMLDivElement, card: HTMLElement) {
    return card.offsetLeft + card.offsetWidth / 2 - el.clientWidth / 2;
  }

  function updatePaneScrollState(
    ref: { current: HTMLDivElement | null },
    setPrev: (value: boolean) => void,
    setNext: (value: boolean) => void,
    setIndex: (value: number) => void,
  ) {
    const el = ref.current;
    if (!el) return;
    setPrev(el.scrollLeft > 6);
    const remaining = el.scrollWidth - el.scrollLeft - el.clientWidth;
    setNext(remaining > 6);
    const cards = getPaneCards(el);
    setIndex(centeredCardIndex(el, cards));
  }

  function attachPaneScroll(
    ref: { current: HTMLDivElement | null },
    setPrev: (value: boolean) => void,
    setNext: (value: boolean) => void,
    setIndex: (value: number) => void,
  ) {
    const el = ref.current;
    if (!el) return () => {};
    const onScroll = () => updatePaneScrollState(ref, setPrev, setNext, setIndex);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }

  useEffect(
    () => attachPaneScroll(assistantScrollRef, setAssistantHasPrev, setAssistantHasMore, setAssistantActiveIndex),
    [messages],
  );
  useEffect(
    () => attachPaneScroll(userScrollRef, setUserHasPrev, setUserHasMore, setUserActiveIndex),
    [messages, code, draft, composerMode],
  );

  useEffect(() => {
    const tick = () => {
      updatePaneScrollState(assistantScrollRef, setAssistantHasPrev, setAssistantHasMore, setAssistantActiveIndex);
      updatePaneScrollState(userScrollRef, setUserHasPrev, setUserHasMore, setUserActiveIndex);
    };
    tick();
    window.addEventListener("resize", tick);
    return () => window.removeEventListener("resize", tick);
  }, []);

  useEffect(() => {
    const scroller = userScrollRef.current;
    if (!scroller) return;
    const prevWidth = userPrevScrollWidthRef.current;
    const newWidth = scroller.scrollWidth;
    if (userWasPinnedRightRef.current && newWidth > prevWidth) {
      scroller.scrollLeft += newWidth - prevWidth;
    }
    userPrevScrollWidthRef.current = newWidth;
  }, [messages]);

  const activeProblem = useMemo(() => {
    if (!profile) return null;
    return getProblemById(profile.activeProblemId) ?? null;
  }, [profile]);
  const showKeyboard = !hasPhysicalKeyboard || showTouchKeyboard;
  const effectiveLanguage = useMemo<ProgrammingLanguage>(() => selectedLanguage, [selectedLanguage]);
  const keyboardLayout = useMemo(() => buildKeyboardLayout(effectiveLanguage), [effectiveLanguage]);
  const tapOutputMap = useMemo(() => TAP_OUTPUT_BY_LANGUAGE[effectiveLanguage] ?? TAP_OUTPUT_BY_LANGUAGE.python, [effectiveLanguage]);
  const holdOutputMap = useMemo(() => HOLD_OUTPUT_BY_LANGUAGE[effectiveLanguage] ?? HOLD_OUTPUT_BY_LANGUAGE.python, [effectiveLanguage]);
  const assistantMessages = useMemo(() => messages.filter((msg) => msg.role === "assistant"), [messages]);
  const userMessages = useMemo(() => messages.filter((msg) => msg.role === "user"), [messages]);

  useEffect(() => {
    const nextAssistantCount = assistantMessages.length;
    const nextUserCount = userMessages.length;
    if (!didInitMessageCountsRef.current) {
      prevAssistantCountRef.current = nextAssistantCount;
      prevUserCountRef.current = nextUserCount;
      didInitMessageCountsRef.current = true;
      return;
    }

    if (nextAssistantCount > prevAssistantCountRef.current) {
      setAssistantFabFlash(true);
      if (assistantFlashTimeoutRef.current != null) window.clearTimeout(assistantFlashTimeoutRef.current);
      assistantFlashTimeoutRef.current = window.setTimeout(() => setAssistantFabFlash(false), 900);
    }
    if (nextUserCount > prevUserCountRef.current) {
      setUserFabFlash(true);
      if (userFlashTimeoutRef.current != null) window.clearTimeout(userFlashTimeoutRef.current);
      userFlashTimeoutRef.current = window.setTimeout(() => setUserFabFlash(false), 900);
    }
    prevAssistantCountRef.current = nextAssistantCount;
    prevUserCountRef.current = nextUserCount;
  }, [assistantMessages.length, userMessages.length]);

  const activeProblemMessageIndex = useMemo(() => {
    if (!activeProblem) return -1;
    for (let i = assistantMessages.length - 1; i >= 0; i -= 1) {
      if (extractProblemMessageId(assistantMessages[i]) === activeProblem.id) return i;
    }
    return -1;
  }, [assistantMessages, activeProblem]);

  const isDark = theme === "dark";

  async function downloadPyodide() {
    if (pyodideRef.current) {
      setPyodideStatus("ready");
      return;
    }
    if (pyodideLoadPromiseRef.current) {
      setPyodideStatus("loading");
      try {
        await pyodideLoadPromiseRef.current;
        setPyodideStatus("ready");
      } catch {
        setPyodideStatus("error");
      }
      return;
    }

    const win = window as WindowWithPyodide;
    setPyodideStatus("loading");
    try {
      if (typeof win.loadPyodide !== "function") {
        await new Promise<void>((resolve, reject) => {
          const existing = document.querySelector('script[data-pyodide-loader="1"]') as HTMLScriptElement | null;
          if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error("Failed to load pyodide script")), { once: true });
            return;
          }
          const script = document.createElement("script");
          script.src = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js";
          script.async = true;
          script.dataset.pyodideLoader = "1";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Failed to load pyodide script"));
          document.head.appendChild(script);
        });
      }

      if (typeof win.loadPyodide !== "function") {
        throw new Error("Pyodide loader unavailable");
      }

      pyodideLoadPromiseRef.current = win.loadPyodide({
        indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/",
      });
      pyodideRef.current = await pyodideLoadPromiseRef.current;
      setPyodideStatus("ready");
    } catch {
      setPyodideStatus("error");
      pyodideLoadPromiseRef.current = null;
    }
  }

  function modeBadgeLabel(mode: ComposerMode) {
    if (mode === "chat") return "T";
    if (mode === "code") return "</>";
    return "in";
  }

  function coachingModeBadgeLabel(mode: CoachingMode) {
    return mode === "tutor" ? "help" : "int";
  }

  function focusComposer(mode: ComposerMode) {
    setComposerMode(mode);
    requestAnimationFrame(() => {
      if (mode === "chat") chatInputRef.current?.focus();
      if (mode === "code") codeInputRef.current?.focus();
      if (mode === "test") testInputRef.current?.focus();
    });
  }

  function focusCoachingMode(mode: CoachingMode) {
    setCoachingMode(mode);
  }

  function syncCursorFromDom(target: TargetField) {
    const ref = target === "chat" ? chatInputRef.current : target === "code" ? codeInputRef.current : testInputRef.current;
    if (!ref) return;
    const cursor: Cursor = { start: ref.selectionStart ?? 0, end: ref.selectionEnd ?? 0 };
    if (target === "chat") setChatCursor(cursor);
    else if (target === "code") setCodeCursor(cursor);
    else setTestCursor(cursor);
  }

  function setCursorOnDom(target: TargetField, cursor: Cursor) {
    const ref = target === "chat" ? chatInputRef.current : target === "code" ? codeInputRef.current : testInputRef.current;
    if (!ref) return;
    requestAnimationFrame(() => {
      ref.focus();
      ref.setSelectionRange(cursor.start, cursor.end);
      if (target === "chat") setChatCursor(cursor);
      else if (target === "code") setCodeCursor(cursor);
      else setTestCursor(cursor);
    });
  }

  function pressKey(token: string) {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(6);
    }
    if (token === "SHIFT") {
      const now = Date.now();
      if (now - lastShiftTapRef.current <= 320) {
        setCapsOn((v) => !v);
        setShiftOn(false);
        lastShiftTapRef.current = 0;
        return;
      }
      lastShiftTapRef.current = now;
      setShiftOn((v) => !v);
      return;
    }
    // Only consecutive shift taps should toggle caps lock.
    lastShiftTapRef.current = 0;
    const target: TargetField = composerMode;
    const source = target === "chat" ? draft : target === "code" ? code : testInput;
    const fallbackCursor = target === "chat" ? chatCursor : target === "code" ? codeCursor : testCursor;
    const activeInput = target === "chat" ? chatInputRef.current : target === "code" ? codeInputRef.current : testInputRef.current;
    const cursor = activeInput
      ? { start: activeInput.selectionStart ?? fallbackCursor.start, end: activeInput.selectionEnd ?? fallbackCursor.end }
      : fallbackCursor;

    let result: { value: string; cursor: Cursor } = { value: source, cursor };

    let consumeShiftAfterPress = false;

    if (token === "BACKSPACE") {
      result = applyBackspace(source, cursor);
    } else if (token === "LEFT") {
      const pos = clampPos(cursor.start - 1, source.length);
      result = { value: source, cursor: { start: pos, end: pos } };
    } else if (token === "RIGHT") {
      const pos = clampPos(cursor.end + 1, source.length);
      result = { value: source, cursor: { start: pos, end: pos } };
    } else if (token === "UP" || token === "DOWN") {
      result = { value: source, cursor: moveVertical(source, cursor, token) };
    } else if (token === "SPACE") {
      result = applyInsert(source, cursor, " ");
    } else if (token === "ENTER") {
      result = target === "code" ? applySmartEnterForLanguage(source, cursor, effectiveLanguage) : applyInsert(source, cursor, "\n");
    } else if (token === "TAB") {
      if (target === "code") {
        if (shiftOn) {
          result = applyOutdent(source, cursor);
          setShiftOn(false);
        } else {
          result = applyIndent(source, cursor);
        }
      } else {
        result = applyInsert(source, cursor, "    ");
      }
    } else {
      const isLetter = /^[a-z]$/i.test(token);
      if (isLetter) {
        const upper = capsOn ? !shiftOn : shiftOn;
        result = applyInsert(source, cursor, upper ? token.toUpperCase() : token.toLowerCase());
        if (shiftOn) consumeShiftAfterPress = true;
      } else {
        result = applyInsert(source, cursor, token);
        if (shiftOn) consumeShiftAfterPress = true;
      }
    }

    if (target === "chat") {
      setDraft(result.value);
    } else if (target === "code") {
      setCode(result.value);
    } else {
      setTestInput(result.value);
    }

    if (consumeShiftAfterPress) {
      setShiftOn(false);
    }

    setCursorOnDom(target, result.cursor);
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.nativeEvent as KeyboardEvent).isComposing) return;
    setHasPhysicalKeyboard(true);

    const target: TargetField = composerMode;
    const source = target === "chat" ? draft : target === "code" ? code : testInput;
    const cursor: Cursor = {
      start: event.currentTarget.selectionStart ?? 0,
      end: event.currentTarget.selectionEnd ?? 0,
    };

    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      submitCurrentComposer();
      return;
    }

    if (target === "code" && event.key === "Tab") {
      event.preventDefault();
      const result = event.shiftKey ? applyOutdent(source, cursor) : applyIndent(source, cursor);
      setCode(result.value);
      setCursorOnDom("code", result.cursor);
      return;
    }

    if (target === "code" && event.key === "Enter") {
      event.preventDefault();
      const result = applySmartEnterForLanguage(source, cursor, effectiveLanguage);
      setCode(result.value);
      setCursorOnDom("code", result.cursor);
    }
  }

  function clearField(target: TargetField) {
    if (target === "chat") {
      setDraft("");
      setCursorOnDom("chat", { start: 0, end: 0 });
    } else if (target === "code") {
      setCode("");
      setCursorOnDom("code", { start: 0, end: 0 });
    } else {
      setTestInput("");
      setCursorOnDom("test", { start: 0, end: 0 });
    }
  }

  async function loadCurriculumDrawer(nextCurriculumKey?: string) {
    if (!anonId) return;
    setCurriculumLoading(true);
    setCurriculumError("");
    try {
      const key = (nextCurriculumKey ?? curriculumTab ?? activeCurriculumKey).trim();
      const url = `/api/curriculum?anonId=${encodeURIComponent(anonId)}${key ? `&curriculumKey=${encodeURIComponent(key)}` : ""}`;
      const response = await fetch(url);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load curriculum");
      }
      if (typeof payload.activeCurriculumKey === "string") setActiveCurriculumKey(payload.activeCurriculumKey);
      if (typeof payload.selectedCurriculumKey === "string") setCurriculumTab(payload.selectedCurriculumKey);
      setCurriculums(Array.isArray(payload.curriculums) ? (payload.curriculums as CurriculumMeta[]) : []);
      setCurriculumProblems(Array.isArray(payload.problems) ? (payload.problems as CurriculumProblem[]) : []);
      setExpandedCurriculumProblemId(null);
    } catch (err) {
      setCurriculumError(err instanceof Error ? err.message : "Failed to load curriculum");
    } finally {
      setCurriculumLoading(false);
    }
  }

  function openCurriculumDrawer() {
    setIsCurriculumDrawerOpen(true);
    void loadCurriculumDrawer(activeCurriculumKey);
  }

  async function switchProblemFromDrawer(problemId: number) {
    if (!anonId) return;
    setCurriculumSwitchingProblemId(problemId);
    setCurriculumError("");
    try {
      const response = await fetch("/api/curriculum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anonId,
          curriculumKey: curriculumTab,
          problemId,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not switch problem");
      }

      const nextProblemId = Number(payload.activeProblemId);
      const nextCurriculumKey = String(payload.activeCurriculumKey ?? curriculumTab);
      setActiveCurriculumKey(nextCurriculumKey);
      setCurriculumTab(nextCurriculumKey);
      setExpandedCurriculumProblemId(null);
      setProfile((prev) => (prev ? { ...prev, activeProblemId: nextProblemId } : prev));
      setComposerMode("chat");
      setCode("");
      setCodeCursor({ start: 0, end: 0 });
      setMessages((prev) => {
        const hasProblemMessages = prev.some((message) => extractProblemMessageId(message) === nextProblemId);
        if (hasProblemMessages) return prev;
        return [...prev, ...buildProblemMessages(nextProblemId)];
      });
      setIsCurriculumDrawerOpen(false);
    } catch (err) {
      setCurriculumError(err instanceof Error ? err.message : "Could not switch problem");
    } finally {
      setCurriculumSwitchingProblemId(null);
    }
  }

  async function sendTurn(options: { sendText: boolean; sendCode: boolean; presetText?: string }) {
    if (!profile || !activeProblem || isSending) return;

    const textToSend = (options.presetText ?? draft).trim();
    const codeToSend = code.trim();

    const includeText = options.sendText && textToSend.length > 0;
    const includeCode = options.sendCode && codeToSend.length > 0;

    if (!includeText && !includeCode) return;

    const outgoingMessages: ChatMessage[] = [];
    if (includeText) outgoingMessages.push(asMessage("user", textToSend, "text"));
    if (includeCode) outgoingMessages.push(asMessage("user", codeToSend, "code"));

    const nextMessages = [...messages, ...outgoingMessages];
    const userScroller = userScrollRef.current;
    if (userScroller) {
      const remaining = userScroller.scrollWidth - userScroller.scrollLeft - userScroller.clientWidth;
      userWasPinnedRightRef.current = remaining <= 16;
    } else {
      userWasPinnedRightRef.current = false;
    }
    setMessages(nextMessages);
    setError("");
    setIsSending(true);

    if (options.presetText === undefined && includeText) {
      setDraft("");
      setChatCursor({ start: 0, end: 0 });
    }

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: includeText ? textToSend : "",
          code: includeCode ? codeToSend : "",
          languageState: {
            selected: selectedLanguage,
            effective: effectiveLanguage,
            mode: "explicit",
          },
          coachingMode,
          activeProblemId: profile.activeProblemId,
          profile,
          conversation: nextMessages,
          anonId,
          sessionId,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Tutor call failed");
      }

      const payload = (await response.json()) as ChatApiResponse;
      if (payload.sessionId) setSessionId(payload.sessionId);
      if (payload.activeCurriculumKey) {
        setActiveCurriculumKey(payload.activeCurriculumKey);
        setCurriculumTab(payload.activeCurriculumKey);
      }
      if (payload.activeProblemId && payload.activeProblemId !== profile.activeProblemId) {
        setProfile((prev) => (prev ? { ...prev, activeProblemId: payload.activeProblemId! } : prev));
      }
      setMessages((prev) => {
        const tail = [payload.assessment.summaryNote, `Next: ${payload.assessment.nextStep}`]
          .filter(Boolean)
          .join("\n");
        return [...prev, asMessage("assistant", `${payload.assistantMessage}\n\n${tail}`.trim(), "text")];
      });


      const nextProblemId = payload.activeProblemId ?? payload.assessment.moveToProblemId;
      const moved = nextProblemId !== profile.activeProblemId;

      setProfile((prev) => {
        if (!prev) return prev;

        const updatedProblems = prev.problems.map((entry) => {
          if (entry.id !== prev.activeProblemId) return entry;
          return updateProblem(entry, payload.assessment, includeCode ? codeToSend : entry.lastCode);
        });

        return {
          ...prev,
          activeProblemId: nextProblemId,
          updatedAt: nowIso(),
          problems: updatedProblems,
        };
      });

      if (moved) {
        const movedProblem = getProblemById(nextProblemId);
        if (movedProblem) {
          setMessages((prev) => [...prev, ...buildProblemMessages(movedProblem.id)]);
          setComposerMode("chat");
          setCode("");
          setCodeCursor({ start: 0, end: 0 });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      setError(message);
      setMessages((prev) => [...prev, asMessage("assistant", `Error: ${message}`, "text")]);
    } finally {
      setIsSending(false);
    }
  }

  function submitCurrentComposer() {
    if (composerMode === "code") {
      void sendTurn({ sendText: false, sendCode: true });
      return;
    }
    if (composerMode === "test") {
      return;
    }
    void sendTurn({ sendText: true, sendCode: false });
  }

  function labelForKey(token: string) {
    if (token === "SHIFT") return capsOn ? (shiftOn ? "caps↓" : "caps") : "shift";
    if (token === "TAB") return "tab";
    if (token === "SPACE") return "space";
    if (token === "ENTER") return "enter";
    if (token === "UP") return "";
    if (token === "DOWN") return "";
    if (token === "LEFT") return "";
    if (token === "RIGHT") return "";
    if (token === "ARROWS") return "";
    if (token === "BACKSPACE") return "";
    if (tapOutputMap[token]) return tapOutputMap[token].trim().slice(0, 8);
    if (token === "CLEAR") return "clear";
    return token;
  }

  function cycleTheme() {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  }

  function stopKeyRepeat() {
    if (repeatTimeoutRef.current != null) {
      window.clearTimeout(repeatTimeoutRef.current);
      repeatTimeoutRef.current = null;
    }
    if (repeatIntervalRef.current != null) {
      window.clearInterval(repeatIntervalRef.current);
      repeatIntervalRef.current = null;
    }
  }

  function clearHoldTimer() {
    if (holdTimeoutRef.current != null) {
      window.clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
  }

  function isRepeatableToken(token: string) {
    return token === "BACKSPACE" || token === "LEFT" || token === "RIGHT" || token === "UP" || token === "DOWN";
  }

  function shouldUseFuzzyResolution(token: string) {
    return !isRepeatableToken(token) && token !== "ENTER" && token !== "SHIFT" && token !== "TAB" && token !== "SPACE";
  }

  function registerFuzzyKey(id: string, meta: Omit<FuzzyKeyMeta, "el">, el: HTMLButtonElement | null) {
    if (!el) {
      fuzzyKeyMapRef.current.delete(id);
      return;
    }
    fuzzyKeyMapRef.current.set(id, { ...meta, el });
  }

  function beginFuzzyPointer(pointerId: number, token: string, rowIndex: number, x: number, y: number) {
    activeFuzzyPointerRef.current = { pointerId, token, rowIndex, x, y };
  }

  function updateFuzzyPointer(pointerId: number, x: number, y: number) {
    const active = activeFuzzyPointerRef.current;
    if (!active || active.pointerId !== pointerId) return;
    activeFuzzyPointerRef.current = { ...active, x, y };
  }

  function clearFuzzyPointer(pointerId: number) {
    const active = activeFuzzyPointerRef.current;
    if (!active || active.pointerId !== pointerId) return;
    activeFuzzyPointerRef.current = null;
  }

  function resolveFuzzyToken(pointerId: number, fallbackToken: string, fallbackRowIndex: number, x: number, y: number) {
    const active = activeFuzzyPointerRef.current;
    if (!active || active.pointerId !== pointerId || !shouldUseFuzzyResolution(fallbackToken)) return fallbackToken;
    const sourceRow = active.rowIndex;
    const candidates = Array.from(fuzzyKeyMapRef.current.values()).filter((candidate) => Math.abs(candidate.rowIndex - sourceRow) <= 1);
    if (candidates.length === 0) return fallbackToken;

    let bestToken = fallbackToken;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;
    let fallbackScore = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      const rect = candidate.el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.hypot(dx, dy);
      const rowPenalty = Math.abs(candidate.rowIndex - sourceRow) * 28;
      const score = distance + rowPenalty;
      if (candidate.token === fallbackToken && candidate.rowIndex === fallbackRowIndex) {
        fallbackScore = score;
      }
      if (score < bestScore) {
        bestScore = score;
        bestDistance = distance;
        bestToken = candidate.token;
      }
    }

    const thresholdPx = 54;
    if (bestDistance > thresholdPx) return fallbackToken;
    if (fallbackScore < Number.POSITIVE_INFINITY && bestScore > fallbackScore + 18) return fallbackToken;
    return bestToken;
  }

  function capturePointer(target: EventTarget & Element, pointerId: number) {
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // no-op
    }
  }

  function releasePointer(target: EventTarget & Element, pointerId: number) {
    try {
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
    } catch {
      // no-op
    }
  }

  function resolveKeyOutput(token: string, mode: "tap" | "hold") {
    if (mode === "hold" && holdOutputMap[token]) return holdOutputMap[token];
    if (mode === "tap" && tapOutputMap[token]) return tapOutputMap[token];
    return token;
  }

  function triggerKey(token: string) {
    if (token === "CLEAR") {
      clearField(composerMode);
      return;
    }
    pressKey(token);
  }

  function startKeyRepeat(token: string) {
    triggerKey(token);
    const repeatable = isRepeatableToken(token);
    if (!repeatable || typeof window === "undefined") return;

    stopKeyRepeat();
    repeatTimeoutRef.current = window.setTimeout(() => {
      repeatIntervalRef.current = window.setInterval(() => {
        triggerKey(token);
      }, REPEAT_INTERVAL_MS);
    }, REPEAT_DELAY_MS);
  }

  function startKeyPress(token: string) {
    if (isRepeatableToken(token)) {
      startKeyRepeat(token);
      return;
    }

    holdTriggeredRef.current = false;
    clearHoldTimer();
    if (token === "ENTER") {
      if (typeof window === "undefined") return;
      holdTimeoutRef.current = window.setTimeout(() => {
        holdTriggeredRef.current = true;
        submitCurrentComposer();
      }, HOLD_DELAY_MS);
      return;
    }
    if (typeof window === "undefined" || !holdOutputMap[token]) return;

    holdTimeoutRef.current = window.setTimeout(() => {
      holdTriggeredRef.current = true;
      triggerKey(resolveKeyOutput(token, "hold"));
    }, HOLD_DELAY_MS);
  }

  function endKeyPress(token: string) {
    if (isRepeatableToken(token)) {
      stopKeyRepeat();
      return;
    }
    clearHoldTimer();
    if (!holdTriggeredRef.current) {
      triggerKey(resolveKeyOutput(token, "tap"));
    }
    holdTriggeredRef.current = false;
  }

  function cancelKeyPress(token: string) {
    if (isRepeatableToken(token)) {
      // Mobile browsers can emit pointercancel during slight drift.
      // Keep repeat alive; global release listeners stop it on actual release.
      return;
    }
    clearHoldTimer();
    holdTriggeredRef.current = false;
  }

  function getScrollRafRef(ref: { current: HTMLDivElement | null }) {
    return ref === assistantScrollRef ? assistantScrollRafRef : userScrollRafRef;
  }

  function easeOutCubic(t: number) {
    return 1 - (1 - t) ** 3;
  }

  function smoothScrollPaneTo(ref: { current: HTMLDivElement | null }, targetLeft: number) {
    const el = ref.current;
    if (!el) return;
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const finalLeft = Math.max(0, Math.min(targetLeft, maxLeft));
    const startLeft = el.scrollLeft;
    const delta = finalLeft - startLeft;
    if (Math.abs(delta) < 1) return;

    const rafRef = getScrollRafRef(ref);
    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const durationMs = Math.max(220, Math.min(560, Math.abs(delta) * 0.55));
    const startTs = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startTs;
      const p = Math.max(0, Math.min(1, elapsed / durationMs));
      const eased = easeOutCubic(p);
      el.scrollLeft = startLeft + delta * eased;
      if (p < 1) {
        rafRef.current = window.requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = window.requestAnimationFrame(tick);
  }
  function scrollPaneStep(
    ref: { current: HTMLDivElement | null },
    direction: "next" | "prev",
    activeIndex: number,
    setIndex: (value: number) => void,
  ) {
    const el = ref.current;
    if (!el) return;
    const cards = getPaneCards(el);
    if (cards.length === 0) {
      const delta = Math.max(160, Math.floor(el.clientWidth * 0.78));
      smoothScrollPaneTo(ref, el.scrollLeft + (direction === "next" ? delta : -delta));
      return;
    }
    const centeredIndex = centeredCardIndex(el, cards);
    const currentIndex = Number.isFinite(activeIndex) ? Math.max(0, Math.min(cards.length - 1, activeIndex)) : centeredIndex;
    const nextIndex = direction === "next" ? Math.min(cards.length - 1, currentIndex + 1) : Math.max(0, currentIndex - 1);
    const targetCard = cards[nextIndex];
    if (!targetCard) return;
    setIndex(nextIndex);
    smoothScrollPaneTo(ref, targetLeftForCenteredCard(el, targetCard));
  }

  function scrollPaneToEdge(ref: { current: HTMLDivElement | null }, direction: "next" | "prev") {
    const el = ref.current;
    if (!el) return;
    smoothScrollPaneTo(ref, direction === "next" ? el.scrollWidth : 0);
  }

  function startFabHold(which: "assistant" | "user", direction: "next" | "prev") {
    const holdRef = which === "assistant" ? assistantFabHoldRef : userFabHoldRef;
    const longRef = which === "assistant" ? assistantFabLongPressedRef : userFabLongPressedRef;
    const directionRef = which === "assistant" ? assistantFabDirectionRef : userFabDirectionRef;
    const actionHandledRef = which === "assistant" ? assistantFabActionHandledRef : userFabActionHandledRef;
    const targetRef = which === "assistant" ? assistantScrollRef : userScrollRef;
    if (holdRef.current != null) window.clearTimeout(holdRef.current);
    longRef.current = false;
    directionRef.current = direction;
    actionHandledRef.current = false;
    holdRef.current = window.setTimeout(() => {
      longRef.current = true;
      actionHandledRef.current = true;
      scrollPaneToEdge(targetRef, direction);
    }, 320);
  }

  function endFabHold(which: "assistant" | "user", direction?: "next" | "prev") {
    const holdRef = which === "assistant" ? assistantFabHoldRef : userFabHoldRef;
    if (holdRef.current != null) {
      window.clearTimeout(holdRef.current);
      holdRef.current = null;
    }
    if (!direction) return;
    const longRef = which === "assistant" ? assistantFabLongPressedRef : userFabLongPressedRef;
    const directionRef = which === "assistant" ? assistantFabDirectionRef : userFabDirectionRef;
    const actionHandledRef = which === "assistant" ? assistantFabActionHandledRef : userFabActionHandledRef;
    if (actionHandledRef.current) return;
    if (longRef.current && directionRef.current === direction) {
      longRef.current = false;
      actionHandledRef.current = true;
      return;
    }
    if (which === "assistant") {
      scrollPaneStep(assistantScrollRef, direction, assistantActiveIndex, setAssistantActiveIndex);
    } else {
      scrollPaneStep(userScrollRef, direction, userActiveIndex, setUserActiveIndex);
    }
    actionHandledRef.current = true;
  }

  function keyUnits(key: KeySpec) {
    return key.units ?? 1;
  }

  function rowTemplateColumns(row: KeyboardRow) {
    const parts: string[] = [];
    const sideOffset = row.offsetUnits ?? 0;
    if (sideOffset > 0) parts.push(`${sideOffset}fr`);
    for (const key of row.keys) {
      parts.push(`${keyUnits(key)}fr`);
    }
    if (sideOffset > 0) parts.push(`${sideOffset}fr`);
    return parts.join(" ");
  }

  function rowHeightPx(row: KeyboardRow) {
    return `calc(${BASE_KEY_HEIGHT} * ${row.heightUnits ?? 1})`;
  }

  function difficultyDotColor(difficulty: string) {
    const d = difficulty.toLowerCase();
    if (d === "easy") return "bg-[#22c55e]";
    if (d === "medium") return "bg-[#f59e0b]";
    return "bg-[#ef4444]";
  }

  if (!profile || !activeProblem) {
    return <main className={`min-h-screen p-6 ${isDark ? "bg-[#0a0d12] text-[#e5e7eb]" : "bg-[#f3f2ec] text-[#111]"}`}>Loading...</main>;
  }

  return (
    <main className={`flex h-[100dvh] w-full flex-col overflow-hidden ${isDark ? "bg-[#0a0d12] text-[#e5e7eb]" : "bg-[#f3f2ec] text-[#141414]"}`}>
      <header
        ref={headerRef}
        className={`z-20 border-b px-3 py-2 backdrop-blur ${isDark ? "border-white/15 bg-[#0a0d12]/95" : "border-black/10 bg-[#f3f2ec]/95"}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <button
              type="button"
              onClick={openCurriculumDrawer}
              className="max-w-full truncate text-left text-[13px] font-semibold leading-4 underline-offset-2 hover:underline"
              title="Open curriculum and problem drawer"
            >
              #{activeProblem.id} · {activeProblem.title}
            </button>
            <div className="mt-0.5 flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${difficultyDotColor(activeProblem.difficulty)}`} />
              <span className={`text-[10px] font-medium ${isDark ? "text-white/70" : "text-black/70"}`}>{activeProblem.difficulty}</span>
              <span className={`text-[10px] ${isDark ? "text-white/45" : "text-black/45"}`}>· {activeCurriculumKey.toUpperCase()}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {hasPhysicalKeyboard ? (
              <button
                type="button"
                onClick={() => setShowTouchKeyboard((prev) => !prev)}
                className={`inline-flex h-7 items-center justify-center rounded-md border px-1 text-[10px] font-medium ${isDark ? "border-white/20 bg-white/5 text-white" : "border-black/15 bg-white/70 text-black"}`}
                title={showKeyboard ? "Hide on-screen keyboard" : "Show on-screen keyboard"}
              >
                {showKeyboard ? "kbd off" : "kbd on"}
              </button>
            ) : null}
            <select
              value={selectedLanguage}
              onChange={(event) => setSelectedLanguage(normalizeLanguage(event.target.value))}
              className={`h-7 rounded-md border px-1 text-[11px] font-medium ${isDark ? "border-white/20 bg-white/5 text-white" : "border-black/15 bg-white/70 text-black"}`}
              title="Preferred coding language"
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={cycleTheme}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-[11px] font-medium ${isDark ? "border-white/20 bg-white/5" : "border-black/15 bg-white/70"}`}
              title="Cycle theme"
            >
              ◐
            </button>
          </div>
        </div>
      </header>

      {isCurriculumDrawerOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/50 px-3 py-3"
          onClick={() => {
            setIsCurriculumDrawerOpen(false);
            setCurriculumError("");
          }}
        >
          <div
            className={`mx-auto flex h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl border shadow-xl ${
              isDark ? "border-white/15 bg-[#0e1219] text-white" : "border-black/10 bg-white text-black"
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={`flex items-center justify-between border-b px-2 py-2 ${isDark ? "border-white/10" : "border-black/10"}`}>
              <div className={`no-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto`}>
                {curriculums.map((curriculum) => {
                  const isActiveTab = curriculum.key === curriculumTab;
                  return (
                    <button
                      key={curriculum.key}
                      type="button"
                      onClick={() => {
                        setCurriculumTab(curriculum.key);
                        void loadCurriculumDrawer(curriculum.key);
                      }}
                      className={`shrink-0 rounded border px-2 py-1 text-[11px] ${
                        isActiveTab
                          ? isDark
                            ? "border-[#7aa2ff] bg-[#1d2c4d] text-white"
                            : "border-[#3b82f6] bg-[#dbeafe] text-[#0b1f4a]"
                          : isDark
                            ? "border-white/20 bg-white/5 text-white/80"
                            : "border-black/15 bg-black/[0.03] text-black/80"
                      }`}
                    >
                      {curriculum.key}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setIsCurriculumDrawerOpen(false)}
                className={`ml-2 h-7 w-7 rounded border text-[13px] ${isDark ? "border-white/20 bg-white/5" : "border-black/15 bg-black/[0.03]"}`}
                title="Close"
              >
                ×
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-2 py-1">
              {curriculumError ? <p className={`mb-1 text-[11px] ${isDark ? "text-[#ff9f9f]" : "text-[#b42318]"}`}>{curriculumError}</p> : null}
              {curriculumLoading ? <p className={`text-[11px] ${isDark ? "text-white/70" : "text-black/70"}`}>loading…</p> : null}

              {!curriculumLoading ? (
                <ul>
                  {curriculumProblems.map((problem) => {
                    const isCurrentProblem = problem.id === profile.activeProblemId && curriculumTab === activeCurriculumKey;
                    const isExpanded = expandedCurriculumProblemId === problem.id;
                    const isSwitching = curriculumSwitchingProblemId === problem.id;
                    const statement = problem.statement ? formatProblemStatement(problem.statement) : "";
                    const preview = statement.length > 280 ? `${statement.slice(0, 280).trimEnd()}...` : statement;
                    return (
                      <li key={`${curriculumTab}-${problem.id}`} className={`border-b ${isDark ? "border-white/10" : "border-black/10"}`}>
                        <button
                          type="button"
                          disabled={isSwitching}
                          onClick={() => {
                            if (!isExpanded) {
                              setExpandedCurriculumProblemId(problem.id);
                              return;
                            }
                            void switchProblemFromDrawer(problem.id);
                          }}
                          className={`w-full py-1.5 text-left ${isCurrentProblem ? (isDark ? "text-[#9ec0ff]" : "text-[#1849a9]") : ""}`}
                        >
                          <div className="text-[12px] leading-4">
                            <span className="mr-1 opacity-70">#{problem.id}</span>
                            <span className="break-words">{problem.title}</span>
                          </div>
                          <div className={`text-[10px] leading-4 ${isDark ? "text-white/60" : "text-black/60"}`}>
                            {isSwitching ? "loading…" : problem.difficulty}
                          </div>
                        </button>
                        {isExpanded ? (
                          <div className={`pb-1.5 text-[11px] leading-4 ${isDark ? "text-white/70" : "text-black/70"}`}>
                            {preview || "No statement"}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <section className="min-h-0 flex-1 overflow-hidden">
        <div className="relative grid h-full grid-rows-2">
          {isSending ? (
            <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 -translate-y-1/2">
              <svg viewBox="0 0 400 4" preserveAspectRatio="none" className="h-[2px] w-full">
                <path
                  d="M0 2 Q 5 0.8 10 2 T 20 2 T 30 2 T 40 2 T 50 2 T 60 2 T 70 2 T 80 2 T 90 2 T 100 2 T 110 2 T 120 2 T 130 2 T 140 2 T 150 2 T 160 2 T 170 2 T 180 2 T 190 2 T 200 2 T 210 2 T 220 2 T 230 2 T 240 2 T 250 2 T 260 2 T 270 2 T 280 2 T 290 2 T 300 2 T 310 2 T 320 2 T 330 2 T 340 2 T 350 2 T 360 2 T 370 2 T 380 2 T 390 2 T 400 2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.15"
                  className={`l33-divider-wave ${isDark ? "text-[#7fb2ff]" : "text-[#1d4ed8]"}`}
                />
              </svg>
            </div>
          ) : null}
          <section className="relative min-h-0 overflow-hidden">
            <div ref={assistantScrollRef} className="no-scrollbar h-full overflow-x-auto overflow-y-hidden px-3 py-3">
              <div className="flex h-full items-stretch gap-2 pr-12">
                {assistantMessages.map((message, index) => (
                  (() => {
                    const sections = message.kind === "text" && !looksLikeHtmlMarkup(message.content) ? splitAssistantBubbleContent(message.content) : null;
                    const metaTone = isDark
                      ? "border-white/10 bg-white/[0.04] text-white/58"
                      : "border-black/10 bg-black/[0.03] text-black/55";

                    return (
                      <article
                        key={`${message.createdAt}-a-${index}`}
                        ref={index === activeProblemMessageIndex ? (node) => {
                          activeProblemMessageRef.current = node;
                        } : undefined}
                        className={`flex h-full min-h-full max-w-[96%] shrink-0 self-stretch flex-col rounded-xl rounded-tl-none px-3 py-2 text-sm shadow-sm ${isDark ? "bg-[#151b24]" : "bg-white"}`}
                      >
                        <div className="no-scrollbar h-full min-h-0 flex-1 overflow-auto">
                          {message.kind === "code" ? (
                            <pre className="whitespace-pre-wrap font-mono text-[12px] leading-5">{message.content}</pre>
                          ) : looksLikeHtmlMarkup(message.content) ? (
                            <div
                              className="space-y-2 text-[13px] leading-5 [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_pre]:rounded-md [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                              dangerouslySetInnerHTML={{ __html: sanitizeHtmlForRender(message.content) }}
                            />
                          ) : (
                            <div className="space-y-2">
                              <p className="whitespace-pre-wrap leading-5">{sections?.primary ?? message.content}</p>
                              {sections && (sections.note || sections.nextStep) ? (
                                <div className={`rounded-lg border px-2.5 py-2 text-[12px] leading-5 ${metaTone}`}>
                                  {sections.note ? <p className="whitespace-pre-wrap break-words">{sections.note}</p> : null}
                                  {sections.nextStep ? (
                                    <p className={`whitespace-pre-wrap break-words ${sections.note ? "mt-1.5" : ""}`}>
                                      <span className={`mr-1 font-semibold ${isDark ? "text-white/72" : "text-black/68"}`}>Next</span>
                                      {sections.nextStep}
                                    </p>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })()
                ))}
              </div>
            </div>
            {assistantHasPrev ? (
              <button
                type="button"
                onPointerDown={() => startFabHold("assistant", "prev")}
                onPointerUp={() => endFabHold("assistant", "prev")}
                onPointerCancel={() => endFabHold("assistant", "prev")}
                onPointerLeave={() => endFabHold("assistant", "prev")}
                className={`absolute bottom-2 left-2 h-8 w-8 rounded-full bg-[#1f334f] text-sm font-bold text-white shadow ${
                  assistantFabFlash ? "l33-fab-flash" : ""
                }`}
                title="Previous assistant message (hold to start)"
              >
                ←
              </button>
            ) : null}
            {assistantHasMore ? (
              <button
                type="button"
                onPointerDown={() => startFabHold("assistant", "next")}
                onPointerUp={() => endFabHold("assistant", "next")}
                onPointerCancel={() => endFabHold("assistant", "next")}
                onPointerLeave={() => endFabHold("assistant", "next")}
                className={`absolute bottom-2 right-2 h-8 w-8 rounded-full bg-[#1f334f] text-sm font-bold text-white shadow ${
                  assistantFabFlash ? "l33-fab-flash" : ""
                }`}
                title="Next assistant message (hold to end)"
              >
                →
              </button>
            ) : null}
          </section>

          <section className="relative min-h-0 overflow-hidden">
            <div className="flex h-full items-stretch gap-2 px-3 py-3">
              <div ref={userScrollRef} className="no-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
                <div className="flex h-full items-stretch gap-2 pr-12">
                  {userMessages.map((message, index) => (
                    <article
                      key={`${message.createdAt}-u-${index}`}
                      className={`flex h-full min-h-full max-w-[96%] shrink-0 self-stretch flex-col rounded-xl rounded-br-none px-3 py-2 text-sm shadow-sm ${
                        isDark ? "bg-[#dbeafe] text-[#0b1220]" : "bg-[#eff6ff] text-[#0b1220]"
                      }`}
                    >
                      <div className="no-scrollbar h-full min-h-0 flex-1 overflow-auto">
                        {message.kind === "code" ? (
                          <pre className="whitespace-pre-wrap font-mono text-[12px] leading-5">{message.content}</pre>
                        ) : (
                          <p className="whitespace-pre-wrap leading-5">{message.content}</p>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="relative h-full w-[94%] min-w-[94%] shrink-0 pl-8 pr-10">
                <div className="absolute left-0 top-1/2 flex -translate-y-1/2 flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => focusCoachingMode(coachingMode === "interviewer" ? "tutor" : "interviewer")}
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ${
                      coachingMode === "tutor" ? "bg-[#0f766e] text-white" : "bg-[#6b3db8] text-white"
                    }`}
                    title={coachingMode === "tutor" ? "Coaching mode: tutor" : "Coaching mode: interviewer"}
                  >
                    <span className="text-[8px] leading-none">{coachingModeBadgeLabel(coachingMode)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => focusComposer("chat")}
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ${
                      composerMode === "chat" ? "bg-[#2259f3] text-white" : "bg-[#1f334f] text-white"
                    }`}
                    title="Chat composer"
                  >
                    <span className="text-[11px]">T</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => focusComposer("code")}
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ${
                      composerMode === "code" ? "bg-[#2259f3] text-white" : "bg-[#1f334f] text-white"
                    }`}
                    title="Code composer"
                  >
                    <span className="text-[8px] leading-none">{modeBadgeLabel("code")}</span>
                  </button>
                  {effectiveLanguage === "python" ? (
                    <button
                      type="button"
                      onClick={() => focusComposer("test")}
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ${
                        composerMode === "test" ? "bg-[#0f766e] text-white" : "bg-[#35524d] text-[#d1fae5]"
                      }`}
                      title="Test input composer"
                    >
                      in
                    </button>
                  ) : null}
                </div>
                <div
                  className={`relative overflow-hidden rounded-2xl rounded-br-none border ${
                    composerMode === "code"
                      ? "border-white/20 bg-[#0e1117]"
                      : composerMode === "test"
                        ? isDark
                          ? "border-[#34d399]/40 bg-[#0f1724]"
                          : "border-[#34d399]/50 bg-[#ecfeff]"
                      : isDark
                        ? "border-white/20 bg-[#151b24]"
                        : "border-black/15 bg-white"
                  } h-full`}
                >
                  {composerMode === "test" && effectiveLanguage === "python" && pyodideStatus !== "ready" ? (
                    <div className="flex h-full flex-col items-start justify-center gap-2 px-3 py-2">
                      <p className={`text-[12px] ${isDark ? "text-[#d1fae5]" : "text-[#065f46]"}`}>
                        Local test mode uses Pyodide.
                      </p>
                      <button
                        type="button"
                        onClick={() => void downloadPyodide()}
                        disabled={pyodideStatus === "loading"}
                        className={`h-7 rounded-md border px-2 text-[11px] font-semibold ${
                          isDark ? "border-[#34d399]/50 bg-[#052e2b] text-[#d1fae5]" : "border-[#10b981]/40 bg-[#d1fae5] text-[#065f46]"
                        }`}
                      >
                        {pyodideStatus === "loading" ? "Downloading Pyodide..." : "Download Pyodide"}
                      </button>
                      {pyodideStatus === "error" ? (
                        <p className={`text-[11px] ${isDark ? "text-[#fca5a5]" : "text-[#b42318]"}`}>
                          Could not load Pyodide. Try again.
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <textarea
                      ref={composerMode === "code" ? codeInputRef : composerMode === "test" ? testInputRef : chatInputRef}
                      value={composerMode === "code" ? code : composerMode === "test" ? testInput : draft}
                      inputMode="none"
                      spellCheck={composerMode === "chat"}
                      onKeyDown={handleComposerKeyDown}
                      onKeyUp={() => syncCursorFromDom(composerMode)}
                      onInput={() => syncCursorFromDom(composerMode)}
                      onChange={(event) => {
                        if (composerMode === "code") setCode(event.target.value);
                        else if (composerMode === "test") setTestInput(event.target.value);
                        else setDraft(event.target.value);
                      }}
                      onFocus={() => focusComposer(composerMode)}
                      onClick={() => syncCursorFromDom(composerMode)}
                      onSelect={() => syncCursorFromDom(composerMode)}
                      rows={composerMode === "code" ? 1 : composerMode === "test" ? 3 : 2}
                      placeholder={
                        composerMode === "code"
                          ? `${effectiveLanguage} bubble (hold enter to submit)`
                          : composerMode === "test"
                            ? "python test input bubble (stdin/custom case)"
                            : "message bubble"
                      }
                      className={`h-full w-full resize-none border-0 px-3 py-2 outline-none ${
                        composerMode === "code"
                          ? "overflow-y-auto bg-[#0e1117] font-mono text-[12px] leading-5 text-[#e5e7eb] caret-[#e5e7eb]"
                          : composerMode === "test"
                            ? `${isDark ? "bg-[#0f1724] text-[#d1fae5] caret-[#d1fae5]" : "bg-[#ecfeff] text-[#065f46] caret-[#065f46]"} font-mono text-[12px] leading-5`
                            : `${isDark ? "bg-[#151b24] text-[#e5e7eb] caret-[#e5e7eb]" : "bg-transparent text-[#111] caret-[#111]"} text-sm`
                      }`}
                    />
                  )}
                </div>
              </div>
            </div>
            {userHasPrev ? (
              <button
                type="button"
                onPointerDown={() => startFabHold("user", "prev")}
                onPointerUp={() => endFabHold("user", "prev")}
                onPointerCancel={() => endFabHold("user", "prev")}
                onPointerLeave={() => endFabHold("user", "prev")}
                className={`absolute bottom-2 left-2 h-8 w-8 rounded-full bg-[#1f334f] text-sm font-bold text-white shadow ${
                  userFabFlash ? "l33-fab-flash" : ""
                }`}
                title="Previous user message (hold to start)"
              >
                ←
              </button>
            ) : null}
            {userHasMore ? (
              <button
                type="button"
                onPointerDown={() => startFabHold("user", "next")}
                onPointerUp={() => endFabHold("user", "next")}
                onPointerCancel={() => endFabHold("user", "next")}
                onPointerLeave={() => endFabHold("user", "next")}
                className={`absolute bottom-2 right-2 h-8 w-8 rounded-full bg-[#1f334f] text-sm font-bold text-white shadow ${
                  userFabFlash ? "l33-fab-flash" : ""
                }`}
                title="Next user message (hold to end)"
              >
                →
              </button>
            ) : null}
          </section>
        </div>
      </section>

      {showKeyboard ? (
      <section className={`z-30 border-t px-2 pt-1 pb-2 backdrop-blur ${isDark ? "border-white/15 bg-[#121720]" : "border-black/10 bg-[#eceae2]"}`}>
        <div className="w-full [text-size-adjust:100%]">
          <div className="space-y-px">
            {keyboardLayout.map((row, rowIndex) => {
              const rowHeight = rowHeightPx(row);
              return (
              <div
                key={`row-${rowIndex}`}
                className="grid gap-px"
                style={{ minHeight: rowHeight, gridTemplateColumns: rowTemplateColumns(row) }}
              >
                {(row.offsetUnits ?? 0) > 0 ? <div /> : null}
                {row.keys.map((key, keyIndex) => {
                  const token = key.token;
                  const keyBaseClass = `h-full w-full select-none overflow-hidden rounded-[10px] border px-1 text-center font-mono text-[11px] leading-[1] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition active:translate-y-[1px] [touch-action:none] [-webkit-touch-callout:none]`;
                  const arrowCircleClass = `mx-auto flex h-[80%] w-auto aspect-square items-center justify-center rounded-full border text-[11px] leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition active:translate-y-[1px] [touch-action:none] [-webkit-touch-callout:none]`;
                  const keyToneClass =
                    token === "SHIFT" && (shiftOn || capsOn)
                      ? "border-[#7aa2ff] bg-[#22407a] text-white"
                      : isDark
                        ? "border-white/15 bg-[#1a2230] text-[#e5e7eb]"
                        : "border-black/10 bg-white text-black";

                  if (token === "UPDOWN") {
                    return (
                      <div
                        key={`${rowIndex}-${keyIndex}-${token}`}
                        className="grid grid-rows-2 gap-px"
                      >
                        <button
                          type="button"
                          onPointerDown={(event) => {
                            event.preventDefault();
                            capturePointer(event.currentTarget, event.pointerId);
                            startKeyRepeat("UP");
                          }}
                          onPointerUp={(event) => {
                            releasePointer(event.currentTarget, event.pointerId);
                            stopKeyRepeat();
                          }}
                          onPointerLeave={() => {
                            // pointer capture keeps repeat stable during slight finger drift
                          }}
                          onPointerCancel={stopKeyRepeat}
                          onContextMenu={(event) => event.preventDefault()}
                          className={`${arrowCircleClass} ${isDark ? "border-white/15 bg-[#1a2230] text-[#e5e7eb]" : "border-black/10 bg-white text-black"}`}
                        >
                          <ArrowUp size={13} strokeWidth={2.4} />
                        </button>
                        <button
                          type="button"
                          onPointerDown={(event) => {
                            event.preventDefault();
                            capturePointer(event.currentTarget, event.pointerId);
                            startKeyRepeat("DOWN");
                          }}
                          onPointerUp={(event) => {
                            releasePointer(event.currentTarget, event.pointerId);
                            stopKeyRepeat();
                          }}
                          onPointerLeave={() => {
                            // pointer capture keeps repeat stable during slight finger drift
                          }}
                          onPointerCancel={stopKeyRepeat}
                          onContextMenu={(event) => event.preventDefault()}
                          className={`${arrowCircleClass} ${isDark ? "border-white/15 bg-[#1a2230] text-[#e5e7eb]" : "border-black/10 bg-white text-black"}`}
                        >
                          <ArrowDown size={13} strokeWidth={2.4} />
                        </button>
                      </div>
                    );
                  }

                  if (token === "ARROWS") {
                    const arrowToneClass = isDark ? "border-white/15 bg-[#1a2230] text-[#e5e7eb]" : "border-black/10 bg-white text-black";
                    const dpadButtonClass = `absolute flex h-[38%] w-[38%] items-center justify-center rounded-full border shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition active:translate-y-[1px] [touch-action:none] [-webkit-touch-callout:none] ${arrowToneClass}`;
                    return (
                      <div
                        key={`${rowIndex}-${keyIndex}-${token}`}
                        className="flex h-full w-full items-center justify-center"
                      >
                        <div className="relative h-[88%] w-auto aspect-square">
                          <button
                            type="button"
                            onPointerDown={(event) => {
                              event.preventDefault();
                              capturePointer(event.currentTarget, event.pointerId);
                              startKeyRepeat("LEFT");
                            }}
                            onPointerUp={(event) => {
                              releasePointer(event.currentTarget, event.pointerId);
                              stopKeyRepeat();
                            }}
                            onPointerLeave={() => {
                              // pointer capture keeps repeat stable during slight finger drift
                            }}
                            onPointerCancel={stopKeyRepeat}
                            onContextMenu={(event) => event.preventDefault()}
                            className={`${dpadButtonClass} left-0 top-1/2 -translate-x-0 -translate-y-1/2`}
                          >
                            <ArrowLeft size={13} strokeWidth={2.4} />
                          </button>
                          <button
                            type="button"
                            onPointerDown={(event) => {
                              event.preventDefault();
                              capturePointer(event.currentTarget, event.pointerId);
                              startKeyRepeat("UP");
                            }}
                            onPointerUp={(event) => {
                              releasePointer(event.currentTarget, event.pointerId);
                              stopKeyRepeat();
                            }}
                            onPointerLeave={() => {
                              // pointer capture keeps repeat stable during slight finger drift
                            }}
                            onPointerCancel={stopKeyRepeat}
                            onContextMenu={(event) => event.preventDefault()}
                            className={`${dpadButtonClass} left-1/2 top-0 -translate-x-1/2 -translate-y-0`}
                          >
                            <ArrowUp size={13} strokeWidth={2.4} />
                          </button>
                          <button
                            type="button"
                            onPointerDown={(event) => {
                              event.preventDefault();
                              capturePointer(event.currentTarget, event.pointerId);
                              startKeyRepeat("DOWN");
                            }}
                            onPointerUp={(event) => {
                              releasePointer(event.currentTarget, event.pointerId);
                              stopKeyRepeat();
                            }}
                            onPointerLeave={() => {
                              // pointer capture keeps repeat stable during slight finger drift
                            }}
                            onPointerCancel={stopKeyRepeat}
                            onContextMenu={(event) => event.preventDefault()}
                            className={`${dpadButtonClass} left-1/2 bottom-0 -translate-x-1/2 translate-y-0`}
                          >
                            <ArrowDown size={13} strokeWidth={2.4} />
                          </button>
                          <button
                            type="button"
                            onPointerDown={(event) => {
                              event.preventDefault();
                              capturePointer(event.currentTarget, event.pointerId);
                              startKeyRepeat("RIGHT");
                            }}
                            onPointerUp={(event) => {
                              releasePointer(event.currentTarget, event.pointerId);
                              stopKeyRepeat();
                            }}
                            onPointerLeave={() => {
                              // pointer capture keeps repeat stable during slight finger drift
                            }}
                            onPointerCancel={stopKeyRepeat}
                            onContextMenu={(event) => event.preventDefault()}
                            className={`${dpadButtonClass} right-0 top-1/2 translate-x-0 -translate-y-1/2`}
                          >
                            <ArrowRight size={13} strokeWidth={2.4} />
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <button
                      key={`${rowIndex}-${keyIndex}-${token}`}
                      type="button"
                      ref={(el) => registerFuzzyKey(`k-${rowIndex}-${keyIndex}`, { token, rowIndex, keyIndex }, el)}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        capturePointer(event.currentTarget, event.pointerId);
                        beginFuzzyPointer(event.pointerId, token, rowIndex, event.clientX, event.clientY);
                        startKeyPress(token);
                      }}
                      onPointerMove={(event) => {
                        updateFuzzyPointer(event.pointerId, event.clientX, event.clientY);
                      }}
                      onPointerUp={(event) => {
                        event.preventDefault();
                        updateFuzzyPointer(event.pointerId, event.clientX, event.clientY);
                        releasePointer(event.currentTarget, event.pointerId);
                        const resolvedToken = resolveFuzzyToken(event.pointerId, token, rowIndex, event.clientX, event.clientY);
                        endKeyPress(resolvedToken);
                        clearFuzzyPointer(event.pointerId);
                      }}
                      onPointerLeave={() => {
                        // pointer capture keeps press active during slight finger drift
                      }}
                      onPointerCancel={(event) => {
                        clearFuzzyPointer(event.pointerId);
                        cancelKeyPress(token);
                      }}
                      onContextMenu={(event) => event.preventDefault()}
                      className={`${keyBaseClass} ${keyToneClass}`}
                    >
                      {token === "BACKSPACE" ? (
                        <Delete size={13} strokeWidth={2.2} className="mx-auto" />
                      ) : /^[a-z]$/.test(token) ? (
                        (capsOn ? !shiftOn : shiftOn) ? token.toUpperCase() : token.toLowerCase()
                      ) : (
                        labelForKey(token)
                      )}
                    </button>
                  );
                })}
                {(row.offsetUnits ?? 0) > 0 ? <div /> : null}
              </div>
            )})}
          </div>
        </div>

        {error ? <p className={`pt-1 text-[11px] ${isDark ? "text-[#ff8383]" : "text-[#b42318]"}`}>{error}</p> : null}
      </section>
      ) : null}
    </main>
  );
}
