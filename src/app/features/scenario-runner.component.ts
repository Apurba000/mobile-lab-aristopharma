import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { EnvService } from '../core/env.service';
import { RunnerService } from '../core/runner.service';
import { ScenarioService } from '../core/scenario.service';
import { applyMutator, catalogueFor, MUTATOR_HELP } from '../core/mutators';
import { MutatorDef, RunResult, ScenarioDef, ScenarioInput, StepDef, StepResult } from '../core/models';
import { resolve, seedVariables } from '../core/engine';

@Component({
  selector: 'lab-scenario-runner',
  standalone: false,
  template: `
    <div class="grid">
      <!-- ---------------------------------------------------------- list -->
      <aside class="card list">
        <div class="card-head">
          <h2>Scenarios</h2>
          <span class="sub tiny muted">{{ totalScenarios() }} available</span>
        </div>

        <p class="small muted" *ngIf="!scenarios.files.length">No scenario files loaded.</p>

        <div *ngFor="let f of scenarios.files" class="module">
          <div class="eyebrow modname">{{ f.label }}</div>
          <button
            *ngFor="let s of f.scenarios"
            class="scenario"
            [class.on]="selected?.id === s.id"
            (click)="select(s)">
            <span class="pill" [ngClass]="s.path">{{ s.path }}</span>
            <span class="t">{{ s.title }}</span>
            <span class="meta tiny muted">
              {{ s.steps.length }} steps
              <span class="w" *ngIf="s.writes">· writes</span>
            </span>
            <span class="req tiny" *ngIf="!ready(s)">needs {{ missing(s) }}</span>
          </button>
        </div>
      </aside>

      <!-- -------------------------------------------------------- detail -->
      <section class="detail">
        <div class="empty card" *ngIf="!selected">
          <div class="big">Pick a scenario to begin</div>
          <p class="small muted" style="max-width: 460px; margin: 0 auto">
            <strong>Happy</strong> runs the full chain end to end.
            <strong>Average</strong> covers what actually happens day to day.
            <strong>Worst</strong> asserts every error the API should produce.
            Each step shows the exact request and response.
          </p>
        </div>

        <ng-container *ngIf="selected as s">
          <div class="card">
            <div class="card-head">
              <span class="pill" [ngClass]="s.path">{{ s.path }}</span>
              <h2>{{ s.title }}</h2>
            </div>
            <p class="small muted desc">{{ s.description }}</p>

            <div class="blockers" *ngIf="!ready(s) || (s.writes && env.writesBlocked)">
              <div class="small" *ngIf="!ready(s)">
                Fill the <strong>{{ missing(s) }}</strong> token slot to run this.
              </div>
              <div class="small" *ngIf="s.writes && env.writesBlocked">
                This scenario writes, and writes are blocked on
                <strong>{{ env.current?.label }}</strong>. Unlock them in the header.
              </div>
            </div>

            <div class="inputs" *ngIf="s.inputs?.length">
              <span class="eyebrow">Run with</span>
              <div class="row">
                <div *ngFor="let f of s.inputs">
                  <label>{{ f.label }}</label>
                  <select *ngIf="f.type === 'select'" [(ngModel)]="inputValues[f.name]">
                    <option *ngFor="let o of f.options" [ngValue]="o.value">{{ o.label }}</option>
                  </select>
                  <input
                    *ngIf="f.type !== 'select'"
                    [type]="f.type === 'number' ? 'number' : 'text'"
                    [(ngModel)]="inputValues[f.name]" />
                  <span class="tiny muted hint" *ngIf="f.hint">{{ f.hint }}</span>
                </div>
              </div>
            </div>

            <div class="actions">
              <button
                class="primary"
                (click)="run(s)"
                [disabled]="running || !ready(s) || (s.writes && env.writesBlocked)">
                {{ running ? 'Running…' : 'Run scenario' }}
              </button>

              <label class="stepmode" [class.on]="stepMode">
                <input type="checkbox" [(ngModel)]="stepMode" [disabled]="running" />
                Step through
                <span class="tiny muted">pause after each step</span>
              </label>

              <div class="tally" *ngIf="live">
                <span class="pill pass">{{ live.passed }} passed</span>
                <span class="pill fail" *ngIf="live.failed">{{ live.failed }} failed</span>
                <span class="pill skipped" *ngIf="live.skipped">{{ live.skipped }} skipped</span>
                <span class="tiny muted" *ngIf="live.finishedAtIso">
                  {{ elapsed(live) }}
                </span>
              </div>
            </div>

            <div class="progress" *ngIf="running">
              <div class="fill" [style.width.%]="progressPct()"></div>
            </div>

            <div class="paused" *ngIf="awaitingStep">
              <div>
                <strong>Paused after step {{ live?.steps?.length }} of {{ s.steps.length }}</strong>
                <span class="tiny muted">
                  — read the request and response below, then continue
                </span>
              </div>
              <button class="primary" (click)="nextStep()">Next step</button>
              <button (click)="runToEnd()">Run to end</button>
              <button class="danger" (click)="stopRun()">Stop</button>
            </div>
          </div>

          <div class="card" *ngIf="live">
            <div class="card-head">
              <h2>Steps</h2>
              <span class="sub tiny muted">click any step for the raw request and response</span>
            </div>
            <lab-step-card
              *ngFor="let r of live.steps"
              [r]="r"
              [startOpen]="stepMode"></lab-step-card>
          </div>

          <div class="card" *ngIf="mutableSteps().length">
            <div class="card-head">
              <h2>Derive a worst path</h2>
            </div>
            <p class="small muted desc">
              Pick a step and a failure mode. The broken request is generated from the working
              one and arrives with the status it should produce — so you never hand-write a bad
              payload. Variables from the last run are reused, so it hits real state.
            </p>

            <div class="row">
              <div>
                <label>Step</label>
                <select [(ngModel)]="mutStepId" (ngModelChange)="onStepPick()">
                  <option *ngFor="let st of mutableSteps()" [value]="st.id">{{ st.title }}</option>
                </select>
              </div>
              <div>
                <label>Failure mode</label>
                <select [(ngModel)]="mutIndex">
                  <option *ngFor="let m of catalogue; let i = index" [value]="i">{{ m.label }}</option>
                </select>
              </div>
              <div class="fit">
                <button (click)="runMutation()" [disabled]="running || !catalogue.length">
                  Run mutation
                </button>
              </div>
            </div>

            <p class="small muted why" *ngIf="currentHelp()">{{ currentHelp() }}</p>
            <lab-step-card *ngIf="mutationResult" [r]="mutationResult"></lab-step-card>
          </div>
        </ng-container>
      </section>
    </div>
  `,
  styles: [
    `
      .grid { display: grid; grid-template-columns: 330px minmax(0, 1fr); gap: 16px; align-items: start; }
      @media (max-width: 1000px) { .grid { grid-template-columns: 1fr; } }

      .list { position: sticky; top: 16px; }
      .module { margin-bottom: 16px; }
      .module:last-child { margin-bottom: 0; }
      .modname { margin-bottom: 7px; }

      .scenario {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 3px 9px;
        width: 100%;
        text-align: left;
        margin-bottom: 6px;
        padding: 9px 11px;
        align-items: center;
      }
      .scenario .t { font-weight: 600; }
      .scenario .meta { grid-column: 2; }
      .scenario .req { grid-column: 2; color: var(--warn); }
      .scenario.on {
        border-color: var(--brand);
        background: var(--brand-wash);
        box-shadow: inset 3px 0 0 var(--brand);
      }

      .desc { margin: 0 0 12px; max-width: 780px; }
      .blockers {
        background: var(--warn-wash);
        border: 1px solid #fedf89;
        border-radius: var(--radius-sm);
        padding: 8px 11px;
        margin-bottom: 12px;
        color: var(--warn);
      }
      .inputs {
        background: var(--brand-wash);
        border: 1px solid #b9e6f7;
        border-radius: var(--radius-sm);
        padding: 10px 12px;
        margin-bottom: 12px;
      }
      .inputs .eyebrow { display: block; margin-bottom: 7px; color: var(--brand-ink); }
      .inputs .row > div { max-width: 210px; }
      .hint { display: block; margin-top: 3px; }
      .actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
      .tally { display: flex; align-items: center; gap: 6px; }

      .progress {
        height: 3px;
        background: var(--line-soft);
        border-radius: 2px;
        margin-top: 12px;
        overflow: hidden;
      }
      .progress .fill { height: 100%; background: var(--brand); transition: width 0.2s; }

      .stepmode {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin: 0;
        padding: 6px 11px;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        font-size: 12.5px;
        font-weight: 550;
        color: var(--ink-2);
        text-transform: none;
        letter-spacing: 0;
        cursor: pointer;
      }
      .stepmode.on { border-color: var(--brand); background: var(--brand-wash); color: var(--brand-ink); }
      .stepmode input { width: auto; margin: 0; }

      .paused {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 12px;
        padding: 10px 12px;
        background: var(--warn-wash);
        border: 1px solid #fedf89;
        border-radius: var(--radius-sm);
        color: var(--warn);
      }
      .paused > div { flex: 1 1 auto; }
      .why { margin: 8px 0 0; }
    `,
  ],
})
export class ScenarioRunnerComponent implements OnInit, OnDestroy {
  private alive = true;
  selected: ScenarioDef | null = null;
  live: RunResult | null = null;
  running = false;

