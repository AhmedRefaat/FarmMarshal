/**
 * ExpertNetwork.tsx — the agriculture expert network (marketplace F6).
 * ---------------------------------------------------------------------------
 * The full loop the platform is built around:
 *
 *   1. A farm expert (owner/moderator) posts a CASE to the public pool with a
 *      bounty in escrow.
 *   2. Network experts browse the pool and attach a RECOMMENDATION. Attaching
 *      one opens a group thread so the two sides can talk immediately.
 *   3. The requester compares recommendations side by side — each carries the
 *      responder's reputation card — and CHOOSES one, which releases the
 *      bounty (platform commission vs. net payout is shown explicitly).
 *   4. Choosing opens a private 1:1 chat with that expert and unlocks rating.
 *
 * Money fields are only ever sent by the server to the requester and to the
 * owning responder, so this page renders whatever it is given without needing
 * its own disclosure rules.
 */

import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useErrorMessage, useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import type {
  ChatMessage,
  Consultation,
  ConsultationDetail,
  ExpertProfile,
} from '../types';

/**
 * Reputation summary shown next to every recommendation.
 * Rendered as a list of independent labelled facts rather than one glued
 * sentence — Arabic cannot safely concatenate sentence fragments.
 */
function ExpertBadge({ card }: { card: NonNullable<ConsultationDetail['responses'][number]['expert']> }) {
  const { t, tc, fmt } = useI18n();
  const facts = [
    t('expert.stars', { stars: fmt.number(card.avgStars) }),
    t('expert.answers', { count: card.answersCount }),
    card.institution && t('expert.institution', { name: tc(card.institution) }),
    card.country && t('expert.country', { name: tc(card.country) }),
    card.yearsExp ? t('expert.years', { count: card.yearsExp }) : '',
    card.specializations?.length
      ? t('expert.specializations', {
          list: card.specializations.map((s) => tc(s)).join('، '),
        })
      : '',
  ].filter(Boolean);
  return <p className="muted">⭐ {facts.join(' · ')}</p>;
}

/** Live-ish chat window over one conversation id (polls while mounted). */
function ChatPanel({ conversationId, title }: { conversationId: string; title: string }) {
  const { user } = useAuth();
  const { t, tc, fmt } = useI18n();
  const describeError = useErrorMessage();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval>;
    const load = () =>
      api
        .chatMessages(conversationId)
        .then((m) => alive && setMessages(m))
        .catch((e) => {
          if (!alive) return;
          setError(describeError(e));
          // Stop polling on failure (expired session, lost membership, …) so a
          // broken thread cannot hammer the API every few seconds forever.
          clearInterval(timer);
        });
    load();
    timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [conversationId, describeError]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    try {
      const msg = await api.sendChat(conversationId, text);
      setMessages((cur) => (cur.some((m) => m.id === msg.id) ? cur : [...cur, msg]));
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div className="chat">
      <h3>{title}</h3>
      {error && <p className="error">{error}</p>}
      <div className="chat-log">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`bubble ${m.senderId === user?.id ? 'mine' : ''}`}
          >
            <b><bdi>{tc(m.senderName)}</bdi></b>
            {/* User-authored text can be in either script — isolate it so one
                Latin message cannot flip the layout of an Arabic thread. */}
            <div><bdi>{tc(m.originalText)}</bdi></div>
            <span className="muted">{fmt.time(m.createdAt)}</span>
          </div>
        ))}
        {messages.length === 0 && (
          <p className="muted">{t('expert.noMessages')}</p>
        )}
      </div>
      <form className="row" onSubmit={send}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('expert.messagePlaceholder')}
        />
        <button type="submit">{t('common.send')}</button>
      </form>
    </div>
  );
}

