#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(THIS_FILE), '..', '..');
const PLAN_RELATIVE_PATH = '总功能开发计划0.4.md';
const CATALOG_RELATIVE_PATH = 'shared/acceptance-cases/cases.json';
const TRACE_DIRECTORY = 'shared/traceability';
const GENERATOR_RELATIVE_PATH = 'shared/tests/validate-traceability.mjs';

const MIRROR_PATHS = Object.freeze({
  requirements: `${TRACE_DIRECTORY}/requirements.json`,
  tasks: `${TRACE_DIRECTORY}/tasks.json`,
  decisions: `${TRACE_DIRECTORY}/decisions.json`,
  evidence: `${TRACE_DIRECTORY}/evidence-index.json`,
});

const EXPECTED_COUNTS = Object.freeze({
  requirements: 74,
  cases: 153,
  tasks: 63,
  decisions: 29,
  questions: 7,
  risks: 20,
  debts: 7,
  changes: 7,
  governance: 70,
  evidence: 38,
  catalogCases: 59,
});

const EXPECTED_SELECTOR_COUNTS = Object.freeze({
  G1_COMMON_B_ONLY: 13,
  G2_VERTICAL_SLICE_B_ONLY: 17,
  RELEASE_0_1_MUST: 124,
  RELEASE_0_2_MUST: 152,
});

const REQUIRED_DOC04_REQUIREMENT_IDS = Object.freeze([
  'REQ-SOURCE-001',
  'REQ-RESEARCH-001',
  'REQ-RESEARCH-002',
]);

const FIXED_FULL_CASE_RESPONSIBILITIES = Object.freeze({
  'X-GATE-001': 'G1_COMMON_B_ONLY',
  'B-SLICE-001': 'G2_VERTICAL_SLICE_B_ONLY',
  'X-GATE-002': 'G2_VERTICAL_SLICE_B_ONLY',
  'SEL-RELEASE-001': 'RELEASE_0_1_MUST',
  'SEL-RELEASE-002': 'RELEASE_0_2_MUST',
});

const LEGACY_FULL_CASE_EVIDENCE_TASKS = new Set(['B-FND-001', 'C-FND-001']);

const TASK_ID_PATTERN = /^(?:A|B|C|SH|X|SEL|DOC)-[A-Z0-9-]+$/;
const REQUIREMENT_ID_PATTERN = /^REQ-[A-Z0-9-]+$/;
const CASE_ID_PATTERN = /^CASE-[A-Z0-9-]+$/;
const EVIDENCE_ID_PATTERN = /^EV-\d{8}-\d{3}$/;
const GOVERNANCE_ID_PATTERN = /^(?:DEC|Q|RISK|DEBT)-\d{3}$|^CHG-\d{8}-\d{3}$/;
const FORMAL_PREFIX_PATTERN = /^(?:REQ|CASE|EV|DEC|Q|RISK|DEBT|CHG|A|B|C|SH|X|SEL|DOC)-/;

export class TraceabilityError extends Error {
  constructor(code, detail) {
    super(`${code}:${detail}`);
    this.name = 'TraceabilityError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, detail) {
  throw new TraceabilityError(code, detail);
}

function requireTrace(condition, code, detail) {
  if (!condition) fail(code, detail);
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function ordinalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function stripMarkdown(value) {
  return value.replaceAll('`', '').trim();
}

function parseMarkdownRow(line, label) {
  requireTrace(line.startsWith('|') && line.endsWith('|'), 'TRACE_TABLE_ROW_INVALID', label);
  return line.slice(1, -1).split('|').map((value) => value.trim());
}

function extractCodeTokens(value) {
  return [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function isFormalId(value) {
  return TASK_ID_PATTERN.test(value)
    || REQUIREMENT_ID_PATTERN.test(value)
    || CASE_ID_PATTERN.test(value)
    || EVIDENCE_ID_PATTERN.test(value)
    || GOVERNANCE_ID_PATTERN.test(value);
}

function validateFormalCodeTokens(cells, label) {
  const ids = [];
  for (const cell of cells) {
    for (const token of extractCodeTokens(cell)) {
      if (isFormalId(token)) {
        ids.push(token);
      } else if (FORMAL_PREFIX_PATTERN.test(token) && /[/、,，]/.test(token)) {
        fail('TRACE_COMPOSITE_ID', `${label}:${token}`);
      }
    }
  }
  return [...new Set(ids)];
}

function exactCodeId(cell, pattern, label) {
  const match = cell.match(/^`([^`]+)`$/);
  requireTrace(match && pattern.test(match[1]), 'TRACE_ID_INVALID', `${label}:${cell}`);
  return match[1];
}

function requireUnique(records, label) {
  const seen = new Set();
  for (const record of records) {
    requireTrace(!seen.has(record.id), 'TRACE_DUPLICATE_ID', `${label}:${record.id}`);
    seen.add(record.id);
  }
}

function parseBracketIds(value, prefix, label) {
  const match = value.match(new RegExp(`${prefix}\\[([^\\]]*)\\]`));
  requireTrace(match, 'TRACE_TASK_SCOPE_INVALID', `${label}:${prefix}`);
  if (match[1].trim() === '') return [];
  const ids = match[1].split(',').map((item) => item.trim());
  const pattern = prefix === 'R' ? REQUIREMENT_ID_PATTERN : CASE_ID_PATTERN;
  for (const id of ids) requireTrace(pattern.test(id), 'TRACE_ID_INVALID', `${label}:${id}`);
  requireTrace(new Set(ids).size === ids.length, 'TRACE_DUPLICATE_REFERENCE', `${label}:${prefix}`);
  return ids;
}

function dispositionToStage(disposition) {
  if (disposition === '0.1 必须') return 'PRODUCT-0.1';
  if (disposition === '0.2 必须') return 'PRODUCT-0.2';
  if (disposition === '明确排除') return 'EXCLUDED';
  fail('TRACE_REQUIREMENT_DISPOSITION_INVALID', disposition);
}

function dispositionToStatus(disposition) {
  return disposition === '明确排除' ? 'approved_exclusion' : 'approved_active';
}

function extractSelector(planText, name) {
  const match = planText.match(new RegExp(`^${name}=\\[([^\\]]*)\\]$`, 'm'));
  requireTrace(match, 'TRACE_SELECTOR_MISSING', name);
  const values = match[1].split(',').map((value) => value.trim()).filter(Boolean);
  requireTrace(values.every((value) => CASE_ID_PATTERN.test(value)), 'TRACE_SELECTOR_ID_INVALID', name);
  requireTrace(new Set(values).size === values.length, 'TRACE_SELECTOR_DUPLICATE', name);
  return values;
}

function validateSelectorCountProse(planText) {
  const patterns = [
    /RELEASE_0_1_MUST=(\d+)[^\n]*RELEASE_0_2_MUST=(\d+)/g,
    /G3-0\.1累计(\d+)案、G3-0\.2累计(\d+)案/g,
    /(\d+)\/(\d+)发布选择器/g,
    /不把(\d+)或(\d+)个B发布案例复制进C\[\]/g,
  ];
  for (const pattern of patterns) {
    const claims = [...planText.matchAll(pattern)];
    requireTrace(claims.length > 0, 'TRACE_SELECTOR_PROSE_MISSING', pattern.source);
    for (const claim of claims) {
      const release01 = Number(claim[1]);
      const release02 = Number(claim[2]);
      requireTrace(
        release01 === EXPECTED_SELECTOR_COUNTS.RELEASE_0_1_MUST
          && release02 === EXPECTED_SELECTOR_COUNTS.RELEASE_0_2_MUST,
        'TRACE_SELECTOR_PROSE_COUNT_MISMATCH',
        `${release01}/${release02}`,
      );
    }
  }
}

function readTaskBrief(projectRoot, taskId, briefTextByTask = {}) {
  const candidates = [
    `docs/work-items/${taskId}-v2-brief.md`,
    `docs/work-items/${taskId}-brief.md`,
  ];
  const relativePath = candidates.find((candidate) => fs.existsSync(path.join(projectRoot, candidate)));
  if (!relativePath) {
    return { relativePath: null, text: null };
  }
  const text = Object.hasOwn(briefTextByTask, taskId)
    ? briefTextByTask[taskId]
    : fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
  requireTrace(typeof text === 'string', 'TRACE_ACTIVE_TASK_BRIEF_OVERRIDE_INVALID', taskId);
  return { relativePath, text };
}

function parseCaseAssertionMetadata(projectRoot, taskId, briefTextByTask = {}) {
  const { relativePath, text } = readTaskBrief(projectRoot, taskId, briefTextByTask);
  if (!relativePath) return { brief_path: null, case_assertion_paths: {}, full_case_set: null, active_fields: null };
  const lines = text.split(/\r?\n/);
  const assertions = {};
  const start = lines.findIndex((line) => line.trim() === 'case_assertion_paths:');
  if (start >= 0) {
    let currentCase = null;
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\s*$/.test(line)) continue;
      const caseMatch = line.match(/^  (CASE-[A-Z0-9-]+):\s*$/);
      if (caseMatch) {
        currentCase = caseMatch[1];
        assertions[currentCase] = [];
        continue;
      }
      const pathMatch = line.match(/^    -\s+(.+?)\s*$/);
      if (pathMatch && currentCase) {
        assertions[currentCase].push(stripMarkdown(pathMatch[1]));
        continue;
      }
      if (!/^\s/.test(line)) break;
      fail('TRACE_BRIEF_ASSERTION_INVALID', `${taskId}:line=${index + 1}`);
    }
  }

  let fullCaseSet = null;
  for (const line of lines) {
    const match = line.match(/^(?:-\s+)?`?full_case_set`?:\s+`?([^`\s]+)`?\s*$/);
    if (match) fullCaseSet = match[1];
  }

  return {
    brief_path: relativePath,
    case_assertion_paths: assertions,
    full_case_set: fullCaseSet,
    active_fields: parseActiveTaskFields(text, taskId),
  };
}

function parseActiveTaskFields(text, taskId) {
  const match = text.match(/```json trace-active-task\r?\n([\s\S]*?)\r?\n```/);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]);
    requireTrace(value && typeof value === 'object' && !Array.isArray(value), 'TRACE_ACTIVE_TASK_BRIEF_INVALID', taskId);
    return value;
  } catch (error) {
    if (error instanceof TraceabilityError) throw error;
    fail('TRACE_ACTIVE_TASK_BRIEF_INVALID', taskId);
  }
}

