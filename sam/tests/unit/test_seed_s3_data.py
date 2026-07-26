import json
import os
import zipfile
from pathlib import Path

import boto3
import pytest
from moto import mock_s3  # type: ignore[attr-defined]

from sam.seed_s3_data import app

# The Lambda resolves website.zip by a relative path, so these tests have to run
# from the function's own directory. That directory is resolved from __file__
# rather than the current working directory: CI invokes `pytest sam/tests/` from
# the repository root, and anything cwd-relative only passes when run from sam/.
_LAMBDA_DIR = Path(__file__).resolve().parents[2] / "seed_s3_data"
_EXTRACTED = "/tmp/website/website"  # nosec hardcoded_tmp_directory


def _chdir_to_lambda():
    """Enter the Lambda directory, tolerating already being there.

    These tests share a process and each one may run first, so the chdir has to
    be idempotent rather than assuming any particular starting directory.
    """
    if Path.cwd() != _LAMBDA_DIR:
        os.chdir(_LAMBDA_DIR)


def _read(relative_path: str) -> str:
    with open(os.path.join(_EXTRACTED, relative_path), "r") as file:
        return file.read()


def _read_bytes(relative_path: str) -> bytes:
    with open(os.path.join(_EXTRACTED, relative_path), "rb") as file:
        return file.read()


@pytest.fixture()
def cloudformation_event():
    return {
        "RequestType": "Create",
        "ServiceToken": "REDACTED",
        "ResponseURL": "REDACTED",
        "StackId": "REDACTED",
        "RequestId": "REDACTED",
        "LogicalResourceId": "SeedS3Data",
        "ResourceType": "Custom::SeedS3Data",
        "ResourceProperties": {
            "ServiceToken": "REDACTED",
            "PublicWebsiteBucket": "test-bucket-static-website",
            "FilesOpenMode": "In New Tab",
            "SiteName": "TEST_SITE_NAME",
            "IdentityPoolId": "TEST_IDENTITY_POOL",
            "FilesBucketName": "test-bucket-files",
            "VisibleStorageClasses": "STANDARD,STANDARD_IA,ONEZONE_IA,REDUCED_REDUNDANCY",
        },
    }


@mock_s3
def test_seed_data(cloudformation_event):
    boto3.setup_default_session()
    s3 = boto3.client("s3")
    s3.create_bucket(
        Bucket="test-bucket-static-website",
        CreateBucketConfiguration={"LocationConstraint": "us-west-2"},
    )
    s3.create_bucket(
        Bucket="test-bucket-files",
        CreateBucketConfiguration={"LocationConstraint": "us-west-2"},
    )
    _chdir_to_lambda()
    app.seed_data(cloudformation_event, None)

    # Deploy-time settings live in config.json, which the frontend build ships
    # verbatim; index.html is bundled output and is never rewritten here.
    config = json.loads(_read("config.json"))
    assert config["bucketName"] == "test-bucket-files"  # nosec assert_used
    assert config["siteName"] == "TEST_SITE_NAME"  # nosec assert_used
    assert config["identityPoolId"] == "TEST_IDENTITY_POOL"  # nosec assert_used
    assert (  # nosec assert_used
        config["visibleStorageClasses"]
        == "STANDARD,STANDARD_IA,ONEZONE_IA,REDUCED_REDUNDANCY"
    )
    assert config["filesOpenInNewTab"] == "true"  # nosec assert_used

    response = s3.list_objects_v2(Bucket="test-bucket-static-website")
    assert response["KeyCount"] > 0  # nosec assert_used


@mock_s3
def test_seed_data_leaves_bundled_index_html_untouched(cloudformation_event):
    # index.html carries Subresource Integrity hashes for the bundled JS/CSS.
    # Substituting into it would invalidate those hashes and the browser would
    # refuse to execute the bundle, so the seeding step must not modify it.
    boto3.setup_default_session()
    s3 = boto3.client("s3")
    s3.create_bucket(
        Bucket="test-bucket-static-website",
        CreateBucketConfiguration={"LocationConstraint": "us-west-2"},
    )
    _chdir_to_lambda()

    with zipfile.ZipFile("website.zip", "r") as archive:
        original = archive.read("website/index.html")

    app.seed_data(cloudformation_event, None)

    assert _read_bytes("index.html") == original  # nosec assert_used