export default function ExpertNetwork() {
  const { t, tc, fmt, locale } = useI18n();
  const describeError = useErrorMessage();
  const [pool, setPool] = useState<Consultation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConsultationDetail | null>(null);
  const [experts, setExperts] = useState<ExpertProfile[]>([]);
  const [me, setMe] = useState<ExpertProfile | null>(null);
  const [answer, setAnswer] = useState('');
  const [question, setQuestion] = useState('');
  const [bounty, setBounty] = useState('500');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function refreshPool() {
    setPool(await api.consultations());
  }

  async function openCase(id: string) {
    setSelected(id);
    setDetail(null);
    setAnswer('');
    try {
      setDetail(await api.consultation(id));
    } catch (e) {
      setError(describeError(e));
    }
  }

  useEffect(() => {
    Promise.all([api.consultations(), api.experts(), api.myExpert()])
      .then(([p, x, mine]) => {
        setPool(p);
        setExperts(x);
        setMe(mine);
      })
      .catch((e) => setError(describeError(e)));
  }, [describeError]);

  /** Guarded action runner: one in-flight mutation at a time. */
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      if (selected) setDetail(await api.consultation(selected));
      await refreshPool();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const chosen = detail?.responses.find(
    (r) => r.id === detail.consultation.chosenResponseId
  );

  return (
    <>
      <div className="pagehead">
        <p className="eyebrow">{t('expert.eyebrow')}</p>
        <h1>{t('expert.title')}</h1>
        <p>
          {t('expert.subtitle', { count: experts.length })}
          {me ? ` ${t('expert.subtitleRegistered')}` : ''}
        </p>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="split">
        {/* ------------------------------------------------ pool of cases */}
        <section>
          <h2>{t('expert.casePool')}</h2>
          <ul className="feed">
            {pool.map((c) => (
              <li key={c.id}>
                <button
                  className={`link-btn ${selected === c.id ? 'active' : ''}`}
                  onClick={() => openCase(c.id)}
                >
                  <bdi>
                    {tc(c.question).slice(0, 70)}
                    {tc(c.question).length > 70 ? '…' : ''}
                  </bdi>
                </button>
                <div className="muted">
                  <span className="badge">
                    {t(`consult.status.${c.status}` as MessageKey)}
                  </span>{' '}
                  ·{' '}
                  {t('expert.caseMeta', {
                    bounty: fmt.currency(c.bountyEgp ?? 0),
                    requester: tc(c.requesterName) ?? t('common.none'),
                  })}{' '}
                  · {t('expert.recommendationCount', { count: c.responseCount ?? 0 })}
                  {c.mine && ` · ${t('expert.yours')}`}
                  {c.answered && ` · ${t('expert.youAnswered')}`}
                </div>
              </li>
            ))}
            {pool.length === 0 && (
              <li className="muted">{t('expert.poolEmpty')}</li>
            )}
          </ul>

          <h3>{t('expert.ask')}</h3>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (!question.trim()) return;
              run(async () => {
                const created = await api.postConsultation({
                  question: question.trim(),
                  bountyEgp: Number(bounty) || 0,
                  // Tag the case with the UI language the author was actually
                  // writing in, instead of assuming Arabic.
                  language: locale,
                  scope: 'public',
                });
                setQuestion('');
                await openCase(created.id);
              });
            }}
          >
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t('expert.questionPlaceholder')}
              rows={3}
            />
            <div className="row">
              <input
                type="number"
                min={0}
                value={bounty}
                onChange={(e) => setBounty(e.target.value)}
                placeholder={t('expert.bountyPlaceholder')}
              />
              <button type="submit" disabled={busy}>
                {t('expert.postCase')}
              </button>
            </div>
          </form>
        </section>

        {/* -------------------------------------------------- case detail */}
        <section>
          {!detail && <p className="muted">{t('expert.selectCase')}</p>}
          {detail && (
            <>
              <h2>{t('expert.case')}</h2>
              <p className="desc"><bdi>{tc(detail.consultation.question)}</bdi></p>
              <p className="muted">
                <span className="badge">
                  {t(`consult.status.${detail.consultation.status}` as MessageKey)}
                </span>{' '}
                ·{' '}
                {t('expert.caseTerms', {
                  bounty: fmt.currency(detail.consultation.bountyEgp ?? 0),
                  pct: fmt.number(detail.consultation.platformCommissionPct),
                  requester: tc(detail.consultation.requesterName) ?? t('common.none'),
                })}
              </p>

              <h3>
                {t('expert.recommendations', {
                  count: detail.responses.length,
                })}
              </h3>
              {detail.responses.map((r) => {
                const isChosen = r.id === detail.consultation.chosenResponseId;
                return (
                  <div
                    key={r.id}
                    className={`issue-card ${isChosen ? 'chosen' : ''}`}
                  >
                    <b><bdi>{tc(r.responderName)}</bdi></b>
                    {isChosen && (
                      <span className="chip green">{t('expert.chosen')}</span>
                    )}
                    {r.expert && <ExpertBadge card={r.expert} />}
                    <p className="desc"><bdi>{tc(r.answer)}</bdi></p>
                    {/* Money is present only when the server disclosed it. */}
                    {r.netPayoutEgp !== undefined && (
                      <p className="muted">
                        {t('expert.payout', {
                          net: fmt.currency(r.netPayoutEgp),
                          commission: fmt.currency(r.commissionAmount ?? 0),
                          status: t(
                            `payout.status.${r.payoutStatus}` as MessageKey
                          ),
                        })}
                      </p>
                    )}
                    {detail.isRequester &&
                      !detail.consultation.chosenResponseId && (
                        <button
                          className="green"
                          disabled={busy}
                          onClick={() =>
                            run(() =>
                              api.chooseResponse(detail.consultation.id, r.id)
                            )
                          }
                        >
                          {t('expert.chooseRelease')}
                        </button>
                      )}
                    {isChosen && detail.isRequester && (
                      <div className="stars">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <button
                            key={s}
                            className={`star ${
                              (r.ratingStars ?? 0) >= s ? 'on' : ''
                            }`}
                            disabled={busy}
                            onClick={() =>
                              run(() =>
                                api.rateConsultation(detail.consultation.id, s)
                              )
                            }
                          >
                            ★
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {detail.responses.length === 0 && (
                <p className="muted">{t('expert.noRecommendations')}</p>
              )}

              {/* Network experts attach their recommendation here. */}
              {detail.canRespond && (
                <form
                  className="stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!answer.trim()) return;
                    run(async () => {
                      await api.respondConsultation(
                        detail.consultation.id,
                        answer.trim()
                      );
                      setAnswer('');
                    });
                  }}
                >
                  <h3>{t('expert.addRecommendation')}</h3>
                  <textarea
                    rows={3}
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder={t('expert.answerPlaceholder')}
                  />
                  <button type="submit" disabled={busy}>
                    {t('expert.submitRecommendation')}
                  </button>
                </form>
              )}

              {/* Threads: the group discussion, plus the 1:1 after selection. */}
              {detail.consultation.groupConversationId && (
                <ChatPanel
                  conversationId={detail.consultation.groupConversationId}
                  title={t('expert.groupThread')}
                />
              )}
              {chosen?.conversationId && (
                <ChatPanel
                  conversationId={chosen.conversationId}
                  title={t('expert.privateThread', {
                    name: tc(chosen.responderName),
                  })}
                />
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
