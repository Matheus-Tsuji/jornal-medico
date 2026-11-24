// Validação determinística da saída da IA contra o material de origem.
// Divergência gera sinalização para revisão humana; nunca correção automática.
import type { AiAnalysis } from '@jm/contracts';

/** Sobe quando o validador fica mais rígido: rascunhos bloqueados/rejeitados com versão anterior podem ser refeitos. */
export const VALIDATOR_VERSION = 2;

export type ReviewFlag = AiAnalysis['reviewFlags'][number];
export interface ValidationReport { errors: string[]; warnings: string[]; flags: ReviewFlag[] }

const INJECTION = /(ignore|disregard|forget)\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above)\s+(instructions|prompts?)|system\s+prompt|you\s+are\s+now|ignore\s+(as\s+)?instru[çc][õo]es|new\s+instructions\s*:/i;

export const looksLikeInjection = (text: string) => INJECTION.test(text);

/**
 * Cada número de um texto com suas leituras possíveis. "32,683" (inglês) e "32.683" (pt-BR) podem ser
 * milhar ou decimal: as duas leituras são mantidas e basta uma bater com a fonte.
 */
export function numberTokens(text: string): string[][] {
  // espaço fino/inseparável entre grupos de 3 dígitos é separador de milhar ("12 821")
  const t = text.replace(/[−–—]/g, '-').replace(/(\d)[\u2009\u202f\u00a0](?=\d{3}\b)/g, '$1');
  const out: string[][] = [];
  for (const m of t.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const tok = m[0];
    const seps = tok.match(/[.,]/g) ?? [];
    const readings = new Set<string>();
    if (seps.length === 0) readings.add(tok);
    else if (new Set(seps).size === 2) {
      // separadores mistos: o último é decimal, os demais são milhar
      const last = Math.max(tok.lastIndexOf('.'), tok.lastIndexOf(','));
      readings.add(`${tok.slice(0, last).replace(/[.,]/g, '')}.${tok.slice(last + 1)}`);
    } else {
      if (/^\d{1,3}([.,]\d{3})+$/.test(tok)) readings.add(tok.replace(/[.,]/g, '')); // milhar
      if (seps.length === 1) readings.add(tok.replace(',', '.')); // decimal
    }
    out.push([...readings].filter((r) => r !== '' && Number.isFinite(Number(r))).map((r) => String(Number(r))));
  }
  return out.filter((r) => r.length);
}

/** Todas as leituras numéricas de um texto (conjunto usado como "o que a fonte contém"). */
export function numbersIn(text: string): Set<string> {
  return new Set(numberTokens(text).flat());
}

const covered = (tok: string[], allowed: Set<string>) => tok.some((r) => allowed.has(r));

const norm = (s: string) => s.toLowerCase().replace(/[−–—]/g, '-').replace(/\s+/g, ' ').trim();

