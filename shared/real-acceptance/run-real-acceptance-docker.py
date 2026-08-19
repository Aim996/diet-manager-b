#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
饮食管家 B 真实环境验收执行器（Docker 网关版，参数化版本线）。

运行于 Docker 宿主机（bome），直接 docker exec 到专用网关容器：
  - 逐场景驱动 openclaw agent（会话键 agent:main:<prefix>-<runId>-<id>）
  - 从会话 jsonl 中提取 diet_manager 工具返回的结构化 status 作为观察到结果
    （按「受测输入」所在行偏移裁剪，避免把 setup 回合的 status 当成 input 的结果）
  - 通过只读白名单断言（node + node:sqlite）核对 SQLite 计数
  - 快照前移测点：中断类场景（重启/重载/恢复）在 setup 前，其余在 setup 后、input 前
  - same_root 恢复在「停止容器后」用一次性容器（docker run --rm）跑 backup+restore
  - reset 用 init-root 生成全新空库 + 32 字节 authority secret
  - 生成脱敏证据 JSON（secret_value_count 恒 0）

与 0.1.1 版差异：
  - 白名单新增 user_profiles（0.2.0 set_profile 落库）；
  - 离线营养无需 FDC_API_KEY，无 requires_fdc_key / 断网 / 超时 / no-result 跳过逻辑；
  - 会话键前缀、候选 SHA/commit/版本、容器/数据卷均参数化。

用法（宿主机）：
  python3 run-real-acceptance-docker.py \
    --scenarios scenarios-0.2.0.json --evidence evidence.json \
    --package-version 0.2.0 --scenario-prefix diet-manager-real-0.2.0 \
    --candidate-sha <64-hex> --source-commit <40-hex> [--reset]
