"""Pre-booted sandbox pool.

Apple's Virtualization framework caps concurrent macOS guests at 2 per host.
We use the slack between active sandboxes and that cap to pre-boot warm clones
in the background. On Create, we hand the caller a warm one (instant) and kick
off another to refill — so steady-state, every Create is effectively free.

Invariants:
  - len(warm) + active + in-flight spawns ≤ MAX_SANDBOXES
  - sandboxes in `self._warm` are SSH-reachable (we wait before adding)

State persistence:
  The warm list is persisted to ~/.cider/warm-pool.json so dev reloads
  (uvicorn --reload) and process restarts don't lose track of warmed VMs.
"""
import asyncio
import json
import os
import secrets
from pathlib import Path

from . import ciderctl, config

_STATE_FILE = Path.home() / ".cider" / "warm-pool.json"


def _new_id() -> str:
    return secrets.token_hex(16)


class WarmPool:
    def __init__(self) -> None:
        self._warm: list[str] = self._load_persisted()
        self._lock = asyncio.Lock()
        # Spawns currently in flight (cloned + booting, not yet added to _warm).
        # Counted toward the 2-VM cap so we don't over-spawn.
        self._spawning: int = 0

    @staticmethod
    def _load_persisted() -> list[str]:
        try:
            data = json.loads(_STATE_FILE.read_text())
            ids = data.get("warm", [])
            if isinstance(ids, list):
                return [str(i) for i in ids]
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        return []

    def _persist(self) -> None:
        try:
            _STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
            _STATE_FILE.write_text(json.dumps({"warm": self._warm}))
        except OSError:
            pass

    def warm_ids(self) -> list[str]:
        return list(self._warm)

    def occupied_slots(self) -> int:
        """Sandboxes the pool is responsible for: ready warm + in-flight spawns.
        Subtract this from ciderctl's running count to get user-active."""
        return len(self._warm) + self._spawning

    async def adopt_or_clean(self) -> None:
        """Run once at startup. Re-adopt persisted warm ids that are still
        running; delete anything ciderctl thinks is running that we don't have
        a record of (orphan from a crashed/reloaded previous process). Without
        this, we leak running VMs across restarts and eat through the 2-VM cap.
        """
        async with self._lock:
            try:
                running = await ciderctl.list_sandboxes()
            except ciderctl.CtlError:
                return
            running_ids = {s.id for s in running if s.running}
            adopted = [i for i in self._warm if i in running_ids]
            orphans = running_ids - set(self._warm)
            self._warm = adopted
            self._persist()
        for o in orphans:
            try:
                await ciderctl.delete(o)
            except ciderctl.CtlError:
                pass

    async def acquire(self) -> str:
        """Hand out a warm sandbox id if one's ready; otherwise cold-allocate.

        Either way, kicks off background top-up to refill toward the target.
        """
        async with self._lock:
            if self._warm:
                sandbox_id = self._warm.pop(0)
                self._persist()
                asyncio.create_task(self.top_up())
                return sandbox_id
            self._spawning += 1

        try:
            sandbox_id = await self._spawn_and_wait()
        finally:
            async with self._lock:
                self._spawning -= 1
        asyncio.create_task(self.top_up())
        return sandbox_id

    async def release(self) -> None:
        """Called after a user-owned sandbox is deleted — replenish the pool."""
        await self.top_up()

    async def top_up(self) -> None:
        """Bring warm count up to MAX_SANDBOXES - active.

        Spawns serially — parallel boots overwhelmed the host's vmnet/DHCP on
        Apple Silicon and we were losing one of every two spawns. Slower fill
        but reliable.
        """
        async with self._lock:
            need = self._compute_need_locked(await self._safe_running_count())
            if need <= 0:
                return
            self._spawning += need

        spawned_ids: list[str] = []
        try:
            for _ in range(need):
                try:
                    sid = await self._spawn_and_wait()
                    spawned_ids.append(sid)
                except (ciderctl.CtlError, OSError):
                    # One spawn failed; keep going so we at least get the rest.
                    # The periodic maintain task will retry the missing slot.
                    continue
        finally:
            async with self._lock:
                self._spawning -= need
                self._warm.extend(spawned_ids)
                self._persist()

    async def maintain(self) -> None:
        """Background loop: re-check the pool every 30s and top up missing
        slots. Self-heals transient spawn failures and refills after restarts."""
        while True:
            try:
                await asyncio.sleep(30)
                await self.top_up()
            except asyncio.CancelledError:
                raise
            except Exception:
                # Don't let one bad iteration kill the loop.
                pass

    # ── internals ──────────────────────────────────────

    async def _safe_running_count(self) -> int:
        try:
            sandboxes = await ciderctl.list_sandboxes()
        except ciderctl.CtlError:
            return 0
        return sum(1 for s in sandboxes if s.running)

    def _compute_need_locked(self, running: int) -> int:
        """Inside the lock: how many warm sandboxes should we spawn right now?

        `running` is everything ciderctl reports — includes both warm and active
        VMs. We back out the active count by subtracting our own bookkeeping.
        """
        active = max(0, running - len(self._warm))
        target_warm = config.MAX_SANDBOXES - active
        slots_free = config.MAX_SANDBOXES - running - self._spawning
        return max(0, min(target_warm - len(self._warm) - self._spawning, slots_free))

    async def _spawn_and_wait(self) -> str:
        """Clone + run + wait for SSH so the sandbox is actually usable."""
        sandbox_id = _new_id()
        await ciderctl.clone(sandbox_id)
        ciderctl.spawn_run(sandbox_id)
        try:
            # `true` exits 0 immediately on the guest; the ciderctl exec wrapper
            # does the IP + SSH wait internally, so success == "fully ready".
            await ciderctl.exec_command(sandbox_id, "true")
        except ciderctl.CtlError:
            # Boot failed or timed out. Clean up so we don't leak.
            try:
                await ciderctl.delete(sandbox_id)
            except ciderctl.CtlError:
                pass
            raise
        return sandbox_id