function requireString(value, taskId, field) {
  requireTrace(typeof value === 'string' && value.trim() !== '', 'TRACE_ACTIVE_TASK_BRIEF_FIELD_MISSING', `${taskId}:${field}`);
}

function requireStringArray(value, taskId, field, { allowEmpty = false } = {}) {
  requireTrace(Array.isArray(value) && (allowEmpty || value.length > 0), 'TRACE_ACTIVE_TASK_BRIEF_FIELD_MISSING', `${taskId}:${field}`);
  requireTrace(value.every((item) => typeof item === 'string' && item.trim() !== ''), 'TRACE_ACTIVE_TASK_BRIEF_FIELD_INVALID', `${taskId}:${field}`);
  requireTrace(new Set(value).size === value.length, 'TRACE_ACTIVE_TASK_BRIEF_FIELD_INVALID', `${taskId}:${field}:duplicate`);
}

function requireExactArray(actual, expected, taskId, field) {
  requireStringArray(actual, taskId, field, { allowEmpty: expected.length === 0 });
  requireTrace(JSON.stringify(actual) === JSON.stringify(expected), 'TRACE_ACTIVE_TASK_BRIEF_MISMATCH', `${taskId}:${field}`);
}

function parseActiveOracleCaseIds(text, taskId) {
  const start = text.indexOf('## 完整验收 Oracle');
  const end = text.indexOf('## 交付物', start);
  requireTrace(start >= 0 && end > start, 'TRACE_ACTIVE_TASK_BRIEF_FIELD_MISSING', `${taskId}:acceptance_oracle`);
  const rows = text.slice(start, end).split(/\r?\n/).filter((line) => /^\| `CASE-[A-Z0-9-]+` \|/.test(line));
  return rows.map((line) => {
    const cells = parseMarkdownRow(line, `${taskId}:acceptance_oracle`);
    requireTrace(cells.length === 4, 'TRACE_ACTIVE_TASK_BRIEF_FIELD_INVALID', `${taskId}:acceptance_oracle`);
    const caseId = exactCodeId(cells[0], CASE_ID_PATTERN, `${taskId}:acceptance_oracle`);
    requireTrace(cells.slice(1).every((cell) => stripMarkdown(cell) !== ''), 'TRACE_ACTIVE_TASK_BRIEF_FIELD_INVALID', `${taskId}:acceptance_oracle:${caseId}`);
    return caseId;
  });
}

