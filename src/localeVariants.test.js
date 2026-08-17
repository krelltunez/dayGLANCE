import { describe, it, expect, beforeAll } from 'vitest';
import { languages, loaders } from './locales.js';

/**
 * Portuguese ships in two written standards, and the difference is lexical
 * enough to check mechanically. A word from the wrong standard is not a
 * subtlety a reader forgives — a Brazilian meeting "ficheiro" or "ecrã" reads
 * a foreign dialect, not a typo.
 *
 * Both lists below were calibrated against real files rather than assembled
 * from a grammar: every European marker was checked against lifeGLANCE's
 * Brazilian locale and every Brazilian marker against this app's European one,
 * and anything that fired was investigated and either fixed or dropped. Words
 * that are correct in BOTH standards are deliberately absent even where they
 * are stylistically preferred in one:
 *
 *   padrão      "pattern" in both; only "default" is a BR/EU split
 *   separador   a visual separator in both, not only a UI tab
 *   ligação     a phone call in Brazil, a connection in Portugal
 *   transferir  a transfer in Brazil, a download in Portugal
 *   excluir     "to exclude" in both, alongside BR "to delete"
 *
 * Keeping them out costs a little coverage and buys a guardrail that does not
 * cry wolf. Add a marker only after checking it against both files.
 */
const EUROPEAN_ONLY = {
  ficheiro: /\bficheiros?\b/i,
  utilizador: /\butilizador(es)?\b/i,
  // JavaScript's \b is ASCII-only, so a trailing accented letter is not a word
  // character and \b after it never matches: /\becrã\b/ silently matches
  // nothing. Any marker ending in an accent uses a lookahead instead, and the
  // self-test below fails on a pattern that cannot match its own name.
  ecrã: /\becrãs?(?![a-zà-ÿ])/i,
  aplicação: /\baplicaç(ão|ões)\b/i,
  definições: /\bdefinições\b/i,
  'palavra-passe': /\bpalavras?-passe\b/i,
  'frase-passe': /\bfrases?-passe\b/i,
  telemóvel: /\btelemó(vel|veis)\b/i,
  registo: /\bregistos?\b/i,
  contacto: /\bcontactos?\b/i,
  predefinição: /\bpredefini(?:ç(?:ão|ões)|d[oa]s?)(?![a-zà-ÿ])/i,
  secção: /\bsecç(?:ão|ões)(?![a-zà-ÿ])/i,
  contentor: /\bcontentor(es)?\b/i,
  partilhar: /\bpartilh\w+\b/i,
  aceder: /\bacede\w*\b/i,
  guardar: /\bguardar\b/i,
  carregue: /\bcarregue\b/i,
  premir: /\bpremir\b/i,
  autoalojado: /\bautoalojad[oa]s?\b/i,
  desfasado: /\bdesfasad[oa]s?\b/i,
  noutro: /\bnoutr[oa]s?\b/i,
  // "está a sincronizar" — Portugal's progressive. Brazil uses the gerund.
  'está a + infinitivo': /\best(á|ão) a \w+[aei]r\b/i,
  // "precisa de ser atualizado" — European before an infinitive only; before a
  // noun ("precisa de ajuda") it is correct in both, hence the ending.
  'precisa de + infinitivo': /\b(precisa|precisam|tem|têm) de \w+[aei]r\b/i,
};

const BRAZILIAN_ONLY = {
  arquivo: /\barquivos?\b/i,
  usuário: /\busuários?\b/i,
  aplicativo: /\baplicativos?\b/i,
  tela: /\btelas?\b/i,
  configurações: /\bconfigurações\b/i,
  senha: /\bsenhas?\b/i,
  celular: /\bcelular(es)?\b/i,
  registro: /\bregistros?\b/i,
  contato: /\bcontatos?\b/i,
  aba: /\babas?\b/i,
  conexão: /\bconex(ão|ões)\b/i,
  mouse: /\bmouse\b/i,
  compartilhar: /\bcompartilh\w+\b/i,
  baixar: /\bbaixar\b/i,
  contêiner: /\bcontêiner(es)?\b/i,
  // "está sincronizando" — Brazil's progressive.
  'gerúndio progressivo': /\best(á|ão) \w+ndo\b/i,
  'precisa + infinitivo': /\b(precisa|precisam) (ser|estar|\w+[aei]r)\b/i,
};

// Which standard each shipped Portuguese locale must hold to. A bare "pt" is
// treated as European because that is what this app's single locale was before
// the split.
function expectedStandard(tag) {
  if (tag === 'pt-BR') return { name: 'Brazilian', forbidden: EUROPEAN_ONLY };
  if (tag === 'pt' || tag === 'pt-PT') return { name: 'European', forbidden: BRAZILIAN_ONLY };
  return null;
}

const portuguese = languages.filter((l) => l.split('-')[0] === 'pt');

describe('Portuguese variant purity', () => {
  const bundles = {};
  beforeAll(async () => {
    await Promise.all(
      portuguese.map(async (lng) => {
        bundles[lng] = await loaders[lng]();
      }),
    );
  });

  const flatten = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) => {
      const key = prefix ? `${prefix}.${k}` : k;
      return v && typeof v === 'object' && !Array.isArray(v)
        ? flatten(v, key)
        : [[key, v]];
    });

  it('ships at least one Portuguese locale', () => {
    expect(portuguese.length).toBeGreaterThan(0);
  });

  // A marker that cannot match its own name is a guardrail that passes because
  // it never fires — the worst kind. This is how the ASCII-\b bug in /\becrã\b/
  // was found, after it had already let a stray "ecrã" through.
  it.each(Object.entries({ ...EUROPEAN_ONLY, ...BRAZILIAN_ONLY }))(
    'the %s pattern matches the word it is named for',
    (name, pattern) => {
      // Multi-word grammatical markers are named for the construction, not a
      // literal string, so they are exercised by the sample phrases instead.
      const constructions = {
        'está a + infinitivo': 'está a sincronizar',
        'precisa de + infinitivo': 'precisa de ser atualizado',
        'gerúndio progressivo': 'está sincronizando',
        'precisa + infinitivo': 'precisa ser atualizado',
      };
      expect(pattern.test(constructions[name] ?? name)).toBe(true);
    },
  );

  it.each(portuguese)('%s uses only its own standard', (lng) => {
    const { name, forbidden } = expectedStandard(lng);
    const strings = flatten(bundles[lng]).filter(([, v]) => typeof v === 'string');
    const violations = [];

    for (const [key, value] of strings) {
      for (const [marker, pattern] of Object.entries(forbidden)) {
        const found = value.match(pattern);
        if (found) violations.push(`  ${key}: "${found[0]}" — ${marker}\n      ${value.slice(0, 110)}`);
      }
    }

    expect(
      violations,
      `${lng} is meant to be ${name} Portuguese but ${violations.length} string(s) use the other standard:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
