import { ChangeDetectorRef, Component, OnInit, ViewChild } from '@angular/core';
import { CoverageMatrixComponent } from './features/coverage-matrix.component';
import { EnvService } from './core/env.service';
import { ScenarioService } from './core/scenario.service';

type Tab = 'run' | 'console' | 'coverage';

@Component({
  selector: 'lab-root',
  standalone: false,
  template: `
    <header class="bar" [attr.data-tone]="tone">
      <div class="ident">
        <div class="mark">ML</div>
        <div>
          <div class="name">Mobile&nbsp;Lab</div>
          <div class="tag">MSFA · api/v1/app test &amp; debug · <span class="build">{{ build }}</span></div>
        </div>
      </div>

      <div class="envbox">
        <label class="envlabel">Environment</label>
        <div class="envrow">
          <select [ngModel]="env.current?.key" (ngModelChange)="env.select($event)">
            <option *ngFor="let e of env.environments" [value]="e.key">{{ e.label }}</option>
          </select>
          <code class="url">{{ env.baseUrl || 'no base URL configured' }}</code>
        </div>
      </div>

      <div class="writes">
        <ng-container *ngIf="env.current?.writesAllowed">
          <span class="wpill ok">Writes allowed</span>
        </ng-container>
        <ng-container *ngIf="env.current && !env.current!.writesAllowed">
          <span class="wpill locked" *ngIf="env.writesBlocked">Read-only</span>
          <span class="wpill open" *ngIf="!env.writesBlocked">Writes unlocked · 1 run</span>
          <div class="unlockrow" *ngIf="env.writesBlocked">
            <input
              [(ngModel)]="unlockText"
              (keyup.enter)="unlock()"
              [placeholder]="'type ' + env.current!.key + ' to unlock'" />
            <button class="sm" (click)="unlock()">Unlock</button>
          </div>
        </ng-container>
      </div>
    </header>

    <div class="notice" *ngIf="env.loadError">{{ env.loadError }}</div>
    <div class="notice" *ngIf="scenarios.error">{{ scenarios.error }}</div>

    <main>
      <lab-auth-panel></lab-auth-panel>

      <nav class="tabs">
        <button
          *ngFor="let t of tabs"
          [class.on]="tab === t.key"
          (click)="show(t.key)">
          <span class="tt">{{ t.label }}</span>
          <span class="td">{{ t.hint }}</span>
        </button>
      </nav>

      <!--
        Hidden rather than *ngIf: a tab is a view onto work in progress, so switching away
        must not throw away a finished run, an expanded step, or a half-typed request.
      -->
      <lab-scenario-runner [hidden]="tab !== 'run'"></lab-scenario-runner>
      <lab-request-console [hidden]="tab !== 'console'"></lab-request-console>
      <lab-coverage-matrix [hidden]="tab !== 'coverage'"></lab-coverage-matrix>
    </main>
  `,
  styles: [
    `
      .bar {
        display: flex;
        align-items: center;
        gap: 30px;
        flex-wrap: wrap;
        padding: 12px 22px;
        background: linear-gradient(180deg, #10344a 0%, #0d2b3d 100%);
        color: #eaf2f7;
        border-bottom: 3px solid #0aa2d8;
      }
      .bar[data-tone='caution'] {
        background: linear-gradient(180deg, #6b3b06 0%, #572f04 100%);
        border-bottom-color: #f79009;
      }
      .bar[data-tone='danger'] {
        background: linear-gradient(180deg, #7a1d13 0%, #5f150e 100%);
        border-bottom-color: #f04438;
      }

      .ident { display: flex; align-items: center; gap: 11px; }
      .mark {
        width: 34px; height: 34px;
        border-radius: 9px;
        background: rgba(255, 255, 255, 0.13);
        border: 1px solid rgba(255, 255, 255, 0.22);
        display: grid; place-items: center;
        font-weight: 750; font-size: 13px; letter-spacing: 0.02em;
      }
      .name { font-size: 15px; font-weight: 650; letter-spacing: -0.01em; }
      .tag { font-size: 11px; opacity: 0.68; }
      .build { background: rgba(255,255,255,0.16); padding: 0 5px; border-radius: 3px; }

      .envbox { min-width: 300px; }
      .envlabel {
        font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
        text-transform: uppercase; opacity: 0.6; margin-bottom: 3px; display: block;
      }
      .envrow { display: flex; align-items: center; gap: 10px; }
      .envrow select {
        width: auto; min-width: 150px;
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.25);
        color: #fff;
      }
      .envrow select option { color: #101828; }
      .url { font-size: 11.5px; opacity: 0.75; font-family: 'Cascadia Mono', Consolas, monospace; }

      .writes { margin-left: auto; display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
      .wpill {
        padding: 3px 10px; border-radius: 999px;
        font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
      }
      .wpill.ok { background: rgba(18, 183, 106, 0.2); color: #a6f4c5; }
      .wpill.locked { background: rgba(240, 68, 56, 0.22); color: #fecdca; }
      .wpill.open { background: rgba(247, 144, 9, 0.22); color: #fedf89; }
      .unlockrow { display: flex; gap: 6px; }
      .unlockrow input { width: 210px; font-size: 12px; }

      .notice {
        padding: 8px 22px;
        background: var(--warn-wash);
        color: var(--warn);
        font-size: 12px;
        border-bottom: 1px solid #fedf89;
      }

      main { padding: 18px 22px 48px; max-width: 1560px; margin: 0 auto; }

      .tabs { display: flex; gap: 8px; margin-bottom: 16px; }
      .tabs button {
        display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
        padding: 8px 15px; background: var(--surface);
      }
      .tabs .tt { font-size: 13px; font-weight: 650; }
      .tabs .td { font-size: 11px; color: var(--faint); font-weight: 500; }
      .tabs button.on {
        border-color: var(--brand);
        box-shadow: inset 0 0 0 1px var(--brand), var(--shadow);
      }
      .tabs button.on .tt { color: var(--brand-ink); }
    `,
  ],
})
export class AppComponent implements OnInit {
  /** Bump on every change so a stale browser bundle is obvious at a glance. */
  readonly build = 'build 10';

  // [hidden] keeps this mounted, so the reference is always available.
  @ViewChild(CoverageMatrixComponent) private coverageView?: CoverageMatrixComponent;

  tab: Tab = 'run';
  unlockText = '';

  readonly tabs: { key: Tab; label: string; hint: string }[] = [
    { key: 'run', label: 'Scenarios', hint: 'end-to-end flows' },
    { key: 'console', label: 'Raw console', hint: 'send one request' },
    { key: 'coverage', label: 'Coverage', hint: 'what has been hit' },
  ];

  constructor(
    public env: EnvService,
    public scenarios: ScenarioService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    await this.env.load();
    // Repaint explicitly rather than relying on the zone: see the note in app.module.ts.
    this.cdr.detectChanges();
    await this.scenarios.ensureLoaded();
    this.cdr.detectChanges();
  }

  get tone(): string {
    return this.env.current?.tone ?? 'safe';
  }

  /** Explicit repaint: the tabs are siblings, so a run's own detectChanges never reaches them. */
  show(tab: Tab): void {
    this.tab = tab;
    this.cdr.detectChanges();
    // Coverage accumulates while other tabs are in front, so it must be told to redraw.
    if (tab === 'coverage') {
      this.coverageView?.refresh();
    }
  }

  unlock(): void {
    if (!this.env.tryUnlock(this.unlockText)) {
      alert(`Type "${this.env.current?.key}" exactly to unlock writes.`);
    }
    this.unlockText = '';
    this.cdr.detectChanges();
  }
}
