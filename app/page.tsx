"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { clampConfidence, createInitialProfile, getProblemById } from "@/lib/leetcode75";
import type { ChatApiResponse, ChatMessage, LocalProfile, ProblemProgress } from "@/lib/types";

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

const KEYBOARD_ROWS = [
  ["1|!", "2|@", "3|#", "4|$", "5|%", "6|^", "7|&", "8|*", "9|(", "0|)", "-|_", "=|+"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[|{", "]|}", "\\||"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";|:", "'|\""],
  ["z", "x", "c", "v", "b", "n", "m", ",|<", ".|>", "/|?", "`|~"],
  ["TAB", "SPACE", "ENTER", "LEFT", "RIGHT", "BACKSPACE", "CLEAR"],
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

function updateProblem(existing: ProblemProgress, data: ChatApiResponse["assessment"], code: string): ProblemProgress {
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

export default function Home() {
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [code, setCode] = useState("");
  const [quickActions, setQuickActions] = useState<string[]>([
    "Give me a short hint",
    "Review my approach",
    "Pick the next best problem for me",
  ]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState<string>("");
  const [anonId, setAnonId] = useState<string>("");
  const [authUser, setAuthUser] = useState<{ id: string; email?: string | null } | null>(null);
  const [creditBalance, setCreditBalance] = useState<number>(0);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>("light");

  const [problemOpen, setProblemOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>("chat");

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

  const activeProblem = useMemo(() => {
    if (!profile) return null;
    return getProblemById(profile.activeProblemId) ?? null;
  }, [profile]);

  const masteredCount = useMemo(() => {
    if (!profile) return 0;
    return profile.problems.filter((p) => p.status === "mastered").length;
  }, [profile]);

  const currentProgress = useMemo(() => {
    if (!profile || !activeProblem) return null;
    return profile.problems.find((p) => p.id === activeProblem.id) ?? null;
  }, [profile, activeProblem]);
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
    } else if (token === "SPACE") {
      result = applyInsert(source, cursor, " ");
    } else if (token === "ENTER") {
      result = applyInsert(source, cursor, "\n");
    } else if (token === "TAB") {
      result = applyInsert(source, cursor, "    ");
    } else {
      result = applyInsert(source, cursor, token);
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

  function resetLocalState() {
    const fresh = createInitialProfile();
    setProfile(fresh);
    setMessages(bootstrapIntro(1));
    setDraft("");
    setCode("");
    setError("");
    setQuickActions(["Give me a short hint", "Review my approach", "Pick the next best problem for me"]);
    setProblemOpen(false);
    setComposerMode("chat");
    if (!authUser) {
      localStorage.removeItem(CHAT_KEY);
      localStorage.removeItem(PROFILE_KEY);
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

      setQuickActions(payload.quickActions);

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
          setProblemOpen(true);
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

  async function onSendText(event: FormEvent) {
    event.preventDefault();
    await sendTurn({ sendText: true, sendCode: false });
  }

  function labelForKey(token: string) {
    if (token === "TAB") return "tab";
    if (token === "SPACE") return "space";
    if (token === "ENTER") return "enter";
    if (token === "LEFT") return "←";
    if (token === "RIGHT") return "→";
    if (token === "BACKSPACE") return "⌫";
    if (token === "CLEAR") return "clear";
    return token;
  }

  function cycleTheme() {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  }

  if (!profile || !activeProblem) {
    return <main className={`min-h-screen p-6 ${isDark ? "bg-[#0a0d12] text-[#e5e7eb]" : "bg-[#f3f2ec] text-[#111]"}`}>Loading...</main>;
  }

  return (
    <main className={`mx-auto flex min-h-screen max-w-3xl flex-col ${isDark ? "bg-[#0a0d12] text-[#e5e7eb]" : "bg-[#f3f2ec] text-[#141414]"}`}>
      <header className={`sticky top-0 z-20 border-b px-4 py-3 backdrop-blur ${isDark ? "border-white/15 bg-[#0a0d12]/95" : "border-black/10 bg-[#f3f2ec]/95"}`}>
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold tracking-tight">l33tsp33k</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cycleTheme}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${isDark ? "border-white/20 bg-white/5" : "border-black/15 bg-white/70"}`}
            >
              Theme: {theme}
            </button>
            {authUser ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void startCheckout();
                  }}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${isDark ? "border-white/20 bg-white/5" : "border-black/15 bg-white/70"}`}
                >
                  {purchaseLoading ? "..." : "Buy $10"}
                </button>
                <a href="/auth/sign-out" className={`rounded-full border px-3 py-1 text-xs font-medium ${isDark ? "border-white/20 bg-white/5" : "border-black/15 bg-white/70"}`}>
                  Logout
                </a>
              </>
            ) : (
              <a href="/auth/sign-in?returnTo=/" className={`rounded-full border px-3 py-1 text-xs font-medium ${isDark ? "border-white/20 bg-white/5" : "border-black/15 bg-white/70"}`}>
                Login
              </a>
            )}
            <button
              type="button"
              onClick={resetLocalState}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${isDark ? "border-white/20 bg-white/5" : "border-black/15 bg-white/70"}`}
            >
              Reset
            </button>
          </div>
        </div>
        <p className={`mt-1 text-xs ${isDark ? "text-white/65" : "text-black/70"}`}>
          Chat-first LC150 tutor · GPT-4.1-mini · {authUser ? "logged-in + DB credits" : "free anonymous mode"}
        </p>
        <div className={`mt-2 h-2 w-full overflow-hidden rounded-full ${isDark ? "bg-white/15" : "bg-black/10"}`}>
          <div className="h-full bg-[#1a7f52] transition-all" style={{ width: `${(masteredCount / 150) * 100}%` }} />
        </div>
        <p className="mt-1 text-xs font-medium">
          Mastered {masteredCount}/150 · Active #{activeProblem.id} · {activeProblem.title}
        </p>
        {authUser ? <p className={`text-xs ${isDark ? "text-white/65" : "text-black/65"}`}>Credits: ${creditBalance.toFixed(2)}</p> : null}
        <button
          type="button"
          onClick={() => setProblemOpen((v) => !v)}
          className={`mt-2 rounded-lg border px-2 py-1 text-xs font-semibold ${isDark ? "border-white/20 bg-white/5" : "border-black/15 bg-white/70"}`}
        >
          {problemOpen ? "Hide problem" : "Show problem"}
        </button>
        {problemOpen ? (
          <div className={`mt-2 max-h-[30vh] overflow-y-auto rounded-xl border p-3 ${isDark ? "border-white/20 bg-[#121720]" : "border-black/15 bg-white/80"}`}>
            <p className={`text-xs font-semibold uppercase tracking-wide ${isDark ? "text-white/60" : "text-black/60"}`}>
              #{activeProblem.id} · {activeProblem.category} · {activeProblem.difficulty}
            </p>
            <h2 className="mt-1 text-sm font-semibold">{activeProblem.title}</h2>
            <p className={`mt-2 text-sm leading-6 ${isDark ? "text-white/85" : "text-black/80"}`}>{activeProblem.statement}</p>
            <p className={`mt-2 text-xs ${isDark ? "text-white/65" : "text-black/70"}`}>
              Status: {currentProgress?.status ?? "unseen"} · Confidence: {currentProgress?.confidence ?? 0}% · Attempts:{" "}
              {currentProgress?.attempts ?? 0}
            </p>
          </div>
        ) : null}
      </header>

      <section className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-3 pb-72">
          {messages.map((message, index) => {
            const isAssistant = message.role === "assistant";
            const baseClass = isAssistant
              ? `max-w-[92%] rounded-2xl rounded-tl-sm ${isDark ? "bg-[#151b24]" : "bg-white"}`
              : "ml-auto max-w-[92%] rounded-2xl rounded-tr-sm bg-[#1f334f] text-white";

            return (
              <article key={`${message.createdAt}-${index}`} className={`${baseClass} px-4 py-3 text-sm shadow-sm`}>
                {message.kind === "code" ? (
                  <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[13px] leading-5">{message.content}</pre>
                ) : (
                  <p className="whitespace-pre-wrap leading-6">{message.content}</p>
                )}
              </article>
            );
          })}
          <div ref={chatBottomRef} />
        </div>
      </section>

      <section className={`sticky bottom-0 z-30 border-t px-3 pt-2 backdrop-blur ${isDark ? "border-white/15 bg-[#0f141d]/98" : "border-black/10 bg-white/98"}`}>
        <div className="mb-1 flex gap-1 overflow-x-auto pb-1">
          {quickActions.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => {
                void sendTurn({ sendText: true, sendCode: false, presetText: action });
              }}
              className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-medium ${isDark ? "border-white/20 bg-white/5" : "border-black/15 bg-white"}`}
            >
              {action}
            </button>
          ))}
        </div>

        <div className={`mb-1 grid grid-cols-2 gap-px overflow-hidden rounded-lg border ${isDark ? "border-white/15 bg-white/10" : "border-black/15 bg-black/10"}`}>
          <button
            type="button"
            onClick={() => focusComposer("chat")}
            className={`px-2 py-1 text-xs font-semibold ${composerMode === "chat" ? (isDark ? "bg-[#1c2430]" : "bg-white") : isDark ? "bg-[#101720]" : "bg-[#eceae2]"}`}
          >
            Chat
          </button>
          <button
            type="button"
            onClick={() => focusComposer("code")}
            className={`px-2 py-1 text-xs font-semibold ${composerMode === "code" ? (isDark ? "bg-[#1c2430]" : "bg-white") : isDark ? "bg-[#101720]" : "bg-[#eceae2]"}`}
          >
            Code
          </button>
        </div>

        <form onSubmit={onSendText} className="mb-1 grid grid-cols-[1fr_auto_auto_auto] gap-px">
          {composerMode === "chat" ? (
            <textarea
              ref={chatInputRef}
              value={draft}
              inputMode="none"
              onKeyDown={(event) => event.preventDefault()}
              onChange={() => {}}
              onFocus={() => focusComposer("chat")}
              onClick={() => syncCursorFromDom("chat")}
              onSelect={() => syncCursorFromDom("chat")}
              rows={3}
              placeholder="Type message with keyboard below"
              className={`min-h-[64px] resize-none rounded-l-lg border px-2 py-2 text-sm outline-none ${isDark ? "border-white/20 bg-[#151b24] text-[#e5e7eb] caret-[#e5e7eb]" : "border-black/15 bg-white caret-[#111]"}`}
            />
          ) : (
            <textarea
              ref={codeInputRef}
              value={code}
              inputMode="none"
              onKeyDown={(event) => event.preventDefault()}
              onChange={() => {}}
              onFocus={() => focusComposer("code")}
              onClick={() => syncCursorFromDom("code")}
              onSelect={() => syncCursorFromDom("code")}
              rows={3}
              spellCheck={false}
              placeholder="Type Python with keyboard below"
              className={`min-h-[64px] resize-none rounded-l-lg border px-2 py-2 font-mono text-[13px] leading-5 outline-none ${isDark ? "border-white/20 bg-[#0e1117] text-[#e5e7eb] caret-[#e5e7eb]" : "border-black/15 bg-[#0e1117] text-[#e5e7eb] caret-[#e5e7eb]"}`}
            />
          )}
          <button
            type="button"
            disabled={isSending || !draft.trim()}
            onClick={() => {
              void sendTurn({ sendText: true, sendCode: false });
            }}
            className={`h-[64px] border px-2 text-[11px] font-semibold text-white disabled:opacity-50 ${isDark ? "border-white/20 bg-[#1f334f]" : "border-black/15 bg-[#111827]"}`}
          >
            Text
          </button>
          <button
            type="button"
            disabled={isSending || !code.trim()}
            onClick={() => {
              void sendTurn({ sendText: false, sendCode: true });
            }}
            className={`h-[64px] border px-2 text-[11px] font-semibold text-white disabled:opacity-50 ${isDark ? "border-white/20 bg-[#2259f3]" : "border-black/15 bg-[#1d4ed8]"}`}
          >
            Code
          </button>
          <button
            type="button"
            disabled={isSending || !draft.trim() || !code.trim()}
            onClick={() => {
              void sendTurn({ sendText: true, sendCode: true });
            }}
            className={`h-[64px] rounded-r-lg border px-2 text-[11px] font-semibold text-white disabled:opacity-50 ${isDark ? "border-white/20 bg-[#1a6a38]" : "border-black/15 bg-[#14532d]"}`}
          >
            Both
          </button>
        </form>

        <div className={`mb-1 text-[11px] font-medium ${isDark ? "text-white/60" : "text-black/60"}`}>
          Keyboard target: {composerMode === "chat" ? "chat" : "python code"} · swipe horizontally for full layout
        </div>

        <div className={`overflow-x-auto rounded-lg border p-px ${isDark ? "border-white/20 bg-[#121720]" : "border-black/15 bg-[#eceae2]"}`}>
          <div className="min-w-[780px] space-y-px">
            {KEYBOARD_ROWS.map((row, rowIndex) => (
              <div key={`row-${rowIndex}`} className="grid auto-cols-fr grid-flow-col gap-px">
                {row.map((token) => {
                  if (token.includes("|")) {
                    const [left, right] = token.split("|");
                    return (
                      <div key={`${rowIndex}-${token}`} className="grid grid-cols-2 gap-px">
                        <button
                          type="button"
                          onClick={() => pressKey(left)}
                          className={`h-9 border px-1 text-center font-mono text-[11px] ${isDark ? "border-white/15 bg-[#1a2230] text-[#e5e7eb]" : "border-black/10 bg-white"}`}
                        >
                          {left}
                        </button>
                        <button
                          type="button"
                          onClick={() => pressKey(right)}
                          className={`h-9 border px-1 text-center font-mono text-[11px] ${isDark ? "border-white/15 bg-[#1a2230] text-[#e5e7eb]" : "border-black/10 bg-white"}`}
                        >
                          {right}
                        </button>
                      </div>
                    );
                  }

                  const isSpace = token === "SPACE";
                  const isWide = token === "BACKSPACE" || token === "CLEAR";

                  return (
                    <button
                      key={`${rowIndex}-${token}`}
                      type="button"
                      onClick={() => {
                        if (token === "CLEAR") {
                          clearField(composerMode);
                        } else {
                          pressKey(token);
                        }
                      }}
                      className={`h-9 border px-1 text-center font-mono text-[11px] ${
                        isSpace ? "col-span-4" : isWide ? "col-span-2" : ""
                      } ${isDark ? "border-white/15 bg-[#1a2230] text-[#e5e7eb]" : "border-black/10 bg-white"}`}
                    >
                      {labelForKey(token)}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {error ? <p className={`py-2 text-xs ${isDark ? "text-[#ff8383]" : "text-[#b42318]"}`}>{error}</p> : null}
      </section>
    </main>
  );
}
