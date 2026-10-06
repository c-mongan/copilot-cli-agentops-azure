"""Process-scoped launcher for direct attached Python script commands."""

import os
from pathlib import Path
import signal
import subprocess
import sys
import time

from agentops_script import observe_script
from sitecustomize import _attached_script_name


_FORWARDED_SIGNALS = tuple(
    value for value in (getattr(signal, "SIGINT", None), getattr(signal, "SIGTERM", None), getattr(signal, "SIGHUP", None))
    if value is not None
)
_CLEANUP_GRACE_SECONDS = 2.0


def _real_interpreter():
    wrapper_name = Path(os.environ.get("AGENTOPS_PYTHON_WRAPPER_NAME", "python3")).name
    key = "AGENTOPS_REAL_PYTHON3" if wrapper_name == "python3" else "AGENTOPS_REAL_PYTHON"
    value = os.environ.get(key, "")
    if not value or not Path(value).is_absolute():
        raise RuntimeError(f"missing scoped real interpreter: {key}")
    return value


def _exec_plain(real_interpreter, arguments):
    os.execv(real_interpreter, [real_interpreter, *arguments])


def main(arguments=None):
    arguments = list(sys.argv[1:] if arguments is None else arguments)
    real_interpreter = _real_interpreter()
    if not arguments:
        _exec_plain(real_interpreter, arguments)
    script_name = _attached_script_name(arguments[0])
    if script_name is None:
        _exec_plain(real_interpreter, arguments)

    child_environment = os.environ.copy()
    child_environment["AGENTOPS_PYTHON_LAUNCHER_CHILD"] = "1"
    child = None
    forwarded = {"signal": None, "at": None}
    original_handlers = {}

    def forward(signum, _frame):
        if forwarded["signal"] is None:
            forwarded["signal"] = signum
            forwarded["at"] = time.monotonic()
        if child is not None:
            try:
                child.send_signal(signum)
            except ProcessLookupError:
                pass

    for signum in _FORWARDED_SIGNALS:
        original_handlers[signum] = signal.getsignal(signum)
        signal.signal(signum, forward)

    return_code = None
    try:
        with observe_script(script_name) as observation:
            child = subprocess.Popen([real_interpreter, *arguments], env=child_environment)
            if forwarded["signal"] is not None:
                try:
                    child.send_signal(forwarded["signal"])
                except ProcessLookupError:
                    pass
            while return_code is None:
                try:
                    return_code = child.wait(timeout=0.1)
                except subprocess.TimeoutExpired:
                    if (forwarded["at"] is not None
                            and time.monotonic() - forwarded["at"] >= _CLEANUP_GRACE_SECONDS):
                        child.kill()
                        return_code = child.wait()
            observation.record_process_result(
                exit_code=return_code if return_code >= 0 else None,
                signal_number=-return_code if return_code < 0 else None,
                child_pid=child.pid,
            )
    finally:
        for signum, handler in original_handlers.items():
            signal.signal(signum, handler)
        if child is not None and return_code is None and child.poll() is None:
            child.kill()
            child.wait()

    report_signal = -return_code if return_code < 0 else None
    if report_signal is not None:
        try:
            signal.signal(report_signal, signal.SIG_DFL)
        except OSError:
            # SIGKILL and SIGSTOP cannot have handlers; sending either still
            # reproduces the child's actual terminal signal.
            pass
        os.kill(os.getpid(), report_signal)
    return return_code


if __name__ == "__main__":
    raise SystemExit(main())
