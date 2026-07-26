# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
import mimetypes
import os
import zipfile

import boto3
import simplejson as json  # type: ignore[import-untyped]
from crhelper import CfnResource  # type: ignore[import-not-found]
from loguru import logger  # type: ignore[import-not-found]

helper = CfnResource()


@helper.create
def seed_data(event, _):
    logger.info(
        f"Create event: RequestType={event.get('RequestType')} LogicalResourceId={event.get('LogicalResourceId')}"
    )
    logger.debug("Event: " + json.dumps(event))
    logger.info("Retrieving S3 Public Website Contents...")
    s3 = boto3.client("s3")
    response = s3.list_objects_v2(
        Bucket=event["ResourceProperties"]["PublicWebsiteBucket"], MaxKeys=1
    )
    if response["KeyCount"] > 0:
        logger.debug("Public Website Bucket already has contents, skipping...")
        return
    with zipfile.ZipFile("website.zip", "r") as zip_ref:
        zip_ref.extractall("/tmp/website/")  # nosec hardcoded_tmp_directory
    path = "/tmp/website/website"  # nosec hardcoded_tmp_directory
    # Replace placeholder config values with Lambda inputs.
    #
    # config.json is a small hand-written file shipped verbatim by the frontend
    # build (Vite copies public/ without touching it), specifically so these
    # substitutions never have to run against bundled, minified, content-hashed
    # output. Rewriting index.html here would also invalidate the Subresource
    # Integrity hashes the build embeds for the JS/CSS bundles.
    properties = event["ResourceProperties"]
    # Both targets are JSON, and every placeholder sits inside a JSON string, so
    # values are escaped for that context. The SiteName CFN parameter's
    # AllowedPattern already excludes quotes and backslashes; this is
    # defense-in-depth so a loosened pattern cannot produce an unparseable
    # config.json (which would take the whole site down) or inject extra keys.
    replacements = {
        "###REPLACE_ME_SITE_NAME###": properties["SiteName"],
        "###REPLACE_ME_IDENTITY_POOL_ID###": properties["IdentityPoolId"],
        "###REPLACE_ME_BUCKET_NAME###": properties["FilesBucketName"],
        # "In New Tab" / "In Same Tab" is constrained by AllowedValues; the
        # frontend treats any value other than "false" as new-tab, so an
        # unexpected value degrades to the documented recommended default.
        "###REPLACE_ME_FILES_OPEN_MODE###": (
            "false" if properties["FilesOpenMode"] == "In Same Tab" else "true"
        ),
        "###REPLACE_ME_VISIBLE_STORAGE_CLASSES###": properties["VisibleStorageClasses"],
    }
    for file_name in ["config.json", "icon/site.webmanifest"]:
        config_path = os.path.join(path, file_name)
        logger.debug(f"Modifying Website Config {config_path}...")
        with open(config_path, "r") as file:
            config_data = file.read()
        for placeholder, value in replacements.items():
            # json.dumps escapes for a JSON string literal; strip its quotes
            # because the placeholder is already inside quotes in the template.
            config_data = config_data.replace(placeholder, json.dumps(str(value))[1:-1])
        with open(config_path, "w") as file:
            file.write(config_data)
        # Fail the deploy loudly rather than serving a broken config.
        json.loads(config_data)
    # Upload the website data
    logger.debug("Uploading Website Data...")
    for subdir, dirs, files in os.walk(path):
        for file in files:
            full_path = os.path.join(subdir, file)
            with open(full_path, "rb") as data:
                object_key = full_path[len(path) + 1 :]
                logger.debug(
                    f"Uploading: {full_path} -> s3://{event['ResourceProperties']['PublicWebsiteBucket']}/pfb_for_s3/{object_key}"
                )
                s3.put_object(
                    Bucket=event["ResourceProperties"]["PublicWebsiteBucket"],
                    Key="pfb_for_s3/" + object_key,
                    Body=data,
                    ContentType=mimetypes.guess_type(full_path)[0]
                    or "application/octet-stream",
                )


@helper.delete
def delete_data(event, _):
    logger.debug("Event: " + json.dumps(event))
    s3 = boto3.client("s3")
    bucket_list = [event["ResourceProperties"]["PublicWebsiteBucket"]]
    for bucket in bucket_list:
        logger.debug(f"Deleting S3 Bucket Contents: {bucket}")
        key_count = 1
        while key_count > 0:
            response = s3.list_objects_v2(Bucket=bucket, MaxKeys=1000)
            key_count = response["KeyCount"]
            if key_count > 0:
                delete_dict = [{"Key": x["Key"]} for x in response["Contents"]]
                for key_obj in delete_dict:
                    logger.debug(f"Queueing S3 Object Deletion: {key_obj['Key']}")
                s3.delete_objects(Bucket=bucket, Delete={"Objects": delete_dict})


@helper.update
def no_op(_, __):
    # No Operation
    pass


def handler(event, context):
    helper(event, context)
