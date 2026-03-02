"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Delete } from "lucide-react";
import { clampConfidence, createInitialProfile, getProblemById } from "@/lib/leetcode75";
import type { ChatApiResponse, ChatMessage, LocalProfile } from "@/lib/types";

const PROFILE_KEY = "l33tsp33k.profile.v2";
const CHAT_KEY = "l33tsp33k.chat.v2";
const CODE_KEY = "l33tsp33k.code.v2";
const TEXT_KEY = "l33tsp33k.text.v2";
const ANON_ID_KEY = "l33tsp33k.anon-id.v1";
const THEME_KEY = "l33tsp33k.theme.v1";
const HOLD_DELAY_MS = 320;
const REPEAT_DELAY_MS = 260;
const REPEAT_INTERVAL_MS = 42;
const INDENT_TOKEN = "\t";

const TAP_OUTPUT_MAP: Record<string, string> = {
  "&": "and ",
  "|": "or ",
  "!": "not ",
  "@": "@lru_cache(None)\ndef ",
  for: "for ",
  while: "while ",
  if: "if ",
  elif: "elif ",
  else: "else ",
  in: "in ",
};

const HOLD_OUTPUT_MAP: Record<string, string> = {
  "&": "&",
  "|": "|",
  "!": "!",
  "<": "<<",
  ">": ">>",
  "1": "True",
  "0": "False",
  "@": "@",
};

type TargetField = "chat" | "code";
type ComposerMode = "chat" | "code";
type ThemeMode = "light" | "dark";

type Cursor = { start: number; end: number };

type KeySpec = { token: string; units?: number };
type KeyboardRow = { offsetUnits?: number; heightUnits?: number; keys: KeySpec[] };
type FuzzyKeyMeta = { token: string; rowIndex: number; keyIndex: number; el: HTMLButtonElement };
const BASE_KEY_HEIGHT = "clamp(44px, 9.6vw, 58px)";

const KEYBOARD_LAYOUT: KeyboardRow[] = [
  {
    heightUnits: 0.92,
    keys: [
      { token: "<" },
      { token: ">" },
      { token: "1" },
      { token: "2" },
      { token: "3" },
      { token: "for" },
      { token: "while" },
      { token: "if" },
      { token: "^" },
      { token: "~" },
      { token: "#" },
    ],
  },
  {
    heightUnits: 0.92,
    keys: [
      { token: "[" },
      { token: "]" },
      { token: "4" },
      { token: "5" },
      { token: "6" },
      { token: "elif" },
      { token: "else" },
      { token: "in" },
      { token: '"' },
      { token: "?" },
      { token: "@" },
    ],
  },
  {
    heightUnits: 0.92,
    keys: [
      { token: "{" },
      { token: "}" },
      { token: "7" },
      { token: "8" },
      { token: "9" },
      { token: "&" },
      { token: "|" },
      { token: "!" },
      { token: "/" },
      { token: "%" },
      { token: "=" },
    ],
  },
  {
    heightUnits: 0.92,
    keys: [
      { token: "(" },
      { token: ")" },
      { token: "_" },
      { token: "0" },
      { token: ":" },
      { token: "," },
      { token: "." },
      { token: "'" },
      { token: "+" },
      { token: "-" },
      { token: "*" },
    ],
  },
  {
    heightUnits: 1.0,
    keys: [
      { token: "q" },
      { token: "w" },
      { token: "e" },
      { token: "r" },
      { token: "t" },
      { token: "y" },
      { token: "u" },
      { token: "i" },
      { token: "o" },
      { token: "p" },
    ],
  },
  {
    offsetUnits: 0.5,
    heightUnits: 1.0,
    keys: [
      { token: "a" },
      { token: "s" },
      { token: "d" },
      { token: "f" },
      { token: "g" },
      { token: "h" },
      { token: "j" },
      { token: "k" },
      { token: "l" },
    ],
  },
  {
    heightUnits: 1.0,
    keys: [
      { token: "SHIFT", units: 1.5 },
      { token: "z" },
      { token: "x" },
      { token: "c" },
      { token: "v" },
      { token: "b" },
      { token: "n" },
      { token: "m" },
      { token: "BACKSPACE", units: 1.5 },
    ],
  },
  {
    heightUnits: 1.08,
    keys: [
      { token: "TAB", units: 1.8 },
      { token: "ARROWS", units: 1.8 },
      { token: "SPACE", units: 4 },
      { token: "ENTER", units: 3.6 },
    ],
  },
];

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
  return [asMessage("assistant", "Welcome to l33.bot.", "text"), ...buildProblemMessages(problem.id)];
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

