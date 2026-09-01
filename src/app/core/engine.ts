/**
 * Scenario engine — framework-free on purpose.
 *
 * Everything here is pure functions over plain data: no Angular, no RxJS, no DOM. The only
 * thing injected is a `SendFn`, so the same engine runs in the browser today and under Node
 * in CI later without a rewrite.
 */

import {
  CapturedRequest,
  CapturedResponse,
  ExpectDef,
  RequestDef,
  RunResult,
  ScenarioDef,
  StepDef,
  StepResult,
  TokenSlot,
} from './models';

export type Vars = Record<string, unknown>;

/** Supplied by the host: performs one HTTP call and reports what came back. */
export type SendFn = (req: CapturedRequest) => Promise<CapturedResponse>;

/** Builds a request body that is too dynamic to express as literal JSON. */
export type BodyBuilder = (args: Record<string, unknown>, vars: Vars) => unknown;

export interface EngineOptions {
  baseUrl: string;
  environment: string;
  /** slot -> bearer token. 'none' and 'garbage' are handled internally. */
  tokens: Partial<Record<TokenSlot, string>>;
  builders: Record<string, BodyBuilder>;
  send: SendFn;
  /** Called after each step so a UI can render progressively. */
  onStep?: (result: StepResult, run: RunResult) => void;
  /** Return a reason to refuse the request, or null to allow it (prod write guard). */
  guard?: (req: RequestDef) => string | null;
  /** Operator-supplied values, merged over the seeds before the first step. */
  initialVars?: Vars;
}

// --------------------------------------------------------------- variables

