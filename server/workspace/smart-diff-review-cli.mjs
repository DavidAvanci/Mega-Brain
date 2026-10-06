#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const usage = `Uso:
  node review.mjs prepare <report.json> <workDir> [--cache cache.json]
  node review.mjs assemble <report.json> <decisions.json> <out.json> [--cache cache.json]`;

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const sha = (text) => createHash('sha256').update(text).digest('hex');
const option = (args, name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const RULE_LABELS = {
  format_only: 'Só formatação',
  lockfile: 'Lockfile acompanhando a mudança do manifesto',
  generated: 'Arquivo marcado como gerado (.gitattributes linguist-generated)',
};

function kindOf(path) {
  if (/(?:^|\/)(?:__tests__\/|[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$)/i.test(path)) return 'test';
  if (/\.(?:md|mdx|markdown|txt|rst)$/i.test(path)) return 'doc';
  if (/\.(?:json|jsonc|toml|ya?ml|lock|ini|env)$|(?:^|\/)(?:Dockerfile|Makefile)$|\.config\.[cm]?[jt]s$/i.test(path)) return 'config';
  return 'code';
}

function load(reportPath) {
  const report = readJson(reportPath);
  if (report.schemaVersion !== 1 || !Array.isArray(report.readingOrder)) {
    throw new Error('Relatório sem readingOrder: gere com a versão do smart-diff que emite readingOrder e relations.');
  }
  const filesById = new Map(report.files.map((file) => [file.id, file]));
  const entries = report.units.map((unit) => {
    const file = filesById.get(unit.patchRefs[0]);
    return { unit, file, path: file.newPath ?? file.oldPath };
  });
  const byUnit = new Map(entries.map((entry) => [entry.unit.id, entry]));
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const dependencies = new Map(entries.map((entry) => [entry.path, new Set()]));
  const relationEvidence = new Map(entries.map((entry) => [entry.path, []]));
  for (const group of report.groups) {
    if (!Array.isArray(group.relations)) throw new Error('Relatório sem groups[].relations: atualize e recompile o smart-diff.');
    for (const relation of group.relations) {
      const from = byUnit.get(relation.from).path;
      const to = byUnit.get(relation.to).path;
      dependencies.get(from).add(to);
      relationEvidence.get(from).push(relation.evidence);
    }
  }
  const ordered = report.readingOrder.map((id) => byUnit.get(id));
  return { report, entries, ordered, byPath, dependencies, relationEvidence };
}

function reviewPatch(patch, hunks) {
  if (!hunks?.some((hunk) => hunk.visibility === 'collapsed')) return { patch, omitted: 0 };
  const output = [];
  let index = -1;
  let omitted = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      index++;
      if (hunks[index]?.visibility === 'collapsed') omitted++;
    }
    if (index >= 0 && hunks[index]?.visibility === 'collapsed') continue;
    output.push(line);
  }
  return { patch: output.join('\n'), omitted };
}

const lineStats = (patch) => {
  let added = 0;
  let removed = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return { added, removed };
};

const cacheKey = (file) => [file.newPath ?? file.oldPath, file.oldHash ?? '', file.newHash ?? ''].join('\0');
const readCache = (path) => (path && existsSync(path) ? readJson(path) : { version: 1, entries: {} });

function autoNoiseReason(unit) {
  const main = unit.classifications[0];
  return `${RULE_LABELS[main.ruleId] ?? main.ruleId}: ${main.evidence.join('; ')}`;
}

function prepare(reportPath, workDir, cachePath) {
  const { ordered, dependencies, relationEvidence } = load(reportPath);
  const cache = readCache(cachePath);
  mkdirSync(join(workDir, 'patches'), { recursive: true });
  const usedBy = new Map();
  for (const [from, targets] of dependencies) for (const to of targets) usedBy.set(to, [...(usedBy.get(to) ?? []), from]);
  const files = [];
  const autoNoise = [];
  ordered.forEach(({ unit, file, path }, index) => {
    if (unit.visibility === 'collapsed') {
      autoNoise.push({ path, rule: unit.classifications[0].ruleId, reason: autoNoiseReason(unit) });
      return;
    }
    const { patch, omitted } = reviewPatch(file.patch, unit.hunks);
    const patchFile = join('patches', `${String(index + 1).padStart(3, '0')}-${path.replace(/[^\w.-]+/g, '_')}.diff`);
    writeFileSync(join(workDir, patchFile), patch.endsWith('\n') ? patch : `${patch}\n`);
    const cached = cache.entries[cacheKey(file)];
    files.push({
      order: index + 1,
      path,
      status: file.status,
      kind: kindOf(path),
      classifications: unit.classifications.map((item) => item.ruleId),
      lines: lineStats(patch),
      formatHunksOmitted: omitted,
      dependsOn: [...dependencies.get(path)].sort(),
      usedBy: [...new Set(usedBy.get(path) ?? [])].sort(),
      relations: relationEvidence.get(path),
      symbols: unit.symbols ?? [],
      patchFile,
      ...(cached ? { cached } : {}),
    });
  });
  const worklist = { report: reportPath, comparison: readJson(reportPath).comparison, autoNoise, files };
  writeFileSync(join(workDir, 'worklist.json'), `${JSON.stringify(worklist, null, 2)}\n`);
  const cachedCount = files.filter((file) => file.cached).length;
  process.stdout.write(`${files.length} arquivo(s) para decidir · ${autoNoise.length} já recolhido(s) pelo smart-diff · ${cachedCount} com decisão em cache\n${join(workDir, 'worklist.json')}\n`);
}

function validateExplanation(path, status, kind, explanation, errors) {
  const text = (value) => typeof value === 'string' && value.trim().length > 0;
  if (!explanation || typeof explanation !== 'object') return errors.push(`${path}: sem explicação`);
  if (kind === 'test') {
    if (!text(explanation.tests)) errors.push(`${path}: teste precisa de "tests"`);
    return;
  }
  if (kind === 'code' && status.startsWith('M') && !(text(explanation.before) && text(explanation.after))) errors.push(`${path}: arquivo de código modificado precisa de "before" e "after"`);
  else if (!text(explanation.after)) errors.push(`${path}: precisa de "after"`);
}

function assemble(reportPath, decisionsPath, outPath, cachePath) {
  const { report, ordered, byPath, dependencies } = load(reportPath);
  const decisions = readJson(decisionsPath);
  const errors = [];
  const sectionPaths = (decisions.sections ?? []).flatMap((section) => section.files ?? []);
  const judgmentNoise = new Map((decisions.noise ?? []).map((item) => [item.path, item.reason]));
  const autoNoise = ordered.filter(({ unit, path }) => unit.visibility === 'collapsed' && !sectionPaths.includes(path));
  const seen = new Map();
  for (const path of sectionPaths) {
    if (!byPath.has(path)) errors.push(`${path}: não está no relatório`);
    if (seen.has(path)) errors.push(`${path}: aparece em mais de uma posição das seções`);
    seen.set(path, seen.size);
  }
  for (const [path, reason] of judgmentNoise) {
    const entry = byPath.get(path);
    if (!entry) errors.push(`${path}: ruído que não está no relatório`);
    else if (entry.unit.visibility === 'collapsed') errors.push(`${path}: já recolhido pelo smart-diff; não repita em "noise"`);
    if (seen.has(path)) errors.push(`${path}: está em "noise" e em uma seção`);
    if (typeof reason !== 'string' || !reason.trim()) errors.push(`${path}: ruído sem motivo`);
  }
  for (const { unit, path } of ordered) {
    if (unit.visibility === 'expanded' && !seen.has(path) && !judgmentNoise.has(path)) errors.push(`${path}: não foi colocado em nenhuma seção nem em "noise"`);
  }
  const titles = new Set();
  for (const section of decisions.sections ?? []) {
    if (!section.title?.trim() || !section.summary?.trim()) errors.push(`Seção sem título ou resumo: ${JSON.stringify(section.title ?? '')}`);
    if (titles.has(section.title)) errors.push(`Título de seção repetido: ${section.title}`);
    titles.add(section.title);
    if (!section.files?.length) errors.push(`Seção vazia: ${section.title}`);
  }
  for (const path of sectionPaths) {
    for (const dependency of dependencies.get(path) ?? []) {
      if (seen.has(dependency) && seen.get(dependency) > seen.get(path)) errors.push(`${path} depende de ${dependency}, que aparece depois`);
    }
  }
  const explanations = decisions.explanations ?? {};
  for (const path of sectionPaths) {
    const entry = byPath.get(path);
    if (entry) validateExplanation(path, entry.file.status, kindOf(path), explanations[path], errors);
  }
  if (errors.length) {
    process.stderr.write(`Decisões inválidas (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }

  const inSections = new Set(sectionPaths);
  const usedBy = new Map();
  for (const path of sectionPaths) for (const dependency of dependencies.get(path)) if (inSections.has(dependency)) usedBy.set(dependency, [...(usedBy.get(dependency) ?? []), path]);
  let order = 0;
  const sections = decisions.sections.map((section, sectionIndex) => ({
    order: sectionIndex + 1,
    title: section.title,
    summary: section.summary,
    files: section.files.map((path) => {
      const { unit, file } = byPath.get(path);
      const { patch, omitted } = reviewPatch(file.patch, unit.hunks);
      const explanation = { ...explanations[path] };
      if (kindOf(path) === 'code' && file.status.startsWith('A') && !explanation.before) explanation.before = 'Não existia.';
      const formatHunks = unit.hunks?.filter((hunk) => hunk.visibility === 'collapsed') ?? [];
      return {
        order: ++order,
        id: file.id,
        status: file.status,
        path,
        kind: kindOf(path),
        dependsOn: [...dependencies.get(path)].filter((dependency) => inSections.has(dependency)).sort(),
        usedBy: [...new Set(usedBy.get(path) ?? [])].sort(),
        explanation,
        ...(unit.symbols?.length ? { symbols: unit.symbols } : {}),
        ...(omitted ? { omittedHunks: { count: omitted, reason: `trecho(s) só de formatação: ${[...new Set(formatHunks.flatMap((hunk) => hunk.evidence))].join('; ')}` } } : {}),
        patch,
      };
    }),
  }));
  const noise = [
    ...autoNoise.map(({ unit, file, path }) => ({ id: file.id, status: file.status, path, source: 'smart-diff', rule: unit.classifications[0].ruleId, reason: autoNoiseReason(unit) })),
    ...[...judgmentNoise].map(([path, reason]) => {
      const { file } = byPath.get(path);
      return { id: file.id, status: file.status, path, source: 'judgment', reason };
    }),
  ].sort((a, b) => Number(a.id.split(':')[1]) - Number(b.id.split(':')[1]));
  const output = {
    schemaVersion: 2,
    comparison: report.comparison,
    source: {
      tool: 'smart-diff',
      reportSha256: sha(readFileSync(reportPath, 'utf8')),
      decisionsSha256: sha(readFileSync(decisionsPath, 'utf8')),
    },
    readingGuide: 'Seções em ordem de leitura. Dentro e entre seções, todo arquivo vem depois dos arquivos alterados de que depende (dependsOn). Em explanation, before/after descreve a lógica alterada, tests resume o que o teste garante e, em docs e configs, after resume o conteúdo.',
    stats: { totalFiles: report.files.length, reviewFiles: order, noiseFiles: noise.length },
    sections,
    noise,
    warnings: report.warnings,
  };
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);

  if (cachePath) {
    const cache = readCache(cachePath);
    for (const [path, entry] of byPath) {
      const key = cacheKey(entry.file);
      if (inSections.has(path)) cache.entries[key] = { explanation: explanations[path] };
      else if (judgmentNoise.has(path)) cache.entries[key] = { noise: judgmentNoise.get(path) };
    }
    writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  }
  process.stdout.write(`${outPath}: ${order} arquivo(s) em ${sections.length} seção(ões) · ${noise.length} ruído(s) (${autoNoise.length} do smart-diff, ${judgmentNoise.size} por julgamento)\n`);
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'prepare' && args.length >= 2) prepare(args[0], args[1], option(args, '--cache'));
  else if (command === 'assemble' && args.length >= 3) assemble(args[0], args[1], args[2], option(args, '--cache'));
  else { process.stderr.write(`${usage}\n`); process.exitCode = 2; }
} catch (error) {
  process.stderr.write(`review.mjs: ${error.message}\n`);
  process.exitCode = 1;
}
