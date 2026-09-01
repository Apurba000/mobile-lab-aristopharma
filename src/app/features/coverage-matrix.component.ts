import { ChangeDetectorRef, Component } from '@angular/core';
import { RunnerService } from '../core/runner.service';
import { ScenarioService } from '../core/scenario.service';
import { EnvService } from '../core/env.service';

type CellState = 'pass' | 'fail' | 'miss' | 'extra' | 'none';

interface Row {
  endpoint: string;
  note?: string;
  cells: { code: number; state: CellState }[];
  declared: boolean;
}

interface ModuleBlock {
  label: string;
  rows: Row[];
  required: number;
  covered: number;
}

const CODES = [200, 400, 401, 403, 404];

/**
 * Endpoint x status coverage against the module's *declared* surface.
 *
 * A matrix built only from calls already made can never tell you about an endpoint you have
 * never touched — the gap is invisible precisely when it matters. So each scenario file
 * declares the endpoints its module exposes and the statuses worth proving, and anything
 * required but unseen shows as MISS.
 */
@Component({
  selector: 'lab-coverage-matrix',
  standalone: false,
  template: `
    <div class="card">
      <div class="card-head">
        <h2>Coverage</h2>
        <span class="sub tiny muted">
          {{ runner.endpointCount() }} endpoint(s) · {{ runner.recordedCalls }} call(s)
          recorded on <strong>{{ envLabel() }}</strong> · {{ totalCovered() }} of
          {{ totalRequired() }} required cells
        </span>
      </div>

      <p class="small note" *ngIf="!runner.recordedCalls">
        Nothing recorded for this environment yet. Run a scenario on the
        <strong>Scenarios</strong> tab — coverage then accumulates here and
        <strong>survives reloads</strong>, so you can build it up over a session.
      </p>

      <p class="small muted legend">
        <span class="key pass">ok</span> produced and asserted &nbsp;
        <span class="key fail">fail</span> produced but not as expected &nbsp;
        <span class="key miss">miss</span> declared but never seen &nbsp;
        <span class="key none">·</span> not expected of this endpoint
      </p>

      <div class="mod" *ngFor="let m of blocks()">
        <div class="modhead">
          <span class="eyebrow">{{ m.label }}</span>
          <span class="tiny muted">{{ m.covered }} / {{ m.required }}</span>
          <div class="meter"><div class="fill" [style.width.%]="pct(m)"></div></div>
        </div>

        <table>
          <thead>
            <tr>
              <th class="ep">Endpoint</th>
              <th *ngFor="let c of codes">{{ c }}</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let row of m.rows" [class.undeclared]="!row.declared">
              <td class="ep mono">
                {{ row.endpoint }}
                <span class="tiny muted" *ngIf="!row.declared"> · not in the declared surface</span>
              </td>
              <td *ngFor="let c of row.cells" [ngClass]="c.state">{{ label(c.state) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="small muted" *ngIf="!blocks().length">
        No scenario files loaded, so there is no surface to measure against.
      </p>

      <div class="foot">
        <p class="small muted footnote">
          <strong>500 is absent by design.</strong> Forcing one needs server-side fault
          injection, and a test-only fault endpoint would be a liability in production.
          403 appears only where an endpoint can actually refuse an authenticated caller.
        </p>
        <button class="sm" (click)="reset()">Clear session coverage</button>
      </div>
    </div>
  `,
  styles: [
    `
      .note {
        background: var(--brand-wash);
        border: 1px solid #b9e6f7;
        color: var(--brand-ink);
        border-radius: var(--radius-sm);
        padding: 9px 12px;
        margin: 0 0 12px;
      }
      .legend { margin: 0 0 14px; }
      .key {
        display: inline-block;
        padding: 1px 7px;
        border-radius: 4px;
        font-weight: 700;
        font-size: 11px;
        margin-right: 3px;
      }
      .key.pass { background: var(--pass-wash); color: var(--pass); }
      .key.fail { background: var(--fail-wash); color: var(--fail); }
      .key.miss { background: var(--warn-wash); color: var(--warn); }
      .key.none { background: var(--line-soft); color: var(--faint); }

      .mod { margin-bottom: 22px; }
      .modhead { display: flex; align-items: center; gap: 10px; margin-bottom: 7px; }
      .meter {
        flex: 1 1 auto;
        max-width: 220px;
        height: 5px;
        background: var(--line-soft);
        border-radius: 3px;
        overflow: hidden;
      }
      .meter .fill { height: 100%; background: var(--pass); transition: width 0.2s; }

      table { border-collapse: collapse; width: 100%; }
      th, td {
        border: 1px solid var(--line);
        padding: 5px 9px;
        text-align: center;
        font-size: 11.5px;
      }
      th { background: var(--line-soft); font-weight: 650; color: var(--muted); }
      th.ep, td.ep { text-align: left; width: 48%; }
      tr.undeclared td.ep { color: var(--muted); font-style: italic; }
      td.pass { background: var(--pass-wash); color: var(--pass); font-weight: 700; }
      td.fail { background: var(--fail-wash); color: var(--fail); font-weight: 700; }
      td.miss { background: var(--warn-wash); color: var(--warn); font-weight: 700; }
      td.extra { background: var(--brand-wash); color: var(--brand-ink); font-weight: 600; }
      td.none { color: #c7ced8; }

      .foot { display: flex; align-items: flex-start; gap: 16px; margin-top: 4px; }
      .footnote { margin: 0; flex: 1 1 auto; }
    `,
  ],
})
export class CoverageMatrixComponent {
  codes = CODES;