/** Values every scenario can rely on without declaring them. */
export function seedVariables(now = new Date()): Vars {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const daysInMonth = new Date(y, m, 0).getDate();
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return {
    year: y,
    month: m,
    daysInMonth,
    today: `${y}-${pad(m)}-${pad(now.getDate())}`,
    todayDay: now.getDate(),
    firstOfMonth: `${y}-${pad(m)}-01`,
    lastOfMonth: `${y}-${pad(m)}-${pad(daysInMonth)}`,
    nextMonthYear: m === 12 ? y + 1 : y,
    nextMonth: m === 12 ? 1 : m + 1,
    unknownId: 999999999,
    stamp: `${y}${pad(m)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
  };
}

/**
 * Recomputes the month-derived dates after operator input.
 *
 * Without this, choosing a plan month of next March would leave firstOfMonth pointing at
 * the real current month, and every date in the payload would fall outside the plan — the
 * scenario would fail for a reason that has nothing to do with what it is testing.
 */
export function deriveMonthVariables(vars: Vars): Vars {
  const y = Number(vars['year']);
  const m = Number(vars['month']);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return vars;
  }
  const pad = (n: number) => `${n}`.padStart(2, '0');
  const daysInMonth = new Date(y, m, 0).getDate();
  vars['daysInMonth'] = daysInMonth;
  vars['firstOfMonth'] = `${y}-${pad(m)}-01`;
  vars['midOfMonth'] = `${y}-${pad(m)}-15`;
  vars['lastOfMonth'] = `${y}-${pad(m)}-${pad(daysInMonth)}`;
  vars['nextMonthYear'] = m === 12 ? y + 1 : y;
  vars['nextMonth'] = m === 12 ? 1 : m + 1;
  return vars;
}

const TEMPLATE = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Substitutes {{vars}} through any structure. A string that is *entirely* one placeholder
 * keeps the variable's real type — so {{planId}} stays a number rather than becoming "31".
 */
export function resolve(value: unknown, vars: Vars): unknown {
  if (typeof value === 'string') {
    const whole = /^\{\{\s*([\w.]+)\s*\}\}$/.exec(value);
    if (whole) {
      return readPath(vars, whole[1]);
    }
    return value.replace(TEMPLATE, (_m, name: string) => {
      const v = readPath(vars, name);
      return v === undefined || v === null ? '' : String(v);
    });
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolve(v, vars));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolve(v, vars);
    }
    return out;
  }
  return value;
}

/** Reads "data.items[0].id" out of a parsed response or a variable bag. */
export function readPath(source: unknown, path: string): unknown {
  if (source === null || source === undefined || !path) {
    return undefined;
  }
  let cur: any = source;
  // Split on dots and [n], tolerating either casing of the first segment because the API
  // returns `status` on success and `Status` on the error envelope.
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  for (const part of parts) {
    if (cur === null || cur === undefined) {
      return undefined;
    }
    if (Array.isArray(cur)) {
      cur = cur[Number(part)];
      continue;
    }
    if (typeof cur === 'object') {
      const key = part in cur ? part : alternateCase(part, cur);
      cur = key === null ? undefined : cur[key];
      continue;
    }
    return undefined;
  }
  return cur;
}

function alternateCase(part: string, obj: Record<string, unknown>): string | null {
  const lower = part.charAt(0).toLowerCase() + part.slice(1);
  const upper = part.charAt(0).toUpperCase() + part.slice(1);
  if (lower in obj) return lower;
  if (upper in obj) return upper;
  return null;
}

// ----------------------------------------------------------------- envelope

/**
 * The MSFA envelope arrives with a lowercase first letter on success and an uppercase one on
 * the error path. Read both rather than trusting either.
 */
export function readEnvelope(parsed: any): { status: string | null; statusCode: number | null } {
  if (!parsed || typeof parsed !== 'object') {
    return { status: null, statusCode: null };
  }
  const status = parsed.status ?? parsed.Status ?? null;
  const codeRaw = parsed.statusCode ?? parsed.StatusCode ?? null;
  return {
    status: status === null || status === undefined ? null : String(status),
    statusCode: codeRaw === null || codeRaw === undefined ? null : Number(codeRaw),
  };
}

/** The API's `data` payload, whichever casing came back. */
export function envelopeData(parsed: any): unknown {
  if (!parsed || typeof parsed !== 'object') {
    return parsed;
  }
  if ('data' in parsed) return parsed.data;
  if ('Data' in parsed) return parsed.Data;
  return parsed;
}

// -------------------------------------------------------------- assertions

export function assertExpectations(
  expect: ExpectDef | undefined,
  res: CapturedResponse
): { ok: boolean; detail: string } {
  const seen: string[] = [`HTTP=${res.httpStatus ?? 'n/a'}`];
  if (res.envelopeStatus) seen.push(`envelope=${res.envelopeStatus}`);
  if (res.envelopeStatusCode !== null) seen.push(`code=${res.envelopeStatusCode}`);

  if (res.transportError && !res.parsed) {
    return { ok: false, detail: `transport error: ${res.transportError}` };
  }
  if (!expect) {
    // No declared expectation: anything that is not an error envelope counts as a pass.
    const ok = res.envelopeStatusCode === null || res.envelopeStatusCode < 400;
    return { ok, detail: seen.join('; ') };
  }

  const problems: string[] = [];
  if (expect.httpStatus !== undefined && res.httpStatus !== expect.httpStatus) {
    problems.push(`expected HTTP ${expect.httpStatus}`);
  }
  if (
    expect.envelopeStatus !== undefined &&
    (res.envelopeStatus ?? '').toLowerCase() !== expect.envelopeStatus.toLowerCase()
  ) {
    problems.push(`expected envelope ${expect.envelopeStatus}`);
  }
  if (expect.envelopeStatusCode !== undefined && res.envelopeStatusCode !== expect.envelopeStatusCode) {
    problems.push(`expected code ${expect.envelopeStatusCode}`);
  }
  if (expect.nonEmpty) {
    const v = readPath(res.parsed, expect.nonEmpty);
    const empty = v === undefined || v === null || (Array.isArray(v) && v.length === 0);
    if (empty) {
      problems.push(`expected ${expect.nonEmpty} to be non-empty`);
    }
  }

  return problems.length
    ? { ok: false, detail: `${seen.join('; ')} (${problems.join(', ')})` }
    : { ok: true, detail: seen.join('; ') };
}

// ------------------------------------------------------------------- runner

export function buildRequest(
  def: RequestDef,
  vars: Vars,
  opts: Pick<EngineOptions, 'baseUrl' | 'tokens' | 'builders'>
): CapturedRequest {
  const path = String(resolve(def.path, vars));
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (def.as === 'garbage') {
    headers['Authorization'] = 'Bearer not-a-valid-jwt';
  } else if (def.as !== 'none') {
    const token = opts.tokens[def.as];
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }
  if (def.mobileHeader) {
    headers['Platform'] = 'Mobile';
  }

  let body: unknown = undefined;
  if (def.bodyFrom) {
    const builder = opts.builders[def.bodyFrom];
    if (!builder) {
      throw new Error(`No body builder registered called "${def.bodyFrom}"`);
    }
    body = builder(resolve(def.bodyArgs ?? {}, vars) as Record<string, unknown>, vars);
  } else if (def.body !== undefined) {
    body = resolve(def.body, vars);
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  return { method: def.method, url: `${opts.baseUrl}${path}`, headers, body };
}

export async function runScenario(scenario: ScenarioDef, opts: EngineOptions): Promise<RunResult> {
  const vars: Vars = deriveMonthVariables({ ...seedVariables(), ...(opts.initialVars ?? {}) });
  const run: RunResult = {
    scenarioId: scenario.id,
    module: scenario.module,
    path: scenario.path,
    title: scenario.title,
    environment: opts.environment,
    startedAtIso: new Date().toISOString(),
    steps: [],
    variables: vars,
    passed: 0,
    failed: 0,
    skipped: 0,
  };

  for (const step of scenario.steps) {
    const result = await runStep(step, vars, opts);
    run.steps.push(result);
    if (result.outcome === 'pass') run.passed++;
    else if (result.outcome === 'fail') run.failed++;
    else run.skipped++;

    opts.onStep?.(result, run);

    if (result.outcome === 'fail' && step.critical) {
      // A critical failure invalidates everything downstream. Record the rest as skipped
      // rather than letting them quietly disappear from the report.
      for (const rest of scenario.steps.slice(scenario.steps.indexOf(step) + 1)) {
        const skipped: StepResult = {
          stepId: rest.id,
          title: rest.title,
          note: rest.note,
          outcome: 'skipped',
          detail: `not run — "${step.title}" failed and is critical`,
          startedAtIso: new Date().toISOString(),
        };
        run.steps.push(skipped);
        run.skipped++;
        opts.onStep?.(skipped, run);
      }
      break;
    }
  }

  run.finishedAtIso = new Date().toISOString();
  return run;
}

export async function runStep(step: StepDef, vars: Vars, opts: EngineOptions): Promise<StepResult> {
  const startedAtIso = new Date().toISOString();

  const missing = (step.requiresVars ?? []).filter((v) => {
    const value = vars[v];
    return value === undefined || value === null || value === '';
  });
  if (missing.length) {
    return {
      stepId: step.id,
      title: step.title,
      note: step.note,
      outcome: 'skipped',
      detail: `not run — missing ${missing.join(', ')} from an earlier step`,
      startedAtIso,
    };
  }

  const blocked = opts.guard?.(step.request) ?? null;
  if (blocked) {
    return {
      stepId: step.id,
      title: step.title,
      note: step.note,
      outcome: 'blocked',
      detail: blocked,
      startedAtIso,
    };
  }

  let request: CapturedRequest;
  try {
    request = buildRequest(step.request, vars, opts);
  } catch (e: any) {
    return {
      stepId: step.id,
      title: step.title,
      note: step.note,
      outcome: 'fail',
      detail: `could not build the request: ${e?.message ?? e}`,
      startedAtIso,
    };
  }

  const response = await opts.send(request);
  const { ok, detail } = assertExpectations(step.expect, response);

  const captured: Record<string, unknown> = {};
  for (const [name, path] of Object.entries(step.capture ?? {})) {
    const value = readPath(response.parsed, path);
    if (value !== undefined) {
      vars[name] = value;
      captured[name] = value;
    }
  }

  return {
    stepId: step.id,
    title: step.title,
    note: step.note,
    outcome: ok ? 'pass' : 'fail',
    detail,
    request,
    response,
    captured,
    startedAtIso,
  };
}