function validateActiveTaskBrief(task, metadata, projectRoot, planText, text) {
  const { id, cells, requirementIdsForTask, caseIdsForTask, dependencyTaskIds, dependencyEvidenceIds, evidenceIds, status } = task;
  if (status !== '进行中' || caseIdsForTask.length === 0) return;
  const active = metadata.active_fields;
  requireTrace(active, 'TRACE_ACTIVE_TASK_BRIEF_FIELD_MISSING', `${id}:trace-active-task`);
  for (const field of [
    'task_id', 'product_scope', 'milestone', 'task_kind', 'route', 'objective', 'owner', 'reviewer',
    'status', 'blocker', 'next_action', 'reopen_condition', 'project_root', 'plugin_root', 'node_exe',
  ]) requireString(active[field], id, field);
  for (const field of [
    'requirement_ids', 'case_ids', 'dependency_task_ids', 'dependency_evidence_ids', 'deliverables',
    'verification_commands', 'acceptance_oracle_case_ids', 'required_evidence_types', 'actual_evidence_ids',
    'risk_ids', 'decision_ids', 'change_ids', 'official_data_roots', 'isolated_test_roots',
  ]) requireStringArray(active[field], id, field, { allowEmpty: ['dependency_evidence_ids', 'actual_evidence_ids'].includes(field) });

  requireTrace(active.task_id === id, 'TRACE_ACTIVE_TASK_BRIEF_MISMATCH', `${id}:task_id`);
  const [milestone, kind] = stripMarkdown(cells[1]).split('/');
  requireTrace(active.milestone === milestone && active.task_kind === kind, 'TRACE_ACTIVE_TASK_BRIEF_MISMATCH', `${id}:milestone_task_kind`);
  requireTrace(active.route === 'B', 'TRACE_ACTIVE_TASK_BRIEF_MISMATCH', `${id}:route`);
  requireTrace(active.objective === stripMarkdown(cells[2].replace(/；R\[[^\]]*\]；C\[[^\]]*\](?:；NA=[^（;；]+(?:（[^）]+）)?)?/, '')), 'TRACE_ACTIVE_TASK_BRIEF_MISMATCH', `${id}:objective`);
  requireExactArray(active.requirement_ids, requirementIdsForTask, id, 'requirement_ids');
  requireExactArray(active.case_ids, caseIdsForTask, id, 'case_ids');
  requireExactArray(active.dependency_task_ids, dependencyTaskIds, id, 'dependency_task_ids');
  requireExactArray(active.dependency_evidence_ids, dependencyEvidenceIds, id, 'dependency_evidence_ids');
  requireExactArray(active.deliverables, [stripMarkdown(cells[4])], id, 'deliverables');
  requireExactArray(active.acceptance_oracle_case_ids, caseIdsForTask, id, 'acceptance_oracle_case_ids');
  requireExactArray(parseActiveOracleCaseIds(text, id), caseIdsForTask, id, 'acceptance_oracle_rows');
  requireTrace(metadata.full_case_set !== null, 'TRACE_ACTIVE_TASK_BRIEF_FIELD_MISSING', `${id}:full_case_set`);
  requireTrace(active.forbidden_oracle_enforced === true, 'TRACE_ACTIVE_TASK_BRIEF_FIELD_INVALID', `${id}:forbidden_oracle_enforced`);
  requireExactArray(active.required_evidence_types, stripMarkdown(cells[5]).match(/E-[A-Z]+/g) ?? [], id, 'required_evidence_types');
  requireExactArray(active.actual_evidence_ids, evidenceIds, id, 'actual_evidence_ids');
  requireTrace(`${active.owner} / ${active.reviewer}` === stripMarkdown(cells[8]), 'TRACE_ACTIVE_TASK_BRIEF_MISMATCH', `${id}:owner_reviewer`);
  requireTrace(active.status === status, 'TRACE_ACTIVE_TASK_BRIEF_MISMATCH', `${id}:status`);
  requireTrace(stripMarkdown(cells[10]).includes(active.next_action) && stripMarkdown(cells[10]).includes(active.reopen_condition), 'TRACE_ACTIVE_TASK_BRIEF_MISMATCH', `${id}:next_reopen`);

  for (const [field, pattern] of [['risk_ids', /^RISK-\d{3}$/], ['decision_ids', /^DEC-\d{3}$/], ['change_ids', /^CHG-\d{8}-\d{3}$/]]) {
    requireTrace(active[field].every((value) => pattern.test(value)), 'TRACE_ACTIVE_TASK_BRIEF_FIELD_INVALID', `${id}:${field}`);
    for (const value of active[field]) {
      requireTrace(planText.split(/\r?\n/).some((line) => line.startsWith(`| \`${value}\` |`)), 'TRACE_ORPHAN_REFERENCE', `${id}:${value}`);
    }
  }
  for (const field of ['project_root', 'plugin_root', 'node_exe']) {
    requireTrace(path.win32.isAbsolute(active[field]), 'TRACE_ACTIVE_TASK_BRIEF_PATH_INVALID', `${id}:${field}`);
  }
  requireTrace(path.resolve(active.project_root) === path.resolve(projectRoot), 'TRACE_ACTIVE_TASK_BRIEF_MISMATCH', `${id}:project_root`);
  requireTrace(path.resolve(active.plugin_root) === path.resolve(projectRoot, 'version-b-lite-plugin'), 'TRACE_ACTIVE_TASK_BRIEF_MISMATCH', `${id}:plugin_root`);
  requireTrace(fs.existsSync(active.node_exe) && fs.lstatSync(active.node_exe).isFile(), 'TRACE_ACTIVE_TASK_BRIEF_PATH_INVALID', `${id}:node_exe`);
  for (const field of ['official_data_roots', 'isolated_test_roots']) {
    requireTrace(active[field].every((value) => path.win32.isAbsolute(value) && value.includes(id)), 'TRACE_ACTIVE_TASK_BRIEF_PATH_INVALID', `${id}:${field}`);
  }
  requireTrace(active.official_data_roots.every((value) => value.includes('official-manifest-sentinel')), 'TRACE_ACTIVE_TASK_BRIEF_PATH_INVALID', `${id}:official_data_roots`);
  requireTrace(active.verification_commands.length === 8, 'TRACE_ACTIVE_TASK_BRIEF_FIELD_INVALID', `${id}:verification_commands`);
  const projectLocationIndex = active.verification_commands.indexOf('Set-Location -LiteralPath $projectRoot');
  const rootGateIndex = active.verification_commands.findIndex((command) => command.includes('validate-sel-pantry-roots.mjs'));
  const pluginLocationIndex = active.verification_commands.indexOf('Set-Location -LiteralPath $pluginRoot');
  const pluginCommandIndexes = active.verification_commands
    .map((command, index) => ({ command, index }))
    .filter(({ command }) => command.includes('node_modules/'))
    .map(({ index }) => index);
  requireTrace(projectLocationIndex === 0, 'TRACE_ACTIVE_TASK_BRIEF_COMMAND_INVALID', `${id}:project_location`);
  requireTrace(rootGateIndex > projectLocationIndex
    && active.verification_commands[rootGateIndex].includes('$officialVerificationRoot')
    && active.verification_commands[rootGateIndex].includes('$isolatedTestRootBase'),
  'TRACE_ACTIVE_TASK_BRIEF_COMMAND_INVALID', `${id}:root_gate`);
  requireTrace(pluginLocationIndex > rootGateIndex
    && pluginCommandIndexes.length >= 3
    && pluginCommandIndexes.every((index) => index > pluginLocationIndex),
  'TRACE_ACTIVE_TASK_BRIEF_COMMAND_INVALID', `${id}:plugin_location`);
  const humanText = text.replace(/```json trace-active-task\r?\n[\s\S]*?\r?\n```/, '');
  const exactBindings = [
    ['$nodeExe', active.node_exe],
    ['$projectRoot', active.project_root],
    ['$pluginRoot', active.plugin_root],
    ['$officialVerificationRoot', active.official_data_roots[0]],
    ['$isolatedTestRootBase', active.isolated_test_roots[0]],
  ];
  for (const [variable, value] of exactBindings) {
    requireTrace(humanText.includes(`${variable} = '${value}'`), 'TRACE_ACTIVE_TASK_BRIEF_FIELD_MISSING', `${id}:binding:${variable}`);
  }
  for (const command of active.verification_commands) {
    requireTrace(humanText.includes(command), 'TRACE_ACTIVE_TASK_BRIEF_FIELD_MISSING', `${id}:verification_command`);
  }
  for (const caseId of caseIdsForTask) {
    requireTrace(text.includes(`| \`${caseId}\` |`), 'TRACE_ACTIVE_TASK_BRIEF_FIELD_MISSING', `${id}:oracle:${caseId}`);
  }
}

