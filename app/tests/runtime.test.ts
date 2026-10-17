import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { initializeProject } from "../src/project.ts";
import { checkRuntimePermissions, claimRuntime, removeRuntime } from "../src/runtime.ts";
import { privateDirectory } from "./private-directory.ts";

test("runtime reads tolerate registration removal during path validation", {
  timeout: 30000,
}, async () => {
  const root = await privateDirectory(join(tmpdir(), "tbspec-runtime-read-race-"));
  await initializeProject({ directory: root });
  const script = `
    import assert from "node:assert/strict";
    import fs from "node:fs/promises";
    import { syncBuiltinESMExports } from "node:module";
    import { join } from "node:path";
    import { claimRuntime, readRuntime } from ${JSON.stringify(new URL("../src/runtime.ts", import.meta.url).href)};
    const root = process.argv[1];
    await claimRuntime(root);
    const realpath = fs.realpath;
    const registration = join(root, ".tbspec/runtime/web.json");
    let removed = false;
    fs.realpath = async (path, ...args) => {
      if (path === registration && !removed) {
        removed = true;
        await fs.unlink(registration);
      }
      return realpath(path, ...args);
    };
    syncBuiltinESMExports();
    assert.equal(await readRuntime(root), null);
  `;
  await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "--eval", script, await realpath(root)],
    {
      timeout: 25000,
      windowsHide: true,
    },
  );
});

