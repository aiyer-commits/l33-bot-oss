"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { clampConfidence, createInitialProfile, getProblemById } from "@/lib/leetcode75";
import type { ChatApiResponse, ChatMessage, LocalProfile, ProblemProgress } from "@/lib/types";

const PROFILE_KEY = "l33tsp33k.profile.v2";
const CHAT_KEY = "l33tsp33k.chat.v2";
const CODE_KEY = "l33tsp33k.code.v2";
const TEXT_KEY = "l33tsp33k.text.v2";

type TargetField = "chat" | "code";
type KeyboardMode = "alpha" | "symbols";
type PanelTab = "problem" | "code";

type Cursor = { start: number; end: number };

const ALPHA_ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

const SYMBOL_ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["(", ")", "[", "]", "{", "}", "=", ":", ",", "."],
  ["+", "-", "*", "/", "%", "!", "<", ">", "_", "#"],
  ["'", '"', "\\", "|", "&", "?", "@", "~", "^", ";"],
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
        "Chat above. Problem + code live in the footer panel. I will track your progress conversationally.",
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

  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<PanelTab>("problem");
  const [keyboardMode, setKeyboardMode] = useState<KeyboardMode>("alpha");
  const [targetField, setTargetField] = useState<TargetField>("chat");

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

  function focusTarget(target: TargetField) {
    setTargetField(target);
    requestAnimationFrame(() => {
      if (target === "chat") chatInputRef.current?.focus();
      if (target === "code") codeInputRef.current?.focus();
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
    const target = targetField;
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
    setPanelTab("problem");
    setPanelOpen(true);
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
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Tutor call failed");
      }

      const payload = (await response.json()) as ChatApiResponse;

      setMessages((prev) => {
        const tail = [payload.assessment.summaryNote, `Next: ${payload.assessment.nextStep}`]
          .filter(Boolean)
          .join("\n");
        return [...prev, asMessage("assistant", `${payload.assistantMessage}\n\n${tail}`.trim(), "text")];
      });

      setQuickActions(payload.quickActions);

      const nextProblemId = payload.assessment.moveToProblemId;
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
          setPanelTab("problem");
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

  if (!profile || !activeProblem) {
    return <main className="min-h-screen bg-[#f3f2ec] p-6 text-[#111]">Loading...</main>;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col bg-[#f3f2ec] text-[#141414]">
      <header className="sticky top-0 z-20 border-b border-black/10 bg-[#f3f2ec]/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold tracking-tight">l33tsp33k</h1>
          <button
            type="button"
            onClick={resetLocalState}
            className="rounded-full border border-black/15 px-3 py-1 text-xs font-medium"
          >
            Reset
          </button>
        </div>
        <p className="mt-1 text-xs text-black/70">Chat-first LC75 tutor · GPT-4.1-mini · local profile only</p>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/10">
          <div className="h-full bg-[#1a7f52] transition-all" style={{ width: `${(masteredCount / 75) * 100}%` }} />
        </div>
        <p className="mt-1 text-xs font-medium">
          Mastered {masteredCount}/75 · Active #{activeProblem.id} · {activeProblem.title}
        </p>
      </header>

      <section className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-3 pb-36">
          {messages.map((message, index) => {
            const isAssistant = message.role === "assistant";
            const baseClass = isAssistant
              ? "max-w-[92%] rounded-2xl rounded-tl-sm bg-white"
              : "ml-auto max-w-[92%] rounded-2xl rounded-tr-sm bg-[#111827] text-white";

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

      <section className="sticky bottom-0 z-30 border-t border-black/10 bg-white/98 px-3 pt-2 backdrop-blur">
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
          {quickActions.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => {
                void sendTurn({ sendText: true, sendCode: false, presetText: action });
              }}
              className="shrink-0 rounded-full border border-black/15 px-3 py-1 text-xs font-medium"
            >
              {action}
            </button>
          ))}
        </div>

        <form onSubmit={onSendText} className="mb-2 flex items-end gap-2">
          <textarea
            ref={chatInputRef}
            value={draft}
            readOnly
            inputMode="none"
            onFocus={() => setTargetField("chat")}
            onClick={() => {
              setTargetField("chat");
              syncCursorFromDom("chat");
            }}
            onSelect={() => syncCursorFromDom("chat")}
            rows={2}
            placeholder="Compose chat text with the custom keyboard"
            className="min-h-[56px] flex-1 resize-none rounded-xl border border-black/15 px-3 py-2 text-sm outline-none"
          />
          <button
            type="submit"
            disabled={isSending}
            className="h-[56px] rounded-xl bg-[#0f172a] px-3 text-xs font-semibold text-white disabled:opacity-50"
          >
            Send text
          </button>
          <button
            type="button"
            disabled={isSending || !code.trim()}
            onClick={() => {
              void sendTurn({ sendText: false, sendCode: true });
            }}
            className="h-[56px] rounded-xl bg-[#1d4ed8] px-3 text-xs font-semibold text-white disabled:opacity-50"
          >
            Send code
          </button>
          <button
            type="button"
            disabled={isSending || !code.trim() || !draft.trim()}
            onClick={() => {
              void sendTurn({ sendText: true, sendCode: true });
            }}
            className="h-[56px] rounded-xl bg-[#14532d] px-3 text-xs font-semibold text-white disabled:opacity-50"
          >
            Both
          </button>
        </form>

        <div className="mb-2 flex items-center justify-between rounded-xl border border-black/10 bg-[#f8f8f8] px-2 py-1">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPanelTab("problem")}
              className={`rounded-lg px-3 py-1 text-xs font-semibold ${panelTab === "problem" ? "bg-white" : "text-black/65"}`}
            >
              Problem
            </button>
            <button
              type="button"
              onClick={() => setPanelTab("code")}
              className={`rounded-lg px-3 py-1 text-xs font-semibold ${panelTab === "code" ? "bg-white" : "text-black/65"}`}
            >
              Code
            </button>
          </div>
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            className="rounded-lg border border-black/10 px-3 py-1 text-xs font-semibold"
          >
            {panelOpen ? "Collapse" : "Expand"}
          </button>
        </div>

        {panelOpen ? (
          <div className="mb-2 max-h-[36vh] overflow-y-auto rounded-xl border border-black/10 bg-[#fafafa] p-3">
            {panelTab === "problem" ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-black/60">
                  #{activeProblem.id} · {activeProblem.category} · {activeProblem.difficulty}
                </p>
                <h2 className="mt-1 text-sm font-semibold">{activeProblem.title}</h2>
                <p className="mt-2 text-sm leading-6 text-black/80">{activeProblem.statement}</p>
                <p className="mt-2 text-xs text-black/70">
                  Status: {currentProgress?.status ?? "unseen"} · Confidence: {currentProgress?.confidence ?? 0}% · Attempts:{" "}
                  {currentProgress?.attempts ?? 0}
                </p>
              </div>
            ) : (
              <div>
                <p className="mb-2 text-xs font-semibold text-black/60">Python editor (OS keyboard disabled)</p>
                <textarea
                  ref={codeInputRef}
                  value={code}
                  readOnly
                  inputMode="none"
                  onFocus={() => setTargetField("code")}
                  onClick={() => {
                    setTargetField("code");
                    syncCursorFromDom("code");
                  }}
                  onSelect={() => syncCursorFromDom("code")}
                  rows={10}
                  spellCheck={false}
                  className="w-full resize-none rounded-xl border border-black/15 bg-[#0e1117] p-3 font-mono text-[13px] leading-5 text-[#e5e7eb]"
                  placeholder="Use keyboard below to write Python"
                />
              </div>
            )}
          </div>
        ) : null}

        <div className="rounded-xl border border-black/10 bg-[#f8f8f8] p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => {
                  setKeyboardMode("alpha");
                }}
                className={`rounded-md px-2 py-1 text-xs font-semibold ${keyboardMode === "alpha" ? "bg-white" : "text-black/60"}`}
              >
                abc
              </button>
              <button
                type="button"
                onClick={() => {
                  setKeyboardMode("symbols");
                }}
                className={`rounded-md px-2 py-1 text-xs font-semibold ${keyboardMode === "symbols" ? "bg-white" : "text-black/60"}`}
              >
                sym
              </button>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => focusTarget("chat")}
                className={`rounded-md px-2 py-1 text-xs font-semibold ${targetField === "chat" ? "bg-white" : "text-black/60"}`}
              >
                Target: Chat
              </button>
              <button
                type="button"
                onClick={() => focusTarget("code")}
                className={`rounded-md px-2 py-1 text-xs font-semibold ${targetField === "code" ? "bg-white" : "text-black/60"}`}
              >
                Code
              </button>
            </div>
          </div>

          <div className="space-y-1 overflow-x-auto pb-1">
            {(keyboardMode === "alpha" ? ALPHA_ROWS : SYMBOL_ROWS).map((row, rowIndex) => (
              <div key={`row-${rowIndex}`} className="flex gap-1">
                {row.map((key) => (
                  <button
                    key={`${rowIndex}-${key}`}
                    type="button"
                    onClick={() => pressKey(key)}
                    className="flex-1 rounded-md border border-black/15 bg-white px-2 py-2 text-center font-mono text-xs"
                  >
                    {key}
                  </button>
                ))}
              </div>
            ))}

            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => pressKey("TAB")}
                className="rounded-md border border-black/15 bg-white px-2 py-2 text-xs"
              >
                tab
              </button>
              <button
                type="button"
                onClick={() => pressKey("SPACE")}
                className="flex-1 rounded-md border border-black/15 bg-white px-2 py-2 text-xs"
              >
                space
              </button>
              <button
                type="button"
                onClick={() => pressKey("ENTER")}
                className="rounded-md border border-black/15 bg-white px-2 py-2 text-xs"
              >
                enter
              </button>
            </div>

            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => pressKey("LEFT")}
                className="rounded-md border border-black/15 bg-white px-2 py-2 text-xs"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => pressKey("RIGHT")}
                className="rounded-md border border-black/15 bg-white px-2 py-2 text-xs"
              >
                →
              </button>
              <button
                type="button"
                onClick={() => pressKey("BACKSPACE")}
                className="rounded-md border border-black/15 bg-white px-2 py-2 text-xs"
              >
                backspace
              </button>
              <button
                type="button"
                onClick={() => clearField(targetField)}
                className="rounded-md border border-black/15 bg-white px-2 py-2 text-xs"
              >
                clear
              </button>
            </div>
          </div>
        </div>

        {error ? <p className="py-2 text-xs text-[#b42318]">{error}</p> : null}
      </section>
    </main>
  );
}
