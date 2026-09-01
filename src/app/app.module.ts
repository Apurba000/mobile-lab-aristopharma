import { NgModule, provideZoneChangeDetection } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { provideHttpClient } from '@angular/common/http';

import { AppComponent } from './app.component';
import { AuthPanelComponent } from './features/auth-panel.component';
import { ScenarioRunnerComponent } from './features/scenario-runner.component';
import { RequestConsoleComponent } from './features/request-console.component';
import { CoverageMatrixComponent } from './features/coverage-matrix.component';
import { StepCardComponent } from './features/step-card.component';

@NgModule({
  declarations: [
    AppComponent,
    AuthPanelComponent,
    ScenarioRunnerComponent,
    RequestConsoleComponent,
    CoverageMatrixComponent,
    StepCardComponent,
  ],
  imports: [BrowserModule, FormsModule],
  providers: [
    // Angular 21+ defaults to ZONELESS change detection, and every component here mutates
    // plain fields from promise callbacks. This provider alone did NOT restore automatic
    // repainting even with zone.js bundled, so each component also calls
    // ChangeDetectorRef.detectChanges() after its async work - the same pattern the product
    // SPA uses in its list components. This stays as defence in depth; the explicit calls
    // are what actually guarantee the view updates.
    provideZoneChangeDetection(),
    provideHttpClient(),
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
