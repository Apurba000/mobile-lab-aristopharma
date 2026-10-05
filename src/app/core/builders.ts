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

  // Increment 5: the reporting place belongs to the DATE. Taken from an explicit arg, or
  // from the pool for scenarios that still describe it per entry.
  const datePlace = args['reportingPlaceId'] ?? pool[0]?.reportingPlaceId;

  const out: any[] = [];
  for (let d = 1; d <= dayCount; d++) {
    const visits: any[] = [];
    for (let i = 0; i < take && i < pool.length; i++) {
      const c = pool[i];
      const visit: any = { chamberId: Number(c.chamberId) };
      // Doctors are identified by code since increment 4; the lookup no longer returns an id.
      if (c.doctorCode != null && `${c.doctorCode}` !== '') {
        visit.doctorCode = `${c.doctorCode}`;
      } else {
        visit.doctorId = Number(c.doctorId);
      }
      visits.push(visit);
    }
    if (visits.length) {
      out.push({
        visitDate: `${year}-${`${month}`.padStart(2, '0')}-${`${d}`.padStart(2, '0')}`,
        reportingPlaceId: Number(datePlace),
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

/**
 * A DCR create/edit body (module 20). Every part except date, doctor, chamber and the GPS fix is
 * optional, so the scenarios can switch one piece at a time: promo on/off, a colleague or none, a
 * prescription image with or without products.
 */
const dcrCall: BodyBuilder = (args, vars: Vars) => {
  const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));
  const body: any = {
    dcrDate: String(args['dcrDate'] ?? vars['today'] ?? ''),
    doctorId: num(args['doctorId'] ?? vars['doctorId']),
    chamberId: num(args['chamberId'] ?? vars['chamberId']),
    promo: [],
    visitedWith: [],
    rxProducts: [],
  };

  // Omitted on purpose by the "no GPS" case, which must be refused (B32).
  const lat = args['latitude'] ?? vars['latitude'] ?? 23.8103;
  const lng = args['longitude'] ?? vars['longitude'] ?? 90.4125;
  if (args['omitGps'] !== true) {
    body.latitude = num(lat);
    body.longitude = num(lng);
  }

  const promoCode = args['promoCode'] ?? vars['promoCode'];
  const promoQty = num(args['promoQty']);
  if (promoCode && promoQty !== undefined) {
    body.promo.push({ promoCode: String(promoCode), qty: promoQty });
    // The duplicate case sends the same item twice, which must be a 400 rather than a sum (B18).
    if (args['duplicatePromo'] === true) body.promo.push({ promoCode: String(promoCode), qty: promoQty });
  }

  const colleague = num(args['visitedWithEmpId']);
  if (colleague !== undefined) {
    body.visitedWith.push({ empId: colleague });
    if (args['duplicateColleague'] === true) body.visitedWith.push({ empId: colleague });
  }

  const rxImageBase64 = args['rxImageBase64'] ?? vars['rxImageBase64'];
  if (rxImageBase64) body.rxImageBase64 = String(rxImageBase64);

  const pCode = args['pCode'] ?? vars['pCode'];
  if (pCode) {
    body.rxProducts.push({ pCode: String(pCode) });
    if (args['duplicateProduct'] === true) body.rxProducts.push({ pCode: String(pCode) });
  }

  return body;
};

export const BUILDERS: Record<string, BodyBuilder> = {
  dcrCall,
  visitPlanMonth,
  visitPool,
  reportingPlaceRequest,
};
