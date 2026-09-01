/**
 * Body builders for payloads too dynamic to express as literal JSON in a scenario file.
 *
 * Kept deliberately few: the moment scenarios need arbitrary code they stop being data, and
 * the CLI-reuse property goes with it. Anything here should be about *shape*, never about
 * business rules.
 */

import { BodyBuilder, Vars } from './engine';

/**
 * Builds a visit-plan month from a pool of place/doctor/chamber triples.
 *
 * A repeated place+doctor+chamber inside one date is a 400, so each date takes distinct
 * entries from the pool; different dates may reuse them freely.
 */
const visitPlanMonth: BodyBuilder = (args, vars: Vars) => {
  const year = Number(args['year'] ?? vars['year']);
  const month = Number(args['month'] ?? vars['month']);
  const dates = Number(args['dates'] ?? 3);
  const perDate = Number(args['perDate'] ?? 2);
  const pool = (args['pool'] as any[]) ?? (vars['visitPool'] as any[]) ?? [];

  const daysInMonth = new Date(year, month, 0).getDate();
  const dayCount = Math.min(dates, daysInMonth);
  const take = Math.min(perDate, Math.max(pool.length, 1));

  const out: any[] = [];
  for (let d = 1; d <= dayCount; d++) {
    const visits: any[] = [];
    for (let i = 0; i < take && i < pool.length; i++) {
      const c = pool[i];
      visits.push({
        reportingPlaceId: Number(c.reportingPlaceId),
        doctorId: Number(c.doctorId),
        chamberId: Number(c.chamberId),
      });
    }
    if (visits.length) {
      out.push({
        visitDate: `${year}-${`${month}`.padStart(2, '0')}-${`${d}`.padStart(2, '0')}`,
        visits,
      });
    }
  }
  // No terrId: a plan is scoped to the employee, not a territory (MSFA increment 4).
  return { planYear: year, planMonth: month, dates: out };
};

/**
 * Crosses reporting places with doctor/chamber pairs into distinct triples, so a date can be
 * filled without repeating one. Reads the raw lookup responses captured by earlier steps.
 */
const visitPool: BodyBuilder = (args, vars: Vars) => {
  const places = (args['places'] as any[]) ?? [];
  const pairs = (args['pairs'] as any[]) ?? [];
  const out: any[] = [];
  for (const p of places) {
    for (const q of pairs) {
      out.push({
        reportingPlaceId: p.value ?? p.Value,
        doctorId: q.doctorId,
        chamberId: q.chamberId,
      });
    }
  }
  return out;
};

/** A reporting-place request body with a stamped name so re-runs never collide. */
const reportingPlaceRequest: BodyBuilder = (args, vars: Vars) => ({
  name: `Lab RP ${vars['stamp']}`,
  address: 'Mobile Lab generated address, Dhaka',
  latitude: Number(args['latitude'] ?? 23.81),
  longitude: Number(args['longitude'] ?? 90.41),
  terrId: String(args['terrId'] ?? vars['terrId'] ?? ''),
});

export const BUILDERS: Record<string, BodyBuilder> = {
  visitPlanMonth,
  visitPool,
  reportingPlaceRequest,
};
