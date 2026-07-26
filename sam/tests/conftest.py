# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
"""Put the repository root on sys.path for `from sam.seed_s3_data import app`.

Without this the import only resolves when pytest is invoked as
`python -m pytest` (which prepends the current directory) from the repository
root. CI runs a bare `pytest sam/tests/`, which does not, so the suite would
fail to collect. Anchoring to __file__ keeps it working from any directory.
"""

import sys
from pathlib import Path

_REPO_ROOT = str(Path(__file__).resolve().parents[2])

if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)
