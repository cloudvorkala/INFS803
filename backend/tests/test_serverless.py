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
    assert "iam" not in config["provider"]
