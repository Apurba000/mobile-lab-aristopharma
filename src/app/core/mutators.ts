/**
 * Worst-path generation.
 *
 * The reason this file exists: hand-writing a bad request for every failure mode is the slow,
 * error-prone part of API testing, and it is what makes Postman painful here. Instead we take
 * a step that is known to work and *derive* the broken variants from it, each carrying the
 * status the API ought to answer with.
 */

import { ExpectDef, MutatorDef, MutatorKind, StepDef } from './models';

/** On mobile the transport is always 200 and the real code sits in the envelope. */
export function expectFor(code: number, mobileHeader: boolean | undefined): ExpectDef {
  const envelopeStatus = code === 200 ? 'Success' : code === 400 ? 'ValidationError' : 'Error';
  return mobileHeader
    ? { httpStatus: 200, envelopeStatus, envelopeStatusCode: code }
    : { httpStatus: code, envelopeStatus };
}

// ------------------------------------------------------------- path editing

type Segment = { key: string; index?: number };

function parsePath(path: string): Segment[] {
  return path
    .split('.')
    .filter(Boolean)
    .map((raw) => {
      const m = /^([\w]+)\[(\d+)\]$/.exec(raw);
      return m ? { key: m[1], index: Number(m[2]) } : { key: raw };
    });
}

function walkToParent(body: any, segs: Segment[]): { parent: any; last: Segment } | null {
  let cur = body;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    if (cur === null || cur === undefined) return null;
    cur = cur[s.key];
    if (s.index !== undefined) {
      if (!Array.isArray(cur)) return null;
      cur = cur[s.index];
    }
  }
  return cur ? { parent: cur, last: segs[segs.length - 1] } : null;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/** Sets a dotted path, supporting arr[0] segments. Returns a new body. */
export function setAtPath(body: unknown, path: string, value: unknown): unknown {
  if (body === undefined || body === null) return body;
  const next = clone(body) as any;
  const found = walkToParent(next, parsePath(path));
  if (!found) return next;
  const { parent, last } = found;
  if (last.index !== undefined) {
    if (Array.isArray(parent[last.key])) {
      parent[last.key][last.index] = value;
    }
  } else {
    parent[last.key] = value;
  }
  return next;
}

/** Deletes a dotted path. Returns a new body. */
export function deleteAtPath(body: unknown, path: string): unknown {
  if (body === undefined || body === null) return body;
  const next = clone(body) as any;
  const found = walkToParent(next, parsePath(path));
  if (!found) return next;
  const { parent, last } = found;
  if (last.index !== undefined) {
    if (Array.isArray(parent[last.key])) {
      parent[last.key].splice(last.index, 1);
    }
  } else {
    delete parent[last.key];
  }
  return next;
}

// ---------------------------------------------------------------- mutators

/** The catalogue offered in the UI for a given step. */
export function catalogueFor(step: StepDef): MutatorDef[] {
  const mobile = step.request.mobileHeader;
  const out: MutatorDef[] = [
    { kind: 'noToken', label: 'No token', expect: expectFor(401, mobile) },
    { kind: 'badToken', label: 'Garbage token', expect: expectFor(401, mobile) },
  ];

  const body = step.request.body;
  if (body && typeof body === 'object') {
    for (const field of topLevelFields(body)) {
      out.push({ kind: 'omit', field, label: `Omit ${field}`, expect: expectFor(400, mobile) });
      out.push({ kind: 'nullify', field, label: `Null ${field}`, expect: expectFor(400, mobile) });
      out.push({
        kind: 'wrongType',
        field,
        label: `Wrong type for ${field}`,
        expect: expectFor(400, mobile),
      });
    }
  }

  if (step.request.method === 'POST') {
    out.push({ kind: 'duplicate', label: 'Replay (duplicate)', expect: expectFor(400, mobile) });
  }
  if (step.request.path.includes('{{') || /\/\d+/.test(step.request.path)) {
    out.push({
      kind: 'unknownId',
      label: 'Unknown id in the path',
      expect: expectFor(404, mobile),
    });
  }
  return out;
}

function topLevelFields(body: unknown): string[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  return Object.keys(body as Record<string, unknown>);
}

/** Applies one mutator, producing a derived step ready to run. */
export function applyMutator(step: StepDef, m: MutatorDef): StepDef {
  const derived: StepDef = {
    ...step,
    id: `${step.id}::${m.kind}${m.field ? ':' + m.field : ''}`,
    title: `${step.title} — ${m.label}`,
    note: `Derived from "${step.title}". Expecting ${describe(m.expect)}.`,
    capture: undefined,
    critical: false,
    expect: m.expect,
    request: { ...step.request },
  };

  switch (m.kind) {
    case 'noToken':
      derived.request.as = 'none';
      break;
    case 'badToken':
      derived.request.as = 'garbage';
      break;
    case 'omit':
      derived.request.body = deleteAtPath(step.request.body, m.field!);
      break;
    case 'nullify':
      derived.request.body = setAtPath(step.request.body, m.field!, null);
      break;
    case 'wrongType':
      derived.request.body = setAtPath(step.request.body, m.field!, { unexpected: 'object' });
      break;
    case 'outOfRange':
      derived.request.body = setAtPath(step.request.body, m.field!, 999999);
      break;
    case 'unknownId':
      derived.request.path = step.request.path.replace(/\/\d+/, '/999999999').replace(/\{\{\w+\}\}/, '999999999');
      break;
    case 'duplicate':
      // Same request again — the second one should hit a uniqueness guard.
      break;
  }
  return derived;
}

function describe(e: ExpectDef): string {
  const bits: string[] = [];
  if (e.envelopeStatusCode !== undefined) bits.push(`code ${e.envelopeStatusCode}`);
  else if (e.httpStatus !== undefined) bits.push(`HTTP ${e.httpStatus}`);
  if (e.envelopeStatus) bits.push(e.envelopeStatus);
  return bits.join(' / ') || 'a non-error response';
}

export const MUTATOR_HELP: Record<MutatorKind, string> = {
  omit: 'Drops a required field — the classic 400.',
  nullify: 'Sends null where a value is required.',
  wrongType: 'Sends an object where a scalar is expected; catches weak model binding.',
  outOfRange: 'A value outside the accepted range, e.g. month 13.',
  unknownId: 'An id that cannot exist, to prove 404 rather than 500.',
  noToken: 'No Authorization header at all.',
  badToken: 'A syntactically invalid bearer token.',
  duplicate: 'Replays a successful write to prove the uniqueness guard fires.',
};
