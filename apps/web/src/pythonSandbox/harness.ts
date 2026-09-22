/**
 * The trusted Python test harness executed inside the Pyodide runtime.
 *
 * The harness is a constant: learner source and authored test values are passed
 * as a JSON string and decoded with `json.loads`. Nothing from the request is
 * interpolated into executable Python, and test values are never `eval`ed.
 *
 * It compiles the learner program with an explicit `<learner>` filename so
 * runtime errors can be attributed to the learner's source rather than to this
 * harness, redirects and bounds stdout/stderr, and returns a JSON string.
 */
export const PYTHON_HARNESS = String.raw`
import builtins as _builtins
import contextlib as _contextlib
import difflib as _difflib
import io as _io
import json as _json
import os as _os
import sys as _sys
import traceback as _traceback

# The sandbox runs in a worker with no DOM, so force a non-interactive
# matplotlib backend. This is also required for matplotlib to import at all.
_os.environ.setdefault("MPLBACKEND", "Agg")

# Defense in depth only. The security boundary is the isolated sandbox origin
# plus CSP, never import filtering. Learner code can still reach Pyodide's
# JavaScript bridge; see docs/14-security-privacy.md.
_BLOCKED_IMPORTS = {"micropip"}


class _BlockedImportFinder:
    def find_spec(self, fullname, path=None, target=None):
        root = fullname.split(".", 1)[0]
        if root in _BLOCKED_IMPORTS:
            raise ImportError(
                "module %r is not available in this environment" % root
            )
        return None


if "_AL_PYTHON_HARNESS_READY" not in globals():
    _sys.meta_path.insert(0, _BlockedImportFinder())
    _AL_PYTHON_HARNESS_READY = True


class _BoundedWriter(_io.TextIOBase):
    def __init__(self, limit):
        self._limit = max(0, int(limit))
        self._parts = []
        self._size = 0
        self.truncated = False

    def writable(self):
        return True

    def write(self, text):
        if not isinstance(text, str):
            text = str(text)
        if self._size >= self._limit:
            self.truncated = True
            return len(text)
        remaining = self._limit - self._size
        if len(text) > remaining:
            text = text[:remaining]
            self.truncated = True
        self._parts.append(text)
        self._size += len(text)
        return len(text)

    def flush(self):
        return None

    def getvalue(self):
        return "".join(self._parts)


def _describe(value):
    try:
        text = repr(value)
    except Exception:
        text = "<unrepresentable>"
    if len(text) > 200:
        text = text[:200] + "..."
    return text


def _deep_equal(actual, expected):
    # Every branch returns a plain Python bool so results stay JSON-serializable
    # even when comparisons yield NumPy scalars or arrays.
    if isinstance(actual, bool) or isinstance(expected, bool):
        return bool(actual is expected)
    if actual is None or expected is None:
        return bool(actual is expected)
    if isinstance(actual, (int, float)) and isinstance(expected, (int, float)):
        return bool(actual == expected)
    if isinstance(actual, str) and isinstance(expected, str):
        return bool(actual == expected)
    if isinstance(expected, list):
        if not isinstance(actual, (list, tuple)) or len(actual) != len(expected):
            return False
        return all(_deep_equal(a, e) for a, e in zip(actual, expected))
    if isinstance(expected, dict):
        if not isinstance(actual, dict) or set(actual) != set(expected):
            return False
        return all(_deep_equal(actual[key], expected[key]) for key in expected)
    try:
        return bool(actual == expected)
    except Exception:
        # Elementwise comparisons (for example NumPy arrays) are not a single
        # truth value; treat them as not equal rather than crashing.
        return False


def _source_line(source, lineno):
    lines = source.splitlines()
    if lineno is None or lineno < 1 or lineno > len(lines):
        return None
    return lines[lineno - 1]


def _format_traceback(exc):
    frames = [
        frame
        for frame in _traceback.extract_tb(exc.__traceback__)
        if frame.filename == "<learner>"
    ]
    parts = []
    if frames:
        parts.extend(_traceback.format_list(frames))
    parts.extend(_traceback.format_exception_only(type(exc), exc))
    return "".join(parts).strip("\n")[:4000]


def _last_learner_lineno(exc):
    frames = [
        frame
        for frame in _traceback.extract_tb(exc.__traceback__)
        if frame.filename == "<learner>"
    ]
    if not frames:
        return None
    return frames[-1].lineno


def _restore_builtins(snapshot):
    current = _builtins.__dict__
    for key in list(current):
        if key not in snapshot:
            del current[key]
        elif current[key] is not snapshot[key]:
            current[key] = snapshot[key]


def _error_object(exc, source, suggestion=None):
    error = {
        "type": type(exc).__name__,
        "message": str(exc),
    }
    lineno = _last_learner_lineno(exc)
    if lineno is not None:
        error["line"] = lineno
        line = _source_line(source, lineno)
        if line is not None:
            error["sourceLine"] = line
    trace = _format_traceback(exc)
    if trace:
        error["traceback"] = trace
    if suggestion:
        error["suggestion"] = suggestion
    return error


def _name_suggestion(exc, namespace):
    name = getattr(exc, "name", None)
    if not name:
        return None
    candidates = [key for key in namespace if not key.startswith("__")]
    matches = _difflib.get_close_matches(name, candidates, n=1, cutoff=0.7)
    if matches:
        return matches[0]
    return None


def _test_name(entrypoint, test):
    kind = test.get("type")
    if kind == "stdout":
        return "stdout"
    args = test.get("args", [])
    rendered = ", ".join(_describe(arg) for arg in args)
    return "%s(%s)" % (entrypoint, rendered)


def _run(payload_text):
    payload = _json.loads(payload_text)
    source = payload.get("source", "")
    entrypoint = payload.get("entrypoint") or ""
    tests = payload.get("tests", [])
    limit = payload.get("maxStdoutBytes", 16000)

    out = _BoundedWriter(limit)
    err = _BoundedWriter(limit)
    namespace = {"__name__": "__main__", "__builtins__": _builtins}
    builtins_snapshot = dict(_builtins.__dict__)
    path_snapshot = list(_sys.path)
    env_snapshot = dict(_os.environ)

    try:
        try:
            code = compile(source, "<learner>", "exec")
        except SyntaxError as exc:
            return _json.dumps(
                {
                    "status": "syntax_error",
                    "stdout": out.getvalue(),
                    "stderr": err.getvalue(),
                    "tests": [],
                    "outputTruncated": out.truncated or err.truncated,
                    "error": {
                        "type": type(exc).__name__,
                        "message": str(exc.msg) if exc.msg else str(exc),
                        "line": exc.lineno,
                        "column": exc.offset,
                        "sourceLine": (
                            exc.text.rstrip("\n") if exc.text else _source_line(source, exc.lineno)
                        ),
                    },
                }
            )

        try:
            with _contextlib.redirect_stdout(out), _contextlib.redirect_stderr(err):
                exec(code, namespace)
        except BaseException as exc:  # noqa: BLE001 - untrusted learner code
            suggestion = None
            if isinstance(exc, NameError):
                suggestion = _name_suggestion(exc, namespace)
            return _json.dumps(
                {
                    "status": "runtime_error",
                    "stdout": out.getvalue(),
                    "stderr": err.getvalue(),
                    "tests": [],
                    "outputTruncated": out.truncated or err.truncated,
                    "error": _error_object(exc, source, suggestion),
                }
            )

        top_stdout = out.getvalue()

        callable_entry = None
        if entrypoint:
            callable_entry = namespace.get(entrypoint)
            if not callable(callable_entry):
                return _json.dumps(
                    {
                        "status": "runtime_error",
                        "stdout": top_stdout,
                        "stderr": err.getvalue(),
                        "tests": [],
                        "outputTruncated": out.truncated or err.truncated,
                        "error": {
                            "type": "NameError",
                            "message": "name '%s' is not defined" % entrypoint,
                            "sourceLine": _source_line(source, len(source.splitlines())),
                        },
                    }
                )

        results = []
        passed = 0
        for test in tests:
            kind = test.get("type")
            name = _test_name(entrypoint, test)
            args = test.get("args", [])

            if kind == "stdout":
                expected_text = str(test.get("expected", ""))
                actual_text = top_stdout
                ok = actual_text.rstrip() == expected_text.rstrip()
                results.append(
                    {
                        "name": name,
                        "passed": ok,
                        "expected": _json.dumps(expected_text),
                        "actual": _json.dumps(actual_text),
                    }
                )
            elif kind == "raises":
                expected_exc = test.get("exception", "")
                try:
                    with _contextlib.redirect_stdout(out), _contextlib.redirect_stderr(err):
                        callable_entry(*args)
                except BaseException as exc:  # noqa: BLE001 - untested exceptions are expected
                    names = [base.__name__ for base in type(exc).__mro__]
                    ok = expected_exc in names
                    results.append(
                        {
                            "name": name,
                            "passed": ok,
                            "expected": expected_exc,
                            "actual": type(exc).__name__,
                        }
                    )
                else:
                    results.append(
                        {
                            "name": name,
                            "passed": False,
                            "expected": expected_exc,
                            "actual": "no exception",
                        }
                    )
            else:
                expected = test.get("expected")
                try:
                    with _contextlib.redirect_stdout(out), _contextlib.redirect_stderr(err):
                        actual = callable_entry(*args)
                except BaseException as exc:  # noqa: BLE001 - untrusted learner code
                    results.append(
                        {
                            "name": name,
                            "passed": False,
                            "expected": _json.dumps(expected),
                            "actual": "%s: %s" % (type(exc).__name__, exc),
                            "error": "raised",
                        }
                    )
                else:
                    ok = bool(_deep_equal(actual, expected))
                    results.append(
                        {
                            "name": name,
                            "passed": ok,
                            "expected": _json.dumps(expected),
                            "actual": _describe(actual),
                        }
                    )

            if results[-1]["passed"]:
                passed += 1

        total = len(results)
        return _json.dumps(
            {
                "status": "passed" if total > 0 and passed == total else "failed",
                "tests": results,
                "stdout": out.getvalue(),
                "stderr": err.getvalue(),
                "outputTruncated": out.truncated or err.truncated,
                "passed": passed,
                "total": total,
            }
        )
    finally:
        _restore_builtins(builtins_snapshot)
        _sys.path[:] = path_snapshot
        _os.environ.clear()
        _os.environ.update(env_snapshot)
`;
