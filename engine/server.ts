import { validateFiner } from '../src/lib/finerExecution';
import { runResearch } from '../src/lib/research';
import { isValidMarketData } from '../src/lib/data';
import { advanceReplay, alertCommand } from '../src/lib/alerts';
import { applyCheckpoint } from '../src/lib/checkpoints';
import { initializeLive, applyLiveTick } from '../src/lib/liveEngine';
import { createServer } from 'node:http';
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from 'node:worker_threads';
import {
  submitOrder,
  cancelOrder,
  closePosition,
  editBracket,
} from '../src/lib/engine';
import {
  runStrategy,
  optimizeStrategy,
  validateStrategy,
} from '../src/lib/strategy';
import { isValidSession } from '../src/lib/session';

if (!isMainThread) {
  try {
    parentPort!.postMessage({
      result: workerData.research
        ? runResearch(
            workerData.strategy,
            workerData.bars,
            workerData.parameters ?? [],
            workerData.research,
            workerData.split,
            (completed, total) =>
              parentPort!.postMessage({ progress: { completed, total } }),
          )
        : workerData.parameters?.length
          ? optimizeStrategy(
              workerData.strategy,
              workerData.bars,
              workerData.parameters,
              workerData.split,
              (completed, total, partialCandidate) =>
                parentPort!.postMessage({
                  progress: { completed, total },
                  partialCandidate,
                }),
            )
          : runStrategy(
              workerData.strategy,
              workerData.bars,
              1,
              workerData.bars.length,
              (completed, total) =>
                parentPort!.postMessage({ progress: { completed, total } }),
            ),
    });
  } catch (error) {
    parentPort!.postMessage({ error: (error as Error).message });
  }
} else {
  const jobs = new Map<
    string,
    {
      status: string;
      result?: unknown;
      error?: string;
      worker?: Worker;
      input?: unknown;
      progress?: { completed: number; total: number };
      candidates?: unknown[];
    }
  >();
  const queue: string[] = [];
  let active: string | null = null;
  function pump() {
    if (active || !queue.length) return;
    const id = queue.shift()!,
      job = jobs.get(id)!;
    active = id;
    job.status = 'running';
    const worker = new Worker(__filename, { workerData: job.input });
    job.worker = worker;
    worker.on('message', (message) => {
      if (message.progress) {
        job.progress = message.progress;
        if (message.partialCandidate)
          job.candidates = [
            ...(job.candidates ?? []),
            message.partialCandidate,
          ];
        return;
      }
      job.result = message.result;
      job.error = message.error;
      job.status = message.error ? 'failed' : 'completed';
    });
    worker.once('error', (error) => {
      job.error = error.message;
      job.status = 'failed';
    });
    worker.once('exit', () => {
      if (job.status === 'running') {
        job.status = 'failed';
        job.error = 'Worker exited unexpectedly';
      }
      delete job.worker;
      delete job.input;
      active = null;
      pump();
    });
  }
  createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const send = (status: number, value: unknown) => {
      response.statusCode = status;
      response.end(
        JSON.stringify(value, (_key, v) =>
          typeof v === 'number' && !Number.isFinite(v) ? null : v,
        ),
      );
    };
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 64 * 1024 * 1024) throw new Error('Request too large');
        chunks.push(chunk);
      }
      const body = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString())
        : {};
      if (request.url === '/health') return send(200, { status: 'ok' });
      if (request.url === '/validate-strategy') {
        validateStrategy(body);
        return send(200, { valid: true });
      }
      if (request.url === '/validate-market')
        return send(200, { valid: isValidMarketData(body) });
      if (request.url === '/validate')
        return send(200, { valid: isValidSession(body) });
      if (request.url === '/initialize')
        return send(200, initializeLive(body.market, body.config));
      if (request.url === '/live-tick')
        return send(
          200,
          applyLiveTick(
            body.session,
            body.market,
            body.pending,
            body.resumeAfter,
          ),
        );
      if (request.url === '/command') {
        const { session, command } = body;
        const bar = session.market.bars[session.cursor];
        if (!bar || !session.account) throw new Error('Invalid session');
        let next = { ...session };
        if (command.type === 'finer-data') {
          if (command.market) validateFiner(session.market, command.market);
          next = { ...session, finerMarket: command.market ?? undefined };
        } else if (command.type === 'alert')
          next = alertCommand(session, command);
        else if (command.type === 'checkpoint') {
          if (command.action === 'restore')
            throw new Error(
              'Restore checkpoints into a new session to preserve the original journal.',
            );
          next = applyCheckpoint(session, command);
        } else if (command.type === 'order')
          next.account = submitOrder(session.account, command.order, bar);
        else if (command.type === 'cancel')
          next.account = cancelOrder(session.account, command.id);
        else if (command.type === 'close')
          next.account = closePosition(session.account, bar);
        else if (command.type === 'bracket')
          next.account = editBracket(
            session.account,
            command.stopLoss,
            command.takeProfit,
            bar,
          );
        else if (command.type === 'advance') {
          next = advanceReplay(session, command.target ?? session.cursor + 1);
        } else throw new Error('Unknown command');
        return send(200, next);
      }
      if (request.url === '/jobs' && request.method === 'POST') {
        if (queue.length >= 10)
          return send(429, { detail: 'Strategy queue is full' });
        const id = crypto.randomUUID();
        jobs.set(id, { status: 'queued', input: body });
        queue.push(id);
        pump();
        return send(202, { id, status: jobs.get(id)!.status });
      }
      const id = request.url?.split('/')[2],
        job = id ? jobs.get(id) : undefined;
      if (job) {
        if (request.method === 'DELETE') {
          job.status = 'cancelled';
          if (job.worker) await job.worker.terminate();
          const at = queue.indexOf(id!);
          if (at >= 0) queue.splice(at, 1);
        }
        const { worker: _worker, input: _input, ...publicJob } = job;
        return send(200, publicJob);
      }
      send(404, { detail: 'Not found' });
    } catch (error) {
      send(400, { detail: (error as Error).message });
    }
  }).listen(
    Number(process.env.ENGINE_PORT ?? 8003),
    process.env.ENGINE_HOST ?? '127.0.0.1',
  );
}
