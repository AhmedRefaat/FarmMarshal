/**
 * i18n/index.tsx — LOCALIZATION LAYER (R15, ADR-025..029).
 * ---------------------------------------------------------------------------
 * A dependency-free, typed i18n provider. Rules it enforces so that callers
 * cannot get them wrong (see docs/LOCALIZATION_SPEC.md):
 *
 *   • Catalogue lookup with {{placeholder}} interpolation — sentences are ONE
 *     key, never concatenated fragments (Arabic word order differs).
 *   • Plural selection through Intl.PluralRules, so Arabic's six categories
 *     (zero/one/two/few/many/other) work without caller involvement.
 *   • Every formatter is pinned to `-u-ca-gregory-nu-latn`. Intl resolves
 *     Arabic locales to the Hijri calendar and/or Arabic-Indic digits by
 *     default; farm ops, money, GPS and audit trails must stay Gregorian and
 *     Western-digit.
 *   • In RTL, interpolated values are wrapped in FSI…PDI so Latin ids, emails
 *     and coordinates cannot visually reorder the surrounding Arabic.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { en } from './en';
import { ar } from './ar';

export type Locale = 'ar' | 'en';

/** A value is either a plain string or a plural record keyed by CLDR category. */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>>;
export type CatalogueValue = string | PluralForms;
export type Catalogue = Record<string, CatalogueValue>;

/** Keys are whatever the English catalogue defines; `ar` must match it. */
export type MessageKey = keyof typeof en;

type Vars = Record<string, string | number> & { count?: number };

const STORAGE_KEY = 'farmmarshal_locale';

/**
 * BCP-47 tags with the Unicode extensions pinned.
 * `nu-latn` forces Western digits; `ca-gregory` defeats the ar-SA Hijri default.
 */
const TAG: Record<Locale, string> = {
  ar: 'ar-EG-u-ca-gregory-nu-latn',
  en: 'en-GB-u-ca-gregory-nu-latn',
};

const DIR: Record<Locale, 'rtl' | 'ltr'> = { ar: 'rtl', en: 'ltr' };

const CATALOGUES: Record<Locale, Catalogue> = { ar, en };

/** Unicode first-strong isolate / pop directional isolate. */
const FSI = '\u2068';
const PDI = '\u2069';

/** Fallback order when the exact plural category is not authored. */
const PLURAL_FALLBACK: Intl.LDMLPluralRule[] = [
  'other',
  'many',
  'few',
  'two',
  'one',
  'zero',
];

/**
 * Vite replaces `import.meta.env.DEV` at build time. It is read through a cast
 * so the app's tsconfig does not have to pull in the `vite/client` ambient
 * types just to satisfy two diagnostics-only branches.
 */
const IS_DEV = Boolean(
  (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV
);

function resolvePlural(
  forms: PluralForms,
  locale: Locale,
  count: number
): string {
  const category = new Intl.PluralRules(TAG[locale]).select(count);
  if (forms[category] !== undefined) return forms[category]!;
  // `zero` is special: CLDR only selects it for Arabic, but a catalogue may
  // author it for English as a nicer empty-state wording.
  if (count === 0 && forms.zero !== undefined) return forms.zero;
  for (const c of PLURAL_FALLBACK) {
    if (forms[c] !== undefined) return forms[c]!;
  }
  return '';
}

function interpolate(template: string, vars: Vars | undefined, rtl: boolean) {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => {
    const value = vars[name];
    if (value === undefined) return whole;
    const text = String(value);
    // Isolation only matters when the surrounding paragraph is RTL; skipping it
    // in LTR keeps English output free of invisible control characters.
    return rtl ? `${FSI}${text}${PDI}` : text;
  });
}

export interface Formatters {
  /** Gregorian short date, Western digits. */
  date(ms: number): string;
  /** Date + time, Western digits. */
  dateTime(ms: number): string;
  /** Time only. */
  time(ms: number): string;
  /** Grouped number. */
  number(n: number): string;
  /** Currency with the locale's symbol (`ر.س` for SAR). */
  currency(n: number, code?: string): string;
}

export interface I18n {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  setLocale(next: Locale): void;
  t(key: MessageKey, vars?: Vars): string;
  fmt: Formatters;
}

const I18nContext = createContext<I18n | null>(null);

/** Stored preference → browser language → Arabic (the product is Arabic-first). */
function initialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'ar' || stored === 'en') return stored;
  return navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'ar';
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const dir = DIR[locale];

  const setLocale = useCallback((next: Locale) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLocaleState(next);
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Vars) => {
      const entry =
        (CATALOGUES[locale] as Catalogue)[key as string] ??
        (en as Catalogue)[key as string];
      if (entry === undefined) {
        if (IS_DEV) console.warn(`[i18n] missing key: ${key}`);
        return key as string;
      }
      const template =
        typeof entry === 'string'
          ? entry
          : resolvePlural(entry, locale, vars?.count ?? 0);
      return interpolate(template, vars, dir === 'rtl');
    },
    [locale, dir]
  );

  const fmt = useMemo<Formatters>(() => {
    const tag = TAG[locale];
    const date = new Intl.DateTimeFormat(tag, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const dateTime = new Intl.DateTimeFormat(tag, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const time = new Intl.DateTimeFormat(tag, {
      hour: '2-digit',
      minute: '2-digit',
    });
    const number = new Intl.NumberFormat(tag);
    const currencyCache = new Map<string, Intl.NumberFormat>();
    return {
      date: (ms) => date.format(ms),
      dateTime: (ms) => dateTime.format(ms),
      time: (ms) => time.format(ms),
      number: (n) => number.format(n),
      currency: (n, code = 'SAR') => {
        let f = currencyCache.get(code);
        if (!f) {
          f = new Intl.NumberFormat(tag, {
            style: 'currency',
            currency: code,
            maximumFractionDigits: 0,
          });
          currencyCache.set(code, f);
        }
        return f.format(n);
      },
    };
  }, [locale]);

  // The <html> attributes drive CSS logical properties and screen readers.
  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = dir;
    document.title = t('app.title');
  }, [locale, dir, t]);

  const value = useMemo<I18n>(
    () => ({ locale, dir, setLocale, t, fmt }),
    [locale, dir, setLocale, t, fmt]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** `const { t, fmt, dir } = useI18n()` from any component. */
export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <LocaleProvider>');
  return ctx;
}

/**
 * Maps a failure to localized copy. Server error text is developer-facing
 * (ADR-029) and is surfaced only in dev builds, so internal wording can never
 * reach a field user.
 */
export function useErrorMessage() {
  const { t } = useI18n();
  return useCallback(
    (e: unknown): string => {
      const status = (e as { status?: number })?.status;
      const key =
        status === 401
          ? 'error.401'
          : status === 402
          ? 'error.402'
          : status === 403
          ? 'error.403'
          : status === 404
          ? 'error.404'
          : status === 409
          ? 'error.409'
          : status && status >= 500
          ? 'error.500'
          : 'error.generic';
      const message = t(key as MessageKey);
      const raw = (e as Error)?.message;
      return IS_DEV && raw ? `${message} (${raw})` : message;
    },
    [t]
  );
}

/** Locale toggle button used in the sidebar and on the sign-in card. */
export function LocaleSwitch({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <button
      type="button"
      className={className ?? 'locale-switch'}
      onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
      aria-label={t('locale.toggleAria')}
    >
      🌐 {t('locale.toggle')}
    </button>
  );
}
