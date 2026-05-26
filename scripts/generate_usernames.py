"""
Maintain the experiment username pool.

The script preserves any existing private per-condition lists, appends
deterministic new usernames as needed, and writes:
  - js/usernames.js                               : committed, SHA-256 hash -> condition
  - private/usernames_att.txt                     : cleartext recognized att usernames
  - private/usernames_act.txt                     : cleartext recognized act usernames
  - private/usernames_cleartext.csv               : all recognized usernames
  - private/available_usernames_for_assignment.csv: currently assignable usernames

The assignment export excludes names listed in private/used_usernames_snapshot.txt.
"""
import csv
import hashlib
import json
import random
from pathlib import Path

SEED = 42
RECOGNIZED_PER_CONDITION = 160
ASSIGNMENT_PER_CONDITION = 150
ROOT = Path(__file__).resolve().parent.parent

ADJECTIVES = [
    "bold", "quiet", "swift", "brave", "sunny", "wild", "calm", "sharp", "gentle", "lucky",
    "clever", "noble", "silent", "lively", "steady", "fierce", "kind", "merry", "proud", "witty",
    "quick", "warm", "cool", "wise", "bright", "honest", "mighty", "nimble", "humble", "eager",
    "loyal", "daring", "keen", "jolly", "gallant", "zesty", "sly", "grand", "radiant", "stout",
]
ANIMALS = [
    "tiger", "lynx", "wolf", "hawk", "fox", "bear", "otter", "eagle", "falcon", "owl",
    "panda", "heron", "lion", "deer", "leopard", "raven", "crane", "seal", "moose", "viper",
    "puma", "mink", "badger", "osprey", "ibis", "gazelle", "jaguar", "stoat", "weasel", "cougar",
    "shark", "whale", "dolphin", "trout", "salmon", "marten", "ferret", "beaver", "skunk", "koala",
]

def generate_pool(rng):
    pool = [f"{a}-{b}-{c:03d}"
            for a in ADJECTIVES
            for b in ANIMALS
            for c in range(1, 1000)]
    rng.shuffle(pool)
    return pool

def read_lines(path):
    if not path.exists():
        return []
    return [
        line.strip().lower()
        for line in path.read_text().splitlines()
        if line.strip()
    ]

def write_lines(path, lines):
    path.write_text("\n".join(lines) + "\n")

def top_up(existing, target, pool, reserved):
    names = list(existing)
    seen = set(reserved)
    seen.update(names)
    for candidate in pool:
        if len(names) >= target:
            break
        if candidate in seen:
            continue
        names.append(candidate)
        seen.add(candidate)
    if len(names) < target:
        raise RuntimeError(f"Could only generate {len(names)} usernames; need {target}")
    return names

def main():
    rng = random.Random(SEED)
    priv = ROOT / "private"
    priv.mkdir(exist_ok=True)

    att_fp = priv / "usernames_att.txt"
    act_fp = priv / "usernames_act.txt"
    used_fp = priv / "used_usernames_snapshot.txt"

    att_names = read_lines(att_fp)
    act_names = read_lines(act_fp)
    used_names = set(read_lines(used_fp))

    overlap = set(att_names).intersection(act_names)
    if overlap:
        raise RuntimeError(f"Username assigned to both conditions: {sorted(overlap)[:5]}")

    pool = generate_pool(rng)
    reserved = set(att_names).union(act_names)
    att_names = top_up(att_names, RECOGNIZED_PER_CONDITION, pool, reserved)
    reserved.update(att_names)
    act_names = top_up(act_names, RECOGNIZED_PER_CONDITION, pool, reserved)

    write_lines(att_fp, att_names)
    write_lines(act_fp, act_names)

    assigned = [(u, "att") for u in att_names] + [(u, "act") for u in act_names]

    # Cleartext CSV (gitignored)
    cleartext_fp = priv / "usernames_cleartext.csv"
    with cleartext_fp.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["username", "condition"])
        for u, c in assigned:
            w.writerow([u, c])
    print(f"wrote {cleartext_fp}  ({len(assigned)} rows)")

    available = [
        (u, c)
        for u, c in assigned
        if u not in used_names
    ]
    available_att = [(u, c) for u, c in available if c == "att"][:ASSIGNMENT_PER_CONDITION]
    available_act = [(u, c) for u, c in available if c == "act"][:ASSIGNMENT_PER_CONDITION]
    if len(available_att) < ASSIGNMENT_PER_CONDITION:
        raise RuntimeError(f"Only {len(available_att)} available att usernames")
    if len(available_act) < ASSIGNMENT_PER_CONDITION:
        raise RuntimeError(f"Only {len(available_act)} available act usernames")

    assignment_fp = priv / "available_usernames_for_assignment.csv"
    with assignment_fp.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["username", "condition"])
        for row in available_att + available_act:
            w.writerow(row)
    write_lines(priv / "available_usernames_att.txt", [u for u, _ in available_att])
    write_lines(priv / "available_usernames_act.txt", [u for u, _ in available_act])
    print(f"wrote {assignment_fp}  ({len(available_att) + len(available_act)} rows)")

    # Hashed JS (public-safe)
    hashed = {}
    for u, c in assigned:
        h = hashlib.sha256(u.encode("utf-8")).hexdigest()
        hashed[h] = c
    if len(hashed) != len(assigned):
        raise RuntimeError(f"Hash collision: {len(assigned)} names -> {len(hashed)} hashes")

    js_fp = ROOT / "js" / "usernames.js"
    js_fp.parent.mkdir(exist_ok=True)
    with js_fp.open("w") as f:
        f.write("// Auto-generated by scripts/generate_usernames.py\n")
        f.write("// Maps SHA-256(lowercased username) -> condition. Do not edit by hand.\n")
        f.write("window.USERS = " + json.dumps(hashed, indent=2, sort_keys=True) + ";\n")
    print(f"wrote {js_fp}  ({len(hashed)} hashes)")

    att_n = sum(1 for _, c in assigned if c == 'att')
    act_n = sum(1 for _, c in assigned if c == 'act')
    print()
    print(f"Recognized counts: att={att_n}, act={act_n}")
    print(f"Assignment counts: att={len(available_att)}, act={len(available_act)}")
    print(f"Used snapshot exclusions: {len(used_names)}")
    print(f"First 3 assignment rows: {(available_att + available_act)[:3]}")

if __name__ == "__main__":
    main()
