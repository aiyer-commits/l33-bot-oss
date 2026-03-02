"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clampConfidence, createInitialProfile, getProblemById } from "@/lib/leetcode75";
import type { ChatApiResponse, ChatMessage, LocalProfile } from "@/lib/types";

const PROFILE_KEY = "l33tsp33k.profile.v2";
const CHAT_KEY = "l33tsp33k.chat.v2";
const CODE_KEY = "l33tsp33k.code.v2";
const TEXT_KEY = "l33tsp33k.text.v2";
const ANON_ID_KEY = "l33tsp33k.anon-id.v1";
const THEME_KEY = "l33tsp33k.theme.v1";

type TargetField = "chat" | "code";
type ComposerMode = "chat" | "code";
type ThemeMode = "light" | "dark";

type Cursor = { start: number; end: number };

type KeySpec = { token: string; units?: number };
type KeyboardRow = { offsetUnits?: number; heightUnits?: number; keys: KeySpec[] };
const BASE_KEY_HEIGHT = "clamp(44px, 9.6vw, 66px)";

const KEYBOARD_LAYOUT: KeyboardRow[] = [
  {
    heightUnits: 0.9,
    keys: [
      { token: "TAB", units: 1.5 },
      { token: "LEFT", units: 1.2 },
      { token: "UPDOWN", units: 1.2 },
      { token: "RIGHT", units: 1.2 },
      { token: "~" },
      { token: "!" },
      { token: "@" },
      { token: "#" },
      { token: "$" },
      { token: "%" },
      { token: "^" },
      { token: "&" },
      { token: "*" },
      { token: "(" },
      { token: ")" },
      { token: "_" },
      { token: "+" },
      { token: "{" },
      { token: "}" },
      { token: "|" },
    ],
  },
  {
    heightUnits: 0.95,
    keys: [
      { token: "`" },
      { token: "1" },
      { token: "2" },
      { token: "3" },
      { token: "4" },
      { token: "5" },
      { token: "6" },
      { token: "7" },
      { token: "8" },
      { token: "9" },
      { token: "0" },
      { token: "-" },
      { token: "=" },
      { token: "[" },
      { token: "]" },
      { token: "\\" },
      { token: ";" },
      { token: "'" },
      { token: "," },
      { token: "." },
      { token: "/" },
    ],
  },
  {
    offsetUnits: 0,
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
      { token: "BACKSPACE", units: 1.1 },
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
    offsetUnits: 1.0,
    heightUnits: 1.0,
    keys: [
      { token: "SHIFT", units: 1.25 },
      { token: "z" },
      { token: "x" },
      { token: "c" },
      { token: "v" },
      { token: "b" },
      { token: "n" },
      { token: "m" },
      { token: "SHIFT", units: 1.25 },
    ],
  },
  {
    heightUnits: 1.2,
    keys: [
      { token: ":" },
      { token: '"' },
      { token: "<" },
      { token: ">" },
      { token: "?" },
      { token: "SPACE", units: 6 },
      { token: "ENTER", units: 1.8 },
      { token: "CLEAR", units: 1.5 },
    ],
  },
];