function applySmartEnter(source: string, cursor: Cursor): { value: string; cursor: Cursor } {
  const currentLine = lineBounds(source, cursor.start);
  const linePrefix = source.slice(currentLine.start, cursor.start);
  const indentMatch = linePrefix.match(/^\t*/);
  const baseIndent = indentMatch ? indentMatch[0] : "";
  const trimmedPrefix = linePrefix.trimEnd();
  if (trimmedPrefix.endsWith(":")) {
    return applyInsert(source, cursor, `\n${baseIndent}${INDENT_TOKEN}`);
  }

  // Python smart dedent after block-exit statements.
  const dedentMatch = trimmedPrefix.match(/^\t*(return|pass|break|continue|raise)\b/);
  if (dedentMatch && baseIndent.length > 0) {
    return applyInsert(source, cursor, `\n${baseIndent.slice(0, -INDENT_TOKEN.length)}`);
  }

  return applyInsert(source, cursor, `\n${baseIndent}`);
}

export default function Home() {
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [code, setCode] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState<string>("");
  const [anonId, setAnonId] = useState<string>("");
  const [authUser, setAuthUser] = useState<{ id: string; email?: string | null } | null>(null);
  const [creditBalance, setCreditBalance] = useState<number>(0);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>("light");

  const [composerMode, setComposerMode] = useState<ComposerMode>("code");
  const [shiftOn, setShiftOn] = useState(false);
  const [capsOn, setCapsOn] = useState(false);

  const [chatCursor, setChatCursor] = useState<Cursor>({ start: 0, end: 0 });
  const [codeCursor, setCodeCursor] = useState<Cursor>({ start: 0, end: 0 });
  const [assistantHasMore, setAssistantHasMore] = useState(false);
  const [userHasMore, setUserHasMore] = useState(false);
  const [assistantHasPrev, setAssistantHasPrev] = useState(false);
  const [userHasPrev, setUserHasPrev] = useState(false);
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
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const codeInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fuzzyKeyMapRef = useRef<Map<string, FuzzyKeyMeta>>(new Map());
  const activeFuzzyPointerRef = useRef<{ pointerId: number; token: string; rowIndex: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const profileRaw = localStorage.getItem(PROFILE_KEY);
    const chatRaw = localStorage.getItem(CHAT_KEY);
    const textRaw = localStorage.getItem(TEXT_KEY);
    const codeRaw = localStorage.getItem(CODE_KEY);
    const themeRaw = localStorage.getItem(THEME_KEY);

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
    if (themeRaw === "dark" || themeRaw === "light") setTheme(themeRaw);

    const hydrate = async () => {
      try {
        const response = await fetch(`/api/auth/session?anonId=${encodeURIComponent(localAnonId ?? "")}`);
        if (!response.ok) return;
        const payload = await response.json();
        setAuthUser(payload.user ?? null);
        setCreditBalance(payload.credits?.balanceDollars ?? 0);

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
        // Ignore hydration failures; app still works in local-only mode.
      }
    };

    void hydrate();
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
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (composerMode === "chat") chatInputRef.current?.focus();
      else codeInputRef.current?.focus();
    });
  }, [composerMode]);

  useEffect(() => () => {
    stopKeyRepeat();
    clearHoldTimer();
    if (assistantScrollRafRef.current != null) window.cancelAnimationFrame(assistantScrollRafRef.current);
    if (userScrollRafRef.current != null) window.cancelAnimationFrame(userScrollRafRef.current);
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

  const activeProblem = useMemo(() => {
    if (!profile) return null;
    return getProblemById(profile.activeProblemId) ?? null;
  }, [profile]);
  const assistantMessages = useMemo(() => messages.filter((msg) => msg.role === "assistant"), [messages]);
  const userMessages = useMemo(() => messages.filter((msg) => msg.role === "user"), [messages]);

  const activeProblemMessageIndex = useMemo(() => {
    if (!activeProblem) return -1;
    for (let i = assistantMessages.length - 1; i >= 0; i -= 1) {
      if (extractProblemMessageId(assistantMessages[i]) === activeProblem.id) return i;
    }
    return -1;
  }, [assistantMessages, activeProblem]);

  const isDark = theme === "dark";

  function focusComposer(mode: ComposerMode) {
    setComposerMode(mode);
    requestAnimationFrame(() => {
      if (mode === "chat") chatInputRef.current?.focus();
      if (mode === "code") codeInputRef.current?.focus();
    });
  }

  function syncCursorFromDom(target: TargetField) {
    const ref = target === "chat" ? chatInputRef.current : codeInputRef.current;
    if (!ref) return;
    const cursor: Cursor = { start: ref.selectionStart ?? 0, end: ref.selectionEnd ?? 0 };
    if (target === "chat") setChatCursor(cursor);
    else setCodeCursor(cursor);
  }

  function setCursorOnDom(target: TargetField, cursor: Cursor) {
    const ref = target === "chat" ? chatInputRef.current : codeInputRef.current;
    if (!ref) return;
    requestAnimationFrame(() => {
      ref.focus();
      ref.setSelectionRange(cursor.start, cursor.end);
      if (target === "chat") setChatCursor(cursor);
      else setCodeCursor(cursor);
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
    const source = target === "chat" ? draft : code;
    const cursor = target === "chat" ? chatCursor : codeCursor;

    let result: { value: string; cursor: Cursor } = { value: source, cursor };

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
      result = target === "code" ? applySmartEnter(source, cursor) : applyInsert(source, cursor, "\n");
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
        if (shiftOn) setShiftOn(false);
      } else {
        result = applyInsert(source, cursor, token);
      }
    }

    if (target === "chat") {
      setDraft(result.value);
    } else {
      setCode(result.value);
    }

    setCursorOnDom(target, result.cursor);
  }

  function clearField(target: TargetField) {
    if (target === "chat") {
      setDraft("");
      setCursorOnDom("chat", { start: 0, end: 0 });
    } else {
      setCode("");
      setCursorOnDom("code", { start: 0, end: 0 });
    }
  }

  async function startCheckout() {
    if (!authUser || purchaseLoading) return;
    setPurchaseLoading(true);
    setError("");
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: 1 }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Checkout failed");
      if (payload.url) {
        window.location.href = payload.url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setPurchaseLoading(false);
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
      if (payload.activeProblemId && payload.activeProblemId !== profile.activeProblemId) {
        setProfile((prev) => (prev ? { ...prev, activeProblemId: payload.activeProblemId! } : prev));
      }
      if (payload.usage?.remainingBalanceDollars != null) {
        setCreditBalance(payload.usage.remainingBalanceDollars);
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
    void sendTurn({ sendText: true, sendCode: false });
  }

  function labelForKey(token: string) {
    if (token === "SHIFT") return capsOn ? "caps" : "shift";
    if (token === "TAB") return "tab";
    if (token === "SPACE") return "space";
    if (token === "ENTER") return "enter";
    if (token === "UP") return "";
    if (token === "DOWN") return "";
    if (token === "LEFT") return "";
    if (token === "RIGHT") return "";
    if (token === "ARROWS") return "";
    if (token === "BACKSPACE") return "";
    if (token === "&") return "and";
    if (token === "|") return "or";
    if (token === "!") return "not";
    if (token === "@") return "lru";
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
    if (mode === "hold" && HOLD_OUTPUT_MAP[token]) return HOLD_OUTPUT_MAP[token];
    if (mode === "tap" && TAP_OUTPUT_MAP[token]) return TAP_OUTPUT_MAP[token];
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
    if (typeof window === "undefined" || !HOLD_OUTPUT_MAP[token]) return;

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
      stopKeyRepeat();
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

  function scrollToActiveProblemMessage() {
    const target = activeProblemMessageRef.current;
    const scroller = assistantScrollRef.current;
    if (!target || !scroller) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const delta = targetRect.left - scrollerRect.left;
    const targetLeft = scroller.scrollLeft + delta - 8;
    smoothScrollPaneTo(assistantScrollRef, targetLeft);
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
              onClick={scrollToActiveProblemMessage}
              className="max-w-full truncate text-left text-[13px] font-semibold leading-4 underline-offset-2 hover:underline"
              title="Jump to problem statement in chat"
            >
              #{activeProblem.id} · {activeProblem.title}
            </button>
            <div className="mt-0.5 flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${difficultyDotColor(activeProblem.difficulty)}`} />
              <span className={`text-[10px] font-medium ${isDark ? "text-white/70" : "text-black/70"}`}>{activeProblem.difficulty}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={cycleTheme}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-[11px] font-medium ${isDark ? "border-white/20 bg-white/5" : "border-black/15 bg-white/70"}`}
              title="Cycle theme"
            >
              ◐
            </button>
            {authUser ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void startCheckout();
                  }}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-[11px] font-semibold ${isDark ? "border-white/20 bg-white/5" : "border-black/15 bg-white/70"}`}
                  title={`Buy credits${authUser ? ` (bal $${creditBalance.toFixed(2)})` : ""}`}
                >
                  {purchaseLoading ? "…" : "$"}
                </button>
                <a
                  href="/auth/sign-out"
                  title="Logout"
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-[11px] font-medium ${isDark ? "border-white/20 bg-white/5" : "border-black/15 bg-white/70"}`}
                >
                  ⇥
                </a>
              </>
            ) : (
              <a
                href="/auth/sign-in?returnTo=/"
                title="Login"
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-[11px] font-medium ${isDark ? "border-white/20 bg-white/5" : "border-black/15 bg-white/70"}`}
              >
                ⇤
              </a>
            )}
          </div>
        </div>
      </header>

      <section className="min-h-0 flex-1 overflow-hidden">
        <div className="grid h-full grid-rows-2">
          <section className="relative min-h-0 overflow-hidden">
            <div ref={assistantScrollRef} className="no-scrollbar h-full overflow-x-auto overflow-y-hidden px-3 py-3">
              <div className="flex h-full items-stretch gap-2 pr-12">
                {assistantMessages.map((message, index) => (
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
                        <p className="whitespace-pre-wrap leading-5">{message.content}</p>
                      )}
                    </div>
                  </article>
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
                className="absolute bottom-2 left-2 h-8 w-8 rounded-full bg-[#1f334f] text-sm font-bold text-white shadow"
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
                className="absolute bottom-2 right-2 h-8 w-8 rounded-full bg-[#1f334f] text-sm font-bold text-white shadow"
                title="Next assistant message (hold to end)"
              >
                →
              </button>
            ) : null}
          </section>

          <section className="relative min-h-0 overflow-hidden">
            <div ref={userScrollRef} className="no-scrollbar h-full overflow-x-auto overflow-y-hidden px-3 py-3">
              <div className="flex h-full items-stretch gap-2">
                {userMessages.map((message, index) => (
                  <article
                    key={`${message.createdAt}-u-${index}`}
                    className="flex h-full min-h-full max-w-[96%] shrink-0 self-stretch flex-col rounded-xl rounded-br-none bg-[#1f334f] px-3 py-2 text-sm text-white shadow-sm"
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

                <div className="relative ml-auto h-full min-w-0 flex-1 shrink-0 pl-8">
                  <button
                    type="button"
                    onClick={() => {
                      focusComposer(composerMode === "chat" ? "code" : "chat");
                    }}
                    className={`absolute left-0 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[11px] font-bold ${
                      composerMode === "code" ? "bg-[#2259f3] text-white" : "bg-[#1f334f] text-white"
                    }`}
                    title={composerMode === "chat" ? "Mode: text (tap to switch to code)" : "Mode: code (tap to switch to text)"}
                  >
                    <span className={composerMode === "chat" ? "text-[11px]" : "text-[8px] leading-none"}>{composerMode === "chat" ? "T" : "</>"}</span>
                  </button>
                  <div
                    className={`relative overflow-hidden rounded-2xl rounded-br-none border ${
                      composerMode === "code"
                        ? "border-white/20 bg-[#0e1117]"
                        : isDark
                          ? "border-white/20 bg-[#151b24]"
                          : "border-black/15 bg-white"
                    } h-full`}
                  >
                    <textarea
                      ref={composerMode === "code" ? codeInputRef : chatInputRef}
                      value={composerMode === "code" ? code : draft}
                      inputMode="none"
                      spellCheck={composerMode !== "code"}
                      onKeyDown={(event) => event.preventDefault()}
                      onChange={(event) => {
                        if (composerMode === "code") setCode(event.target.value);
                        else setDraft(event.target.value);
                      }}
                      onFocus={() => focusComposer(composerMode)}
                      onClick={() => syncCursorFromDom(composerMode)}
                      onSelect={() => syncCursorFromDom(composerMode)}
                      rows={composerMode === "code" ? 1 : 2}
                      placeholder={composerMode === "code" ? "code bubble (hold enter to submit)" : "message bubble"}
                      className={`h-full w-full resize-none border-0 px-3 py-2 outline-none ${
                        composerMode === "code"
                          ? "overflow-y-auto bg-[#0e1117] font-mono text-[12px] leading-5 text-[#e5e7eb] caret-[#e5e7eb]"
                          : `${isDark ? "bg-[#151b24] text-[#e5e7eb] caret-[#e5e7eb]" : "bg-transparent text-[#111] caret-[#111]"} text-sm`
                      }`}
                    />
                  </div>
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
                className="absolute bottom-2 left-2 h-8 w-8 rounded-full bg-[#1f334f] text-sm font-bold text-white shadow"
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
                className="absolute bottom-2 right-2 h-8 w-8 rounded-full bg-[#1f334f] text-sm font-bold text-white shadow"
                title="Next user message (hold to end)"
              >
                →
              </button>
            ) : null}
          </section>
        </div>
      </section>

      <section className={`z-30 border-t px-2 pt-1 pb-2 backdrop-blur ${isDark ? "border-white/15 bg-[#121720]" : "border-black/10 bg-[#eceae2]"}`}>
        <div className="w-full [text-size-adjust:100%]">
          <div className="space-y-px">
            {KEYBOARD_LAYOUT.map((row, rowIndex) => {
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
                  const keyBaseClass = `h-full w-full select-none overflow-hidden rounded-[10px] border px-1 text-center font-mono text-[11px] leading-[1] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition active:translate-y-[1px] [touch-action:manipulation] [-webkit-touch-callout:none]`;
                  const arrowCircleClass = `mx-auto flex h-[80%] w-auto aspect-square items-center justify-center rounded-full border text-[11px] leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition active:translate-y-[1px] [touch-action:manipulation] [-webkit-touch-callout:none]`;
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
                    const dpadButtonClass = `absolute flex h-[38%] w-[38%] items-center justify-center rounded-full border shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition active:translate-y-[1px] [touch-action:manipulation] [-webkit-touch-callout:none] ${arrowToneClass}`;
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
    </main>
  );
}
