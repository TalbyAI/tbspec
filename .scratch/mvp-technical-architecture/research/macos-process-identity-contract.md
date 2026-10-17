# macOS process identity contract

## Built-in adapter boundary

The adapter uses absolute system-tool paths through Node's `child_process.execFile`, with no shell, native npm addon or runtime compiler. Its identity tuple contains the IOPlatformUUID, kernel boot timeval, PID and precise process-start timeval. Every subprocess is bounded to 10 seconds and 64 KiB of output.

| Read    | Invocation                                                      | Result                                  |
| ------- | --------------------------------------------------------------- | --------------------------------------- |
| Host    | `/usr/sbin/ioreg`, `['-rd1', '-c', 'IOPlatformExpertDevice']`   | One validated IOPlatformUUID            |
| Boot    | `/usr/sbin/sysctl`, `['-b', 'kern.boottime']`                   | 16-byte user64 timeval                  |
| Process | `/usr/bin/osascript`, `['-l', 'JavaScript', '-e', fixedScript]` | Canonical base64 of one 648-byte record |

The process script calls `sysctl` with the numeric MIB `[CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]`, concretely `[1, 14, 1, pid]`. Node validates the positive signed-32-bit PID and encodes that integer array as fixed-length base64; no supplied source/path text is executable script input. JXA decodes the MIB into NSData, binds the C function, allocates exactly 648 output bytes in NSMutableData, passes its mutable pointer and a typed length reference, checks successful return and exact length, and returns the data as base64. Foundation owns the buffer lifetime. Node rejects any noncanonical or incorrectly sized output. Apple's JXA release notes document C bindings, pointer types and explicit pass-by-reference. [Apple JXA release notes](https://developer.apple.com/library/archive/releasenotes/InterapplicationCommunication/RN-JavaScriptForAutomation/Articles/OSX10-10.html), [XNU MIB constants and sysctl prototype](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/sysctl.h).

The earlier proposed `/usr/sbin/sysctl -b kern.proc.pid.<pid>` failed on both native CI architectures with `unknown oid`. Kernel MIB availability did not establish named CLI availability. The kernel's name-to-OID lookup stops at a handler node and cannot append an arbitrary PID; the numeric API is required. This execution failure supersedes the initial CLI inference. [XNU name-to-OID implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_newsysctl.c#L1033-L1094), [process query handler](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sysctl.c#L792-L925).

## Strict binary identity

For a 64-bit caller, XNU returns `user64_kinfo_proc`. Its process structure begins with a timeval; the status is at byte 36 and PID at byte 40. Decode seconds as signed little-endian 64-bit at byte 0 and microseconds as signed little-endian 32-bit at byte 8, ignoring the trailing timeval padding. Require positive seconds within the exact wire integer range, microseconds from 0 through 999999, the requested PID and a running/sleeping/stopped state. Reject zombies, initializing/unknown states, missing data and every unexpected layout. The arm64 and x86_64 user64 prefixes share these definitions. [XNU process structures](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_internal.h#L638-L650), [user64 timeval](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/_types/_user64_timeval.h#L27-L35), [64-bit selection](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sysctl.c#L804-L824).

The 648-byte total record length is an expected layout, not a numeric ABI constant promised by Apple. XNU uses `sizeof(user64_kinfo_proc)` and describes this interface as size-variant SPI. Native CI on Apple Silicon and Intel must establish the implemented JXA transport, actual 648/16-byte lengths, independent-owner matching, terminated-owner rejection and the full initialization/ownership workflow. Source inspection and synthetic decoder tests do not establish those execution claims. Missing PID observations can return success with zero bytes and fail the exact-length check. No PID-only or second-resolution `ps` fallback is permitted. [XNU size selection and SPI warning](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sysctl.c#L804-L924).

## Native execution evidence

On 2026-10-07, commit `5a5d4a3ca533867f82ba9849faecb54b3d6a668e` passed the [foundation CI run](https://github.com/TalbyAI/tbspec/actions/runs/37645033783):

| Runner         | Observed kernel/architecture | Node    | Process/timeval bytes | Native identity tests | Full suite                |
| -------------- | ---------------------------- | ------- | --------------------- | --------------------- | ------------------------- |
| macos-latest   | Darwin 25.6.0 arm64          | 24.20.0 | 648 / 16              | 3 passed, no skips    | 31 passed, 1 Windows skip |
| macos-15-intel | Darwin 24.6.0 x64            | 24.19.0 | 648 / 16              | 3 passed, no skips    | 31 passed, 1 Windows skip |

Both runs established the actual JXA transport and binary decoder, independent-owner matching, terminated-owner rejection and the complete offline initialization/transaction/ownership suite. Linux passed 30 applicable tests (two platform-specific skips); Windows passed 31 (one macOS skip). Typechecking and compilation passed on every runner. The compiled installed-artifact acceptance remains in ticket 20.

Native execution also corrected two bridge assumptions: importing stdlib did not expose malloc, so Foundation now owns the mutable output buffer; JXA returns unsigned long values as strings, so the exact output-length comparison is against `'648'`. The latter failure returned status 0, length 648 and type string; the corrected comparison preserved the size check. These results establish only the recorded kernel layouts, not a guarantee for future OS versions.

## Operating limits

IOPlatformUUID scopes identity to the reported platform; cloned virtual machines can duplicate it, and platform replacement can change it. `kern.boottime` is a calendar timestamp, not a random boot UUID: XNU adjusts it when the calendar clock is set. A changed observation conservatively invalidates ownership. The process query is a snapshot and does not pin the process after return. Unavailable tools, permissions, unsupported layouts or mismatches remain unknown ownership; they never authorize clearing a lock. The caller establishes its own identity before creating coordination files. [IOPlatformUUID key](https://github.com/apple-oss-distributions/xnu/blob/main/iokit/IOKit/IOKitKeys.h), [clock adjustment](https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/clock.c#L674-L752), [ioreg options](https://github.com/apple-oss-distributions/IOKitTools/blob/main/ioreg.tproj/ioreg.8).
