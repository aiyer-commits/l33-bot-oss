"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { clampConfidence, createInitialProfile, getProblemById } from "@/lib/leetcode75";
import type { ChatApiResponse, ChatMessage, LocalProfile, ProblemProgress } from "@/lib/types";

const PROFILE_KEY = "l33tsp33k.profile.v1";
const CHAT_KEY = "l33tsp33k.chat.v1";
const CODE_KEY = "l33tsp33k.code.v1";

const PYTHON_KEYS = [
  "    ",
  ":",
  "()",
  "[]",
  "{}",
  "==",
  "!=",
  "<=",
  ">=",
  "->",
  "_",
  "'",
  '"',
  ",",
  ".",
  "#",
  "\n",
];

function nowIso() {
  return new Date().toISOString();
}

function asMessage(role: "assistant" | "user", content: string): ChatMessage {
  return { role, content, createdAt: nowIso() };
}

function bootstrapIntro(problemId: number): ChatMessage[] {
  const problem = getProblemById(problemId);
  if (!problem) return [asMessage("assistant", "Session started. Problem data is missing.")];

  const intro = [
    `Welcome to l33tsp33k. We'll work LeetCode 75 in order.`,
    `Problem #${problem.id}: ${problem.title} (${problem.difficulty}, ${problem.category})`,
    problem.statement,
    "Send your approach, pseudocode, or code. I will coach, grade, and track your mastery conversationally.",
  ].join("\n\n");

  return [asMessage("assistant", intro)];
}

