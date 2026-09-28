#!/usr/bin/env node
/**
 * 국제뉴스 텔레그램 티커 — 수집 스크립트 (Manus 불필요)
 *
 * 하는 일
 *   1. config/channels.json 에 적힌 텔레그램 공개 채널에서 최신 글을 읽습니다.
 *   2. 제목 + 원문 링크만 추출하고, 이미 있는 기사는 건너뜁니다(중복 방지).
 *   3. 한국어가 아닌 제목을 한국어로 번역합니다.
 *   4. docs/news.json 을 갱신합니다. (GitHub Pages가 이 파일을 그대로 서빙)
 *
 * 번역 엔진 (키 필요 없음 → 필요 시 자동 승격)
 *   - 기본: MyMemory (무료, 키 불필요)
 *   - 선택: 아래 환경변수(또는 GitHub Secrets)가 있으면 그 엔진을 먼저 사용합니다.
 *       GEMINI_API_KEY  → Google Gemini (무료 티어 넉넉함, 품질 좋음)
 *       OPENAI_API_KEY  → OpenAI
 *       DEEPL_API_KEY   → DeepL
 *       MYMEMORY_EMAIL  → MyMemory 일일 한도 상향
 *
 * 실행: node scripts/collect.mjs
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const CONFIG_PATH = resolve(ROOT, "config/channels.json");
const OUT_PATH = resolve(ROOT, "docs/news.json");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const DEFAULT_CONFIG = {
  channels: [
    { handle: "worldnews", label: "WorldNews", region: "종합" },
    { handle: "insiderpaper", label: "Insider Paper", region: "속보" },
    { handle: "liveuamap", label: "Liveuamap", region: "분쟁" },
    { handle: "theverge_news", label: "The Verge", region: "테크" },
    { handle: "trtworld", label: "TRT World", region: "종합" },
    { handle: "bloomberg", label: "Bloomberg", region: "경제" },
    { handle: "sciencealert", label: "ScienceAlert", region: "과학" },
    { handle: "disclosetv", label: "Disclose.tv", region: "속보" },
    { handle: "wartranslated", label: "War Translated", region: "분쟁" },
  ],
  maxItems: 150,
  keepDays: 14,
  translatePerRun: 60,
  fetchConcurrency: 5,
  translateConcurrency: 4,
};

/* ------------------------------- 유틸 ------------------------------- */

function log(...args) {
  console.log("[news]", ...args);
}

async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed, channels: parsed.channels?.length ? parsed.channels : DEFAULT_CONFIG.channels };
  } catch {
    log("config/channels.json 없음 → 기본 채널 사용");
    return DEFAULT_CONFIG;
  }
}

async function loadExisting() {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------------------- 텔레그램 파싱 ---------------------------- */

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
};

function decodeEntities(input) {
  return input
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

export function detectLang(text) {
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/[\u0400-\u04ff]/.test(text)) return "ru";
  if (/[\u0600-\u06ff]/.test(text)) return "ar";
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\u0590-\u05ff]/.test(text)) return "he";
  return "en";
}