function parseRequirements(planText, catalog) {
  const rows = planText.split(/\r?\n/).filter((line) => /^\| `REQ-[A-Z0-9-]+` \|/.test(line));
  const requirements = rows.map((line) => {
    const cells = parseMarkdownRow(line, 'requirement');
    requireTrace(cells.length === 6, 'TRACE_REQUIREMENT_ROW_INVALID', line);
    const id = exactCodeId(cells[0], REQUIREMENT_ID_PATTERN, 'requirement');
    const references = validateFormalCodeTokens(cells, id).filter((value) => value !== id);
    const caseIds = extractCodeTokens(cells[5]).filter((value) => CASE_ID_PATTERN.test(value));
    requireTrace(caseIds.length > 0, 'TRACE_REQUIREMENT_CASES_MISSING', id);
    requireTrace(new Set(caseIds).size === caseIds.length, 'TRACE_DUPLICATE_REFERENCE', `${id}:cases`);
    const disposition = cells[1];
    return {
      id,
      stage: dispositionToStage(disposition),
      status: dispositionToStatus(disposition),
      disposition,
      title: stripMarkdown(cells[2]),
      source: stripMarkdown(cells[3]),
      contract_version: 'CONTRACT-v2',
      normative_sections: stripMarkdown(cells[4]),
      case_ids: caseIds,
      reference_ids: references.filter((value) => !CASE_ID_PATTERN.test(value)),
    };
  });

  requireUnique(requirements, 'requirements');
  requireTrace(requirements.length === EXPECTED_COUNTS.requirements, 'TRACE_REQUIREMENT_COUNT', `${requirements.length}`);
  const requirementIds = new Set(requirements.map((requirement) => requirement.id));
  for (const requirementId of REQUIRED_DOC04_REQUIREMENT_IDS) {
    requireTrace(requirementIds.has(requirementId), 'TRACE_REQUIRED_REQUIREMENT_MISSING', requirementId);
  }

  const caseMap = new Map();
  for (const requirement of requirements) {
    for (const caseId of requirement.case_ids) {
      if (!caseMap.has(caseId)) caseMap.set(caseId, { requirement_ids: [], stages: [] });
      const row = caseMap.get(caseId);
      row.requirement_ids.push(requirement.id);
      if (!row.stages.includes(requirement.stage)) row.stages.push(requirement.stage);
    }
  }
  requireTrace(caseMap.size === EXPECTED_COUNTS.cases, 'TRACE_CASE_COUNT', `${caseMap.size}`);

  requireTrace(catalog && Array.isArray(catalog.cases), 'TRACE_CASE_CATALOG_INVALID', CATALOG_RELATIVE_PATH);
  requireTrace(catalog.version === '1.6.0', 'TRACE_CASE_CATALOG_VERSION', String(catalog.version));
  requireTrace(catalog.cases.length === EXPECTED_COUNTS.catalogCases, 'TRACE_CASE_CATALOG_COUNT', `${catalog.cases.length}`);
  const catalogMap = new Map();
  for (const item of catalog.cases) {
    requireTrace(CASE_ID_PATTERN.test(item.id), 'TRACE_CASE_CATALOG_ID_INVALID', String(item.id));
    requireTrace(!catalogMap.has(item.id), 'TRACE_DUPLICATE_ID', `catalog:${item.id}`);
    requireTrace(caseMap.has(item.id), 'TRACE_CASE_CATALOG_ORPHAN', item.id);
    requireTrace(Array.isArray(item.requirement_ids), 'TRACE_CASE_CATALOG_REQUIREMENTS_INVALID', item.id);
    for (const requirementId of item.requirement_ids) {
      requireTrace(requirements.some((row) => row.id === requirementId), 'TRACE_ORPHAN_REFERENCE', `${item.id}:${requirementId}`);
    }
    catalogMap.set(item.id, item.requirement_ids.slice());
  }

  const excluded = extractSelector(planText, 'B_RELEASE_EXCLUDED');
  const g1 = extractSelector(planText, 'G1_COMMON_B_ONLY');
  const g2 = extractSelector(planText, 'G2_VERTICAL_SLICE_B_ONLY');
  for (const [name, values] of Object.entries({ G1_COMMON_B_ONLY: g1, G2_VERTICAL_SLICE_B_ONLY: g2 })) {
    requireTrace(values.length === EXPECTED_SELECTOR_COUNTS[name], 'TRACE_SELECTOR_COUNT', `${name}:${values.length}`);
    for (const caseId of values) requireTrace(caseMap.has(caseId), 'TRACE_ORPHAN_REFERENCE', `${name}:${caseId}`);
  }
  requireTrace(excluded.length === 1 && excluded[0] === 'CASE-STORAGE-003', 'TRACE_SELECTOR_EXCLUSION_INVALID', excluded.join(','));

  const release01 = [...caseMap.entries()]
    .filter(([, value]) => value.stages.includes('PRODUCT-0.1') || value.stages.includes('EXCLUDED'))
    .map(([id]) => id)
    .filter((id) => !excluded.includes(id))
    .sort();
  const release02 = [...caseMap.entries()]
    .filter(([, value]) => value.stages.some((stage) => ['PRODUCT-0.1', 'PRODUCT-0.2', 'EXCLUDED'].includes(stage)))
    .map(([id]) => id)
    .filter((id) => !excluded.includes(id))
    .sort();
  requireTrace(release01.length === EXPECTED_SELECTOR_COUNTS.RELEASE_0_1_MUST, 'TRACE_SELECTOR_COUNT', `RELEASE_0_1_MUST:${release01.length}`);
  requireTrace(release02.length === EXPECTED_SELECTOR_COUNTS.RELEASE_0_2_MUST, 'TRACE_SELECTOR_COUNT', `RELEASE_0_2_MUST:${release02.length}`);
  requireTrace(release01.includes('CASE-SCOPE-001'), 'TRACE_SELECTOR_REQUIRED_CASE_MISSING', 'RELEASE_0_1_MUST:CASE-SCOPE-001');
  requireTrace(!release02.includes('CASE-STORAGE-003'), 'TRACE_SELECTOR_EXCLUSION_INVALID', 'RELEASE_0_2_MUST');

  const cases = [...caseMap.entries()].sort(([left], [right]) => ordinalCompare(left, right)).map(([id, value]) => ({
    id,
    requirement_ids: value.requirement_ids.slice().sort(),
    stages: value.stages.slice().sort(),
    shared_catalog_status: catalogMap.has(id) ? 'implemented_static_oracle' : 'planned',
    shared_catalog_requirement_ids: catalogMap.get(id)?.slice().sort() ?? [],
  }));

  return {
    requirements,
    cases,
    caseIds: new Set(cases.map((row) => row.id)),
    selectors: {
      G1_COMMON_B_ONLY: g1,
      G2_VERTICAL_SLICE_B_ONLY: g2,
      B_RELEASE_EXCLUDED: excluded,
      RELEASE_0_1_MUST: release01,
      RELEASE_0_2_MUST: release02,
    },
    catalog: {
      path: CATALOG_RELATIVE_PATH,
      version: catalog.version,
      case_count: catalog.cases.length,
    },
  };
}

