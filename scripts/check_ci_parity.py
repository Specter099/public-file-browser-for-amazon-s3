#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
"""Fail if scripts/local-ci.sh and .github/workflows/ci.yml drift apart.

The local gate is only worth running if a green run there predicts a green run
in CI. That holds as long as every CI job is represented by local stages and
vice versa -- so this compares the job names in ci.yml against the
`ci.yml job:` headings in `local-ci.sh --list-stages`.

What this can and cannot catch
------------------------------
It catches a job being added to or removed from ci.yml without the local gate
following. It cannot catch a *step* changing inside one of the shared reusable
workflows in Specter099/.github, which this repo references at @main and which
can therefore change without any commit here. That residual gap is documented
in CLAUDE.md; treat the shared workflows' step lists as something to re-check
when they change upstream.
"""

from __future__ import annotations

import argparse
import re
import subprocess  # nosec B404 - fixed argv, no shell, repo-local script
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CI_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"
LOCAL_CI = REPO_ROOT / "scripts" / "local-ci.sh"

# Jobs that intentionally have no local counterpart, with the reason.
LOCAL_EXEMPT_JOBS: dict[str, str] = {}


def ci_job_names(workflow_path: Path) -> set[str]:
    """Top-level keys under `jobs:` in the workflow.

    Parsed with a regex rather than PyYAML so this script has no dependencies
    and can run in a bare checkout: `jobs:` at column 0, then each job name at a
    consistent two-space indent.
    """
    text = workflow_path.read_text()
    jobs_block = re.split(r"^jobs:\s*$", text, maxsplit=1, flags=re.MULTILINE)
    if len(jobs_block) != 2:
        raise SystemExit(
            f"check_ci_parity: no top-level 'jobs:' block in {workflow_path}"
        )

    names = set()
    for line in jobs_block[1].splitlines():
        if re.match(r"^\S", line):  # dedented back to column 0: block is over
            break
        match = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
        if match:
            names.add(match.group(1))
    return names


def local_stage_jobs(script_path: Path) -> set[str]:
    """Job names claimed by `local-ci.sh --list-stages`."""
    result = subprocess.run(  # nosec B603 - fixed argv, no shell
        ["bash", str(script_path), "--list-stages"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(
            f"check_ci_parity: `local-ci.sh --list-stages` exited "
            f"{result.returncode}\n{result.stderr}"
        )
    return set(re.findall(r"^ci\.yml job:\s*(\S+)", result.stdout, flags=re.MULTILINE))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--quiet", action="store_true", help="only print output on failure"
    )
    args = parser.parse_args()

    ci_jobs = ci_job_names(CI_WORKFLOW)
    local_jobs = local_stage_jobs(LOCAL_CI)

    unmirrored = ci_jobs - local_jobs - set(LOCAL_EXEMPT_JOBS)
    stale = local_jobs - ci_jobs

    problems = []
    for job in sorted(unmirrored):
        problems.append(
            f"ci.yml defines job '{job}' with no matching "
            f"'ci.yml job: {job}' section in local-ci.sh --list-stages"
        )
    for job in sorted(stale):
        problems.append(
            f"local-ci.sh claims to mirror job '{job}', which no longer exists in ci.yml"
        )

    if problems:
        print("check_ci_parity: FAIL", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        print(
            "\nThe local gate must cover every CI job, or a green local run "
            "stops predicting a green CI run.",
            file=sys.stderr,
        )
        return 1

    if not args.quiet:
        print(
            f"check_ci_parity: OK - {len(ci_jobs)} CI job(s) mirrored locally: {', '.join(sorted(ci_jobs))}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
