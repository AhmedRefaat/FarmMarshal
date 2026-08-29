# FarmMarshal — Localization & Arabic Language Specification

**Version:** 1.0 · **Date:** 2026-08-28 · **Status:** NORMATIVE
Companion to `docs/REQUIREMENTS.md` §R15. Every user-facing surface (mobile app, web SPA,
server-emitted user-visible text) MUST conform to this document.

---

## 1. Scope & language policy

| Decision | Value | Rationale |
|---|---|---|
| Supported locales | `ar` (default), `en` | Field users are Arabic-first; `en` retained for expatriate agronomists, investors and QA |
| Default for a new install | `ar` | R13/R15: Arabic-first, not Arabic-optional |
| Arabic register | **Simplified Modern Standard Arabic** (فصحى مبسطة) | The ONLY register understood identically in Egypt and the GCC. Egyptian عامية reads unprofessional in the Gulf; Gulf dialect reads foreign in Egypt |
| Dialect words | **Forbidden** in UI strings | See §4 banned list |
| Coverage | 100% of screens, pages, modals, toasts, empty states, validation messages, status badges, tab titles, document `<title>` | A single untranslated string breaks the RTL reading flow |
| Fallback | Missing `ar` key → `en` string + dev-time console warning; never a raw key shown to a user | |

### 1.1 Why not per-country locales (`ar-EG` / `ar-SA`)?

Splitting the catalogue per country doubles the translation surface for a handful of words.
Instead we ship **one `ar` catalogue written in country-neutral MSA**, and confine the genuinely
regional differences to *formatting* (§3), which `Intl` derives from the device region without a
separate catalogue.

---

## 2. Terminology glossary (NORMATIVE)

Translators and reviewers MUST use the "Approved" column. The "Rejected" column lists terms that
were considered and deliberately turned down — do not reintroduce them.

### 2.1 Roles & people

| English | Approved Arabic | Rejected | Note |
|---|---|---|---|
| Owner (land owner) | مالك المزرعة | صاحب الأرض | "صاحب الأرض" is colloquial in EG |
| Field manager / moderator | مشرف | مدير الحقل | مشرف is the actual job title in both regions |
| Worker | عامل | فلاح | فلاح carries class connotations in EG; unusable in the Gulf |
| Agricultural expert | خبير زراعي | — | |
| Academic expert | خبير أكاديمي | — | |
| Agricultural engineer | مهندس زراعي | — | The most respected field title in EG **and** the GCC |
| Accountant | محاسب | — | |
| Learner | متدرّب | طالب | طالب implies university enrolment |
| Admin | مسؤول النظام | أدمن | no transliterations |

### 2.2 Core operations

| English | Approved Arabic | Note |
|---|---|---|
| Farm | مزرعة | |
| Farm sector / plot | قطاع المزرعة | avoid EG-only حوض |
| Task | مهمة | |
| Issue / problem | مشكلة | |
| Report | تقرير | |
| Evidence | إثبات | photos → صور الإثبات |
| Before photo | صورة قبل التنفيذ | |
| After photo | صورة بعد التنفيذ | |
| Approve | اعتماد | |
| Decline / reject | رفض | |
| Review | مراجعة | |
| Rating | تقييم | |
| Comment | تعليق | |
| Voice note | رسالة صوتية | |
| Location / pin | الموقع | |
| Navigate / drive me there | الاتجاهات | |

### 2.3 Task & issue statuses (badge text)

| Status key | Arabic | Deliberate wording choice |
|---|---|---|
| `assigned` | مُسندة | |
| `in_progress` | جارٍ التنفيذ | |
| `submitted` | بانتظار المراجعة | Literal "تم الإرسال" hides *who must act next*; the Arabic states the pending action |
| `approved` | معتمدة | |
| `rejected` | مرفوضة | |
| `detected` | تم الرصد | |
| `inspected` | تمت المعاينة | |
| `identified` | تم التشخيص | |
| `recommended` | تمت التوصية | |
| `implemented` | تم التنفيذ | |
| `reviewed` | تمت المراجعة | |
| `closed` | مغلقة | |

### 2.4 Domain vocabulary (agronomy & IoT)

