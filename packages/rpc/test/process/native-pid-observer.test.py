"""Exercise the benchmark's native CPU unit against an independent CPU clock."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest


@unittest.skipUnless(sys.platform == "darwin", "Native PID observation requires macOS")
class INativePidObserverTest(unittest.TestCase):
    """A real CPU window detects Mach ticks mislabeled as nanoseconds."""

    def test_busy_loop_cpu_within_five_percent(self):
        """Compare two seconds of process CPU, excluding wall-clock waiting."""
        # The production observer remains a separate PID throughout the window.
        observer_path = Path(__file__).parents[2] / "bench" / "native-pid-observer.py"
        # This process owns the observer's pipes and joins it even on assertion failure.
        observer = subprocess.Popen(
            [sys.executable, "-B", str(observer_path)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True,
        )
        try:
            self.assertTrue(json.loads(observer.stdout.readline())["ready"])

            def read_cpu():
                """Read this test PID through the exact benchmark control protocol."""
                observer.stdin.write(json.dumps([os.getpid()]) + "\n")
                observer.stdin.flush()
                # Native failure is a failed test, never an invented zero sample.
                message = json.loads(observer.stdout.readline())
                self.assertNotIn("error", message)
                return message["rows"][0]["cpuNs"]

            # Readiness and the first native snapshot precede the independent clock.
            before_cpu = read_cpu()
            # Python's process CPU clock is independent of the observer's Mach tick conversion.
            started_cpu = time.process_time_ns()
            # A CPU budget is stable under scheduling delays; a wall budget is not.
            target_cpu_ns = 2_000_000_000
            while time.process_time_ns() - started_cpu < target_cpu_ns:
                pass
            # Exclude pipe waiting and compare native CPU deltas, not cumulative startup work.
            expected_cpu_ns = time.process_time_ns() - started_cpu
            observed_cpu_ns = read_cpu() - before_cpu
            # Five percent is the user's acceptance ceiling, not a fitted noise allowance.
            relative_error = abs(observed_cpu_ns - expected_cpu_ns) / expected_cpu_ns
            print(json.dumps({
                "case": "native-pid-cpu-unit",
                "expectedCpuNs": expected_cpu_ns,
                "observedCpuNs": observed_cpu_ns,
                "relativeError": relative_error,
                "maxRelativeError": 0.05,
            }), flush=True)
            self.assertGreaterEqual(expected_cpu_ns, target_cpu_ns)
            self.assertLessEqual(relative_error, 0.05)
        finally:
            observer.stdin.close()
            observer.wait(timeout=5)
            # Observer stderr stays available when startup or native observation fails.
            diagnostics = observer.stderr.read()
            observer.stdout.close()
            observer.stderr.close()
            self.assertEqual(observer.returncode, 0, diagnostics)


if __name__ == "__main__":
    unittest.main()
