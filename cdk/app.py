#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
import aws_cdk as cdk

from pfb_cdk.pfb_stack import PublicFileBrowserStack

app = cdk.App()
PublicFileBrowserStack(
    app,
    "PublicFileBrowserForAmazonS3",
    description=(
        "Public File Browser for Amazon S3. "
        "**WARNING** This template creates resources which incur charges. "
        "You will be billed for the AWS resources used if you create a stack "
        "from this template."
    ),
)

app.synth()