function parseTasks(planText, projectRoot, requirementIds, caseIds, selectors, briefTextByTask = {}) {
  const sectionStart = planText.indexOf('### 31.3 ');
  requireTrace(sectionStart >= 0, 'TRACE_TASK_SECTION_MISSING', '31.3');
  const rows = planText.slice(sectionStart).split(/\r?\n/)
    .filter((line) => /^\| `(?:A|B|C|SH|X|SEL|DOC)-[A-Z0-9-]+` \|/.test(line));
  const tasks = rows.map((line) => {
    const cells = parseMarkdownRow(line, 'task');
    requireTrace(cells.length === 11, 'TRACE_TASK_ROW_INVALID', line);
    const id = exactCodeId(cells[0], TASK_ID_PATTERN, 'task');
    validateFormalCodeTokens(cells, id);
    const requirementIdsForTask = parseBracketIds(cells[2], 'R', id);
    const caseIdsForTask = parseBracketIds(cells[2], 'C', id);
    for (const requirementId of requirementIdsForTask) {
      requireTrace(requirementIds.has(requirementId), 'TRACE_ORPHAN_REFERENCE', `${id}:${requirementId}`);
    }
    for (const caseId of caseIdsForTask) {
      requireTrace(caseIds.has(caseId), 'TRACE_ORPHAN_REFERENCE', `${id}:${caseId}`);
    }
    const dependencyTokens = extractCodeTokens(cells[3]);
    const dependencyTaskIds = dependencyTokens.filter((value) => TASK_ID_PATTERN.test(value));
    const dependencyEvidenceIds = dependencyTokens.filter((value) => EVIDENCE_ID_PATTERN.test(value));
    const evidenceIds = extractCodeTokens(cells[7]).filter((value) => EVIDENCE_ID_PATTERN.test(value));
    const status = cells[9];
    requireTrace(['已完成', '进行中', '未开始', '已取消'].includes(status), 'TRACE_TASK_STATUS_INVALID', `${id}:${status}`);
    const naMatch = cells[2].match(/NA=([a-z_]+)/);
    if (requirementIdsForTask.length === 0 && caseIdsForTask.length === 0) {
      requireTrace(naMatch, 'TRACE_TASK_GOVERNANCE_MARKER_MISSING', id);
    }
    const assertionMetadata = parseCaseAssertionMetadata(projectRoot, id, briefTextByTask);
    for (const assertionCaseId of Object.keys(assertionMetadata.case_assertion_paths)) {
      requireTrace(caseIdsForTask.includes(assertionCaseId), 'TRACE_BRIEF_CASE_NOT_CLAIMED', `${id}:${assertionCaseId}`);
      const values = assertionMetadata.case_assertion_paths[assertionCaseId];
      requireTrace(values.length > 0 && new Set(values).size === values.length, 'TRACE_BRIEF_ASSERTION_INVALID', `${id}:${assertionCaseId}`);
      for (const value of values) {
        const isJsonPointer = value === '*' || value.startsWith('/');
        const isRepositoryArtifact = !path.isAbsolute(value)
          && !value.includes('..')
          && !value.includes('\\')
          && fs.existsSync(path.join(projectRoot, value));
        requireTrace(isJsonPointer || isRepositoryArtifact, 'TRACE_BRIEF_ASSERTION_PATH_INVALID', `${id}:${assertionCaseId}:${value}`);
        requireTrace(!value.includes('..') && !value.includes('\\'), 'TRACE_BRIEF_ASSERTION_PATH_INVALID', `${id}:${assertionCaseId}:${value}`);
      }
    }
    const covered = caseIdsForTask.length > 0
      && caseIdsForTask.every((caseId) => Object.hasOwn(assertionMetadata.case_assertion_paths, caseId));
    let assertionState = 'not_applicable';
    if (caseIdsForTask.length > 0 && covered) assertionState = 'declared';
    else if (caseIdsForTask.length > 0 && status === '已完成' && evidenceIds.length > 0 && LEGACY_FULL_CASE_EVIDENCE_TASKS.has(id)) assertionState = 'legacy_evidence_migration';
    else if (caseIdsForTask.length > 0) assertionState = 'brief_pending';

    requireTaskAssertionState(caseIdsForTask, status, assertionState, id);
    validateActiveTaskBrief({
      id, cells, requirementIdsForTask, caseIdsForTask, dependencyTaskIds, dependencyEvidenceIds, evidenceIds, status,
    }, assertionMetadata, projectRoot, planText, assertionMetadata.brief_path ? readTaskBrief(projectRoot, id, briefTextByTask).text : '');

    return {
      id,
      milestone_type_scope: stripMarkdown(cells[1]),
      objective: stripMarkdown(cells[2].replace(/；R\[[^\]]*\]；C\[[^\]]*\](?:；NA=[^（;；]+(?:（[^）]+）)?)?/, '')),
      requirement_ids: requirementIdsForTask,
      case_ids: caseIdsForTask,
      na_reason: naMatch?.[1] ?? null,
      dependency_task_ids: dependencyTaskIds,
      dependency_evidence_ids: dependencyEvidenceIds,
      deliverables: stripMarkdown(cells[4]),
      verification: stripMarkdown(cells[5]),
      roots: stripMarkdown(cells[6]),
      actual_evidence_ids: evidenceIds,
      owner_reviewer: stripMarkdown(cells[8]),
      status,
      next_reopen: stripMarkdown(cells[10]),
      brief_path: assertionMetadata.brief_path,
      case_assertion_paths: assertionMetadata.case_assertion_paths,
      full_case_set: assertionMetadata.full_case_set,
      assertion_state: assertionState,
    };
  });

  requireUnique(tasks, 'tasks');
  requireTrace(tasks.length === EXPECTED_COUNTS.tasks, 'TRACE_TASK_COUNT', `${tasks.length}`);
  const taskIds = new Set(tasks.map((task) => task.id));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    for (const dependencyId of task.dependency_task_ids) {
      requireTrace(taskIds.has(dependencyId), 'TRACE_ORPHAN_REFERENCE', `${task.id}:${dependencyId}`);
      requireTrace(dependencyId !== task.id, 'TRACE_TASK_SELF_DEPENDENCY', task.id);
    }
    if (task.status === '已完成') {
      requireTrace(task.actual_evidence_ids.length > 0, 'TRACE_COMPLETED_TASK_EVIDENCE_MISSING', task.id);
    }
    if (task.status === '进行中') {
      for (const dependencyId of task.dependency_task_ids) {
        requireTrace(tasksById.get(dependencyId)?.status === '已完成', 'TRACE_ACTIVE_TASK_DEPENDENCY_NOT_COMPLETE', `${task.id}:${dependencyId}`);
      }
    }
  }

  const taskCaseUnion = new Set(tasks.flatMap((task) => task.case_ids));
  const onlyInRequirements = [...caseIds].filter((caseId) => !taskCaseUnion.has(caseId)).sort();
  const onlyInTasks = [...taskCaseUnion].filter((caseId) => !caseIds.has(caseId)).sort();
  requireTrace(onlyInRequirements.length === 0 && onlyInTasks.length === 0, 'TRACE_CASE_UNION_MISMATCH', JSON.stringify({ onlyInRequirements, onlyInTasks }));

  const caseProducerMatrix = [...caseIds].sort().map((caseId) => {
    const producers = tasks.filter((task) => task.case_ids.includes(caseId)).map((task) => ({
      task_id: task.id,
      task_status: task.status,
      assertion_state: task.assertion_state,
      assertion_paths: task.case_assertion_paths[caseId] ?? [],
    }));
    requireTrace(producers.length > 0, 'TRACE_CASE_PRODUCER_MISSING', caseId);
    return { case_id: caseId, producers };
  });

  requireTrace(planText.includes('`B-SLICE-001`和`X-GATE-002=G2_VERTICAL_SLICE_B_ONLY`'), 'TRACE_FULL_CASE_OWNER_DECLARATION_INVALID', 'G2');
  const fullCaseResponsibilities = Object.entries(FIXED_FULL_CASE_RESPONSIBILITIES).map(([taskId, selector]) => {
    requireTrace(taskIds.has(taskId), 'TRACE_ORPHAN_REFERENCE', `full_case:${taskId}`);
    requireTrace(Array.isArray(selectors[selector]), 'TRACE_SELECTOR_MISSING', selector);
    return { task_id: taskId, selector, case_ids: selectors[selector] };
  });
  const fullCaseResponsibilityMatrix = [...caseIds].sort().map((caseId) => {
    const assignments = fullCaseResponsibilities
      .filter((row) => row.case_ids.includes(caseId))
      .map((row) => ({ task_id: row.task_id, selector: row.selector }));
    if (caseId === 'CASE-STORAGE-003') {
      requireTrace(assignments.length === 0, 'TRACE_EXCLUDED_CASE_HAS_FULL_OWNER', caseId);
      return { case_id: caseId, assignments: [], exclusion: 'B_RELEASE_EXCLUDED' };
    }
    requireTrace(assignments.length > 0, 'TRACE_FULL_CASE_OWNER_MISSING', caseId);
    return { case_id: caseId, assignments, exclusion: null };
  });

  const statusCounts = {};
  for (const task of tasks) statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1;
  const dashboardExpected = {
    已完成: statusCounts['已完成'] ?? 0,
    进行中: statusCounts['进行中'] ?? 0,
    未开始: statusCounts['未开始'] ?? 0,
  };
  for (const [label, count] of Object.entries(dashboardExpected)) {
    const match = planText.match(new RegExp(`^\\| ${label} \\| (\\d+) \\|`, 'm'));
    requireTrace(match && Number(match[1]) === count, 'TRACE_DASHBOARD_COUNT_MISMATCH', `${label}:expected=${count}:actual=${match?.[1] ?? 'missing'}`);
  }
  const cancelledMatch = planText.match(/^\| 阻塞\/已取消 \| \d+\/(\d+) \|/m);
  requireTrace(cancelledMatch && Number(cancelledMatch[1]) === (statusCounts['已取消'] ?? 0), 'TRACE_DASHBOARD_COUNT_MISMATCH', '已取消');

  return { tasks, taskIds, caseProducerMatrix, fullCaseResponsibilities, fullCaseResponsibilityMatrix, statusCounts };
}

function requireTaskAssertionState(caseIdsForTask, status, assertionState, id) {
  if (caseIdsForTask.length > 0 && status === '已完成') {
    requireTrace(assertionState !== 'brief_pending', 'TRACE_COMPLETED_TASK_ASSERTIONS_MISSING', id);
  }
  if (caseIdsForTask.length > 0 && status === '进行中') {
    requireTrace(assertionState !== 'brief_pending', 'TRACE_ACTIVE_TASK_ASSERTIONS_MISSING', id);
  }
}

const GOVERNANCE_SHAPES = Object.freeze({
  DEC: ['id', 'options', 'decision', 'references', 'replaces', 'reopen_condition'],
  Q: ['id', 'question', 'status_owner', 'task', 'next_action', 'evidence'],
  RISK: ['id', 'risk', 'status_owner', 'task', 'mitigation', 'evidence'],
  DEBT: ['id', 'debt', 'status_owner', 'task', 'exit_evidence'],
  CHG: ['id', 'source_change', 'impact', 'owner_approver', 'tasks', 'status_evidence'],
});

function governanceKind(id) {
  return id.startsWith('CHG-') ? 'CHG' : id.split('-')[0];
}

