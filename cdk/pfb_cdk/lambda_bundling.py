# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
"""Local (non-Docker) asset bundling for the seed_s3_data Lambda.

The Lambda's third-party dependencies (crhelper, loguru, simplejson) are not
part of the standard Lambda Python runtime and must be vendored into the
deployment package, the same way ``sam build`` vendors them from
``requirements.txt``. This module reproduces that step without requiring
Docker: it downloads pre-built wheels for the target Lambda runtime
(``python3.13`` / ``arm64``) directly, which works even when the machine
running ``cdk synth`` is a different OS/architecture/Python version than
the Lambda runtime.

CDK's asset bundling normally shells out to Docker, but this repository's
values are all pure-Python (or ship universal wheels), so a real container
build brings no benefit here and would force a hard Docker dependency onto a
project that has otherwise never needed one.
"""
import subprocess  # nosec B404 - fixed argv, no shell, used only at synth time
import sys
from pathlib import Path

import jsii
from aws_cdk import BundlingOptions, DockerImage, ILocalBundling

# Matches the CustomSeedS3Data function's Runtime/Architectures in the stack.
_TARGET_PYTHON_VERSION = "3.13"
_TARGET_PLATFORM = "manylinux2014_aarch64"


def _resolve_requirements_for_target(requirements_path: Path) -> str:
    """Rewrite requirements.txt for the *target* Lambda runtime.

    seed_s3_data/requirements.txt pins `; python_version >= "3.13"` markers,
    which pip evaluates against the interpreter running `cdk synth` -- on any
    host older than 3.13 that silently resolves to an empty install. Drop the
    marker so the pins apply, but skip requirements gated on a non-Linux
    platform so Windows-only packages don't land in a Linux Lambda package.
    """
    lines = []
    for line in requirements_path.read_text().splitlines():
        requirement, _, marker = line.partition(";")
        requirement = requirement.strip()
        if not requirement or requirement.startswith("#"):
            continue
        if "sys_platform" in marker and '"linux"' not in marker:
            continue
        lines.append(requirement)
    return "\n".join(lines) + "\n"


@jsii.implements(ILocalBundling)
class _PipInstallLocalBundling:
    """Installs seed_s3_data's requirements.txt plus its source files into
    the CDK asset output directory, targeting the Lambda's runtime/arch."""

    def __init__(self, source_dir: Path):
        self._source_dir = source_dir

    def try_bundle(self, output_dir: str, *_args, **_kwargs) -> bool:
        requirements = self._source_dir / "requirements.txt"
        stripped_requirements = Path(output_dir) / "_requirements.stripped.txt"
        stripped_requirements.write_text(_resolve_requirements_for_target(requirements))

        subprocess.check_call(  # nosec B603 - fixed argv, no shell, trusted input
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--no-cache-dir",
                "--only-binary=:all:",
                "--platform",
                _TARGET_PLATFORM,
                "--implementation",
                "cp",
                "--python-version",
                _TARGET_PYTHON_VERSION,
                "--target",
                output_dir,
                "-r",
                str(stripped_requirements),
            ]
        )
        stripped_requirements.unlink()

        # website.zip is read at runtime by app.py via a relative path, so it
        # must ship alongside the handler code, not just app.py itself.
        for name in ("app.py", "website.zip"):
            (Path(output_dir) / name).write_bytes(
                (self._source_dir / name).read_bytes()
            )
        return True


def seed_lambda_bundling_options(source_dir: Path) -> BundlingOptions:
    """Bundling options for `lambda_.Code.from_asset(source_dir, bundling=...)`.

    Falls back to a Docker image (standard Python 3.13 Lambda build image) if
    local bundling ever fails or Docker-based bundling is explicitly forced,
    but the local path is what actually runs in normal use.
    """
    return BundlingOptions(
        image=DockerImage.from_registry(
            "public.ecr.aws/sam/build-python3.13:latest-arm64"
        ),
        command=[
            "bash",
            "-c",
            "pip install --no-cache-dir -r requirements.txt -t /asset-output "
            "&& cp app.py website.zip /asset-output/",
        ],
        local=_PipInstallLocalBundling(source_dir),
    )
