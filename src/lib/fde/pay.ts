import type { ListedPay, PayBasis } from "./types";

// A listing's pay as it stands: the amount, the currency and what it's per.
// Only what the text says. Nothing is converted, averaged or estimated, and
// take-home is never worked out here, because fees, Connects and hours aren't
// known.

const CURRENCIES: [RegExp, string][] = [
  [/US\$|USD|\$/i, "USD"],
  [/€|EUR/i, "EUR"],
  [/£|GBP/i, "GBP"],
  [/₹|INR|\bRs\.?/i, "INR"],
  [/CA\$|CAD/i, "CAD"],
  [/A\$|AUD/i, "AUD"],
  [/CHF/i, "CHF"],
];

const BASES: [RegExp, PayBasis][] = [
  [/\/\s*h(?:ou)?r\b|per hour|hourly|\/\s*h\b|an hour/i, "hourly"],
  [/\/\s*day\b|per day|daily/i, "daily"],
  [/\/\s*mo(?:nth)?\b|per month|monthly/i, "monthly"],
  [/\/\s*y(?:ea)?r\b|per year|per annum|annual|yearly|\bp\.a\.|\bsalary\b/i, "annual"],
  [/per task|per article|per project|per piece|per video|per word/i, "per_task"],
  [/fixed|flat fee|project budget|one[- ]off|budget/i, "fixed"],
];

const AMOUNT = /(\d{1,3}(?:[,.\s]\d{3})+|\d+(?:\.\d+)?)\s*(k)?\b/gi;

function amounts(text: string): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(AMOUNT)) {
    const digits = match[1].replace(/[,\s]/g, "").replace(/\.(?=\d{3}\b)/g, "");
    const value = Number(digits) * (match[2] ? 1000 : 1);
    if (Number.isFinite(value) && value > 0) found.push(value);
  }
  return found.slice(0, 2);
}

export function parsePay(raw: string): ListedPay {
  const text = raw.trim();
  const none: ListedPay = { raw: text, stated: false, min: null, max: null, currency: null, basis: "unstated", isBudget: false };
  if (!text || /^(?:not (?:stated|specified|listed)|n\/?a|tbd|negotiable|competitive|doe)$/i.test(text)) return none;

  const values = amounts(text);
  const currency = CURRENCIES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  // A bare number with no currency could be anything: "2 years", "Q3".
  if (values.length === 0 || !currency) return { ...none, stated: text.length > 0 && values.length > 0 && !!currency };

  const shared = values.length === 2 && /k\b/i.test(text) && values[0] < 1000 && values[1] >= 1000 ? [values[0] * 1000, values[1]] : values;
  return {
    raw: text,
    stated: true,
    min: Math.min(...shared),
    max: shared.length > 1 ? Math.max(...shared) : null,
    currency,
    basis: BASES.find(([pattern]) => pattern.test(text))?.[1] ?? "unstated",
    isBudget: /budget/i.test(text),
  };
}

const BASIS_WORDS: Record<PayBasis, string> = {
  hourly: "per hour",
  fixed: "fixed price",
  per_task: "per task",
  daily: "per day",
  monthly: "per month",
  annual: "per year",
  unstated: "basis not stated",
};

const SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹" };

/** "$50 to $70" and "per hour", for the prominent line on a card. */
export function payHeadline(pay: ListedPay): { amount: string; basis: string; label: string } {
  if (!pay.stated || pay.min === null || !pay.currency) return { amount: "Pay not stated", basis: "", label: "" };
  const symbol = SYMBOLS[pay.currency];
  const show = (value: number) => (symbol ? `${symbol}${value.toLocaleString("en-US")}` : `${value.toLocaleString("en-US")} ${pay.currency}`);
  return {
    amount: pay.max !== null ? `${show(pay.min)} to ${show(pay.max)}` : show(pay.min),
    basis: BASIS_WORDS[pay.basis],
    label: pay.isBudget ? "Client budget, not guaranteed earnings" : "Listed pay",
  };
}

const FREELANCE_KINDS = /contract|freelance|part[-\s]?time|temporary|\btemp\b|\bgig\b|consult|hourly|project/i;

/**
 * Whether a listing is freelance work rather than a salaried job. Some feeds
 * mix the two, so the source's own label has to say so, and a yearly salary
 * rules a listing out whatever its label says.
 */
export function isFreelanceWork(kind: string, pay: Pick<ListedPay, "basis">): boolean {
  return pay.basis !== "annual" && FREELANCE_KINDS.test(kind);
}
