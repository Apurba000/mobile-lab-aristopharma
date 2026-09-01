import { ChangeDetectorRef, Component, OnDestroy } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { RunnerService } from '../core/runner.service';
import { HttpMethod, StepDef, StepResult, TokenSlot } from '../core/models';

/** Free-form request sender, for when you want to poke one endpoint directly. */
@Component({
  selector: 'lab-request-console',
  standalone: false,
  template: `
    <div class="card">
      <h2>Raw request</h2>
      <p class="small muted">
        Send anything to <code>api/v1/app/*</code>. The <code>Platform: Mobile</code> toggle is
        the one that decides whether errors arrive as real HTTP codes or as 200 with the code
        buried in the envelope.
      </p>

      <div class="row">
        <div class="fit">
          <label>Method</label>
          <select [(ngModel)]="method">
            <option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option>
          </select>
        </div>
        <div style="flex: 3 1 420px">
          <label>Path</label>
          <input [(ngModel)]="path" placeholder="/api/v1/app/visitplan/territories" />
        </div>
        <div class="fit">
          <label>Token</label>
          <select [(ngModel)]="tokenSlot">
            <option value="mio">MIO</option>
            <option value="am">AM</option>
            <option value="admin">Admin</option>
            <option value="none">none</option>
            <option value="garbage">garbage</option>
          </select>
        </div>
        <div class="fit check">
          <label>
            <input type="checkbox" [(ngModel)]="mobileHeader" /> Platform: Mobile
          </label>
        </div>
        <div class="fit">
          <button class="primary" (click)="send()" [disabled]="busy || !path">
            {{ busy ? 'Sending…' : 'Send' }}
          </button>
        </div>
      </div>

      <div *ngIf="method !== 'GET'">
        <label>Body (JSON)</label>
        <textarea rows="8" class="mono" [(ngModel)]="body"></textarea>
        <p class="small err" *ngIf="bodyError">{{ bodyError }}</p>
      </div>
    </div>

    <div class="card" *ngIf="result">
      <h2>Result</h2>
      <lab-step-card [r]="result"></lab-step-card>
    </div>
  `,
  styles: [
    `
      .check { display: flex; align-items: center; padding-bottom: 6px; }
      .check label { margin: 0; font-size: 13px; font-weight: 500; color: var(--ink); }
      .check input { width: auto; margin-right: 4px; }
      textarea { min-height: 120px; }
      .err { color: var(--fail); }
    `,
  ],
})
export class RequestConsoleComponent implements OnDestroy {
  private alive = true;
  method: HttpMethod = 'GET';
  path = '/api/v1/app/visitplan/territories';
  tokenSlot: TokenSlot = 'mio';
  mobileHeader = true;
  body = '{\n}';
  bodyError = '';
  busy = false;
  result: StepResult | null = null;

  constructor(
    private runner: RunnerService,
    public auth: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  async send(): Promise<void> {
    this.bodyError = '';
    let parsedBody: unknown = undefined;
    if (this.method !== 'GET' && this.body.trim()) {
      try {
        parsedBody = JSON.parse(this.body);
      } catch (e) {
        this.bodyError = `Body is not valid JSON: ${e}`;
        return;
      }
    }

    const step: StepDef = {
      id: 'console',
      title: `${this.method} ${this.path}`,
      request: {
        method: this.method,
        path: this.path,
        as: this.tokenSlot,
        mobileHeader: this.mobileHeader,
        body: parsedBody,
      },
    };

    this.busy = true;
    this.tick();
    try {
      this.result = await this.runner.runOne(step);
    } finally {
      this.busy = false;
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