export function validateAnalysis(a: AiAnalysis, source: string, expectedScope: AiAnalysis['inputScope']): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const flags = new Set<ReviewFlag>(a.reviewFlags);
  flags.add('requires_human_review');
  const srcNums = numbersIn(source);
  const srcNorm = norm(source);

  if (a.inputScope !== expectedScope) errors.push(`inputScope '${a.inputScope}' difere do material enviado ('${expectedScope}').`);
  if (looksLikeInjection(source)) flags.add('possible_prompt_injection');

  a.results.forEach((r, i) => {
    const at = `results[${i}] (${r.outcome})`;
    // O rótulo aparece sozinho nos cards: só o nome da medida (números e listas ficam no estimateRaw).
    if (r.measure && /[\d;:]/.test(r.measure)) warnings.push(`${at}: rótulo da medida com números ou pontuação ("${r.measure}").`);
    const ci = r.confidenceInterval;
    if (ci) {
      if (!(ci.lower <= ci.upper)) errors.push(`${at}: limite inferior do IC maior que o superior.`);
      if (!(ci.level > 50 && ci.level < 100)) errors.push(`${at}: nível do IC inválido (${ci.level}).`);
      if (r.estimate !== null && (r.estimate < ci.lower || r.estimate > ci.upper)) errors.push(`${at}: estimativa fora do intervalo de confiança.`);
      if (r.measureKind === 'ratio' && (ci.lower <= 0 || (r.estimate !== null && r.estimate <= 0))) errors.push(`${at}: medida de razão com valor não positivo.`);
    }
    if (r.pValue) {
      const p = r.pValue;
      if (!(p.value >= 0 && p.value <= 1)) errors.push(`${at}: p-valor fora de [0,1].`);
      const rawHasIneq = /[<>≤≥]/.test(p.raw);
      if (rawHasIneq && p.operator === '=') errors.push(`${at}: p-valor com desigualdade na fonte foi registrado como igualdade.`);
      if (!rawHasIneq && p.operator !== '=') warnings.push(`${at}: operador do p-valor não aparece no texto bruto.`);
    }
    if (r.sampleSize !== null && r.sampleSize <= 0) errors.push(`${at}: tamanho amostral não positivo.`);
    // Fidelidade numérica: todo número reportado precisa existir na fonte (erro: bloqueia a análise).
    const reported = [r.estimateRaw, r.confidenceInterval?.raw, r.pValue?.raw].filter((x): x is string => !!x);
    for (const raw of reported) {
      for (const tok of numberTokens(raw)) {
        if (!covered(tok, srcNums)) {
          errors.push(`${at}: número ${tok[0]} não encontrado no material de origem.`);
          flags.add('numeric_uncertainty');
        }
      }
    }
    // Os campos numéricos precisam bater com o texto bruto de onde saíram (sinal ignorado: o tokenizador não o lê).
    const inRaw = (v: number, raw: string) => numberTokens(raw).flat().includes(String(Math.abs(v)));
    if (r.estimate !== null && r.estimateRaw && !inRaw(r.estimate, r.estimateRaw)) {
      errors.push(`${at}: estimativa ${r.estimate} não aparece em estimateRaw ("${r.estimateRaw}").`);
    }
    if (ci?.raw && (!inRaw(ci.lower, ci.raw) || !inRaw(ci.upper, ci.raw))) {
      errors.push(`${at}: limites do IC (${ci.lower}; ${ci.upper}) não batem com o texto bruto ("${ci.raw}").`);
    }
    if (r.evidenceRef.quote && !srcNorm.includes(norm(r.evidenceRef.quote))) {
      errors.push(`${at}: trecho de evidência não encontrado literalmente na fonte.`);
      flags.add('numeric_uncertainty');
    }
  });

  a.claims.forEach((c, i) => {
    if (c.origin !== 'editorial' && (!c.quote || !srcNorm.includes(norm(c.quote)))) {
      errors.push(`claims[${i}]: afirmação sem trecho literal verificável na fonte.`);
      flags.add('numeric_uncertainty');
    }
  });

  if (a.population.sampleSize !== null && !srcNums.has(String(a.population.sampleSize))) {
    warnings.push(`population.sampleSize ${a.population.sampleSize} não aparece na fonte.`);
    flags.add('numeric_uncertainty');
  }
  if (a.editorialPriority.score < 0 || a.editorialPriority.score > 1) errors.push('editorialPriority.score fora de [0,1].');
  if (expectedScope === 'abstract_only' && !a.missingFields.length && a.results.length === 0) flags.add('insufficient_input');
  return { errors, warnings, flags: [...flags] };
}

/** A redação editorial não pode introduzir números que não estejam na extração/fonte. */
export function validateEditorial(text: { editorialHeadline: string | null; summary: string | null; inShort: string | null; plainResult?: string | null }, extractionJson: string, source: string): ValidationReport {
  const errors: string[] = [];
  const allowed = new Set([...numbersIn(extractionJson), ...numbersIn(source)]);
  const all = [text.editorialHeadline, text.summary, text.inShort, text.plainResult].filter(Boolean).join(' ');
  if (text.plainResult && text.plainResult.length > 300) errors.push('Frase do resultado longa demais.');
  for (const tok of numberTokens(all)) if (!covered(tok, allowed)) errors.push(`Redação introduziu número ausente da extração: ${tok[0]}`);
  if (!text.editorialHeadline || text.editorialHeadline.length > 200) errors.push('Manchete ausente ou longa demais.');
  if (!text.summary || text.summary.length > 1500) errors.push('Resumo ausente ou longo demais.');
  if (text.inShort && text.inShort.length > 400) errors.push('"Em poucas palavras" longo demais.');
  if (/\b(comprova|cura|revoluciona|milagr)/i.test(all)) errors.push('Linguagem sensacionalista na redação.');
  return { errors, warnings: [], flags: [] };
}