@mock_s3
def test_seed_data_sets_same_tab_mode(cloudformation_event):
    boto3.setup_default_session()
    s3 = boto3.client("s3")
    s3.create_bucket(
        Bucket="test-bucket-static-website",
        CreateBucketConfiguration={"LocationConstraint": "us-west-2"},
    )
    cloudformation_event["ResourceProperties"]["FilesOpenMode"] = "In Same Tab"
    _chdir_to_lambda()
    app.seed_data(cloudformation_event, None)

    assert json.loads(_read("config.json"))["filesOpenInNewTab"] == "false"  # nosec assert_used


@mock_s3
def test_seed_data_escapes_values_for_json(cloudformation_event):
    # The SiteName AllowedPattern blocks quotes and backslashes at deploy time;
    # this asserts the substitution is still safe if that pattern is loosened,
    # because an unescaped quote would make config.json unparseable and take
    # the whole site down.
    boto3.setup_default_session()
    s3 = boto3.client("s3")
    s3.create_bucket(
        Bucket="test-bucket-static-website",
        CreateBucketConfiguration={"LocationConstraint": "us-west-2"},
    )
    hostile = 'Ac"me\\ Co", "injected": "yes'
    cloudformation_event["ResourceProperties"]["SiteName"] = hostile
    _chdir_to_lambda()
    app.seed_data(cloudformation_event, None)

    config = json.loads(_read("config.json"))
    assert config["siteName"] == hostile  # nosec assert_used
    assert "injected" not in config  # nosec assert_used

    # site.webmanifest gets the same value and must stay valid JSON too.
    manifest = json.loads(_read("icon/site.webmanifest"))
    assert manifest["name"] == hostile  # nosec assert_used


@mock_s3
def test_seed_data_with_existing_data(cloudformation_event):
    boto3.setup_default_session()
    s3 = boto3.client("s3")
    s3.create_bucket(
        Bucket="test-bucket-static-website",
        CreateBucketConfiguration={"LocationConstraint": "us-west-2"},
    )
    s3.create_bucket(
        Bucket="test-bucket-files",
        CreateBucketConfiguration={"LocationConstraint": "us-west-2"},
    )
    s3.put_object(
        Bucket="test-bucket-static-website", Key="test-data-object", Body=b"test-data"
    )
    app.seed_data(cloudformation_event, None)
    response = s3.list_objects_v2(Bucket="test-bucket-static-website")
    assert response["KeyCount"] == 1  # nosec assert_used


@mock_s3
def test_seed_data_preserves_sitename_verbatim(cloudformation_event):
    # The SiteName CFN parameter is restricted by AllowedPattern in
    # template.yaml; this checks the Lambda passes a permitted value through
    # unchanged and leaves no placeholder behind in either templated file.
    boto3.setup_default_session()
    s3 = boto3.client("s3")
    s3.create_bucket(
        Bucket="test-bucket-static-website",
        CreateBucketConfiguration={"LocationConstraint": "us-west-2"},
    )
    s3.create_bucket(
        Bucket="test-bucket-files",
        CreateBucketConfiguration={"LocationConstraint": "us-west-2"},
    )
    cloudformation_event["ResourceProperties"]["SiteName"] = "Acme Co. (Internal)"
    _chdir_to_lambda()
    app.seed_data(cloudformation_event, None)

    for file_name in ("config.json", "icon/site.webmanifest"):
        contents = _read(file_name)
        assert "###REPLACE_ME_" not in contents, file_name  # nosec assert_used

    assert json.loads(_read("config.json"))["siteName"] == "Acme Co. (Internal)"  # nosec assert_used
    assert (  # nosec assert_used
        json.loads(_read("icon/site.webmanifest"))["name"] == "Acme Co. (Internal)"
    )


@mock_s3
def test_delete_data_with_existing_data(cloudformation_event):
    boto3.setup_default_session()
    s3 = boto3.client("s3")
    s3.create_bucket(
        Bucket="test-bucket-static-website",
        CreateBucketConfiguration={"LocationConstraint": "us-west-2"},
    )
    s3.create_bucket(
        Bucket="test-bucket-files",
        CreateBucketConfiguration={"LocationConstraint": "us-west-2"},
    )
    s3.put_object(
        Bucket="test-bucket-static-website", Key="test-data-object", Body=b"test-data"
    )
    app.delete_data(cloudformation_event, None)
    response = s3.list_objects_v2(Bucket="test-bucket-static-website")
    assert response["KeyCount"] == 0  # nosec assert_used
