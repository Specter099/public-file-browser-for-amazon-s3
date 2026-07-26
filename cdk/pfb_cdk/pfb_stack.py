# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
"""CDK translation of sam/template.yaml.

Keeps the same resource shape, naming convention, and security posture as
the SAM/CloudFormation template it replaces:
  - 3 S3 buckets (website, files, logging), CloudFront (+ OAC + a security
    response headers policy), a Cognito unauthenticated identity pool, and
    a Lambda-backed custom resource that seeds the website bucket.
  - Resource names keep the `public-file-browser-<kind>-<Unique>` pattern,
    where <Unique> is derived from the stack ID exactly as in the SAM
    template, so existing operational docs/scripts that match on that
    prefix keep working.
  - The seeding Lambda intentionally has no AWSLambdaBasicExecutionRole (see
    CustomSeedS3DataRole below) — granting it would create a CloudWatch log
    group during stack deletion that cannot be cleaned up automatically.
"""

from pathlib import Path

from aws_cdk import (
    Aws,
    CfnOutput,
    CfnParameter,
    CustomResource,
    Duration,
    Fn,
    RemovalPolicy,
    Stack,
)
from aws_cdk import aws_cloudfront as cloudfront
from aws_cdk import aws_cloudfront_origins as origins
from aws_cdk import aws_cognito as cognito
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_s3 as s3
from constructs import Construct

from pfb_cdk.lambda_bundling import seed_lambda_bundling_options

# sam/seed_s3_data/ is reused as-is (app.py + website.zip) so the Lambda
# source and the website bundle keep a single source of truth instead of
# being duplicated under cdk/.
_SEED_S3_DATA_DIR = (
    Path(__file__).resolve().parent.parent.parent / "sam" / "seed_s3_data"
)

# AWS managed "CachingOptimized" cache policy — the same
# 658327ea-f89d-4fab-a63d-7e88639e58f6 the SAM template references by ID.
_CACHING_OPTIMIZED = cloudfront.CachePolicy.CACHING_OPTIMIZED


class PublicFileBrowserStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        params = self._create_parameters()
        unique = self._unique_suffix()

        logging_bucket = self._create_logging_bucket(unique)
        website_bucket = self._create_website_bucket(unique, logging_bucket)
        files_bucket = self._create_files_bucket(
            unique, logging_bucket, params["cross_origin_restriction"]
        )

        oac = cloudfront.S3OriginAccessControl(
            self,
            "CloudFrontOriginAccessControl",
            origin_access_control_name=f"public-file-browser-{unique}",
            description="Public File Browser for Amazon S3",
            signing=cloudfront.Signing.SIGV4_ALWAYS,
        )
        website_origin = origins.S3BucketOrigin.with_origin_access_control(
            website_bucket, origin_access_control=oac
        )
        files_origin = origins.S3BucketOrigin.with_origin_access_control(
            files_bucket, origin_access_control=oac
        )

        headers_policy = self._create_security_headers_policy(unique)
        distribution = self._create_distribution(
            unique, logging_bucket, files_origin, website_origin, headers_policy
        )

        identity_pool, unauth_role = self._create_cognito(unique, files_bucket)

        self._create_seed_custom_resource(
            website_bucket, files_bucket, identity_pool, params
        )

        CfnOutput(
            self,
            "FileBrowserURL",
            description="The web URL for the deployed Public File Browser for Amazon S3 solution",
            value=f"https://{distribution.distribution_domain_name}",
        )
        # Construct ID can't be "PublicFilesBucket" - it collides with the
        # bucket construct of the same name. override_logical_id() keeps the
        # CloudFormation output's name matching the original template.
        public_files_bucket_output = CfnOutput(
            self,
            "PublicFilesBucketOutput",
            description="The name of the Amazon S3 Bucket for storing PUBLICLY ACCESSIBLE files.",
            value=files_bucket.bucket_name,
        )
        public_files_bucket_output.override_logical_id("PublicFilesBucket")
        CfnOutput(
            self,
            "WebInterfaceAppBucket",
            description="The name of the Amazon S3 Bucket for the HTML/JS/CSS pages that make up the file browser web interface.",
            value=website_bucket.bucket_name,
        )

        # Kept for reference by tests / callers that need the role.
        self.cognito_unauthenticated_role = unauth_role

    # ------------------------------------------------------------------
    # Parameters
    # ------------------------------------------------------------------
    def _create_parameters(self) -> dict:
        site_name = CfnParameter(
            self,
            "SiteName",
            type="String",
            description=(
                "Friendly Site Name displayed in the header and title of the website. "
                "Restricted to alphanumeric characters and a small set of safe "
                "punctuation to prevent HTML/JS injection at deploy time."
            ),
            default="AnyCompany Public Files",
            min_length=1,
            max_length=80,
            allowed_pattern=r"^[A-Za-z0-9 .,'\-_:()]+$",
            constraint_description=(
                "SiteName must be 1-80 characters, alphanumeric plus space and the "
                "punctuation . , ' - _ : ( )"
            ),
        )
        files_open_tab_mode = CfnParameter(
            self,
            "FilesOpenTabMode",
            type="String",
            description="How do files open when clicked",
            allowed_values=["In New Tab", "In Same Tab"],
            default="In New Tab",
        )
        visible_storage_classes = CfnParameter(
            self,
            "VisibleStorageClasses",
            type="String",
            description=(
                "Comma-delimited list of storage classes to SHOW in directory "
                "listings. See S3 GetObject API Reference for possible values."
            ),
            default="STANDARD,STANDARD_IA,ONEZONE_IA,REDUCED_REDUNDANCY",
            allowed_pattern=r"^[A-Z_]+(,[A-Z_]+)*$",
            constraint_description=(
                "VisibleStorageClasses must be a comma-separated list of S3 storage "
                "class identifiers (uppercase letters and underscores)."
            ),
        )
        cross_origin_restriction = CfnParameter(
            self,
            "CrossOriginRestriction",
            type="String",
            description=(
                'First deployment set to "*", subsequent deployments set to the '
                "FileBrowserURL CloudFormation output (e.g. "
                "https://d111111abcdef8.cloudfront.net). No trailing slash."
            ),
            default="*",
            allowed_pattern=r"^(\*|https://[A-Za-z0-9.-]+(:[0-9]+)?)$",
            constraint_description='Must be either "*" or an https origin (no trailing slash).',
        )
        return {
            "site_name": site_name,
            "files_open_tab_mode": files_open_tab_mode,
            "visible_storage_classes": visible_storage_classes,
            "cross_origin_restriction": cross_origin_restriction,
        }

    def _unique_suffix(self) -> str:
        # Matches the SAM template's
        # !Select [4, !Split ['-', !Select [2, !Split ['/', !Ref 'AWS::StackId']]]]
        return Fn.select(4, Fn.split("-", Fn.select(2, Fn.split("/", Aws.STACK_ID))))

    # ------------------------------------------------------------------
    # S3
    # ------------------------------------------------------------------
    def _create_logging_bucket(self, unique: str) -> s3.Bucket:
        bucket = s3.Bucket(
            self,
            "LoggingBucket",
            bucket_name=f"public-file-browser-logging-{unique}",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            object_ownership=s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
            encryption=s3.BucketEncryption.S3_MANAGED,
            versioned=True,
            enforce_ssl=True,
            removal_policy=RemovalPolicy.RETAIN,
            lifecycle_rules=[
                s3.LifecycleRule(
                    id="DeleteOldVersionAfter90Days",
                    enabled=True,
                    noncurrent_version_expiration=Duration.days(90),
                )
            ],
        )
        # cfn_nag W35 / checkov CKV_AWS_18: unnecessary to log access to the
        # logging bucket itself.
        bucket.node.default_child.cfn_options.metadata = {
            "cfn_nag": {
                "rules_to_suppress": [
                    {
                        "id": "W35",
                        "reason": "Unnecessary to log access to the logging bucket.",
                    }
                ]
            },
            "checkov": {
                "skip": [
                    {
                        "id": "CKV_AWS_18",
                        "comment": "Unnecessary to log access to the logging bucket.",
                    }
                ]
            },
        }
        return bucket

    def _create_website_bucket(
        self, unique: str, logging_bucket: s3.Bucket
    ) -> s3.Bucket:
        return s3.Bucket(
            self,
            "PublicWebsiteBucket",
            bucket_name=f"public-file-browser-website-{unique}",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            versioned=True,
            enforce_ssl=True,
            # SAM sets DeletionPolicy only on the logging bucket; this one
            # defaults to Delete there, so match it rather than inheriting
            # CDK's Retain default and orphaning an emptied bucket.
            # No auto_delete_objects: that provisions a second Lambda with
            # CloudWatch permissions, which is exactly the leftover log group
            # this stack goes out of its way to avoid.
            removal_policy=RemovalPolicy.DESTROY,
            server_access_logs_bucket=logging_bucket,
            server_access_logs_prefix="s3-website/",
            lifecycle_rules=[
                s3.LifecycleRule(
                    id="DeleteOldVersionAfter90Days",
                    enabled=True,
                    noncurrent_version_expiration=Duration.days(90),
                )
            ],
        )

    def _create_files_bucket(
        self,
        unique: str,
        logging_bucket: s3.Bucket,
        cross_origin_restriction: CfnParameter,
    ) -> s3.Bucket:
        return s3.Bucket(
            self,
            "PublicFilesBucket",
            bucket_name=f"public-file-browser-files-{unique}",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            versioned=True,
            enforce_ssl=True,
            # Matches SAM (no DeletionPolicy => Delete). This does not risk the
            # user's files: S3 refuses to delete a non-empty bucket, so a stack
            # deletion fails loudly rather than discarding data.
            removal_policy=RemovalPolicy.DESTROY,
            server_access_logs_bucket=logging_bucket,
            server_access_logs_prefix="s3-files/",
            lifecycle_rules=[
                s3.LifecycleRule(
                    id="DeleteOldVersionAfter90Days",
                    enabled=True,
                    noncurrent_version_expiration=Duration.days(90),
                )
            ],
            cors=[
                s3.CorsRule(
                    id="CORSRule",
                    allowed_headers=["*"],
                    allowed_methods=[s3.HttpMethods.HEAD, s3.HttpMethods.GET],
                    # First deployment is "*"; the second deployment pass narrows
                    # this to the FileBrowserURL output once it's known, since
                    # the CORS rule can't reference the CloudFront distribution
                    # it's deployed alongside without a circular dependency.
                    allowed_origins=[cross_origin_restriction.value_as_string],
                    exposed_headers=["ETag"],
                    max_age=3600,
                )
            ],
        )

    # ------------------------------------------------------------------
    # CloudFront
    # ------------------------------------------------------------------
    def _create_security_headers_policy(
        self, unique: str
    ) -> cloudfront.ResponseHeadersPolicy:
        return cloudfront.ResponseHeadersPolicy(
            self,
            "SecurityResponseHeadersPolicy",
            response_headers_policy_name=f"public-file-browser-headers-{unique}",
            comment="Security response headers for the Public File Browser distribution.",
            security_headers_behavior=cloudfront.ResponseSecurityHeadersBehavior(
                strict_transport_security=cloudfront.ResponseHeadersStrictTransportSecurity(
                    access_control_max_age=Duration.seconds(31536000),
                    include_subdomains=True,
                    preload=True,
                    override=True,
                ),
                content_type_options=cloudfront.ResponseHeadersContentTypeOptions(
                    override=True
                ),
                referrer_policy=cloudfront.ResponseHeadersReferrerPolicy(
                    referrer_policy=cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
                    override=True,
                ),
                frame_options=cloudfront.ResponseHeadersFrameOptions(
                    frame_option=cloudfront.HeadersFrameOption.DENY,
                    override=True,
                ),
            ),
        )

    def _create_distribution(
        self,
        unique: str,
        logging_bucket: s3.Bucket,
        files_origin: origins.S3BucketOrigin,
        website_origin: origins.S3BucketOrigin,
        headers_policy: cloudfront.ResponseHeadersPolicy,
    ) -> cloudfront.Distribution:
        return cloudfront.Distribution(
            self,
            "CloudFront",
            comment="Public File Browser for Amazon S3 Static Website",
            default_behavior=cloudfront.BehaviorOptions(
                origin=files_origin,
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                compress=True,
                cache_policy=_CACHING_OPTIMIZED,
                response_headers_policy=headers_policy,
            ),
            additional_behaviors={
                "pfb_for_s3/*": cloudfront.BehaviorOptions(
                    origin=website_origin,
                    viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    compress=True,
                    cache_policy=_CACHING_OPTIMIZED,
                    response_headers_policy=headers_policy,
                )
            },
            default_root_object="pfb_for_s3/index.html",
            enable_logging=True,
            log_bucket=logging_bucket,
            log_file_prefix="cloudfront",
            log_includes_cookies=False,
            http_version=cloudfront.HttpVersion.HTTP2,
            price_class=cloudfront.PriceClass.PRICE_CLASS_100,
            enable_ipv6=False,
            # Uncomment to restrict access to the US, as in the SAM template.
            # geo_restriction=cloudfront.GeoRestriction.allowlist("US"),
        )

    # ------------------------------------------------------------------
    # Cognito
    # ------------------------------------------------------------------
    def _create_cognito(self, unique: str, files_bucket: s3.Bucket):
        identity_pool = cognito.CfnIdentityPool(
            self,
            "CognitoIdentityPool",
            identity_pool_name=f"public-file-browser-Identity-Pool-{unique}",
            allow_unauthenticated_identities=True,
        )

        unauth_role = iam.Role(
            self,
            "CognitoIdentityUnauthenticatedRole",
            role_name=f"public-file-browser-Cognito-Unauth-{unique}",
            assumed_by=iam.FederatedPrincipal(
                "cognito-identity.amazonaws.com",
                conditions={
                    "StringEquals": {
                        "cognito-identity.amazonaws.com:aud": identity_pool.ref
                    },
                    "ForAnyValue:StringLike": {
                        "cognito-identity.amazonaws.com:amr": "unauthenticated"
                    },
                },
                assume_role_action="sts:AssumeRoleWithWebIdentity",
            ),
        )
        unauth_role.add_to_policy(
            iam.PolicyStatement(
                sid="FileAccess",
                actions=["s3:ListBucket"],
                resources=[files_bucket.bucket_arn],
            )
        )

        cognito.CfnIdentityPoolRoleAttachment(
            self,
            "CognitoIdentityPoolRoleMapping",
            identity_pool_id=identity_pool.ref,
            roles={"unauthenticated": unauth_role.role_arn},
        )

        return identity_pool, unauth_role

    # ------------------------------------------------------------------
    # Seeding Lambda + custom resource
    # ------------------------------------------------------------------
    def _create_seed_custom_resource(
        self,
        website_bucket: s3.Bucket,
        files_bucket: s3.Bucket,
        identity_pool: cognito.CfnIdentityPool,
        params: dict,
    ) -> CustomResource:
        # AWSLambdaBasicExecutionRole is intentionally NOT attached: granting it
        # creates a CloudWatch log group during stack deletion that cannot be
        # cleaned up automatically (no way to order log-group deletion before
        # the role/function are gone). This function produces no CloudWatch
        # logs by design; see CLAUDE.md.
        seed_role = iam.Role(
            self,
            "CustomSeedS3DataRole",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
        )
        website_bucket.grant_read_write(seed_role)
        website_bucket.grant_delete(seed_role)

        seed_function = lambda_.Function(
            self,
            "CustomSeedS3Data",
            runtime=lambda_.Runtime.PYTHON_3_13,
            architecture=lambda_.Architecture.ARM_64,
            handler="app.handler",
            role=seed_role,
            timeout=Duration.seconds(30),
            environment={"LOGURU_LEVEL": "INFO"},
            code=lambda_.Code.from_asset(
                str(_SEED_S3_DATA_DIR),
                bundling=seed_lambda_bundling_options(_SEED_S3_DATA_DIR),
            ),
        )

        return CustomResource(
            self,
            "SeedS3Data",
            service_token=seed_function.function_arn,
            resource_type="Custom::SeedS3Data",
            properties={
                "SiteName": params["site_name"].value_as_string,
                "IdentityPoolId": identity_pool.ref,
                "PublicWebsiteBucket": website_bucket.bucket_name,
                "FilesBucketName": files_bucket.bucket_name,
                "FilesOpenMode": params["files_open_tab_mode"].value_as_string,
                "VisibleStorageClasses": params[
                    "visible_storage_classes"
                ].value_as_string,
            },
        )
