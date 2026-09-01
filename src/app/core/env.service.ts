import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { EnvDef, RequestDef } from './models';

/**
 * Environment selection and the production write guard.
 *
 * The guard exists because this tool writes real data. A worst-path run against prod would
 * create visit plans and reporting-place requests that real field users then see on their
 * phones, so non-GET is refused there until someone deliberately unlocks it.
 */
@Injectable({ providedIn: 'root' })
export class EnvService {
  environments: EnvDef[] = [];
  current: EnvDef | null = null;
  loadError = '';

  /** Set by typing the environment name; consumed by the next run, then re-armed. */
  private writeUnlock = false;

  constructor(private http: HttpClient) {}

  async load(): Promise<void> {
    for (const file of ['environments.json', 'environments.sample.json']) {
      try {
        const cfg = await firstValueFrom(this.http.get<{ environments: EnvDef[] }>(file));
        this.environments = cfg?.environments ?? [];
        if (this.environments.length) {
          this.current = this.environments[0];
          if (file.includes('sample')) {
            this.loadError =
              'Using environments.sample.json — copy it to environments.json and fill in the real base URLs.';
          }
          return;
        }
      } catch {
        /* try the next candidate */
      }
    }
    this.loadError = 'No environments.json or environments.sample.json could be loaded.';
  }

  select(key: string): void {
    this.current = this.environments.find((e) => e.key === key) ?? this.current;
    this.writeUnlock = false;
  }

  get baseUrl(): string {
    return this.current?.baseUrl?.replace(/\/$/, '') ?? '';
  }

  get writesBlocked(): boolean {
    return !!this.current && !this.current.writesAllowed && !this.writeUnlock;
  }

  get unlocked(): boolean {
    return this.writeUnlock;
  }

  /** Unlocks writes for this environment if the typed name matches. */
  tryUnlock(typed: string): boolean {
    if (!this.current) return false;
    const ok = typed.trim().toLowerCase() === this.current.key.toLowerCase();
    this.writeUnlock = ok;
    return ok;
  }

  relock(): void {
    this.writeUnlock = false;
  }

  /** Engine guard: returns a refusal reason, or null to allow. */
  guard = (req: RequestDef): string | null => {
    if (req.method === 'GET') return null;
    if (!this.writesBlocked) return null;
    return `blocked — ${req.method} is not allowed on ${this.current?.label}. Unlock writes first.`;
  };
}
