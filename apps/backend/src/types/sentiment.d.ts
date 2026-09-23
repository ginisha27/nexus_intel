// src/types/sentiment.d.ts
//
// The `sentiment` npm package ships no types and has no @types/sentiment
// package to install. Minimal shape for the subset lib/ocrSentiment.ts
// actually uses.
declare module "sentiment" {
  export interface AnalysisResult {
    score: number;
    comparative: number;
    tokens: string[];
    words: string[];
    positive: string[];
    negative: string[];
  }

  export default class Sentiment {
    constructor(options?: Record<string, unknown>);
    analyze(phrase: string, options?: Record<string, unknown>): AnalysisResult;
  }
}
