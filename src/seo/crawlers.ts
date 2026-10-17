// Crawler policy for robots.txt (same policy as www.vyntexusa.com, lib/crawlers.ts there).
//
// Search and AI-search crawlers fetch pages to show, link and quote them in answers: allowed on the public pages.
// AI training crawlers collect pages to train models: not allowed until management approves it. To approve, set
// AI_TRAINING_CRAWLERS_ALLOWED to true. Blocking them does not affect Google Search, AI Overviews, Bing, ChatGPT search,
// Perplexity or Claude answers, which use the search crawlers.
export const AI_TRAINING_CRAWLERS_ALLOWED = false;

export const SEARCH_CRAWLERS = [
  'Googlebot', 'Bingbot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Perplexity-User',
  'Claude-SearchBot', 'Claude-User', 'Applebot', 'DuckDuckBot', 'MistralAI-User',
] as const;

export const AI_TRAINING_CRAWLERS = [
  'GPTBot', 'ClaudeBot', 'anthropic-ai', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bytespider',
  'meta-externalagent', 'cohere-training-data-crawler',
] as const;
