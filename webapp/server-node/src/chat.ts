/**
 * chat.ts — DOMAIN MODULE: chat & translation (F3, P1)
 * ===========================================================================
 * OWNER REQUIREMENT
 * -----------------
 * Worker↔expert (and any-to-any) chat where each party writes in his OWN
 * language and the other reads his own — "100% understood between parties" —
 * with photos, videos, voice notes, emoji reactions and pinned messages.
 * The expert's inbox must show farm → area → worker context per thread.
 *
 * TRANSLATION MODEL
 * -----------------
 * - The message stores the ORIGINAL text immutably (`originalText` + detected
 *   `originalLang`).
 * - Translations are CACHED on the message row keyed by target language, so:
 *     • provider costs stay bounded (translate once per language),
 *     • the receiver gets instant repeat reads,
 *     • user corrections can later overwrite a cached translation.
 * - Provider is PLUGGABLE (`TranslationProvider`): Google and DeepL adapters
 *   implement it; WHICH ONE RUNS follows the farm's subscription tier
 *   (ADR-012). Without an API key configured, `MockTranslator` passes text
 *   through tagged as machine output so development never blocks.
 *
 * IDEMPOTENCY / OFFLINE (ADR-011)
 * -------------------------------
 * Clients generate `idempotencyKey` UUIDs; a retried send returns the ORIGINAL
 * message instead of creating a duplicate — the exactly-once outbox contract.
 */

import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { Conversation, Message } from './types.js';
import { chatStore } from './store.js';
import { makeLogger } from './logger.js';
import { emit } from './events.js';

const log = makeLogger('chat');

// ---------------------------------------------------------------------------
// Translation providers (ADR-012: tier decides which adapter is active)
// ---------------------------------------------------------------------------

export interface TranslationProvider {
  readonly name: 'mock' | 'google' | 'deepl';
  translate(text: string, targetLang: string): Promise<string>;
}

/** Pass-through used when no API key is configured (dev/demo environments). */
export const MockTranslator: TranslationProvider = {
  name: 'mock',
  async translate(text) {
    return `[${'mock'}] ${text}`;
  },
};

/**
 * HTTP adapter skeleton shared by real vendors. Configure via env:
 *   TRANSLATION_PROVIDER=google|deepl   GOOGLE_API_KEY / DEEPL_API_KEY
 * Kept minimal on purpose — vendor swap touches ONLY this object.
 */
function httpTranslator(name: 'google' | 'deepl', key?: string): TranslationProvider {
  return {
    name,
    async translate(text, targetLang) {
      if (!key) return MockTranslator.translate(text, targetLang);
      // Vendor call intentionally thin; production adds retry/timeout policy.
      const url =
        name === 'deepl'
          ? `https://api-free.deepl.com/v2/translate?auth_key=${key}&text=${encodeURIComponent(text)}&target_lang=${targetLang.toUpperCase()}`
          : `https://translation.googleapis.com/language/translate/v2?key=${key}&q=${encodeURIComponent(text)}&target=${targetLang}`;
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) throw new Error(`translation provider ${name} failed: ${res.status}`);
      const data = (await res.json()) as any;
      return name === 'deepl'
        ? data.translations[0].text
        : data.data.translations[0].translatedText;
    },
  };
}

/** Active provider resolution: env-configured vendor else mock. */
export function activeTranslator(): TranslationProvider {
  const vendor = process.env.TRANSLATION_PROVIDER as 'google' | 'deepl' | undefined;
  if (vendor === 'google') return httpTranslator('google', process.env.GOOGLE_API_KEY);
  if (vendor === 'deepl') return httpTranslator('deepl', process.env.DEEPL_API_KEY);
  return MockTranslator;
}

/**
 * v1 language auto-detect: Unicode-script ranges cover Arabic vs Latin, which
 * is the dominant real case (Egyptian farms ↔ global experts). CJK added for
 * completeness. Production may upgrade to a detection library behind this
 * same function signature.
 */
export function detectLang(text: string): string {
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
  if (/[\u3040-\u30FF]/.test(text)) return 'ja';
  if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';
  if (/[\u0590-\u05FF]/.test(text)) return 'he';
  return 'en';
}

// ---------------------------------------------------------------------------
// Conversations & messages
// ---------------------------------------------------------------------------

export function createConversation(input: {
  kind: Conversation['kind'];
  memberIds: string[];
  createdBy: string;
  title?: string;
  farmId?: string;
  consultationId?: string;
}): Conversation {
  if (input.memberIds.length < 2) {
    throw new ChatError('bad_request', 'a conversation needs at least two members');
  }
  const conv: Conversation = { ...input, id: `cv-${randomUUID()}`, createdAt: Date.now() };
  chatStore.conversations.set(conv.id, conv);
  log.info('conversation created', { id: conv.id, kind: conv.kind, members: conv.memberIds.length });
  return conv;
}

/** Membership check — outsiders never read or write a thread. */
export function assertMember(conversationId: string, userId: string): Conversation {
  const conv = chatStore.conversations.get(conversationId);
  if (!conv) throw new ChatError('not_found', 'conversation not found');
  if (!conv.memberIds.includes(userId)) throw new ChatError('forbidden', 'not a member');
  return conv;
}

