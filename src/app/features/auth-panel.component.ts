import { ChangeDetectorRef, Component } from '@angular/core';
import { AuthService, SlotState } from '../core/auth.service';
import { EnvService } from '../core/env.service';
import { TokenSlot } from '../core/models';

/**
 * Collapses to a one-line summary once tokens are held, because it is setup rather than
 * work — it should not occupy half the screen for the rest of the session.
 */
@Component({
  selector: 'lab-auth-panel',
  standalone: false,
  template: `
    <div class="card tokens">
      <div class="summary" (click)="expanded = !expanded">
        <span class="eyebrow">Tokens</span>

        <div class="chips">
          <span class="chip" *ngFor="let s of auth.slots" [class.ready]="s.token">
            <span class="dot" [class.on]="s.token" [class.off]="!s.token"></span>
            {{ short(s.slot) }}
            <em *ngIf="s.token">{{ expiryShort(s.slot) }}</em>
            <em *ngIf="!s.token" class="none">not set</em>
          </span>
        </div>

        <span class="hint small muted" *ngIf="!expanded && !anyToken()">
          No tokens yet — open this to log in or paste a JWT
        </span>
        <button class="ghost sm toggle">{{ expanded ? 'Hide' : 'Manage' }}</button>
      </div>

      <div class="body" *ngIf="expanded">
        <p class="small muted intro">
          Mobile login takes a <strong>user name only</strong> — no password — then an OTP where
          the environment enforces one. Paste a JWT instead if OTP delivery is impractical.
          Tokens live in <code>sessionStorage</code> and die with this tab.
        </p>

        <div class="slot" *ngFor="let s of auth.slots">
          <div class="slot-head">
            <strong>{{ s.label }}</strong>
            <span class="pill" [ngClass]="s.token ? 'pass' : 'skipped'">
              {{ s.token ? 'ready' : 'empty' }}
            </span>
            <span class="small muted who" *ngIf="s.name || s.empId">
              {{ s.name }} <span *ngIf="s.empId">· emp {{ s.empId }}</span>
            </span>
            <span class="small expiry" [class.stale]="isExpired(s.slot)">{{ expiryText(s.slot) }}</span>
          </div>

          <div class="row">
            <div>
              <label>User name</label>
              <input [(ngModel)]="userName[s.slot]" placeholder="field force user name" />
            </div>
            <div class="fit">
              <button (click)="login(s)" [disabled]="!userName[s.slot] || busy[s.slot]">
                {{ busy[s.slot] ? '…' : 'Login' }}
              </button>
            </div>
            <div>
              <label>OTP <span *ngIf="s.empId">(emp {{ s.empId }})</span></label>
              <input [(ngModel)]="otp[s.slot]" placeholder="one-time code" />
            </div>
            <div class="fit">
              <button (click)="validate(s)" [disabled]="!otp[s.slot] || !s.empId || busy[s.slot]">
                Validate
              </button>
            </div>
          </div>

          <div class="row">
            <div>
              <label>…or paste a JWT</label>
              <input
                class="mono"
                [ngModel]="s.token"
                (ngModelChange)="auth.setToken(s.slot, $event)"
                placeholder="eyJhbGciOi…" />
            </div>
            <div class="fit">
              <button class="sm" (click)="auth.refresh(env.baseUrl, s.slot)" [disabled]="!s.refreshToken">
                Refresh
              </button>
            </div>
            <div class="fit">
              <button class="sm" (click)="auth.clear(s.slot)" [disabled]="!s.token">Clear</button>
            </div>
          </div>

          <p class="small msg" *ngIf="s.lastMessage">{{ s.lastMessage }}</p>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .tokens { padding: 0; }
      .summary {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 11px 18px;
        cursor: pointer;
      }
      .chips { display: flex; gap: 7px; flex-wrap: wrap; }
      .chip {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 3px 10px;
        border: 1px solid var(--line);
        border-radius: 999px;
        font-size: 11.5px; font-weight: 600;
        background: var(--line-soft);
        color: var(--muted);
      }
      .chip.ready { background: var(--pass-wash); border-color: #abefc6; color: var(--pass); }
      .chip em { font-style: normal; font-weight: 500; opacity: 0.8; }
      .chip em.none { opacity: 0.6; }
      .hint { margin-left: 4px; }
      .toggle { margin-left: auto; }

      .body { border-top: 1px solid var(--line); padding: 14px 18px 6px; }
      .intro { margin: 0 0 14px; max-width: 900px; }
      .slot { border-top: 1px dashed var(--line); padding: 12px 0 6px; }
      .slot:first-of-type { border-top: none; padding-top: 0; }
      .slot-head { display: flex; align-items: center; gap: 9px; margin-bottom: 9px; }
      .who { margin-left: 2px; }
      .expiry { margin-left: auto; color: var(--muted); }
      .expiry.stale { color: var(--fail); font-weight: 650; }
      .row { margin-bottom: 8px; }
      .msg { margin: 2px 0 0; color: var(--brand-ink); }
    `,
  ],
})
export class AuthPanelComponent {
  userName: Record<string, string> = {};
  otp: Record<string, string> = {};
  busy: Record<string, boolean> = {};
  expanded: boolean;

  constructor(public auth: AuthService, public env: EnvService, private cdr: ChangeDetectorRef) {
    // Start open only when there is nothing to work with yet.
    this.expanded = !this.anyToken();
  }

  anyToken(): boolean {
    return this.auth.slots.some((s) => !!s.token);
  }

  short(slot: TokenSlot): string {
    return slot === 'mio' ? 'MIO' : slot === 'am' ? 'AM' : 'Admin';
  }

  async login(s: SlotState): Promise<void> {
    this.busy[s.slot] = true;
    this.cdr.detectChanges();
    await this.auth.login(this.env.baseUrl, s.slot, this.userName[s.slot]);
    this.busy[s.slot] = false;
    this.cdr.detectChanges();
  }

  async validate(s: SlotState): Promise<void> {
    this.busy[s.slot] = true;
    this.cdr.detectChanges();
    await this.auth.validateOtp(this.env.baseUrl, s.slot, Number(s.empId), Number(this.otp[s.slot]));
    this.busy[s.slot] = false;
    this.cdr.detectChanges();
  }

  isExpired(slot: TokenSlot): boolean {
    const left = this.auth.secondsLeft(slot);
    return left !== null && left <= 0;
  }

  expiryShort(slot: TokenSlot): string {
    const left = this.auth.secondsLeft(slot);
    if (left === null) return '';
    if (left <= 0) return 'expired';
    const m = Math.floor(left / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h` : `${m}m`;
  }

  expiryText(slot: TokenSlot): string {
    const left = this.auth.secondsLeft(slot);
    if (left === null) return this.auth.filled(slot) ? 'expiry unknown' : '';
    if (left <= 0) return 'EXPIRED';
    const m = Math.floor(left / 60);
    return m > 60 ? `expires in ${Math.floor(m / 60)}h ${m % 60}m` : `expires in ${m}m ${left % 60}s`;
  }
}
