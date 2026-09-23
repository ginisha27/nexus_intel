// src/lib/crawler/extractors/parseHelpers.ts

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function looksLikePrice(value: string): boolean {
  if (!value) return false;

  return /(?:[$€£₹]\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:USD|EUR|GBP|INR|BTC))/i.test(
    value
  );
}

export function parsePrice(value: string): {
  amount: number | null;
  currency: string | null;
} {
  const normalized = normalizeWhitespace(value);

  const match = normalized.match(
    /([$€£₹])?\s*(\d+(?:[.,]\d+)?)\s*(USD|EUR|GBP|INR|BTC)?/i
  );

  if (!match) {
    return {
      amount: null,
      currency: null,
    };
  }

  const amount = Number(match[2].replace(/,/g, ""));

  if (!Number.isFinite(amount)) {
    return {
      amount: null,
      currency: null,
    };
  }

  let currency: string | null = null;

  if (match[1]) {
    currency =
      match[1] === "$"
        ? "USD"
        : match[1] === "€"
          ? "EUR"
          : match[1] === "£"
            ? "GBP"
            : match[1] === "₹"
              ? "INR"
              : null;
  } else if (match[3]) {
    currency = match[3].toUpperCase();
  }

  return {
    amount,
    currency,
  };
}

export function parseFieldSelector(spec: string): {
  selector: string;
  attr: string | null;
} {
  const trimmed = spec.trim();

  const match = trimmed.match(/^(.+?)\s+@([A-Za-z_:][-A-Za-z0-9_:.]*)$/);

  if (match) {
    return {
      selector: match[1].trim(),
      attr: match[2],
    };
  }

  return {
    selector: trimmed,
    attr: null,
  };
}