export function cleanHeadline(rawHtml) {
  let text = rawHtml.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/\u00a0/g, " ");
  text = decodeEntities(text);

  const marker = text.search(
    /\[\s*read\s+(?:the\s+)?(?:full\s+)?(?:article|story|more)\s*\]|read\s+(?:the\s+)?full\s+(?:article|story)|\bread\s+more\b|\[\+\]/i
  );
  if (marker > 0) text = text.slice(0, marker);

  text = text.replace(/\n\s*@[A-Za-z0-9_]+[\s\S]*$/, "").replace(/@[A-Za-z0-9_]{3,}\b/g, " ");
  text = text.replace(/(^|\s)#[^\s#]+/g, " ");

  const lines = text.split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  let headline = lines[0] ?? "";
  if (headline.length < 12 && lines[1]) headline = `${headline} ${lines[1]}`.trim();

  headline = headline.replace(/^[^\p{L}\p{N}"'“”‘’(]+/u, "").replace(/\s{2,}/g, " ").trim();
  return headline.slice(0, 240);
}

export function pickOutboundLink(links) {
  const candidates = links.filter(link => {
    if (!/^https?:\/\//i.test(link)) return false;
    if (/^https?:\/\/(?:t\.me|telegram\.me)\//i.test(link)) return false;
    if (/fragment\.com/i.test(link)) return false;
    return true;
  });
  const preferred = candidates.find(
    link => !/twitter\.com|x\.com|youtube\.com|instagram\.com|facebook\.com/i.test(link)
  );
  return preferred ?? candidates[0] ?? null;
}

async function fetchChannelItems(handle) {
  const res = await fetch(`https://t.me/s/${encodeURIComponent(handle)}`, {
    headers: { "user-agent": USER_AGENT, "accept-language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const blocks = html.split(/<div class="tgme_widget_message\b/).slice(1);
  const items = [];

  for (const block of blocks) {
    const textMatch = block.match(
      /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div class="tgme_widget_message_(?:footer|reply_markup|meta)|<\/div>)/i
    );
    if (!textMatch) continue;

    const title = cleanHeadline(textMatch[1]);
    if (title.length < 12 || /^(https?:\/\/\S+)$/i.test(title)) continue;

    const postMatch = block.match(/data-post="([^"]+)"/);
    const postId = postMatch ? postMatch[1].split("/").pop() ?? "" : "";
    const timeMatch = block.match(/<time datetime="([^"]+)"/);
    const publishedAt = timeMatch ? new Date(timeMatch[1]) : new Date();
    if (Number.isNaN(publishedAt.getTime())) continue;

    const links = [...block.matchAll(/<a href="([^"]+)"/g)].map(m => decodeEntities(m[1]));
    const outbound = pickOutboundLink(links);

    items.push({
      id: `${handle}:${postId || publishedAt.getTime()}`,
      titleOriginal: title,
      url: outbound ?? (postId ? `https://t.me/${handle}/${postId}` : null),
      lang: detectLang(title),
      publishedAt: publishedAt.toISOString(),
    });
  }
  return items;
}

/* ------------------------------ 번역 엔진 ------------------------------ */

const LANG_MAP = { en: "en-GB", ru: "ru-RU", ar: "ar-SA", zh: "zh-CN", ja: "ja-JP", he: "he-IL" };

function tidy(text) {
  return text
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[.。]\s*$/, "")
    .trim()
    .slice(0, 160);
}

function acceptable(ko, source) {
  if (!ko) return false;
  if (ko.length < 4 || ko.length > 200) return false;
  if (ko === source) return false;
  if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(ko)) return false;
  return true;
}

const PROMPT =
  "다음 국제뉴스 헤드라인을 자연스러운 한국어 뉴스 제목으로 번역하세요. " +
  "45자 이내, 이모지/해시태그/채널명 제거, 인명·지명은 한국 언론 표기 사용, 번역문만 출력하세요.\n\n";

async function viaGemini(text, lang) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT + text }] }] }),
      signal: AbortSignal.timeout(20_000),
    }
  );
  if (!res.ok) return null;
  const body = await res.json();
  return body?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

async function viaOpenAI(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: PROMPT + text }],
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.choices?.[0]?.message?.content ?? null;
}

async function viaDeepL(text) {
  const key = process.env.DEEPL_API_KEY;
  if (!key) return null;
  const endpoint = key.endsWith(":fx") ? "https://api-free.deepl.com/v2/translate" : "https://api.deepl.com/v2/translate";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ auth_key: key, text, target_lang: "KO" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.translations?.[0]?.text ?? null;
}

async function viaMyMemory(text, lang) {
  const source = LANG_MAP[lang] ?? lang;
  let url =
    "https://api.mymemory.translated.net/get?q=" +
    encodeURIComponent(text.slice(0, 480)) +
    `&langpair=${source}|ko-KR`;
  if (process.env.MYMEMORY_EMAIL) url += `&de=${encodeURIComponent(process.env.MYMEMORY_EMAIL)}`;

  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const body = await res.json();
  if (body?.quotaFinished) return { quotaFinished: true, text: null };
  if (Number(body?.responseStatus) !== 200) return null;
  return { quotaFinished: false, text: body?.responseData?.translatedText ?? null };
}

