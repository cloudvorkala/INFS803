"""Lazy, application-owned DynamoDB connections, isolated per worker thread."""

from threading import local

from boto3.session import Session


class DynamoDBConnections:
    def __init__(self, region: str):
        self._region = region
        self._local = local()

    def _session(self):
        # Keep the default credential provider chain (including role refresh).
        # Constructing the application does not initialize SDK clients or use AWS.
        if not hasattr(self._local, "session"):
            self._local.session = Session()
        return self._local.session

    def table(self, name: str):
        # boto3 resources are not thread-safe. Reuse within a thread only, across
        # repository calls and warm Lambda invocations; never cache record data.
        if not hasattr(self._local, "resource"):
            self._local.resource = self._session().resource(
                "dynamodb", region_name=self._region,
            )
            self._local.tables = {}
        if name not in self._local.tables:
            self._local.tables[name] = self._local.resource.Table(name)
        return self._local.tables[name]

    def client(self):
        # Checkout already serializes AttributeValues. Use a separate low-level
        # client, NOT resource.meta.client with its DynamoDB conversion hooks.
        if not hasattr(self._local, "client"):
            self._local.client = self._session().client(
                "dynamodb", region_name=self._region,
            )
        return self._local.client