  inputValues: Record<string, any> = {};

  /** Hold the run after each step so a human can actually read what happened. */
  stepMode = false;
  awaitingStep = false;
  private resumeStep: (() => void) | null = null;
  private stopRequested = false;
  catalogue: MutatorDef[] = [];
  mutStepId = '';
  mutIndex = 0;
  mutationResult: StepResult | null = null;

  constructor(
    public scenarios: ScenarioService,
    public env: EnvService,
    private auth: AuthService,
    private runner: RunnerService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    // Do not rely on AppComponent having finished loading first - ask for the data and
    // repaint when it lands. Previously the list rendered before the fetch resolved and
    // stayed empty until a tab switch rebuilt the component.
    await this.scenarios.ensureLoaded();
    this.tick();
  }

  totalScenarios(): number {
    return this.scenarios.files.reduce((n, f) => n + f.scenarios.length, 0);
  }

  select(s: ScenarioDef): void {
    this.selected = s;
    this.live = null;
    this.mutationResult = null;
    this.seedInputs(s);
    this.mutStepId = this.mutableSteps()[0]?.id ?? '';
    this.onStepPick();
  }

  /** Defaults may be templates like {{year}}, resolved against the seed variables. */
  private seedInputs(s: ScenarioDef): void {
    const seeds = seedVariables();
    this.inputValues = {};
    for (const f of s.inputs ?? []) {
      const raw = f.default === undefined ? '' : resolve(f.default, seeds);
      this.inputValues[f.name] = f.type === 'number' ? Number(raw) : raw;
    }
  }

