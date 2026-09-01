import { Component, Input } from '@angular/core';
import { StepResult } from '../core/models';

/**
 * One step of a run. Shows the exact request and the exact response body, because the whole
 * point of the tool is that you never have to guess what went over the wire.
 */
@Component({
  selector: 'lab-step-card',
  standalone: false,
  template: `
    <div class="step" [attr.data-outcome]="r.outcome" [class.open]="open">
      <div class="head" (click)="open = !open">
        <span class="pill" [ngClass]="r.outcome">{{ r.outcome }}</span>
        <span class="title">{{ r.title }}</span>
        <span class="detail mono">{{ r.detail }}</span>
        <span class="ms tiny muted" *ngIf="r.response">{{ r.response.elapsedMs }} ms</span>
        <span class="chev">{{ open ? '−' : '+' }}</span>
      </div>

      <div class="body" *ngIf="open">
        <p class="small muted note" *ngIf="r.note">{{ r.note }}</p>

        <p class="small flag" *ngIf="mismatch()">
          Transport says {{ r.response?.httpStatus }}, the envelope says
          {{ r.response?.envelopeStatusCode }}. That is the <code>Platform: Mobile</code>
          behaviour — the envelope code is the real one.
        </p>

        <p class="small flag err" *ngIf="r.response?.transportError">
          {{ r.response?.transportError }}
        </p>

        <ng-container *ngIf="r.request">
          <div class="label-row">
            <span class="eyebrow">Request</span>
            <button class="ghost sm copy" (click)="copy(requestText())">copy</button>
          </div>
          <pre class="mono">{{ requestText() }}</pre>
        </ng-container>

        <ng-container *ngIf="r.response">
          <div class="label-row">
            <span class="eyebrow">Response</span>
            <span class="tiny muted">
              transport {{ r.response.httpStatus ?? 'n/a' }} &middot;
              envelope {{ r.response.envelopeStatus ?? '—' }} /
              {{ r.response.envelopeStatusCode ?? '—' }}
            </span>
            <button class="ghost sm copy" (click)="copy(r.response.raw)">copy</button>
          </div>
          <pre class="mono">{{ pretty(r.response.raw) }}</pre>
        </ng-container>

        <ng-container *ngIf="hasCaptured()">
          <div class="label-row"><span class="eyebrow">Captured into variables</span></div>
          <pre class="mono">{{ capturedText() }}</pre>
        </ng-container>
      </div>
    </div>
  `,
  styles: [
    `
      .step {
        border: 1px solid var(--line);
        border-left: 3px solid var(--line);
        border-radius: var(--radius-sm);
        margin-bottom: 7px;
        background: var(--surface);
        transition: border-color 0.12s;
      }
      .step[data-outcome='pass'] { border-left-color: #12b76a; }
      .step[data-outcome='fail'] { border-left-color: #f04438; background: #fffbfa; }
      .step[data-outcome='blocked'] { border-left-color: #f79009; }
      .step[data-outcome='skipped'] { border-left-color: #d0d5dd; opacity: 0.75; }
      .step.open { box-shadow: var(--shadow-lg); }

      .head {
        display: flex;
        align-items: center;
        gap: 11px;
        padding: 9px 12px;
        cursor: pointer;
      }
      .head:hover { background: var(--line-soft); }
      .title { font-weight: 600; }
      .detail { color: var(--muted); flex: 1 1 auto; }
      .chev { color: var(--faint); width: 12px; text-align: center; font-weight: 700; }

      .body { padding: 2px 12px 12px; border-top: 1px solid var(--line-soft); }
      .label-row { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
      .copy { margin-left: auto; }
      .note { margin: 10px 0 0; }
      .flag {
        margin: 10px 0 0;
        background: var(--warn-wash);
        border: 1px solid #fedf89;
        color: var(--warn);
        border-radius: var(--radius-sm);
        padding: 7px 10px;
      }
      .flag.err { background: var(--fail-wash); border-color: #fecdca; color: var(--fail); }
    `,
  ],
})
export class StepCardComponent {
  @Input() r!: StepResult;
  open = false;

  hasCaptured(): boolean {
    return !!this.r.captured && Object.keys(this.r.captured).length > 0;
  }

  capturedText(): string {
    return JSON.stringify(this.r.captured ?? {}, null, 2);
  }

  /** True when the transport says OK but the envelope says otherwise. */
  mismatch(): boolean {
    const res = this.r.response;
    if (!res || res.httpStatus === null || res.envelopeStatusCode === null) return false;
    return res.httpStatus < 400 && res.envelopeStatusCode >= 400;
  }

  requestText(): string {
    const q = this.r.request;
    if (!q) return '';
    const headers = Object.entries(q.headers)
      .map(([k, v]) => `${k}: ${k === 'Authorization' ? 'Bearer ***' : v}`)
      .join('\n');
    const body = q.body === undefined ? '' : `\n\n${JSON.stringify(q.body, null, 2)}`;
    return `${q.method} ${q.url}\n${headers}${body}`;
  }

  pretty(raw: string): string {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw || '(empty body)';
    }
  }

  copy(text: string): void {
    navigator.clipboard?.writeText(text);
  }
}