async function translateOne(item, state) {
  const text = item.titleOriginal;
  const engines = [];
  if (process.env.GEMINI_API_KEY) engines.push(() => viaGemini(text, item.lang));
  if (process.env.OPENAI_API_KEY) engines.push(() => viaOpenAI(text));
  if (process.env.DEEPL_API_KEY) engines.push(() => viaDeepL(text));

  for (const engine of engines) {
    try {
      const out = await engine();
      const ko = out ? tidy(out) : "";
      if (acceptable(ko, text)) return ko;
    } catch (error) {
      log("engine error:", error.message);
    }
  }

  if (state.quotaFinished) return null;
  // 무료 엔진은 분당 호출 제한이 있어 몇 번은 일시적으로 실패합니다 → 짧게 재시도
  for (let attempt = 0; attempt < 2; attempt++) {
    if (state.quotaFinished) return null;
    try {
      const result = await viaMyMemory(text, item.lang);
      if (result && result.quotaFinished) {
        state.quotaFinished = true;
        log("MyMemory 일일 한도 도달 → 이번 실행에서는 번역을 건너뜁니다");
        return null;
      }
      const ko = result?.text ? tidy(result.text) : "";
      if (acceptable(ko, text)) return ko;
    } catch {
      // 아래에서 잠시 대기 후 재시도
    }
    await sleep(2500);
  }
  return null;
}

/* -------------------------------- 메인 -------------------------------- */

async function main() {
  const config = await loadConfig();
  const existing = await loadExisting();
  const known = new Set(existing.map(item => item.id));

  log(`채널 ${config.channels.length}곳에서 수집 시작`);
  const perChannel = await mapLimit(config.channels, config.fetchConcurrency, async channel => {
    try {
      const items = await fetchChannelItems(channel.handle);
      return { channel, items };
    } catch (error) {
      log(`실패 ${channel.handle}: ${error.message}`);
      return { channel, items: [] };
    }
  });

  const collected = [];
  for (const { channel, items } of perChannel) {
    for (const item of items) {
      collected.push({
        ...item,
        source: channel.label ?? channel.handle,
        region: channel.region ?? "종합",
        title: null,
        translated: false,
      });
    }
  }

  const fresh = collected.filter(item => !known.has(item.id));
  log(`수집 ${collected.length}건 / 신규 ${fresh.length}건`);

  // 신규 + 기존 번역 안 된 항목을 번역 대상으로 (신규 우선)
  const needTranslation = [
    ...fresh.filter(item => item.lang !== "ko"),
    ...existing.filter(item => !item.translated && item.lang !== "ko"),
  ].slice(0, config.translatePerRun);

  const state = { quotaFinished: false };
  const translated = new Map();
  await mapLimit(needTranslation, config.translateConcurrency, async item => {
    const ko = await translateOne(item, state);
    if (ko) translated.set(item.id, ko);
    await sleep(120); // 예의상 약간의 간격
  });
  log(`번역 ${translated.size}건 완료 (대상 ${needTranslation.length}건)`);

  const merged = new Map(existing.map(item => [item.id, item]));
  for (const item of fresh) {
    const ko = translated.get(item.id) ?? null;
    merged.set(item.id, {
      ...item,
      title: ko ?? item.titleOriginal,
      translated: Boolean(ko),
    });
  }
  for (const [id, ko] of translated) {
    const prev = merged.get(id);
    if (prev && !prev.translated) merged.set(id, { ...prev, title: ko, translated: true });
  }

  const cutoff = Date.now() - config.keepDays * 24 * 60 * 60 * 1000;
  const items = [...merged.values()]
    .filter(item => new Date(item.publishedAt).getTime() >= cutoff)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, config.maxItems);

  const payload = {
    updatedAt: new Date().toISOString(),
    count: items.length,
    translatedCount: items.filter(item => item.translated).length,
    items,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  log(`docs/news.json 저장 완료 · 총 ${items.length}건 (번역 ${payload.translatedCount}건)`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary =
      `### 국제뉴스 티커 갱신\n\n` +
      `- 수집: ${collected.length}건 (신규 ${fresh.length}건)\n` +
      `- 번역: ${translated.size}건\n` +
      `- 저장된 전체: ${items.length}건 (번역 완료 ${payload.translatedCount}건)\n`;
    await writeFile(process.env.GITHUB_STEP_SUMMARY, summary, { flag: "a" });
  }
}

main().catch(error => {
  console.error("[news] 실패:", error);
  process.exit(1);
});
