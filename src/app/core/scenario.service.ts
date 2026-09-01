import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ScenarioFile } from './models';

/**
 * Scenarios are loaded as JSON assets, not compiled in. That is what keeps them the single
 * source of truth: a CLI runner can read the very same files without touching this app.
 */
@Injectable({ providedIn: 'root' })
export class ScenarioService {
  files: ScenarioFile[] = [];
  error = '';

  /**
   * Cached so every caller awaits the same load. Whoever needs scenarios can ask for them
   * without knowing whether someone else already did - no ordering assumptions.
   */
  private inflight: Promise<void> | null = null;

  constructor(private http: HttpClient) {}

  ensureLoaded(): Promise<void> {
    if (!this.inflight) {
      this.inflight = this.load();
    }
    return this.inflight;
  }

  async load(): Promise<void> {
    try {
      const index = await firstValueFrom(
        this.http.get<{ files: string[] }>('scenarios/index.json')
      );
      const loaded: ScenarioFile[] = [];
      for (const name of index.files ?? []) {
        loaded.push(await firstValueFrom(this.http.get<ScenarioFile>(`scenarios/${name}`)));
      }
      this.files = loaded;
    } catch (e) {
      this.error = `Could not load scenarios: ${e}`;
    }
  }
}