function updateProblem(
  existing: ProblemProgress,
  data: ChatApiResponse["assessment"],
  code: string,
): ProblemProgress {
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

export default function Home() {
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [code, setCode] = useState("");
  const [quickActions, setQuickActions] = useState<string[]>([
    "Give me a short hint",
    "Review my approach",
    "Give me edge cases",
  ]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");

  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const codeRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const profileRaw = localStorage.getItem(PROFILE_KEY);
    const chatRaw = localStorage.getItem(CHAT_KEY);
    const codeRaw = localStorage.getItem(CODE_KEY);

    if (profileRaw) {
      try {
        setProfile(JSON.parse(profileRaw));
      } catch {
        const fresh = createInitialProfile();
        setProfile(fresh);
      }
    } else {
      const fresh = createInitialProfile();
      setProfile(fresh);
    }

    if (chatRaw) {
      try {
        setMessages(JSON.parse(chatRaw));
      } catch {
        setMessages(bootstrapIntro(1));
      }
    } else {
      setMessages(bootstrapIntro(1));
    }

    if (codeRaw) setCode(codeRaw);
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

  function insertPythonToken(token: string) {
    const textarea = codeRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = code.slice(0, start);
    const after = code.slice(end);

    let inserted = token;
    let cursorShift = token.length;

    if (token === "()" || token === "[]" || token === "{}") {
      inserted = token;
      cursorShift = 1;
    }

    const next = `${before}${inserted}${after}`;
    setCode(next);

    requestAnimationFrame(() => {
      const pos = start + cursorShift;
      textarea.focus();
      textarea.setSelectionRange(pos, pos);
    });
  }

  function resetLocalState() {
    const fresh = createInitialProfile();
    setProfile(fresh);
    setMessages(bootstrapIntro(1));
    setCode("");
    setDraft("");
    setError("");
  }

  async function sendMessage(messageText?: string) {
    if (!profile || !activeProblem || isSending) return;

    const outgoing = (messageText ?? draft).trim();
    if (!outgoing && !code.trim()) return;

    const userContent = code.trim()
      ? `${outgoing || "Please review my code."}\n\n\`\`\`python\n${code.trim()}\n\`\`\``
      : outgoing;

    const nextMessages = [...messages, asMessage("user", userContent)];
    setMessages(nextMessages);
    setDraft("");
    setError("");
    setIsSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: outgoing,
          code,
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
        const summary = [
          payload.assessment.summaryNote,
          `Next: ${payload.assessment.nextStep}`,
        ]
          .filter(Boolean)
          .join("\n");

        return [
          ...prev,
          asMessage("assistant", `${payload.assistantMessage}\n\n${summary}`.trim()),
        ];
      });

      setQuickActions(payload.quickActions);

      const nextProblemId = payload.assessment.moveToProblemId;
      const moved = nextProblemId !== profile.activeProblemId;

      setProfile((prev) => {
        if (!prev) return prev;

        const updatedProblems = prev.problems.map((entry) => {
          if (entry.id !== prev.activeProblemId) return entry;
          return updateProblem(entry, payload.assessment, code);
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
              `Next up: #${movedProblem.id} ${movedProblem.title} (${movedProblem.difficulty}, ${movedProblem.category})\n\n${movedProblem.statement}`,
            ),
          ]);
          setCode("");
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      setError(message);
      setMessages((prev) => [...prev, asMessage("assistant", `Error: ${message}`)]);
    } finally {
      setIsSending(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await sendMessage();
  }

  if (!profile || !activeProblem) {
    return <main className="min-h-screen bg-[#f7f6f1] p-6 text-[#111]">Loading...</main>;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col bg-[#f7f6f1] text-[#131313]">
      <header className="sticky top-0 z-20 border-b border-black/10 bg-[#f7f6f1]/95 px-4 py-3 backdrop-blur">
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
        <p className="mt-1 text-xs text-black/70">GPT-4.1-mini tutor · Local profile only · LeetCode 75 order</p>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/10">
          <div
            className="h-full bg-[#18794e] transition-all"
            style={{ width: `${(masteredCount / 75) * 100}%` }}
          />
        </div>
        <p className="mt-1 text-xs font-medium">
          Mastered {masteredCount}/75 · Active #{activeProblem.id}
        </p>
      </header>

      <section className="border-b border-black/10 bg-white px-4 py-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-black/5 px-2 py-1">{activeProblem.category}</span>
          <span className="rounded-full bg-black/5 px-2 py-1">{activeProblem.difficulty}</span>
          <span className="rounded-full bg-black/5 px-2 py-1">Confidence {currentProgress?.confidence ?? 0}%</span>
        </div>
        <h2 className="mt-2 text-base font-semibold leading-tight">
          #{activeProblem.id} {activeProblem.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-black/80">{activeProblem.statement}</p>
        <a
          href={activeProblem.leetcodeUrl}
          className="mt-2 inline-block text-xs font-semibold text-[#155eef] underline-offset-2 hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          View original prompt
        </a>
      </section>

      <section className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-3 pb-24">
          {messages.map((message, index) => (
            <article
              key={`${message.createdAt}-${index}`}
              className={
                message.role === "assistant"
                  ? "max-w-[92%] rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-sm leading-6 shadow-sm"
                  : "ml-auto max-w-[92%] rounded-2xl rounded-tr-sm bg-[#171717] px-4 py-3 text-sm leading-6 text-white"
              }
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
            </article>
          ))}
          <div ref={chatBottomRef} />
        </div>
      </section>

      <section className="sticky bottom-0 z-30 border-t border-black/10 bg-white px-3 pb-3 pt-2">
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
          {quickActions.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => {
                void sendMessage(action);
              }}
              className="shrink-0 rounded-full border border-black/15 px-3 py-1 text-xs font-medium"
            >
              {action}
            </button>
          ))}
        </div>

        <label htmlFor="code-editor" className="mb-1 block text-xs font-semibold text-black/70">
          Python editor (no autocomplete)
        </label>
        <textarea
          id="code-editor"
          ref={codeRef}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          rows={5}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          className="w-full resize-y rounded-xl border border-black/15 bg-[#101113] p-3 font-mono text-[13px] leading-5 text-[#e5e7eb] outline-none"
          placeholder="Write Python here. Example:\ndef twoSum(nums, target):\n    ..."
        />

        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {PYTHON_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => insertPythonToken(key)}
              className="shrink-0 rounded-md border border-black/15 bg-[#f8f8f8] px-2 py-1 font-mono text-xs"
            >
              {key === "\n" ? "↵" : key === "    " ? "tab" : key}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="mt-2 flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            placeholder="Ask for a hint, explain your approach, or request grading..."
            className="min-h-[52px] flex-1 resize-none rounded-xl border border-black/15 px-3 py-2 text-sm outline-none"
          />
          <button
            type="submit"
            disabled={isSending}
            className="h-[52px] rounded-xl bg-[#0f172a] px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {isSending ? "..." : "Send"}
          </button>
        </form>

        {error ? <p className="mt-2 text-xs text-[#c20f0f]">{error}</p> : null}
      </section>
    </main>
  );
}