| English | Approved Arabic | Regional note |
|---|---|---|
| Irrigation | ري | |
| Valve | محبس | Understood in EG (field word) and the GCC. صمام is the engineering register; the UI targets field staff |
| Water meter | عداد المياه | |
| Leak | تسريب | |
| Consumption | الاستهلاك | |
| Solar panel | لوح شمسي | |
| Dust | غبار | MSA; EG "أتربة" and Gulf "غبار" both map here |
| Panel cleaning | تنظيف الألواح | |
| Tree | شجرة | |
| Pruning | تقليم | |
| Fertilizer | سماد | |
| Pesticide | مبيد | |
| Seeds | بذور | not EG-only تقاوي |
| Harvest | حصاد | |
| Yield | المحصول | |

### 2.5 Marketplace & money

| English | Approved Arabic | Note |
|---|---|---|
| Consultation request | طلب استشارة | |
| Recommendation / answer | التوصية | |
| Bounty | قيمة المكافأة | |
| Platform commission | عمولة المنصة | |
| Net payout | صافي المستحق | |
| Escrow (held funds) | مبلغ محجوز لدى المنصة | no single-word Arabic equivalent; the phrase is the term |
| Payout status | حالة الصرف | |
| Subscription plan | الباقة | shared EG/Gulf telco vocabulary |
| Upgrade required | يتطلب ترقية الباقة | |
| Expense | مصروف | |
| Income | إيراد | |
| Receipt | إيصال | |

### 2.6 Generic UI chrome

| English | Arabic | | English | Arabic |
|---|---|---|---|---|
| Sign in | تسجيل الدخول | | Save | حفظ |
| Sign out | تسجيل الخروج | | Cancel | إلغاء |
| Email | البريد الإلكتروني | | Back | رجوع |
| Password | كلمة المرور | | Close | إغلاق |
| Dashboard | لوحة المتابعة | | Search | بحث |
| Tasks | المهام | | Filter | تصفية |
| Team | الفريق | | Refresh | تحديث |
| Evaluations | التقييمات | | Loading… | جارٍ التحميل… |
| Chat | المحادثات | | Retry | إعادة المحاولة |
| Notifications | الإشعارات | | No data | لا توجد بيانات |

> **لوحة المتابعة, not لوحة التحكم.** The owner *monitors*; he does not operate machinery from
> that page. لوحة التحكم is reserved for the water/valve control surface, where it is accurate.

---

## 3. Formatting rules

### 3.1 Digits — Western (`0-9`), always

Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) are **not** used anywhere in the product.

- Egypt is mixed; the entire GCC uses Western digits on phones and in banking.
- GPS coordinates, meter readings, money and IDs are copied between the app, WhatsApp and
  paper ledgers — a digit set change is a data-entry hazard.
- Enforced by pinning the Unicode numbering system: locale tag `…-u-nu-latn`.

### 3.2 Calendar — Gregorian, always

`Intl` defaults `ar-SA` to the **Islamic (Umm al-Qura) calendar**. Farm operations, invoices and
audit trails are Gregorian. Every formatter MUST pin `…-u-ca-gregory-nu-latn`; a bare
`toLocaleDateString('ar')` is a defect.

### 3.3 Currency

| Currency | Arabic display | Formatter |
|---|---|---|
| SAR | `ر.س` | `Intl.NumberFormat('ar-EG-u-nu-latn', { style:'currency', currency:'SAR' })` |
| EGP / AED | `ج.م` / `د.إ` | same shape, currency swapped |

Amount and symbol stay adjacent and are wrapped in a bidi isolate (§5.3) so a trailing symbol
does not jump across a sentence boundary.

### 3.4 Plurals — six categories

Arabic uses `zero, one, two, few, many, other`. English's two-form model is insufficient.
The i18n layer MUST resolve counts through `Intl.PluralRules(locale)` and catalogues MUST provide
every category that the rule set can produce for that key.

```
answers:  zero: لا توجد إجابات · one: إجابة واحدة · two: إجابتان
          few: {{count}} إجابات · many: {{count}} إجابة · other: {{count}} إجابة
```

### 3.5 Units & measures

