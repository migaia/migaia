"""Prestarted macOS PID observer. No subprocess is created for any sample."""
import ctypes
import json
import sys


class IRusage(ctypes.Structure):
    """Match SDK sys/resource.h rusage_info_v0, flavor 0, without child CPU totals."""
    _fields_ = [("uuid", ctypes.c_uint8 * 16)] + [
        (name, ctypes.c_uint64) for name in (
            "user_time", "system_time", "idle_wakeups", "interrupt_wakeups",
            "pageins", "wired_size", "resident_size", "physical_footprint",
            "start_time", "exit_time"
        )
    ]


def main():
    """Read PID arrays, return complete CPU nanoseconds and absolute resident bytes."""
    if sys.platform != "darwin":
        raise RuntimeError("Native PID observer requires macOS")
    libproc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
    libproc.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    libproc.proc_pid_rusage.restype = ctypes.c_int
    print(json.dumps({"ready": True, "method": "macOS proc_pid_rusage(RUSAGE_INFO_V0)"}), flush=True)
    for line in sys.stdin:
        try:
            rows = []
            for pid in json.loads(line):
                usage = IRusage()
                if libproc.proc_pid_rusage(pid, 0, ctypes.byref(usage)) != 0:
                    raise OSError(ctypes.get_errno(), "proc_pid_rusage failed")
                rows.append({"pid": pid, "cpuNs": usage.user_time + usage.system_time,
                             "rssBytes": usage.resident_size})
            print(json.dumps({"rows": rows}), flush=True)
        except Exception as error:
            # Failure stays a failed observation. Never invent a missing RSS/CPU value.
            print(json.dumps({"error": str(error)}), flush=True)


if __name__ == "__main__":
    main()
