/** Authenticated GET /model-report (Bearer run token in the Authorization header only, never in a URL). */
import { deckHttpBase } from './settingsApi';
import type { ModelReportResponse } from './types';

export type ReportQuery = { days: number; auto: boolean; fresh?: boolean };
/** `?days=30&auto=0` (days: 7 | 30 | 90 | 0 = all history); `&fresh=1` = wait for a rescan first ("Refresh" only). */
export const reportQs = (p: ReportQuery) => `?days=${Math.max(0, Math.floor(p.days) || 0)}&auto=${p.auto ? 1 : 0}${p.fresh ? '&fresh=1' : ''}`;
/** HTTP failure; status 0 = network error, -1 = response was not JSON. */
export class ReportHttpError extends Error {
  status: number;
  constructor(status: number) { super(`model-report ${status}`); this.name = 'ReportHttpError'; this.status = status; }
}
export async function fetchModelReport(token: string, p: ReportQuery, signal?: AbortSignal): Promise<ModelReportResponse> {
  let r: Response;
  try { r = await fetch(`${deckHttpBase()}/model-report${reportQs(p)}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, cache: 'no-store', signal }); }
  catch (e) { if (signal?.aborted) throw e; throw new ReportHttpError(0); }
  if (!r.ok) throw new ReportHttpError(r.status);
  try { return (await r.json()) as ModelReportResponse; } catch (e) { if (signal?.aborted) throw e; throw new ReportHttpError(-1); }
}
export const reportStatus = (e: unknown) => e instanceof ReportHttpError ? e.status : 0;