  // Rebuilt only when a call has actually been recorded, since this component stays mounted
  // for the whole session and the template reads it several times per check.
  private cache: ModuleBlock[] = [];
  private cacheKey = '';

  constructor(
    public runner: RunnerService,
    private scenarios: ScenarioService,
    private env: EnvService,
    private cdr: ChangeDetectorRef
  ) {}

  envLabel(): string {
    return this.env.current?.label ?? 'this environment';
  }

  blocks(): ModuleBlock[] {
    const key = `${this.env.current?.key}|${this.runner.coverageVersion}|${this.scenarios.files.length}`;
    if (key !== this.cacheKey) {
      this.cacheKey = key;
      this.cache = this.build();
    }
    return this.cache;
  }

  private build(): ModuleBlock[] {
    const seen = this.runner.getCoverage();
    const claimed = new Set<string>();
    const blocks: ModuleBlock[] = [];

    for (const file of this.scenarios.files) {
      const rows: Row[] = [];
      let required = 0;
      let covered = 0;

      for (const entry of file.surface ?? []) {
        claimed.add(entry.endpoint);
        const hits = seen.get(entry.endpoint);
        const cells = CODES.map((code) => {
          const hit = hits?.get(code);
          const isRequired = entry.expect.includes(code);
          if (isRequired) required++;
          if (hit === 'pass') {
            if (isRequired) covered++;
            return { code, state: 'pass' as CellState };
          }
          if (hit === 'fail') return { code, state: 'fail' as CellState };
          // Seen on an endpoint that did not declare it — informative, not a gap.
          if (!isRequired && hit) return { code, state: 'extra' as CellState };
          return { code, state: (isRequired ? 'miss' : 'none') as CellState };
        });
        rows.push({ endpoint: entry.endpoint, note: entry.note, cells, declared: true });
      }

      if (rows.length) {
        blocks.push({ label: file.label, rows, required, covered });
      }
    }

    // Anything called that no module declared — usually a typo in a scenario path, or a
    // surface list that has drifted behind the API.
    const strays: Row[] = [];
    for (const [endpoint, hits] of seen) {
      if (claimed.has(endpoint)) continue;
      strays.push({
        endpoint,
        declared: false,
        cells: CODES.map((code) => ({
          code,
          state: (hits.get(code) ?? 'none') as CellState,
        })),
      });
    }
    if (strays.length) {
      blocks.push({
        label: 'Called but not declared',
        rows: strays.sort((a, b) => a.endpoint.localeCompare(b.endpoint)),
        required: 0,
        covered: 0,
      });
    }

    return blocks;
  }

  label(state: CellState): string {
    switch (state) {
      case 'pass':
        return 'ok';
      case 'fail':
        return 'fail';
      case 'miss':
        return 'miss';
      case 'extra':
        return 'seen';
      default:
        return '·';
    }
  }

  pct(m: ModuleBlock): number {
    return m.required ? Math.round((m.covered / m.required) * 100) : 0;
  }

  totalRequired(): number {
    return this.blocks().reduce((n, m) => n + m.required, 0);
  }

  totalCovered(): number {
    return this.blocks().reduce((n, m) => n + m.covered, 0);
  }

  /**
   * Repaint using this component's own ChangeDetectorRef.
   *
   * detectChanges() on the parent does not reach this view, so the parent calls in here when
   * the tab becomes visible - the same ref the Clear button uses, which is the one path
   * observed to actually render.
   */
  refresh(): void {
    this.cdr.detectChanges();
  }

  reset(): void {
    this.runner.clearCoverage();
    this.cdr.detectChanges();
  }
}