"""
import argparse
import base64
import json
import subprocess
import sys
import time
import uuid

DEFAULT_CONTAINER = "openclaw-gateway-07"
DEFAULT_IMAGE = "ghcr.io/openclaw/openclaw:2026.7.1-2"
DEFAULT_CONFIG_VOL = "/vol1/1000/docker/openclaw-07/data/config"
STATE = "/home/node/.openclaw"
DATA_ROOT = STATE + "/diet-manager-data"
DB_PATH = DATA_ROOT + "/diet-manager-b.sqlite3"
ADMIN_CLI = STATE + "/extensions/diet-manager-b/dist/admin/cli.js"
DBQ_HELPER = STATE + "/dbq.mjs"

# 与 shared/tests/validate-real-acceptance-assets.mjs 白名单一致（0.2.0 增补 user_profiles）。
ALLOWLISTED_TABLES = {
    "event_records": ["event_type", "fact_kind", "meal_slot", "lifecycle_status", "result_status", "conversation_id"],
    "meal_items": ["event_id", "normalized_name", "item_type"],
    "products": ["normalized_name", "product_type"],
    "inventory_batches": ["product_id"],
    "inventory_batch_projections": ["quantity_status", "seal_status", "expiry_status", "effective_status"],
    "inventory_transactions": ["direction", "reason_code", "product_id"],
    "nutrition_profiles": ["subject_id", "coverage_status", "source_type"],
    "nutrition_snapshots": ["coverage_status", "source_type"],
    "goal_versions": ["user_id"],
    "user_profiles": ["user_id"],
    "daily_progress_snapshots": ["date", "coverage_status"],
    "issues": ["issue_code", "issue_type", "status"],
    "correction_events": ["operation"],
    "command_envelopes": ["state", "result_status"],
    "envelope_finalizations": ["result_status"],
    "mixed_item_results": ["status"],
}

DBQ_HELPER_SRC = r"""import { DatabaseSync } from "node:sqlite";
const ALLOWLISTED = JSON.parse(Buffer.from(process.argv[3], "base64").toString("utf8"));
const [dbPath, b64] = [process.argv[2], process.argv[4]];
const queries = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
const db = new DatabaseSync(dbPath, { readOnly: true });
function buildWhere(table, where) {
  const allowed = ALLOWLISTED[table];
  if (!allowed) throw new Error("TABLE_NOT_ALLOWLISTED:" + table);
  const clauses = [], params = [];
  for (const [col, val] of Object.entries(where ?? {})) {
    if (!allowed.includes(col)) throw new Error("COLUMN_NOT_ALLOWLISTED:" + col);
    if (val && typeof val === "object" && "$neq" in val) {
      clauses.push('"' + col + '" != ?'); params.push(val.$neq);
    } else {
      clauses.push('"' + col + '" = ?'); params.push(val);
    }
  }
  return { clause: clauses.length ? " WHERE " + clauses.join(" AND ") : "", params };
}
const out = [];
try {
  for (const q of queries) {
    const { clause, params } = buildWhere(q.table, q.where);
    const row = db.prepare('SELECT COUNT(*) AS c FROM "' + q.table + '"' + clause).get(...params);
    out.push({ table: q.table, where: q.where ?? {}, count: Number(row.c) });
  }
} finally { db.close(); }
process.stdout.write(JSON.stringify(out));
"""


def fail(msg):
    sys.stderr.write(msg + "\n")
    sys.exit(1)


def run(args, check=True):
    r = subprocess.run(args, capture_output=True, text=True)
    if check and r.returncode != 0:
        fail("CMD_FAILED: " + " ".join(args) + "\nSTDOUT: " + r.stdout + "\nSTDERR: " + r.stderr)
    return r


def dc(*args):
    return run(["docker", "exec", CONTAINER, *args])


def dc_env(env, *args):
    return run(["docker", "exec", "-e", env, CONTAINER, *args])


def dc_run_rm(*args):
    """一次性容器（挂载官方数据卷，用户 node），用于已停止容器的 backup/restore/init-root。"""
    return run(["docker", "run", "--rm", "-v", CONFIG_VOL + ":" + STATE, "-u", "node", IMAGE, *args])


def write_helper():
    allowed_json = json.dumps(ALLOWLISTED_TABLES, ensure_ascii=False)
    src_b64 = base64.b64encode(DBQ_HELPER_SRC.encode("utf-8")).decode("ascii")
    allowed_b64 = base64.b64encode(allowed_json.encode("utf-8")).decode("ascii")
    inner = (
        "echo " + src_b64 + " | base64 -d > " + DBQ_HELPER + " && "
        "echo " + allowed_b64 + " | base64 -d > /home/node/.openclaw/dbq-allow.json && "
        "echo HELPER_OK"
    )
    r = dc("sh", "-c", inner)
    if "HELPER_OK" not in r.stdout:
        fail("HELPER_WRITE_FAILED: " + r.stdout + r.stderr)


def db_counts(assertions):
    if not assertions:
        return []
    b64 = base64.b64encode(json.dumps(assertions, ensure_ascii=False).encode("utf-8")).decode("ascii")
    allowed_json = base64.b64encode(json.dumps(ALLOWLISTED_TABLES, ensure_ascii=False).encode("utf-8")).decode("ascii")
    r = dc("node", DBQ_HELPER, DB_PATH, allowed_json, b64)
    if r.returncode != 0:
        fail("DB_ASSERTION_FAILED: " + r.stdout + r.stderr)
    try:
        return json.loads(r.stdout)
    except Exception:
        fail("DB_ASSERTION_PARSE_FAILED: " + r.stdout)


def agent_turn(session_key, message):
    r = dc_env("OPENCLAW_GATEWAY_PORT=18789", "openclaw", "agent",
               "--session-key", session_key, "-m", message, "--verbose", "on", "--json")
    try:
        return json.loads(r.stdout)
    except Exception:
        return {"_raw": r.stdout, "_err": r.stderr}


def reply_text(turn):
    if not isinstance(turn, dict):
        return ""
    try:
        return turn["result"]["payloads"][0]["text"]
    except Exception:
        return ""


def session_file(turn):
    if not isinstance(turn, dict):
        return None
    try:
        return turn["result"]["meta"]["agentMeta"]["sessionFile"]
    except Exception:
        return None


def count_session_lines(sf):
    if not sf:
        return 0
    r = dc("cat", sf)
    if r.returncode != 0:
        return 0
    return len([l for l in r.stdout.splitlines() if l.strip()])


def observed_status(sf, offset=0):
    """读取会话 jsonl，从 offset 行起提取最后一个 diet_manager toolResult 的 status，否则 'ignored'。"""
    if not sf:
        return "ignored"
    r = dc("cat", sf)
    status = None
    lines = r.stdout.splitlines()
    for line in lines[offset:]:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        m = obj.get("message")
        if not isinstance(m, dict):
            continue
        if m.get("role") == "toolResult" and m.get("toolName") == "diet_manager":
            content = m.get("content")
            if isinstance(content, list) and content:
                text = content[0].get("text", "") if isinstance(content[0], dict) else ""
                try:
                    inner = json.loads(text)
                    if isinstance(inner, dict) and "status" in inner:
                        status = inner["status"]
                except Exception:
                    pass
    return status if status else "ignored"


def gateway_healthy(timeout=90):
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = run(["docker", "inspect", CONTAINER, "--format", "{{.State.Health.Status}}"], check=False)
        if r.returncode == 0 and r.stdout.strip() == "healthy":
            return True
        time.sleep(2)
    return False


def stop_gateway():
    run(["docker", "stop", CONTAINER], check=False)


def start_gateway():
    run(["docker", "start", CONTAINER], check=False)
    if not gateway_healthy():
        fail("GATEWAY_HEALTHY_TIMEOUT")


def restart_gateway():
    run(["docker", "restart", CONTAINER], check=False)
    if not gateway_healthy():
        fail("GATEWAY_HEALTHY_TIMEOUT")


def same_root_restore():
    """停止后备份+恢复到同根（未加密）。backup 的 open+close 会 checkpoint 并清理 wal/shm。"""
    backup_file = STATE + "/acceptance-same-root.bak"
    stop_gateway()
    try:
        dc_run_rm("rm", "-f", backup_file)
        b = dc_run_rm("node", ADMIN_CLI, "backup", DATA_ROOT, backup_file)
        bjson = json.loads(b.stdout.strip())
        sha = bjson["sha256"]
        r = dc_run_rm("node", ADMIN_CLI, "restore", DATA_ROOT, backup_file, sha)
        rjson = json.loads(r.stdout.strip())
        if rjson.get("sha256") != sha:
            fail("SAME_ROOT_RESTORE_HASH_MISMATCH")
        return True
    except Exception as e:
        sys.stderr.write("SAME_ROOT_RESTORE_FAILED: %s\n" % e)
        return False
    finally:
        start_gateway()


def reset_data():
    """停止 → 删除库/secret → init-root 建全新空库 + 32 字节 secret → 启动。"""
    stop_gateway()
    try:
        dc_run_rm("sh", "-c", "rm -f %s %s-wal %s-shm %s/.diet-manager-b.authority-secret" % (
            DB_PATH, DB_PATH, DB_PATH, DATA_ROOT))
        r = dc_run_rm("node", ADMIN_CLI, "init-root", DATA_ROOT)
        init = json.loads(r.stdout.strip())
        if init.get("business_rows") != 0:
            fail("RESET_NON_EMPTY: " + r.stdout)
    finally:
        start_gateway()


def fdc_present():
    r = dc("sh", "-c", '[ -n "$FDC_API_KEY" ] && echo present || echo absent')
    return r.stdout.strip() == "present"


def scenario_skip_reason(sc):
    sid = sc["id"]
    if sid.endswith("reliability-duplicate"):
        return "idempotency identifier not replayable through openclaw agent; covered by unit tests"
    if sc.get("restore_kind") == "portable":
        return "portable restore requires interactive TTY passphrase (operator-assisted)"
    return None


def main():
    global CONTAINER, CONFIG_VOL, IMAGE
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", required=True)
    ap.add_argument("--evidence", required=True)
    ap.add_argument("--container", default=DEFAULT_CONTAINER)
    ap.add_argument("--config-vol", default=DEFAULT_CONFIG_VOL)
    ap.add_argument("--image", default=DEFAULT_IMAGE)
    ap.add_argument("--candidate-sha", required=True)
    ap.add_argument("--source-commit", required=True)
    ap.add_argument("--package-version", required=True)
    ap.add_argument("--scenario-prefix", default="diet-manager-real-0.2.0")
    ap.add_argument("--reset", action="store_true")
    args = ap.parse_args()

    CONTAINER = args.container
    CONFIG_VOL = args.config_vol
    IMAGE = args.image

    if not (len(args.candidate_sha) == 64 and all(c in "0123456789ABCDEFabcdef" for c in args.candidate_sha)):
        fail("CANDIDATE_SHA_INVALID")
    if not (len(args.source_commit) == 40 and all(c in "0123456789abcdef" for c in args.source_commit)):
        fail("SOURCE_COMMIT_INVALID")

    with open(args.scenarios, "r", encoding="utf-8") as f:
        catalog = json.load(f)
    scenarios = catalog["scenarios"]

    if not gateway_healthy():
        fail("PRECHECK_GATEWAY_NOT_HEALTHY")

    if args.reset:
        reset_data()

    write_helper()
    init_counts = db_counts([{"table": "event_records", "where": {}}])
    if init_counts and init_counts[0]["count"] > 0:
        fail("PRECHECK_EXISTING_BUSINESS_DATA:" + str(init_counts[0]["count"]))

    started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    node_version = dc("node", "--version").stdout.strip()
    oc_version = dc("openclaw", "--version").stdout.strip().splitlines()[0].strip()
    fdc_flag = fdc_present()

    results = []
    run_id = uuid.uuid4().hex[:12]
    for sc in scenarios:
        sid = sc["id"]
        skey = "agent:main:" + args.scenario_prefix + "-" + run_id + "-" + sid
        skip = scenario_skip_reason(sc)
        if skip:
            results.append({
                "scenario_id": sid, "category": sc["category"],
                "expected_outcome_status": sc["expected_outcome_status"],
                "observed_outcome_status": "skipped", "passed": False,
                "skipped": True, "skip_reason": skip,
                "database_assertions": [],
            })
            print("SKIP %s: %s" % (sid, skip), flush=True)
            continue

        assertions = sc.get("database_assertions", [])
        interruption = bool(sc.get("restart_gateway") or sc.get("reload_plugin") or sc.get("restore_kind"))

        before = db_counts(assertions) if interruption else None

        sf = None
        for msg in sc.get("setup", []):
            turn = agent_turn(skey, msg)
            if sf is None:
                sf = session_file(turn)

        if not interruption:
            before = db_counts(assertions)

        sf_offset = count_session_lines(sf)

        if sc.get("restart_gateway") or sc.get("reload_plugin"):
            restart_gateway()
        elif sc.get("restore_kind") == "same_root":
            same_root_restore()

        snapshot_ok = True
        final_reply = ""
        if sc.get("snapshot_equality"):
            t1 = agent_turn(skey, sc["input"])
            t2 = agent_turn(skey, sc["input"])
            snapshot_ok = (reply_text(t1) == reply_text(t2))
            final_reply = reply_text(t2)
            if sf is None:
                sf = session_file(t1)
        else:
            t = agent_turn(skey, sc["input"])
            final_reply = reply_text(t)
            if sf is None:
                sf = session_file(t)

        observed = observed_status(sf, sf_offset)

        after = db_counts(assertions)

        assert_out = []
        all_pass = True
        for i, a in enumerate(assertions):
            b = before[i]["count"]
            af = after[i]["count"]
            if a.get("expect_delta") is not None:
                ok = (af - b) == a["expect_delta"]
                expected = {"expect_delta": a["expect_delta"]}
            else:
                ok = af == a["expect_count"]
                expected = {"expect_count": a["expect_count"]}
            all_pass = all_pass and ok
            assert_out.append({
                "table": a["table"], "where": a.get("where", {}), "passed": ok,
                "before_count": b, "after_count": af, "expected": expected,
            })

        outcome_ok = (observed == sc["expected_outcome_status"])
        passed = outcome_ok and all_pass and snapshot_ok

        results.append({
            "scenario_id": sid, "category": sc["category"],
            "expected_outcome_status": sc["expected_outcome_status"],
            "observed_outcome_status": observed, "passed": passed,
            "skipped": False,
            "final_reply": final_reply[:2000],
            "tool_outcome_summary": final_reply[:400],
            "database_assertions": assert_out,
        })
        flag = "PASS" if passed else "FAIL"
        print("%s %s observed=%s expected=%s" % (flag, sid, observed, sc["expected_outcome_status"]), flush=True)

    completed_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    evidence = {
        "schema_version": "diet-manager/real-acceptance-evidence/v1",
        "candidate_zip_sha256": args.candidate_sha.upper(),
        "source_commit": args.source_commit,
        "package_version": args.package_version,
        "node_version": node_version,
        "openclaw_version": oc_version,
        "official_data_root": DATA_ROOT,
        "openclaw_state_root": STATE,
        "started_at": started_at,
        "completed_at": completed_at,
        "fdc_api_key_present": fdc_flag,
        "scenario_results": results,
        "secret_value_count": 0,
    }
    with open(args.evidence, "w", encoding="utf-8") as f:
        json.dump(evidence, f, ensure_ascii=False, indent=2)
    passed_count = sum(1 for r in results if r["passed"])
    skipped_count = sum(1 for r in results if r.get("skipped"))
    total = len(results)
    print("SUMMARY total=%d passed=%d skipped=%d failed=%d" % (
        total, passed_count, skipped_count, total - passed_count - skipped_count), flush=True)
    print("EVIDENCE_WRITTEN=" + args.evidence, flush=True)


if __name__ == "__main__":
    main()
