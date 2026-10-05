import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TokenSlot } from './models';
import { envelopeData, readEnvelope } from './engine';

export interface SlotState {
  slot: TokenSlot;
  label: string;
  token: string;
  empId?: number;
  userName?: string;
  name?: string;
  refreshToken?: string;
  expiresAt?: number;
  lastMessage?: string;
}

const STORAGE_KEY = 'msfa-lab-tokens';

/**
 * Token slots for the roles a scenario needs. Tokens live in memory and sessionStorage only,
 * never localStorage, so they die with the tab.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  slots: SlotState[] = [
    { slot: 'mio', label: 'MIO (field user)', token: '' },
    { slot: 'am', label: 'AM (line manager)', token: '' },
    // DCR (module 20) scopes by level, so the lab needs an RSM to prove the wider scope.
    { slot: 'rsm', label: 'RSM (regional manager)', token: '' },
    { slot: 'admin', label: 'Admin (web)', token: '' },
  ];

  constructor(private http: HttpClient) {
    this.restore();
  }

  get tokens(): Partial<Record<TokenSlot, string>> {
    const out: Partial<Record<TokenSlot, string>> = {};
    for (const s of this.slots) {
      if (s.token) out[s.slot] = s.token;
    }
    return out;
  }

  slotFor(slot: TokenSlot): SlotState | undefined {
    return this.slots.find((s) => s.slot === slot);
  }

  filled(slot: TokenSlot): boolean {
    return !!this.slotFor(slot)?.token;
  }

  /**
   * Step 1 of the mobile login. The API takes a user name only — no password — and answers
   * with employee details plus, depending on configuration, either a token or the need for
   * an OTP.
   */
  async login(baseUrl: string, slot: TokenSlot, userName: string): Promise<string> {
    const state = this.slotFor(slot);
    if (!state) return 'unknown slot';
    try {
      const res: any = await firstValueFrom(
        this.http.post(`${baseUrl}/api/v1/app/auth/login`, { userName, fcmToken: 'mobile-lab' })
      );
      const env = readEnvelope(res);
      const data: any = envelopeData(res) ?? {};
      state.empId = data.empId ?? data.EmpId;
      state.userName = data.userName ?? data.UserName ?? userName;
      state.name = data.name ?? data.Name;
      if (data.token ?? data.Token) {
        this.setToken(slot, data.token ?? data.Token, data.refreshToken ?? data.RefreshToken);
        state.lastMessage = 'Logged in — token captured.';
      } else {
        state.lastMessage = `No token returned (envelope ${env.statusCode ?? '?'}). An OTP is probably required.`;
      }
      return state.lastMessage;
    } catch (e) {
      state.lastMessage = this.describe(e);
      return state.lastMessage;
    }
  }

  /** Step 2: exchange the OTP for a token. */
  async validateOtp(baseUrl: string, slot: TokenSlot, empId: number, otp: number): Promise<string> {
    const state = this.slotFor(slot);
    if (!state) return 'unknown slot';
    try {
      const res: any = await firstValueFrom(
        this.http.post(`${baseUrl}/api/v1/app/auth/ValidateOtp`, { emp_Id: empId, otp })
      );
      const data: any = envelopeData(res) ?? {};
      const token = data.token ?? data.Token;
      if (token) {
        this.setToken(slot, token, data.refreshToken ?? data.RefreshToken);
        state.empId = empId;
        state.lastMessage = 'OTP accepted — token captured.';
      } else {
        state.lastMessage = 'OTP call succeeded but no token was returned.';
      }
      return state.lastMessage;
    } catch (e) {
      state.lastMessage = this.describe(e);
      return state.lastMessage;
    }
  }

  async refresh(baseUrl: string, slot: TokenSlot): Promise<string> {
    const state = this.slotFor(slot);
    if (!state?.refreshToken) return 'No refresh token held for this slot.';
    try {
      const res: any = await firstValueFrom(
        this.http.post(`${baseUrl}/api/v1/app/auth/refresh-token`, { token: state.refreshToken })
      );
      const data: any = envelopeData(res) ?? {};
      const token = data.token ?? data.Token;
      if (token) {
        this.setToken(slot, token, data.refreshToken ?? data.RefreshToken ?? state.refreshToken);
        state.lastMessage = 'Token refreshed.';
      } else {
        state.lastMessage = 'Refresh returned no token.';
      }
      return state.lastMessage;
    } catch (e) {
      state.lastMessage = this.describe(e);
      return state.lastMessage;
    }
  }

  setToken(slot: TokenSlot, token: string, refreshToken?: string): void {
    const state = this.slotFor(slot);
    if (!state) return;
    state.token = (token ?? '').replace(/^\s*Bearer\s+/i, '').trim();
    if (refreshToken) state.refreshToken = refreshToken;
    state.expiresAt = this.expiryOf(state.token);
    this.persist();
  }

  clear(slot: TokenSlot): void {
    const state = this.slotFor(slot);
    if (!state) return;
    state.token = '';
    state.refreshToken = undefined;
    state.expiresAt = undefined;
    state.lastMessage = 'Cleared.';
    this.persist();
  }

  /** Seconds until the JWT expires; negative once it has. Null if unreadable. */
  secondsLeft(slot: TokenSlot): number | null {
    const exp = this.slotFor(slot)?.expiresAt;
    if (!exp) return null;
    return Math.round((exp - Date.now()) / 1000);
  }

  private expiryOf(token: string): number | undefined {
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload?.exp ? payload.exp * 1000 : undefined;
    } catch {
      return undefined;
    }
  }

  private describe(e: unknown): string {
    if (e instanceof HttpErrorResponse) {
      if (e.status === 0) {
        return 'Network or CORS failure — check the base URL and that the API is reachable.';
      }
      const body = typeof e.error === 'string' ? e.error : JSON.stringify(e.error ?? {});
      return `HTTP ${e.status}: ${body.slice(0, 300)}`;
    }
    return String(e);
  }

  private persist(): void {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          this.slots.map((s) => ({
            slot: s.slot,
            token: s.token,
            refreshToken: s.refreshToken,
            empId: s.empId,
            userName: s.userName,
            name: s.name,
          }))
        )
      );
    } catch {
      /* private mode or storage disabled - tokens simply do not survive a reload */
    }
  }

  private restore(): void {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      for (const saved of JSON.parse(raw) as SlotState[]) {
        const state = this.slotFor(saved.slot);
        if (!state) continue;
        state.token = saved.token ?? '';
        state.refreshToken = saved.refreshToken;
        state.empId = saved.empId;
        state.userName = saved.userName;
        state.name = saved.name;
        state.expiresAt = state.token ? this.expiryOf(state.token) : undefined;
      }
    } catch {
      /* ignore malformed storage */
    }
  }
}
