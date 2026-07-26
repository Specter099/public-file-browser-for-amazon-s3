# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
import json
from pathlib import Path

import aws_cdk as cdk
import pytest
from aws_cdk.assertions import Capture, Match, Template

from pfb_cdk.pfb_stack import PublicFileBrowserStack

_BASIC_EXECUTION_ROLE_SUFFIX = "service-role/AWSLambdaBasicExecutionRole"

# `cdk synth` picks up cdk.json's feature-flag context automatically (the CLI
# passes it in via env var); a bare `cdk.App()` in a test process does not, and
# feature flags change the synthesized output -- e.g.
# @aws-cdk/aws-s3:serverAccessLogsUseBucketPolicy decides whether S3 server
# access logging is wired via a bucket policy or a legacy ACL grant, and
# @aws-cdk/aws-lambda:useCdkManagedLogGroup decides whether a log group is
# emitted at all. Load the real context so the tests assert against the same
# template `cdk deploy` would push.
_CDK_JSON = json.loads((Path(__file__).resolve().parent.parent.parent / "cdk.json").read_text())


def _bucket_name_prefix(bucket_resource: dict) -> str:
    """Bucket names synthesize to an Fn::Join of a literal prefix plus the
    stack-ID-derived unique suffix; return just that literal prefix."""
    name = bucket_resource["Properties"]["BucketName"]
    return name["Fn::Join"][1][0]


@pytest.fixture(scope="module")
def template() -> Template:
    # Bundling the seed Lambda's dependencies runs once per Template.from_stack
    # call, so this fixture is module-scoped: every test in this file shares
    # one synth instead of re-running pip install per test.
    app = cdk.App(context=_CDK_JSON["context"])
    stack = PublicFileBrowserStack(app, "TestPublicFileBrowserStack")
    return Template.from_stack(stack)


# ----------------------------------------------------------------------
# Parameters
# ----------------------------------------------------------------------
def test_site_name_parameter(template: Template):
    template.has_parameter(
        "SiteName",
        {
            "Type": "String",
            "Default": "AnyCompany Public Files",
            "MinLength": 1,
            "MaxLength": 80,
            "AllowedPattern": r"^[A-Za-z0-9 .,'\-_:()]+$",
        },
    )


def test_files_open_tab_mode_parameter(template: Template):
    template.has_parameter(
        "FilesOpenTabMode",
        {
            "Type": "String",
            "Default": "In New Tab",
            "AllowedValues": ["In New Tab", "In Same Tab"],
        },
    )


def test_visible_storage_classes_parameter(template: Template):
    template.has_parameter(
        "VisibleStorageClasses",
        {
            "Type": "String",
            "Default": "STANDARD,STANDARD_IA,ONEZONE_IA,REDUCED_REDUNDANCY",
            "AllowedPattern": "^[A-Z_]+(,[A-Z_]+)*$",
        },
    )


def test_cross_origin_restriction_parameter(template: Template):
    template.has_parameter(
        "CrossOriginRestriction",
        {
            "Type": "String",
            "Default": "*",
            "AllowedPattern": r"^(\*|https://[A-Za-z0-9.-]+(:[0-9]+)?)$",
        },
    )


# ----------------------------------------------------------------------
# S3
# ----------------------------------------------------------------------
def test_three_buckets_created(template: Template):
    template.resource_count_is("AWS::S3::Bucket", 3)


