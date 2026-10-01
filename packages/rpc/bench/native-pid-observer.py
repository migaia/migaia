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


class IBsdShort(ctypes.Structure):
    """SDK proc_bsdshortinfo (flavor 13); status 5 is SZOMB, not an inferred exit."""
    _fields_ = [(name, ctypes.c_uint32) for name in ("pid", "ppid", "pgid", "status")] + [
        ("comm", ctypes.c_char * 16), ("remaining", ctypes.c_uint32 * 8)
    ]


def resource_row(libproc, pid):
    """Read actual open descriptors and child states for resource regression, outside bench windows."""
    size = libproc.proc_pidinfo(pid, 1, 0, None, 0)
    if size <= 0:
        raise OSError(ctypes.get_errno(), "proc_pidinfo fd-size failed")
    buffer = ctypes.create_string_buffer(size + 16 * 8)
    copied = libproc.proc_pidinfo(pid, 1, 0, buffer, len(buffer))
    if copied <= 0 or copied % 8 or copied >= len(buffer):
        raise OSError(ctypes.get_errno(), "proc_pidinfo fd-list incomplete")
    children = (ctypes.c_int * 4096)()
    result = libproc.proc_listchildpids(pid, children, ctypes.sizeof(children))
    if result < 0 or result >= ctypes.sizeof(children):
        raise OSError(ctypes.get_errno(), "proc_listchildpids incomplete")
    states = []
    for child in children:
        if child <= 0:
            continue
        state = IBsdShort()
        read = libproc.proc_pidinfo(child, 13, 0, ctypes.byref(state), ctypes.sizeof(state))
        if read == 0 and ctypes.get_errno() == 3:
            continue  # The exited child disappeared between the two native observations.
        if read != ctypes.sizeof(state):
            raise OSError(ctypes.get_errno(), "proc_pidinfo child-state incomplete")
        states.append({"pid": state.pid, "ppid": state.ppid, "status": state.status})
    return {"pid": pid, "fdCount": copied // 8, "children": states,
            "zombies": sum(state["status"] == 5 for state in states)}


def main():
    """Read PID arrays, return complete CPU nanoseconds and absolute resident bytes."""
    if sys.platform != "darwin":
        raise RuntimeError("Native PID observer requires macOS")
    libproc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
    libproc.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    libproc.proc_pid_rusage.restype = ctypes.c_int
    libproc.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
    libproc.proc_pidinfo.restype = ctypes.c_int
    libproc.proc_listchildpids.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
    libproc.proc_listchildpids.restype = ctypes.c_int
    print(json.dumps({"ready": True, "method": "macOS proc_pid_rusage(RUSAGE_INFO_V0)"}), flush=True)
    for line in sys.stdin:
        try:
            request = json.loads(line)
            if isinstance(request, dict) and request.get("resources"):
                print(json.dumps({"rows": [resource_row(libproc, pid) for pid in request["pids"]]}), flush=True)
                continue
            rows = []
            for pid in request:
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
