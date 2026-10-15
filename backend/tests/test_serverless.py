from pathlib import Path

import yaml


def test_foundation_deployment_boundary():
    config = yaml.safe_load((Path(__file__).parents[1] / "serverless.yml").read_text())
    assert config["provider"]["runtime"] == "python3.12"
    assert "ap-southeast-2" in config["provider"]["region"]
    assert list(config["functions"]) == ["api"]
    events = config["functions"]["api"]["events"]
    assert events == [{"http": {"path": "/", "method": "any"}}, {"http": {"path": "/{proxy+}", "method": "any"}}]
    assert "resources" not in config
    assert all(value.startswith("${env:") for value in config["provider"]["environment"].values())


def test_lambda_iam_is_least_privilege():
    config = yaml.safe_load((Path(__file__).parents[1] / "serverless.yml").read_text())
    statements = config["provider"]["iam"]["role"]["statements"]
    actions = {action for statement in statements for action in statement["Action"]}
    assert actions == {
        "dynamodb:Scan", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
        "dynamodb:DeleteItem", "dynamodb:Query", "s3:PutObject",
    }
    assert all(statement["Effect"] == "Allow" for statement in statements)
    assert not any("*" in action for action in actions)
    templates = [statement["Resource"]["Fn::Sub"][0] for statement in statements]
    # Every grant names one table or the upload prefix; no account-wide wildcard.
    assert all(t.endswith("}") or t.endswith("/covers/uploads/*") for t in templates)
    s3 = [s for s in statements if s["Action"] == ["s3:PutObject"]]
    assert len(s3) == 1 and s3[0]["Resource"]["Fn::Sub"][0].endswith("/covers/uploads/*")
    orders_put = [s for s in statements if s["Action"] == ["dynamodb:PutItem"]]
    assert len(orders_put) == 1
    assert orders_put[0]["Condition"] == {
        "StringEquals": {"dynamodb:EnclosingOperation": "TransactWriteItems"},
    }