/**
 * Send a message. Exactly-once via idempotencyKey; media messages carry the
 * ALREADY-UPLOADED URL (upload goes through POST /v2/messages/media first).
 */
export async function sendMessage(input: {
  conversationId: string;
  senderId: string;
  senderName: string;
  type: Message['type'];
  originalText?: string;
  mediaUrl?: string;
  durationS?: number;
  replyToId?: string;
  idempotencyKey?: string;
}): Promise<Message> {
  assertMember(input.conversationId, input.senderId);

  // Exactly-once: same key → same message back (offline outbox retries).
  if (input.idempotencyKey) {
    const dup = [...chatStore.messages.values()].find(
      (m) => m.idempotencyKey === input.idempotencyKey && m.conversationId === input.conversationId
    );
    if (dup) {
      log.debug('duplicate send collapsed', { key: input.idempotencyKey });
      return dup;
    }
  }

  const msg: Message = {
    id: `msg-${randomUUID()}`,
    conversationId: input.conversationId,
    senderId: input.senderId,
    senderName: input.senderName,
    type: input.type,
    originalText: input.originalText,
    originalLang: input.originalText ? detectLang(input.originalText) : undefined,
    translations: {},
    mediaUrl: input.mediaUrl,
    durationS: input.durationS,
    pinned: false,
    replyToId: input.replyToId,
    idempotencyKey: input.idempotencyKey,
    createdAt: Date.now(),
  };
  chatStore.messages.set(msg.id, msg);
  emit({ type: 'message.created', conversationId: msg.conversationId, messageId: msg.id });
  log.info('message sent', { conversationId: msg.conversationId, type: msg.type, lang: msg.originalLang });
  return msg;
}

/**
 * Chronological thread, oldest first (Facebook-post style reading order).
 *
 * SEC-C02: `userId` is REQUIRED. The previous signature took only the
 * conversation id, so no call site could perform a membership check and the
 * omission was invisible. Removing the argument is now a compile error.
 */
export function listMessages(conversationId: string, userId: string): Message[] {
  assertMember(conversationId, userId);
  return [...chatStore.messages.values()]
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Pin/unpin. Pinned list renders at thread top in chronological order. */
export function setPin(messageId: string, userId: string, pinned: boolean): Message {
  const msg = requireMessage(messageId);
  assertMember(msg.conversationId, userId);
  msg.pinned = pinned;
  log.info(pinned ? 'message pinned' : 'message unpinned', { messageId, by: userId });
  return msg;
}

/** One reaction per user per message (emoji value is replaceable). */
export function react(messageId: string, userId: string, emoji: string): void {
  const msg = requireMessage(messageId);
  assertMember(msg.conversationId, userId);
  const key = `${messageId}:${userId}`;
  const existing = [...chatStore.reactions.values()].find((r) => r.messageId === messageId && r.userId === userId);
  // Reactions are keyed `${messageId}:${userId}:${ts}` in the dev store.
  if (existing) {
    existing.emoji = emoji; // same user re-reacting replaces the emoji
  } else {
    chatStore.reactions.set(`${key}:${Date.now()}`, { messageId, userId, emoji, createdAt: Date.now() });
  }
}

/** List reactions for rendering under each bubble. */
export function listReactions(messageIds: string[]): Record<string, Array<{ userId: string; emoji: string }>> {
  const out: Record<string, Array<{ userId: string; emoji: string }>> = {};
  for (const r of chatStore.reactions.values()) {
    if (!messageIds.includes(r.messageId)) continue;
    (out[r.messageId] ??= []).push({ userId: r.userId, emoji: r.emoji });
  }
  return out;
}

/**
 * Return the message translated INTO `targetLang`, translating + caching on
 * first request (F3 "100% understood" guarantee).
 *
 * SEC-C03: membership on the PARENT conversation is asserted before anything
 * else. This is a second, independent path to a message body, and every cache
 * miss reaches a metered external provider — so an unauthorized caller must be
 * stopped before the provider is invoked, not merely denied the response.
 */
export async function messageInLang(
  messageId: string,
  targetLang: string,
  userId: string,
): Promise<{ text?: string; lang: string }> {
  const msg = requireMessage(messageId);
  assertMember(msg.conversationId, userId);
  if (!msg.originalText) return { lang: msg.originalLang ?? 'en' };
  if (msg.originalLang === targetLang) return { text: msg.originalText, lang: targetLang };
  const cached = msg.translations?.[targetLang];
  if (cached) return { text: cached, lang: targetLang };

  const provider = activeTranslator();
  const translated = await provider.translate(msg.originalText, targetLang);
  msg.translations = { ...msg.translations, [targetLang]: translated };
  log.info('translation cached', { messageId, provider: provider.name, targetLang });
  return { text: translated, lang: targetLang };
}

function requireMessage(id: string): Message {
  const m = chatStore.messages.get(id);
  if (!m) throw new ChatError('not_found', 'message not found');
  return m;
}

/** Typed errors mapped to HTTP codes by routes/chat.ts. */
export class ChatError extends Error {
  constructor(public code: 'bad_request' | 'not_found' | 'forbidden', message: string) {
    super(message);
  }
}
void createHash;