function nowIso() {
  return new Date().toISOString();
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

  return [
    asMessage(
      "assistant",
      [
        "Welcome to l33tsp33k.",
        `Current problem #${problem.id}: ${problem.title}`,
        problem.statement,
        "Chat above. Problem lives in the collapsible header. Compose in chat/code mode with the custom keyboard.",
      ].join("\n\n"),
      "text",
    ),
  ];
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

  const [composerMode, setComposerMode] = useState<ComposerMode>("chat");
  const [shiftOn, setShiftOn] = useState(false);

  const [chatCursor, setChatCursor] = useState<Cursor>({ start: 0, end: 0 });
  const [codeCursor, setCodeCursor] = useState<Cursor>({ start: 0, end: 0 });

  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const codeInputRef = useRef<HTMLTextAreaElement | null>(null);

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
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

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

  const activeProblem = useMemo(() => {
    if (!profile) return null;
    return getProblemById(profile.activeProblemId) ?? null;
  }, [profile]);

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
      setShiftOn((v) => !v);
      return;
    }
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
      result = applyInsert(source, cursor, "\n");
    } else if (token === "TAB") {
      result = applyInsert(source, cursor, "    ");
    } else {
      const isLetter = /^[a-z]$/i.test(token);
      if (isLetter) {
        const upper = shiftOn;
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
          setMessages((prev) => [
            ...prev,
            asMessage(
              "assistant",
              `Switched to #${movedProblem.id}: ${movedProblem.title}\n\n${movedProblem.statement}`,
              "text",
            ),
          ]);
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

  function labelForKey(token: string) {
    if (token === "SHIFT") return "shift";
    if (token === "TAB") return "tab";
    if (token === "SPACE") return "space";
    if (token === "ENTER") return "enter";
    if (token === "UP") return "↑";
    if (token === "DOWN") return "↓";
    if (token === "LEFT") return "←";
    if (token === "RIGHT") return "→";
    if (token === "BACKSPACE") return "⌫";
    if (token === "CLEAR") return "clear";
    return token;
  }

  function cycleTheme() {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  }

  function keyUnits(key: KeySpec) {
    return key.units ?? 1;
  }

  function rowUnits(row: KeyboardRow) {
    const offset = row.offsetUnits ?? 0;
    return row.keys.reduce((sum, key) => sum + keyUnits(key), offset);
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
    <main className={`mx-auto flex min-h-screen max-w-3xl flex-col ${isDark ? "bg-[#0a0d12] text-[#e5e7eb]" : "bg-[#f3f2ec] text-[#141414]"}`}>
      <header className={`sticky top-0 z-20 border-b px-3 py-2 backdrop-blur ${isDark ? "border-white/15 bg-[#0a0d12]/95" : "border-black/10 bg-[#f3f2ec]/95"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-4">#{activeProblem.id} · {activeProblem.title}</p>
            <div className="mt-0.5 flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${difficultyDotColor(activeProblem.difficulty)}`} />
              <span className={`text-[10px] font-medium ${isDark ? "text-white/70" : "text-black/70"}`}>{activeProblem.difficulty}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={cycleTheme}
              className={`rounded-md border px-2 py-1 text-[11px] font-medium ${isDark ? "border-white/20 bg-white/5" : "border-black/15 bg-white/70"}`}
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
                  className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${isDark ? "border-white/20 bg-white/5" : "border-black/15 bg-white/70"}`}
                  title={`Buy credits${authUser ? ` (bal $${creditBalance.toFixed(2)})` : ""}`}
                >
                  {purchaseLoading ? "…" : "$"}
                </button>
                <a
                  href="/auth/sign-out"
                  title="Logout"
                  className={`rounded-md border px-2 py-1 text-[11px] font-medium ${isDark ? "border-white/20 bg-white/5" : "border-black/15 bg-white/70"}`}
                >
                  ⇥
                </a>
              </>
            ) : (
              <a
                href="/auth/sign-in?returnTo=/"
                title="Login"
                className={`rounded-md border px-2 py-1 text-[11px] font-medium ${isDark ? "border-white/20 bg-white/5" : "border-black/15 bg-white/70"}`}
              >
                ⇤
              </a>
            )}
          </div>
        </div>
        <p className={`mt-1 whitespace-pre-wrap text-[11px] leading-4 ${isDark ? "text-white/85" : "text-black/85"}`}>
          {activeProblem.statement}
        </p>
      </header>

      <section className="flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-2 pb-[360px]">
          {messages.map((message, index) => {
            const isAssistant = message.role === "assistant";
            const baseClass = isAssistant
              ? `max-w-[94%] rounded-xl rounded-tl-sm ${isDark ? "bg-[#151b24]" : "bg-white"}`
              : "ml-auto max-w-[94%] rounded-xl rounded-tr-sm bg-[#1f334f] text-white";

            return (
              <article key={`${message.createdAt}-${index}`} className={`${baseClass} relative px-3 py-2 text-sm shadow-sm`}>
                <span
                  aria-hidden
                  className={`absolute bottom-1 h-2.5 w-2.5 rotate-45 ${
                    isAssistant
                      ? `${isDark ? "bg-[#151b24]" : "bg-white"} -left-1`
                      : "right-[-5px] bg-[#1f334f]"
                  }`}
                />
                {message.kind === "code" ? (
                  <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[12px] leading-5">{message.content}</pre>
                ) : (
                  <p className="whitespace-pre-wrap leading-5">{message.content}</p>
                )}
              </article>
            );
          })}
          <div className="relative ml-auto w-full max-w-[88%] pl-8">
            <button
              type="button"
              disabled={isSending || !draft.trim()}
              onClick={() => {
                void sendTurn({ sendText: true, sendCode: false });
              }}
              className="absolute left-0 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full bg-[#1f334f] text-sm font-bold text-white disabled:opacity-50"
            >
              ✓
            </button>
            <div className={`relative overflow-hidden rounded-2xl rounded-tr-sm border ${isDark ? "border-white/20 bg-[#151b24]" : "border-black/15 bg-white"}`}>
              <span
                aria-hidden
                className={`absolute bottom-1 right-[-5px] h-2.5 w-2.5 rotate-45 ${isDark ? "bg-[#151b24]" : "bg-white"}`}
              />
              <textarea
                ref={chatInputRef}
                value={draft}
                inputMode="none"
                onKeyDown={(event) => event.preventDefault()}
                onChange={(event) => setDraft(event.target.value)}
                onFocus={() => focusComposer("chat")}
                onClick={() => syncCursorFromDom("chat")}
                onSelect={() => syncCursorFromDom("chat")}
                rows={2}
                placeholder="message bubble"
                className={`w-full resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none ${isDark ? "text-[#e5e7eb] caret-[#e5e7eb]" : "text-[#111] caret-[#111]"}`}
              />
            </div>
          </div>

          <div className="relative ml-auto w-full max-w-[92%] pl-8">
            <button
              type="button"
              disabled={isSending || !code.trim()}
              onClick={() => {
                void sendTurn({ sendText: false, sendCode: true });
              }}
              className="absolute left-0 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full bg-[#2259f3] text-sm font-bold text-white disabled:opacity-50"
            >
              ✓
            </button>
            <div className="relative overflow-hidden rounded-2xl rounded-tr-sm border border-white/20 bg-[#0e1117]">
              <span aria-hidden className="absolute bottom-1 right-[-5px] h-2.5 w-2.5 rotate-45 bg-[#0e1117]" />
              <textarea
                ref={codeInputRef}
                value={code}
                inputMode="none"
                spellCheck={false}
                onKeyDown={(event) => event.preventDefault()}
                onChange={(event) => setCode(event.target.value)}
                onFocus={() => focusComposer("code")}
                onClick={() => syncCursorFromDom("code")}
                onSelect={() => syncCursorFromDom("code")}
                rows={4}
                placeholder="pinned code bubble"
                className="w-full resize-none border-0 bg-[#0e1117] px-3 py-2 font-mono text-[12px] leading-5 text-[#e5e7eb] caret-[#e5e7eb] outline-none"
              />
            </div>
          </div>
          <div ref={chatBottomRef} />
        </div>
      </section>

      <section className={`sticky bottom-0 z-30 border-t px-2 pt-1 pb-2 backdrop-blur ${isDark ? "border-white/15 bg-[#0f141d]/98" : "border-black/10 bg-white/98"}`}>
        <div className={`rounded-md border p-px ${isDark ? "border-white/20 bg-[#121720]" : "border-black/15 bg-[#eceae2]"}`}>
          <div className="space-y-px">
            {KEYBOARD_LAYOUT.map((row, rowIndex) => {
              const totalUnits = rowUnits(row);
              const leftOffsetPct = (((row.offsetUnits ?? 0) / totalUnits) * 100).toFixed(4);
              const rowHeight = rowHeightPx(row);
              return (
              <div key={`row-${rowIndex}`} className="flex gap-px" style={{ height: rowHeight }}>
                {(row.offsetUnits ?? 0) > 0 ? <div style={{ width: `${leftOffsetPct}%` }} className="shrink-0" /> : null}
                {row.keys.map((key, keyIndex) => {
                  const token = key.token;
                  const widthPct = ((keyUnits(key) / totalUnits) * 100).toFixed(4);
                  if (token === "UPDOWN") {
                    return (
                      <div
                        key={`${rowIndex}-${keyIndex}-${token}`}
                        className="shrink-0 grid grid-rows-2 gap-px"
                        style={{ width: `${widthPct}%` }}
                      >
                        <button
                          type="button"
                          onClick={() => pressKey("UP")}
                          className={`h-full border px-0.5 text-center font-mono text-[12px] ${isDark ? "border-white/15 bg-[#1a2230] text-[#e5e7eb]" : "border-black/10 bg-white"}`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => pressKey("DOWN")}
                          className={`h-full border px-0.5 text-center font-mono text-[12px] ${isDark ? "border-white/15 bg-[#1a2230] text-[#e5e7eb]" : "border-black/10 bg-white"}`}
                        >
                          ↓
                        </button>
                      </div>
                    );
                  }

                  return (
                    <button
                      key={`${rowIndex}-${keyIndex}-${token}`}
                      type="button"
                      onClick={() => {
                        if (token === "CLEAR") {
                          clearField(composerMode);
                        } else {
                          pressKey(token);
                        }
                      }}
                      style={{ width: `${widthPct}%` }}
                      className={`h-full shrink-0 border px-1 text-center font-mono text-[12px] ${
                        token === "SHIFT" && shiftOn
                          ? "border-[#7aa2ff] bg-[#22407a] text-white"
                          : isDark
                            ? "border-white/15 bg-[#1a2230] text-[#e5e7eb]"
                            : "border-black/10 bg-white"
                      }`}
                    >
                      {/^[a-z]$/.test(token) ? (shiftOn ? token.toUpperCase() : token.toLowerCase()) : labelForKey(token)}
                    </button>
                  );
                })}
              </div>
            )})}
          </div>
        </div>

        {error ? <p className={`pt-1 text-[11px] ${isDark ? "text-[#ff8383]" : "text-[#b42318]"}`}>{error}</p> : null}
      </section>
    </main>
  );
}
