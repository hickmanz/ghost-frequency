from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Callable

_last_ms_per_bar: float | None = None


def get_ms_per_bar() -> float | None:
    return _last_ms_per_bar


@dataclass
class GpuJob:
    fn: Callable[[], dict[str, Any]]
    future: asyncio.Future


_queue: asyncio.Queue[GpuJob | None] | None = None
_worker_task: asyncio.Task | None = None


async def _worker() -> None:
    global _last_ms_per_bar
    assert _queue is not None
    while True:
        job = await _queue.get()
        if job is None:
            break
        t0 = time.perf_counter()
        try:
            result = await asyncio.get_running_loop().run_in_executor(None, job.fn)
            bars = max(1, int((result.get("endBeat", 4) - result.get("startBeat", 0)) // 4))
            _last_ms_per_bar = (time.perf_counter() - t0) * 1000 / bars
            job.future.set_result(result)
        except Exception as exc:
            job.future.set_exception(exc)
        finally:
            _queue.task_done()


def ensure_gpu_worker() -> None:
    global _queue, _worker_task
    if _queue is not None:
        return
    _queue = asyncio.Queue()
    _worker_task = asyncio.create_task(_worker())


async def run_gpu(fn: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    ensure_gpu_worker()
    assert _queue is not None
    loop = asyncio.get_running_loop()
    fut: asyncio.Future = loop.create_future()
    await _queue.put(GpuJob(fn=fn, future=fut))
    return await fut