function parseGovernance(planText) {
  const rows = planText.split(/\r?\n/).filter((line) => /^\| `(?:DEC|Q|RISK|DEBT|CHG)-/.test(line));
  const records = rows.map((line) => {
    const cells = parseMarkdownRow(line, 'governance');
    const rawId = cells[0].match(/^`([^`]+)`$/)?.[1];
    requireTrace(rawId && GOVERNANCE_ID_PATTERN.test(rawId), 'TRACE_ID_INVALID', String(rawId));
    const kind = governanceKind(rawId);
    const fieldNames = GOVERNANCE_SHAPES[kind];
    requireTrace(cells.length === fieldNames.length, 'TRACE_GOVERNANCE_ROW_INVALID', rawId);
    const formalIds = validateFormalCodeTokens(cells, rawId).filter((value) => value !== rawId);
    const record = { id: rawId, kind, reference_ids: formalIds };
    for (let index = 1; index < fieldNames.length; index += 1) record[fieldNames[index]] = stripMarkdown(cells[index]);
    return record;
  });
  requireUnique(records, 'governance');
  const counts = {
    DEC: records.filter((record) => record.kind === 'DEC').length,
    Q: records.filter((record) => record.kind === 'Q').length,
    RISK: records.filter((record) => record.kind === 'RISK').length,
    DEBT: records.filter((record) => record.kind === 'DEBT').length,
    CHG: records.filter((record) => record.kind === 'CHG').length,
  };
  requireTrace(counts.DEC === EXPECTED_COUNTS.decisions, 'TRACE_GOVERNANCE_COUNT', `DEC:${counts.DEC}`);
  requireTrace(counts.Q === EXPECTED_COUNTS.questions, 'TRACE_GOVERNANCE_COUNT', `Q:${counts.Q}`);
  requireTrace(counts.RISK === EXPECTED_COUNTS.risks, 'TRACE_GOVERNANCE_COUNT', `RISK:${counts.RISK}`);
  requireTrace(counts.DEBT === EXPECTED_COUNTS.debts, 'TRACE_GOVERNANCE_COUNT', `DEBT:${counts.DEBT}`);
  requireTrace(counts.CHG === EXPECTED_COUNTS.changes, 'TRACE_GOVERNANCE_COUNT', `CHG:${counts.CHG}`);
  requireTrace(records.length === EXPECTED_COUNTS.governance, 'TRACE_GOVERNANCE_COUNT', `all:${records.length}`);
  return { records, counts, ids: new Set(records.map((record) => record.id)) };
}

function parseEvidence(planText, projectRoot) {
  const rows = planText.split(/\r?\n/).filter((line) => /^\| `EV-\d{8}-\d{3}` \|/.test(line));
  const records = rows.map((line) => {
    const cells = parseMarkdownRow(line, 'evidence');
    requireTrace(cells.length === 4, 'TRACE_EVIDENCE_ROW_INVALID', line);
    const id = exactCodeId(cells[0], EVIDENCE_ID_PATTERN, 'evidence');
    const referenceIds = validateFormalCodeTokens(cells, id).filter((value) => value !== id);
    return {
      id,
      scope: stripMarkdown(cells[1]),
      result: stripMarkdown(cells[2]),
      limitation: stripMarkdown(cells[3]),
      reference_ids: referenceIds,
    };
  });
  requireUnique(records, 'evidence');
  requireTrace(records.length === EXPECTED_COUNTS.evidence, 'TRACE_EVIDENCE_COUNT', `${records.length}`);
  const evidenceIds = new Set(records.map((record) => record.id));

  const evidenceDirectory = path.join(projectRoot, 'docs', 'evidence');
  const filesById = new Map();
  for (const entry of fs.readdirSync(evidenceDirectory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(/^(EV-\d{8}-\d{3})-[A-Za-z0-9._-]+\.md$/);
    if (!match) continue;
    requireTrace(evidenceIds.has(match[1]), 'TRACE_EVIDENCE_FILE_ORPHAN', entry.name);
    if (!filesById.has(match[1])) filesById.set(match[1], []);
    filesById.get(match[1]).push(entry.name);
  }

  for (const record of records) {
    const names = filesById.get(record.id) ?? [];
    if (['EV-20260809-001', 'EV-20260809-002'].includes(record.id)) {
      requireTrace(names.length === 0, 'TRACE_HISTORICAL_EVIDENCE_FILE_UNEXPECTED', record.id);
      record.file = null;
      record.file_status = 'historical_registry_only';
      continue;
    }
    requireTrace(names.length === 1, 'TRACE_EVIDENCE_FILE_COUNT', `${record.id}:${names.length}`);
    const relativePath = `docs/evidence/${names[0]}`;
    const absolutePath = path.join(projectRoot, relativePath);
    const fileStat = fs.lstatSync(absolutePath);
    requireTrace(fileStat.isFile() && !fileStat.isSymbolicLink(), 'TRACE_EVIDENCE_FILE_TYPE_INVALID', relativePath);
    const bytes = fs.readFileSync(absolutePath);
    record.file = {
      path: relativePath,
      length: bytes.length,
      sha256: sha256Bytes(bytes),
    };
    record.file_status = 'present';
  }
  return { records, evidenceIds };
}

function validateReferences(requirements, tasks, governance, evidence) {
  const master = new Set([
    ...requirements.requirements.map((record) => record.id),
    ...requirements.cases.map((record) => record.id),
    ...tasks.tasks.map((record) => record.id),
    ...governance.records.map((record) => record.id),
    ...evidence.records.map((record) => record.id),
  ]);
  for (const record of requirements.requirements) {
    for (const id of record.reference_ids) requireTrace(master.has(id), 'TRACE_ORPHAN_REFERENCE', `${record.id}:${id}`);
  }
  for (const task of tasks.tasks) {
    for (const id of [...task.dependency_task_ids, ...task.dependency_evidence_ids, ...task.actual_evidence_ids]) {
      requireTrace(master.has(id), 'TRACE_ORPHAN_REFERENCE', `${task.id}:${id}`);
    }
  }
  for (const record of governance.records) {
    for (const id of record.reference_ids) requireTrace(master.has(id), 'TRACE_ORPHAN_REFERENCE', `${record.id}:${id}`);
  }
  for (const record of evidence.records) {
    for (const id of record.reference_ids) requireTrace(master.has(id), 'TRACE_ORPHAN_REFERENCE', `${record.id}:${id}`);
  }

  const evidenceById = new Map(evidence.records.map((record) => [record.id, record]));
  for (const task of tasks.tasks.filter((row) => row.status === '已完成')) {
    for (const evidenceId of task.actual_evidence_ids) {
      const evidenceRecord = evidenceById.get(evidenceId);
      requireTrace(evidenceRecord, 'TRACE_ORPHAN_REFERENCE', `${task.id}:${evidenceId}`);
      requireTrace(evidenceRecord.file_status === 'present', 'TRACE_COMPLETED_TASK_EVIDENCE_STALE', `${task.id}:${evidenceId}`);
    }
  }
}

function sourceIdentity(projectRoot, planBytes, catalogBytes) {
  const generatorBytes = fs.readFileSync(path.join(projectRoot, GENERATOR_RELATIVE_PATH));
  return {
    plan: {
      path: PLAN_RELATIVE_PATH,
      length: planBytes.length,
      sha256: sha256Bytes(planBytes),
    },
    acceptance_catalog: {
      path: CATALOG_RELATIVE_PATH,
      length: catalogBytes.length,
      sha256: sha256Bytes(catalogBytes),
    },
    generator: {
      path: GENERATOR_RELATIVE_PATH,
      length: generatorBytes.length,
      sha256: sha256Bytes(generatorBytes),
    },
  };
}

export function buildTraceability(projectRoot = PROJECT_ROOT, overrides = {}) {
  const planPath = path.join(projectRoot, PLAN_RELATIVE_PATH);
  const catalogPath = path.join(projectRoot, CATALOG_RELATIVE_PATH);
  const planBytes = overrides.planText === undefined
    ? fs.readFileSync(planPath)
    : Buffer.from(overrides.planText, 'utf8');
  const catalogBytes = overrides.catalog === undefined
    ? fs.readFileSync(catalogPath)
    : Buffer.from(JSON.stringify(overrides.catalog), 'utf8');
  const planText = planBytes.toString('utf8');
  requireTrace(!planText.includes('\r'), 'TRACE_PLAN_LINE_ENDING_INVALID', PLAN_RELATIVE_PATH);
  requireTrace(planText.includes('CONTRACT-v2'), 'TRACE_CONTRACT_VERSION_MISSING', 'CONTRACT-v2');
  const catalog = overrides.catalog ?? JSON.parse(catalogBytes.toString('utf8'));

  const requirements = parseRequirements(planText, catalog);
  validateSelectorCountProse(planText);
  const requirementIds = new Set(requirements.requirements.map((row) => row.id));
  const tasks = parseTasks(planText, projectRoot, requirementIds, requirements.caseIds, requirements.selectors, overrides.briefTextByTask ?? {});
  const governance = parseGovernance(planText);
  const evidence = parseEvidence(planText, projectRoot);
  validateReferences(requirements, tasks, governance, evidence);

  const source = sourceIdentity(projectRoot, planBytes, fs.readFileSync(catalogPath));
  const evidenceTaskReferences = new Map(evidence.records.map((record) => [record.id, []]));
  for (const task of tasks.tasks) {
    for (const evidenceId of task.actual_evidence_ids) evidenceTaskReferences.get(evidenceId)?.push(task.id);
  }

  const mirrors = {
    requirements: {
      schema_version: 'diet-manager/traceability-requirements/v1',
      generated_from: source,
      counts: {
        requirements: requirements.requirements.length,
        cases: requirements.cases.length,
        shared_catalog_cases: requirements.catalog.case_count,
      },
      selectors: requirements.selectors,
      requirements: requirements.requirements,
      cases: requirements.cases,
    },
    tasks: {
      schema_version: 'diet-manager/traceability-tasks/v1',
      generated_from: source,
      counts: {
        tasks: tasks.tasks.length,
        status: tasks.statusCounts,
        case_producer_rows: tasks.caseProducerMatrix.length,
        full_case_responsibility_assignments: tasks.fullCaseResponsibilities.length,
        full_case_responsibility_rows: tasks.fullCaseResponsibilityMatrix.length,
      },
      full_case_responsibilities: tasks.fullCaseResponsibilities,
      full_case_responsibility_matrix: tasks.fullCaseResponsibilityMatrix,
      case_producer_matrix: tasks.caseProducerMatrix,
      tasks: tasks.tasks,
    },
    decisions: {
      schema_version: 'diet-manager/traceability-decisions/v1',
      generated_from: source,
      counts: governance.counts,
      entries: governance.records,
    },
    evidence: {
      schema_version: 'diet-manager/traceability-evidence/v1',
      generated_from: source,
      counts: {
        evidence: evidence.records.length,
        files_present: evidence.records.filter((record) => record.file_status === 'present').length,
        historical_registry_only: evidence.records.filter((record) => record.file_status === 'historical_registry_only').length,
      },
      evidence: evidence.records.map((record) => ({
        ...record,
        referenced_by_task_ids: evidenceTaskReferences.get(record.id) ?? [],
      })),
    },
  };
  return { mirrors, summary: {
    requirements: requirements.requirements.length,
    cases: requirements.cases.length,
    tasks: tasks.tasks.length,
    governance: governance.records.length,
    evidence: evidence.records.length,
  } };
}

function mirrorBytes(mirrors) {
  return Object.fromEntries(Object.entries(mirrors).map(([name, value]) => [name, stableJson(value)]));
}

function assertMirrorsCurrent(projectRoot, mirrors) {
  const expected = mirrorBytes(mirrors);
  for (const [name, relativePath] of Object.entries(MIRROR_PATHS)) {
    const absolutePath = path.join(projectRoot, relativePath);
    requireTrace(fs.existsSync(absolutePath), 'TRACE_MIRROR_MISSING', relativePath);
    const actual = fs.readFileSync(absolutePath, 'utf8');
    requireTrace(actual === expected[name], 'TRACE_MIRROR_DRIFT', relativePath);
  }
}

function writeMirrors(projectRoot, mirrors) {
  const directory = path.join(projectRoot, TRACE_DIRECTORY);
  fs.mkdirSync(directory, { recursive: true });
  const expected = mirrorBytes(mirrors);
  for (const [name, relativePath] of Object.entries(MIRROR_PATHS)) {
    const target = path.join(projectRoot, relativePath);
    const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
    try {
      fs.writeFileSync(temporary, expected[name], { encoding: 'utf8', flag: 'wx' });
      requireTrace(fs.readFileSync(temporary, 'utf8') === expected[name], 'TRACE_ATOMIC_WRITE_VERIFY_FAILED', relativePath);
      fs.renameSync(temporary, target);
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    }
  }
  assertMirrorsCurrent(projectRoot, mirrors);
}

function expectFailure(code, action) {
  let observed = null;
  try {
    action();
  } catch (error) {
    if (error instanceof TraceabilityError) observed = error.code;
    else throw error;
  }
  assert.equal(observed, code, `expected ${code}, observed ${observed ?? 'none'}`);
}

function taskRowMutation(planText, taskId, mutateCells) {
  const lines = planText.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`| \`${taskId}\` |`));
  assert.notEqual(index, -1, `missing task row ${taskId}`);
  const cells = parseMarkdownRow(lines[index], taskId);
  mutateCells(cells);
  lines[index] = `| ${cells.join(' | ')} |`;
  return lines.join('\n');
}

