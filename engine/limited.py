"""Runs a program under the CAD job's resource limits: `python -I limited.py SECONDS PROGRAM ARGS...`.

The service starts MantelCAD through this rather than a preexec_fn, which is unsafe once threads exist.
"""
import os
import resource
import sys

if __name__ == "__main__":
    seconds = int(sys.argv[1])
    resource.setrlimit(resource.RLIMIT_CPU, (seconds, seconds))
    resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024**2, 64 * 1024**2))
    resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
    if sys.platform == "linux":
        resource.setrlimit(resource.RLIMIT_AS, (6 * 1024**3, 6 * 1024**3))
    os.execv(sys.argv[2], sys.argv[2:])
