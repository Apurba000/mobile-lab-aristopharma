/**
 * Scenario model. Deliberately plain data with no Angular types — the engine that consumes
 * it is framework-free so the same JSON can be run by a Node CLI in CI later.
 */

export type TokenSlot = 'mio' | 'am' | 'rsm' | 'admin' | 'none' | 'garbage';
export type ScenarioPath = 'happy' | 'average' | 'worst';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RequestDef {
  method: HttpMethod;
  /** May contain {{variables}}. Always starts with /api/v1/app/... */
  path: string;
  /** Which token to send. 'none' omits it; 'garbage' sends a deliberately invalid one. */
  as: TokenSlot;
  /**
   * Send `Platform: Mobile`. With it the transport status is 200 even on errors and the real
   * code is in the envelope — which is exactly the behaviour most worth testing.
   */
  mobileHeader?: boolean;
  /** Literal body; string values may contain {{variables}}. */
  body?: unknown;
  /** Name of a registered builder to produce the body instead (see builders.ts). */
  bodyFrom?: string;
  /** Arguments for the builder; values may contain {{variables}}. */
  bodyArgs?: Record<string, unknown>;
}

export interface ExpectDef {
  /** Transport status. Usually 200 when mobileHeader is on, even for errors. */
  httpStatus?: number;
  /** Envelope `status`: Success | Error | ValidationError. */
  envelopeStatus?: string;
  /** Envelope `statusCode` — the code that actually matters on mobile. */
  envelopeStatusCode?: number;
  /** Path into the response that must be non-empty, e.g. "data.items". */
  nonEmpty?: string;
  /**
   * Response values that must match, e.g. { "data.status": 2 }. Compared as strings so a
   * decimal 2 from Oracle and a JSON 2 agree. This is what lets a scenario prove an outcome
   * — "the plan came back to Pending" — rather than merely that nothing errored.
   */
  equals?: Record<string, string | number>;
  /** Path that must be an empty array (or absent), e.g. "data" for a list that must come back []. */
  empty?: string;
  /**
   * Pairs [left, right] where left must be <= right. Each side is a response path or a number.
   * "[*]" on both sides compares item by item, e.g. ["data[*].issuedQty", "data[*].disbursedQty"].
   */
  lte?: [string, string][];
}

export interface StepDef {
  id: string;
  title: string;
  /** Free-text note shown in the run view — say *why* the step exists. */
  note?: string;
  request: RequestDef;
  /** variableName -> response path, e.g. { planId: 'data.id' } */
  capture?: Record<string, string>;
  expect?: ExpectDef;
  /** Skip the step unless every named variable is set (and truthy). */
  requiresVars?: string[];
  /**
   * Skip the step when any of these variables IS set — the inverse of requiresVars, for
   * "only do this if an earlier step did not already find one".
   */
  skipIfVars?: string[];
  /** A failure here stops the scenario; otherwise the run continues. */
  critical?: boolean;
}

/** A value the operator supplies before the run, e.g. which month to plan. */
export interface ScenarioInput {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select';
  /** May be a {{template}}, resolved against the seed variables. */
  default?: string | number;
  hint?: string;
  options?: { value: string | number; label: string }[];
}

export interface ScenarioDef {
  id: string;
  module: string;
  path: ScenarioPath;
  title: string;
  description?: string;
  /** Token slots that must be filled before this scenario can run. */
  requires: TokenSlot[];
  /** True if any step writes — used by the prod guard. */
  writes?: boolean;
  /** Prompted for before the run and merged over the seed variables. */
  inputs?: ScenarioInput[];
  steps: StepDef[];
}

/** One endpoint of the module's API surface and the statuses worth proving. */
export interface SurfaceEntry {
  endpoint: string;
  expect: number[];
  note?: string;
}

export interface ScenarioFile {
  module: string;
  label: string;
  /**
   * The endpoints this module exposes. Declared rather than inferred, so coverage can show
   * what has *not* been exercised — a matrix built only from calls already made can never
   * report a gap.
   */
  surface?: SurfaceEntry[];
  scenarios: ScenarioDef[];
}

// ---------------------------------------------------------------- run results

export interface CapturedRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface CapturedResponse {
  httpStatus: number | null;
  raw: string;
  parsed: any;
  envelopeStatus: string | null;
  envelopeStatusCode: number | null;
  elapsedMs: number;
  transportError?: string;
}

export type StepOutcome = 'pass' | 'fail' | 'skipped' | 'blocked';

export interface StepResult {
  stepId: string;
  title: string;
  note?: string;
  outcome: StepOutcome;
  /** Human-readable "expected X, got Y". */
  detail: string;
  request?: CapturedRequest;
  response?: CapturedResponse;
  captured?: Record<string, unknown>;
  startedAtIso: string;
}

export interface RunResult {
  scenarioId: string;
  module: string;
  path: ScenarioPath;
  title: string;
  environment: string;
  startedAtIso: string;
  finishedAtIso?: string;
  steps: StepResult[];
  variables: Record<string, unknown>;
  passed: number;
  failed: number;
  skipped: number;
}

// ------------------------------------------------------------------ mutators

export type MutatorKind =
  | 'omit'
  | 'nullify'
  | 'wrongType'
  | 'outOfRange'
  | 'unknownId'
  | 'noToken'
  | 'badToken'
  | 'duplicate';

export interface MutatorDef {
  kind: MutatorKind;
  /** Dotted path into the body, e.g. "terrId" or "dates[0].visits[0].doctorId". */
  field?: string;
  label: string;
  /** What the API should answer. */
  expect: ExpectDef;
}

// -------------------------------------------------------------- environments

export interface EnvDef {
  key: string;
  label: string;
  baseUrl: string;
  tone: 'safe' | 'caution' | 'danger';
  /** False for prod: non-GET is refused until explicitly unlocked. */
  writesAllowed: boolean;
}