export function runSelfTests(projectRoot = PROJECT_ROOT) {
  const planText = fs.readFileSync(path.join(projectRoot, PLAN_RELATIVE_PATH), 'utf8');
  const catalog = JSON.parse(fs.readFileSync(path.join(projectRoot, CATALOG_RELATIVE_PATH), 'utf8'));
  const baseline = buildTraceability(projectRoot);
  assert.deepEqual(baseline.summary, { requirements: 74, cases: 153, tasks: 63, governance: 70, evidence: 38 });
  assert.deepEqual(baseline.mirrors.tasks.counts.status, {
    '未开始': 23,
    '已完成': 31,
    '进行中': 1,
    '已取消': 8,
  });
  assert.deepEqual(
    baseline.mirrors.tasks.tasks.filter((task) => task.status === '进行中').map((task) => task.id),
    ['SEL-NUTR-001'],
  );
  const traceTask = baseline.mirrors.tasks.tasks.find((task) => task.id === 'SH-TRACE-001');
  assert.equal(traceTask?.status, '已完成');
  assert.deepEqual(traceTask?.actual_evidence_ids, ['EV-20260813-035']);
  const xGateTask = baseline.mirrors.tasks.tasks.find((task) => task.id === 'X-GATE-002');
  assert.equal(xGateTask?.status, '已完成');
  assert.deepEqual(xGateTask?.actual_evidence_ids, ['EV-20260813-036']);
  const coreTask = baseline.mirrors.tasks.tasks.find((task) => task.id === 'SEL-CORE-001');
  assert.equal(coreTask?.status, '已完成');
  assert.deepEqual(coreTask?.actual_evidence_ids, ['EV-20260813-037']);
  const pantryTask = baseline.mirrors.tasks.tasks.find((task) => task.id === 'SEL-PANTRY-001');
  assert.equal(pantryTask?.status, '已完成');
  assert.deepEqual(pantryTask?.actual_evidence_ids, ['EV-20260814-038']);
  const nutritionTask = baseline.mirrors.tasks.tasks.find((task) => task.id === 'SEL-NUTR-001');
  assert.equal(nutritionTask?.status, '进行中');
  const closureEvidence = baseline.mirrors.evidence.evidence.find((record) => record.id === 'EV-20260814-038');
  assert.equal(closureEvidence?.file_status, 'present');
  assert.equal(closureEvidence?.file?.path, 'docs/evidence/EV-20260814-038-sel-pantry-001.md');

  const planBytes = fs.readFileSync(path.join(projectRoot, PLAN_RELATIVE_PATH));
  const historicalPlanPath = '总功能开发计划0.3.md';
  const historicalPlanBytes = fs.readFileSync(path.join(projectRoot, historicalPlanPath));
  const expectedPlanIdentity = {
    path: '总功能开发计划0.4.md',
    length: planBytes.length,
    sha256: sha256Bytes(planBytes),
  };
  for (const [name, mirror] of Object.entries(baseline.mirrors)) {
    assert.deepEqual(mirror.generated_from.plan, expectedPlanIdentity, `${name} mirror has stale plan identity`);
    assert.notEqual(mirror.generated_from.plan.sha256, sha256Bytes(historicalPlanBytes), `${name} mirror still identifies DOC-0.3`);
  }

  expectFailure('TRACE_REQUIREMENT_COUNT', () => buildTraceability(projectRoot, {
    planText: historicalPlanBytes.toString('utf8'),
  }));

  expectFailure('TRACE_SELECTOR_PROSE_COUNT_MISMATCH', () => buildTraceability(projectRoot, {
    planText: planText.replace(
      'RELEASE_0_1_MUST=124',
      'RELEASE_0_1_MUST=121',
    ).replace(
      'RELEASE_0_2_MUST=152',
      'RELEASE_0_2_MUST=143',
    ),
  }));

  expectFailure('TRACE_SELECTOR_PROSE_COUNT_MISMATCH', () => buildTraceability(projectRoot, {
    planText: planText.replace(
      'G3-0.1累计124案、G3-0.2累计152案',
      'G3-0.1累计121案、G3-0.2累计143案',
    ),
  }));

  expectFailure('TRACE_SELECTOR_PROSE_COUNT_MISMATCH', () => buildTraceability(projectRoot, {
    planText: planText.replace('124/152发布选择器', '121/143发布选择器'),
  }));

  expectFailure('TRACE_SELECTOR_PROSE_COUNT_MISMATCH', () => buildTraceability(projectRoot, {
    planText: planText.replace('124或152个B发布案例', '121或143个B发布案例'),
  }));

  for (const requirementId of ['REQ-SOURCE-001', 'REQ-RESEARCH-001', 'REQ-RESEARCH-002']) {
    expectFailure('TRACE_REQUIRED_REQUIREMENT_MISSING', () => buildTraceability(projectRoot, {
      planText: planText.replace(`| \`${requirementId}\` |`, `| \`${requirementId}-MISSING\` |`),
    }));
  }

  const release01 = new Set(baseline.mirrors.requirements.selectors.RELEASE_0_1_MUST);
  for (const caseId of ['CASE-SOURCE-001', 'CASE-SOURCE-002', 'CASE-SOURCE-003']) {
    assert.equal(release01.has(caseId), true, `${caseId} missing from RELEASE_0_1_MUST`);
  }
  const release02 = new Set(baseline.mirrors.requirements.selectors.RELEASE_0_2_MUST);
  for (const caseId of [
    'CASE-RESEARCH-001',
    'CASE-RESEARCH-002',
    'CASE-RESEARCH-003',
    'CASE-RESEARCH-004',
    'CASE-RESEARCH-005',
    'CASE-RESEARCH-006',
  ]) {
    assert.equal(release02.has(caseId), true, `${caseId} missing from RELEASE_0_2_MUST`);
  }

  const firstRequirement = planText.split('\n').find((line) => line.startsWith('| `REQ-SCOPE-001` |'));
  expectFailure('TRACE_DUPLICATE_ID', () => buildTraceability(projectRoot, {
    planText: planText.replace(firstRequirement, `${firstRequirement}\n${firstRequirement}`),
  }));

  const orphanCasePlan = planText.split('\n').map((line) => (
    line.startsWith('| `REQ-SCOPE-001` |')
      ? line.replace('CASE-MEAL-011', 'CASE-ORPHAN-999')
      : line
  )).join('\n');
  expectFailure('TRACE_CASE_CATALOG_ORPHAN', () => buildTraceability(projectRoot, {
    planText: orphanCasePlan,
  }));

  const compositeEvidencePlan = planText.split('\n').map((line) => (
    line.startsWith('| `RISK-002` |')
      ? line.replace('`EV-20260811-013`、`EV-20260811-014`、`EV-20260811-015`', '`EV-20260811-013/014/015`')
      : line
  )).join('\n');
  expectFailure('TRACE_COMPOSITE_ID', () => buildTraceability(projectRoot, {
    planText: compositeEvidencePlan,
  }));

  expectFailure('TRACE_SELECTOR_COUNT', () => buildTraceability(projectRoot, {
    planText: planText.replace('G1_COMMON_B_ONLY=[CASE-STORAGE-001,', 'G1_COMMON_B_ONLY=['),
  }));

  expectFailure('TRACE_COMPLETED_TASK_EVIDENCE_MISSING', () => buildTraceability(projectRoot, {
    planText: taskRowMutation(planText, 'SH-HARNESS-001', (cells) => { cells[7] = '无'; }),
  }));

  expectFailure('TRACE_ORPHAN_REFERENCE', () => buildTraceability(projectRoot, {
    planText: taskRowMutation(planText, 'SH-TRACE-001', (cells) => { cells[3] += '、`B-NOT-REAL-999`'; }),
  }));

  const nutritionBriefPath = path.join(projectRoot, 'docs/work-items/SEL-NUTR-001-brief.md');
  const nutritionBriefText = fs.readFileSync(nutritionBriefPath, 'utf8');
  expectFailure('TRACE_ACTIVE_TASK_BRIEF_FIELD_MISSING', () => buildTraceability(projectRoot, {
    briefTextByTask: {
      'SEL-NUTR-001': nutritionBriefText.replace('  "owner": "Codex /root",\n', ''),
    },
  }));

  expectFailure('TRACE_ACTIVE_TASK_BRIEF_COMMAND_INVALID', () => buildTraceability(projectRoot, {
    briefTextByTask: {
      'SEL-NUTR-001': nutritionBriefText.replace(
        '    "Set-Location -LiteralPath $pluginRoot",\n',
        '    "Set-Location -LiteralPath $missingPluginRoot",\n',
      ),
    },
  }));

  const badCatalog = structuredClone(catalog);
  badCatalog.cases[0].id = 'CASE-ORPHAN-998';
  expectFailure('TRACE_CASE_CATALOG_ORPHAN', () => buildTraceability(projectRoot, { catalog: badCatalog }));

  const bytes = mirrorBytes(baseline.mirrors);
  assert.equal(bytes.requirements.includes(projectRoot), false, 'generated mirror leaked an absolute project path');
  assert.equal(bytes.tasks.includes('oracle"'), false, 'task mirror leaked an Oracle payload');
  return 17;
}