test("macOS runtime permissions reject ACL access and parent replacement grants", () => {
  const script = `
    import assert from "node:assert/strict";
    import child from "node:child_process";
    import fs from "node:fs/promises";
    import { syncBuiltinESMExports } from "node:module";
    import { join } from "node:path";
    import { promisify } from "node:util";
    import { runInNewContext } from "node:vm";
    Object.defineProperty(process, "platform", { value: "darwin" });
    const root = join(process.cwd(), "project");
    process.getuid = () => 42;
    const runtime = join(root, ".tbspec/runtime");
    const registration = join(runtime, "web.json");
    fs.readdir = async () => [];
    fs.stat = async () => ({ uid: 42, mode: 0o700 });
    fs.lstat = async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); };
    let grants = new Map();
    let unavailable = false;
    let calls = [];
    let nativeScript;
    child.execFile = () => { throw new Error("Expected promisified ACL lookup"); };
    child.execFile[promisify.custom] = async (command, args) => {
      assert.equal(command, "/usr/bin/osascript");
      assert.deepEqual(args.slice(0, 3), ["-l", "JavaScript", "-e"]);
      const path = args.at(-1);
      nativeScript = args[3];
      calls.push(path);
      if (unavailable) throw new Error("ACL lookup failed");
      const entries = grants.get(path) ?? "";
      return { stdout: JSON.stringify("!#acl 1\\n" + entries), stderr: "" };
    };
    syncBuiltinESMExports();
    const { checkRuntimePermissions } = await import(${JSON.stringify(new URL("../src/runtime.ts", import.meta.url).href)});
    for (const path of [root, join(root, ".tbspec")]) {
      for (const right of ["write", "append", "delete", "delete_child", "writeattr", "writeextattr", "writesecurity", "chown"]) {
        grants = new Map([[path, "group:ABC:everyone:12:allow:" + right + "\\n"]]);
        await assert.rejects(checkRuntimePermissions(root), /not protected/);
      }
    }
    for (const path of [runtime, registration]) {
      for (const entry of ["group:ABC:everyone:12:allow:read\\n", "user:ABC:guest:99:allow,inherited:read,write\\n", "unexpected ACL\\n"]) {
        grants = new Map([[path, entry]]);
        await assert.rejects(checkRuntimePermissions(root), /not protected/);
      }
    }
    grants = new Map([
      [root, "group:ABC:everyone:12:allow:read,execute,readattr,readextattr,readsecurity\\n"],
      [runtime, "group:ABC:everyone:12:deny:delete\\nuser:ABC:owner:42:allow:read,write\\n"],
    ]);
    calls = [];
    await checkRuntimePermissions(root);
    assert.deepEqual(calls, [root, join(root, ".tbspec"), runtime, registration]);
    for (const mode of ["present", "absent", "lookup-failure", "open-failure", "export-failure"]) {
      const errno = [0];
      const freed = [];
      const closed = [];
      const acl = {};
      const api = {
        open: () => mode === "open-failure" ? -1 : 7,
        close: fd => { closed.push(fd); return 0; },
        __error: () => errno,
        acl_get_file: () => { errno[0] = mode === "absent" ? 2 : 13; return mode === "present" || mode === "export-failure" ? acl : null; },
        acl_get_fd_np: () => api.acl_get_file(),
        acl_valid: value => value === acl ? 0 : -1,
        acl_to_text: (value, length) => { length[0] = mode === "export-failure" ? "0" : "8"; return "!#acl 1\\n"; },
        acl_free: value => { freed.push(value); return 0; },
        NSData: { dataWithBytesLength: value => value },
        NSString: { alloc: { initWithDataEncoding: value => value } },
      };
      const run = () => runInNewContext(nativeScript + '\\nrun(["path"])', {
        ObjC: { import() {}, bindFunction() {}, unwrap: value => value },
        $: api, Ref: () => ["0"],
      });
      if (["present", "absent"].includes(mode)) assert.equal(JSON.parse(run()), "!#acl 1\\n");
      else assert.throws(run);
      assert.deepEqual(closed, mode === "open-failure" ? [] : [7]);
      if (mode === "present") assert.equal(freed.length, 2);
      if (mode === "export-failure") assert.ok(freed.includes(acl));
    }
    unavailable = true;
    await assert.rejects(checkRuntimePermissions(root), /not protected/);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    timeout: 10000,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("native macOS ACL grants fail closed without changing project permissions", {
  skip: process.platform !== "darwin",
  timeout: 30000,
}, async () => {
  const root = await realpath(await privateDirectory(join(tmpdir(), "tbspec-runtime-acl-")));
  await initializeProject({ directory: root });
  const record = await claimRuntime(root);
  const path = join(root, ".tbspec/runtime/web.json");
  const original = await readFile(path, "utf8");
  const execute = promisify(execFile);
  try {
    await execute("/bin/chmod", ["+a", "group:everyone allow read,execute", root]);
    try {
      await checkRuntimePermissions(root);
    } finally {
      await execute("/bin/chmod", ["-a", "group:everyone allow read,execute", root]);
    }
    for (const [checked, grant] of [
      [root, "group:everyone allow delete_child"],
      [join(root, ".tbspec"), "group:everyone allow delete_child"],
      [join(root, ".tbspec/runtime"), "group:everyone allow read"],
      [path, "group:everyone allow read"],
    ] as const) {
      await execute("/bin/chmod", ["+a", grant, checked]);
      try {
        const before = (await execute("/bin/ls", ["-lde", checked])).stdout;
        const mode = (await stat(checked)).mode;
        await assert.rejects(checkRuntimePermissions(root), /not protected/);
        if (checked !== path) await assert.rejects(claimRuntime(root), /Cannot secure/);
        assert.equal((await execute("/bin/ls", ["-lde", checked])).stdout, before);
        assert.equal((await stat(checked)).mode, mode);
        assert.equal(await readFile(path, "utf8"), original);
      } finally {
        await execute("/bin/chmod", ["-a", grant, checked]);
      }
    }
  } finally {
    await removeRuntime(record);
  }
});

test("runtime cleanup excludes claims until comparison and removal finish", {
  timeout: 30000,
}, async () => {
  const root = await privateDirectory(join(tmpdir(), "tbspec-runtime-race-"));
  await initializeProject({ directory: root });
  const script = `
    import assert from "node:assert/strict";
    import fs from "node:fs/promises";
    import { syncBuiltinESMExports } from "node:module";
    import { join } from "node:path";
    import { claimRuntime, readRuntime, removeRuntime } from ${JSON.stringify(new URL("../src/runtime.ts", import.meta.url).href)};
    const root = process.argv[1];
    const old = await claimRuntime(root);
    // Runtime coordination must remain independent of project operations and recovery.
    await fs.writeFile(join(root, ".tbspec/operation.lock"), "retained operation");
    let entered, release, enteredClaim;
    const ready = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const attempted = new Promise(resolve => { enteredClaim = resolve; });
    const unlink = fs.unlink;
    const open = fs.open;
    let blocked = false;
    let attemptSeen = false;
    fs.unlink = async (path) => {
      if (path === join(root, ".tbspec/runtime/web.json") && !blocked) {
        blocked = true;
        entered();
        await gate;
      }
      return unlink(path);
    };
    fs.open = async (path, ...args) => {
      if (blocked && !attemptSeen && [join(root, ".tbspec/runtime/web.json"), join(root, ".tbspec/runtime/registration.lock")].includes(path)) {
        attemptSeen = true;
        try { return await open(path, ...args); }
        finally { enteredClaim(); }
      }
      return open(path, ...args);
    };
    syncBuiltinESMExports();
    const cleanup = removeRuntime(old);
    await ready;
    const claiming = claimRuntime(root).then(value => ({ value }), error => ({ error }));
    await attempted;
    release();
    await cleanup;
    const next = await claiming;
    assert.ok(next.value, String(next.error));
    await assert.rejects(removeRuntime(old));
    assert.equal((await readRuntime(root)).instanceId, next.value.instanceId);
    assert.equal(await fs.readFile(join(root, ".tbspec/operation.lock"), "utf8"), "retained operation");
    const guard = join(root, ".tbspec/runtime/registration.lock");
    await fs.writeFile(guard, "retained unknown guard");
    const clock = Date.now;
    let now = 0;
    Date.now = () => now += 30001;
    try { await assert.rejects(claimRuntime(root), /registration guard is busy/); }
    finally { Date.now = clock; }
    assert.equal(await fs.readFile(guard, "utf8"), "retained unknown guard");
    assert.equal((await readRuntime(root)).instanceId, next.value.instanceId);
    await unlink(guard);
    const fileInfo = await fs.stat(join(root, ".tbspec/runtime/web.json"));
    await removeRuntime(next.value);
    const lstat = fs.lstat;
    let staleGuard = true;
    fs.lstat = async (path, ...args) => {
      if (path === guard && staleGuard) {
        staleGuard = false;
        return fileInfo;
      }
      return lstat(path, ...args);
    };
    syncBuiltinESMExports();
    const replacement = await claimRuntime(root);
    await removeRuntime(replacement);
  `;
  await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "--eval", script, await realpath(root)],
    {
      timeout: 25000,
      windowsHide: true,
    },
  );
});
