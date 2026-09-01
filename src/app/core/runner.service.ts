import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';

import { BUILDERS } from './builders';
import { EngineOptions, readEnvelope, runScenario, runStep, seedVariables, Vars } from './engine';
import { CapturedRequest, CapturedResponse, RunResult, ScenarioDef, StepDef, StepResult } from './models';
import { AuthService } from './auth.service';
import { EnvService } from './env.service';

/** Bridges the framework-free engine to Angular's HttpClient. */
@Injectable({ providedIn: 'root' })
export class RunnerService {
  history: RunResult[] = [];

  /**
   * endpoint -> status -> outcome, accumulated as steps complete.
   *
   * Held here rather than derived in the coverage component so that every call counts,
   * including one-off mutations and raw console requests, and so nothing depends on when
   * that component happens to be checked.
   */
  private coverage = new Map<string, Map<number, 'pass' | 'fail'>>();

  /** Bumped on any change at all, so views can tell cheaply that a rebuild is due. */
  coverageVersion = 0;
  /** Real calls recorded — never inflated by clearing, unlike coverageVersion. */
  recordedCalls = 0;

  /**
   * Coverage is per environment and survives reloads.
   *
   * Without persistence the tab is close to useless in practice: you reload, or the dev
   * server rebuilds, and everything you had exercised is gone. Keyed by environment so dev
   * and UAT results never blend into one misleading picture.
   */
  private hydratedFor: string | null = null;

  constructor(private http: HttpClient, private auth: AuthService, private env: EnvService) {}

  /**
   * Raw text is captured rather than parsed JSON so the response can be shown exactly as the
   * API sent it — including malformed bodies, which are themselves worth seeing.
   */
  /** A hung request must surface as a failed step, never as a frozen UI. */
  timeoutMs = 30000;

  send = async (req: CapturedRequest): Promise<CapturedResponse> => {
    const started = Date.now();
    try {
      const res = await firstValueFrom(
        this.http
          .request(req.method, req.url, {
            body: req.body,
            headers: new HttpHeaders(req.headers),
            observe: 'response',
            responseType: 'text',
          })
          .pipe(timeout(this.timeoutMs))
      );
      return this.capture(res.status, res.body ?? '', Date.now() - started);
    } catch (e) {
      if (e instanceof HttpErrorResponse) {
        const raw = typeof e.error === 'string' ? e.error : JSON.stringify(e.error ?? '');
        const note =
          e.status === 0
            ? 'Network or CORS failure — the request never reached the API.'
            : undefined;
        return this.capture(e.status, raw, Date.now() - started, note);
      }
      if (e instanceof TimeoutError) {
        return this.capture(
          0,
          '',
          Date.now() - started,
          `No response within ${this.timeoutMs / 1000}s — the request timed out.`
        );
      }
      return this.capture(0, '', Date.now() - started, String(e));
    }
  };

  private capture(
    status: number,
    raw: string,
    elapsedMs: number,
    transportError?: string
  ): CapturedResponse {
    let parsed: any = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    const env = readEnvelope(parsed);
    return {
      httpStatus: status || null,
      raw,
      parsed,
      envelopeStatus: env.status,
      envelopeStatusCode: env.statusCode,
      elapsedMs,
      transportError,
    };
  }

  private options(
    onStep?: (r: StepResult, run: RunResult) => void,
    initialVars?: Vars
  ): EngineOptions {
    return {
      initialVars,
      baseUrl: this.env.baseUrl,
      environment: this.env.current?.key ?? 'unknown',
      tokens: this.auth.tokens,
      builders: BUILDERS,
      send: this.send,
      guard: this.env.guard,
      onStep,
    };
  }

  /** Normalises a URL to an endpoint: ids collapsed, query dropped. */
  static endpointOf(method: string, url: string): string {
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    return `${method} ${path.replace(/\/\d+/g, '/{id}')}`;
  }

  private storageKey(): string {
    return `msfa-lab-coverage:${this.env.current?.key ?? 'unknown'}`;
  }

  /** Reloads from storage when the environment changes (or on first use). */
  private hydrate(): void {
    const key = this.env.current?.key ?? '';
    if (this.hydratedFor === key) return;
    this.hydratedFor = key;
    this.coverage = new Map();
    this.recordedCalls = 0;
    try {
      const raw = localStorage.getItem(this.storageKey());
      if (raw) {
        const saved = JSON.parse(raw) as {
          calls?: number;
          endpoints?: Record<string, Record<string, 'pass' | 'fail'>>;
        };
        this.recordedCalls = saved.calls ?? 0;
        for (const [endpoint, codes] of Object.entries(saved.endpoints ?? {})) {
          this.coverage.set(
            endpoint,
            new Map(Object.entries(codes).map(([c, v]) => [Number(c), v]))
          );
        }
      }
    } catch {
      /* corrupt or unavailable storage simply means starting from empty */
    }
    this.coverageVersion++;
  }

  private persist(): void {
    try {
      const endpoints: Record<string, Record<string, 'pass' | 'fail'>> = {};
      for (const [endpoint, codes] of this.coverage) {
        endpoints[endpoint] = Object.fromEntries([...codes].map(([c, v]) => [String(c), v]));
      }
      localStorage.setItem(
        this.storageKey(),
        JSON.stringify({ calls: this.recordedCalls, endpoints })
      );
    } catch {
      /* storage full or blocked - coverage just will not survive the reload */
    }
  }

  /** The accumulated matrix for the current environment. */
  getCoverage(): Map<string, Map<number, 'pass' | 'fail'>> {
    this.hydrate();
    return this.coverage;
  }

  endpointCount(): number {
    return this.getCoverage().size;
  }

  private record(step: StepResult): void {
    if (!step.request || !step.response) return;
    const code = step.response.envelopeStatusCode ?? step.response.httpStatus;
    if (code === null) return;

    this.hydrate();
    const endpoint = RunnerService.endpointOf(step.request.method, step.request.url);
    const row = this.coverage.get(endpoint) ?? new Map<number, 'pass' | 'fail'>();
    // A pass is never downgraded by a later failure of the same cell.
    if (row.get(code) !== 'pass') {
      row.set(code, step.outcome === 'pass' ? 'pass' : 'fail');
    }
    this.coverage.set(endpoint, row);
    this.recordedCalls++;
    this.coverageVersion++;
    this.persist();
  }

  clearCoverage(): void {
    this.hydrate();
    this.coverage.clear();
    this.history = [];
    this.recordedCalls = 0;
    this.coverageVersion++;
    this.persist();
  }

  async run(
    scenario: ScenarioDef,
    onStep?: (r: StepResult, run: RunResult) => void,
    initialVars?: Vars
  ): Promise<RunResult> {
    const wrapped = (r: StepResult, run: RunResult) => {
      this.record(r);
      onStep?.(r, run);
    };
    const result = await runScenario(scenario, this.options(wrapped, initialVars));
    this.history.unshift(result);
    this.history = this.history.slice(0, 50);
    // Prod writes are unlocked for one run only.
    this.env.relock();
    return result;
  }

  /** One-off step, used by mutators and the raw console. These count towards coverage too. */
  async runOne(step: StepDef, vars?: Vars): Promise<StepResult> {
    const result = await runStep(step, vars ?? seedVariables(), this.options());
    this.record(result);
    return result;
  }
}