- Area: فدان (EG) vs هكتار / دونم (Gulf) differ by region → the UI shows the **stored unit
  label from the data**, never a hard-coded word, and the label itself is translated.
- Distance: متر / كم. Volume: م³. Temperature: °م.

---

## 4. Banned constructions

1. **Dialect** — عايز, ازيك, شلونك, وش, دلوقتي, حالياً كده, يلا, تمام كده.
2. **Transliterated English** — أدمن, لوج إن, داشبورد, تاسك, ريبورت, أب لود.
3. **Machine-translation artefacts** — literal renderings such as "قم بـ + verb" chains
   (قم بالضغط) where a plain imperative (اضغط) is correct and shorter.
4. **String concatenation of translated fragments** in code. Arabic word order, agreement and
   gender differ from English; every sentence must be ONE catalogue key with placeholders.
5. **Text baked into images/icons.**
6. **Gendered address.** Prefer neutral phrasing (مرحبًا بك) over gendered forms; where a verb
   must agree, use the masculine singular as the documented convention — the alternative
   (duplicating the whole catalogue per gender) is out of scope.

---

## 5. RTL layout rules

### 5.1 Direction switching

| Surface | Mechanism |
|---|---|
| Web | `<html lang="ar" dir="rtl">` set by the locale provider; CSS uses **logical properties** (`margin-inline-start`, `padding-inline-end`, `inset-inline-*`) so no stylesheet is duplicated |
| Mobile | `I18nManager.forceRTL(true)` + a one-time app reload; per-`Text` `writingDirection` for mixed content |

### 5.2 What mirrors and what does not

| Mirrors | Does NOT mirror |
|---|---|
| Layout, list alignment, drawers, progress direction | Numbers, GPS coordinates, phone numbers |
| Directional icons (← → chevrons, back arrows) | Latin brand names, email addresses, URLs |
| Table column order | Media playback controls (▶ stays ▶ — a de-facto pictogram) |
| Form label/field pairing | Clock icons, the camera shutter, map north |

### 5.3 Mixed Arabic/Latin content (bidi)

Arabic sentences that embed Latin tokens (`owner@agri.com`, `f-1`, `12.5 km`) reorder visually
unless isolated. Every interpolated value of unknown script MUST be rendered inside a bidi
isolate — `<bdi>` on web, `\u2068 … \u2069` (FSI/PDI) on mobile. Symptoms of getting this wrong:
a trailing period jumping to the start of the line, or an ID rendering backwards.

### 5.4 Typography

- Font stack must include a real Arabic face; Latin-only stacks fall back to a system Arabic font
  with mismatched metrics. Web: `'Noto Kufi Arabic','Cairo',system-ui,…`.
- Arabic glyphs need ~15% more line-height than Latin at the same size.
- **Never** apply `text-transform: uppercase` (meaningless in Arabic) or letter-spacing
  (it breaks cursive joining and renders the word unreadable).

---

## 6. Server-side policy

The API stays **language-neutral**:

- Error bodies carry a machine-readable code and a developer-facing English `error` string.
  Clients map status/code → a localized message. Raw server text is surfaced to the user only in
  development builds.
- User-authored content (task titles, comments, consultation questions) is stored **verbatim in
  the author's language** and never auto-translated at rest; F3 translation is a per-message,
  cached, on-demand view with the original always retrievable.
- `Accept-Language` is forwarded by both clients so future server-rendered artefacts (PDF
  reports, emails) can honour it.

---

## 7. Review & acceptance

| Gate | Check |
|---|---|
| L1 | `ar` and `en` catalogues have identical key sets (automated test) |
| L2 | No literal user-facing string remains in a screen/page component (lint sweep) |
| L3 | Native-speaker review by one Egyptian and one Gulf reviewer; disagreements resolve to §2 |
| L4 | Every screen screenshotted in `ar` at the largest OS font size — no clipping, no LTR leakage |
| L5 | Dates/money/counts verified Gregorian + Western digits + correct plural category |
| L6 | Mixed-script strings verified for bidi isolation |

Traceability: test IDs `L1–L6` are registered in `docs/TEST_COVERAGE_TRACEABILITY.md` §1
against requirement **R15**.
