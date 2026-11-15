/**
 * Runs the solver in background workers so the page stays responsive.
 * If a worker can't start (some browsers restrict workers for pages opened from a file),
 * it falls back to solving on the page itself.
 */
import SolverWorker from './solver.worker?worker&inline';
import wasmB64 from 'virtual:highs-wasm';
import { decodeB64, type SolveRequest, type SolveResult } from './solverTypes';

let bytes: Uint8Array | null = null;
const getBytes = () => (bytes ??= decodeB64(wasmB64));

let localSolver: Promise<typeof import('./solver')> | null = null;
async function solveLocally(req: SolveRequest): Promise<SolveResult> {
  localSolver ??= import('./solver').then((m) => {
    m.initSolver(getBytes());
    return m;
  });
  const m = await localSolver;
  // let the browser paint before a long synchronous solve
  await new Promise((r) => setTimeout(r, 0));
  return m.solve(req);
}

let workersBroken = false;

class Lane {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: SolveResult) => void; reject: (e: unknown) => void }>();

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      let w: Worker;
      try {
        w = new SolverWorker();
      } catch (e) {
        reject(e);
        return;
      }
      const timer = setTimeout(() => reject(new Error('worker did not start')), 6000);
      w.onmessage = (e: MessageEvent<any>) => {
        if (e.data?.type === 'ready') {
          clearTimeout(timer);
          resolve();
          return;
        }
        const p = this.pending.get(e.data.id);
        if (p) {
          this.pending.delete(e.data.id);
          p.resolve(e.data.res);
        }
      };
      w.onerror = (e) => {
        clearTimeout(timer);
        reject(e);
        for (const p of this.pending.values()) p.reject(e);
        this.pending.clear();
        this.stop();
      };
      const copy = getBytes().slice();
      w.postMessage({ type: 'init', bytes: copy }, [copy.buffer]);
      this.worker = w;
    });
    return this.ready;
  }

  private stop() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }

  async solve(req: SolveRequest): Promise<SolveResult> {
    if (!workersBroken && typeof Worker !== 'undefined') {
      try {
        await this.start();
      } catch {
        workersBroken = true;
        this.stop();
      }
    }
    if (workersBroken || !this.worker) return solveLocally(req);
    const w = this.worker;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ type: 'solve', id, req: { ...req, allowed: [...req.allowed] } });
    });
  }

  /** Stop whatever this lane is doing (pending promises reject). */
  cancel() {
    if (!this.worker) return;
    this.stop();
    for (const p of this.pending.values()) p.reject(new Error('cancelled'));
    this.pending.clear();
  }

  get busy() {
    return this.pending.size > 0;
  }
}

/** Main plan solves */
export const mainLane = new Lane();
/** Background what-if solves (suggestions, hard drive advisor) */
export const adviceLane = new Lane();
