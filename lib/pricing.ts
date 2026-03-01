export const FEMTODOLLARS_PER_DOLLAR = BigInt('1000000000000000');
export const INITIAL_FREE_CREDITS = BigInt('0');

export const MODEL_PRICING = {
  'gpt-4.1-mini': {
    input: BigInt('400000000'),
    output: BigInt('1600000000'),
    cachedInput: BigInt('100000000'),
  },
} as const;

export const INFRASTRUCTURE_COST_FEMTODOLLARS = BigInt('470000000000');

export const DEFAULT_MARGIN = {
  numerator: 5,
  denominator: 1,
};

export function calculateResponseCostFemtodollars(params: {
  model: keyof typeof MODEL_PRICING;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}) {
  const pricing = MODEL_PRICING[params.model];
  const cached = Math.max(0, params.cachedTokens ?? 0);
  const input = Math.max(0, params.inputTokens);
  const output = Math.max(0, params.outputTokens + (params.reasoningTokens ?? 0));
  const uncached = Math.max(0, input - cached);

  return (
    pricing.cachedInput * BigInt(cached) +
    pricing.input * BigInt(uncached) +
    pricing.output * BigInt(output) +
    INFRASTRUCTURE_COST_FEMTODOLLARS
  );
}

export function applyMargin(rawCost: bigint, margin = DEFAULT_MARGIN): bigint {
  return (rawCost * BigInt(margin.numerator)) / BigInt(margin.denominator);
}

export function dollarsToFemtodollars(dollars: number): bigint {
  return BigInt(Math.round(dollars * Number(FEMTODOLLARS_PER_DOLLAR)));
}

export function femtodollarsToDollars(value: bigint): number {
  return Number(value) / Number(FEMTODOLLARS_PER_DOLLAR);
}

export function estimateMessagesForCredit(creditDollars: number, avgChargeDollarsPerMessage: number) {
  if (avgChargeDollarsPerMessage <= 0) return 0;
  return Math.floor(creditDollars / avgChargeDollarsPerMessage);
}