def test_buckets_are_encrypted_and_versioned(template: Template):
    template.all_resources_properties(
        "AWS::S3::Bucket",
        {
            "BucketEncryption": {
                "ServerSideEncryptionConfiguration": [
                    {"ServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}
                ]
            },
            "VersioningConfiguration": {"Status": "Enabled"},
            "PublicAccessBlockConfiguration": {
                "BlockPublicAcls": True,
                "BlockPublicPolicy": True,
                "IgnorePublicAcls": True,
                "RestrictPublicBuckets": True,
            },
        },
    )


def test_buckets_expire_noncurrent_versions_after_90_days(template: Template):
    template.all_resources_properties(
        "AWS::S3::Bucket",
        {
            "LifecycleConfiguration": {
                "Rules": [
                    Match.object_like(
                        {
                            "Status": "Enabled",
                            "NoncurrentVersionExpiration": {"NoncurrentDays": 90},
                        }
                    )
                ]
            }
        },
    )


def test_only_the_logging_bucket_is_retained_on_delete(template: Template):
    # SAM sets DeletionPolicy: Retain on the logging bucket alone; the website
    # and files buckets default to Delete. CDK's s3.Bucket default is Retain,
    # so this pins the difference rather than passing trivially.
    buckets = template.find_resources("AWS::S3::Bucket")
    by_policy = {}
    for logical_id, resource in buckets.items():
        prefix = _bucket_name_prefix(resource)
        by_policy[prefix] = resource.get("DeletionPolicy")

    assert by_policy == {
        "public-file-browser-logging-": "Retain",
        "public-file-browser-website-": "Delete",
        "public-file-browser-files-": "Delete",
    }, by_policy


def test_no_cloudwatch_log_group_is_created(template: Template):
    # The seeding Lambda deliberately produces no CloudWatch logs: a log group
    # created during stack deletion cannot be cleaned up automatically. CDK's
    # @aws-cdk/aws-lambda:useCdkManagedLogGroup feature flag would synthesize a
    # Retain-policy log group, so it is switched off in cdk.json.
    template.resource_count_is("AWS::Logs::LogGroup", 0)


def test_files_bucket_has_cors_rule_bound_to_cross_origin_parameter(template: Template):
    template.has_resource_properties(
        "AWS::S3::Bucket",
        {
            "CorsConfiguration": {
                "CorsRules": [
                    {
                        "AllowedHeaders": ["*"],
                        "AllowedMethods": ["HEAD", "GET"],
                        "AllowedOrigins": [{"Ref": "CrossOriginRestriction"}],
                        "ExposedHeaders": ["ETag"],
                        "Id": "CORSRule",
                        "MaxAge": 3600,
                    }
                ]
            }
        },
    )


def test_bucket_policies_deny_insecure_transport(template: Template):
    # enforce_ssl=True on every bucket should produce a Deny statement
    # equivalent to the SAM template's hand-written DenyPlaintextAccess.
    template.resource_count_is("AWS::S3::BucketPolicy", 3)
    template.all_resources_properties(
        "AWS::S3::BucketPolicy",
        {
            "PolicyDocument": {
                "Statement": Match.array_with(
                    [
                        Match.object_like(
                            {
                                "Effect": "Deny",
                                "Principal": {"AWS": "*"},
                                "Action": "s3:*",
                                "Condition": {"Bool": {"aws:SecureTransport": "false"}},
                            }
                        )
                    ]
                )
            }
        },
    )


def test_website_and_files_buckets_grant_cloudfront_read_via_oac(template: Template):
    # Each origin bucket's policy should allow cloudfront.amazonaws.com to
    # GetObject, scoped to this distribution via the AWS:SourceArn condition
    # (the OAC equivalent of the SAM template's CloudFrontReadForGetBucketObjects).
    statement = Match.object_like(
        {
            "Effect": "Allow",
            "Principal": {"Service": "cloudfront.amazonaws.com"},
            "Action": "s3:GetObject",
            "Condition": {"StringEquals": {"AWS:SourceArn": Match.any_value()}},
        }
    )
    matches = template.find_resources(
        "AWS::S3::BucketPolicy",
        {"Properties": {"PolicyDocument": {"Statement": Match.array_with([statement])}}},
    )
    assert len(matches) == 2, "expected both origin buckets to grant CloudFront OAC read access"


# ----------------------------------------------------------------------
# CloudFront
# ----------------------------------------------------------------------
def test_single_origin_access_control(template: Template):
    template.resource_count_is("AWS::CloudFront::OriginAccessControl", 1)
    template.has_resource_properties(
        "AWS::CloudFront::OriginAccessControl",
        {
            "OriginAccessControlConfig": Match.object_like(
                {
                    "OriginAccessControlOriginType": "s3",
                    "SigningBehavior": "always",
                    "SigningProtocol": "sigv4",
                }
            )
        },
    )


def test_distribution_uses_caching_optimized_managed_policy(template: Template):
    # 658327ea-f89d-4fab-a63d-7e88639e58f6 is the AWS managed "CachingOptimized"
    # cache policy - the same ID the SAM template hard-codes.
    template.has_resource_properties(
        "AWS::CloudFront::Distribution",
        {
            "DistributionConfig": Match.object_like(
                {
                    "DefaultCacheBehavior": Match.object_like(
                        {"CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6"}
                    )
                }
            )
        },
    )


def test_distribution_has_pfb_for_s3_behavior(template: Template):
    template.has_resource_properties(
        "AWS::CloudFront::Distribution",
        {
            "DistributionConfig": Match.object_like(
                {
                    "CacheBehaviors": Match.array_with(
                        [
                            Match.object_like(
                                {
                                    "PathPattern": "pfb_for_s3/*",
                                    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
                                }
                            )
                        ]
                    )
                }
            )
        },
    )


def test_distribution_security_settings(template: Template):
    template.has_resource_properties(
        "AWS::CloudFront::Distribution",
        {
            "DistributionConfig": Match.object_like(
                {
                    "DefaultRootObject": "pfb_for_s3/index.html",
                    "IPV6Enabled": False,
                    "PriceClass": "PriceClass_100",
                    "HttpVersion": "http2",
                    "DefaultCacheBehavior": Match.object_like(
                        {"ViewerProtocolPolicy": "redirect-to-https"}
                    ),
                    "Logging": Match.object_like({"IncludeCookies": False}),
                }
            )
        },
    )


def test_response_headers_policy_security_headers(template: Template):
    template.resource_count_is("AWS::CloudFront::ResponseHeadersPolicy", 1)
    template.has_resource_properties(
        "AWS::CloudFront::ResponseHeadersPolicy",
        {
            "ResponseHeadersPolicyConfig": Match.object_like(
                {
                    "SecurityHeadersConfig": {
                        "StrictTransportSecurity": {
                            "AccessControlMaxAgeSec": 31536000,
                            "IncludeSubdomains": True,
                            "Preload": True,
                            "Override": True,
                        },
                        "ContentTypeOptions": {"Override": True},
                        "ReferrerPolicy": {
                            "ReferrerPolicy": "strict-origin-when-cross-origin",
                            "Override": True,
                        },
                        "FrameOptions": {"FrameOption": "DENY", "Override": True},
                    }
                }
            )
        },
    )


def test_both_cache_behaviors_attach_the_security_headers_policy(template: Template):
    capture = Capture()
    template.has_resource_properties(
        "AWS::CloudFront::Distribution",
        {
            "DistributionConfig": Match.object_like(
                {
                    "DefaultCacheBehavior": Match.object_like(
                        {"ResponseHeadersPolicyId": capture}
                    ),
                }
            )
        },
    )
    default_behavior_policy_ref = capture.as_object()

    template.has_resource_properties(
        "AWS::CloudFront::Distribution",
        {
            "DistributionConfig": Match.object_like(
                {
                    "CacheBehaviors": Match.array_with(
                        [
                            Match.object_like(
                                {"ResponseHeadersPolicyId": default_behavior_policy_ref}
                            )
                        ]
                    ),
                }
            )
        },
    )


# ----------------------------------------------------------------------
# Lambda / seeding custom resource
# ----------------------------------------------------------------------
def test_seed_lambda_runtime_and_architecture(template: Template):
    template.has_resource_properties(
        "AWS::Lambda::Function",
        {
            "Runtime": "python3.13",
            "Architectures": ["arm64"],
            "Handler": "app.handler",
            "Timeout": 30,
            "Environment": {"Variables": {"LOGURU_LEVEL": "INFO"}},
        },
    )


def test_seed_lambda_role_has_no_basic_execution_managed_policy(template: Template):
    # Deliberately no AWSLambdaBasicExecutionRole: attaching it would create a
    # CloudWatch log group during stack deletion that can't be cleaned up.
    role_capture = Capture()
    template.has_resource_properties(
        "AWS::Lambda::Function", {"Role": {"Fn::GetAtt": role_capture}}
    )
    role_logical_id = role_capture.as_array()[0]

    role_resource = template.to_json()["Resources"][role_logical_id]
    managed_policies = role_resource["Properties"].get("ManagedPolicyArns", [])
    assert all(
        _BASIC_EXECUTION_ROLE_SUFFIX not in str(arn) for arn in managed_policies
    ), "seed Lambda's role must not carry AWSLambdaBasicExecutionRole"


def test_seed_lambda_role_can_read_write_delete_website_bucket(template: Template):
    template.has_resource_properties(
        "AWS::IAM::Policy",
        {
            "PolicyDocument": {
                "Statement": Match.array_with(
                    [
                        Match.object_like(
                            {
                                "Action": Match.array_with(["s3:DeleteObject*"]),
                                "Effect": "Allow",
                            }
                        )
                    ]
                )
            }
        },
    )


def test_seed_custom_resource_properties(template: Template):
    # These keys are read by name in sam/seed_s3_data/app.py's seed_data();
    # a missing or renamed one silently breaks deploy-time templating.
    resources = template.find_resources("Custom::SeedS3Data")
    (custom_resource,) = resources.values()
    properties = custom_resource["Properties"]

    assert set(properties) == {
        "ServiceToken",
        "SiteName",
        "IdentityPoolId",
        "PublicWebsiteBucket",
        "FilesBucketName",
        "FilesOpenMode",
        "VisibleStorageClasses",
    }, sorted(properties)

    assert properties["SiteName"] == {"Ref": "SiteName"}
    assert properties["IdentityPoolId"] == {"Ref": "CognitoIdentityPool"}
    assert properties["FilesOpenMode"] == {"Ref": "FilesOpenTabMode"}
    assert properties["VisibleStorageClasses"] == {"Ref": "VisibleStorageClasses"}

    # The two bucket properties must Ref the buckets themselves, not a literal.
    website_ref = properties["PublicWebsiteBucket"]["Ref"]
    files_ref = properties["FilesBucketName"]["Ref"]
    buckets = template.find_resources("AWS::S3::Bucket")
    assert _bucket_name_prefix(buckets[website_ref]) == "public-file-browser-website-"
    assert _bucket_name_prefix(buckets[files_ref]) == "public-file-browser-files-"


def test_exactly_one_custom_resource(template: Template):
    template.resource_count_is("Custom::SeedS3Data", 1)


# ----------------------------------------------------------------------
# Cognito
# ----------------------------------------------------------------------
def test_identity_pool_allows_unauthenticated_identities(template: Template):
    template.has_resource_properties(
        "AWS::Cognito::IdentityPool", {"AllowUnauthenticatedIdentities": True}
    )


def test_identity_pool_role_attachment_maps_unauthenticated_role(template: Template):
    template.has_resource_properties(
        "AWS::Cognito::IdentityPoolRoleAttachment",
        {
            "IdentityPoolId": {"Ref": "CognitoIdentityPool"},
            "Roles": {"unauthenticated": Match.any_value()},
        },
    )


def test_unauthenticated_role_can_only_list_files_bucket(template: Template):
    template.has_resource_properties(
        "AWS::IAM::Role",
        {
            "AssumeRolePolicyDocument": Match.object_like(
                {
                    "Statement": Match.array_with(
                        [
                            Match.object_like(
                                {
                                    "Action": "sts:AssumeRoleWithWebIdentity",
                                    "Condition": Match.object_like(
                                        {
                                            "ForAnyValue:StringLike": {
                                                "cognito-identity.amazonaws.com:amr": "unauthenticated"
                                            }
                                        }
                                    ),
                                }
                            )
                        ]
                    )
                }
            )
        },
    )
    # The unauthenticated role's policy must be exactly one ListBucket grant
    # scoped to the files bucket - nothing else, and no object-level access.
    buckets = template.find_resources("AWS::S3::Bucket")
    files_bucket_id = next(
        logical_id
        for logical_id, resource in buckets.items()
        if _bucket_name_prefix(resource) == "public-file-browser-files-"
    )

    unauth_policies = [
        policy
        for policy in template.find_resources("AWS::IAM::Policy").values()
        if policy["Properties"]["PolicyDocument"]["Statement"]
        == [
            {
                "Action": "s3:ListBucket",
                "Effect": "Allow",
                "Resource": {"Fn::GetAtt": [files_bucket_id, "Arn"]},
                "Sid": "FileAccess",
            }
        ]
    ]
    assert len(unauth_policies) == 1, "expected exactly one files-bucket ListBucket policy"


# ----------------------------------------------------------------------
# Outputs
# ----------------------------------------------------------------------
@pytest.mark.parametrize(
    "output_name", ["FileBrowserURL", "PublicFilesBucket", "WebInterfaceAppBucket"]
)
def test_expected_output_exists(template: Template, output_name: str):
    template.has_output(output_name, {})


def test_file_browser_url_output_uses_distribution_domain_name(template: Template):
    template.has_output(
        "FileBrowserURL",
        {"Value": Match.object_like({"Fn::Join": Match.any_value()})},
    )
