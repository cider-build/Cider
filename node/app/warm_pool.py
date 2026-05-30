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
import logging
import secrets
import shlex
import time
from pathlib import Path

from . import config, tart

log = logging.getLogger(__name__)

_STATE_FILE = Path.home() / ".cider" / "warm-pool.json"


def _new_id() -> str:
    return f"{config.SANDBOX_PREFIX}{secrets.token_hex(16)}"


class WarmPool:
    def __init__(self) -> None:
        self._warm: list[str] = self._load_persisted()
        self._lock = asyncio.Lock()
        # IDs currently mid-spawn (cloned + booting, not yet added to _warm).
        # Tracked by id (not just count) so the node's /sandboxes endpoint can
        # hide them from the backend reconciler — otherwise the reconciler
        # reaps every cold-spawn before it finishes booting.
        self._spawning_ids: set[str] = set()

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

    def claimed_ids(self) -> set[str]:
        """Every id the pool currently owns — ready warm + mid-spawn.

        The node's /sandboxes filter uses this to hide pool-owned VMs from the
        backend reconciler. Excluding only `warm_ids()` (as the old code did)
        left in-flight spawns visible, and the reconciler would DELETE them
        before they finished booting.
        """
        return set(self._warm) | self._spawning_ids

    def occupied_slots(self) -> int:
        """Sandboxes the pool is responsible for: ready warm + in-flight spawns.
        Subtract this from Tart's running count to get user-active."""
        return len(self._warm) + len(self._spawning_ids)

    async def adopt_or_clean(self) -> None:
        """Run once at startup. Re-adopt persisted warm ids that are still
        running. Non-warm running VMs may be active user sandboxes, so the
        backend reconciler owns deciding whether to keep or delete them.
        """
        async with self._lock:
            running = await tart.list_sandboxes()
            running_ids = {s.id for s in running if s.running}
            adopted = [i for i in self._warm if i in running_ids]
            unmanaged = running_ids - set(self._warm)
            self._warm = adopted
            self._persist()
        log.info(
            "adopt_or_clean: adopted %d warm, leaving %d non-warm running VM(s)",
            len(adopted), len(unmanaged),
        )
        for sandbox_id in adopted:
            await self._configure_vnc(sandbox_id)

    async def acquire(self) -> str:
        """Hand out a warm sandbox id if one's ready; otherwise cold-allocate.

        Either way, kicks off background top-up to refill toward the target.
        """
        # Warm-pool state can outlive the actual VM bundles (manual cleanup,
        # crash mid-delete, etc.). Pop ids until we find one whose bundle
        # really exists, dropping ghosts as we go — handing out a ghost id
        # causes every downstream Tart call to fail with "VM not found",
        # which the caller can't recover from.
        async with self._lock:
            while self._warm:
                sandbox_id = self._warm.pop(0)
                self._persist()
                if not await tart.exists(sandbox_id):
                    log.warning(
                        "acquire: dropping ghost warm id %s (bundle missing)",
                        sandbox_id,
                    )
                    continue
                log.info(
                    "acquire: warm hit %s (remaining warm=%d, spawning=%d)",
                    sandbox_id, len(self._warm), len(self._spawning_ids),
                )
                asyncio.create_task(self.top_up())
                return sandbox_id
            # Pre-reserve the id we're about to spawn so /sandboxes can hide
            # it from the reconciler immediately, not only after clone().
            sandbox_id = _new_id()
            self._spawning_ids.add(sandbox_id)
            log.warning(
                "acquire: warm pool empty — cold-allocating %s (this can take "
                "60-90s; the backend's 30s timeout will likely 504 before it returns)",
                sandbox_id,
            )

        try:
            await self._spawn_and_wait(sandbox_id)
        finally:
            async with self._lock:
                self._spawning_ids.discard(sandbox_id)
        asyncio.create_task(self.top_up())
        return sandbox_id

    async def release(self) -> None:
        """Called after a user-owned sandbox is deleted — replenish the pool."""
        if not await tart.base_ready():
            log.warning("release: base Tart VM %s missing; warm pool refill skipped", config.BASE_VM)
            return
        await self.top_up()

    async def top_up(self) -> None:
        """Bring warm count up to MAX_SANDBOXES - active.

        Spawns serially — parallel boots overwhelmed the host's vmnet/DHCP on
        Apple Silicon and we were losing one of every two spawns. Slower fill
        but reliable.
        """
        if not await tart.base_ready():
            log.warning("top_up: base Tart VM %s missing; warm pool refill skipped", config.BASE_VM)
            return
        async with self._lock:
            need = self._compute_need_locked(await self._safe_running_count())
            if need <= 0:
                return
            # Pre-reserve every id we're about to spawn so /sandboxes can hide
            # them from the reconciler immediately, not after clone() lands.
            pending_ids = [_new_id() for _ in range(need)]
            self._spawning_ids.update(pending_ids)
            log.info(
                "top_up: spawning %d warm sandbox(es) (warm=%d, in_flight_before=%d)",
                need, len(self._warm), len(self._spawning_ids) - need,
            )

        spawned_ids: list[str] = []
        try:
            for sid in pending_ids:
                spawned = False
                try:
                    await self._spawn_and_wait(sid)
                    spawned = True
                    spawned_ids.append(sid)
                finally:
                    async with self._lock:
                        self._spawning_ids.discard(sid)
                        if spawned:
                            self._warm.append(sid)
                            self._persist()
        finally:
            async with self._lock:
                log.info(
                    "top_up: done, warm pool now has %d (added %d of %d attempted)",
                    len(self._warm), len(spawned_ids), need,
                )

    async def maintain(self) -> None:
        """Background loop: re-check the pool every 30s and top up missing
        slots. Self-heals transient spawn failures and refills after restarts."""
        while True:
            await asyncio.sleep(30)
            await self.top_up()

    # ── internals ──────────────────────────────────────

    async def _safe_running_count(self) -> int:
        sandboxes = await tart.list_sandboxes()
        return sum(1 for s in sandboxes if s.running)

    def _compute_need_locked(self, running: int) -> int:
        """Inside the lock: how many warm sandboxes should we spawn right now?

        `running` is everything Tart reports — includes both warm and active
        VMs. We back out the active count by subtracting our own bookkeeping.
        """
        in_flight = len(self._spawning_ids)
        active = max(0, running - len(self._warm))
        target_warm = config.MAX_SANDBOXES - active
        slots_free = config.MAX_SANDBOXES - running - in_flight
        return max(0, min(target_warm - len(self._warm) - in_flight, slots_free))

    async def _spawn_and_wait(self, sandbox_id: str) -> None:
        """Clone + run + wait for SSH so the sandbox is actually usable.

        Caller pre-reserves the id (so /sandboxes can hide it from the
        reconciler before clone() lands) and is responsible for promoting
        it to self._warm on success.
        """
        log.info("spawn %s: clone+boot+ssh-wait starting", sandbox_id)
        started = time.monotonic()
        await tart.clone(sandbox_id)
        tart.spawn_run(sandbox_id)
        try:
            await tart.ip(sandbox_id)
            await self._wait_for_ssh(sandbox_id)
            await self._configure_vnc(sandbox_id)
        except tart.TartError as e:
            elapsed = time.monotonic() - started
            log.warning("spawn %s: FAILED after %.1fs (%s) — cleaning up", sandbox_id, elapsed, e)
            await tart.delete(sandbox_id)
            raise
        elapsed = time.monotonic() - started
        log.info("spawn %s: ready in %.1fs", sandbox_id, elapsed)

    async def _configure_vnc(self, sandbox_id: str) -> None:
        admin_password = shlex.quote(config.VM_ADMIN_PASSWORD)
        vnc_password = shlex.quote(config.VNC_PASSWORD)
        command = (
            f"printf '%s\\n' {admin_password} | sudo -S "
            "/System/Library/CoreServices/RemoteManagement/ARDAgent.app/"
            "Contents/Resources/kickstart "
            "-configure -clientopts "
            "-setvnclegacy -vnclegacy yes "
            f"-setvncpw -vncpw {vnc_password} "
            "-restart -agent"
        )
        log.info("spawn %s: configuring legacy VNC password", sandbox_id)
        result = await tart.exec_command(sandbox_id, command)
        if result.exit_code != 0:
            raise tart.TartError(result.exit_code, result.stderr or result.stdout)

    async def _wait_for_ssh(self, sandbox_id: str) -> None:
        deadline = time.monotonic() + config.START_TIMEOUT_SECONDS
        last_error = "SSH did not become ready"
        while time.monotonic() < deadline:
            result = await tart.exec_command(sandbox_id, "true")
            if result.exit_code == 0:
                return
            last_error = result.stderr or result.stdout or f"exit {result.exit_code}"
            await asyncio.sleep(2)
        raise tart.TartError(-1, last_error)
