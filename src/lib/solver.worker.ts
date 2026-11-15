import { initSolver, solve, type SolveRequest } from './solver';

type Msg =
  | { type: 'init'; bytes: Uint8Array }
  | { type: 'solve'; id: number; req: Omit<SolveRequest, 'allowed'> & { allowed: string[] } };

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.type === 'init') {
    initSolver(m.bytes);
    post({ type: 'ready' });
    return;
  }
  if (m.type === 'solve') {
    try {
      const res = await solve({ ...m.req, allowed: new Set(m.req.allowed) });
      post({ id: m.id, res });
    } catch (err) {
      post({ id: m.id, res: { status: 'error', message: String(err), mode: m.req.mode, scale: 0, x: {}, supply: {}, reused: {}, shortfall: {}, missing: {}, outputs: {}, forcedReuse: [], usedWorldLimits: false, metric: 0 } });
    }
  }
};