  /** Selects hand back strings; the engine and builders expect real numbers. */
  private coercedInputs(s: ScenarioDef): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of s.inputs ?? []) {
      const v = this.inputValues[f.name];
      out[f.name] = f.type === 'number' || typeof f.default === 'number' ? Number(v) : v;
    }
    return out;
  }

  ready(s: ScenarioDef): boolean {
    return s.requires.every((r) => r === 'none' || r === 'garbage' || this.auth.filled(r));
  }

  missing(s: ScenarioDef): string {
    return s.requires
      .filter((r) => r !== 'none' && r !== 'garbage' && !this.auth.filled(r))
      .join(', ');
  }

  progressPct(): number {
    const total = this.selected?.steps.length ?? 0;
    const done = this.live?.steps.length ?? 0;
    return total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  }

  elapsed(run: RunResult): string {
    if (!run.finishedAtIso) return '';
    const ms = new Date(run.finishedAtIso).getTime() - new Date(run.startedAtIso).getTime();
    return `${(ms / 1000).toFixed(1)}s`;
  }

  async run(s: ScenarioDef): Promise<void> {
    this.running = true;
    this.live = null;
    this.stopRequested = false;
    this.awaitingStep = false;
    this.tick();
    try {
      this.live = await this.runner.run(
        s,
        (_r, run) => {
          // New object each tick, then repaint, so steps stream in as they land.
          this.live = { ...run, steps: [...run.steps] };
          this.tick();
        },
        this.coercedInputs(s),
        () => this.waitForHuman(),
        () => this.stopRequested
      );
    } catch (e) {
      console.error('scenario run failed', e);
      alert(`The run stopped unexpectedly: ${e}`);
    } finally {
      this.running = false;
      this.tick();
    }
  }

  /**
   * Resolves when the operator asks for the next step. Returns immediately when step mode is
   * off, so the normal run is unaffected.
   */
  private waitForHuman(): Promise<void> {
    if (!this.stepMode || this.stopRequested) {
      return Promise.resolve();
    }
    this.awaitingStep = true;
    this.tick();
    return new Promise<void>((resolve) => {
      this.resumeStep = () => {
        this.awaitingStep = false;
        this.resumeStep = null;
        this.tick();
        resolve();
      };
    });
  }

  nextStep(): void {
    this.resumeStep?.();
  }

  /** Drop out of step mode and let the remaining steps run without pausing. */
  runToEnd(): void {
    this.stepMode = false;
    this.resumeStep?.();
  }

  /** Abandon the rest of the run; remaining steps are recorded as skipped. */
  stopRun(): void {
    this.stopRequested = true;
    this.stepMode = false;
    this.resumeStep?.();
  }

  mutableSteps(): StepDef[] {
    return this.selected?.steps ?? [];
  }

  onStepPick(): void {
    const step = this.mutableSteps().find((s) => s.id === this.mutStepId);
    this.catalogue = step ? catalogueFor(step) : [];
    this.mutIndex = 0;
  }

  currentHelp(): string {
    const m = this.catalogue[this.mutIndex];
    return m ? MUTATOR_HELP[m.kind] : '';
  }

  async runMutation(): Promise<void> {
    const step = this.mutableSteps().find((s) => s.id === this.mutStepId);
    const m = this.catalogue[this.mutIndex];
    if (!step || !m) return;

    this.running = true;
    this.tick();
    try {
      const derived = applyMutator(step, m);
      this.mutationResult = await this.runner.runOne(derived, this.live?.variables);
    } catch (e) {
      console.error('mutation failed', e);
      alert(`The mutation stopped unexpectedly: ${e}`);
    } finally {
      this.running = false;
      this.tick();
    }
  }

  /** Repaint, unless this view has already been destroyed by a tab switch. */
  private tick(): void {
    if (this.alive) {
      this.cdr.detectChanges();
    }
  }

  ngOnDestroy(): void {
    this.alive = false;
  }
}