function printPass(mode, summary, mutations = null) {
  const fields = [
    'TRACEABILITY',
    'PASS',
    `mode=${mode}`,
    `requirements=${summary.requirements}`,
    `cases=${summary.cases}`,
    `tasks=${summary.tasks}`,
    `governance=${summary.governance}`,
    `evidence=${summary.evidence}`,
  ];
  if (mutations !== null) fields.push(`mutations=${mutations}`);
  process.stdout.write(`${fields.join('|')}\n`);
}

function main() {
  const args = new Set(process.argv.slice(2));
  const allowed = new Set(['--write', '--self-test']);
  for (const arg of args) requireTrace(allowed.has(arg), 'TRACE_ARGUMENT_INVALID', arg);
  const mutations = args.has('--self-test') ? runSelfTests(PROJECT_ROOT) : null;
  const result = buildTraceability(PROJECT_ROOT);
  if (args.has('--write')) writeMirrors(PROJECT_ROOT, result.mirrors);
  else assertMirrorsCurrent(PROJECT_ROOT, result.mirrors);
  printPass(args.has('--write') ? 'write' : 'validate', result.summary, mutations);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(THIS_FILE)) {
  try {
    main();
  } catch (error) {
    if (error instanceof TraceabilityError) {
      process.stderr.write(`TRACEABILITY|FAIL|code=${error.code}|detail=${error.detail}\n`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
