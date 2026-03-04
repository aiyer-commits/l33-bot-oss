import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

export type LlmProvider = 'openai' | 'anthropic' | 'google';

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  providerRequestId: string | null;
};

type GenerateJsonArgs = {
  system: string;
  prompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
};

export type JsonResponse<T> = {
  parsed: T;
  rawText: string;
  usage: LlmUsage;
  provider: LlmProvider;
  model: string;
};

function parseProvider(value: string | undefined): LlmProvider {
  const normalized = String(value || 'openai').trim().toLowerCase();
  if (normalized === 'anthropic') return 'anthropic';
  if (normalized === 'google') return 'google';
  return 'openai';
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function parseJson<T>(value: string): T {
  const fenced = value.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : value;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const payload = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  return JSON.parse(payload) as T;
}

function formatJsonInstruction(schemaName: string, schema: Record<string, unknown>) {
  return [
    'Return valid JSON only. Do not include markdown or prose outside JSON.',
    `Schema name: ${schemaName}.`,
    `Schema: ${JSON.stringify(schema)}`,
  ].join('\n');
}

function openAiModel() {
  return process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini';
}

function anthropicModel() {
  return process.env.ANTHROPIC_MODEL?.trim() || 'claude-3-5-sonnet-latest';
}

function googleModel() {
  return process.env.GOOGLE_MODEL?.trim() || 'gemini-2.0-flash';
}

export function resolveProvider(): LlmProvider {
  return parseProvider(process.env.LLM_PROVIDER);
}

export function assertProviderEnv() {
  const provider = resolveProvider();
  if (provider === 'openai') requiredEnv('OPENAI_API_KEY');
  if (provider === 'anthropic') requiredEnv('ANTHROPIC_API_KEY');
  if (provider === 'google') requiredEnv('GOOGLE_API_KEY');
  return provider;
}

export async function generateJson<T>(args: GenerateJsonArgs): Promise<JsonResponse<T>> {
  const provider = resolveProvider();

  if (provider === 'openai') {
    const client = new OpenAI({ apiKey: requiredEnv('OPENAI_API_KEY') });
    const model = openAiModel();
    const response = await client.responses.create({
      model,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: args.system }] },
        { role: 'user', content: [{ type: 'input_text', text: args.prompt }] },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: args.schemaName,
          strict: true,
          schema: args.schema,
        },
      },
      max_output_tokens: args.maxOutputTokens,
    });

    const usage = response.usage;
    const rawText = response.output_text || '{}';
    return {
      parsed: parseJson<T>(rawText),
      rawText,
      provider,
      model,
      usage: {
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        cachedTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
        reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0,
        providerRequestId: response.id ?? null,
      },
    };
  }

  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: requiredEnv('ANTHROPIC_API_KEY') });
    const model = anthropicModel();
    const response = await client.messages.create({
      model,
      max_tokens: args.maxOutputTokens,
      system: `${args.system}\n\n${formatJsonInstruction(args.schemaName, args.schema)}`,
      messages: [{ role: 'user', content: args.prompt }],
    });
    const rawText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    return {
      parsed: parseJson<T>(rawText || '{}'),
      rawText,
      provider,
      model,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        providerRequestId: response.id ?? null,
      },
    };
  }

  const client = new GoogleGenAI({ apiKey: requiredEnv('GOOGLE_API_KEY') });
  const model = googleModel();
  const response = await client.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: `${args.system}\n\n${formatJsonInstruction(args.schemaName, args.schema)}\n\n${args.prompt}` }] }],
    config: {
      maxOutputTokens: args.maxOutputTokens,
      responseMimeType: 'application/json',
    },
  });
  const rawText = (response.text || '').trim();

  return {
    parsed: parseJson<T>(rawText || '{}'),
    rawText,
    provider,
    model,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      providerRequestId: null,
    },
  };
}

