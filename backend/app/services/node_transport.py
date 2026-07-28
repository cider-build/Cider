import httpx
from fastapi import HTTPException

from ..models import Node
from .node_gateway import NodeUnavailableError, node_gateway

async def request(node: Node, method: str, path: str, **kwargs) -> httpx.Response:
    path = path if path.startswith("/") else f"/{path}"
    try:
        outbound = httpx.Request(method, f"http://cider-node{path}", **kwargs)
        gateway_response = await node_gateway.request(
            node.id,
            method,
            path,
            {
                key: value
                for key, value in outbound.headers.items()
                if key.lower() != "host"
            },
            await outbound.aread(),
        )
        response = httpx.Response(
            status_code=gateway_response.status_code,
            headers=gateway_response.headers,
            content=gateway_response.content,
            request=outbound,
        )
    except (httpx.HTTPError, NodeUnavailableError) as error:
        raise HTTPException(502, f"node unreachable: {error}") from error
    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text)
    return response
