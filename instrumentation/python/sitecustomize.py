"""Opt-in automatic root spans for attached Python skill scripts.

Python imports ``sitecustomize`` at interpreter startup. This module stays
silent unless the explicit AgentOps Copilot launcher supplies a run ID and a
valid attached-repository manifest, and the current script still matches its
recorded hash.
"""

import atexit
import hashlib
import json
import os
from pathlib import Path
import sys


MAX_MANIFEST_BYTES = 5 * 1024 * 1024
MAX_SCRIPT_BYTES = 2 * 1024 * 1024


def _attached_script_name(script_value=None):
    run_id = os.environ.get("AGENTOPS_RUN_ID", "")
    session_id = os.environ.get("AGENTOPS_SESSION_ID", "")
    repo_value = os.environ.get("AGENTOPS_REPO_ROOT", "")
    manifest_value = os.environ.get("AGENTOPS_ATTACHMENT_MANIFEST", "")
    if not run_id or not repo_value or not manifest_value:
        return None

    try:
        repo = Path(repo_value).resolve(strict=True)
        manifest = Path(manifest_value).resolve(strict=True)
        expected_manifest = (repo / ".agentops" / "attachment.json").resolve(strict=True)
        if manifest != expected_manifest or manifest.stat().st_size > MAX_MANIFEST_BYTES:
            return None
        payload = json.loads(manifest.read_text(encoding="utf-8"))
        if payload.get("managedBy") != "copilot-agentops" or payload.get("schemaVersion") != 1:
            return None

        script = Path(script_value if script_value is not None else sys.argv[0]).resolve(strict=True)
        relative = script.relative_to(repo).as_posix()
        if script.stat().st_size > MAX_SCRIPT_BYTES:
            return None
        architecture = payload.get("architecture", {})
        scripts = architecture.get("runtimeScripts")
        if scripts is None:
            # Read attachments created before repository-wide script discovery.
            scripts = [item for skill in architecture.get("skills", []) for item in skill.get("scripts", [])]
        for item in scripts:
            if item.get("path") != relative or not item.get("sha256"):
                continue
            digest = hashlib.sha256(script.read_bytes()).hexdigest()
            if digest == item["sha256"]:
                return relative
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None
    return None


def _start_observation():
    if os.environ.get("AGENTOPS_PYTHON_LAUNCHER_CHILD") == "1":
        return
    script_name = _attached_script_name()
    if script_name is None:
        return
    try:
        from agentops_script import observe_script

        # CPython does not call excepthook for SystemExit. An atexit callback
        # cannot distinguish normal exit from sys.exit(7), so it must not
        # assert success. The launching shell supplies the process exit result.
        manager = observe_script(script_name, outcome_unknown=True)
        manager.__enter__()
    except Exception:
        # Telemetry setup must never prevent an owned script from running.
        return

    finished = False

    def finish(exc_type=None, exc=None, traceback=None):
        nonlocal finished
        if finished:
            return
        finished = True
        try:
            manager.__exit__(exc_type, exc, traceback)
        except Exception:
            # Export and shutdown errors are separate from the script result.
            pass

    original_hook = sys.excepthook

    def exception_hook(exc_type, exc, traceback):
        finish(exc_type, exc, traceback)
        original_hook(exc_type, exc, traceback)

    sys.excepthook = exception_hook
    atexit.register(finish)


_start_observation()
